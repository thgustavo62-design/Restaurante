-- VF-001 do plano de auditoria (docs/PLANO_DE_MELHORIAS.md) — blinda
-- comandas.status/fechamento/troco_centavos no trigger de proteção, e
-- fecha o INSERT direto em pagamentos/caixa_movimentos/contas que
-- deixava qualquer um com a permissão certa fabricar um lançamento
-- financeiro sem passar pela RPC de negócio.
--
-- [ACHADO CONFIRMADO NO CÓDIGO] o client já faz UPDATE direto em
-- comandas.status/fechamento em 3 lugares reais (não só uma brecha
-- teórica de API):
--   - cancelarComanda() (actions-atendimento.js) — status='CANCELADA' +
--     fechamento=now(), confiando SÓ no client que a comanda está vazia
--     (comanda.itens.length===0) — nada no servidor confere isso hoje,
--     então uma chamada direta à API podia cancelar uma comanda CHEIA
--     sem nunca ter sido paga.
--   - abrirFecharConta() / fecharModalAtual() / pagamento parcial
--     (actions-caixa.js) — alternam status entre ABERTA e FECHANDO, um
--     estado de coordenação de UI (quem está mexendo no pagamento agora),
--     sem efeito financeiro algum. Esses continuam liberados — só os
--     dois estados que IMPORTAM de verdade (PAGA e CANCELADA) passam a
--     exigir a rotina autorizada.
--
-- Por isso a correção é cirúrgica: trava só a transição PRA 'PAGA' ou
-- 'CANCELADA' (e fechamento/troco_centavos, sempre), sem travar
-- ABERTA<->FECHANDO (que o client mexe direto há muito tempo e não tem
-- nada de financeiro). cancelar_comanda_vazia() é a nova RPC que
-- substitui o UPDATE direto do cancelamento, repetindo a checagem "zero
-- item" — agora no servidor, não só no client.
--
-- caixa_movimentos.tipo aceita ('SUPRIMENTO','SANGRIA','VENDA','ESTORNO',
-- 'AJUSTE') por CHECK constraint, mas a policy de insert só conferia
-- permissão + dono da sessão — nada impedia um CAIXA (que tem
-- caixa.pagamento.registrar) inserir tipo='VENDA' direto, fabricando uma
-- venda que nunca aconteceu pra fechar a conferência de caixa. A policy
-- nova restringe insert direto a SANGRIA/SUPRIMENTO — VENDA/ESTORNO/
-- AJUSTE só entram pela RPC (que roda SECURITY DEFINER, ignora RLS).
-- Mesma lógica pra pagamentos (sem nenhum uso direto do client — só
-- confirmar_pagamento grava, então a policy de insert é só uma porta
-- destrancada à toa) e contas (a cláusula "ou
-- caixa.pagamento.registrar" existia só pra confirmar_pagamento, que já
-- ignora RLS por ser SECURITY DEFINER — na prática só deixava um CAIXA
-- inserir conta manual sem ter acesso à tela Financeiro).

create or replace function restaurante.trg_comandas_protege_colunas()
returns trigger
language plpgsql
set search_path = restaurante, pg_temp
as $$
begin
  if current_setting('restaurante.bypass_protecao', true) = 'true' then
    return new;
  end if;

  if new.desconto_centavos is distinct from old.desconto_centavos
     and not restaurante.tem_permissao('atendimento.comanda.desconto.aplicar') then
    raise exception 'Sem permissão para alterar o desconto da comanda';
  end if;

  if (new.mesa_id is distinct from old.mesa_id or new.tipo is distinct from old.tipo)
     and not restaurante.tem_permissao('atendimento.comanda.transferir') then
    raise exception 'Sem permissão para transferir a comanda';
  end if;

  if new.empresa_id is distinct from old.empresa_id
     or new.codigo is distinct from old.codigo
     or new.usuario_abertura is distinct from old.usuario_abertura
     or new.abertura is distinct from old.abertura
     or new.total_centavos is distinct from old.total_centavos
     or new.troco_centavos is distinct from old.troco_centavos
     or new.fechamento is distinct from old.fechamento then
    raise exception 'Campo somente leitura da comanda não pode ser alterado';
  end if;

  -- ABERTA<->FECHANDO continua livre (coordenação de UI, sem efeito
  -- financeiro) — só fechar (PAGA) ou cancelar (CANCELADA) de verdade
  -- exige a rotina autorizada (confirmar_pagamento / cancelar_comanda_vazia).
  if new.status is distinct from old.status and new.status in ('PAGA', 'CANCELADA') then
    raise exception 'Fechar ou cancelar a comanda só pela rotina autorizada';
  end if;

  return new;
end;
$$;

-- ========================================================================
-- cancelar_comanda_vazia — substitui o UPDATE direto de cancelarComanda()
-- (client), repetindo a checagem "comanda sem nenhum item" no servidor.
-- ========================================================================
create or replace function restaurante.cancelar_comanda_vazia(p_comanda_id uuid)
returns restaurante.comandas
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_comanda restaurante.comandas%rowtype;
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if not restaurante.tem_permissao('atendimento.comanda.abrir') then
    raise exception 'Sem permissão para cancelar comanda';
  end if;

  select * into v_comanda from restaurante.comandas
    where id = p_comanda_id and empresa_id = v_empresa_id and status = 'ABERTA'
    for update;
  if not found then
    raise exception 'Comanda não encontrada ou não está aberta';
  end if;

  if exists (select 1 from restaurante.comanda_itens where comanda_id = p_comanda_id) then
    raise exception 'Só dá pra cancelar comanda sem nenhum item lançado';
  end if;

  perform set_config('restaurante.bypass_protecao', 'true', true);
  update restaurante.comandas set status = 'CANCELADA', fechamento = now()
    where id = p_comanda_id
    returning * into v_comanda;

  insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
  values (v_empresa_id, v_usuario_id, 'comanda', p_comanda_id, 'CANCELAR_COMANDA_VAZIA', v_comanda.codigo);

  return v_comanda;
end;
$$;

revoke all on function restaurante.cancelar_comanda_vazia(uuid) from public;
grant execute on function restaurante.cancelar_comanda_vazia(uuid) to authenticated;

-- ========================================================================
-- pagamentos: nenhum uso direto do client — só confirmar_pagamento grava
-- (SECURITY DEFINER, ignora RLS). A policy de insert só destrancava uma
-- porta que nada legítimo usa.
-- ========================================================================
drop policy if exists pagamentos_insert on restaurante.pagamentos;

-- ========================================================================
-- caixa_movimentos: insert direto só pode continuar pra SANGRIA/SUPRIMENTO
-- (uso real do client, registrarMovimento em actions-caixa.js) — VENDA/
-- ESTORNO/AJUSTE só pela RPC.
-- ========================================================================
drop policy if exists caixa_mov_insert on restaurante.caixa_movimentos;
create policy caixa_mov_insert on restaurante.caixa_movimentos for insert
  with check (
    tipo in ('SANGRIA', 'SUPRIMENTO')
    and (restaurante.tem_permissao('caixa.movimento.sangria') or restaurante.tem_permissao('caixa.movimento.suprimento'))
    and exists (select 1 from restaurante.caixa_sessoes s where s.id = sessao_id and s.empresa_id = restaurante.jwt_empresa_id())
  );

-- ========================================================================
-- contas: insert direto só por quem vê Financeiro (admin.financeiro.ver,
-- mesmo gate do botão "Nova conta" no client) — a cláusula extra de
-- caixa.pagamento.registrar só servia pra confirmar_pagamento, que já
-- ignora RLS por ser SECURITY DEFINER.
-- ========================================================================
drop policy if exists contas_insert on restaurante.contas;
create policy contas_insert on restaurante.contas for insert
  with check (
    empresa_id = restaurante.jwt_empresa_id()
    and restaurante.tem_permissao('admin.financeiro.ver')
  );
