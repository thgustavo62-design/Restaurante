-- VF-010 fase 2 — conciliação de recebimento em dinheiro feito sem internet.
--
-- Problema (VF-010): se o servidor RECUSA de verdade um pagamento em dinheiro
-- que foi recebido offline (ex: o caixa já tinha sido fechado), o dinheiro
-- físico já está na gaveta mas nada ficava gravado no servidor — só uma
-- pendência no IndexedDB daquele aparelho, que um clique em "Descartar"
-- apagava.
--
-- Solução, reaproveitando a tela "Conflitos de sincronização" que já existe
-- (sync_conflitos + resolver_sync_conflito, 0064):
--   - registrar_recebimento_offline_recusado(): o aparelho avisa o servidor
--     da recusa (idempotente pela chave do pagamento). Vira um conflito
--     PENDENTE tipo 'pagamento_recusado', com valor, comanda, terminal,
--     instante em que o dinheiro foi recebido e o motivo da recusa.
--   - contar_conciliacao_offline(): quantidade e valor de conflitos
--     PENDENTES, usada para AVISAR no fechamento de caixa (decisão do
--     Gustavo, 10/10/2026: só avisar, nunca bloquear o fechamento).
--   - resolver_sync_conflito(): para 'pagamento_recusado' a resolução é
--     "conferido" (p_aplicar = true -> APLICADO) ou descartado, sempre com
--     auditoria de quem decidiu. NÃO lança nada automaticamente no caixa.
--
-- [DECISÃO DE DESIGN] O Gustavo não respondeu o que o gerente pode fazer
-- com o recebimento recusado; fiz o mínimo seguro: registrar + avisar +
-- marcar como conferido (com rastro). Lançar como suprimento no caixa
-- aberto fica como evolução se ele quiser — é regra de dinheiro, não
-- decidi sozinho. Pode ser revertido sem perda de dado.

alter table restaurante.sync_conflitos drop constraint if exists sync_conflitos_tipo_check;
alter table restaurante.sync_conflitos
  add constraint sync_conflitos_tipo_check check (tipo in ('pagamento', 'pagamento_recusado'));

create or replace function restaurante.registrar_recebimento_offline_recusado(
  p_chave uuid, p_comanda_id uuid, p_valor_centavos int, p_motivo text,
  p_ocorrido_em timestamptz default null, p_terminal_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_id uuid;
  v_comanda_id uuid;
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if not restaurante.tem_permissao('caixa.pagamento.registrar') then
    raise exception 'Sem permissão para registrar recebimento';
  end if;
  if p_chave is null then
    raise exception 'Chave do recebimento é obrigatória';
  end if;
  if p_valor_centavos is null or p_valor_centavos <= 0 then
    raise exception 'Valor inválido';
  end if;

  select id into v_id from restaurante.sync_conflitos
    where empresa_id = v_empresa_id and tipo = 'pagamento_recusado' and payload->>'chave' = p_chave::text;
  if found then
    return v_id;
  end if;

  select id into v_comanda_id from restaurante.comandas where id = p_comanda_id and empresa_id = v_empresa_id;

  insert into restaurante.sync_conflitos (empresa_id, comanda_id, tipo, payload, motivo)
  values (
    v_empresa_id, v_comanda_id, 'pagamento_recusado',
    jsonb_build_object(
      'chave', p_chave, 'valor_centavos', p_valor_centavos, 'terminal_id', p_terminal_id,
      'ocorrido_em', p_ocorrido_em, 'operador_id', v_usuario_id, 'motivo_recusa', p_motivo
    ),
    'Recebimento em dinheiro feito offline foi recusado pelo servidor: ' || coalesce(nullif(trim(p_motivo), ''), 'sem motivo informado')
  )
  returning id into v_id;

  insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
  values (v_empresa_id, v_usuario_id, 'sync_conflitos', v_id, 'RECEBIMENTO_OFFLINE_RECUSADO',
    p_valor_centavos::text || ' centavos · ' || coalesce(p_terminal_id, '?') || ' · ' || coalesce(p_motivo, ''));

  return v_id;
end;
$$;

revoke all on function restaurante.registrar_recebimento_offline_recusado(uuid, uuid, int, text, timestamptz, text) from public;
grant execute on function restaurante.registrar_recebimento_offline_recusado(uuid, uuid, int, text, timestamptz, text) to authenticated;

create or replace function restaurante.contar_conciliacao_offline()
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
begin
  if v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if not (restaurante.tem_permissao('caixa.pagamento.registrar') or restaurante.tem_permissao('admin.sync_conflitos.resolver')) then
    raise exception 'Sem permissão';
  end if;
  return (
    select jsonb_build_object(
      'pendentes', count(*),
      'valor_centavos', coalesce(sum(
        case when tipo = 'pagamento_recusado'
          then coalesce((payload->>'valor_centavos')::int, 0)
          else coalesce((select sum((l->>'valor_centavos')::int) from jsonb_array_elements(payload->'p_linhas') l), 0)
        end
      ), 0)::int
    )
    from restaurante.sync_conflitos
    where empresa_id = v_empresa_id and status = 'PENDENTE'
  );
end;
$$;

revoke all on function restaurante.contar_conciliacao_offline() from public;
grant execute on function restaurante.contar_conciliacao_offline() to authenticated;

create or replace function restaurante.resolver_sync_conflito(p_conflito_id uuid, p_aplicar boolean)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_conflito restaurante.sync_conflitos%rowtype;
  v_resultado jsonb;
begin
  if not restaurante.tem_permissao('admin.sync_conflitos.resolver') then
    raise exception 'Sem permissão para resolver conflitos de sincronização';
  end if;

  select * into v_conflito from restaurante.sync_conflitos
    where id = p_conflito_id and empresa_id = v_empresa_id and status = 'PENDENTE' for update;
  if not found then
    raise exception 'Conflito não encontrado ou já resolvido';
  end if;

  -- recebimento offline recusado: não há o que "reaplicar" — o dinheiro já
  -- está na gaveta. Resolver = registrar que um gerente conferiu (ou
  -- descartou), com rastro de quem e quando.
  if v_conflito.tipo = 'pagamento_recusado' then
    update restaurante.sync_conflitos
      set status = case when p_aplicar then 'APLICADO' else 'DESCARTADO' end,
          resolvido_por = v_usuario_id, resolvido_em = now()
      where id = p_conflito_id;
    insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
    values (v_empresa_id, v_usuario_id, 'sync_conflitos', p_conflito_id,
      case when p_aplicar then 'RECEBIMENTO_OFFLINE_CONFERIDO' else 'RECEBIMENTO_OFFLINE_DESCARTADO' end,
      v_conflito.motivo);
    return jsonb_build_object('conferido', p_aplicar);
  end if;

  if p_aplicar then
    v_resultado := restaurante.confirmar_pagamento(
      (v_conflito.payload->>'p_comanda_id')::uuid,
      v_conflito.payload->'p_linhas',
      nullif(v_conflito.payload->>'p_cliente_id','')::uuid,
      case when jsonb_typeof(v_conflito.payload->'p_item_ids') = 'array'
        then (select array_agg(x)::uuid[] from jsonb_array_elements_text(v_conflito.payload->'p_item_ids') x)
        else null
      end,
      nullif(v_conflito.payload->>'p_sessao_id','')::uuid,
      coalesce((v_conflito.payload->>'p_pontos_resgatados')::int, 0),
      nullif(v_conflito.payload->>'p_cupom_codigo','')
    );
    update restaurante.sync_conflitos
      set status = 'APLICADO', resolvido_por = v_usuario_id, resolvido_em = now()
      where id = p_conflito_id;
    insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
    values (v_empresa_id, v_usuario_id, 'sync_conflitos', p_conflito_id, 'CONFLITO_APLICADO', v_conflito.motivo);
  else
    update restaurante.sync_conflitos
      set status = 'DESCARTADO', resolvido_por = v_usuario_id, resolvido_em = now()
      where id = p_conflito_id;
    insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
    values (v_empresa_id, v_usuario_id, 'sync_conflitos', p_conflito_id, 'CONFLITO_DESCARTADO', v_conflito.motivo);
    v_resultado := jsonb_build_object('descartado', true);
  end if;

  return v_resultado;
end;
$$;
