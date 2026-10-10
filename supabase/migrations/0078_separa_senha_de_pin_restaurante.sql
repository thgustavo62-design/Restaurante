-- VF-003 do plano de auditoria (docs/PLANO_DE_MELHORIAS.md) — separa a
-- senha de login (Supabase Auth) do PIN operacional (autorização de
-- supervisor / bater ponto). Aprovado pelo Gustavo em 10/10/2026:
-- "Separar PIN (operação) de senha (login)".
--
-- [ACHADO CONFIRMADO] até aqui, o PIN de 4 caracteres alfanuméricos ERA
-- a senha real de toda conta no Supabase Auth — login diário
-- (tentarLogin -> signInWithPassword), autorização de supervisor
-- (verificar_pin_supervisor) e bater_ponto todos validavam o mesmo PIN
-- curto contra /auth/v1/token. Combinado com VF-005 (e-mail de login
-- legível por qualquer papel, já corrigido na 0077) e o bug do contador
-- de tentativas (VF-004, já corrigido na 0075), formava uma cadeia
-- prática de escalonamento de privilégio.
--
-- Dali pra frente:
--   - Login (tentarLogin, client) continua usando signInWithPassword —
--     mecanismo IDÊNTICO, só que a senha agora é de verdade (8+
--     caracteres), nunca mais o PIN de 4.
--   - PIN de 4 caracteres continua existindo, só que vira um segredo
--     PRÓPRIO, independente da senha do Supabase Auth: hash em
--     usuarios.pin_hash (pgcrypto, mesmo algoritmo — bcrypt — que o
--     Auth já usa internamente). verificar_pin_supervisor/bater_ponto
--     passam a conferir contra esse hash, sem fazer mais nenhuma
--     chamada HTTP pro GoTrue — mais simples e mais rápido.
--   - criar_funcionario/onboarding_criar_empresa exigem os dois agora:
--     senha de acesso (Auth) + PIN operacional (hash local).
--   - trocar_pin_funcionario vira trocar_credenciais_funcionario — troca
--     senha, PIN, ou os dois, cada um opcional (pelo menos um
--     obrigatório). Continua usando a Admin API (service_role_key no
--     Vault, mesmo mecanismo já usado por criar_funcionario) só pra
--     trocar a SENHA — a troca de PIN agora é um UPDATE local, sem HTTP.
--
-- [MIGRAÇÃO SEM INTERROMPER O EXPEDIENTE] toda conta já existente tem o
-- PIN atual como senha do Auth — ninguém tem pin_hash ainda. O backfill
-- abaixo copia auth.users.encrypted_password (que já é bcrypt, mesmo
-- formato que pgcrypto produz) direto pra usuarios.pin_hash: cada
-- funcionário continua autorizando com o MESMO PIN de sempre a partir de
-- agora, sem trocar nada nem perceber a mudança — a senha de login
-- continua sendo o PIN antigo até alguém (ADMIN/GERENTE) trocar pela
-- tela Equipe. Reforça o combinado: avisar a equipe e trocar a senha de
-- cada um nos próximos dias, não precisa (nem dá, com todo mundo
-- trabalhando) fazer de uma vez só.

alter table restaurante.usuarios add column if not exists pin_hash text;
-- nunca exposta por select direto — nem o e-mail (0077) tinha esse risco,
-- aqui é o hash do PIN. Sem grant nenhum além do que já existe (0077 só
-- concedeu colunas explícitas; pin_hash fica de fora por padrão), mas
-- revoga explícito mesmo assim — intenção clara, não só omissão.
revoke select (pin_hash) on restaurante.usuarios from anon, authenticated, public;

update restaurante.usuarios u
set pin_hash = au.encrypted_password
from auth.users au
where au.id = u.id and u.pin_hash is null;

-- ========================================================================
-- criar_funcionario — agora exige p_senha (Auth, 8+ caracteres) E p_pin
-- (operacional, 4 caracteres, hash local). Mesma criação de conta via
-- Admin API de sempre, só que a senha enviada ao Auth é p_senha, não
-- mais o PIN.
-- ========================================================================
drop function if exists restaurante.criar_funcionario(text, restaurante.papel_usuario, text);

create or replace function restaurante.criar_funcionario(p_nome text, p_papel restaurante.papel_usuario, p_senha text, p_pin text)
returns uuid
language plpgsql
security definer
set search_path = restaurante, extensions, pg_temp
as $$
declare
  v_email text;
  v_slug text;
  v_service_key text;
  v_project_url text;
  v_resposta extensions.http_response;
  v_body jsonb;
  v_new_id uuid;
begin
  if not restaurante.tem_permissao('admin.equipe.editar') then
    raise exception 'Sem permissão para criar usuários';
  end if;
  perform restaurante.exige_aal2_se_mfa_ativo();
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'Nome é obrigatório';
  end if;
  if length(coalesce(p_senha, '')) < 8 then
    raise exception 'Senha de acesso deve ter pelo menos 8 caracteres';
  end if;
  if p_pin !~ '^[A-Za-z0-9]{4}$' then
    raise exception 'PIN operacional deve ter exatamente 4 caracteres (letras e números)';
  end if;
  if p_senha = p_pin then
    raise exception 'A senha de acesso não pode ser igual ao PIN operacional';
  end if;

  select slug into v_slug from restaurante.empresas where id = restaurante.jwt_empresa_id();
  if v_slug is null then
    raise exception 'Empresa sem slug configurado';
  end if;
  v_email := gen_random_uuid()::text || '@' || v_slug || '.internal';

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_service_key is null then
    raise exception 'Chave de serviço não configurada no Vault';
  end if;
  select coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'project_url'),
    'https://ybsyhjqtwiwomtxbloyu.supabase.co'
  ) into v_project_url;

  select * into v_resposta from extensions.http((
    'POST',
    v_project_url || '/auth/v1/admin/users',
    ARRAY[
      extensions.http_header('apikey', v_service_key),
      extensions.http_header('Authorization', 'Bearer ' || v_service_key),
      extensions.http_header('User-Agent', 'postgres-http/1.0')
    ],
    'application/json',
    jsonb_build_object('email', v_email, 'password', p_senha, 'email_confirm', true)::text
  )::extensions.http_request);

  v_body := v_resposta.content::jsonb;
  v_new_id := (v_body ->> 'id')::uuid;

  if v_new_id is null then
    raise exception 'Falha ao criar usuário no Auth (status %): %', v_resposta.status, v_resposta.content;
  end if;

  insert into restaurante.usuarios (id, empresa_id, nome, papel, ativo, email_interno, pin_hash)
  values (v_new_id, restaurante.jwt_empresa_id(), trim(p_nome), p_papel, true, v_email, crypt(p_pin, gen_salt('bf')));

  return v_new_id;
end;
$$;

revoke all on function restaurante.criar_funcionario(text, restaurante.papel_usuario, text, text) from public;
grant execute on function restaurante.criar_funcionario(text, restaurante.papel_usuario, text, text) to authenticated;

-- ========================================================================
-- trocar_credenciais_funcionario — substitui trocar_pin_funcionario.
-- Senha e PIN são independentes e opcionais (pelo menos um); trocar a
-- senha ainda usa a Admin API (só ela pode mudar a senha do Auth);
-- trocar o PIN é só um UPDATE local (crypt), sem HTTP nenhum.
-- ========================================================================
drop function if exists restaurante.trocar_pin_funcionario(uuid, text);

create or replace function restaurante.trocar_credenciais_funcionario(p_usuario_id uuid, p_nova_senha text default null, p_novo_pin text default null)
returns void
language plpgsql
security definer
set search_path = restaurante, extensions, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_alvo restaurante.usuarios%rowtype;
  v_service_key text;
  v_project_url text;
  v_resposta extensions.http_response;
  v_o_que_mudou text[] := '{}';
begin
  if not restaurante.tem_permissao('admin.equipe.editar') then
    raise exception 'Sem permissão para alterar credenciais';
  end if;
  perform restaurante.exige_aal2_se_mfa_ativo();
  if p_nova_senha is null and p_novo_pin is null then
    raise exception 'Informe uma senha nova, um PIN novo, ou os dois';
  end if;
  if p_nova_senha is not null and length(p_nova_senha) < 8 then
    raise exception 'Senha de acesso deve ter pelo menos 8 caracteres';
  end if;
  if p_novo_pin is not null and p_novo_pin !~ '^[A-Za-z0-9]{4}$' then
    raise exception 'PIN operacional deve ter exatamente 4 caracteres (letras e números)';
  end if;
  if p_nova_senha is not null and p_novo_pin is not null and p_nova_senha = p_novo_pin then
    raise exception 'A senha de acesso não pode ser igual ao PIN operacional';
  end if;

  select * into v_alvo from restaurante.usuarios
    where id = p_usuario_id and empresa_id = v_empresa_id;
  if not found then
    raise exception 'Usuário não encontrado';
  end if;

  if p_nova_senha is not null then
    select decrypted_secret into v_service_key
      from vault.decrypted_secrets where name = 'service_role_key';
    if v_service_key is null then
      raise exception 'Chave de serviço não configurada no Vault';
    end if;
    select coalesce(
      (select decrypted_secret from vault.decrypted_secrets where name = 'project_url'),
      'https://ybsyhjqtwiwomtxbloyu.supabase.co'
    ) into v_project_url;

    select * into v_resposta from extensions.http((
      'PUT',
      v_project_url || '/auth/v1/admin/users/' || p_usuario_id::text,
      ARRAY[
        extensions.http_header('apikey', v_service_key),
        extensions.http_header('Authorization', 'Bearer ' || v_service_key),
        extensions.http_header('User-Agent', 'postgres-http/1.0')
      ],
      'application/json',
      jsonb_build_object('password', p_nova_senha)::text
    )::extensions.http_request);

    if v_resposta.status <> 200 then
      raise exception 'Falha ao trocar a senha (status %): %', v_resposta.status, v_resposta.content;
    end if;
    v_o_que_mudou := v_o_que_mudou || 'senha de acesso';
  end if;

  if p_novo_pin is not null then
    update restaurante.usuarios set pin_hash = crypt(p_novo_pin, gen_salt('bf')) where id = p_usuario_id;
    v_o_que_mudou := v_o_que_mudou || 'PIN operacional';
  end if;

  insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
  values (v_empresa_id, auth.uid(), 'usuarios', p_usuario_id, 'CREDENCIAIS_ALTERADAS', v_alvo.nome || ' — ' || array_to_string(v_o_que_mudou, ' e '));
end;
$$;

revoke all on function restaurante.trocar_credenciais_funcionario(uuid, text, text) from public;
grant execute on function restaurante.trocar_credenciais_funcionario(uuid, text, text) to authenticated;

-- ========================================================================
-- verificar_pin_supervisor — mesma assinatura da 0075 (p_tentativa_id já
-- existia), só troca COMO o PIN é conferido: hash local (pin_hash) em
-- vez de login de verdade contra o Auth. Mais simples (sem HTTP, sem
-- vault) e já era exatamente o que devia ser desde o início — o PIN
-- nunca precisou ser uma senha de conta de verdade pra autorizar um
-- desconto.
-- ========================================================================
create or replace function restaurante.verificar_pin_supervisor(p_supervisor_id uuid, p_pin text, p_permissao text, p_tentativa_id uuid)
returns restaurante.usuarios
language plpgsql
security definer
set search_path = restaurante, extensions, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_supervisor restaurante.usuarios%rowtype;
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

  if not exists (
    select 1 from restaurante.tentativas_autorizacao
    where id = p_tentativa_id and empresa_id = v_empresa_id and supervisor_id = p_supervisor_id and sucesso = false
  ) then
    raise exception 'Tentativa de PIN inválida ou já usada — tente de novo';
  end if;

  if p_pin !~ '^[A-Za-z0-9]{4}$' then
    raise exception 'PIN inválido';
  end if;

  if v_supervisor.pin_hash is null or crypt(p_pin, v_supervisor.pin_hash) <> v_supervisor.pin_hash then
    raise exception 'PIN inválido para o supervisor selecionado';
  end if;

  update restaurante.tentativas_autorizacao set sucesso = true where id = p_tentativa_id;

  return v_supervisor;
end;
$$;

revoke all on function restaurante.verificar_pin_supervisor(uuid, text, text, uuid) from public;

-- ========================================================================
-- bater_ponto — mesma assinatura da 0075, mesma troca: hash local em vez
-- de login contra o Auth.
-- ========================================================================
create or replace function restaurante.bater_ponto(p_usuario_id uuid, p_pin text, p_tipo text, p_tentativa_id uuid)
returns restaurante.pontos
language plpgsql
security definer
set search_path = restaurante, extensions, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_logado uuid := auth.uid();
  v_funcionario restaurante.usuarios%rowtype;
  v_ponto restaurante.pontos%rowtype;
begin
  if v_usuario_logado is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if p_tipo not in ('ENTRADA','SAIDA','INICIO_INTERVALO','FIM_INTERVALO') then
    raise exception 'Tipo de ponto inválido';
  end if;

  select * into v_funcionario from restaurante.usuarios
    where id = p_usuario_id and empresa_id = v_empresa_id and ativo = true;
  if not found then
    raise exception 'Funcionário não encontrado';
  end if;

  if not exists (
    select 1 from restaurante.tentativas_autorizacao
    where id = p_tentativa_id and empresa_id = v_empresa_id and supervisor_id = p_usuario_id and sucesso = false
  ) then
    raise exception 'Tentativa de PIN inválida ou já usada — tente de novo';
  end if;

  if p_pin !~ '^[A-Za-z0-9]{4}$' then
    raise exception 'PIN inválido';
  end if;

  if v_funcionario.pin_hash is null or crypt(p_pin, v_funcionario.pin_hash) <> v_funcionario.pin_hash then
    raise exception 'PIN inválido';
  end if;

  update restaurante.tentativas_autorizacao set sucesso = true where id = p_tentativa_id;

  insert into restaurante.pontos (empresa_id, usuario_id, tipo, registrado_em)
  values (v_empresa_id, p_usuario_id, p_tipo, now())
  returning * into v_ponto;

  return v_ponto;
end;
$$;

revoke all on function restaurante.bater_ponto(uuid, text, text, uuid) from public;
grant execute on function restaurante.bater_ponto(uuid, text, text, uuid) to authenticated;

-- ========================================================================
-- onboarding_criar_empresa — ganha p_senha_admin (Auth, 8+ caracteres),
-- logo depois de p_nome_admin e antes de p_pin_admin (que continua
-- existindo, agora como PIN operacional hash local). Chamada só pelo
-- operador da plataforma no SQL Editor — sem grant pra
-- authenticated/anon, como sempre foi.
-- ========================================================================
drop function if exists restaurante.onboarding_criar_empresa(text, text, text, text, int, text[]);

create or replace function restaurante.onboarding_criar_empresa(
  p_nome_empresa text,
  p_slug text,
  p_nome_admin text,
  p_senha_admin text,
  p_pin_admin text,
  p_qtd_mesas int default 10,
  p_categorias text[] default array['Entradas','Pratos Principais','Bebidas','Sobremesas']
)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, extensions, pg_temp
as $$
declare
  v_empresa_id uuid;
  v_slug text := lower(trim(p_slug));
  v_email text;
  v_service_key text;
  v_project_url text;
  v_resposta extensions.http_response;
  v_body jsonb;
  v_admin_id uuid;
  v_categoria text;
  v_ordem int := 0;
  v_mesas_criadas int;
begin
  if coalesce(trim(p_nome_empresa), '') = '' then
    raise exception 'Nome da empresa é obrigatório';
  end if;
  if v_slug !~ '^[a-z0-9-]+$' then
    raise exception 'Slug só pode ter letras minúsculas, números e hífen';
  end if;
  if exists (select 1 from restaurante.empresas where slug = v_slug) then
    raise exception 'Já existe uma empresa com esse slug';
  end if;
  if coalesce(trim(p_nome_admin), '') = '' then
    raise exception 'Nome do primeiro ADMIN é obrigatório';
  end if;
  if length(coalesce(p_senha_admin, '')) < 8 then
    raise exception 'Senha de acesso do ADMIN deve ter pelo menos 8 caracteres';
  end if;
  if p_pin_admin !~ '^[A-Za-z0-9]{4}$' then
    raise exception 'PIN operacional do ADMIN deve ter exatamente 4 caracteres (letras e números)';
  end if;
  if p_senha_admin = p_pin_admin then
    raise exception 'A senha de acesso não pode ser igual ao PIN operacional';
  end if;
  if p_qtd_mesas < 1 or p_qtd_mesas > 200 then
    raise exception 'Quantidade de mesas inválida (1 a 200)';
  end if;

  insert into restaurante.empresas (nome, slug, config)
  values (trim(p_nome_empresa), v_slug, '{}'::jsonb)
  returning id into v_empresa_id;

  -- primeiro ADMIN: mesmo mecanismo de criar_funcionario — conta real no
  -- Supabase Auth, e-mail UUID+slug estável, nunca derivado do nome.
  v_email := gen_random_uuid()::text || '@' || v_slug || '.internal';

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_service_key is null then
    raise exception 'Chave de serviço não configurada no Vault — onboarding precisa dela pra criar o login do primeiro ADMIN';
  end if;
  select coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'project_url'),
    'https://ybsyhjqtwiwomtxbloyu.supabase.co'
  ) into v_project_url;

  select * into v_resposta from extensions.http((
    'POST',
    v_project_url || '/auth/v1/admin/users',
    ARRAY[
      extensions.http_header('apikey', v_service_key),
      extensions.http_header('Authorization', 'Bearer ' || v_service_key),
      extensions.http_header('User-Agent', 'postgres-http/1.0')
    ],
    'application/json',
    jsonb_build_object('email', v_email, 'password', p_senha_admin, 'email_confirm', true)::text
  )::extensions.http_request);

  v_body := v_resposta.content::jsonb;
  v_admin_id := (v_body ->> 'id')::uuid;
  if v_admin_id is null then
    raise exception 'Falha ao criar login do ADMIN (status %): % — empresa % NÃO foi criada, rode a função de novo depois de corrigir', v_resposta.status, v_resposta.content, v_slug;
  end if;

  insert into restaurante.usuarios (id, empresa_id, nome, papel, ativo, email_interno, pin_hash)
  values (v_admin_id, v_empresa_id, trim(p_nome_admin), 'ADMIN', true, v_email, crypt(p_pin_admin, gen_salt('bf')));

  -- mesas numeradas 1..N, área "Salão" única — o dono reorganiza depois
  -- se precisar de mais de uma área.
  insert into restaurante.mesas (empresa_id, numero, capacidade, area)
  select v_empresa_id, n, 4, 'Salão' from generate_series(1, p_qtd_mesas) n;
  get diagnostics v_mesas_criadas = row_count;

  foreach v_categoria in array p_categorias
  loop
    insert into restaurante.categorias (empresa_id, nome, ordem, ativo)
    values (v_empresa_id, v_categoria, v_ordem, true);
    v_ordem := v_ordem + 1;
  end loop;

  return jsonb_build_object(
    'empresa_id', v_empresa_id, 'slug', v_slug,
    'admin_id', v_admin_id, 'admin_email_interno', v_email,
    'mesas_criadas', v_mesas_criadas, 'categorias_criadas', v_ordem,
    'link_login', '/?r=' || v_slug, 'link_cardapio', '/cardapio/' || v_slug
  );
end;
$$;

-- Propositalmente SEM grant pra authenticated/anon — chamada só pelo
-- operador da plataforma no SQL Editor (mesmo papel que já aplica
-- migration), nunca pelo app.
revoke all on function restaurante.onboarding_criar_empresa(text, text, text, text, text, int, text[]) from public;
