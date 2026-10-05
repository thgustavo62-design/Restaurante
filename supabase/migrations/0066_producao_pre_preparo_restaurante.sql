-- PRIORIDADE 2 — Produção / Pré-preparo (Cozinha → sub-aba "Produção")
--
-- [DECISÃO TOMADA NA CONVERSA] Sub-receita (insumo produzido internamente,
-- ex: vinagrete, molho) é um INSUMO NORMAL com uma flag (eh_sub_receita) —
-- não uma tabela separada. Reaproveita toda a tela de Estoque (nome,
-- unidade, estoque atual, custo médio); só ganha uma ficha técnica própria
-- (insumo → insumo, ficha_tecnica_insumo) e o botão "Produzir lote".
--
-- [DECISÃO TOMADA NA CONVERSA] A lista de pré-preparo sugerida vira um
-- REGISTRO DIÁRIO (pre_preparo_checklist), não só uma conta na tela: ao
-- abrir a aba Produção no dia, o sistema gera (ou já tem) as linhas de
-- hoje a partir da média das últimas 4 semanas × ficha técnica; marcar
-- "feito" grava quem e quando, sobrevive a recarregar a página, e dá
-- histórico de "o que foi preparado todo dia".
--
-- A quantidade sugerida cobre os DOIS exemplos do roteiro com a MESMA
-- consulta: "porcionar 6kg de picanha" (picanha aparece direto na ficha
-- técnica de algum produto) e "fazer 3kg de vinagrete" (vinagrete, sendo
-- sub-receita, também é só um insumo que aparece na ficha técnica de
-- algum produto — não precisa resolver árvore de sub-receita aninhada).
--
-- Reaplicar o ajuste (%) sempre recalcula as linhas AINDA NÃO marcadas
-- como feitas (pra um feriado/evento dar pra corrigir a lista depois de
-- aberta) — nunca toca nas que já foram marcadas feito.

alter table restaurante.insumos add column if not exists eh_sub_receita boolean not null default false;

-- ficha técnica de uma sub-receita: insumo produzido ← insumo ingrediente
-- (mesmo formato de restaurante.ficha_tecnica, só que insumo→insumo em vez
-- de produto→insumo). Rendimento do ingrediente (insumo_rendimentos) entra
-- na baixa igual já entra na ficha técnica de produto (0.9).
create table if not exists restaurante.ficha_tecnica_insumo (
  insumo_produzido_id uuid not null references restaurante.insumos(id) on delete cascade,
  insumo_ingrediente_id uuid not null references restaurante.insumos(id) on delete cascade,
  quantidade numeric not null check (quantidade > 0),
  primary key (insumo_produzido_id, insumo_ingrediente_id),
  check (insumo_produzido_id <> insumo_ingrediente_id)
);

alter table restaurante.ficha_tecnica_insumo enable row level security;
drop policy if exists ficha_tecnica_insumo_select on restaurante.ficha_tecnica_insumo;
create policy ficha_tecnica_insumo_select on restaurante.ficha_tecnica_insumo for select
  using (exists (select 1 from restaurante.insumos i where i.id = insumo_produzido_id and i.empresa_id = restaurante.jwt_empresa_id()));
drop policy if exists ficha_tecnica_insumo_insert on restaurante.ficha_tecnica_insumo;
create policy ficha_tecnica_insumo_insert on restaurante.ficha_tecnica_insumo for insert
  with check (
    restaurante.tem_permissao('admin.estoque.editar')
    and exists (select 1 from restaurante.insumos i where i.id = insumo_produzido_id and i.empresa_id = restaurante.jwt_empresa_id())
    -- ingrediente tem que ser da MESMA empresa — sem isto, bastaria
    -- adivinhar o uuid de um insumo de outra empresa pra produzir_lote_sub_receita
    -- baixar estoque cruzando empresas (schema compartilhado).
    and exists (select 1 from restaurante.insumos i2 where i2.id = insumo_ingrediente_id and i2.empresa_id = restaurante.jwt_empresa_id())
  );
drop policy if exists ficha_tecnica_insumo_delete on restaurante.ficha_tecnica_insumo;
create policy ficha_tecnica_insumo_delete on restaurante.ficha_tecnica_insumo for delete
  using (
    restaurante.tem_permissao('admin.estoque.editar')
    and exists (select 1 from restaurante.insumos i where i.id = insumo_produzido_id and i.empresa_id = restaurante.jwt_empresa_id())
  );

-- checklist diário de pré-preparo: uma linha por insumo por dia
-- operacional. "Ver" exige só cozinha.kds.ver (mesma trava da aba KDS,
-- já que Produção é uma sub-aba dela); "Produzir lote" (RPC abaixo) exige
-- admin.estoque.editar por mexer em estoque/custo de verdade.
create table if not exists restaurante.pre_preparo_checklist (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  dia_operacional date not null,
  insumo_id uuid not null references restaurante.insumos(id) on delete cascade,
  quantidade_sugerida numeric not null,
  feito_em timestamptz,
  feito_por uuid references restaurante.usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (empresa_id, dia_operacional, insumo_id)
);
create index if not exists idx_pre_preparo_checklist_dia on restaurante.pre_preparo_checklist (empresa_id, dia_operacional);

alter table restaurante.pre_preparo_checklist enable row level security;
drop policy if exists pre_preparo_checklist_select on restaurante.pre_preparo_checklist;
create policy pre_preparo_checklist_select on restaurante.pre_preparo_checklist for select
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('cozinha.kds.ver'));
-- sem policy de insert/update direta — só pelas RPCs abaixo (SECURITY
-- DEFINER), que decidem a quantidade sugerida e registram quem marcou
-- feito; nunca o client inventando o número ou se auto-marcando sem RPC.

-- Calcula "hoje operacional" do mesmo jeito que central_do_dono() (0065) —
-- timezone da empresa + hora da virada, nunca now() puro nem o relógio do
-- navegador. Pequeno demais pra virar helper compartilhado (mesmo
-- critério já usado em relatorio_dre/relatorio_gestao, cada uma com sua
-- própria conta de período).
create or replace function restaurante.abrir_checklist_pre_preparo(p_ajuste_pct numeric default 0)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_tz text;
  v_virada int;
  v_agora_local timestamp;
  v_dia date;
  v_resultado jsonb;
begin
  if not restaurante.tem_permissao('cozinha.kds.ver') then
    raise exception 'Sem permissão para ver a Produção';
  end if;

  select timezone, virada_dia_operacional_hora into v_tz, v_virada
    from restaurante.empresas where id = v_empresa_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  v_virada := coalesce(v_virada, 5);
  v_agora_local := now() at time zone v_tz;
  v_dia := (v_agora_local - ((v_virada)::text || ' hours')::interval)::date;

  -- recalcula só as linhas de hoje AINDA NÃO feitas (pra não perder quem
  -- já marcou feito se alguém reabrir com um ajuste % diferente).
  delete from restaurante.pre_preparo_checklist
    where empresa_id = v_empresa_id and dia_operacional = v_dia and feito_em is null;

  with vendas_4_semanas as (
    select ci.produto_id, ci.quantidade
    from restaurante.comanda_itens ci
    join restaurante.comandas c on c.id = ci.comanda_id
    where c.empresa_id = v_empresa_id and c.status = 'PAGA' and ci.status <> 'CANCELADO'
      and c.dia_operacional in (v_dia-7, v_dia-14, v_dia-21, v_dia-28)
  ),
  consumo as (
    select ft.insumo_id, sum(v.quantidade * ft.quantidade / restaurante.rendimento_atual(ft.insumo_id)) as total_4_semanas
    from vendas_4_semanas v
    join restaurante.ficha_tecnica ft on ft.produto_id = v.produto_id
    group by ft.insumo_id
  )
  insert into restaurante.pre_preparo_checklist (empresa_id, dia_operacional, insumo_id, quantidade_sugerida)
  select v_empresa_id, v_dia, insumo_id, round((total_4_semanas/4.0) * (1 + coalesce(p_ajuste_pct,0)/100.0), 2)
  from consumo
  where total_4_semanas > 0
  on conflict (empresa_id, dia_operacional, insumo_id) do nothing;

  select coalesce(jsonb_agg(row_to_json(x) order by x.nome), '[]'::jsonb) into v_resultado
  from (
    select pc.id, pc.insumo_id, i.nome, i.unidade, i.eh_sub_receita, pc.quantidade_sugerida,
      pc.feito_em, u.nome as feito_por_nome
    from restaurante.pre_preparo_checklist pc
    join restaurante.insumos i on i.id = pc.insumo_id
    left join restaurante.usuarios u on u.id = pc.feito_por
    where pc.empresa_id = v_empresa_id and pc.dia_operacional = v_dia
  ) x;

  return jsonb_build_object('dia_operacional', v_dia, 'itens', v_resultado);
end;
$$;

revoke all on function restaurante.abrir_checklist_pre_preparo(numeric) from public;
grant execute on function restaurante.abrir_checklist_pre_preparo(numeric) to authenticated;

create or replace function restaurante.marcar_pre_preparo_feito(p_checklist_id uuid, p_feito boolean)
returns void
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
begin
  if not restaurante.tem_permissao('cozinha.kds.ver') then
    raise exception 'Sem permissão para marcar o pré-preparo';
  end if;
  update restaurante.pre_preparo_checklist
    set feito_em = case when p_feito then now() else null end,
        feito_por = case when p_feito then v_usuario_id else null end
    where id = p_checklist_id and empresa_id = v_empresa_id;
  if not found then
    raise exception 'Item do checklist não encontrado';
  end if;
end;
$$;

revoke all on function restaurante.marcar_pre_preparo_feito(uuid, boolean) from public;
grant execute on function restaurante.marcar_pre_preparo_feito(uuid, boolean) to authenticated;

-- "Produzir lote": baixa cada ingrediente da ficha (÷ rendimento mais
-- recente, igual 0.9), dá entrada no insumo produzido com custo médio
-- ponderado (mesma fórmula já usada no recebimento de compras, 0040) e
-- devolve tudo que a etiqueta de manipulação precisa pra imprimir na
-- hora — sem outra consulta. Estoque pode ficar negativo (0.8): nenhuma
-- trava aqui impede produzir mais do que tem ingrediente de verdade.
create or replace function restaurante.produzir_lote_sub_receita(p_insumo_id uuid, p_quantidade numeric, p_validade date default null)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_usuario_nome text;
  v_insumo restaurante.insumos%rowtype;
  v_lote_id uuid := gen_random_uuid();
  v_fti record;
  v_qtd_necessaria numeric;
  v_custo_ingrediente_total numeric := 0;
  v_custo_unit_novo_lote int;
  v_novo_custo_medio int;
  v_tem_ficha boolean;
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if not restaurante.tem_permissao('admin.estoque.editar') then
    raise exception 'Sem permissão para produzir lote';
  end if;
  if not (p_quantidade > 0) then
    raise exception 'Quantidade deve ser maior que zero';
  end if;

  select * into v_insumo from restaurante.insumos where id = p_insumo_id and empresa_id = v_empresa_id;
  if not found then
    raise exception 'Insumo não encontrado';
  end if;
  if not v_insumo.eh_sub_receita then
    raise exception 'Este insumo não está marcado como sub-receita';
  end if;

  select exists(select 1 from restaurante.ficha_tecnica_insumo where insumo_produzido_id = p_insumo_id) into v_tem_ficha;
  if not v_tem_ficha then
    raise exception 'Cadastre a ficha técnica (ingredientes) desta sub-receita antes de produzir um lote';
  end if;

  select nome into v_usuario_nome from restaurante.usuarios where id = v_usuario_id;

  for v_fti in
    select fti.insumo_ingrediente_id, fti.quantidade, i.nome, i.custo_medio_centavos
    from restaurante.ficha_tecnica_insumo fti
    join restaurante.insumos i on i.id = fti.insumo_ingrediente_id and i.empresa_id = v_empresa_id
    where fti.insumo_produzido_id = p_insumo_id
  loop
    v_qtd_necessaria := p_quantidade * (v_fti.quantidade / restaurante.rendimento_atual(v_fti.insumo_ingrediente_id));
    v_custo_ingrediente_total := v_custo_ingrediente_total + (v_qtd_necessaria * v_fti.custo_medio_centavos);

    update restaurante.insumos set estoque_atual = estoque_atual - v_qtd_necessaria
      where id = v_fti.insumo_ingrediente_id and empresa_id = v_empresa_id;

    insert into restaurante.estoque_movimentos (empresa_id, insumo_id, tipo, quantidade, motivo, origem, origem_id, usuario_id)
    values (v_empresa_id, v_fti.insumo_ingrediente_id, 'SAIDA', v_qtd_necessaria, 'Produção interna: '||v_insumo.nome, 'PRODUCAO_INTERNA', v_lote_id, v_usuario_id);
  end loop;

  v_custo_unit_novo_lote := round(v_custo_ingrediente_total / p_quantidade);
  if (v_insumo.estoque_atual + p_quantidade) > 0 then
    v_novo_custo_medio := round((v_insumo.estoque_atual * v_insumo.custo_medio_centavos + p_quantidade * v_custo_unit_novo_lote) / (v_insumo.estoque_atual + p_quantidade));
  else
    v_novo_custo_medio := v_custo_unit_novo_lote;
  end if;

  update restaurante.insumos
    set estoque_atual = estoque_atual + p_quantidade, custo_medio_centavos = v_novo_custo_medio,
        validade = coalesce(p_validade, validade)
    where id = p_insumo_id
    returning * into v_insumo;

  insert into restaurante.estoque_movimentos (empresa_id, insumo_id, tipo, quantidade, motivo, origem, origem_id, usuario_id)
  values (v_empresa_id, p_insumo_id, 'ENTRADA', p_quantidade, 'Produção interna', 'PRODUCAO_INTERNA', v_lote_id, v_usuario_id);

  return jsonb_build_object(
    'insumo', to_jsonb(v_insumo),
    'etiqueta', jsonb_build_object(
      'nome', v_insumo.nome, 'quantidade', p_quantidade, 'unidade', v_insumo.unidade,
      'data_producao', now(), 'validade', coalesce(p_validade, v_insumo.validade),
      'responsavel', v_usuario_nome
    )
  );
end;
$$;

revoke all on function restaurante.produzir_lote_sub_receita(uuid, numeric, date) from public;
grant execute on function restaurante.produzir_lote_sub_receita(uuid, numeric, date) to authenticated;
