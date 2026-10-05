-- PRIORIDADE 7 — Financeiro simples para o dono (Financeiro → sub-aba
-- "Resumo", nova aba padrão)
--
-- Reaproveita o que já existe em vez de duplicar cálculo: CMV/perdas/
-- despesas/custo de equipe usam a MESMA lógica de relatorio_dre (0064)
-- e central_do_dono (0070); taxa de maquininha usa a mesma consulta de
-- restaurante.relatorio_taxas_maquininha (0053), só que somada em vez de
-- devolvida por forma.
--
-- Despesas recorrentes (aluguel, luz, contador...) viram um cadastro
-- próprio (despesas_recorrentes) + uma RPC idempotente
-- (gerar_despesas_recorrentes_do_mes) que lança a conta do mês corrente
-- se ainda não tiver lançado — chamada sempre que a aba Resumo abre
-- (0.11: dado busca só ao abrir a aba). "Idempotente" aqui é um índice
-- único em (despesa_recorrente_id, mês da competência), não um controle
-- manual de "já gerei esse mês" — rodar de novo no mesmo mês não duplica.

create table if not exists restaurante.despesas_recorrentes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  descricao text not null,
  categoria text not null default 'Contas fixas',
  valor_centavos int not null check (valor_centavos > 0),
  dia_vencimento int not null check (dia_vencimento between 1 and 28),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_despesas_recorrentes_empresa on restaurante.despesas_recorrentes (empresa_id, ativo);

alter table restaurante.despesas_recorrentes enable row level security;
drop policy if exists despesas_recorrentes_select on restaurante.despesas_recorrentes;
create policy despesas_recorrentes_select on restaurante.despesas_recorrentes for select
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.financeiro.ver'));
-- sem policy de insert/update — só pela RPC abaixo.

-- date_trunc(text, date) não existe de verdade — o Postgres converte
-- `date` pra `timestamp` e chama a versão STABLE (não IMMUTABLE) de
-- date_trunc, que o Postgres recusa em expressão de índice (42P17).
-- Função própria IMMUTABLE resolve (mesmo truque documentado do Postgres
-- pra "funcionalmente imutável, só não está marcada assim de fábrica").
create or replace function restaurante.mes_competencia(p_dia date)
returns date
language sql
immutable
as $$ select date_trunc('month', p_dia)::date $$;

alter table restaurante.contas add column if not exists despesa_recorrente_id uuid references restaurante.despesas_recorrentes(id) on delete set null;
create unique index if not exists idx_contas_despesa_recorrente_mes
  on restaurante.contas (despesa_recorrente_id, restaurante.mes_competencia(vencimento))
  where despesa_recorrente_id is not null;

create or replace function restaurante.salvar_despesa_recorrente(p_id uuid default null, p_descricao text default null, p_categoria text default 'Contas fixas', p_valor_centavos int default null, p_dia_vencimento int default null, p_ativo boolean default true)
returns restaurante.despesas_recorrentes
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_row restaurante.despesas_recorrentes%rowtype;
begin
  if not restaurante.tem_permissao('admin.financeiro.editar') then
    raise exception 'Sem permissão para editar despesas recorrentes';
  end if;
  if coalesce(trim(p_descricao), '') = '' then
    raise exception 'Descrição é obrigatória';
  end if;
  if not (p_valor_centavos > 0) then
    raise exception 'Valor deve ser maior que zero';
  end if;
  if p_dia_vencimento not between 1 and 28 then
    raise exception 'Dia de vencimento deve ser entre 1 e 28 (todo mês tem esses dias)';
  end if;

  if p_id is not null then
    update restaurante.despesas_recorrentes
      set descricao = trim(p_descricao), categoria = coalesce(p_categoria,'Contas fixas'),
          valor_centavos = p_valor_centavos, dia_vencimento = p_dia_vencimento, ativo = p_ativo
      where id = p_id and empresa_id = v_empresa_id
      returning * into v_row;
    if not found then
      raise exception 'Despesa recorrente não encontrada';
    end if;
  else
    insert into restaurante.despesas_recorrentes (empresa_id, descricao, categoria, valor_centavos, dia_vencimento, ativo)
    values (v_empresa_id, trim(p_descricao), coalesce(p_categoria,'Contas fixas'), p_valor_centavos, p_dia_vencimento, p_ativo)
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke all on function restaurante.salvar_despesa_recorrente(uuid, text, text, int, int, boolean) from public;
grant execute on function restaurante.salvar_despesa_recorrente(uuid, text, text, int, int, boolean) to authenticated;

create or replace function restaurante.gerar_despesas_recorrentes_do_mes()
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_hoje date := current_date;
  v_mes_inicio date := date_trunc('month', v_hoje)::date;
  v_dias_no_mes int := extract(day from (date_trunc('month', v_hoje) + interval '1 month' - interval '1 day'))::int;
  v_despesa record;
  v_vencimento date;
  v_geradas jsonb := '[]'::jsonb;
  v_row restaurante.contas%rowtype;
begin
  if not restaurante.tem_permissao('admin.financeiro.ver') then
    raise exception 'Sem permissão para ver financeiro';
  end if;

  for v_despesa in
    select * from restaurante.despesas_recorrentes
    where empresa_id = v_empresa_id and ativo = true
  loop
    v_vencimento := v_mes_inicio + (least(v_despesa.dia_vencimento, v_dias_no_mes) - 1);
    insert into restaurante.contas (empresa_id, tipo, descricao, categoria, valor_centavos, vencimento, despesa_recorrente_id)
    values (v_empresa_id, 'PAGAR', v_despesa.descricao, v_despesa.categoria, v_despesa.valor_centavos, v_vencimento, v_despesa.id)
    on conflict (despesa_recorrente_id, (restaurante.mes_competencia(vencimento))) where despesa_recorrente_id is not null do nothing
    returning * into v_row;
    if v_row.id is not null then
      v_geradas := v_geradas || to_jsonb(v_row);
    end if;
  end loop;

  return v_geradas;
end;
$$;

revoke all on function restaurante.gerar_despesas_recorrentes_do_mes() from public;
grant execute on function restaurante.gerar_despesas_recorrentes_do_mes() to authenticated;

create or replace function restaurante.relatorio_financeiro_resumo(p_mes date)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_papel text := restaurante.jwt_papel();
  v_mes_inicio date := date_trunc('month', p_mes)::date;
  v_mes_fim date := (date_trunc('month', p_mes) + interval '1 month' - interval '1 day')::date;
  v_mes_ant_inicio date := date_trunc('month', p_mes - interval '1 month')::date;
  v_mes_ant_fim date := (date_trunc('month', p_mes) - interval '1 day')::date;
  v_tz text;
  v_faturamento int; v_cmv int; v_perdas int; v_despesas int; v_custo_equipe int; v_taxa_maquininha int;
  v_fat_ant int; v_cmv_ant int; v_perdas_ant int; v_despesas_ant int; v_custo_equipe_ant int; v_taxa_maq_ant int;
  v_usuario record;
  v_remuneracao restaurante.funcionarios_remuneracao%rowtype;
  v_dias_trabalhados int;
  v_fluxo jsonb;
begin
  if not restaurante.tem_permissao('admin.financeiro.ver') then
    raise exception 'Sem permissão para ver financeiro';
  end if;

  select timezone into v_tz from restaurante.empresas where id = v_empresa_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');

  -- mês atual
  select coalesce(sum(total_centavos),0)::int into v_faturamento
    from restaurante.comandas where empresa_id=v_empresa_id and status='PAGA' and dia_operacional between v_mes_inicio and v_mes_fim;
  select coalesce(sum(ci.quantidade * coalesce((
      select sum((ft.quantidade / restaurante.rendimento_atual(ft.insumo_id)) * i.custo_medio_centavos)
      from restaurante.ficha_tecnica ft join restaurante.insumos i on i.id = ft.insumo_id where ft.produto_id = ci.produto_id
    ), 0)), 0)::int into v_cmv
    from restaurante.comanda_itens ci join restaurante.comandas c on c.id=ci.comanda_id
    where c.empresa_id=v_empresa_id and c.status='PAGA' and c.dia_operacional between v_mes_inicio and v_mes_fim and ci.status<>'CANCELADO';
  select coalesce(sum(valor_centavos),0)::int into v_perdas
    from restaurante.perdas where empresa_id=v_empresa_id and dia_operacional between v_mes_inicio and v_mes_fim;
  select coalesce(sum(valor_centavos),0)::int into v_despesas
    from restaurante.contas where empresa_id=v_empresa_id and tipo='PAGAR' and vencimento between v_mes_inicio and v_mes_fim;
  select coalesce(sum(cm.valor_centavos * coalesce((e.config->'taxasMaquininha'->cm.forma_pagamento->>'pct')::numeric,0) / 100.0), 0)::int into v_taxa_maquininha
    from restaurante.caixa_movimentos cm join restaurante.caixa_sessoes cs on cs.id=cm.sessao_id
    cross join restaurante.empresas e
    where cs.empresa_id=v_empresa_id and e.id=v_empresa_id and cm.tipo='VENDA' and cm.forma_pagamento in ('DEBITO','CREDITO','VOUCHER')
      and cm.created_at::date between v_mes_inicio and v_mes_fim;

  v_custo_equipe := 0;
  select coalesce(sum(taxa_servico_centavos),0)::int into v_custo_equipe
    from restaurante.comandas where empresa_id=v_empresa_id and status='PAGA' and dia_operacional between v_mes_inicio and v_mes_fim;
  for v_usuario in select id from restaurante.usuarios where empresa_id=v_empresa_id and ativo=true
  loop
    select * into v_remuneracao from restaurante.funcionarios_remuneracao where usuario_id=v_usuario.id;
    if v_remuneracao.usuario_id is not null then
      if v_remuneracao.tipo='MENSAL' then
        v_custo_equipe := v_custo_equipe + v_remuneracao.valor_centavos;
      else
        select count(distinct registrado_em::date) into v_dias_trabalhados
          from restaurante.pontos where usuario_id=v_usuario.id and tipo='ENTRADA'
            and registrado_em >= (v_mes_inicio::timestamp at time zone v_tz) and registrado_em < ((v_mes_fim+1)::timestamp at time zone v_tz);
        v_custo_equipe := v_custo_equipe + v_remuneracao.valor_centavos * v_dias_trabalhados;
      end if;
    end if;
  end loop;

  -- mês anterior (só os totais, pra comparação)
  select coalesce(sum(total_centavos),0)::int into v_fat_ant
    from restaurante.comandas where empresa_id=v_empresa_id and status='PAGA' and dia_operacional between v_mes_ant_inicio and v_mes_ant_fim;
  select coalesce(sum(ci.quantidade * coalesce((
      select sum((ft.quantidade / restaurante.rendimento_atual(ft.insumo_id)) * i.custo_medio_centavos)
      from restaurante.ficha_tecnica ft join restaurante.insumos i on i.id = ft.insumo_id where ft.produto_id = ci.produto_id
    ), 0)), 0)::int into v_cmv_ant
    from restaurante.comanda_itens ci join restaurante.comandas c on c.id=ci.comanda_id
    where c.empresa_id=v_empresa_id and c.status='PAGA' and c.dia_operacional between v_mes_ant_inicio and v_mes_ant_fim and ci.status<>'CANCELADO';
  select coalesce(sum(valor_centavos),0)::int into v_perdas_ant
    from restaurante.perdas where empresa_id=v_empresa_id and dia_operacional between v_mes_ant_inicio and v_mes_ant_fim;
  select coalesce(sum(valor_centavos),0)::int into v_despesas_ant
    from restaurante.contas where empresa_id=v_empresa_id and tipo='PAGAR' and vencimento between v_mes_ant_inicio and v_mes_ant_fim;
  select coalesce(sum(taxa_servico_centavos),0)::int into v_custo_equipe_ant
    from restaurante.comandas where empresa_id=v_empresa_id and status='PAGA' and dia_operacional between v_mes_ant_inicio and v_mes_ant_fim;
  select coalesce(sum(cm.valor_centavos * coalesce((e.config->'taxasMaquininha'->cm.forma_pagamento->>'pct')::numeric,0) / 100.0), 0)::int into v_taxa_maq_ant
    from restaurante.caixa_movimentos cm join restaurante.caixa_sessoes cs on cs.id=cm.sessao_id
    cross join restaurante.empresas e
    where cs.empresa_id=v_empresa_id and e.id=v_empresa_id and cm.tipo='VENDA' and cm.forma_pagamento in ('DEBITO','CREDITO','VOUCHER')
      and cm.created_at::date between v_mes_ant_inicio and v_mes_ant_fim;

  -- fluxo projetado dos próximos 30 dias (a receber - a pagar, acumulado a partir de hoje)
  --
  -- o acumulado (sum() over()) precisa ficar numa CTE própria, calculado
  -- ANTES do jsonb_agg: Postgres recusa função de janela dentro do
  -- argumento de uma função agregada ("aggregate function calls cannot
  -- contain window function calls"), mesmo vários níveis dentro de um
  -- jsonb_build_object.
  with dias as (
    select generate_series(current_date, current_date + 29, interval '1 day')::date as dia
  ),
  movimento as (
    select dias.dia,
      coalesce((select sum(valor_centavos) from restaurante.contas where empresa_id=v_empresa_id and tipo='RECEBER' and pago_em is null and vencimento = dias.dia), 0)::int as a_receber,
      coalesce((select sum(valor_centavos) from restaurante.contas where empresa_id=v_empresa_id and tipo='PAGAR' and pago_em is null and vencimento = dias.dia), 0)::int as a_pagar
    from dias
  ),
  movimento_acumulado as (
    select m.dia, m.a_receber, m.a_pagar, (m.a_receber - m.a_pagar) as saldo_dia,
      sum(m.a_receber - m.a_pagar) over (order by m.dia) as saldo_acumulado
    from movimento m
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'data', ma.dia, 'a_receber_centavos', ma.a_receber, 'a_pagar_centavos', ma.a_pagar,
      'saldo_dia_centavos', ma.saldo_dia,
      'saldo_acumulado_centavos', ma.saldo_acumulado
    ) order by ma.dia), '[]'::jsonb) into v_fluxo
  from movimento_acumulado ma;

  return jsonb_build_object(
    'mes', to_char(v_mes_inicio,'YYYY-MM'),
    'entrou_centavos', v_faturamento,
    'saiu_centavos', v_cmv + v_perdas + v_despesas + v_custo_equipe + v_taxa_maquininha,
    'sobrou_centavos', v_faturamento - (v_cmv + v_perdas + v_despesas + v_custo_equipe + v_taxa_maquininha),
    'linhas', jsonb_build_array(
      jsonb_build_object('label','Mercadoria (CMV)', 'valor_centavos', v_cmv),
      jsonb_build_object('label','Equipe', 'valor_centavos', v_custo_equipe),
      jsonb_build_object('label','Contas fixas', 'valor_centavos', v_despesas),
      jsonb_build_object('label','Perdas', 'valor_centavos', v_perdas),
      jsonb_build_object('label','Taxas de maquininha', 'valor_centavos', v_taxa_maquininha)
    ),
    'mes_anterior', jsonb_build_object(
      'entrou_centavos', v_fat_ant,
      'saiu_centavos', v_cmv_ant + v_perdas_ant + v_despesas_ant + v_custo_equipe_ant + v_taxa_maq_ant,
      'sobrou_centavos', v_fat_ant - (v_cmv_ant + v_perdas_ant + v_despesas_ant + v_custo_equipe_ant + v_taxa_maq_ant)
    ),
    'fluxo_30_dias', v_fluxo
  );
end;
$$;

revoke all on function restaurante.relatorio_financeiro_resumo(date) from public;
grant execute on function restaurante.relatorio_financeiro_resumo(date) to authenticated;
