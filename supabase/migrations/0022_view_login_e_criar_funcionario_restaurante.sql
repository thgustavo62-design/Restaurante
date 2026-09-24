-- View pública mínima de login e RPC de criação de funcionário, no schema
-- restaurante. Consolida 0014 e 0015 (já com o fix de SECURITY DEFINER da
-- 0013 embutido desde a criação, e a URL do projeto Supabase atualizada).

create view restaurante.usuarios_login as
select id, empresa_id, nome
from restaurante.usuarios
where ativo = true;

grant select on restaurante.usuarios_login to anon, authenticated;

create extension if not exists http with schema extensions;

-- IMPORTANTE: o segredo em si NUNCA é commitado. Rode manualmente, fora do
-- controle de versão, direto no SQL Editor do Supabase:
--
--   select vault.create_secret('<service_role_key_real>', 'service_role_key',
--     'Chave secreta do Supabase (Admin API) — usada só por restaurante.criar_funcionario');

create or replace function restaurante.criar_funcionario(p_nome text, p_papel restaurante.papel_usuario, p_pin text)
returns uuid
language plpgsql
security definer
set search_path = restaurante, extensions
as $$
declare
  v_email text;
  v_service_key text;
  v_resposta extensions.http_response;
  v_body jsonb;
  v_new_id uuid;
begin
  if not restaurante.tem_permissao('admin.equipe.editar') then
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
    'https://ybsyhjqtwiwomtxbloyu.supabase.co/auth/v1/admin/users',
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

  insert into restaurante.usuarios (id, empresa_id, nome, papel, ativo)
  values (v_new_id, restaurante.jwt_empresa_id(), trim(p_nome), p_papel, true);

  return v_new_id;
end;
$$;

revoke all on function restaurante.criar_funcionario(text, restaurante.papel_usuario, text) from public;
grant execute on function restaurante.criar_funcionario(text, restaurante.papel_usuario, text) to authenticated;
