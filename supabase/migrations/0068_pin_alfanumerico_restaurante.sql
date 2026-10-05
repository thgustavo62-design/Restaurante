-- PIN deixou de ser só numérico — agora aceita letras e números (mesmo
-- tamanho de 4 caracteres, só o conjunto de caracteres mudou). O PIN é a
-- senha real de uma conta do Supabase Auth (ver README, "PIN = senha real
-- do Supabase Auth") — a trava de "só dígito" sempre foi só a validação
-- `^[0-9]{4}$` dentro de cada RPC que cria/troca PIN, nunca uma restrição
-- do próprio Supabase Auth. Esta migration troca essa validação pra
-- `^[A-Za-z0-9]{4}$` nas 4 funções que a tinham, redefinindo cada uma por
-- inteiro (CREATE OR REPLACE) com a última versão de cada já aplicada:
--   - restaurante.criar_funcionario (0022/0044/0060/0064)
--   - restaurante.trocar_pin_funcionario (0037/0060/0064)
--   - restaurante.verificar_pin_supervisor (0043/0060)
--   - restaurante.onboarding_criar_empresa (0061)
--
-- Do lado do front, o teclado numérico (0-9) usado pra digitar o PIN de
-- supervisor (autorização de desconto/cancelamento) virou um campo de
-- texto comum — um teclado só de dígito não deixava digitar letra nenhuma.
-- A tela de login já usava um campo de texto normal, então não precisou
-- de mudança.

create or replace function restaurante.criar_funcionario(p_nome text, p_papel restaurante.papel_usuario, p_pin text)
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
  if p_pin !~ '^[A-Za-z0-9]{4}$' then
    raise exception 'PIN deve ter exatamente 4 caracteres (letras e números)';
  end if;
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'Nome é obrigatório';
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
    jsonb_build_object('email', v_email, 'password', p_pin, 'email_confirm', true)::text
  )::extensions.http_request);

  v_body := v_resposta.content::jsonb;
  v_new_id := (v_body ->> 'id')::uuid;

  if v_new_id is null then
    raise exception 'Falha ao criar usuário no Auth (status %): %', v_resposta.status, v_resposta.content;
  end if;

  insert into restaurante.usuarios (id, empresa_id, nome, papel, ativo, email_interno)
  values (v_new_id, restaurante.jwt_empresa_id(), trim(p_nome), p_papel, true, v_email);

  return v_new_id;
end;
$$;

revoke all on function restaurante.criar_funcionario(text, restaurante.papel_usuario, text) from public;
grant execute on function restaurante.criar_funcionario(text, restaurante.papel_usuario, text) to authenticated;

create or replace function restaurante.trocar_pin_funcionario(p_usuario_id uuid, p_novo_pin text)
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
begin
  if not restaurante.tem_permissao('admin.equipe.editar') then
    raise exception 'Sem permissão para alterar PIN';
  end if;
  perform restaurante.exige_aal2_se_mfa_ativo();
  if p_novo_pin !~ '^[A-Za-z0-9]{4}$' then
    raise exception 'PIN deve ter exatamente 4 caracteres (letras e números)';
  end if;

  select * into v_alvo from restaurante.usuarios
    where id = p_usuario_id and empresa_id = v_empresa_id;
  if not found then
    raise exception 'Usuário não encontrado';
  end if;

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
    jsonb_build_object('password', p_novo_pin)::text
  )::extensions.http_request);

  if v_resposta.status <> 200 then
    raise exception 'Falha ao trocar PIN (status %): %', v_resposta.status, v_resposta.content;
  end if;

  insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
  values (v_empresa_id, auth.uid(), 'usuarios', p_usuario_id, 'PIN_ALTERADO', v_alvo.nome);
end;
$$;

revoke all on function restaurante.trocar_pin_funcionario(uuid, text) from public;
grant execute on function restaurante.trocar_pin_funcionario(uuid, text) to authenticated;

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
  v_project_url text;
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

  if p_pin !~ '^[A-Za-z0-9]{4}$' then
    raise exception 'PIN inválido';
  end if;

  if v_supervisor.email_interno is null then
    raise exception 'Supervisor sem e-mail de login configurado — peça pra alguém trocar o PIN dele uma vez na tela Equipe';
  end if;

  select coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'project_url'),
    'https://ybsyhjqtwiwomtxbloyu.supabase.co'
  ) into v_project_url;

  -- login por senha usa a chave pública (publishable key) — a mesma que o
  -- front já usa, não a service_role_key. Mesmo mecanismo de verificação
  -- do Supabase Auth que o client usava, só que dentro da transação.
  select * into v_resposta from extensions.http((
    'POST',
    v_project_url || '/auth/v1/token?grant_type=password',
    ARRAY[
      extensions.http_header('apikey', 'sb_publishable_35oPPu0kJ7Da0LtintHzOw_MO_n1oN3'),
      extensions.http_header('Content-Type', 'application/json')
    ],
    'application/json',
    jsonb_build_object('email', v_supervisor.email_interno, 'password', p_pin)::text
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
    v_project_url || '/auth/v1/logout',
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

revoke all on function restaurante.verificar_pin_supervisor(uuid, text, text) from public;

create or replace function restaurante.onboarding_criar_empresa(
  p_nome_empresa text,
  p_slug text,
  p_nome_admin text,
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
  if p_pin_admin !~ '^[A-Za-z0-9]{4}$' then
    raise exception 'PIN do ADMIN deve ter exatamente 4 caracteres (letras e números)';
  end if;
  if p_qtd_mesas < 1 or p_qtd_mesas > 200 then
    raise exception 'Quantidade de mesas inválida (1 a 200)';
  end if;

  insert into restaurante.empresas (nome, slug, config)
  values (trim(p_nome_empresa), v_slug, '{}'::jsonb)
  returning id into v_empresa_id;

  -- primeiro ADMIN: mesmo mecanismo de criar_funcionario (0022/0044/0060/0064)
  -- — conta real no Supabase Auth, e-mail UUID+slug estável, nunca
  -- derivado do nome.
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
    jsonb_build_object('email', v_email, 'password', p_pin_admin, 'email_confirm', true)::text
  )::extensions.http_request);

  v_body := v_resposta.content::jsonb;
  v_admin_id := (v_body ->> 'id')::uuid;
  if v_admin_id is null then
    raise exception 'Falha ao criar login do ADMIN (status %): % — empresa % NÃO foi criada, rode a função de novo depois de corrigir', v_resposta.status, v_resposta.content, v_slug;
  end if;

  insert into restaurante.usuarios (id, empresa_id, nome, papel, ativo, email_interno)
  values (v_admin_id, v_empresa_id, trim(p_nome_admin), 'ADMIN', true, v_email);

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
revoke all on function restaurante.onboarding_criar_empresa(text, text, text, text, int, text[]) from public;
