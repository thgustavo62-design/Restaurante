-- Trocar PIN de um funcionário existente (tela Equipe). Espelha
-- restaurante.criar_funcionario (0022): SECURITY DEFINER, valida a
-- permissão do chamador, lê a service_role_key do Vault (nunca do
-- client) e chama a Admin API do GoTrue — aqui via PUT /admin/users/:id
-- com { password } em vez de POST /admin/users.

create extension if not exists http with schema extensions;

create or replace function restaurante.trocar_pin_funcionario(p_usuario_id uuid, p_novo_pin text)
returns void
language plpgsql
security definer
set search_path = restaurante, extensions
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_alvo restaurante.usuarios%rowtype;
  v_service_key text;
  v_resposta extensions.http_response;
begin
  if not restaurante.tem_permissao('admin.equipe.editar') then
    raise exception 'Sem permissão para alterar PIN';
  end if;
  if p_novo_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN deve ter exatamente 4 dígitos';
  end if;

  select * into v_alvo from restaurante.usuarios
    where id = p_usuario_id and empresa_id = v_empresa_id;
  if not found then
    raise exception 'Usuário não encontrado';
  end if;

  select decrypted_secret into v_service_key
    from vault.decrypted_secrets where name = 'service_role_key';
  if v_service_key is null then
    raise exception 'Chave de serviço não configurada no Vault';
  end if;

  select * into v_resposta from extensions.http((
    'PUT',
    'https://ybsyhjqtwiwomtxbloyu.supabase.co/auth/v1/admin/users/' || p_usuario_id::text,
    ARRAY[
      extensions.http_header('apikey', v_service_key),
      extensions.http_header('Authorization', 'Bearer ' || v_service_key),
      extensions.http_header('User-Agent', 'postgres-http/1.0')
    ],
    'application/json',
    jsonb_build_object('password', p_novo_pin)::text
  )::extensions.http_request);

  if v_resposta.status <> 200 then
    raise exception 'Falha ao trocar PIN (status %): %', v_resposta.status, v_resposta.content;
  end if;

  insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
  values (v_empresa_id, auth.uid(), 'usuarios', p_usuario_id, 'PIN_ALTERADO', v_alvo.nome);
end;
$$;

revoke all on function restaurante.trocar_pin_funcionario(uuid, text) from public;
grant execute on function restaurante.trocar_pin_funcionario(uuid, text) to authenticated;
