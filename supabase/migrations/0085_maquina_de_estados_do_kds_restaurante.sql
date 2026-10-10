-- VF-012 do plano de auditoria (docs/PLANO_DE_MELHORIAS.md) — máquina de
-- estados do status dos itens (KDS/expedição) valendo NO BANCO.
--
-- [ACHADO CONFIRMADO NO CÓDIGO DE PRODUÇÃO] o trigger de proteção de
-- comanda_itens só checava permissão/motivo ao CANCELAR e travava
-- produto/nome/preço/quantidade/opções/pago_em. Todo o resto valia para
-- quem tinha cozinha.item.atualizar_status (COZINHA, e GARÇOM via RLS):
--   - ressuscitar item CANCELADO (CANCELADO -> PENDENTE) e voltar um
--     ENTREGUE, sem nenhuma checagem;
--   - cancelar direto (UPDATE status='CANCELADO') pulando o PIN de
--     supervisor e o registro de perda/baixa de estoque de cancelar_item;
--   - alterar iniciado_em/pronto_em/entregue_em à mão (distorce os tempos de
--     preparo que alimentam o desempenho da equipe) e estoque_baixado_em
--     (zerar = o item baixa o estoque DE NOVO no próximo pagamento);
--   - mexer em item de comanda já cancelada.
--
-- Regras (valem para UPDATE direto; as RPCs SECURITY DEFINER que já usam
-- `restaurante.bypass_protecao` — cancelar_item, confirmar_pagamento etc. —
-- continuam passando como antes):
--   PENDENTE   -> PREPARANDO | PRONTO            (avanço; pular direto pra PRONTO existe no bar)
--   PREPARANDO -> PRONTO | PENDENTE              (PENDENTE = voltar um passo, correção de clique)
--   PRONTO     -> ENTREGUE | PREPARANDO          (PREPARANDO = voltar um passo)
--   ENTREGUE e CANCELADO são finais.
--   Ir para CANCELADO: só pela rotina autorizada (cancelar_item).
--   Voltar mais de um passo (PRONTO -> PENDENTE) é recusado.
-- Ao voltar um passo, os horários das etapas que deixaram de valer são
-- zerados (senão um item "de volta no fogão" seguiria com pronto_em).
--
-- Item já PAGO continua podendo andar no KDS (balcão/ficha pagos na hora,
-- item ainda por sair — Fase 0.1), por isso pago_em não bloqueia status.

create or replace function restaurante.trg_comanda_itens_protege_colunas()
returns trigger
language plpgsql
set search_path = restaurante, pg_temp
as $$
declare
  v_ordem_old int;
  v_ordem_new int;
  v_status_comanda text;
begin
  if current_setting('restaurante.bypass_protecao', true) = 'true' then
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'CANCELADO' then
      raise exception 'Cancelar item só pela rotina autorizada (cancelar item com supervisor)';
    end if;
    if old.status in ('CANCELADO', 'ENTREGUE') then
      raise exception 'Item % não pode mais mudar de status', lower(old.status);
    end if;

    v_ordem_old := case old.status when 'PENDENTE' then 1 when 'PREPARANDO' then 2 when 'PRONTO' then 3 end;
    v_ordem_new := case new.status when 'PENDENTE' then 1 when 'PREPARANDO' then 2 when 'PRONTO' then 3 when 'ENTREGUE' then 4 end;
    if v_ordem_new is null then
      raise exception 'Status inválido para o item';
    end if;
    -- ENTREGUE só sai de PRONTO (a expedição só libera o que a cozinha marcou pronto)
    if new.status = 'ENTREGUE' and old.status <> 'PRONTO' then
      raise exception 'Só dá pra entregar um item que já está pronto';
    end if;
    -- voltar é permitido só um passo
    if v_ordem_new < v_ordem_old - 1 then
      raise exception 'Só dá pra voltar um passo no status do item';
    end if;

    select status into v_status_comanda from restaurante.comandas where id = new.comanda_id;
    if v_status_comanda = 'CANCELADA' then
      raise exception 'Comanda cancelada — o status do item não pode mudar';
    end if;
  end if;

  if new.comanda_id is distinct from old.comanda_id
     and not restaurante.tem_permissao('atendimento.comanda.transferir') then
    raise exception 'Sem permissão para transferir item entre comandas';
  end if;

  if new.pago_em is distinct from old.pago_em then
    raise exception 'pago_em só pode ser alterado pelo fechamento de conta';
  end if;

  if new.produto_id is distinct from old.produto_id
     or new.nome is distinct from old.nome
     or new.preco_unit_centavos is distinct from old.preco_unit_centavos
     or new.quantidade is distinct from old.quantidade
     or new.opcoes_selecionadas is distinct from old.opcoes_selecionadas then
    raise exception 'Item lançado não pode ter produto, nome, preço, quantidade ou opções alteradas';
  end if;

  -- horários do preparo só mudam junto com o status (trigger de timestamps,
  -- que roda DEPOIS deste); controle de estoque/cancelamento é só do servidor
  if new.iniciado_em is distinct from old.iniciado_em
     or new.pronto_em is distinct from old.pronto_em
     or new.entregue_em is distinct from old.entregue_em then
    raise exception 'Horários do preparo só mudam junto com o status do item';
  end if;
  if new.estoque_baixado_em is distinct from old.estoque_baixado_em
     or new.cancelado_apos_preparo is distinct from old.cancelado_apos_preparo
     or new.motivo_cancelamento is distinct from old.motivo_cancelamento then
    raise exception 'Campo de controle do item só é alterado pelo servidor';
  end if;
  if new.id is distinct from old.id
     or new.client_uuid is distinct from old.client_uuid
     or new.usuario_id is distinct from old.usuario_id
     or new.setor_producao is distinct from old.setor_producao
     or new.enviado_em is distinct from old.enviado_em
     or new.created_at is distinct from old.created_at then
    raise exception 'Campo de origem do item não pode ser alterado';
  end if;

  return new;
end;
$$;

-- horários: ao avançar, preenche (mantendo o primeiro, como já era); ao
-- voltar um passo, zera os das etapas que deixaram de valer.
create or replace function restaurante.trg_comanda_itens_timestamps_status()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'PREPARANDO' then new.iniciado_em := coalesce(new.iniciado_em, now());
    elsif new.status = 'PRONTO' then new.pronto_em := coalesce(new.pronto_em, now());
    elsif new.status = 'ENTREGUE' then new.entregue_em := coalesce(new.entregue_em, now());
    end if;
    if new.status = 'PENDENTE' then
      new.iniciado_em := null;
      new.pronto_em := null;
    elsif new.status = 'PREPARANDO' and old.status = 'PRONTO' then
      new.pronto_em := null;
    end if;
  end if;
  return new;
end;
$$;
