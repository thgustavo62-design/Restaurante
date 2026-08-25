-- Fix: custom_access_token_hook precisa ser SECURITY DEFINER.
--
-- O GoTrue invoca o hook como o papel `supabase_auth_admin`, que está sujeito
-- a RLS (não é dono das tabelas nem tem BYPASSRLS). A policy de
-- `usuarios_select` exige `empresa_id = jwt_empresa_id()` — mas nesse
-- momento o JWT ainda não existe (é o que está sendo gerado), então a
-- consulta interna do hook retornava 0 linhas e os claims nunca eram
-- adicionados. SECURITY DEFINER faz a função rodar com os privilégios do
-- dono (postgres), que ignora RLS por padrão.

alter function public.custom_access_token_hook(jsonb) security definer;
alter function public.custom_access_token_hook(jsonb) set search_path = public, pg_temp;
