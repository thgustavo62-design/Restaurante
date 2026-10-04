-- Fase 4.2 — Onboarding de novo restaurante.
--
-- Hoje só existe o conceito de ADMIN *dentro* de uma empresa já criada —
-- não existe um "dono da plataforma" logado no app que possa criar outras
-- empresas (e não deveria existir sem repensar todo o modelo de permissão
-- multi-tenant). Por isso este onboarding é uma função chamada direto no
-- SQL Editor pelo operador da Vision Food (você), não uma tela do app —
-- mesmo jeito que você já aplica migration. Ela faz tudo que hoje seria
-- manual em 4 tabelas diferentes numa chamada só: empresa, primeiro ADMIN
-- (conta de login de verdade, mesmo mecanismo de criar_funcionario),
-- mesas numeradas e categorias iniciais.

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
  if p_pin_admin !~ '^[0-9]{4}$' then
    raise exception 'PIN do ADMIN deve ter exatamente 4 dígitos';
  end if;
  if p_qtd_mesas < 1 or p_qtd_mesas > 200 then
    raise exception 'Quantidade de mesas inválida (1 a 200)';
  end if;

  insert into restaurante.empresas (nome, slug, config)
  values (trim(p_nome_empresa), v_slug, '{}'::jsonb)
  returning id into v_empresa_id;

  -- primeiro ADMIN: mesmo mecanismo de criar_funcionario (0022/0044/0060)
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
