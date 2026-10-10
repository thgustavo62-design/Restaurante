-- VF-007 do plano de auditoria (docs/PLANO_DE_MELHORIAS.md) — impede duas
-- comandas ativas na mesma mesa.
--
-- [ACHADO CONFIRMADO NO BANCO DE PRODUÇÃO] não existia nenhuma trava:
--   - sentar_reserva / sentar_fila NÃO checavam se a mesa estava ocupada
--     (nem de forma não-transacional) — bastava sentar duas reservas na
--     mesma mesa, ou sentar uma reserva numa mesa com comanda aberta.
--   - sentar_reserva aceitava reserva NAO_VEIO; sentar_fila aceitava
--     entrada DESISTIU.
--   - abrirComanda() (client) faz INSERT direto: duas pessoas tocando na
--     mesma mesa livre ao mesmo tempo criavam duas comandas.
--   - transferir_comanda checava `count(*)` da mesa destino sem travar
--     nada — duas transferências simultâneas passavam as duas.
--
-- Correção em duas camadas:
--   1. INVARIANTE NO BANCO: índice único parcial — no máximo UMA comanda
--      tipo MESA em ABERTA/FECHANDO por mesa_id. É a rede de segurança que
--      vale pra qualquer caminho (RPC, INSERT direto, corrida entre
--      transações): a segunda recebe unique_violation, sem comanda duplicada.
--      Não atrapalha juntar_comandas (mescla os itens e fecha a origem) nem
--      pagamento parcial (continua a mesma comanda).
--   2. MENSAGEM CLARA nas RPCs: sentar_* e transferir_comanda travam a
--      linha da mesa (FOR UPDATE) antes de checar ocupação — serializa quem
--      disputa a mesma mesa e devolve "Mesa já está ocupada" em vez do erro
--      cru de índice.
--
-- Dados existentes conferidos antes: zero mesas com mais de uma comanda
-- ativa, então o índice entra sem precisar limpar nada.

create unique index if not exists comandas_mesa_ativa_uk
  on restaurante.comandas (mesa_id)
  where tipo = 'MESA' and mesa_id is not null and status in ('ABERTA', 'FECHANDO');

-- ========================================================================
-- sentar_reserva — trava a mesa, recusa mesa ocupada e reserva que não
-- está AGUARDANDO/CONFIRMADA (NAO_VEIO, SENTADO...).
-- ========================================================================
create or replace function restaurante.sentar_reserva(p_reserva_id uuid, p_mesa_id uuid, p_cliente_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_reserva restaurante.reservas%rowtype;
  v_mesa restaurante.mesas%rowtype;
  v_tz text; v_virada int; v_agora_local timestamp; v_dia date;
  v_comanda restaurante.comandas%rowtype;
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if not restaurante.tem_permissao('atendimento.comanda.abrir') then
    raise exception 'Sem permissão para sentar reserva';
  end if;

  select * into v_reserva from restaurante.reservas where id = p_reserva_id and empresa_id = v_empresa_id for update;
  if not found then
    raise exception 'Reserva não encontrada';
  end if;
  if v_reserva.status = 'SENTADO' then
    raise exception 'Reserva já foi sentada';
  end if;
  if v_reserva.status not in ('AGUARDANDO', 'CONFIRMADA') then
    raise exception 'Reserva com status % não pode ser sentada', v_reserva.status;
  end if;

  select * into v_mesa from restaurante.mesas where id = p_mesa_id and empresa_id = v_empresa_id for update;
  if not found then
    raise exception 'Mesa não encontrada';
  end if;
  if exists (
    select 1 from restaurante.comandas
    where mesa_id = p_mesa_id and tipo = 'MESA' and status in ('ABERTA', 'FECHANDO')
  ) then
    raise exception 'Mesa % já está ocupada', v_mesa.numero;
  end if;

  if p_cliente_id is not null and not exists(
    select 1 from restaurante.clientes where id = p_cliente_id and empresa_id = v_empresa_id
  ) then
    raise exception 'Cliente não encontrado';
  end if;

  select timezone, virada_dia_operacional_hora into v_tz, v_virada from restaurante.empresas where id = v_empresa_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo'); v_virada := coalesce(v_virada, 5);
  v_agora_local := now() at time zone v_tz;
  v_dia := (v_agora_local - ((v_virada)::text || ' hours')::interval)::date;

  insert into restaurante.comandas (empresa_id, codigo, mesa_id, tipo, status, usuario_abertura, taxa_servico_ativa, dia_operacional, cliente_id)
  values (v_empresa_id, 'R' || substr(replace(gen_random_uuid()::text,'-',''),1,8), p_mesa_id, 'MESA', 'ABERTA', v_usuario_id, true, v_dia, p_cliente_id)
  returning * into v_comanda;

  update restaurante.reservas set status = 'SENTADO', comanda_id = v_comanda.id, cliente_id = coalesce(p_cliente_id, cliente_id)
    where id = p_reserva_id
    returning * into v_reserva;

  return jsonb_build_object('reserva', to_jsonb(v_reserva), 'comanda', to_jsonb(v_comanda));
end;
$$;

-- ========================================================================
-- sentar_fila — mesma lógica: trava a mesa, recusa ocupada, recusa
-- entrada que não está AGUARDANDO/CHAMADO (DESISTIU, SENTADO).
-- ========================================================================
create or replace function restaurante.sentar_fila(p_fila_id uuid, p_mesa_id uuid, p_cliente_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_fila restaurante.fila_espera%rowtype;
  v_mesa restaurante.mesas%rowtype;
  v_tz text; v_virada int; v_agora_local timestamp; v_dia date;
  v_comanda restaurante.comandas%rowtype;
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if not restaurante.tem_permissao('atendimento.comanda.abrir') then
    raise exception 'Sem permissão para sentar da fila';
  end if;

  select * into v_fila from restaurante.fila_espera where id = p_fila_id and empresa_id = v_empresa_id for update;
  if not found then
    raise exception 'Entrada da fila não encontrada';
  end if;
  if v_fila.status = 'SENTADO' then
    raise exception 'Já foi sentado';
  end if;
  if v_fila.status not in ('AGUARDANDO', 'CHAMADO') then
    raise exception 'Entrada da fila com status % não pode ser sentada', v_fila.status;
  end if;

  select * into v_mesa from restaurante.mesas where id = p_mesa_id and empresa_id = v_empresa_id for update;
  if not found then
    raise exception 'Mesa não encontrada';
  end if;
  if exists (
    select 1 from restaurante.comandas
    where mesa_id = p_mesa_id and tipo = 'MESA' and status in ('ABERTA', 'FECHANDO')
  ) then
    raise exception 'Mesa % já está ocupada', v_mesa.numero;
  end if;

  if p_cliente_id is not null and not exists(
    select 1 from restaurante.clientes where id = p_cliente_id and empresa_id = v_empresa_id
  ) then
    raise exception 'Cliente não encontrado';
  end if;

  select timezone, virada_dia_operacional_hora into v_tz, v_virada from restaurante.empresas where id = v_empresa_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo'); v_virada := coalesce(v_virada, 5);
  v_agora_local := now() at time zone v_tz;
  v_dia := (v_agora_local - ((v_virada)::text || ' hours')::interval)::date;

  insert into restaurante.comandas (empresa_id, codigo, mesa_id, tipo, status, usuario_abertura, taxa_servico_ativa, dia_operacional, cliente_id)
  values (v_empresa_id, 'F' || substr(replace(gen_random_uuid()::text,'-',''),1,8), p_mesa_id, 'MESA', 'ABERTA', v_usuario_id, true, v_dia, p_cliente_id)
  returning * into v_comanda;

  update restaurante.fila_espera set status = 'SENTADO', comanda_id = v_comanda.id, cliente_id = coalesce(p_cliente_id, cliente_id)
    where id = p_fila_id
    returning * into v_fila;

  return jsonb_build_object('fila', to_jsonb(v_fila), 'comanda', to_jsonb(v_comanda));
end;
$$;

-- ========================================================================
-- transferir_comanda — trava a mesa destino antes de checar ocupação (a
-- checagem antiga era um count(*) sem lock). Resto idêntico à 0048.
-- ========================================================================
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
    where id = p_mesa_destino_id and empresa_id = v_empresa_id for update;
  if not found then
    raise exception 'Mesa de destino não encontrada';
  end if;
  if v_mesa_destino.id = v_comanda.mesa_id then
    raise exception 'Escolha uma mesa diferente da atual';
  end if;

  select count(*) into v_ocupada from restaurante.comandas
    where mesa_id = p_mesa_destino_id and tipo = 'MESA' and status in ('ABERTA','FECHANDO');
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
