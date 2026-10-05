-- PRIORIDADE 4 — Compras Inteligentes (Compras → sub-abas: Lista de
-- compras · Pedidos · Cotação · Preços)
--
-- [DECISÃO DE DESIGN] Não existia, em lugar nenhum do schema, "qual
-- fornecedor fornece qual insumo" — fornecedores e pedidos de compra
-- sempre foram escolhidos na hora, pedido por pedido. Pra "lista de
-- compras agrupada por fornecedor" funcionar sem inventar uma tabela
-- pivot que o roteiro não pediu, adicionei insumos.fornecedor_padrao_id
-- (um fornecedor preferencial por insumo, opcional). Insumo sem
-- fornecedor padrão aparece num grupo "sem fornecedor definido" na lista.
-- prazo_entrega_dias/dia_entrega_semana entram em fornecedores, exatamente
-- como o roteiro pediu ("campos novos em fornecedores").
--
-- Cotação (comparar até 3 fornecedores, preço digitado à mão) NÃO ganhou
-- tabela nem RPC novas — é uma UI só do client que no final chama
-- restaurante.criar_pedido_compra (0040) uma vez por fornecedor vencedor,
-- com o preço vencedor em custo_unit_centavos. Não tem "valor calculado"
-- aqui pra proteger: é cotação manual, cada fornecedor dando seu preço.
--
-- Histórico de preço (restaurante.historico_precos_insumo) é alimentado
-- só por restaurante.receber_pedido_compra, no recebimento de verdade —
-- nunca editável direto, sem policy de insert/update pro client.
--
-- Conferência no recebimento: receber_pedido_compra ganhou um parâmetro
-- novo (p_itens_recebidos, com default — por isso o REPLACE não cria um
-- overload novo, é a mesma função com mais um parâmetro no final) pra
-- informar quantidade/preço REALMENTE recebido por item; quando o
-- recebido diverge do pedido, grava uma linha em auditoria
-- (DIVERGENCIA_RECEBIMENTO) — sem tabela nova só pra isso, a Auditoria já
-- tem tela e filtro prontos. A baixa de estoque usa a quantidade/preço
-- RECEBIDOS, não os pedidos (o que chegou de verdade é o que importa pro
-- estoque e pro custo médio).

alter table restaurante.fornecedores add column if not exists prazo_entrega_dias int check (prazo_entrega_dias is null or prazo_entrega_dias > 0);
alter table restaurante.fornecedores add column if not exists dia_entrega_semana int check (dia_entrega_semana is null or dia_entrega_semana between 0 and 6);

alter table restaurante.insumos add column if not exists fornecedor_padrao_id uuid references restaurante.fornecedores(id) on delete set null;

alter table restaurante.pedidos_compra_itens add column if not exists quantidade_recebida numeric;
alter table restaurante.pedidos_compra_itens add column if not exists preco_unit_recebido_centavos int;

create table if not exists restaurante.historico_precos_insumo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  insumo_id uuid not null references restaurante.insumos(id) on delete restrict,
  fornecedor_id uuid references restaurante.fornecedores(id) on delete set null,
  preco_centavos int not null check (preco_centavos >= 0),
  pedido_compra_id uuid references restaurante.pedidos_compra(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_historico_precos_insumo on restaurante.historico_precos_insumo (empresa_id, insumo_id, created_at desc);

alter table restaurante.historico_precos_insumo enable row level security;
drop policy if exists historico_precos_insumo_select on restaurante.historico_precos_insumo;
create policy historico_precos_insumo_select on restaurante.historico_precos_insumo for select
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.estoque.editar'));
-- sem policy de insert/update — só grava via receber_pedido_compra.

-- ========================================================================
-- Lista de compras automática
-- ========================================================================
create or replace function restaurante.lista_compras_sugerida()
returns jsonb
language plpgsql
stable
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
  if not restaurante.tem_permissao('admin.estoque.editar') then
    raise exception 'Sem permissão para ver a lista de compras';
  end if;

  select timezone, virada_dia_operacional_hora into v_tz, v_virada
    from restaurante.empresas where id = v_empresa_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  v_virada := coalesce(v_virada, 5);
  v_agora_local := now() at time zone v_tz;
  v_dia := (v_agora_local - ((v_virada)::text || ' hours')::interval)::date;

  with vendas_28_dias as (
    select ci.produto_id, ci.quantidade
    from restaurante.comanda_itens ci
    join restaurante.comandas c on c.id = ci.comanda_id
    where c.empresa_id = v_empresa_id and c.status = 'PAGA' and ci.status <> 'CANCELADO'
      and c.dia_operacional between (v_dia - 27) and v_dia
  ),
  consumo_diario as (
    select ft.insumo_id, sum(v.quantidade * ft.quantidade / restaurante.rendimento_atual(ft.insumo_id)) / 28.0 as media_dia
    from vendas_28_dias v
    join restaurante.ficha_tecnica ft on ft.produto_id = v.produto_id
    group by ft.insumo_id
  ),
  sugestao as (
    select i.id as insumo_id, i.nome, i.unidade, i.estoque_atual, i.estoque_minimo,
      i.fornecedor_padrao_id, f.nome as fornecedor_nome, f.prazo_entrega_dias, f.dia_entrega_semana,
      coalesce(cd.media_dia, 0) * coalesce(f.prazo_entrega_dias, 7) as consumo_previsto,
      greatest(0, round(i.estoque_minimo + coalesce(cd.media_dia, 0) * coalesce(f.prazo_entrega_dias, 7) - i.estoque_atual, 2)) as quantidade_sugerida
    from restaurante.insumos i
    left join consumo_diario cd on cd.insumo_id = i.id
    left join restaurante.fornecedores f on f.id = i.fornecedor_padrao_id
    where i.empresa_id = v_empresa_id
  )
  select coalesce(jsonb_agg(row_to_json(g) order by (g.fornecedor_nome is null), g.fornecedor_nome), '[]'::jsonb) into v_resultado
  from (
    select fornecedor_padrao_id as fornecedor_id, fornecedor_nome, prazo_entrega_dias, dia_entrega_semana,
      jsonb_agg(jsonb_build_object(
        'insumo_id', insumo_id, 'nome', nome, 'unidade', unidade, 'estoque_atual', estoque_atual,
        'estoque_minimo', estoque_minimo, 'consumo_previsto', round(consumo_previsto, 2), 'quantidade_sugerida', quantidade_sugerida
      ) order by nome) as itens
    from sugestao
    where quantidade_sugerida > 0
    group by fornecedor_padrao_id, fornecedor_nome, prazo_entrega_dias, dia_entrega_semana
  ) g;

  return coalesce(v_resultado, '[]'::jsonb);
end;
$$;

revoke all on function restaurante.lista_compras_sugerida() from public;
grant execute on function restaurante.lista_compras_sugerida() to authenticated;

-- ========================================================================
-- Conferência no recebimento (quantidade/preço recebido vs pedido) +
-- histórico de preço alimentado aqui.
-- ========================================================================
create or replace function restaurante.receber_pedido_compra(p_pedido_id uuid, p_itens_recebidos jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_pedido restaurante.pedidos_compra%rowtype;
  v_fornecedor restaurante.fornecedores%rowtype;
  v_item record;
  v_recebido jsonb;
  v_qtd_recebida numeric;
  v_preco_recebido int;
  v_insumo restaurante.insumos%rowtype;
  v_mov_row restaurante.estoque_movimentos%rowtype;
  v_estoque_movs jsonb := '[]'::jsonb;
  v_novo_custo int;
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if not restaurante.tem_permissao('admin.estoque.editar') then
    raise exception 'Sem permissão para receber pedido de compra';
  end if;

  select * into v_pedido from restaurante.pedidos_compra
    where id = p_pedido_id and empresa_id = v_empresa_id
    for update;
  if not found then
    raise exception 'Pedido não encontrado';
  end if;
  if v_pedido.status = 'RECEBIDO' then
    raise exception 'Pedido já foi recebido';
  end if;

  select * into v_fornecedor from restaurante.fornecedores where id = v_pedido.fornecedor_id;

  for v_item in
    select * from restaurante.pedidos_compra_itens where pedido_id = p_pedido_id
  loop
    select * into v_insumo from restaurante.insumos where id = v_item.insumo_id for update;
    if not found then continue; end if;

    -- item recebido informado pelo client (jsonb [{item_id, quantidade_recebida, preco_unit_recebido_centavos}]);
    -- sem informação pra este item, assume igual ao pedido (recebimento "como pedido").
    select x into v_recebido from jsonb_array_elements(coalesce(p_itens_recebidos, '[]'::jsonb)) x
      where (x->>'item_id')::uuid = v_item.id limit 1;
    v_qtd_recebida := coalesce((v_recebido->>'quantidade_recebida')::numeric, v_item.quantidade);
    v_preco_recebido := coalesce((v_recebido->>'preco_unit_recebido_centavos')::int, v_item.custo_unit_centavos);

    if v_qtd_recebida <> v_item.quantidade or coalesce(v_preco_recebido,-1) <> coalesce(v_item.custo_unit_centavos,-1) then
      insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, dados_antes, dados_depois, motivo)
      values (
        v_empresa_id, v_usuario_id, 'pedidos_compra_itens', v_item.id, 'DIVERGENCIA_RECEBIMENTO',
        jsonb_build_object('quantidade_pedida', v_item.quantidade, 'preco_unit_pedido_centavos', v_item.custo_unit_centavos),
        jsonb_build_object('quantidade_recebida', v_qtd_recebida, 'preco_unit_recebido_centavos', v_preco_recebido),
        v_insumo.nome
      );
    end if;

    update restaurante.pedidos_compra_itens
      set quantidade_recebida = v_qtd_recebida, preco_unit_recebido_centavos = v_preco_recebido
      where id = v_item.id;

    if v_qtd_recebida > 0 then
      if v_preco_recebido is not null then
        if (v_insumo.estoque_atual + v_qtd_recebida) > 0 then
          v_novo_custo := round((v_insumo.estoque_atual * v_insumo.custo_medio_centavos + v_qtd_recebida * v_preco_recebido) / (v_insumo.estoque_atual + v_qtd_recebida));
        else
          v_novo_custo := v_preco_recebido;
        end if;
      else
        v_novo_custo := v_insumo.custo_medio_centavos;
      end if;

      update restaurante.insumos
        set estoque_atual = estoque_atual + v_qtd_recebida, custo_medio_centavos = v_novo_custo
        where id = v_item.insumo_id;

      insert into restaurante.estoque_movimentos
        (empresa_id, insumo_id, tipo, quantidade, motivo, origem, origem_id, usuario_id)
      values (
        v_empresa_id, v_item.insumo_id, 'ENTRADA', v_qtd_recebida,
        'Compra — ' || coalesce(v_fornecedor.nome, 'fornecedor'), 'compra', p_pedido_id, v_usuario_id
      )
      returning * into v_mov_row;
      v_estoque_movs := v_estoque_movs || to_jsonb(v_mov_row);

      if v_preco_recebido is not null then
        insert into restaurante.historico_precos_insumo (empresa_id, insumo_id, fornecedor_id, preco_centavos, pedido_compra_id)
        values (v_empresa_id, v_item.insumo_id, v_pedido.fornecedor_id, v_preco_recebido, p_pedido_id);
      end if;
    end if;
  end loop;

  update restaurante.pedidos_compra set status = 'RECEBIDO', recebido_em = now()
    where id = p_pedido_id
    returning * into v_pedido;

  return jsonb_build_object('pedido', to_jsonb(v_pedido), 'estoque_movimentos', v_estoque_movs);
end;
$$;

revoke all on function restaurante.receber_pedido_compra(uuid, jsonb) from public;
grant execute on function restaurante.receber_pedido_compra(uuid, jsonb) to authenticated;

-- ========================================================================
-- Preços: histórico por insumo, alerta de aumento acima do limite
-- configurado, e quais pratos perdem margem com o aumento.
-- ========================================================================
create or replace function restaurante.relatorio_precos_insumo()
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_limite_pct numeric;
  v_resultado jsonb;
begin
  if not restaurante.tem_permissao('admin.estoque.editar') then
    raise exception 'Sem permissão para ver preços';
  end if;

  select coalesce((config->>'alertaAumentoPrecoInsumoPct')::numeric, 10) into v_limite_pct
    from restaurante.empresas where id = v_empresa_id;

  with ultimos_2 as (
    select h.insumo_id, h.preco_centavos, h.created_at,
      row_number() over (partition by h.insumo_id order by h.created_at desc) as rn
    from restaurante.historico_precos_insumo h
    where h.empresa_id = v_empresa_id
  ),
  comparativo as (
    select a.insumo_id, a.preco_centavos as preco_atual, a.created_at as data_atual,
      b.preco_centavos as preco_anterior
    from ultimos_2 a
    left join ultimos_2 b on b.insumo_id = a.insumo_id and b.rn = 2
    where a.rn = 1
  ),
  comparativo_calc as (
    select c.*, i.nome, i.unidade,
      case when c.preco_anterior > 0 then round((c.preco_atual - c.preco_anterior)::numeric / c.preco_anterior * 100, 1) else null end as variacao_pct
    from comparativo c
    join restaurante.insumos i on i.id = c.insumo_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'insumo_id', cc.insumo_id, 'nome', cc.nome, 'unidade', cc.unidade,
      'preco_atual_centavos', cc.preco_atual, 'preco_anterior_centavos', cc.preco_anterior,
      'variacao_pct', cc.variacao_pct, 'data_atual', cc.data_atual,
      'alerta', coalesce(cc.variacao_pct > v_limite_pct, false),
      'pratos_afetados', case when coalesce(cc.variacao_pct > v_limite_pct, false) then (
        select coalesce(jsonb_agg(jsonb_build_object(
            'produto_id', p.id, 'nome', p.nome,
            'margem_atual_centavos', p.preco_centavos - coalesce((
              select sum((ft2.quantidade / restaurante.rendimento_atual(ft2.insumo_id)) * i2.custo_medio_centavos)
              from restaurante.ficha_tecnica ft2 join restaurante.insumos i2 on i2.id = ft2.insumo_id
              where ft2.produto_id = p.id
            ), 0)::int,
            'impacto_centavos', round(ft.quantidade / restaurante.rendimento_atual(ft.insumo_id) * (cc.preco_atual - cc.preco_anterior))::int
          )), '[]'::jsonb)
        from restaurante.ficha_tecnica ft
        join restaurante.produtos p on p.id = ft.produto_id and p.empresa_id = v_empresa_id
        where ft.insumo_id = cc.insumo_id
      ) else '[]'::jsonb end
    ) order by cc.variacao_pct desc nulls last), '[]'::jsonb) into v_resultado
  from comparativo_calc cc;

  return jsonb_build_object('limite_pct', v_limite_pct, 'insumos', v_resultado);
end;
$$;

revoke all on function restaurante.relatorio_precos_insumo() from public;
grant execute on function restaurante.relatorio_precos_insumo() to authenticated;
