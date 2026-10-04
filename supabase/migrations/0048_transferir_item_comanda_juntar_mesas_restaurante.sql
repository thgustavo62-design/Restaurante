-- Fase 1.1 — Transferir item, transferir comanda de mesa e juntar mesas.
--
-- Os triggers de proteção de coluna (0038) já exigem
-- atendimento.comanda.transferir pra mudar comanda_itens.comanda_id e
-- comandas.mesa_id/tipo — a trava real já existia desde a Fase 0, só não
-- tinha RPC nem tela. Estas RPCs fazem cada operação numa transação só
-- (valida, move, grava venda_movimentacoes com o rótulo origem/destino e
-- auditoria) em vez do client escrever direto nas tabelas.

create or replace function restaurante.rotulo_comanda(p_comanda_id uuid)
returns text
language sql
stable
set search_path = restaurante, pg_temp
as $$
  select case
    when c.tipo = 'BALCAO' then 'Balcão'
    when c.tipo = 'FICHA' then 'Ficha ' || c.ficha_numero::text
    else 'Mesa ' || coalesce(m.numero::text, '?')
  end
  from restaurante.comandas c
  left join restaurante.mesas m on m.id = c.mesa_id
  where c.id = p_comanda_id;
$$;

-- venda_movimentacoes só gravada pelas RPCs daqui pra frente — a policy de
-- insert direto do client exigia .fechar/.abrir, nunca cobriu
-- atendimento.comanda.transferir mesmo, então nunca deu pra gravar certo
-- pelo client. Mesma lógica de "trava real no Postgres" já aplicada à
-- auditoria em 0047.
drop policy if exists venda_movimentacoes_insert on restaurante.venda_movimentacoes;

-- ---------- transferir um item pra outra comanda aberta ----------

create or replace function restaurante.transferir_item(p_item_id uuid, p_comanda_destino_id uuid)
returns void
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_item restaurante.comanda_itens%rowtype;
  v_origem restaurante.comandas%rowtype;
  v_destino restaurante.comandas%rowtype;
begin
  if not restaurante.tem_permissao('atendimento.comanda.transferir') then
    raise exception 'Sem permissão para transferir item';
  end if;

  select * into v_item from restaurante.comanda_itens where id = p_item_id for update;
  if not found then
    raise exception 'Item não encontrado';
  end if;
  if v_item.status = 'CANCELADO' then
    raise exception 'Item cancelado não pode ser transferido';
  end if;

  select * into v_origem from restaurante.comandas
    where id = v_item.comanda_id and empresa_id = v_empresa_id for update;
  if not found then
    raise exception 'Comanda de origem não encontrada';
  end if;

  select * into v_destino from restaurante.comandas
    where id = p_comanda_destino_id and empresa_id = v_empresa_id for update;
  if not found then
    raise exception 'Comanda de destino não encontrada';
  end if;
  if v_destino.id = v_origem.id then
    raise exception 'Escolha uma comanda diferente da atual';
  end if;
  if v_destino.status <> 'ABERTA' then
    raise exception 'Comanda de destino precisa estar aberta';
  end if;

  update restaurante.comanda_itens set comanda_id = p_comanda_destino_id where id = p_item_id;

  insert into restaurante.venda_movimentacoes (empresa_id, venda_id, tipo, origem, destino, usuario_id)
  values (v_empresa_id, v_destino.id, 'TRANSFERENCIA',
    restaurante.rotulo_comanda(v_origem.id), restaurante.rotulo_comanda(v_destino.id), v_usuario_id);

  insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
  values (v_empresa_id, v_usuario_id, 'comanda_item', p_item_id, 'ITEM_TRANSFERIDO',
    v_item.nome || ': ' || restaurante.rotulo_comanda(v_origem.id) || ' -> ' || restaurante.rotulo_comanda(v_destino.id));
end;
$$;

revoke all on function restaurante.transferir_item(uuid, uuid) from public;
grant execute on function restaurante.transferir_item(uuid, uuid) to authenticated;

-- ---------- transferir a comanda inteira pra outra mesa ----------

create or replace function restaurante.transferir_comanda(p_comanda_id uuid, p_mesa_destino_id uuid)
returns void
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_comanda restaurante.comandas%rowtype;
  v_mesa_destino restaurante.mesas%rowtype;
  v_rotulo_origem text;
  v_ocupada int;
begin
  if not restaurante.tem_permissao('atendimento.comanda.transferir') then
    raise exception 'Sem permissão para transferir comanda';
  end if;

  select * into v_comanda from restaurante.comandas
    where id = p_comanda_id and empresa_id = v_empresa_id for update;
  if not found then
    raise exception 'Comanda não encontrada';
  end if;
  if v_comanda.tipo <> 'MESA' then
    raise exception 'Só comanda de mesa pode ser transferida de mesa';
  end if;
  if v_comanda.status <> 'ABERTA' then
    raise exception 'Comanda precisa estar aberta para transferir';
  end if;

  select * into v_mesa_destino from restaurante.mesas
    where id = p_mesa_destino_id and empresa_id = v_empresa_id;
  if not found then
    raise exception 'Mesa de destino não encontrada';
  end if;
  if v_mesa_destino.id = v_comanda.mesa_id then
    raise exception 'Escolha uma mesa diferente da atual';
  end if;

  select count(*) into v_ocupada from restaurante.comandas
    where mesa_id = p_mesa_destino_id and status in ('ABERTA','FECHANDO');
  if v_ocupada > 0 then
    raise exception 'Mesa de destino já está ocupada — use "Juntar mesas" se for o caso';
  end if;

  v_rotulo_origem := restaurante.rotulo_comanda(v_comanda.id);

  update restaurante.comandas set mesa_id = p_mesa_destino_id where id = p_comanda_id;

  insert into restaurante.venda_movimentacoes (empresa_id, venda_id, tipo, origem, destino, usuario_id)
  values (v_empresa_id, p_comanda_id, 'TRANSFERENCIA', v_rotulo_origem, 'Mesa ' || v_mesa_destino.numero::text, v_usuario_id);

  insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
  values (v_empresa_id, v_usuario_id, 'comanda', p_comanda_id, 'COMANDA_TRANSFERIDA',
    v_rotulo_origem || ' -> Mesa ' || v_mesa_destino.numero::text);
end;
$$;

revoke all on function restaurante.transferir_comanda(uuid, uuid) from public;
grant execute on function restaurante.transferir_comanda(uuid, uuid) to authenticated;

-- ---------- juntar duas mesas (mescla os itens numa só comanda) ----------

create or replace function restaurante.juntar_comandas(p_origem_id uuid, p_destino_id uuid)
returns void
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_origem restaurante.comandas%rowtype;
  v_destino restaurante.comandas%rowtype;
  v_rotulo_origem text;
  v_rotulo_destino text;
begin
  if not restaurante.tem_permissao('atendimento.comanda.transferir') then
    raise exception 'Sem permissão para juntar mesas';
  end if;

  select * into v_origem from restaurante.comandas
    where id = p_origem_id and empresa_id = v_empresa_id for update;
  if not found then
    raise exception 'Comanda de origem não encontrada';
  end if;
  select * into v_destino from restaurante.comandas
    where id = p_destino_id and empresa_id = v_empresa_id for update;
  if not found then
    raise exception 'Comanda de destino não encontrada';
  end if;
  if v_origem.id = v_destino.id then
    raise exception 'Escolha duas comandas diferentes';
  end if;
  if v_origem.status <> 'ABERTA' or v_destino.status <> 'ABERTA' then
    raise exception 'As duas comandas precisam estar abertas';
  end if;

  v_rotulo_origem := restaurante.rotulo_comanda(v_origem.id);
  v_rotulo_destino := restaurante.rotulo_comanda(v_destino.id);

  update restaurante.comanda_itens set comanda_id = p_destino_id where comanda_id = p_origem_id;

  update restaurante.comandas set status = 'CANCELADA', fechamento = now() where id = p_origem_id;

  insert into restaurante.venda_movimentacoes (empresa_id, venda_id, tipo, origem, destino, usuario_id)
  values (v_empresa_id, p_destino_id, 'JUNCAO', v_rotulo_origem, v_rotulo_destino, v_usuario_id);

  insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
  values (v_empresa_id, v_usuario_id, 'comanda', p_destino_id, 'MESAS_JUNTADAS',
    v_rotulo_origem || ' juntada em ' || v_rotulo_destino);
end;
$$;

revoke all on function restaurante.juntar_comandas(uuid, uuid) from public;
grant execute on function restaurante.juntar_comandas(uuid, uuid) to authenticated;
