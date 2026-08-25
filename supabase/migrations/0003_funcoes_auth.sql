-- Fase 0 — Claims de JWT e verificação de permissão
--
-- `empresa_id` e `papel` são injetados no access token via Custom Access
-- Token Hook (função abaixo), evitando subquery em `public.usuarios` a cada
-- linha avaliada pelas policies de RLS.
--
-- IMPORTANTE: registrar este hook em Auth > Hooks no painel do Supabase
-- (ou em `supabase/config.toml` no ambiente local:
--   [auth.hook.custom_access_token]
--   enabled = true
--   uri = "pg-functions://postgres/public/custom_access_token_hook"
-- ) — isso não é feito por migration SQL, é configuração do serviço de Auth.

create or replace function public.jwt_empresa_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'empresa_id', '')::uuid
$$;

create or replace function public.jwt_papel()
returns text
language sql
stable
as $$
  select current_setting('request.jwt.claims', true)::jsonb ->> 'papel'
$$;

create or replace function public.tem_permissao(p_permissao text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.papeis_permissoes pp
    where pp.papel = public.jwt_papel()::public.papel_usuario
      and pp.permissao = p_permissao
  )
$$;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  v_empresa_id uuid;
  v_papel public.papel_usuario;
begin
  select u.empresa_id, u.papel
  into v_empresa_id, v_papel
  from public.usuarios u
  where u.id = (event ->> 'user_id')::uuid
    and u.ativo = true;

  claims := event -> 'claims';

  if v_empresa_id is not null then
    claims := jsonb_set(claims, '{empresa_id}', to_jsonb(v_empresa_id::text));
    claims := jsonb_set(claims, '{papel}', to_jsonb(v_papel::text));
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

-- Apenas o serviço de Auth pode executar o hook.
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

-- supabase_auth_admin precisa enxergar `usuarios` para resolver o hook,
-- mesmo com RLS habilitado (política própria em 0004, mas o grant de
-- schema/tabela é necessário à parte da RLS).
grant usage on schema public to supabase_auth_admin;
grant select on public.usuarios to supabase_auth_admin;
