-- VF-011 / VF-010 (fase 1) do plano de auditoria (docs/PLANO_DE_MELHORIAS.md)
-- — idempotência do pagamento + protocolo rastreável do recebimento offline.
--
-- [ACHADO CONFIRMADO] confirmar_pagamento não tinha chave de idempotência.
-- As travas de estado (comanda já paga, item já pago) impediam cobrar duas
-- vezes, mas a resposta de um reenvio era errada: se a conexão caía DEPOIS
-- do servidor gravar o pagamento, o retry recebia "Comanda já está paga" —
-- e a fila offline (VF-002) mostrava isso como pendência RECUSADA, para um
-- pagamento que na verdade tinha dado certo. Também não ficava registrado
-- no servidor de que terminal/operador/instante veio um recebimento offline.
--
-- Correção:
--   - operacoes_idempotentes: (empresa_id, chave) única, guarda o resultado
--     da primeira execução + assinatura dos parâmetros + terminal, operador
--     e instante local (ocorrido_em, só offline).
--   - confirmar_pagamento ganha p_chave/p_terminal_id/p_ocorrido_em (todos
--     opcionais, no fim): mesma chave + mesmos parâmetros devolve o
--     resultado ORIGINAL (com "repetido": true) sem gravar nada de novo;
--     mesma chave com parâmetros diferentes (outra comanda, outras linhas)
--     é erro — chave nunca é reaproveitada para outra operação.
--   - Sem chave (front-end antigo ainda em cache), comporta-se como antes.
--   - A checagem da chave acontece DEPOIS de travar a comanda (FOR UPDATE),
--     então duas chamadas simultâneas com a mesma chave se serializam: a
--     segunda espera a primeira terminar e já encontra o resultado.
--
-- A assinatura antiga (11 parâmetros) é derrubada — manter as duas deixaria
-- uma chamada com 11 argumentos nomeados ambígua para o PostgREST. Como os
-- novos parâmetros têm default, o front-end antigo continua chamando sem
-- erro (sem downtime na troca).

create table if not exists restaurante.operacoes_idempotentes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  chave uuid not null,
  tipo text not null,
  comanda_id uuid,
  usuario_id uuid,
  terminal_id text,
  ocorrido_em timestamptz,
  assinatura text not null,
  resultado jsonb not null,
  created_at timestamptz not null default now(),
  unique (empresa_id, chave)
);

alter table restaurante.operacoes_idempotentes enable row level security;

-- Escrita só pela RPC (SECURITY DEFINER). Leitura: quem resolve
-- conflitos de sincronização (GERENTE/ADMIN) — base da conciliação (fase 2).
drop policy if exists operacoes_idempotentes_select on restaurante.operacoes_idempotentes;
create policy operacoes_idempotentes_select on restaurante.operacoes_idempotentes for select
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.sync_conflitos.resolver'));

create index if not exists idx_operacoes_idempotentes_comanda
  on restaurante.operacoes_idempotentes (comanda_id);

drop function if exists restaurante.confirmar_pagamento(uuid, jsonb, uuid, uuid[], uuid, int, text, uuid, text, timestamptz, uuid);

create or replace function restaurante.confirmar_pagamento(
  p_comanda_id uuid,
  p_linhas jsonb,
  p_cliente_id uuid default null,
  p_item_ids uuid[] default null,
  p_sessao_id uuid default null,
  p_pontos_resgatados int default 0,
  p_cupom_codigo text default null,
  p_supervisor_id uuid default null,
  p_supervisor_pin text default null,
  p_comanda_updated_at timestamptz default null,
  p_tentativa_id uuid default null,
  p_chave uuid default null,
  p_terminal_id text default null,
  p_ocorrido_em timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, extensions, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_comanda restaurante.comandas%rowtype;
  v_empresa restaurante.empresas%rowtype;
  v_sessao restaurante.caixa_sessoes%rowtype;
  v_mesa restaurante.mesas%rowtype;
  v_cliente restaurante.clientes%rowtype;
  v_cupom restaurante.cupons%rowtype;
  v_totais jsonb;
  v_rotulo text;
  v_subtotal int; v_desconto int; v_desconto_pontos int; v_desconto_cupom int;
  v_taxa int; v_total int; v_pct_desconto_total numeric;
  v_soma int := 0;
  v_troco int;
  v_troco_restante int;
  v_linha jsonb;
  v_forma text;
  v_valor int;
  v_tem_fiado boolean := false;
  v_tem_dinheiro boolean := false;
  v_fechamento timestamptz := now();
  v_pagamentos jsonb := '[]'::jsonb;
  v_movimentos jsonb := '[]'::jsonb;
  v_contas jsonb := '[]'::jsonb;
  v_estoque_movs jsonb := '[]'::jsonb;
  v_item record;
  v_ficha record;
  v_qtd numeric;
  v_insumo_row restaurante.insumos%rowtype;
  v_mov_row restaurante.estoque_movimentos%rowtype;
  v_conta_row restaurante.contas%rowtype;
  v_pag_row restaurante.pagamentos%rowtype;
  v_caixamov_row restaurante.caixa_movimentos%rowtype;
  v_restantes int;
  v_fechou boolean := false;
  v_opcao_elem jsonb;
  v_opcao_id_estoque uuid;
  v_taxa_forma_pct numeric;
  v_prazo_dias int;
  v_valor_liquido int;
  v_pontos_por_real numeric;
  v_pontos_ganhos int;
  v_limite_desconto numeric;
  v_supervisor restaurante.usuarios%rowtype;
  v_aprovador_nome text;
  v_ids_pagos_agora uuid[];
  v_conflito_id uuid;
  v_op restaurante.operacoes_idempotentes%rowtype;
  v_assinatura text;
  v_resultado jsonb;
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if not restaurante.tem_permissao('caixa.pagamento.registrar') then
    raise exception 'Sem permissão para registrar pagamento';
  end if;

  select * into v_comanda from restaurante.comandas
    where id = p_comanda_id and empresa_id = v_empresa_id
    for update;
  if not found then
    raise exception 'Comanda não encontrada';
  end if;
  -- VF-011: idempotência. Depois do FOR UPDATE da comanda (duas chamadas com
  -- a mesma chave se serializam) e ANTES das checagens de status — o reenvio
  -- de um pagamento já aplicado cai aqui, não em "Comanda já está paga".
  if p_chave is not null then
    v_assinatura := md5(jsonb_build_object(
      'c', p_comanda_id, 'l', p_linhas,
      'i', (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from unnest(coalesce(p_item_ids, '{}'::uuid[])) x),
      'cli', p_cliente_id, 'p', coalesce(p_pontos_resgatados, 0), 'cu', p_cupom_codigo
    )::text);
    select * into v_op from restaurante.operacoes_idempotentes where empresa_id = v_empresa_id and chave = p_chave;
    if found then
      if v_op.tipo <> 'confirmar_pagamento' or v_op.comanda_id is distinct from p_comanda_id or v_op.assinatura <> v_assinatura then
        raise exception 'Chave de operação já usada com outros valores — gere uma nova tentativa';
      end if;
      return v_op.resultado || jsonb_build_object('repetido', true);
    end if;
  end if;

  if v_comanda.status = 'PAGA' then
    raise exception 'Comanda já está paga';
  end if;
  if v_comanda.status = 'CANCELADA' then
    raise exception 'Comanda cancelada';
  end if;

  if p_comanda_updated_at is not null and v_comanda.updated_at is distinct from p_comanda_updated_at then
    insert into restaurante.sync_conflitos (empresa_id, comanda_id, tipo, payload, motivo)
    values (v_empresa_id, p_comanda_id, 'pagamento', jsonb_build_object(
        'p_comanda_id', p_comanda_id, 'p_linhas', p_linhas, 'p_cliente_id', p_cliente_id,
        'p_item_ids', p_item_ids, 'p_sessao_id', p_sessao_id, 'p_pontos_resgatados', p_pontos_resgatados,
        'p_cupom_codigo', p_cupom_codigo
      ), 'Comanda foi alterada por outro terminal entre o pagamento offline e a sincronização')
    returning id into v_conflito_id;
    insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
    values (v_empresa_id, v_usuario_id, 'comanda', p_comanda_id, 'CONFLITO_SYNC_PAGAMENTO', v_comanda.codigo);
    v_resultado := jsonb_build_object('conflito', true, 'conflito_id', v_conflito_id);
    if p_chave is not null then
      insert into restaurante.operacoes_idempotentes (empresa_id, chave, tipo, comanda_id, usuario_id, terminal_id, ocorrido_em, assinatura, resultado)
      values (v_empresa_id, p_chave, 'confirmar_pagamento', p_comanda_id, v_usuario_id, p_terminal_id, p_ocorrido_em, v_assinatura, v_resultado);
    end if;
    return v_resultado;
  end if;

  if p_item_ids is not null then
    if array_length(p_item_ids, 1) is null then
      raise exception 'Selecione ao menos um item';
    end if;
    if exists (
      select 1 from unnest(p_item_ids) iid
      where not exists (
        select 1 from restaurante.comanda_itens ci
        where ci.id = iid and ci.comanda_id = p_comanda_id
          and ci.status <> 'CANCELADO' and ci.pago_em is null
      )
    ) then
      raise exception 'Um ou mais itens selecionados são inválidos para pagamento (já pago, cancelado ou de outra comanda)';
    end if;
  end if;

  select * into v_empresa from restaurante.empresas where id = v_empresa_id;

  select coalesce(bool_or(l->>'forma' = 'FIADO'), false), coalesce(bool_or(l->>'forma' = 'DINHEIRO'), false)
    into v_tem_fiado, v_tem_dinheiro
    from jsonb_array_elements(p_linhas) l;

  if p_cliente_id is not null or p_pontos_resgatados > 0 or v_tem_fiado then
    if p_cliente_id is null then
      raise exception 'Escolha um cliente cadastrado para o fiado';
    end if;
    select * into v_cliente from restaurante.clientes
      where id = p_cliente_id and empresa_id = v_empresa_id for update;
    if not found then
      raise exception 'Cliente não encontrado';
    end if;
  end if;

  v_totais := restaurante.calcular_totais_pagamento(p_comanda_id, p_item_ids, p_pontos_resgatados, p_cupom_codigo, p_cliente_id);
  v_subtotal := (v_totais->>'subtotal')::int;
  v_desconto := (v_totais->>'desconto')::int;
  v_desconto_pontos := (v_totais->>'desconto_pontos')::int;
  v_desconto_cupom := (v_totais->>'desconto_cupom')::int;
  v_taxa := (v_totais->>'taxa')::int;
  v_total := (v_totais->>'total')::int;
  v_pct_desconto_total := (v_totais->>'pct_desconto_total')::numeric;
  if v_totais->>'cupom_id' is not null then
    select * into v_cupom from restaurante.cupons where id = (v_totais->>'cupom_id')::uuid for update;
  end if;

  if v_subtotal = 0 then
    raise exception 'Não há itens pendentes de pagamento nesta seleção';
  end if;

  v_limite_desconto := coalesce((v_empresa.config->>'limiteDescontoPct')::numeric, 10);
  if v_pct_desconto_total > v_limite_desconto then
    if p_supervisor_id is null or coalesce(trim(p_supervisor_pin), '') = '' or p_tentativa_id is null then
      raise exception 'Desconto total (manual + pontos + cupom) de % pontos percentuais, acima do limite de % — exige autorização de supervisor', round(v_pct_desconto_total,1), v_limite_desconto;
    end if;
    v_supervisor := restaurante.verificar_pin_supervisor(p_supervisor_id, p_supervisor_pin, 'atendimento.comanda.desconto.aplicar', p_tentativa_id);
    v_aprovador_nome := v_supervisor.nome;
  end if;

  select coalesce(sum((l->>'valor_centavos')::int), 0) into v_soma
    from jsonb_array_elements(p_linhas) l;
  if v_soma < v_total then
    raise exception 'Faltam % centavos para cobrir o total', (v_total - v_soma);
  end if;
  if v_soma > v_total and not v_tem_dinheiro then
    raise exception 'Soma das formas de pagamento (%) maior que o total (%) sem nenhuma linha em dinheiro para dar troco', v_soma, v_total;
  end if;

  if p_sessao_id is not null then
    select * into v_sessao from restaurante.caixa_sessoes
      where id = p_sessao_id and empresa_id = v_empresa_id and status = 'ABERTA'
      for update;
    if not found then
      raise exception 'Sessão de caixa informada não está aberta';
    end if;
  else
    select * into v_sessao from restaurante.caixa_sessoes
      where empresa_id = v_empresa_id and status = 'ABERTA'
      order by abertura_em desc limit 1
      for update;
    if not found then
      raise exception 'Abra o caixa antes de registrar pagamentos';
    end if;
  end if;

  v_troco := v_soma - v_total;

  perform set_config('restaurante.bypass_protecao', 'true', true);

  with v_atualizados as (
    update restaurante.comanda_itens
      set pago_em = v_fechamento
      where comanda_id = p_comanda_id and status <> 'CANCELADO' and pago_em is null
        and (p_item_ids is null or id = any(p_item_ids))
      returning id
  )
  select array_agg(id) into v_ids_pagos_agora from v_atualizados;

  select count(*) into v_restantes from restaurante.comanda_itens
    where comanda_id = p_comanda_id and status <> 'CANCELADO' and pago_em is null;
  v_fechou := (v_restantes = 0);

  if p_cliente_id is not null and v_comanda.cliente_id is null then
    update restaurante.comandas set cliente_id = p_cliente_id where id = p_comanda_id;
  end if;

  -- PRIORIDADE 5 — taxa_servico_centavos acumula igual total_centavos já
  -- fazia (pagamento parcial soma a taxa de cada chamada) — é essa coluna
  -- que relatorio_fechamento_equipe/central_do_dono usam pra ratear.
  if v_fechou then
    update restaurante.comandas
      set status = 'PAGA', fechamento = v_fechamento, troco_centavos = v_troco,
          total_centavos = coalesce(total_centavos, 0) + v_total,
          taxa_servico_centavos = coalesce(taxa_servico_centavos, 0) + v_taxa
      where id = p_comanda_id;
  else
    update restaurante.comandas
      set total_centavos = coalesce(total_centavos, 0) + v_total,
          taxa_servico_centavos = coalesce(taxa_servico_centavos, 0) + v_taxa
      where id = p_comanda_id;
  end if;

  if v_cupom.id is not null then
    update restaurante.cupons set usos_atuais = usos_atuais + 1 where id = v_cupom.id;
  end if;

  if p_cliente_id is not null then
    v_pontos_por_real := coalesce((v_empresa.config->'fidelidade'->>'pontosPorReal')::numeric, 1);
    v_pontos_ganhos := floor(v_total::numeric / 100 * v_pontos_por_real)::int;
    update restaurante.clientes
      set pontos_fidelidade = pontos_fidelidade - p_pontos_resgatados + v_pontos_ganhos
      where id = p_cliente_id;
  end if;

  for v_linha in select * from jsonb_array_elements(p_linhas)
  loop
    insert into restaurante.pagamentos (comanda_id, sessao_id, forma, valor_centavos)
    values (p_comanda_id, v_sessao.id, v_linha->>'forma', (v_linha->>'valor_centavos')::int)
    returning * into v_pag_row;
    v_pagamentos := v_pagamentos || to_jsonb(v_pag_row);
  end loop;

  v_troco_restante := v_troco;
  for v_linha in select * from jsonb_array_elements(p_linhas)
  loop
    v_forma := v_linha->>'forma';
    v_valor := (v_linha->>'valor_centavos')::int;
    if v_forma = 'DINHEIRO' and v_troco_restante > 0 then
      v_valor := greatest(0, v_valor - v_troco_restante);
      v_troco_restante := 0;
    end if;
    if v_valor > 0 then
      insert into restaurante.caixa_movimentos (sessao_id, tipo, valor_centavos, forma_pagamento, comanda_id, usuario_id)
      values (v_sessao.id, 'VENDA', v_valor, v_forma, p_comanda_id, v_usuario_id)
      returning * into v_caixamov_row;
      v_movimentos := v_movimentos || to_jsonb(v_caixamov_row);
    end if;
  end loop;

  select * into v_mesa from restaurante.mesas where id = v_comanda.mesa_id;
  v_rotulo := case
    when v_comanda.tipo = 'BALCAO' then 'Balcão'
    when v_comanda.tipo = 'FICHA' then 'Ficha ' || v_comanda.ficha_numero::text
    when v_comanda.tipo = 'DELIVERY' then 'Delivery'
    else 'Mesa ' || coalesce(v_mesa.numero::text,'?')
  end;
  for v_linha in select * from jsonb_array_elements(p_linhas)
  loop
    v_forma := v_linha->>'forma';
    if v_forma = 'FIADO' then
      insert into restaurante.contas (empresa_id, tipo, descricao, categoria, valor_centavos, vencimento, cliente_id)
      values (
        v_empresa_id, 'RECEBER',
        'Fiado — ' || v_cliente.nome || ' — ' || v_rotulo || ' · ' || v_comanda.codigo,
        'Fiado', (v_linha->>'valor_centavos')::int, current_date + 7, p_cliente_id
      )
      returning * into v_conta_row;
      v_contas := v_contas || to_jsonb(v_conta_row);
    elsif v_forma in ('DEBITO','CREDITO','VOUCHER') then
      v_taxa_forma_pct := coalesce((v_empresa.config->'taxasMaquininha'->v_forma->>'pct')::numeric, 0);
      v_prazo_dias := coalesce((v_empresa.config->'taxasMaquininha'->v_forma->>'prazoDias')::int, 0);
      v_valor_liquido := round((v_linha->>'valor_centavos')::int * (1 - v_taxa_forma_pct/100.0))::int;
      insert into restaurante.contas (empresa_id, tipo, descricao, categoria, valor_centavos, vencimento)
      values (
        v_empresa_id, 'RECEBER',
        v_forma || ' — ' || v_rotulo || ' · ' || v_comanda.codigo ||
          (case when v_taxa_forma_pct>0 then ' (taxa ' || v_taxa_forma_pct::text || '%)' else '' end),
        'Recebíveis de cartão/voucher', v_valor_liquido, current_date + v_prazo_dias
      )
      returning * into v_conta_row;
      v_contas := v_contas || to_jsonb(v_conta_row);
    end if;
  end loop;

  for v_item in
    select * from restaurante.comanda_itens
    where comanda_id = p_comanda_id and estoque_baixado_em is null
      and (
        (v_ids_pagos_agora is not null and id = any(v_ids_pagos_agora))
        or (status = 'CANCELADO' and cancelado_apos_preparo)
      )
  loop
    for v_ficha in
      select * from restaurante.ficha_tecnica where produto_id = v_item.produto_id
    loop
      v_qtd := v_ficha.quantidade * v_item.quantidade / restaurante.rendimento_atual(v_ficha.insumo_id);
      update restaurante.insumos
        set estoque_atual = estoque_atual - v_qtd
        where id = v_ficha.insumo_id
        returning * into v_insumo_row;
      if found then
        insert into restaurante.estoque_movimentos
          (empresa_id, insumo_id, tipo, quantidade, motivo, origem, origem_id, usuario_id)
        values
          (v_empresa_id, v_ficha.insumo_id, 'VENDA', v_qtd, null, 'comanda', p_comanda_id, v_usuario_id)
        returning * into v_mov_row;
        v_estoque_movs := v_estoque_movs || to_jsonb(v_mov_row);
      end if;
    end loop;

    for v_opcao_elem in select * from jsonb_array_elements(v_item.opcoes_selecionadas)
    loop
      v_opcao_id_estoque := (v_opcao_elem->>'opcao_id')::uuid;
      for v_ficha in
        select * from restaurante.opcao_ficha_tecnica where opcao_id = v_opcao_id_estoque
      loop
        v_qtd := v_ficha.quantidade * v_item.quantidade / restaurante.rendimento_atual(v_ficha.insumo_id);
        update restaurante.insumos
          set estoque_atual = estoque_atual - v_qtd
          where id = v_ficha.insumo_id
          returning * into v_insumo_row;
        if found then
          insert into restaurante.estoque_movimentos
            (empresa_id, insumo_id, tipo, quantidade, motivo, origem, origem_id, usuario_id)
          values
            (v_empresa_id, v_ficha.insumo_id, 'VENDA', v_qtd, null, 'comanda', p_comanda_id, v_usuario_id)
          returning * into v_mov_row;
          v_estoque_movs := v_estoque_movs || to_jsonb(v_mov_row);
        end if;
      end loop;
    end loop;

    update restaurante.comanda_itens set estoque_baixado_em = v_fechamento where id = v_item.id;
  end loop;

  insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
  values (v_empresa_id, v_usuario_id, 'comanda', p_comanda_id,
    case when v_fechou then 'PAGAMENTO_CONFIRMADO' else 'PAGAMENTO_PARCIAL_CONFIRMADO' end,
    v_comanda.codigo || ' · ' || v_total::text || ' centavos' || (case when v_fechou then '' else ' (parcial)' end)
      || (case when v_cupom.id is not null then ' · cupom ' || v_cupom.codigo else '' end)
      || (case when v_aprovador_nome is not null then ' · desconto acima do limite aprovado por ' || v_aprovador_nome else '' end));

  select * into v_comanda from restaurante.comandas where id = p_comanda_id;

  v_resultado := jsonb_build_object(
    'comanda', to_jsonb(v_comanda),
    'fechou', v_fechou,
    'pagamentos', v_pagamentos,
    'caixa_movimentos', v_movimentos,
    'contas', v_contas,
    'estoque_movimentos', v_estoque_movs,
    'cupom_codigo', v_cupom.codigo,
    'desconto_cupom_centavos', v_desconto_cupom
  );

  if p_chave is not null then
    insert into restaurante.operacoes_idempotentes (empresa_id, chave, tipo, comanda_id, usuario_id, terminal_id, ocorrido_em, assinatura, resultado)
    values (v_empresa_id, p_chave, 'confirmar_pagamento', p_comanda_id, v_usuario_id, p_terminal_id, p_ocorrido_em, v_assinatura, v_resultado);
  end if;

  return v_resultado;
end;
$$;

revoke all on function restaurante.confirmar_pagamento(uuid, jsonb, uuid, uuid[], uuid, int, text, uuid, text, timestamptz, uuid, uuid, text, timestamptz) from public;
grant execute on function restaurante.confirmar_pagamento(uuid, jsonb, uuid, uuid[], uuid, int, text, uuid, text, timestamptz, uuid, uuid, text, timestamptz) to authenticated;
