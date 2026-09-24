-- Schemas criados manualmente (fora do `public` padrão do Supabase) não
-- herdam os grants de anon/authenticated automaticamente — sem isso o
-- PostgREST nem lista as tabelas no schema cache pra esses papéis, mesmo
-- com o schema exposto em Data API > Exposed schemas. RLS continua sendo
-- quem decide o que cada um vê linha a linha; isso aqui só permite a
-- consulta chegar até lá.

grant usage on schema restaurante to anon, authenticated;

grant select on all tables in schema restaurante to anon, authenticated;
grant insert, update on all tables in schema restaurante to authenticated;

alter default privileges in schema restaurante grant select on tables to anon, authenticated;
alter default privileges in schema restaurante grant insert, update on tables to authenticated;
