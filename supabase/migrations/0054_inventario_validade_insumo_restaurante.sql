-- Fase 2.6 (parte sem decisão pendente) — inventário com contagem física e
-- validade de insumo. A parte [DECISÃO] desta fase (estoque negativo em
-- vez de travar em zero) NÃO está nesta migration — segue travado em
-- greatest(0, ...) até a decisão vir.
--
-- Inventário: lança toda a contagem física de uma vez (registrar_inventario),
-- um movimento AJUSTE por insumo cuja contagem difere do sistema — a
-- perda (contado < sistema) ou sobra (contado > sistema) fica registrada
-- no motivo, igual já era pra entrada/saída manual.

alter table restaurante.estoque_movimentos drop constraint estoque_movimentos_tipo_check;
alter table restaurante.estoque_movimentos add constraint estoque_movimentos_tipo_check
  check (tipo in ('ENTRADA','SAIDA','VENDA','AJUSTE'));

alter table restaurante.insumos add column if not exists validade date;

create or replace function restaurante.registrar_inventario(p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
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

      v_resultado := v_resultado || jsonb_build_object('insumo', to_jsonb(v_insumo), 'movimento', to_jsonb(v_mov));
    end if;
  end loop;

  return v_resultado;
end;
$$;

revoke all on function restaurante.registrar_inventario(jsonb) from public;
grant execute on function restaurante.registrar_inventario(jsonb) to authenticated;
