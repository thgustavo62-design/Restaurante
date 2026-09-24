-- Recria as 5 contas de funcionário no Supabase Auth deste projeto (o
-- projeto anterior, onde essas contas viviam, saiu do ar). Substitui a
-- 0012, que só linkava usuarios.id a contas de Auth já existentes — aqui
-- as contas nascem junto, direto em auth.users/auth.identities via
-- pgcrypto, sem precisar da Admin API/chave de serviço.
--
-- PIN temporário 1234 para todo mundo — trocar depois na tela Equipe.
-- email interno = nome em minúsculas, sem acento/espaço, @fogo.internal
-- (mesma regra de assets/js/helpers.js:emailInterno).

do $$
declare
  v_empresa_id uuid := '11111111-1111-1111-1111-111111111111';
  v_instance_id uuid := '00000000-0000-0000-0000-000000000000';
  v_pin text := '1234';
  v_func record;
  v_user_id uuid;
  v_email text;
begin
  for v_func in
    select * from (values
      ('Ana', 'ADMIN'::restaurante.papel_usuario),
      ('Bruno', 'GERENTE'::restaurante.papel_usuario),
      ('Carla', 'CAIXA'::restaurante.papel_usuario),
      ('Diego', 'GARCOM'::restaurante.papel_usuario),
      ('Eva', 'COZINHA'::restaurante.papel_usuario)
    ) as t(nome, papel)
  loop
    v_user_id := gen_random_uuid();
    v_email := lower(regexp_replace(v_func.nome, '[^a-zA-Z0-9]', '', 'g')) || '@fogo.internal';

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      v_instance_id, v_user_id, 'authenticated', 'authenticated', v_email,
      crypt(v_pin, gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now(),
      '', '', '', ''
    );

    insert into auth.identities (
      id, provider_id, user_id, identity_data, provider,
      created_at, updated_at, last_sign_in_at
    ) values (
      gen_random_uuid(), v_user_id::text, v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email),
      'email', now(), now(), now()
    );

    insert into restaurante.usuarios (id, empresa_id, nome, papel, ativo)
    values (v_user_id, v_empresa_id, v_func.nome, v_func.papel, true);
  end loop;
end
$$;
