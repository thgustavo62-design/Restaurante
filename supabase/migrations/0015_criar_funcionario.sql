-- Fase 1 — Criação de funcionário (usuário real no Supabase Auth) sem expor
-- a chave secreta ao cliente.
--
-- A chave fica no Vault (criptografada em repouso); a função roda
-- SECURITY DEFINER, valida a permissão do chamador via tem_permissao(), e
-- só então chama a Admin API do GoTrue via a extensão `http`. Nenhuma rota
-- exposta via PostgREST devolve a chave — só esta função a lê internamente.

create extension if not exists http with schema extensions;

-- IMPORTANTE: o segredo em si NUNCA é commitado. Rode manualmente, fora do
-- controle de versão, direto no banco (psql ou SQL Editor do Supabase):
--
--   select vault.create_secret('<service_role_key_real>', 'service_role_key',
--     'Chave secreta do Supabase (Admin API) — usada só por public.criar_funcionario');

create or replace function public.criar_funcionario(p_nome text, p_papel public.papel_usuario, p_pin text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text;
  v_service_key text;
  v_resposta extensions.http_response;
  v_body jsonb;
  v_new_id uuid;
begin
  if not public.tem_permissao('admin.equipe.editar') then
    raise exception 'Sem permissão para criar usuários';
  end if;
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN deve ter exatamente 4 dígitos';
  end if;
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'Nome é obrigatório';
  end if;

  v_email := lower(regexp_replace(p_nome, '[^a-zA-Z0-9]', '', 'g')) || '@fogo.internal';

  select decrypted_secret into v_service_key
  from vault.decrypted_secrets
  where name = 'service_role_key';

  if v_service_key is null then
    raise exception 'Chave de serviço não configurada no Vault';
  end if;

  select * into v_resposta from extensions.http((
    'POST',
    'https://enmfjfhqqvezyaieotjb.supabase.co/auth/v1/admin/users',
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

  insert into public.usuarios (id, empresa_id, nome, papel, ativo)
  values (v_new_id, public.jwt_empresa_id(), trim(p_nome), p_papel, true);

  return v_new_id;
end;
$$;

revoke all on function public.criar_funcionario(text, public.papel_usuario, text) from public;
grant execute on function public.criar_funcionario(text, public.papel_usuario, text) to authenticated;
