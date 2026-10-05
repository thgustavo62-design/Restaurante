-- PRIORIDADE 3 — Perdas e Desperdícios (Estoque → sub-aba "Perdas")
--
-- Tabela restaurante.perdas: um registro por perda, de insumo OU de prato
-- pronto, com motivo, quantidade, valor em R$ (custo médio do insumo, ou
-- CMV do prato — mesma fórmula de ficha_tecnica ÷ rendimento_atual já
-- usada em relatorio_dre/relatorio_gestao/central_do_dono) e responsável.
--
-- Três jeitos de uma linha entrar em restaurante.perdas:
-- 1. Manual (restaurante.registrar_perda) — motivo escolhido pelo usuário
--    entre os 7 motivos "humanos" do roteiro (venceu, estragou, queimou,
--    caiu, devolvido, erro de pedido, sobra).
-- 2. Automática ao cancelar item já em preparo (restaurante.cancelar_item,
--    0043) — motivo CANCELADO_APOS_PREPARO. [DECISÃO DE DESIGN] Esse item
--    NUNCA vai ser pago (foi cancelado), e a baixa de estoque deste app
--    só acontece no pagamento (confirmar_pagamento) — sem baixar aqui, o
--    ingrediente que já saiu de verdade da cozinha ficaria contado como
--    se ainda estivesse em estoque, pra sempre. Por isso, e só aqui, a
--    perda automática TAMBÉM baixa o estoque dos ingredientes.
-- 3. Automática no inventário (restaurante.registrar_inventario, 0054)
--    quando a contagem física é MENOR que o sistema — motivo
--    AJUSTE_INVENTARIO ("perda não identificada" do roteiro). Sobra
--    (contagem maior) não é registrada como perda.
--
-- [NOTA — JUDGMENT CALL, avise se quiser diferente] Uma perda de PRATO
-- registrada manualmente (ex: "sobra do dia" de pratos já prontos que não
-- foram vendidos) NÃO baixa estoque de ingrediente aqui — diferente do
-- caso 2 acima. Motivo: não dá pra saber, só pelo registro manual, se
-- aquele prato específico já passou ou não pela baixa de uma venda paga
-- (baixaria duas vezes) ou nunca vai passar (baixaria zero vezes). Caso 2
-- é seguro porque cancelado = nunca vai ser pago, garantido. Pra manual,
-- optei por só registrar o VALOR (pro relatório/Central do Dono) sem
-- tocar em estoque — se isso gerar estoque desencontrado na prática, a
-- correção é pelo inventário (caso 3), que sempre reconcilia pelo físico.
--
-- Central do Dono (0065) parava de aproximar perdas pelas saídas manuais
-- de estoque — agora soma direto desta tabela, o dado de verdade.

create table if not exists restaurante.perdas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('INSUMO','PRATO')),
  -- restrict (não set null): insumo_id/produto_id participam da CHECK
  -- abaixo — "set null" deixaria uma linha tipo='PRATO' com produto_id
  -- nulo, violando a constraint na primeira vez que alguém excluísse um
  -- produto com perda registrada (mesmo padrão já usado em
  -- estoque_movimentos.insumo_id).
  insumo_id uuid references restaurante.insumos(id) on delete restrict,
  produto_id uuid references restaurante.produtos(id) on delete restrict,
  comanda_item_id uuid references restaurante.comanda_itens(id) on delete set null,
  quantidade numeric not null check (quantidade > 0),
  motivo text not null check (motivo in ('VENCEU','ESTRAGOU','QUEIMOU','CAIU','DEVOLVIDO','ERRO_PEDIDO','SOBRA','CANCELADO_APOS_PREPARO','AJUSTE_INVENTARIO')),
  valor_centavos int not null check (valor_centavos >= 0),
  usuario_id uuid references restaurante.usuarios(id) on delete set null,
  dia_operacional date not null,
  created_at timestamptz not null default now(),
  check (
    (tipo = 'INSUMO' and insumo_id is not null and produto_id is null)
    or (tipo = 'PRATO' and produto_id is not null and insumo_id is null)
  )
);
create index if not exists idx_perdas_empresa_dia on restaurante.perdas (empresa_id, dia_operacional);

alter table restaurante.perdas enable row level security;
drop policy if exists perdas_select on restaurante.perdas;
create policy perdas_select on restaurante.perdas for select
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.estoque.editar'));
-- sem policy de insert/update/delete — só pelas RPCs abaixo (valor
-- calculado no servidor, nunca mandado pelo client).

create or replace function restaurante.registrar_perda(
  p_tipo text, p_insumo_id uuid, p_produto_id uuid, p_quantidade numeric, p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_tz text;
  v_virada int;
  v_agora_local timestamp;
  v_dia date;
  v_insumo restaurante.insumos%rowtype;
  v_produto restaurante.produtos%rowtype;
  v_valor_centavos int;
  v_perda restaurante.perdas%rowtype;
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if not restaurante.tem_permissao('admin.estoque.editar') then
    raise exception 'Sem permissão para registrar perda';
  end if;
  if not (p_quantidade > 0) then
    raise exception 'Quantidade deve ser maior que zero';
  end if;
  if p_motivo not in ('VENCEU','ESTRAGOU','QUEIMOU','CAIU','DEVOLVIDO','ERRO_PEDIDO','SOBRA') then
    raise exception 'Motivo inválido';
  end if;
  if p_tipo not in ('INSUMO','PRATO') then
    raise exception 'Tipo inválido';
  end if;

  select timezone, virada_dia_operacional_hora into v_tz, v_virada
    from restaurante.empresas where id = v_empresa_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  v_virada := coalesce(v_virada, 5);
  v_agora_local := now() at time zone v_tz;
  v_dia := (v_agora_local - ((v_virada)::text || ' hours')::interval)::date;

  if p_tipo = 'INSUMO' then
    if p_insumo_id is null then
      raise exception 'Informe o insumo';
    end if;
    update restaurante.insumos set estoque_atual = estoque_atual - p_quantidade
      where id = p_insumo_id and empresa_id = v_empresa_id
      returning * into v_insumo;
    if not found then
      raise exception 'Insumo não encontrado';
    end if;
    v_valor_centavos := round(p_quantidade * v_insumo.custo_medio_centavos)::int;

    insert into restaurante.estoque_movimentos (empresa_id, insumo_id, tipo, quantidade, motivo, origem, usuario_id)
    values (v_empresa_id, p_insumo_id, 'SAIDA', p_quantidade, 'Perda: '||p_motivo, 'PERDA', v_usuario_id);
  else
    if p_produto_id is null then
      raise exception 'Informe o produto';
    end if;
    select * into v_produto from restaurante.produtos where id = p_produto_id and empresa_id = v_empresa_id;
    if not found then
      raise exception 'Produto não encontrado';
    end if;
    select round(p_quantidade * coalesce((
        select sum((ft.quantidade / restaurante.rendimento_atual(ft.insumo_id)) * i.custo_medio_centavos)
        from restaurante.ficha_tecnica ft join restaurante.insumos i on i.id = ft.insumo_id
        where ft.produto_id = p_produto_id
      ), 0))::int into v_valor_centavos;
  end if;

  insert into restaurante.perdas (empresa_id, tipo, insumo_id, produto_id, quantidade, motivo, valor_centavos, usuario_id, dia_operacional)
  values (
    v_empresa_id, p_tipo, case when p_tipo='INSUMO' then p_insumo_id else null end,
    case when p_tipo='PRATO' then p_produto_id else null end,
    p_quantidade, p_motivo, v_valor_centavos, v_usuario_id, v_dia
  )
  returning * into v_perda;

  return jsonb_build_object('perda', to_jsonb(v_perda), 'insumo', case when p_tipo='INSUMO' then to_jsonb(v_insumo) else null end);
end;
$$;

revoke all on function restaurante.registrar_perda(text, uuid, uuid, numeric, text) from public;
grant execute on function restaurante.registrar_perda(text, uuid, uuid, numeric, text) to authenticated;

create or replace function restaurante.relatorio_perdas(p_desde date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_total int;
  v_faturamento int;
  v_por_motivo jsonb;
  v_por_semana jsonb;
  v_top5 jsonb;
begin
  if not restaurante.tem_permissao('admin.estoque.editar') then
    raise exception 'Sem permissão para ver perdas';
  end if;
  if p_ate < p_desde or (p_ate - p_desde) > 366 then
    raise exception 'Período inválido (máximo de 1 ano)';
  end if;

  select coalesce(sum(valor_centavos),0)::int into v_total
    from restaurante.perdas where empresa_id = v_empresa_id and dia_operacional between p_desde and p_ate;

  select coalesce(sum(total_centavos),0)::int into v_faturamento
    from restaurante.comandas where empresa_id = v_empresa_id and status = 'PAGA' and dia_operacional between p_desde and p_ate;

  select coalesce(jsonb_agg(row_to_json(m) order by m.valor desc), '[]'::jsonb) into v_por_motivo
  from (
    select motivo, sum(valor_centavos)::int as valor, count(*) as qtd
    from restaurante.perdas
    where empresa_id = v_empresa_id and dia_operacional between p_desde and p_ate
    group by motivo
  ) m;

  select coalesce(jsonb_agg(row_to_json(s) order by s.semana), '[]'::jsonb) into v_por_semana
  from (
    select date_trunc('week', dia_operacional)::date as semana, sum(valor_centavos)::int as valor
    from restaurante.perdas
    where empresa_id = v_empresa_id and dia_operacional between p_desde and p_ate
    group by date_trunc('week', dia_operacional)
  ) s;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_top5
  from (
    select coalesce(i.nome, p.nome, 'Sem nome') as nome, sum(pe.valor_centavos)::int as valor
    from restaurante.perdas pe
    left join restaurante.insumos i on i.id = pe.insumo_id
    left join restaurante.produtos p on p.id = pe.produto_id
    where pe.empresa_id = v_empresa_id and pe.dia_operacional between p_desde and p_ate
    group by coalesce(i.nome, p.nome, 'Sem nome')
    order by sum(pe.valor_centavos) desc
    limit 5
  ) t;

  return jsonb_build_object(
    'total_centavos', v_total,
    'pct_faturamento', case when v_faturamento > 0 then round(v_total::numeric/v_faturamento*100, 1) else null end,
    'por_motivo', v_por_motivo, 'por_semana', v_por_semana, 'top5', v_top5
  );
end;
$$;

revoke all on function restaurante.relatorio_perdas(date, date) from public;
grant execute on function restaurante.relatorio_perdas(date, date) to authenticated;

-- ========================================================================
-- inventário: diferença negativa (contado < sistema) grava "perda não
-- identificada" (AJUSTE_INVENTARIO) — reaproveita a quantidade/custo que
-- a função já calculava, só acrescenta o registro em perdas.
-- ========================================================================
create or replace function restaurante.registrar_inventario(p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_tz text;
  v_virada int;
  v_agora_local timestamp;
  v_dia date;
  v_item jsonb;
  v_insumo_id uuid;
  v_contado numeric;
  v_insumo restaurante.insumos%rowtype;
  v_diff numeric;
  v_mov restaurante.estoque_movimentos%rowtype;
  v_resultado jsonb := '[]'::jsonb;
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if not restaurante.tem_permissao('admin.estoque.editar') then
    raise exception 'Sem permissão para movimentar estoque';
  end if;

  select timezone, virada_dia_operacional_hora into v_tz, v_virada
    from restaurante.empresas where id = v_empresa_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  v_virada := coalesce(v_virada, 5);
  v_agora_local := now() at time zone v_tz;
  v_dia := (v_agora_local - ((v_virada)::text || ' hours')::interval)::date;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_insumo_id := (v_item->>'insumo_id')::uuid;
    v_contado := (v_item->>'contado')::numeric;
    if v_contado < 0 then
      raise exception 'Quantidade contada não pode ser negativa';
    end if;

    select * into v_insumo from restaurante.insumos
      where id = v_insumo_id and empresa_id = v_empresa_id for update;
    if not found then
      raise exception 'Insumo não encontrado';
    end if;

    v_diff := v_contado - v_insumo.estoque_atual;
    if v_diff <> 0 then
      update restaurante.insumos set estoque_atual = v_contado, updated_at = now()
        where id = v_insumo_id
        returning * into v_insumo;

      insert into restaurante.estoque_movimentos
        (empresa_id, insumo_id, tipo, quantidade, motivo, origem, usuario_id)
      values (
        v_empresa_id, v_insumo_id, 'AJUSTE', abs(v_diff),
        'Inventário: sistema ' || (v_insumo.estoque_atual - v_diff)::text || ' -> contado ' || v_contado::text ||
          (case when v_diff < 0 then ' (perda ' || abs(v_diff)::text || ')' else ' (sobra ' || v_diff::text || ')' end),
        'INVENTARIO', v_usuario_id
      )
      returning * into v_mov;

      if v_diff < 0 then
        insert into restaurante.perdas (empresa_id, tipo, insumo_id, quantidade, motivo, valor_centavos, usuario_id, dia_operacional)
        values (v_empresa_id, 'INSUMO', v_insumo_id, abs(v_diff), 'AJUSTE_INVENTARIO', round(abs(v_diff) * v_insumo.custo_medio_centavos)::int, v_usuario_id, v_dia);
      end if;

      v_resultado := v_resultado || jsonb_build_object('insumo', to_jsonb(v_insumo), 'movimento', to_jsonb(v_mov));
    end if;
  end loop;

  return v_resultado;
end;
$$;

revoke all on function restaurante.registrar_inventario(jsonb) from public;
grant execute on function restaurante.registrar_inventario(jsonb) to authenticated;

-- ========================================================================
-- cancelar_item: item cancelado depois de já estar em preparo/pronto
-- também baixa o estoque dos ingredientes (ver nota no topo do arquivo)
-- e grava a perda automática.
-- ========================================================================
create or replace function restaurante.cancelar_item(
  p_item_id uuid, p_motivo text, p_supervisor_id uuid, p_supervisor_pin text
)
returns restaurante.comanda_itens
language plpgsql
security definer
set search_path = restaurante, extensions, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_item restaurante.comanda_itens%rowtype;
  v_supervisor restaurante.usuarios%rowtype;
  v_ja_preparado boolean;
  v_dia_operacional date;
  v_valor_centavos int;
  v_ft record;
  v_qtd_baixa numeric;
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Motivo é obrigatório';
  end if;

  select ci.* into v_item from restaurante.comanda_itens ci
    join restaurante.comandas c on c.id = ci.comanda_id
    where ci.id = p_item_id and c.empresa_id = v_empresa_id
    for update of ci;
  if not found then
    raise exception 'Item não encontrado';
  end if;
  if v_item.status = 'CANCELADO' then
    raise exception 'Item já está cancelado';
  end if;

  v_supervisor := restaurante.verificar_pin_supervisor(p_supervisor_id, p_supervisor_pin, 'atendimento.comanda.item.cancelar');
  v_ja_preparado := v_item.status in ('PREPARANDO','PRONTO');

  perform set_config('restaurante.bypass_protecao', 'true', true);
  update restaurante.comanda_itens
    set status = 'CANCELADO', cancelado_apos_preparo = v_ja_preparado, motivo_cancelamento = trim(p_motivo)
    where id = p_item_id
    returning * into v_item;

  insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
  values (v_empresa_id, v_usuario_id, 'comanda_itens', p_item_id, 'CANCELAR_ITEM',
    trim(p_motivo) || ' (aprovado por ' || v_supervisor.nome || ')' || (case when v_ja_preparado then ' [já em preparo]' else '' end));

  -- PRIORIDADE 3 — já foi preparado = ingrediente já saiu de verdade da
  -- cozinha, e cancelado nunca vai passar pela baixa de confirmar_pagamento
  -- (que só baixa item pago). Baixa aqui e grava a perda, pra não ficar
  -- sumido pra sempre.
  if v_ja_preparado then
    select dia_operacional into v_dia_operacional from restaurante.comandas where id = v_item.comanda_id;

    select coalesce(sum((ft.quantidade / restaurante.rendimento_atual(ft.insumo_id)) * i.custo_medio_centavos), 0) * v_item.quantidade
      into v_valor_centavos
      from restaurante.ficha_tecnica ft join restaurante.insumos i on i.id = ft.insumo_id
      where ft.produto_id = v_item.produto_id;

    insert into restaurante.perdas (empresa_id, tipo, produto_id, comanda_item_id, quantidade, motivo, valor_centavos, usuario_id, dia_operacional)
    values (v_empresa_id, 'PRATO', v_item.produto_id, p_item_id, v_item.quantidade, 'CANCELADO_APOS_PREPARO', round(v_valor_centavos)::int, v_usuario_id, v_dia_operacional);

    for v_ft in
      select ft.insumo_id, ft.quantidade
      from restaurante.ficha_tecnica ft
      where ft.produto_id = v_item.produto_id
    loop
      v_qtd_baixa := v_item.quantidade * v_ft.quantidade / restaurante.rendimento_atual(v_ft.insumo_id);
      update restaurante.insumos set estoque_atual = estoque_atual - v_qtd_baixa
        where id = v_ft.insumo_id and empresa_id = v_empresa_id;
      insert into restaurante.estoque_movimentos (empresa_id, insumo_id, tipo, quantidade, motivo, origem, origem_id, usuario_id)
      values (v_empresa_id, v_ft.insumo_id, 'SAIDA', v_qtd_baixa, 'Perda: cancelado após preparo', 'PERDA', p_item_id, v_usuario_id);
    end loop;
  end if;

  return v_item;
end;
$$;

revoke all on function restaurante.cancelar_item(uuid, text, uuid, text) from public;
grant execute on function restaurante.cancelar_item(uuid, text, uuid, text) to authenticated;

-- ========================================================================
-- central_do_dono: perdas do mês agora vêm da tabela de verdade, não mais
-- da aproximação por saída manual de estoque (0065).
-- ========================================================================
create or replace function restaurante.central_do_dono()
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_papel text := restaurante.jwt_papel();
  v_tz text;
  v_virada int;
  v_atraso_cfg jsonb;
  v_meta_cmv_pct numeric;
  v_meta_perdas_pct numeric;
  v_meta_custo_equipe_pct numeric;
  v_meta_diferenca_caixa_mes int;
  v_limite_diferenca_caixa int;

  v_agora_local timestamp;
  v_dia_operacional date;
  v_inicio_hoje timestamptz;
  v_elapsed interval;
  v_mes_inicio date;
  v_mes_fim date;

  v_faturamento_hoje int;
  v_vendas_hoje int;
  v_ticket_hoje int;
  v_faturamento_sem_passada int;
  v_vendas_sem_passada int;
  v_ticket_sem_passada int;

  v_k int;
  v_inicio_k timestamptz;
  v_parcial_k int;
  v_total_dia_k int;
  v_soma_ritmo numeric := 0;
  v_amostras int := 0;
  v_projecao int;

  v_faturamento_mes int;
  v_cmv_mes int;
  v_perdas_mes int;
  v_despesas_mes int;
  v_resultado_mes int;
  v_contas_pendentes_mes int;
  v_falta_contas int;

  v_diferenca_caixa_mes int;

  v_atencao jsonb := '[]'::jsonb;
  v_tmp_qtd int;
  v_tmp_valor int;
  v_cancelamentos_hoje int;
  v_cancelamentos_media numeric;

  v_mesas_total int;
  v_mesas_ocupadas int;
  v_pedidos_atrasados int;
  v_caixas_abertos int;
begin
  if not restaurante.tem_permissao('admin.central_dono.ver') then
    raise exception 'Sem permissão para ver a Central do Dono';
  end if;

  select e.timezone, e.virada_dia_operacional_hora, e.config->'atrasoPorSetor',
      coalesce((e.config->'metasCentralDono'->>'cmvPct')::numeric, 35),
      coalesce((e.config->'metasCentralDono'->>'perdasPctFaturamento')::numeric, 3),
      coalesce((e.config->'metasCentralDono'->>'custoEquipePct')::numeric, 30),
      coalesce((e.config->'metasCentralDono'->>'diferencaCaixaCentavosMes')::int, 5000),
      coalesce((e.config->>'limiteDiferencaCentavos')::int, 500)
    into v_tz, v_virada, v_atraso_cfg, v_meta_cmv_pct, v_meta_perdas_pct, v_meta_custo_equipe_pct,
      v_meta_diferenca_caixa_mes, v_limite_diferenca_caixa
    from restaurante.empresas e where e.id = v_empresa_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  v_virada := coalesce(v_virada, 5);

  v_agora_local := now() at time zone v_tz;
  v_dia_operacional := (v_agora_local - ((v_virada)::text || ' hours')::interval)::date;
  v_inicio_hoje := (v_dia_operacional::timestamp + ((v_virada)::text || ' hours')::interval) at time zone v_tz;
  v_elapsed := now() - v_inicio_hoje;
  v_mes_inicio := date_trunc('month', v_dia_operacional)::date;
  v_mes_fim := (date_trunc('month', v_dia_operacional) + interval '1 month' - interval '1 day')::date;

  -- ---------- bloco 1: hoje até agora vs mesma janela da semana passada ----------
  select coalesce(sum(total_centavos),0)::int, count(*) into v_faturamento_hoje, v_vendas_hoje
    from restaurante.comandas
    where empresa_id = v_empresa_id and status = 'PAGA'
      and fechamento >= v_inicio_hoje and fechamento <= now();
  v_ticket_hoje := case when v_vendas_hoje>0 then round(v_faturamento_hoje::numeric/v_vendas_hoje)::int else 0 end;

  select coalesce(sum(total_centavos),0)::int, count(*) into v_faturamento_sem_passada, v_vendas_sem_passada
    from restaurante.comandas
    where empresa_id = v_empresa_id and status = 'PAGA'
      and fechamento >= v_inicio_hoje - interval '7 days'
      and fechamento <= v_inicio_hoje - interval '7 days' + v_elapsed;
  v_ticket_sem_passada := case when v_vendas_sem_passada>0 then round(v_faturamento_sem_passada::numeric/v_vendas_sem_passada)::int else 0 end;

  for v_k in 1..4 loop
    v_inicio_k := v_inicio_hoje - ((v_k*7)::text || ' days')::interval;
    select coalesce(sum(total_centavos),0)::int into v_parcial_k
      from restaurante.comandas
      where empresa_id = v_empresa_id and status = 'PAGA'
        and fechamento >= v_inicio_k and fechamento <= v_inicio_k + v_elapsed;
    select coalesce(sum(total_centavos),0)::int into v_total_dia_k
      from restaurante.comandas
      where empresa_id = v_empresa_id and status = 'PAGA'
        and fechamento >= v_inicio_k and fechamento < v_inicio_k + interval '1 day';
    if v_parcial_k > 0 then
      v_soma_ritmo := v_soma_ritmo + (v_total_dia_k::numeric / v_parcial_k);
      v_amostras := v_amostras + 1;
    end if;
  end loop;
  v_projecao := round(v_faturamento_hoje * (case when v_amostras>0 then v_soma_ritmo/v_amostras else 1 end))::int;

  -- ---------- bloco 2: sobrou no mês (lucro estimado) ----------
  select coalesce(sum(total_centavos),0)::int into v_faturamento_mes
    from restaurante.comandas
    where empresa_id = v_empresa_id and status = 'PAGA' and dia_operacional between v_mes_inicio and v_mes_fim;

  select coalesce(sum(ci.quantidade * coalesce((
      select sum((ft.quantidade / restaurante.rendimento_atual(ft.insumo_id)) * i.custo_medio_centavos)
      from restaurante.ficha_tecnica ft join restaurante.insumos i on i.id = ft.insumo_id
      where ft.produto_id = ci.produto_id
    ), 0)), 0)::int into v_cmv_mes
    from restaurante.comanda_itens ci
    join restaurante.comandas c on c.id = ci.comanda_id
    where c.empresa_id = v_empresa_id and c.status = 'PAGA' and c.dia_operacional between v_mes_inicio and v_mes_fim
      and ci.status <> 'CANCELADO';

  -- PRIORIDADE 3 — vem da tabela de verdade agora (antes era aproximado
  -- pelas saídas manuais de estoque).
  select coalesce(sum(valor_centavos),0)::int into v_perdas_mes
    from restaurante.perdas
    where empresa_id = v_empresa_id and dia_operacional between v_mes_inicio and v_mes_fim;

  select coalesce(sum(valor_centavos),0)::int into v_despesas_mes
    from restaurante.contas
    where empresa_id = v_empresa_id and tipo = 'PAGAR' and vencimento between v_mes_inicio and v_mes_fim;

  v_resultado_mes := v_faturamento_mes - v_cmv_mes - v_perdas_mes - v_despesas_mes;

  select coalesce(sum(valor_centavos),0)::int into v_contas_pendentes_mes
    from restaurante.contas
    where empresa_id = v_empresa_id and tipo = 'PAGAR' and pago_em is null and vencimento between v_mes_inicio and v_mes_fim;
  v_falta_contas := greatest(0, v_contas_pendentes_mes - v_resultado_mes);

  -- ---------- bloco 3: semáforos ----------
  select coalesce(sum(abs(diferenca_centavos)),0)::int into v_diferenca_caixa_mes
    from restaurante.caixa_sessoes
    where empresa_id = v_empresa_id and status = 'FECHADA' and fechamento_em is not null
      and (fechamento_em at time zone v_tz)::date between v_mes_inicio and v_mes_fim;

  -- ---------- bloco 4: precisa da sua atenção (no máx. 5, por gravidade) ----------
  select count(*) into v_tmp_qtd from restaurante.insumos where empresa_id = v_empresa_id and estoque_atual < 0;
  if v_tmp_qtd > 0 then
    v_atencao := v_atencao || jsonb_build_object('tipo','ESTOQUE_NEGATIVO','gravidade',90,'view','estoque','qtd',v_tmp_qtd);
  end if;

  select count(*), coalesce(sum(valor_centavos),0)::int into v_tmp_qtd, v_tmp_valor
    from restaurante.contas
    where empresa_id = v_empresa_id and tipo = 'PAGAR' and pago_em is null and vencimento <= v_dia_operacional;
  if v_tmp_qtd > 0 then
    v_atencao := v_atencao || jsonb_build_object('tipo','CONTAS_VENCENDO','gravidade',85,'view','financeiro','qtd',v_tmp_qtd,'valor_centavos',v_tmp_valor);
  end if;

  select cs.diferenca_centavos into v_tmp_valor
    from restaurante.caixa_sessoes cs
    where cs.empresa_id = v_empresa_id and cs.status = 'FECHADA' and cs.fechamento_em >= v_inicio_hoje
    order by cs.fechamento_em desc limit 1;
  if v_tmp_valor is not null and abs(v_tmp_valor) > v_limite_diferenca_caixa then
    v_atencao := v_atencao || jsonb_build_object('tipo','DIFERENCA_CAIXA','gravidade',80,'view','caixa','valor_centavos',v_tmp_valor);
  end if;

  select count(*) into v_tmp_qtd from restaurante.sync_conflitos where empresa_id = v_empresa_id and status = 'PENDENTE';
  if v_tmp_qtd > 0 then
    v_atencao := v_atencao || jsonb_build_object('tipo','CONFLITOS_OFFLINE','gravidade',75,'view','configuracoes','qtd',v_tmp_qtd);
  end if;

  select count(*) into v_cancelamentos_hoje
    from restaurante.comanda_itens ci join restaurante.comandas c on c.id = ci.comanda_id
    where c.empresa_id = v_empresa_id and c.dia_operacional = v_dia_operacional and ci.status = 'CANCELADO';
  select coalesce(avg(coalesce(x.cnt,0)),0) into v_cancelamentos_media
    from generate_series((v_dia_operacional - 7)::timestamp, (v_dia_operacional - 1)::timestamp, interval '1 day') as d(dia)
    left join (
      select c.dia_operacional as dia, count(*) as cnt
      from restaurante.comanda_itens ci join restaurante.comandas c on c.id = ci.comanda_id
      where c.empresa_id = v_empresa_id and ci.status = 'CANCELADO'
      group by c.dia_operacional
    ) x on x.dia = d.dia::date;
  if v_cancelamentos_hoje >= 3 and v_cancelamentos_hoje > (v_cancelamentos_media * 2) then
    v_atencao := v_atencao || jsonb_build_object('tipo','CANCELAMENTOS_ACIMA_DO_NORMAL','gravidade',70,'view','auditoria','qtd',v_cancelamentos_hoje,'media',round(v_cancelamentos_media,1));
  end if;

  -- ---------- bloco 5: agora no salão ----------
  select count(*) into v_mesas_total from restaurante.mesas where empresa_id = v_empresa_id;
  select count(distinct mesa_id) into v_mesas_ocupadas
    from restaurante.comandas
    where empresa_id = v_empresa_id and status in ('ABERTA','FECHANDO') and mesa_id is not null;
  select count(*) into v_caixas_abertos from restaurante.caixa_sessoes where empresa_id = v_empresa_id and status = 'ABERTA';
  select count(*) into v_pedidos_atrasados
    from restaurante.comanda_itens ci
    join restaurante.comandas c on c.id = ci.comanda_id
    join restaurante.produtos p on p.id = ci.produto_id
    where c.empresa_id = v_empresa_id and c.status in ('ABERTA','FECHANDO')
      and ci.status in ('PENDENTE','PREPARANDO')
      and now() - ci.enviado_em > (coalesce(v_atraso_cfg->>p.setor_producao,'10') || ' minutes')::interval;

  return jsonb_build_object(
    'dia_operacional', v_dia_operacional,
    'hoje', jsonb_build_object(
      'faturamento_centavos', v_faturamento_hoje, 'vendas', v_vendas_hoje, 'ticket_medio_centavos', v_ticket_hoje,
      'faturamento_semana_passada_centavos', v_faturamento_sem_passada, 'vendas_semana_passada', v_vendas_sem_passada,
      'ticket_medio_semana_passada_centavos', v_ticket_sem_passada,
      'variacao_faturamento_pct', case when v_faturamento_sem_passada>0 then round((v_faturamento_hoje - v_faturamento_sem_passada)::numeric/v_faturamento_sem_passada*100,1) else null end,
      'variacao_vendas_pct', case when v_vendas_sem_passada>0 then round((v_vendas_hoje - v_vendas_sem_passada)::numeric/v_vendas_sem_passada*100,1) else null end,
      'variacao_ticket_pct', case when v_ticket_sem_passada>0 then round((v_ticket_hoje - v_ticket_sem_passada)::numeric/v_ticket_sem_passada*100,1) else null end,
      'projecao_fechamento_centavos', v_projecao
    ),
    'mes', jsonb_build_object(
      'faturamento_centavos', v_faturamento_mes, 'cmv_centavos', v_cmv_mes, 'perdas_centavos', v_perdas_mes,
      'despesas_centavos', v_despesas_mes, 'custo_equipe_centavos', 0, 'custo_equipe_disponivel', false,
      'pode_ver_resultado', (v_papel = 'ADMIN'),
      'resultado_centavos', case when v_papel='ADMIN' then v_resultado_mes else null end,
      'contas_a_pagar_pendentes_centavos', v_contas_pendentes_mes,
      'falta_para_cobrir_contas_centavos', case when v_papel='ADMIN' then v_falta_contas else null end
    ),
    'semaforos', jsonb_build_object(
      'cmv_pct', case when v_faturamento_mes>0 then round(v_cmv_mes::numeric/v_faturamento_mes*100,1) else null end,
      'perdas_pct_faturamento', case when v_faturamento_mes>0 then round(v_perdas_mes::numeric/v_faturamento_mes*100,1) else null end,
      'custo_equipe_pct', null, 'custo_equipe_disponivel', false,
      'diferenca_caixa_centavos_mes', v_diferenca_caixa_mes,
      'metas', jsonb_build_object('cmv_pct',v_meta_cmv_pct,'perdas_pct_faturamento',v_meta_perdas_pct,'custo_equipe_pct',v_meta_custo_equipe_pct,'diferenca_caixa_centavos_mes',v_meta_diferenca_caixa_mes)
    ),
    'atencao', v_atencao,
    'salao', jsonb_build_object(
      'mesas_total', v_mesas_total, 'mesas_ocupadas', v_mesas_ocupadas,
      'pedidos_atrasados_cozinha', v_pedidos_atrasados, 'caixas_abertos', v_caixas_abertos
    )
  );
end;
$$;

revoke all on function restaurante.central_do_dono() from public;
grant execute on function restaurante.central_do_dono() to authenticated;
