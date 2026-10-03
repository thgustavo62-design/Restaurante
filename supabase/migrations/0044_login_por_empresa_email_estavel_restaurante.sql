-- Fase 0.4 — login por restaurante + e-mail estável.
--
-- restaurante.usuarios_login (0022) é uma view aberta pra `anon` SEM
-- filtro de empresa: lista o nome de TODOS os funcionários de TODAS as
-- empresas que compartilham este projeto Supabase pra qualquer um que
-- bater na API, sem autenticação nenhuma. Vira uma RPC que exige o slug
-- do restaurante (o mesmo já usado pelo cardápio público, 0030).
--
-- E-mail de login era derivado do nome (emailInterno()/criar_funcionario):
-- acento some, nome duplicado colide, renomear funcionário quebra o
-- login. Passa a ser um UUID aleatório + domínio da própria empresa,
-- nunca mais derivado do nome. Guardado em restaurante.usuarios.email_interno
-- pra não precisar ler auth.users em lugar nenhum do front/RPC de login.

alter table restaurante.usuarios add column if not exists email_interno text;
create unique index if not exists idx_usuarios_email_interno on restaurante.usuarios (email_interno) where email_interno is not null;

-- ---------- criar_funcionario: e-mail novo passa a ser UUID + slug ----------

create or replace function restaurante.criar_funcionario(p_nome text, p_papel restaurante.papel_usuario, p_pin text)
returns uuid
language plpgsql
security definer
set search_path = restaurante, extensions
as $$
declare
  v_email text;
  v_slug text;
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

  select slug into v_slug from restaurante.empresas where id = restaurante.jwt_empresa_id();
  if v_slug is null then
    raise exception 'Empresa sem slug configurado';
  end if;
  v_email := gen_random_uuid()::text || '@' || v_slug || '.internal';

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

  insert into restaurante.usuarios (id, empresa_id, nome, papel, ativo, email_interno)
  values (v_new_id, restaurante.jwt_empresa_id(), trim(p_nome), p_papel, true, v_email);

  return v_new_id;
end;
$$;

revoke all on function restaurante.criar_funcionario(text, restaurante.papel_usuario, text) from public;
grant execute on function restaurante.criar_funcionario(text, restaurante.papel_usuario, text) to authenticated;

-- ---------- migração de transição: funcionários atuais ----------
-- Troca o e-mail de quem já existe (ainda no padrão nome@fogo.internal)
-- pro novo padrão, preservando o PIN (a troca de e-mail no GoTrue não mexe
-- na senha). Roda uma vez só — já pulando quem tiver email_interno
-- preenchido, então é seguro reaplicar esta migration sem duplicar efeito.

do $$
declare
  v_usuario record;
  v_service_key text;
  v_novo_email text;
  v_resposta extensions.http_response;
begin
  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_service_key is null then
    raise warning 'Chave de serviço não configurada no Vault — pulei a migração de e-mail dos funcionários atuais, rode manualmente depois';
  else
    for v_usuario in
      select u.id, u.nome, e.slug
      from restaurante.usuarios u
      join restaurante.empresas e on e.id = u.empresa_id
      where u.email_interno is null
    loop
      -- cada usuário em seu próprio bloco: uma falha aqui (timeout, erro
      -- da extensão http, etc. — não só um status HTTP diferente de 200,
      -- que já era tratado abaixo) não pode mais abortar a transação do
      -- arquivo inteiro e derrubar a criação da RPC/drop view no final.
      begin
        v_novo_email := gen_random_uuid()::text || '@' || v_usuario.slug || '.internal';

        select * into v_resposta from extensions.http((
          'PUT',
          'https://ybsyhjqtwiwomtxbloyu.supabase.co/auth/v1/admin/users/' || v_usuario.id::text,
          ARRAY[
            extensions.http_header('apikey', v_service_key),
            extensions.http_header('Authorization', 'Bearer ' || v_service_key)
          ],
          'application/json',
          jsonb_build_object('email', v_novo_email, 'email_confirm', true)::text
        )::extensions.http_request);

        if v_resposta.status = 200 then
          update restaurante.usuarios set email_interno = v_novo_email where id = v_usuario.id;
        else
          raise warning 'Falha ao migrar e-mail do usuário % (%): status %, %', v_usuario.nome, v_usuario.id, v_resposta.status, v_resposta.content;
        end if;
      exception when others then
        raise warning 'Falha ao migrar e-mail do usuário % (%): %', v_usuario.nome, v_usuario.id, sqlerrm;
      end;
    end loop;
  end if;
end $$;

-- ---------- login por restaurante (RPC substitui a view aberta) ----------

create or replace function restaurante.usuarios_login_por_empresa(p_slug text)
returns table(id uuid, nome text, email text)
language sql
stable
security definer
set search_path = restaurante, pg_temp
as $$
  select u.id, u.nome, u.email_interno
  from restaurante.usuarios u
  join restaurante.empresas e on e.id = u.empresa_id
  where e.slug = p_slug and u.ativo = true
  order by u.nome;
$$;

revoke all on function restaurante.usuarios_login_por_empresa(text) from public;
grant execute on function restaurante.usuarios_login_por_empresa(text) to anon, authenticated;

drop view if exists restaurante.usuarios_login;
