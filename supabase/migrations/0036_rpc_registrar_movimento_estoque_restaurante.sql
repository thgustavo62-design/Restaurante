-- Mesma corrida de confirmar_pagamento existia na entrada/saída manual de
-- estoque (tela Estoque): o client lia estoque_atual, calculava o novo
-- valor e escrevia de volta — duas movimentações do mesmo insumo em
-- terminais diferentes ao mesmo tempo perdiam uma das baixas. Vira um
-- UPDATE atômico no Postgres.

create or replace function restaurante.registrar_movimento_estoque(
  p_insumo_id uuid, p_tipo text, p_quantidade numeric, p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_insumo restaurante.insumos%rowtype;
  v_mov restaurante.estoque_movimentos%rowtype;
  v_delta numeric;
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if not restaurante.tem_permissao('admin.estoque.editar') then
    raise exception 'Sem permissão para movimentar estoque';
  end if;
  if p_tipo not in ('ENTRADA','SAIDA') then
    raise exception 'Tipo inválido';
  end if;
  if not (p_quantidade > 0) then
    raise exception 'Quantidade deve ser maior que zero';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Motivo é obrigatório';
  end if;

  v_delta := case when p_tipo = 'ENTRADA' then p_quantidade else -p_quantidade end;

  update restaurante.insumos
    set estoque_atual = greatest(0, estoque_atual + v_delta)
    where id = p_insumo_id and empresa_id = v_empresa_id
    returning * into v_insumo;
  if not found then
    raise exception 'Insumo não encontrado';
  end if;

  insert into restaurante.estoque_movimentos
    (empresa_id, insumo_id, tipo, quantidade, motivo, origem, usuario_id)
  values (v_empresa_id, p_insumo_id, p_tipo, p_quantidade, trim(p_motivo), 'MANUAL', v_usuario_id)
  returning * into v_mov;

  return jsonb_build_object('insumo', to_jsonb(v_insumo), 'movimento', to_jsonb(v_mov));
end;
$$;

revoke all on function restaurante.registrar_movimento_estoque(uuid, text, numeric, text) from public;
grant execute on function restaurante.registrar_movimento_estoque(uuid, text, numeric, text) to authenticated;
