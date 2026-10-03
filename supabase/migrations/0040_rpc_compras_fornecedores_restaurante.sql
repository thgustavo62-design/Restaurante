-- Compras e fornecedores: criar pedido (cabeçalho + itens numa transação só,
-- mesmo raciocínio de confirmar_pagamento — não faz sentido existir um
-- pedido_compra sem nenhum item por causa de uma falha no meio) e receber
-- pedido (marca RECEBIDO e lança entrada de estoque atômica por item, igual
-- confirmar_pagamento faz para a baixa por venda).

create or replace function restaurante.criar_pedido_compra(p_fornecedor_id uuid, p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_pedido restaurante.pedidos_compra%rowtype;
  v_item jsonb;
  v_itens jsonb := '[]'::jsonb;
  v_item_row restaurante.pedidos_compra_itens%rowtype;
  v_fornecedor restaurante.fornecedores%rowtype;
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if not restaurante.tem_permissao('admin.estoque.editar') then
    raise exception 'Sem permissão para criar pedido de compra';
  end if;

  select * into v_fornecedor from restaurante.fornecedores
    where id = p_fornecedor_id and empresa_id = v_empresa_id;
  if not found then
    raise exception 'Fornecedor não encontrado';
  end if;

  if jsonb_array_length(p_itens) = 0 then
    raise exception 'Adicione ao menos um item ao pedido';
  end if;

  insert into restaurante.pedidos_compra (empresa_id, fornecedor_id, status, usuario_id)
  values (v_empresa_id, p_fornecedor_id, 'RASCUNHO', v_usuario_id)
  returning * into v_pedido;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    insert into restaurante.pedidos_compra_itens (pedido_id, insumo_id, quantidade, custo_unit_centavos)
    values (
      v_pedido.id,
      (v_item->>'insumo_id')::uuid,
      (v_item->>'quantidade')::numeric,
      nullif(v_item->>'custo_unit_centavos','')::int
    )
    returning * into v_item_row;
    v_itens := v_itens || to_jsonb(v_item_row);
  end loop;

  return jsonb_build_object('pedido', to_jsonb(v_pedido), 'itens', v_itens);
end;
$$;

revoke all on function restaurante.criar_pedido_compra(uuid, jsonb) from public;
grant execute on function restaurante.criar_pedido_compra(uuid, jsonb) to authenticated;

create or replace function restaurante.marcar_pedido_compra_realizado(p_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
begin
  if not restaurante.tem_permissao('admin.estoque.editar') then
    raise exception 'Sem permissão';
  end if;
  update restaurante.pedidos_compra set status = 'PEDIDO_REALIZADO'
    where id = p_pedido_id and empresa_id = v_empresa_id and status = 'RASCUNHO';
  if not found then
    raise exception 'Pedido não encontrado ou não está em rascunho';
  end if;
end;
$$;

revoke all on function restaurante.marcar_pedido_compra_realizado(uuid) from public;
grant execute on function restaurante.marcar_pedido_compra_realizado(uuid) to authenticated;

create or replace function restaurante.receber_pedido_compra(p_pedido_id uuid)
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

    -- custo médio ponderado pelo estoque atual + esta entrada (só recalcula
    -- se o pedido informou custo unitário)
    if v_item.custo_unit_centavos is not null then
      if (v_insumo.estoque_atual + v_item.quantidade) > 0 then
        v_novo_custo := round((v_insumo.estoque_atual * v_insumo.custo_medio_centavos + v_item.quantidade * v_item.custo_unit_centavos) / (v_insumo.estoque_atual + v_item.quantidade));
      else
        v_novo_custo := v_item.custo_unit_centavos;
      end if;
    else
      v_novo_custo := v_insumo.custo_medio_centavos;
    end if;

    update restaurante.insumos
      set estoque_atual = estoque_atual + v_item.quantidade, custo_medio_centavos = v_novo_custo
      where id = v_item.insumo_id;

    insert into restaurante.estoque_movimentos
      (empresa_id, insumo_id, tipo, quantidade, motivo, origem, origem_id, usuario_id)
    values (
      v_empresa_id, v_item.insumo_id, 'ENTRADA', v_item.quantidade,
      'Compra — ' || coalesce(v_fornecedor.nome, 'fornecedor'), 'compra', p_pedido_id, v_usuario_id
    )
    returning * into v_mov_row;
    v_estoque_movs := v_estoque_movs || to_jsonb(v_mov_row);
  end loop;

  update restaurante.pedidos_compra set status = 'RECEBIDO', recebido_em = now()
    where id = p_pedido_id
    returning * into v_pedido;

  return jsonb_build_object('pedido', to_jsonb(v_pedido), 'estoque_movimentos', v_estoque_movs);
end;
$$;

revoke all on function restaurante.receber_pedido_compra(uuid) from public;
grant execute on function restaurante.receber_pedido_compra(uuid) to authenticated;
