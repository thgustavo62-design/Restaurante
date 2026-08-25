-- Fase 1 — Vincula os usuários da equipe às contas reais do Supabase Auth
-- (provisionadas via Admin API, PIN de 4 dígitos usado como senha).
-- Os ids abaixo são específicos deste projeto Supabase — se este script for
-- reaplicado em outro projeto, gere novos usuários no Auth primeiro e troque
-- os ids correspondentes aqui.

insert into public.usuarios (id, empresa_id, nome, papel, ativo) values
  ('fb096ec2-bd73-49a5-8d5e-82789c309d13','11111111-1111-1111-1111-111111111111','Ana','ADMIN',true),
  ('4cd28282-8754-476a-b760-48cf2b5dac5d','11111111-1111-1111-1111-111111111111','Bruno','GERENTE',true),
  ('d38e8388-c188-45e9-a78f-fe7a1ea705c5','11111111-1111-1111-1111-111111111111','Carla','CAIXA',true),
  ('23793d5c-c7c6-42dc-a8f7-2e5766669876','11111111-1111-1111-1111-111111111111','Diego','GARCOM',true),
  ('55d288aa-364d-4427-81e0-75a4df7abeb8','11111111-1111-1111-1111-111111111111','Eva','COZINHA',true)
on conflict (id) do nothing;
