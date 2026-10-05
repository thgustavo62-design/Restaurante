-- PRIORIDADE 8 — Reservas / Fila de espera (Atendimento → sub-aba
-- "Reservas e fila", dentro da tela Salão — mesmo componente da 0.11)
--
-- [DECISÃO DE DESIGN] Reserva e fila de espera viram tabelas separadas
-- (em vez de uma tabela só com "tipo") porque os status são diferentes
-- de verdade (reserva tem CONFIRMADA/NAO_VEIO, fila tem CHAMADO/DESISTIU)
-- e reserva tem data_hora agendada enquanto fila é só ordem de chegada —
-- forçar as duas num scheema só ia deixar várias colunas sempre nulas
-- dependendo do tipo.
--
-- Reservas e fila de hoje/futuras são carregadas direto em carregarTudo
-- (não são "comandas/itens completos" que a regra de agregação no banco
-- proíbe baixar — são listas pequenas, do tamanho de fornecedores/
-- categorias, que já são carregadas assim) porque o mapa de mesas
-- (sub-aba "Mapa", a mesma tela) precisa saber quem está reservado pras
-- próximas 2h mesmo sem a sub-aba "Reservas e fila" nunca ter sido
-- aberta.
--
-- "Sentar" (de reserva ou da fila) sempre cria a comanda pela MESMA
-- régua de abrirComanda (client) — tipo MESA, status ABERTA, taxa de
-- serviço ativa — só que aqui, servidor, com dia_operacional calculado
-- com timezone (empresas.timezone + virada_dia_operacional_hora, mesmo
-- padrão de central_do_dono/abrir_checklist_pre_preparo), não o default
-- current_date (UTC) da coluna.

create table restaurante.reservas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  nome text not null,
  telefone text,
  pessoas int not null check (pessoas > 0),
  data_hora timestamptz not null,
  observacao text,
  mesa_sugerida_id uuid references restaurante.mesas(id) on delete set null,
  status text not null default 'AGUARDANDO' check (status in ('AGUARDANDO','CONFIRMADA','SENTADO','NAO_VEIO')),
  cliente_id uuid references restaurante.clientes(id) on delete set null,
  comanda_id uuid references restaurante.comandas(id) on delete set null,
  usuario_id uuid references restaurante.usuarios(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_reservas_empresa_data on restaurante.reservas (empresa_id, data_hora);

alter table restaurante.reservas enable row level security;
create policy reservas_select on restaurante.reservas for select
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('atendimento.salao.ver'));
-- sem policy de insert/update — só pelas RPCs abaixo.

create table restaurante.fila_espera (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  nome text not null,
  telefone text,
  pessoas int not null check (pessoas > 0),
  status text not null default 'AGUARDANDO' check (status in ('AGUARDANDO','CHAMADO','SENTADO','DESISTIU')),
  mesa_sugerida_id uuid references restaurante.mesas(id) on delete set null,
  cliente_id uuid references restaurante.clientes(id) on delete set null,
  comanda_id uuid references restaurante.comandas(id) on delete set null,
  usuario_id uuid references restaurante.usuarios(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_fila_espera_empresa on restaurante.fila_espera (empresa_id, status, created_at);

alter table restaurante.fila_espera enable row level security;
create policy fila_espera_select on restaurante.fila_espera for select
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('atendimento.salao.ver'));
-- sem policy de insert/update — só pelas RPCs abaixo.

-- ========================================================================
-- Reservas
-- ========================================================================
create or replace function restaurante.criar_reserva(p_nome text, p_telefone text, p_pessoas int, p_data_hora timestamptz, p_observacao text default null, p_mesa_sugerida_id uuid default null)
returns restaurante.reservas
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_row restaurante.reservas%rowtype;
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if not restaurante.tem_permissao('atendimento.comanda.abrir') then
    raise exception 'Sem permissão para criar reserva';
  end if;
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'Nome é obrigatório';
  end if;
  if not (p_pessoas > 0) then
    raise exception 'Número de pessoas inválido';
  end if;
  if p_mesa_sugerida_id is not null and not exists(
    select 1 from restaurante.mesas where id = p_mesa_sugerida_id and empresa_id = v_empresa_id
  ) then
    raise exception 'Mesa sugerida não encontrada';
  end if;

  insert into restaurante.reservas (empresa_id, nome, telefone, pessoas, data_hora, observacao, mesa_sugerida_id, usuario_id)
  values (v_empresa_id, trim(p_nome), p_telefone, p_pessoas, p_data_hora, p_observacao, p_mesa_sugerida_id, v_usuario_id)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function restaurante.criar_reserva(text, text, int, timestamptz, text, uuid) from public;
grant execute on function restaurante.criar_reserva(text, text, int, timestamptz, text, uuid) to authenticated;

create or replace function restaurante.atualizar_status_reserva(p_reserva_id uuid, p_status text)
returns restaurante.reservas
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_row restaurante.reservas%rowtype;
begin
  if not restaurante.tem_permissao('atendimento.comanda.abrir') then
    raise exception 'Sem permissão para atualizar reserva';
  end if;
  if p_status not in ('AGUARDANDO','CONFIRMADA','NAO_VEIO') then
    raise exception 'Status inválido (use sentar_reserva pra marcar como sentado)';
  end if;

  update restaurante.reservas set status = p_status
    where id = p_reserva_id and empresa_id = v_empresa_id and status <> 'SENTADO'
    returning * into v_row;
  if not found then
    raise exception 'Reserva não encontrada ou já sentada';
  end if;

  return v_row;
end;
$$;

revoke all on function restaurante.atualizar_status_reserva(uuid, text) from public;
grant execute on function restaurante.atualizar_status_reserva(uuid, text) to authenticated;

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
  select * into v_mesa from restaurante.mesas where id = p_mesa_id and empresa_id = v_empresa_id;
  if not found then
    raise exception 'Mesa não encontrada';
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

revoke all on function restaurante.sentar_reserva(uuid, uuid, uuid) from public;
grant execute on function restaurante.sentar_reserva(uuid, uuid, uuid) to authenticated;

-- ========================================================================
-- Fila de espera
-- ========================================================================
create or replace function restaurante.entrar_fila(p_nome text, p_telefone text, p_pessoas int)
returns restaurante.fila_espera
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_row restaurante.fila_espera%rowtype;
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if not restaurante.tem_permissao('atendimento.comanda.abrir') then
    raise exception 'Sem permissão para colocar na fila';
  end if;
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'Nome é obrigatório';
  end if;
  if not (p_pessoas > 0) then
    raise exception 'Número de pessoas inválido';
  end if;

  insert into restaurante.fila_espera (empresa_id, nome, telefone, pessoas, usuario_id)
  values (v_empresa_id, trim(p_nome), p_telefone, p_pessoas, v_usuario_id)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function restaurante.entrar_fila(text, text, int) from public;
grant execute on function restaurante.entrar_fila(text, text, int) to authenticated;

create or replace function restaurante.atualizar_status_fila(p_fila_id uuid, p_status text)
returns restaurante.fila_espera
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_row restaurante.fila_espera%rowtype;
begin
  if not restaurante.tem_permissao('atendimento.comanda.abrir') then
    raise exception 'Sem permissão para atualizar a fila';
  end if;
  if p_status not in ('AGUARDANDO','CHAMADO','DESISTIU') then
    raise exception 'Status inválido (use sentar_fila pra marcar como sentado)';
  end if;

  update restaurante.fila_espera set status = p_status
    where id = p_fila_id and empresa_id = v_empresa_id and status <> 'SENTADO'
    returning * into v_row;
  if not found then
    raise exception 'Entrada da fila não encontrada ou já sentada';
  end if;

  return v_row;
end;
$$;

revoke all on function restaurante.atualizar_status_fila(uuid, text) from public;
grant execute on function restaurante.atualizar_status_fila(uuid, text) to authenticated;

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
  select * into v_mesa from restaurante.mesas where id = p_mesa_id and empresa_id = v_empresa_id;
  if not found then
    raise exception 'Mesa não encontrada';
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

revoke all on function restaurante.sentar_fila(uuid, uuid, uuid) from public;
grant execute on function restaurante.sentar_fila(uuid, uuid, uuid) to authenticated;

-- fila com posição e tempo estimado (pelo tempo médio de ocupação das
-- últimas 50 mesas fechadas) — só leitura agregada, nenhuma soma no
-- navegador.
create or replace function restaurante.listar_fila_espera()
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_tempo_medio_min numeric;
  v_total_mesas int;
  v_resultado jsonb;
begin
  if not restaurante.tem_permissao('atendimento.salao.ver') then
    raise exception 'Sem permissão para ver a fila de espera';
  end if;

  select coalesce(avg(t.minutos), 60) into v_tempo_medio_min
  from (
    select extract(epoch from (fechamento - abertura)) / 60.0 as minutos
    from restaurante.comandas
    where empresa_id = v_empresa_id and tipo = 'MESA' and status = 'PAGA' and fechamento is not null
    order by fechamento desc limit 50
  ) t;
  select count(*) into v_total_mesas from restaurante.mesas where empresa_id = v_empresa_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'nome', f.nome, 'telefone', f.telefone, 'pessoas', f.pessoas, 'status', f.status,
      'created_at', f.created_at, 'posicao', f.posicao,
      'tempo_estimado_min', round(v_tempo_medio_min * f.posicao / greatest(v_total_mesas,1))
    ) order by f.posicao), '[]'::jsonb) into v_resultado
  from (
    select id, nome, telefone, pessoas, status, created_at,
      row_number() over (order by created_at) as posicao
    from restaurante.fila_espera
    where empresa_id = v_empresa_id and status in ('AGUARDANDO','CHAMADO')
  ) f;

  return coalesce(v_resultado, '[]'::jsonb);
end;
$$;

revoke all on function restaurante.listar_fila_espera() from public;
grant execute on function restaurante.listar_fila_espera() to authenticated;
