-- Fase 0.3 — Autorização de supervisor no servidor.
--
-- Hoje (client): verificarSupervisor() testa o PIN digitado contra TODOS os
-- usuários com a permissão necessária (um por um, via signInWithPassword no
-- navegador), e a gravação final acontece com a sessão de quem está
-- logado — que o trigger 0038 bloqueia, porque GARCOM/CAIXA nunca têm
-- item.cancelar/desconto.aplicar no MATRIZ. Ou seja: hoje GARCOM/CAIXA
-- literalmente não conseguem cancelar item nem aplicar desconto, e testar
-- um PIN contra várias contas de uma vez é ruim (amplifica a superfície de
-- força-bruta e torna possível descobrir de quem é o PIN por eliminação).
--
-- Daqui pra frente: o garçom escolhe UM supervisor (não testamos todos) e
-- a verificação do PIN + a escrita acontecem atomicamente dentro da RPC,
-- com auditoria de quem pediu e quem aprovou.

create table if not exists restaurante.tentativas_autorizacao (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  supervisor_id uuid not null references restaurante.usuarios(id) on delete cascade,
  sucesso boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_tentativas_autorizacao_supervisor
  on restaurante.tentativas_autorizacao (supervisor_id, created_at desc);

alter table restaurante.tentativas_autorizacao enable row level security;
-- Nenhuma policy pro client (nem SELECT) — só a função abaixo (SECURITY
-- DEFINER) lê/grava aqui.

-- ---------- verificação de PIN (função privada, não exposta via API) ----------

create or replace function restaurante.verificar_pin_supervisor(p_supervisor_id uuid, p_pin text, p_permissao text)
returns restaurante.usuarios
language plpgsql
security definer
set search_path = restaurante, extensions, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_supervisor restaurante.usuarios%rowtype;
  v_falhas int;
  v_email text;
  v_resposta extensions.http_response;
  v_body jsonb;
  v_access_token text;
  v_ok boolean := false;
begin
  select * into v_supervisor from restaurante.usuarios
    where id = p_supervisor_id and empresa_id = v_empresa_id and ativo = true;
  if not found then
    raise exception 'Supervisor não encontrado';
  end if;

  if not exists (
    select 1 from restaurante.papeis_permissoes
    where papel = v_supervisor.papel and permissao = p_permissao
  ) then
    raise exception 'Usuário selecionado não tem essa permissão';
  end if;

  select count(*) into v_falhas from restaurante.tentativas_autorizacao
    where supervisor_id = p_supervisor_id and sucesso = false
      and created_at > now() - interval '5 minutes';
  if v_falhas >= 5 then
    raise exception 'Muitas tentativas de PIN para este supervisor — aguarde alguns minutos';
  end if;

  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN inválido';
  end if;

  v_email := lower(regexp_replace(v_supervisor.nome, '[^a-zA-Z0-9]', '', 'g')) || '@fogo.internal';

  -- login por senha usa a chave pública (publishable key) — a mesma que o
  -- front já usa, não a service_role_key. Mesmo mecanismo de verificação
  -- do Supabase Auth que o client usava, só que dentro da transação.
  select * into v_resposta from extensions.http((
    'POST',
    'https://ybsyhjqtwiwomtxbloyu.supabase.co/auth/v1/token?grant_type=password',
    ARRAY[
      extensions.http_header('apikey', 'sb_publishable_35oPPu0kJ7Da0LtintHzOw_MO_n1oN3'),
      extensions.http_header('Content-Type', 'application/json')
    ],
    'application/json',
    jsonb_build_object('email', v_email, 'password', p_pin)::text
  )::extensions.http_request);

  v_body := v_resposta.content::jsonb;
  v_access_token := v_body->>'access_token';
  v_ok := v_resposta.status = 200 and v_access_token is not null;

  insert into restaurante.tentativas_autorizacao (empresa_id, supervisor_id, sucesso)
  values (v_empresa_id, p_supervisor_id, v_ok);

  if not v_ok then
    raise exception 'PIN inválido para o supervisor selecionado';
  end if;

  -- encerra a sessão que acabou de ser criada no GoTrue — não precisamos
  -- dela, só confirmamos a senha.
  perform extensions.http((
    'POST',
    'https://ybsyhjqtwiwomtxbloyu.supabase.co/auth/v1/logout',
    ARRAY[
      extensions.http_header('apikey', 'sb_publishable_35oPPu0kJ7Da0LtintHzOw_MO_n1oN3'),
      extensions.http_header('Authorization', 'Bearer ' || v_access_token)
    ],
    'application/json',
    '{}'
  )::extensions.http_request);

  return v_supervisor;
end;
$$;

-- Propositalmente SEM grant pra authenticated/anon — só é chamável de
-- dentro de outra função SECURITY DEFINER deste schema (dono da função
-- tem execute implícito nos seus próprios objetos). Não vira endpoint de
-- API pública.
revoke all on function restaurante.verificar_pin_supervisor(uuid, text, text) from public;

-- ---------- bypass controlado nos triggers de 0038 ----------
-- As RPCs abaixo (cancelar_item, aplicar_desconto) já validam a permissão
-- do SUPERVISOR explicitamente antes de escrever — não faz sentido o
-- trigger 0038 barrar de novo checando a permissão de quem está LOGADO
-- (o garçom). set_config(..., true) é local à transação da própria
-- chamada da RPC e não é alcançável por SQL arbitrário do client
-- (PostgREST só expõe CRUD de tabela sob RLS e RPCs com grant explícito).

create or replace function restaurante.trg_comandas_protege_colunas()
returns trigger
language plpgsql
set search_path = restaurante, pg_temp
as $$
begin
  if current_setting('restaurante.bypass_protecao', true) = 'true' then
    return new;
  end if;

  if new.desconto_centavos is distinct from old.desconto_centavos
     and not restaurante.tem_permissao('atendimento.comanda.desconto.aplicar') then
    raise exception 'Sem permissão para alterar o desconto da comanda';
  end if;

  if (new.mesa_id is distinct from old.mesa_id or new.tipo is distinct from old.tipo)
     and not restaurante.tem_permissao('atendimento.comanda.transferir') then
    raise exception 'Sem permissão para transferir a comanda';
  end if;

  if new.empresa_id is distinct from old.empresa_id
     or new.codigo is distinct from old.codigo
     or new.usuario_abertura is distinct from old.usuario_abertura
     or new.abertura is distinct from old.abertura then
    raise exception 'Campo somente leitura da comanda não pode ser alterado';
  end if;

  return new;
end;
$$;

create or replace function restaurante.trg_comanda_itens_protege_colunas()
returns trigger
language plpgsql
set search_path = restaurante, pg_temp
as $$
begin
  if current_setting('restaurante.bypass_protecao', true) = 'true' then
    return new;
  end if;

  if new.status = 'CANCELADO' and old.status <> 'CANCELADO' then
    if not restaurante.tem_permissao('atendimento.comanda.item.cancelar') then
      raise exception 'Sem permissão para cancelar item';
    end if;
    if coalesce(trim(new.motivo_cancelamento), '') = '' then
      raise exception 'Motivo do cancelamento é obrigatório';
    end if;
  end if;

  if new.comanda_id is distinct from old.comanda_id
     and not restaurante.tem_permissao('atendimento.comanda.transferir') then
    raise exception 'Sem permissão para transferir item entre comandas';
  end if;

  if new.produto_id is distinct from old.produto_id
     or new.nome is distinct from old.nome
     or new.preco_unit_centavos is distinct from old.preco_unit_centavos
     or new.quantidade is distinct from old.quantidade then
    raise exception 'Item lançado não pode ter produto, nome, preço ou quantidade alterados';
  end if;

  return new;
end;
$$;

-- ---------- cancelar_item ----------
-- Sempre exige supervisor (mesmo ADMIN/GERENTE) — operação sensível,
-- igual já era no fluxo antigo, nunca teve atalho de auto-aprovação.

create or replace function restaurante.cancelar_item(
  p_item_id uuid, p_motivo text, p_supervisor_id uuid, p_supervisor_pin text
)
returns restaurante.comanda_itens
language plpgsql
security definer
set search_path = restaurante, extensions, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_item restaurante.comanda_itens%rowtype;
  v_supervisor restaurante.usuarios%rowtype;
  v_ja_preparado boolean;
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Motivo é obrigatório';
  end if;

  select ci.* into v_item from restaurante.comanda_itens ci
    join restaurante.comandas c on c.id = ci.comanda_id
    where ci.id = p_item_id and c.empresa_id = v_empresa_id
    for update of ci;
  if not found then
    raise exception 'Item não encontrado';
  end if;
  if v_item.status = 'CANCELADO' then
    raise exception 'Item já está cancelado';
  end if;

  v_supervisor := restaurante.verificar_pin_supervisor(p_supervisor_id, p_supervisor_pin, 'atendimento.comanda.item.cancelar');
  v_ja_preparado := v_item.status in ('PREPARANDO','PRONTO');

  perform set_config('restaurante.bypass_protecao', 'true', true);
  update restaurante.comanda_itens
    set status = 'CANCELADO', cancelado_apos_preparo = v_ja_preparado, motivo_cancelamento = trim(p_motivo)
    where id = p_item_id
    returning * into v_item;

  insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
  values (v_empresa_id, v_usuario_id, 'comanda_itens', p_item_id, 'CANCELAR_ITEM',
    trim(p_motivo) || ' (aprovado por ' || v_supervisor.nome || ')' || (case when v_ja_preparado then ' [já em preparo]' else '' end));

  return v_item;
end;
$$;

revoke all on function restaurante.cancelar_item(uuid, text, uuid, text) from public;
grant execute on function restaurante.cancelar_item(uuid, text, uuid, text) to authenticated;

-- ---------- aplicar_desconto ----------
-- Mantém o atalho de hoje: quem já tem desconto.aplicar (ADMIN/GERENTE)
-- não precisa de supervisor se o percentual estiver dentro do limite
-- configurado. Acima do limite, ou sem a permissão (GARCOM/CAIXA), exige
-- supervisor — mesma regra de negócio de antes, só que validada no banco.

create or replace function restaurante.aplicar_desconto(
  p_comanda_id uuid, p_percentual numeric, p_supervisor_id uuid default null, p_supervisor_pin text default null
)
returns restaurante.comandas
language plpgsql
security definer
set search_path = restaurante, extensions, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_comanda restaurante.comandas%rowtype;
  v_empresa restaurante.empresas%rowtype;
  v_supervisor restaurante.usuarios%rowtype;
  v_aprovador_nome text;
  v_subtotal int;
  v_desconto_centavos int;
  v_limite numeric;
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if not (p_percentual > 0 and p_percentual <= 100) then
    raise exception 'Percentual de desconto inválido';
  end if;

  select * into v_comanda from restaurante.comandas
    where id = p_comanda_id and empresa_id = v_empresa_id and status = 'ABERTA'
    for update;
  if not found then
    raise exception 'Comanda não encontrada ou não está aberta';
  end if;

  select * into v_empresa from restaurante.empresas where id = v_empresa_id;
  v_limite := coalesce((v_empresa.config->>'limiteDescontoPct')::numeric, 10);

  if restaurante.tem_permissao('atendimento.comanda.desconto.aplicar') and p_percentual <= v_limite then
    v_aprovador_nome := null;
  else
    if p_supervisor_id is null or coalesce(trim(p_supervisor_pin), '') = '' then
      raise exception 'Desconto acima do limite (ou sem permissão) exige autorização de supervisor';
    end if;
    v_supervisor := restaurante.verificar_pin_supervisor(p_supervisor_id, p_supervisor_pin, 'atendimento.comanda.desconto.aplicar');
    v_aprovador_nome := v_supervisor.nome;
  end if;

  select coalesce(sum(preco_unit_centavos * quantidade), 0)::int into v_subtotal
    from restaurante.comanda_itens
    where comanda_id = p_comanda_id and status <> 'CANCELADO';
  v_desconto_centavos := round(v_subtotal * p_percentual / 100.0)::int;

  perform set_config('restaurante.bypass_protecao', 'true', true);
  update restaurante.comandas set desconto_centavos = v_desconto_centavos
    where id = p_comanda_id
    returning * into v_comanda;

  if v_aprovador_nome is not null then
    insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
    values (v_empresa_id, v_usuario_id, 'comandas', p_comanda_id, 'DESCONTO_ACIMA_LIMITE',
      p_percentual::text || '% aprovado por ' || v_aprovador_nome);
  end if;

  return v_comanda;
end;
$$;

revoke all on function restaurante.aplicar_desconto(uuid, numeric, uuid, text) from public;
grant execute on function restaurante.aplicar_desconto(uuid, numeric, uuid, text) to authenticated;
