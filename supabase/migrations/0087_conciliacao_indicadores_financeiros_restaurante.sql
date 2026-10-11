-- VF-019 do plano de auditoria (docs/PLANO_DE_MELHORIAS.md) — os relatórios
-- financeiros precisam fechar entre si.
--
-- [ACHADO CONFIRMADO EM PRODUÇÃO, mesmo mês e mesma venda] três relatórios
-- calculavam o "resultado" com três fórmulas diferentes:
--   DRE ................ faturamento - CMV - despesas
--   Central do Dono .... faturamento - CMV - perdas - despesas - equipe
--   Resumo financeiro .. faturamento - CMV - perdas - despesas - equipe - taxa de maquininha
-- No cenário de teste: Central -643.440 | DRE -641.894 | Resumo -643.500
-- (diferença DRE x Central = perdas 700 + equipe 846; Resumo x Central = taxa
-- de maquininha 60). Além disso o Resumo atribuía a taxa de maquininha por
-- caixa_movimentos.created_at::date (data UTC do movimento) enquanto todo o
-- resto usa comandas.dia_operacional (dia operacional local, com a "virada").
-- E relatorio_gestao somava "total vendido" com o preço ATUAL do cadastro
-- (produtos.preco_centavos) em vez do preço do item na hora da venda.
--
-- Correção estrutural: UMA função calcula os indicadores do período
-- (restaurante.indicadores_mes) e DRE, Central do Dono e Resumo financeiro
-- passam a usá-la — não dá mais para divergirem. Definições (agora
-- documentadas no próprio retorno do DRE):
--   faturamento = soma de comandas.total_centavos das comandas PAGAS cujo
--                 dia_operacional cai no período (já líquido de desconto e
--                 COM taxa de serviço);
--   taxa de serviço = comandas.taxa_servico_centavos (repassada à equipe);
--   CMV = custo de ficha técnica dos itens não cancelados das comandas pagas;
--   perdas = restaurante.perdas do período; despesas = contas a pagar por
--   vencimento; custo de equipe = taxa de serviço + remuneração;
--   taxa de maquininha = % configurado sobre os recebimentos em cartão/voucher
--   DAS COMANDAS PAGAS do período (mesma base do faturamento);
--   resultado = faturamento - CMV - perdas - despesas - equipe - maquininha.
--
-- [DECISÃO DE DESIGN] adotei a fórmula mais completa (a do Resumo) como a
-- oficial: o DRE passa a mostrar perdas e maquininha, e o resultado da
-- Central do Dono passa a descontar a taxa de maquininha — os números
-- mudam um pouco para baixo, porque antes esses custos reais ficavam de
-- fora. Pode ser revertido sem perda de dado.
--
-- O DRE só mostra custo de equipe/resultado final a quem tem
-- admin.equipe.custos.ver (como a Central já fazia só para ADMIN); os
-- demais veem "resultado antes do custo de equipe".
--
-- Central e Resumo são alterados por PATCH EXATO sobre a definição que está
-- em produção (o repositório está desatualizado para essas duas funções): se
-- algum trecho esperado não for encontrado a migration inteira é desfeita.
-- Reaplicar é seguro (detecta que já foi aplicada).

-- ========================================================================
-- fonte única dos indicadores do período (uso interno — NÃO exposta ao client)
-- ========================================================================
create or replace function restaurante.indicadores_mes(p_empresa_id uuid, p_inicio date, p_fim date)
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_tz text;
  v_faturamento int; v_taxa_servico int; v_cmv int; v_perdas int; v_despesas int;
  v_custo_equipe int; v_taxa_maquininha int;
  v_usuario record;
  v_remuneracao restaurante.funcionarios_remuneracao%rowtype;
  v_dias_trabalhados int;
begin
  select coalesce(timezone, 'America/Sao_Paulo') into v_tz from restaurante.empresas where id = p_empresa_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');

  select coalesce(sum(total_centavos), 0)::int, coalesce(sum(taxa_servico_centavos), 0)::int
    into v_faturamento, v_taxa_servico
    from restaurante.comandas
    where empresa_id = p_empresa_id and status = 'PAGA' and dia_operacional between p_inicio and p_fim;

  select coalesce(sum(ci.quantidade * coalesce((
      select sum((ft.quantidade / restaurante.rendimento_atual(ft.insumo_id)) * i.custo_medio_centavos)
      from restaurante.ficha_tecnica ft join restaurante.insumos i on i.id = ft.insumo_id
      where ft.produto_id = ci.produto_id
    ), 0)), 0)::int into v_cmv
    from restaurante.comanda_itens ci
    join restaurante.comandas c on c.id = ci.comanda_id
    where c.empresa_id = p_empresa_id and c.status = 'PAGA' and c.dia_operacional between p_inicio and p_fim
      and ci.status <> 'CANCELADO';

  select coalesce(sum(valor_centavos), 0)::int into v_perdas
    from restaurante.perdas
    where empresa_id = p_empresa_id and dia_operacional between p_inicio and p_fim;

  select coalesce(sum(valor_centavos), 0)::int into v_despesas
    from restaurante.contas
    where empresa_id = p_empresa_id and tipo = 'PAGAR' and vencimento between p_inicio and p_fim;

  -- mesma base do faturamento: recebimentos em cartão/voucher das comandas
  -- PAGAS do período, pelo dia operacional da comanda
  select coalesce(sum(cm.valor_centavos * coalesce((e.config->'taxasMaquininha'->cm.forma_pagamento->>'pct')::numeric, 0) / 100.0), 0)::int
    into v_taxa_maquininha
    from restaurante.caixa_movimentos cm
    join restaurante.comandas c on c.id = cm.comanda_id
    join restaurante.empresas e on e.id = c.empresa_id
    where c.empresa_id = p_empresa_id and c.status = 'PAGA' and c.dia_operacional between p_inicio and p_fim
      and cm.tipo = 'VENDA' and cm.forma_pagamento in ('DEBITO', 'CREDITO', 'VOUCHER');

  v_custo_equipe := v_taxa_servico;
  for v_usuario in select id from restaurante.usuarios where empresa_id = p_empresa_id and ativo = true
  loop
    select * into v_remuneracao from restaurante.funcionarios_remuneracao where usuario_id = v_usuario.id;
    if v_remuneracao.usuario_id is not null then
      if v_remuneracao.tipo = 'MENSAL' then
        v_custo_equipe := v_custo_equipe + v_remuneracao.valor_centavos;
      else
        select count(distinct registrado_em::date) into v_dias_trabalhados
          from restaurante.pontos
          where usuario_id = v_usuario.id and tipo = 'ENTRADA'
            and registrado_em >= (p_inicio::timestamp at time zone v_tz)
            and registrado_em < ((p_fim + 1)::timestamp at time zone v_tz);
        v_custo_equipe := v_custo_equipe + v_remuneracao.valor_centavos * v_dias_trabalhados;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'faturamento', v_faturamento, 'taxa_servico', v_taxa_servico, 'cmv', v_cmv, 'perdas', v_perdas,
    'despesas', v_despesas, 'custo_equipe', v_custo_equipe, 'taxa_maquininha', v_taxa_maquininha,
    'resultado', v_faturamento - v_cmv - v_perdas - v_despesas - v_custo_equipe - v_taxa_maquininha
  );
end;
$$;

-- recebe empresa_id por parâmetro: nunca pode ser chamada pelo client (só
-- pelas funções SECURITY DEFINER abaixo, que passam jwt_empresa_id())
revoke all on function restaurante.indicadores_mes(uuid, date, date) from public, anon, authenticated;

-- ========================================================================
-- DRE: usa a fonte única e mostra o que antes ficava de fora
-- ========================================================================
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
  v_ind jsonb;
  v_ver_equipe boolean;
  v_antes_equipe int;
begin
  if not restaurante.tem_permissao('admin.relatorios.ver') then
    raise exception 'Sem permissão para ver relatórios';
  end if;

  v_ind := restaurante.indicadores_mes(v_empresa_id, v_desde, v_ate);
  v_ver_equipe := restaurante.tem_permissao('admin.equipe.custos.ver');
  v_antes_equipe := (v_ind->>'faturamento')::int - (v_ind->>'cmv')::int - (v_ind->>'perdas')::int
    - (v_ind->>'despesas')::int - (v_ind->>'taxa_maquininha')::int;

  return jsonb_build_object(
    'mes', to_char(v_desde, 'YYYY-MM'),
    'periodo', jsonb_build_object('desde', v_desde, 'ate', v_ate),
    'faturamento', (v_ind->>'faturamento')::int,
    'cmv', (v_ind->>'cmv')::int,
    'perdas', (v_ind->>'perdas')::int,
    'despesas', (v_ind->>'despesas')::int,
    'taxa_maquininha', (v_ind->>'taxa_maquininha')::int,
    'taxa_servico_incluida_no_faturamento', (v_ind->>'taxa_servico')::int,
    'resultado_antes_equipe', v_antes_equipe,
    'custo_equipe', case when v_ver_equipe then (v_ind->>'custo_equipe')::int else null end,
    'resultado', case when v_ver_equipe then (v_ind->>'resultado')::int else null end,
    'formulas', jsonb_build_object(
      'faturamento', 'Soma das comandas PAGAS com dia operacional no mês — já com desconto e COM taxa de serviço',
      'cmv', 'Custo de ficha técnica dos itens não cancelados das comandas pagas',
      'perdas', 'Perdas e desperdícios registrados no mês',
      'despesas', 'Contas a pagar com vencimento no mês',
      'taxa_maquininha', 'Percentual configurado sobre recebimentos em cartão/voucher das comandas pagas do mês',
      'custo_equipe', 'Taxa de serviço (100% repassada) + remuneração base',
      'resultado', 'Faturamento - CMV - perdas - despesas - maquininha - custo de equipe'
    )
  );
end;
$$;

-- ========================================================================
-- Conciliação do mês contra os movimentos de origem
-- ========================================================================
create or replace function restaurante.relatorio_conciliacao(p_mes date)
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
  v_fat int; v_caixa_pagas int; v_parciais int; v_itens int; v_desc int; v_taxa int;
  v_por_forma jsonb;
begin
  if not restaurante.tem_permissao('admin.relatorios.ver') then
    raise exception 'Sem permissão para ver relatórios';
  end if;

  select coalesce(sum(total_centavos), 0)::int, coalesce(sum(desconto_centavos), 0)::int, coalesce(sum(taxa_servico_centavos), 0)::int
    into v_fat, v_desc, v_taxa
    from restaurante.comandas
    where empresa_id = v_empresa_id and status = 'PAGA' and dia_operacional between v_desde and v_ate;

  select coalesce(sum(cm.valor_centavos), 0)::int into v_caixa_pagas
    from restaurante.caixa_movimentos cm join restaurante.comandas c on c.id = cm.comanda_id
    where c.empresa_id = v_empresa_id and c.status = 'PAGA' and c.dia_operacional between v_desde and v_ate and cm.tipo = 'VENDA';

  select coalesce(sum(cm.valor_centavos), 0)::int into v_parciais
    from restaurante.caixa_movimentos cm join restaurante.comandas c on c.id = cm.comanda_id
    where c.empresa_id = v_empresa_id and c.status in ('ABERTA', 'FECHANDO') and c.dia_operacional between v_desde and v_ate and cm.tipo = 'VENDA';

  select coalesce(sum(ci.preco_unit_centavos * ci.quantidade), 0)::int into v_itens
    from restaurante.comanda_itens ci join restaurante.comandas c on c.id = ci.comanda_id
    where c.empresa_id = v_empresa_id and c.status = 'PAGA' and c.dia_operacional between v_desde and v_ate and ci.status <> 'CANCELADO';

  select coalesce(jsonb_object_agg(forma, total), '{}'::jsonb) into v_por_forma
    from (
      select cm.forma_pagamento as forma, sum(cm.valor_centavos)::int as total
      from restaurante.caixa_movimentos cm join restaurante.comandas c on c.id = cm.comanda_id
      where c.empresa_id = v_empresa_id and c.status = 'PAGA' and c.dia_operacional between v_desde and v_ate and cm.tipo = 'VENDA'
      group by cm.forma_pagamento
    ) x;

  return jsonb_build_object(
    'mes', to_char(v_desde, 'YYYY-MM'),
    'periodo', jsonb_build_object('desde', v_desde, 'ate', v_ate),
    'verificacoes', jsonb_build_array(
      jsonb_build_object(
        'id', 'faturamento_x_caixa',
        'descricao', 'Faturamento (comandas pagas) deve ser igual às entradas de VENDA no caixa dessas mesmas comandas (já sem troco)',
        'valor_a_centavos', v_fat, 'valor_b_centavos', v_caixa_pagas,
        'diferenca_centavos', v_fat - v_caixa_pagas, 'ok', (v_fat = v_caixa_pagas)
      )
    ),
    'derivados', jsonb_build_object(
      'itens_brutos_centavos', v_itens,
      'desconto_manual_centavos', v_desc,
      'taxa_servico_centavos', v_taxa,
      'descontos_cupom_e_pontos_centavos', greatest(0, v_itens - v_desc + v_taxa - v_fat),
      'recebido_em_comandas_ainda_abertas_centavos', v_parciais,
      'recebido_por_forma_centavos', v_por_forma
    ),
    'notas', jsonb_build_array(
      'Itens - desconto manual + taxa de serviço - faturamento = descontos de cupom e pontos (não ficam gravados separadamente).',
      'Pagamento parcial só entra no faturamento quando a comanda fecha; até lá aparece em "recebido em comandas ainda abertas".'
    )
  );
end;
$$;

revoke all on function restaurante.relatorio_conciliacao(date) from public;
grant execute on function restaurante.relatorio_conciliacao(date) to authenticated;

-- ========================================================================
-- Patch exato: Central do Dono, Resumo financeiro e Relatório de gestão
-- ========================================================================
create or replace function pg_temp.substitui(p_texto text, p_de text, p_para text)
returns text
language plpgsql
as $f$
declare
  v_n int;
begin
  v_n := (length(p_texto) - length(replace(p_texto, p_de, ''))) / length(p_de);
  if v_n <> 1 then
    raise exception 'Patch 0087: trecho esperado exatamente 1 vez, achei % -> %', v_n, left(p_de, 70);
  end if;
  return replace(p_texto, p_de, p_para);
end;
$f$;

create or replace function pg_temp.substitui_bloco(p_texto text, p_ini text, p_fim text, p_para text)
returns text
language plpgsql
as $f$
declare
  v_i int := strpos(p_texto, p_ini);
  v_j int := strpos(p_texto, p_fim);
begin
  if v_i = 0 or v_j = 0 or v_j <= v_i then
    raise exception 'Patch 0087: bloco nao encontrado (% .. %)', left(p_ini, 50), left(p_fim, 50);
  end if;
  return left(p_texto, v_i - 1) || p_para || substr(p_texto, v_j);
end;
$f$;

do $patch$
declare
  v_def text;
begin
  -- ---------- Central do Dono ----------
  select replace(pg_get_functiondef(p.oid), E'\r', '') into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'restaurante' and p.proname = 'central_do_dono';
  if v_def is null then raise exception 'central_do_dono nao encontrada'; end if;
  if position('indicadores_mes' in v_def) = 0 then
    v_def := pg_temp.substitui(v_def, E'  v_diferenca_caixa_mes int;\n',
      E'  v_diferenca_caixa_mes int;\n  v_ind jsonb;\n  v_taxa_maq_mes int;\n');
    v_def := pg_temp.substitui_bloco(v_def,
      E'  select coalesce(sum(total_centavos),0)::int into v_faturamento_mes\n',
      E'  select coalesce(sum(valor_centavos),0)::int into v_contas_pendentes_mes\n',
      E'  -- VF-019: fonte única dos indicadores do mês (mesma usada pelo DRE e pelo Resumo financeiro)\n'
      || E'  v_ind := restaurante.indicadores_mes(v_empresa_id, v_mes_inicio, v_mes_fim);\n'
      || E'  v_faturamento_mes := (v_ind->>''faturamento'')::int;\n'
      || E'  v_cmv_mes := (v_ind->>''cmv'')::int;\n'
      || E'  v_perdas_mes := (v_ind->>''perdas'')::int;\n'
      || E'  v_despesas_mes := (v_ind->>''despesas'')::int;\n'
      || E'  v_taxa_mes := (v_ind->>''taxa_servico'')::int;\n'
      || E'  v_custo_equipe_mes := (v_ind->>''custo_equipe'')::int;\n'
      || E'  v_taxa_maq_mes := (v_ind->>''taxa_maquininha'')::int;\n'
      || E'  v_resultado_mes := v_faturamento_mes - v_cmv_mes - v_perdas_mes - v_despesas_mes - v_custo_equipe_mes - v_taxa_maq_mes;\n\n');
    v_def := pg_temp.substitui(v_def, E'      ''despesas_centavos'', v_despesas_mes,\n',
      E'      ''despesas_centavos'', v_despesas_mes,\n      ''taxa_maquininha_centavos'', v_taxa_maq_mes,\n');
    execute v_def;
  end if;

  -- ---------- Resumo financeiro ----------
  select replace(pg_get_functiondef(p.oid), E'\r', '') into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'restaurante' and p.proname = 'relatorio_financeiro_resumo';
  if v_def is null then raise exception 'relatorio_financeiro_resumo nao encontrada'; end if;
  if position('indicadores_mes' in v_def) = 0 then
    v_def := pg_temp.substitui(v_def, E'  v_fluxo jsonb;\n', E'  v_fluxo jsonb;\n  v_ind jsonb;\n  v_ind_ant jsonb;\n');
    v_def := pg_temp.substitui_bloco(v_def,
      E'  -- mês atual\n',
      E'  -- fluxo projetado dos próximos 30 dias',
      E'  -- VF-019: fonte única dos indicadores (mesma do DRE e da Central do Dono)\n'
      || E'  v_ind := restaurante.indicadores_mes(v_empresa_id, v_mes_inicio, v_mes_fim);\n'
      || E'  v_faturamento := (v_ind->>''faturamento'')::int; v_cmv := (v_ind->>''cmv'')::int; v_perdas := (v_ind->>''perdas'')::int;\n'
      || E'  v_despesas := (v_ind->>''despesas'')::int; v_custo_equipe := (v_ind->>''custo_equipe'')::int; v_taxa_maquininha := (v_ind->>''taxa_maquininha'')::int;\n'
      || E'  -- mês anterior (só os totais, pra comparação)\n'
      || E'  v_ind_ant := restaurante.indicadores_mes(v_empresa_id, v_mes_ant_inicio, v_mes_ant_fim);\n'
      || E'  v_fat_ant := (v_ind_ant->>''faturamento'')::int; v_cmv_ant := (v_ind_ant->>''cmv'')::int; v_perdas_ant := (v_ind_ant->>''perdas'')::int;\n'
      || E'  v_despesas_ant := (v_ind_ant->>''despesas'')::int; v_custo_equipe_ant := (v_ind_ant->>''custo_equipe'')::int; v_taxa_maq_ant := (v_ind_ant->>''taxa_maquininha'')::int;\n\n');
    execute v_def;
  end if;

  -- ---------- Relatório de gestão: total vendido com o preço do item na venda ----------
  select replace(pg_get_functiondef(p.oid), E'\r', '') into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'restaurante' and p.proname = 'relatorio_gestao';
  if v_def is null then raise exception 'relatorio_gestao nao encontrada'; end if;
  if position('sum(ci.quantidade * p.preco_centavos)' in v_def) > 0 then
    v_def := pg_temp.substitui(v_def, 'sum(ci.quantidade * p.preco_centavos)::int as total_vendido',
      'sum(ci.quantidade * ci.preco_unit_centavos)::int as total_vendido');
    execute v_def;
  end if;
end;
$patch$;
