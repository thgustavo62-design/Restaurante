-- Fase 0.2 — Fechamento de caixa (conferência cega) calculado no servidor.
-- Antes, confirmarFechamento() no client calculava o esperado a partir de
-- state.caixaMovimentos (já carregado no navegador) e gravava direto em
-- caixa_sessoes — "conferência cega" só de fachada, já que o esperado
-- sempre esteve disponível pro client antes do operador informar o
-- contado. Agora o cálculo e a gravação são só no banco.
--
-- Fluxo: conferir_fechamento_caixa (não grava nada, só calcula — alimenta
-- a tela de resultado) e fechar_caixa (recalcula de novo, nunca confia em
-- esperado vindo do client, exige justificativa se a diferença em dinheiro
-- passar do limite, e só então fecha).

create or replace function restaurante.calcular_esperado_caixa(p_sessao_id uuid)
returns jsonb
language plpgsql
stable
set search_path = restaurante, pg_temp
as $$
declare
  v_sessao restaurante.caixa_sessoes%rowtype;
  v_esperados jsonb := '{}'::jsonb;
  v_dinheiro int;
  v_mov record;
begin
  select * into v_sessao from restaurante.caixa_sessoes where id = p_sessao_id;
  if not found then
    raise exception 'Sessão de caixa não encontrada';
  end if;

  v_dinheiro := v_sessao.saldo_inicial_centavos;
  for v_mov in
    select forma_pagamento, tipo, sum(valor_centavos)::int as total
    from restaurante.caixa_movimentos
    where sessao_id = p_sessao_id
    group by forma_pagamento, tipo
  loop
    if v_mov.tipo = 'VENDA' and v_mov.forma_pagamento = 'DINHEIRO' then
      v_dinheiro := v_dinheiro + v_mov.total;
    elsif v_mov.tipo = 'SUPRIMENTO' then
      v_dinheiro := v_dinheiro + v_mov.total;
    elsif v_mov.tipo = 'SANGRIA' then
      v_dinheiro := v_dinheiro - v_mov.total;
    elsif v_mov.tipo = 'VENDA' then
      v_esperados := jsonb_set(v_esperados, array[v_mov.forma_pagamento], to_jsonb(v_mov.total));
    end if;
  end loop;

  v_esperados := jsonb_set(v_esperados, array['DINHEIRO'], to_jsonb(v_dinheiro));
  return v_esperados;
end;
$$;

revoke all on function restaurante.calcular_esperado_caixa(uuid) from public;
grant execute on function restaurante.calcular_esperado_caixa(uuid) to authenticated;

create or replace function restaurante.conferir_fechamento_caixa(p_sessao_id uuid, p_informados jsonb)
returns jsonb
language plpgsql
stable
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_sessao restaurante.caixa_sessoes%rowtype;
  v_empresa restaurante.empresas%rowtype;
  v_esperados jsonb;
  v_diffs jsonb := '{}'::jsonb;
  v_forma text;
  v_diferenca_dinheiro int;
  v_limite int;
begin
  if not restaurante.tem_permissao('caixa.sessao.fechar') then
    raise exception 'Sem permissão para fechar caixa';
  end if;
  select * into v_sessao from restaurante.caixa_sessoes where id = p_sessao_id and empresa_id = v_empresa_id;
  if not found then
    raise exception 'Sessão de caixa não encontrada';
  end if;

  v_esperados := restaurante.calcular_esperado_caixa(p_sessao_id);

  for v_forma in
    select jsonb_object_keys(v_esperados)
    union
    select jsonb_object_keys(p_informados)
  loop
    v_diffs := jsonb_set(v_diffs, array[v_forma],
      to_jsonb(coalesce((p_informados->>v_forma)::int,0) - coalesce((v_esperados->>v_forma)::int,0)));
  end loop;

  v_diferenca_dinheiro := coalesce((v_diffs->>'DINHEIRO')::int, 0);
  select * into v_empresa from restaurante.empresas where id = v_empresa_id;
  v_limite := coalesce((v_empresa.config->>'limiteDiferencaCentavos')::int, 500);

  return jsonb_build_object(
    'esperados', v_esperados,
    'informados', p_informados,
    'diffs', v_diffs,
    'diferenca_dinheiro', v_diferenca_dinheiro,
    'precisa_justificativa', abs(v_diferenca_dinheiro) > v_limite
  );
end;
$$;

revoke all on function restaurante.conferir_fechamento_caixa(uuid, jsonb) from public;
grant execute on function restaurante.conferir_fechamento_caixa(uuid, jsonb) to authenticated;

create or replace function restaurante.fechar_caixa(p_sessao_id uuid, p_informados jsonb, p_justificativa text default null)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_sessao restaurante.caixa_sessoes%rowtype;
  v_resultado jsonb;
  v_diferenca_dinheiro int;
  v_precisa boolean;
  v_fechamento_em timestamptz := now();
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if not restaurante.tem_permissao('caixa.sessao.fechar') then
    raise exception 'Sem permissão para fechar caixa';
  end if;

  select * into v_sessao from restaurante.caixa_sessoes
    where id = p_sessao_id and empresa_id = v_empresa_id and status = 'ABERTA'
    for update;
  if not found then
    raise exception 'Sessão de caixa não encontrada ou já fechada';
  end if;

  v_resultado := restaurante.conferir_fechamento_caixa(p_sessao_id, p_informados);
  v_diferenca_dinheiro := (v_resultado->>'diferenca_dinheiro')::int;
  v_precisa := (v_resultado->>'precisa_justificativa')::boolean;

  if v_precisa and coalesce(trim(p_justificativa), '') = '' then
    raise exception 'Diferença de % centavos acima do limite — informe uma justificativa', v_diferenca_dinheiro;
  end if;

  update restaurante.caixa_sessoes set
    status = 'FECHADA',
    fechamento_em = v_fechamento_em,
    usuario_fechamento = v_usuario_id,
    saldo_calculado_centavos = coalesce((v_resultado->'esperados'->>'DINHEIRO')::int, 0),
    saldo_informado_centavos = coalesce((p_informados->>'DINHEIRO')::int, 0),
    diferenca_centavos = v_diferenca_dinheiro,
    fechamento_detalhe = v_resultado
  where id = p_sessao_id;

  if coalesce(trim(p_justificativa), '') <> '' then
    insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
    values (v_empresa_id, v_usuario_id, 'caixa_sessoes', p_sessao_id, 'DIFERENCA_JUSTIFICADA', trim(p_justificativa));
  end if;

  return v_resultado;
end;
$$;

revoke all on function restaurante.fechar_caixa(uuid, jsonb, text) from public;
grant execute on function restaurante.fechar_caixa(uuid, jsonb, text) to authenticated;

-- Fechar daqui pra frente é só pela RPC (SECURITY DEFINER, bypassa RLS).
-- Nenhum UPDATE direto do cliente em caixa_sessoes é mais permitido —
-- removendo a policy, RLS nega por padrão.
drop policy if exists caixa_sessoes_update on restaurante.caixa_sessoes;
