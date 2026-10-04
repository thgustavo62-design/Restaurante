-- Fase 2.1/2.2/2.3/2.4 — Gestão e lucro do dono: CMV/margem por produto,
-- relatório anti-fraude (cancelamentos e descontos por funcionário),
-- taxa de serviço por garçom, curva ABC e heatmap de vendas por dia da
-- semana × hora. Tudo agregado no banco, mesmo padrão de relatorio_vendas
-- (0045) — nunca manda comanda/item completo pro navegador.
--
-- Suposição: "cortesia" (item 2.2) não existe como conceito no sistema
-- hoje (não há status "cortesia" em comanda_itens nem forma de pagamento
-- "cortesia") — o relatório anti-fraude cobre cancelamentos e descontos,
-- que é o que já existe pra auditar. Cortesia fica pra quando alguém
-- decidir como ela deve se comportar (ex: novo status de item, ou forma
-- de pagamento nova) — não inventei isso sozinho.

create or replace function restaurante.relatorio_gestao(p_desde date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_cmv jsonb;
  v_anti_fraude jsonb;
  v_taxa_garcom jsonb;
  v_abc jsonb;
  v_heatmap jsonb;
  v_taxa_pct numeric;
begin
  if not restaurante.tem_permissao('admin.relatorios.ver') then
    raise exception 'Sem permissão para ver relatórios';
  end if;
  if p_ate < p_desde or (p_ate - p_desde) > 366 then
    raise exception 'Período inválido (máximo de 1 ano)';
  end if;

  -- 2.1 — CMV e margem por produto (ficha técnica × custo médio atual do
  -- insumo — não é o custo histórico de quando foi vendido, é a melhor
  -- aproximação disponível sem guardar custo por venda)
  select coalesce(jsonb_agg(row_to_json(c) order by c.total_vendido desc), '[]'::jsonb) into v_cmv
  from (
    select p.id, p.nome, coalesce(cat.nome,'Sem categoria') as categoria,
      p.preco_centavos,
      coalesce((
        select sum(ft.quantidade * i.custo_medio_centavos)
        from restaurante.ficha_tecnica ft join restaurante.insumos i on i.id = ft.insumo_id
        where ft.produto_id = p.id
      ), 0)::int as custo_centavos,
      sum(ci.quantidade) as qtd_vendida,
      sum(ci.quantidade * p.preco_centavos)::int as total_vendido
    from restaurante.produtos p
    left join restaurante.categorias cat on cat.id = p.categoria_id
    join restaurante.comanda_itens ci on ci.produto_id = p.id and ci.status <> 'CANCELADO'
    join restaurante.comandas c2 on c2.id = ci.comanda_id
    where p.empresa_id = v_empresa_id and c2.empresa_id = v_empresa_id
      and c2.status = 'PAGA' and c2.dia_operacional between p_desde and p_ate
    group by p.id, p.nome, cat.nome, p.preco_centavos
  ) c;

  -- 2.2 — anti-fraude: cancelamentos (sempre auditados, 0043) e descontos
  -- (a trilha genérica do trigger de comandas, 0021, pega TODO UPDATE —
  -- aqui filtra só os que de fato mudaram desconto_centavos) por
  -- funcionário, com valores.
  select coalesce(jsonb_agg(row_to_json(f) order by f.valor_total desc), '[]'::jsonb) into v_anti_fraude
  from (
    select u.id as usuario_id, u.nome,
      coalesce(sum(case when x.tipo='CANCELAMENTO' then 1 else 0 end),0) as cancelamentos_qtd,
      coalesce(sum(case when x.tipo='CANCELAMENTO' then x.valor else 0 end),0)::int as cancelamentos_valor,
      coalesce(sum(case when x.tipo='DESCONTO' then 1 else 0 end),0) as descontos_qtd,
      coalesce(sum(case when x.tipo='DESCONTO' then x.valor else 0 end),0)::int as descontos_valor,
      coalesce(sum(x.valor),0)::int as valor_total
    from restaurante.usuarios u
    join (
      -- cancelamentos: valor do item cancelado
      select a.usuario_id, 'CANCELAMENTO' as tipo,
        coalesce(ci.preco_unit_centavos * ci.quantidade, 0) as valor
      from restaurante.auditoria a
      join restaurante.comanda_itens ci on ci.id = a.entidade_id
      where a.empresa_id = v_empresa_id and a.entidade = 'comanda_itens' and a.acao = 'CANCELAR_ITEM'
        and a.created_at::date between p_desde and p_ate
      union all
      -- descontos: delta de desconto_centavos em cada UPDATE de comandas
      select a.usuario_id, 'DESCONTO' as tipo,
        greatest(0, coalesce((a.dados_depois->>'desconto_centavos')::int,0) - coalesce((a.dados_antes->>'desconto_centavos')::int,0)) as valor
      from restaurante.auditoria a
      where a.empresa_id = v_empresa_id and a.entidade = 'comandas' and a.acao = 'UPDATE'
        and a.created_at::date between p_desde and p_ate
        and coalesce((a.dados_depois->>'desconto_centavos')::int,0) > coalesce((a.dados_antes->>'desconto_centavos')::int,0)
    ) x on x.usuario_id = u.id
    where u.empresa_id = v_empresa_id
    group by u.id, u.nome
  ) f;

  -- 2.3 — taxa de serviço por garçom: taxa do período inteiro rateada
  -- proporcionalmente ao subtotal que cada um lançou (não dá pra saber a
  -- taxa exata por item individual, já que ela é calculada por comanda).
  select coalesce((config->>'taxaServicoPctPadrao')::numeric, 10) into v_taxa_pct
    from restaurante.empresas where id = v_empresa_id;

  select coalesce(jsonb_agg(row_to_json(g) order by g.taxa_estim desc), '[]'::jsonb) into v_taxa_garcom
  from (
    select u.nome, sum(ci.preco_unit_centavos*ci.quantidade)::int as subtotal,
      round(sum(ci.preco_unit_centavos*ci.quantidade) * v_taxa_pct / 100.0)::int as taxa_estim
    from restaurante.comanda_itens ci
    join restaurante.comandas c on c.id = ci.comanda_id
    join restaurante.usuarios u on u.id = ci.usuario_id
    where c.empresa_id = v_empresa_id and c.status = 'PAGA' and c.taxa_servico_ativa = true
      and c.dia_operacional between p_desde and p_ate and ci.status <> 'CANCELADO'
    group by u.nome
  ) g;

  -- 2.4a — curva ABC de produtos (classe A = acumula até 80% do
  -- faturamento, B até 95%, C o resto — corte clássico)
  select coalesce(jsonb_agg(row_to_json(ab)), '[]'::jsonb) into v_abc
  from (
    select nome, total, classe from (
      select ci.nome, sum(ci.preco_unit_centavos*ci.quantidade)::int as total,
        sum(sum(ci.preco_unit_centavos*ci.quantidade)) over (order by sum(ci.preco_unit_centavos*ci.quantidade) desc) as acumulado,
        sum(sum(ci.preco_unit_centavos*ci.quantidade)) over () as total_geral
      from restaurante.comanda_itens ci
      join restaurante.comandas c on c.id = ci.comanda_id
      where c.empresa_id = v_empresa_id and c.status = 'PAGA'
        and c.dia_operacional between p_desde and p_ate and ci.status <> 'CANCELADO'
      group by ci.nome
    ) ranked
    cross join lateral (
      select case
        when total_geral = 0 then 'C'
        when acumulado::numeric / total_geral <= 0.8 then 'A'
        when acumulado::numeric / total_geral <= 0.95 then 'B'
        else 'C'
      end as classe
    ) cl
    order by total desc
  ) ab;

  -- 2.4b — heatmap: vendas por dia da semana (0=domingo) × hora do
  -- pagamento (fechamento)
  select coalesce(jsonb_agg(row_to_json(h)), '[]'::jsonb) into v_heatmap
  from (
    select extract(dow from fechamento)::int as dia_semana,
      extract(hour from fechamento)::int as hora,
      sum(total_centavos)::int as total,
      count(*) as vendas
    from restaurante.comandas
    where empresa_id = v_empresa_id and status = 'PAGA'
      and dia_operacional between p_desde and p_ate
    group by extract(dow from fechamento), extract(hour from fechamento)
  ) h;

  return jsonb_build_object(
    'cmv_por_produto', v_cmv,
    'anti_fraude', v_anti_fraude,
    'taxa_por_garcom', v_taxa_garcom,
    'curva_abc', v_abc,
    'heatmap', v_heatmap
  );
end;
$$;

revoke all on function restaurante.relatorio_gestao(date, date) from public;
grant execute on function restaurante.relatorio_gestao(date, date) to authenticated;

-- ---------- 2.4c — DRE mensal simples ----------

create or replace function restaurante.relatorio_dre(p_mes date)
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_desde date := date_trunc('month', p_mes)::date;
  v_ate date := (date_trunc('month', p_mes) + interval '1 month' - interval '1 day')::date;
  v_faturamento int;
  v_cmv int;
  v_despesas int;
begin
  if not restaurante.tem_permissao('admin.relatorios.ver') then
    raise exception 'Sem permissão para ver relatórios';
  end if;

  select coalesce(sum(total_centavos),0)::int into v_faturamento
    from restaurante.comandas
    where empresa_id = v_empresa_id and status = 'PAGA' and dia_operacional between v_desde and v_ate;

  select coalesce(sum(ci.quantidade * coalesce((
      select sum(ft.quantidade * i.custo_medio_centavos)
      from restaurante.ficha_tecnica ft join restaurante.insumos i on i.id = ft.insumo_id
      where ft.produto_id = ci.produto_id
    ), 0)), 0)::int into v_cmv
    from restaurante.comanda_itens ci
    join restaurante.comandas c on c.id = ci.comanda_id
    where c.empresa_id = v_empresa_id and c.status = 'PAGA' and c.dia_operacional between v_desde and v_ate
      and ci.status <> 'CANCELADO';

  -- despesas do mês = contas a pagar com vencimento no mês (regime de
  -- competência, não importa se já foi pago)
  select coalesce(sum(valor_centavos),0)::int into v_despesas
    from restaurante.contas
    where empresa_id = v_empresa_id and tipo = 'PAGAR' and vencimento between v_desde and v_ate;

  return jsonb_build_object(
    'mes', to_char(v_desde, 'YYYY-MM'),
    'faturamento', v_faturamento,
    'cmv', v_cmv,
    'despesas', v_despesas,
    'resultado', v_faturamento - v_cmv - v_despesas
  );
end;
$$;

revoke all on function restaurante.relatorio_dre(date) from public;
grant execute on function restaurante.relatorio_dre(date) to authenticated;
