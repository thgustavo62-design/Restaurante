-- VF-008 do plano de auditoria (docs/PLANO_DE_MELHORIAS.md) — funcionário
-- desativado (ou com papel trocado) perdia acesso só quando o JWT dele
-- expirasse.
--
-- Causa: custom_access_token_hook grava empresa_id/papel dentro do token
-- no momento do login/refresh, e jwt_empresa_id()/jwt_papel() só liam esse
-- claim. Todas as policies de RLS e RPCs SECURITY DEFINER do app passam
-- por essas duas funções — então um token emitido antes da desativação
-- continuava lendo e escrevendo (inclusive via Realtime, que avalia as
-- mesmas policies) até expirar.
--
-- Correção num ponto só: as duas funções agora confirmam em
-- restaurante.usuarios, a cada chamada, que o usuário do token ainda está
-- `ativo`, e devolvem a empresa/papel ATUAIS da tabela, não o que está
-- congelado no token. Desativar vira efeito imediato; trocar papel também
-- (rebaixar um GERENTE deixa de valer só no próximo login).
--
-- SECURITY DEFINER: usuarios tem RLS e a policy usuarios_select chama
-- jwt_empresa_id() — sem isso a função se chamaria recursivamente. Dono da
-- função (postgres) não sofre RLS. Grants existentes são preservados pelo
-- `create or replace` (anon/authenticated precisam executar: toda policy
-- permissiva é avaliada, inclusive nas leituras públicas do cardápio).
--
-- Além disso, um trigger derruba as sessões do Auth quando `ativo` vira
-- false, pra o refresh token também morrer (higiene — o bloqueio real já é
-- o de cima).

create or replace function restaurante.jwt_empresa_id()
returns uuid
language sql
stable
security definer
set search_path = restaurante, pg_temp
as $$
  select u.empresa_id
  from restaurante.usuarios u
  where u.id = nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
    and u.ativo = true
$$;

create or replace function restaurante.jwt_papel()
returns text
language sql
stable
security definer
set search_path = restaurante, pg_temp
as $$
  select u.papel::text
  from restaurante.usuarios u
  where u.id = nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
    and u.ativo = true
$$;

create or replace function restaurante.trg_usuarios_derruba_sessoes()
returns trigger
language plpgsql
security definer
set search_path = restaurante, auth, pg_temp
as $$
begin
  if old.ativo is true and new.ativo is false then
    delete from auth.sessions where user_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function restaurante.trg_usuarios_derruba_sessoes() from public;

drop trigger if exists trg_usuarios_derruba_sessoes on restaurante.usuarios;
create trigger trg_usuarios_derruba_sessoes
  after update of ativo on restaurante.usuarios
  for each row execute function restaurante.trg_usuarios_derruba_sessoes();
