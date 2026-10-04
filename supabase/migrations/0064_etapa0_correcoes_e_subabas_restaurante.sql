-- ETAPA 0 — Corrigir erros + base de sub-abas.
--
-- Reúne 0.1 a 0.10 do roteiro novo numa migration só porque a maioria
-- converge na mesma função (confirmar_pagamento): cálculo de total
-- compartilhado (0.1), teto de desconto empilhado com supervisor (0.2),
-- baixa de estoque por pagamento parcial (0.4), rendimento na baixa (0.9)
-- e remoção do greatest(0,...) (0.8) são todos mudanças na MESMA rotina
-- de fechar conta — reescrever ela 5 vezes em 5 migrations seria mais
-- arriscado que fazer uma vez só, com cuidado. 0.11 (componente de
-- sub-abas) e 0.12 (docs/rotas-permissoes.md) são só front-end/doc, sem
-- parte neste arquivo.

-- ========================================================================
-- 0.9 — rendimento entra na baixa de estoque
-- ========================================================================
-- Ficha técnica é cadastrada em peso LIMPO (ex: 200g de picanha já
-- porcionada). O insumo CRU rende menos que isso depois de aparar/limpar
-- — insumo_rendimentos (fase 2, já existia só pra registro/consulta)
-- guarda esse fator medido. Baixa de agora em diante = quantidade da
-- ficha técnica ÷ fator de rendimento mais recente (sem medição = 1,
-- ou seja, sem mudança de comportamento pra quem nunca mediu nada).

create or replace function restaurante.rendimento_atual(p_insumo_id uuid)
returns numeric
language sql
stable
set search_path = restaurante, pg_temp
as $$
  select coalesce(
    (select fator from restaurante.insumo_rendimentos
      where insumo_id = p_insumo_id
      order by medido_em desc, id desc limit 1),
    1
  );
$$;

-- ========================================================================
-- 0.4 — comanda_itens.estoque_baixado_em (trava "nunca baixa duas vezes")
-- ========================================================================

alter table restaurante.comanda_itens add column if not exists estoque_baixado_em timestamptz;

-- ========================================================================
-- 0.3 — LGPD no relatório de clientes inativos
-- ========================================================================
-- Cliente sem consentimento continua aparecendo na lista (o GERENTE ainda
-- precisa saber QUEM parou de vir pra decidir o que fazer), mas o
-- telefone vem nulo — nenhuma tela de marketing mostra contato de quem
-- não autorizou.

create or replace function restaurante.relatorio_clientes_inativos(p_dias int default 60)
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_resultado jsonb;
begin
  if not restaurante.tem_permissao('admin.marketing.editar') then
    raise exception 'Sem permissão para ver relatórios de marketing';
  end if;
  if p_dias < 1 then
    raise exception 'Período inválido';
  end if;

  select coalesce(jsonb_agg(row_to_json(c) order by c.dias_sem_comprar desc nulls first), '[]'::jsonb) into v_resultado
  from (
    select cl.id, cl.nome,
      case when cl.consentimento_lgpd then cl.telefone else null end as telefone,
      cl.pontos_fidelidade,
      max(co.fechamento) as ultima_compra,
      (current_date - max(co.fechamento)::date) as dias_sem_comprar
    from restaurante.clientes cl
    left join restaurante.comandas co on co.cliente_id = cl.id and co.status = 'PAGA'
    where cl.empresa_id = v_empresa_id
    group by cl.id, cl.nome, cl.telefone, cl.consentimento_lgpd, cl.pontos_fidelidade
    having max(co.fechamento) is null or max(co.fechamento) < now() - (p_dias || ' days')::interval
  ) c;

  return v_resultado;
end;
$$;

revoke all on function restaurante.relatorio_clientes_inativos(int) from public;
grant execute on function restaurante.relatorio_clientes_inativos(int) to authenticated;

-- ========================================================================
-- 0.1 + 0.2 + 0.4 + 0.8 + 0.9 — confirmar_pagamento reescrita
-- ========================================================================
-- calcular_totais_pagamento(): núcleo do cálculo (subtotal, descontos,
-- taxa, total), usado tanto pela RPC de preview (calcular_total_pagamento,
-- chamada pelo modal a cada mudança) quanto pelo fechamento de verdade —
-- ANTES isso estava duplicado (o client recalculava "valor cheio menos
-- desconto" com uma fórmula, o servidor calculava a taxa sobre a base já
-- descontada com outra — cartão cobrava a mais do que o servidor
-- realmente fechava). Uma função só, usada nos dois lugares, acaba com a
-- divergência estruturalmente (não só "ajustando a conta" nos dois
-- lados).

create or replace function restaurante.calcular_totais_pagamento(
  p_comanda_id uuid, p_item_ids uuid[], p_pontos_resgatados int, p_cupom_codigo text, p_cliente_id uuid
)
returns jsonb
language plpgsql
stable
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_comanda restaurante.comandas%rowtype;
  v_empresa restaurante.empresas%rowtype;
  v_cliente restaurante.clientes%rowtype;
  v_cupom restaurante.cupons%rowtype;
  v_subtotal int := 0;
  v_desconto int := 0;
  v_desconto_pontos int := 0;
  v_desconto_cupom int := 0;
  v_valor_ponto_centavos int;
  v_taxa_pct numeric;
  v_taxa int;
  v_total int;
  v_pct_desconto_total numeric := 0;
begin
  select * into v_comanda from restaurante.comandas where id = p_comanda_id and empresa_id = v_empresa_id;
  if not found then
    raise exception 'Comanda não encontrada';
  end if;

  select coalesce(sum(preco_unit_centavos * quantidade), 0)::int into v_subtotal
    from restaurante.comanda_itens
    where comanda_id = p_comanda_id and status <> 'CANCELADO' and pago_em is null
      and (p_item_ids is null or id = any(p_item_ids));

  v_desconto := case when p_item_ids is null then coalesce(v_comanda.desconto_centavos, 0) else 0 end;

  select * into v_empresa from restaurante.empresas where id = v_empresa_id;

  if p_pontos_resgatados > 0 then
    if p_item_ids is not null then
      raise exception 'Resgate de pontos só vale fechando a conta inteira';
    end if;
    -- usa o cliente ESCOLHIDO (p_cliente_id), não v_comanda.cliente_id —
    -- a comanda só grava o cliente de verdade dentro de confirmar_pagamento,
    -- então na primeira vez que alguém escolhe um cliente pra uma comanda
    -- (preview OU fechamento), v_comanda.cliente_id ainda está nulo.
    if p_cliente_id is null then
      raise exception 'Escolha um cliente pra resgatar pontos';
    end if;
    select * into v_cliente from restaurante.clientes where id = p_cliente_id and empresa_id = v_empresa_id;
    if not found or p_pontos_resgatados > v_cliente.pontos_fidelidade then
      raise exception 'Cliente só tem % pontos disponíveis', coalesce(v_cliente.pontos_fidelidade, 0);
    end if;
    v_valor_ponto_centavos := coalesce((v_empresa.config->'fidelidade'->>'valorPontoCentavos')::int, 0);
    v_desconto_pontos := p_pontos_resgatados * v_valor_ponto_centavos;
  end if;

  if p_cupom_codigo is not null then
    if p_item_ids is not null then
      raise exception 'Cupom só vale fechando a conta inteira';
    end if;
    select * into v_cupom from restaurante.cupons
      where empresa_id = v_empresa_id and upper(codigo) = upper(trim(p_cupom_codigo));
    if not found or not v_cupom.ativo then
      raise exception 'Cupom inválido';
    end if;
    if v_cupom.valido_de is not null and current_date < v_cupom.valido_de then
      raise exception 'Cupom ainda não é válido';
    end if;
    if v_cupom.valido_ate is not null and current_date > v_cupom.valido_ate then
      raise exception 'Cupom expirado';
    end if;
    if v_cupom.usos_max is not null and v_cupom.usos_atuais >= v_cupom.usos_max then
      raise exception 'Cupom já atingiu o limite de usos';
    end if;
    v_desconto_cupom := case when v_cupom.tipo = 'PERCENTUAL'
      then round(greatest(0, v_subtotal - v_desconto - v_desconto_pontos) * v_cupom.valor / 100.0)::int
      else least(v_cupom.valor, greatest(0, v_subtotal - v_desconto - v_desconto_pontos))
    end;
  end if;

  v_taxa_pct := case when v_comanda.taxa_servico_ativa
    then coalesce((v_empresa.config->>'taxaServicoPctPadrao')::numeric, 10)
    else 0 end;
  v_taxa := round(greatest(0, v_subtotal - v_desconto - v_desconto_pontos - v_desconto_cupom) * v_taxa_pct / 100.0)::int;
  v_total := greatest(0, v_subtotal - v_desconto - v_desconto_pontos - v_desconto_cupom + v_taxa
    + (case when p_item_ids is null then coalesce(v_comanda.taxa_entrega_centavos,0) else 0 end));

  -- 0.2 — % do subtotal coberto pelos três descontos empilhados (manual +
  -- pontos + cupom), pra decidir se passa do limite configurado.
  if v_subtotal > 0 then
    v_pct_desconto_total := (v_desconto + v_desconto_pontos + v_desconto_cupom)::numeric / v_subtotal * 100;
  end if;

  return jsonb_build_object(
    'subtotal', v_subtotal, 'desconto', v_desconto, 'desconto_pontos', v_desconto_pontos,
    'desconto_cupom', v_desconto_cupom, 'cupom_id', v_cupom.id, 'cupom_codigo', v_cupom.codigo,
    'taxa_pct', v_taxa_pct, 'taxa', v_taxa, 'total', v_total, 'pct_desconto_total', v_pct_desconto_total
  );
end;
$$;

revoke all on function restaurante.calcular_totais_pagamento(uuid, uuid[], int, text) from public;

-- RPC exposta: o modal de pagamento chama isso a cada mudança (cliente,
-- pontos, cupom) pra mostrar o total EXATO que vai ser cobrado — nunca
-- mais recalculado com fórmula própria no navegador.
create or replace function restaurante.calcular_total_pagamento(
  p_comanda_id uuid, p_item_ids uuid[] default null, p_pontos_resgatados int default 0,
  p_cupom_codigo text default null, p_cliente_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
begin
  if not restaurante.tem_permissao('caixa.pagamento.registrar') then
    raise exception 'Sem permissão para calcular pagamento';
  end if;
  return restaurante.calcular_totais_pagamento(p_comanda_id, p_item_ids, coalesce(p_pontos_resgatados,0), p_cupom_codigo, p_cliente_id);
end;
$$;

revoke all on function restaurante.calcular_total_pagamento(uuid, uuid[], int, text, uuid) from public;
grant execute on function restaurante.calcular_total_pagamento(uuid, uuid[], int, text, uuid) to authenticated;

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
  p_comanda_updated_at timestamptz default null
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
  if v_comanda.status = 'PAGA' then
    raise exception 'Comanda já está paga';
  end if;
  if v_comanda.status = 'CANCELADA' then
    raise exception 'Comanda cancelada';
  end if;

  -- 0.5 — conflito offline: se o pagamento foi enfileirado sem internet
  -- com o updated_at que a comanda tinha NAQUELE momento, e outro
  -- terminal mexeu nela nesse meio tempo, não aplica — grava o payload
  -- pra um GERENTE/ADMIN decidir depois (resolver_sync_conflito), em vez
  -- de arriscar cobrar em cima de um estado que já não existe mais.
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
    return jsonb_build_object('conflito', true, 'conflito_id', v_conflito_id);
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

  -- 0.1 — mesmo cálculo que o preview do modal (calcular_total_pagamento)
  -- já mostrou; relido aqui dentro da transação pra nunca confiar no que
  -- o client calculou (preço pode ter mudado, pontos podem ter sido
  -- gastos em outro pagamento concorrente, etc.).
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

  -- 0.2 — desconto manual + pontos + cupom empilhados passando do limite
  -- configurado exige PIN de supervisor, mesma trava de aplicar_desconto
  -- (0043) — mas aqui olhando o empilhado todo, não só o desconto manual
  -- isolado (um GARCOM podia hoje montar 10% manual + pontos + cupom e
  -- passar longe do limite sem ninguém aprovar nada).
  v_limite_desconto := coalesce((v_empresa.config->>'limiteDescontoPct')::numeric, 10);
  if v_pct_desconto_total > v_limite_desconto then
    if p_supervisor_id is null or coalesce(trim(p_supervisor_pin), '') = '' then
      raise exception 'Desconto total (manual + pontos + cupom) de % pontos percentuais, acima do limite de % — exige autorização de supervisor', round(v_pct_desconto_total,1), v_limite_desconto;
    end if;
    v_supervisor := restaurante.verificar_pin_supervisor(p_supervisor_id, p_supervisor_pin, 'atendimento.comanda.desconto.aplicar');
    v_aprovador_nome := v_supervisor.nome;
  end if;

  select coalesce(sum((l->>'valor_centavos')::int), 0) into v_soma
    from jsonb_array_elements(p_linhas) l;
  if v_soma < v_total then
    raise exception 'Faltam % centavos para cobrir o total', (v_total - v_soma);
  end if;
  -- 0.1 — pagar a mais só é aceito se tiver linha em DINHEIRO (o troco
  -- absorve a diferença); sem dinheiro na jogada, "pagar a mais" não tem
  -- pra onde ir — era aceito antes e só parecia certo pelo erro da taxa
  -- calculada em cima da base errada (ver comentário de calcular_totais_pagamento).
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

  if v_fechou then
    update restaurante.comandas
      set status = 'PAGA', fechamento = v_fechamento, troco_centavos = v_troco,
          total_centavos = coalesce(total_centavos, 0) + v_total
      where id = p_comanda_id;
  else
    update restaurante.comandas
      set total_centavos = coalesce(total_centavos, 0) + v_total
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

  -- 0.4/0.8/0.9 — baixa de estoque: roda em TODO pagamento (parcial ou
  -- não), só pros itens pagos NESTA chamada + qualquer item cancelado
  -- após preparo ainda não baixado (independe de pagamento — comida foi
  -- feita e perdida de qualquer jeito). estoque_baixado_em trava contra
  -- baixar o mesmo item duas vezes se a função rodar de novo pro resto
  -- da comanda depois. Sem greatest(0,...): [DECISÃO TOMADA] estoque fica
  -- negativo de propósito (sinaliza furo pra investigar, Estoque mostra
  -- em vermelho) em vez de esconder a diferença travando em zero.
  -- Quantidade dividida pelo rendimento mais recente do insumo (0.9).
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

  return jsonb_build_object(
    'comanda', to_jsonb(v_comanda),
    'fechou', v_fechou,
    'pagamentos', v_pagamentos,
    'caixa_movimentos', v_movimentos,
    'contas', v_contas,
    'estoque_movimentos', v_estoque_movs,
    'cupom_codigo', v_cupom.codigo,
    'desconto_cupom_centavos', v_desconto_cupom
  );
end;
$$;

revoke all on function restaurante.confirmar_pagamento(uuid, jsonb, uuid, uuid[], uuid, int, text, uuid, text, timestamptz) from public;
grant execute on function restaurante.confirmar_pagamento(uuid, jsonb, uuid, uuid[], uuid, int, text, uuid, text, timestamptz) to authenticated;

drop function if exists restaurante.confirmar_pagamento(uuid, jsonb, uuid, uuid[], uuid, int, text);

-- registrar_movimento_estoque (0036) — mesma remoção do greatest(0,...)
-- pra entrada/saída manual (0.8).
create or replace function restaurante.registrar_movimento_estoque(
  p_insumo_id uuid, p_tipo text, p_quantidade numeric, p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_insumo restaurante.insumos%rowtype;
  v_mov restaurante.estoque_movimentos%rowtype;
  v_delta numeric;
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if not restaurante.tem_permissao('admin.estoque.editar') then
    raise exception 'Sem permissão para movimentar estoque';
  end if;
  if p_tipo not in ('ENTRADA','SAIDA') then
    raise exception 'Tipo inválido';
  end if;
  if not (p_quantidade > 0) then
    raise exception 'Quantidade deve ser maior que zero';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Motivo é obrigatório';
  end if;

  v_delta := case when p_tipo = 'ENTRADA' then p_quantidade else -p_quantidade end;

  update restaurante.insumos
    set estoque_atual = estoque_atual + v_delta
    where id = p_insumo_id and empresa_id = v_empresa_id
    returning * into v_insumo;
  if not found then
    raise exception 'Insumo não encontrado';
  end if;

  insert into restaurante.estoque_movimentos
    (empresa_id, insumo_id, tipo, quantidade, motivo, origem, usuario_id)
  values (v_empresa_id, p_insumo_id, p_tipo, p_quantidade, trim(p_motivo), 'MANUAL', v_usuario_id)
  returning * into v_mov;

  return jsonb_build_object('insumo', to_jsonb(v_insumo), 'movimento', to_jsonb(v_mov));
end;
$$;

-- CMV agora usa o custo corrigido pelo rendimento (0.9) — relatorio_gestao
-- (0052) e relatorio_dre (0045/0052) recalculados com rendimento_atual().

create or replace function restaurante.relatorio_gestao(p_desde date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_cmv jsonb;
  v_anti_fraude jsonb;
  v_taxa_garcom jsonb;
  v_abc jsonb;
  v_heatmap jsonb;
  v_taxa_pct numeric;
begin
  if not restaurante.tem_permissao('admin.relatorios.ver') then
    raise exception 'Sem permissão para ver relatórios';
  end if;
  if p_ate < p_desde or (p_ate - p_desde) > 366 then
    raise exception 'Período inválido (máximo de 1 ano)';
  end if;

  select coalesce(jsonb_agg(row_to_json(c) order by c.total_vendido desc), '[]'::jsonb) into v_cmv
  from (
    select p.id, p.nome, coalesce(cat.nome,'Sem categoria') as categoria,
      p.preco_centavos,
      coalesce((
        select sum((ft.quantidade / restaurante.rendimento_atual(ft.insumo_id)) * i.custo_medio_centavos)
        from restaurante.ficha_tecnica ft join restaurante.insumos i on i.id = ft.insumo_id
        where ft.produto_id = p.id
      ), 0)::int as custo_centavos,
      sum(ci.quantidade) as qtd_vendida,
      sum(ci.quantidade * p.preco_centavos)::int as total_vendido
    from restaurante.produtos p
    left join restaurante.categorias cat on cat.id = p.categoria_id
    join restaurante.comanda_itens ci on ci.produto_id = p.id and ci.status <> 'CANCELADO'
    join restaurante.comandas c2 on c2.id = ci.comanda_id
    where p.empresa_id = v_empresa_id and c2.empresa_id = v_empresa_id
      and c2.status = 'PAGA' and c2.dia_operacional between p_desde and p_ate
    group by p.id, p.nome, cat.nome, p.preco_centavos
  ) c;

  select coalesce(jsonb_agg(row_to_json(f) order by f.valor_total desc), '[]'::jsonb) into v_anti_fraude
  from (
    select u.id as usuario_id, u.nome,
      coalesce(sum(case when x.tipo='CANCELAMENTO' then 1 else 0 end),0) as cancelamentos_qtd,
      coalesce(sum(case when x.tipo='CANCELAMENTO' then x.valor else 0 end),0)::int as cancelamentos_valor,
      coalesce(sum(case when x.tipo='DESCONTO' then 1 else 0 end),0) as descontos_qtd,
      coalesce(sum(case when x.tipo='DESCONTO' then x.valor else 0 end),0)::int as descontos_valor,
      coalesce(sum(x.valor),0)::int as valor_total
    from restaurante.usuarios u
    join (
      select a.usuario_id, 'CANCELAMENTO' as tipo,
        coalesce(ci.preco_unit_centavos * ci.quantidade, 0) as valor
      from restaurante.auditoria a
      join restaurante.comanda_itens ci on ci.id = a.entidade_id
      where a.empresa_id = v_empresa_id and a.entidade = 'comanda_itens' and a.acao = 'CANCELAR_ITEM'
        and a.created_at::date between p_desde and p_ate
      union all
      select a.usuario_id, 'DESCONTO' as tipo,
        greatest(0, coalesce((a.dados_depois->>'desconto_centavos')::int,0) - coalesce((a.dados_antes->>'desconto_centavos')::int,0)) as valor
      from restaurante.auditoria a
      where a.empresa_id = v_empresa_id and a.entidade = 'comandas' and a.acao = 'UPDATE'
        and a.created_at::date between p_desde and p_ate
        and coalesce((a.dados_depois->>'desconto_centavos')::int,0) > coalesce((a.dados_antes->>'desconto_centavos')::int,0)
    ) x on x.usuario_id = u.id
    where u.empresa_id = v_empresa_id
    group by u.id, u.nome
  ) f;

  select coalesce((config->>'taxaServicoPctPadrao')::numeric, 10) into v_taxa_pct
    from restaurante.empresas where id = v_empresa_id;

  select coalesce(jsonb_agg(row_to_json(g) order by g.taxa_estim desc), '[]'::jsonb) into v_taxa_garcom
  from (
    select u.nome, sum(ci.preco_unit_centavos*ci.quantidade)::int as subtotal,
      round(sum(ci.preco_unit_centavos*ci.quantidade) * v_taxa_pct / 100.0)::int as taxa_estim
    from restaurante.comanda_itens ci
    join restaurante.comandas c on c.id = ci.comanda_id
    join restaurante.usuarios u on u.id = ci.usuario_id
    where c.empresa_id = v_empresa_id and c.status = 'PAGA' and c.taxa_servico_ativa = true
      and c.dia_operacional between p_desde and p_ate and ci.status <> 'CANCELADO'
    group by u.nome
  ) g;

  select coalesce(jsonb_agg(row_to_json(ab)), '[]'::jsonb) into v_abc
  from (
    select nome, total, classe from (
      select ci.nome, sum(ci.preco_unit_centavos*ci.quantidade)::int as total,
        sum(sum(ci.preco_unit_centavos*ci.quantidade)) over (order by sum(ci.preco_unit_centavos*ci.quantidade) desc) as acumulado,
        sum(sum(ci.preco_unit_centavos*ci.quantidade)) over () as total_geral
      from restaurante.comanda_itens ci
      join restaurante.comandas c on c.id = ci.comanda_id
      where c.empresa_id = v_empresa_id and c.status = 'PAGA'
        and c.dia_operacional between p_desde and p_ate and ci.status <> 'CANCELADO'
      group by ci.nome
    ) ranked
    cross join lateral (
      select case
        when total_geral = 0 then 'C'
        when acumulado::numeric / total_geral <= 0.8 then 'A'
        when acumulado::numeric / total_geral <= 0.95 then 'B'
        else 'C'
      end as classe
    ) cl
    order by total desc
  ) ab;

  select coalesce(jsonb_agg(row_to_json(h)), '[]'::jsonb) into v_heatmap
  from (
    select extract(dow from fechamento)::int as dia_semana,
      extract(hour from fechamento)::int as hora,
      sum(total_centavos)::int as total,
      count(*) as vendas
    from restaurante.comandas
    where empresa_id = v_empresa_id and status = 'PAGA'
      and dia_operacional between p_desde and p_ate
    group by extract(dow from fechamento), extract(hour from fechamento)
  ) h;

  return jsonb_build_object(
    'cmv_por_produto', v_cmv,
    'anti_fraude', v_anti_fraude,
    'taxa_por_garcom', v_taxa_garcom,
    'curva_abc', v_abc,
    'heatmap', v_heatmap
  );
end;
$$;

create or replace function restaurante.relatorio_dre(p_mes date)
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_desde date := date_trunc('month', p_mes)::date;
  v_ate date := (date_trunc('month', p_mes) + interval '1 month' - interval '1 day')::date;
  v_faturamento int;
  v_cmv int;
  v_despesas int;
begin
  if not restaurante.tem_permissao('admin.relatorios.ver') then
    raise exception 'Sem permissão para ver relatórios';
  end if;

  select coalesce(sum(total_centavos),0)::int into v_faturamento
    from restaurante.comandas
    where empresa_id = v_empresa_id and status = 'PAGA' and dia_operacional between v_desde and v_ate;

  select coalesce(sum(ci.quantidade * coalesce((
      select sum((ft.quantidade / restaurante.rendimento_atual(ft.insumo_id)) * i.custo_medio_centavos)
      from restaurante.ficha_tecnica ft join restaurante.insumos i on i.id = ft.insumo_id
      where ft.produto_id = ci.produto_id
    ), 0)), 0)::int into v_cmv
    from restaurante.comanda_itens ci
    join restaurante.comandas c on c.id = ci.comanda_id
    where c.empresa_id = v_empresa_id and c.status = 'PAGA' and c.dia_operacional between v_desde and v_ate
      and ci.status <> 'CANCELADO';

  select coalesce(sum(valor_centavos),0)::int into v_despesas
    from restaurante.contas
    where empresa_id = v_empresa_id and tipo = 'PAGAR' and vencimento between v_desde and v_ate;

  return jsonb_build_object(
    'mes', to_char(v_desde, 'YYYY-MM'),
    'faturamento', v_faturamento,
    'cmv', v_cmv,
    'despesas', v_despesas,
    'resultado', v_faturamento - v_cmv - v_despesas
  );
end;
$$;

-- ========================================================================
-- 0.6 — QR Code por mesa com token (não dá mais pra "trocar o número da
-- URL" e abrir pedido em outra mesa usando o QR impresso em qualquer uma)
-- ========================================================================

alter table restaurante.mesas add column if not exists qr_token uuid not null default gen_random_uuid();
create unique index if not exists idx_mesas_qr_token on restaurante.mesas (qr_token);

create or replace function restaurante.rotacionar_qr_mesa(p_mesa_id uuid)
returns restaurante.mesas
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_mesa restaurante.mesas%rowtype;
begin
  if not restaurante.tem_permissao('admin.cardapio.editar') then
    raise exception 'Sem permissão para gerar novo QR';
  end if;
  update restaurante.mesas set qr_token = gen_random_uuid()
    where id = p_mesa_id and empresa_id = v_empresa_id
    returning * into v_mesa;
  if not found then
    raise exception 'Mesa não encontrada';
  end if;
  return v_mesa;
end;
$$;

revoke all on function restaurante.rotacionar_qr_mesa(uuid) from public;
grant execute on function restaurante.rotacionar_qr_mesa(uuid) to authenticated;

create or replace function restaurante.criar_pedido_qr(
  p_slug text, p_mesa_numero int, p_itens jsonb, p_observacao text default null, p_token uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid;
  v_empresa restaurante.empresas%rowtype;
  v_mesa restaurante.mesas%rowtype;
  v_elem jsonb;
  v_produto restaurante.produtos%rowtype;
  v_itens_final jsonb := '[]'::jsonb;
  v_qtd numeric;
  v_pedido_id uuid;
  v_ids uuid[];
  v_grupo restaurante.grupos_opcoes%rowtype;
  v_qtd_grupo int;
  v_adicional int;
  v_opcoes_final jsonb;
  v_opcao_id uuid;
  v_opcao_row record;
  v_aceita_sem_token_ate date;
begin
  select id into v_empresa_id from restaurante.empresas where slug = p_slug;
  if v_empresa_id is null then
    raise exception 'Restaurante não encontrado';
  end if;

  select * into v_mesa from restaurante.mesas where empresa_id = v_empresa_id and numero = p_mesa_numero;
  if v_mesa.id is null then
    raise exception 'Mesa não encontrada';
  end if;

  -- 0.6 — token obrigatório daqui pra frente; link antigo (só ?mesa=N,
  -- sem token — QR impresso antes desta fase) continua valendo até a
  -- data configurada em config.aceitarQrSemTokenAte (30 dias da migration,
  -- desligável antes disso em Configurações). Token ERRADO nunca é
  -- aceito, mesmo dentro do prazo — só a AUSÊNCIA de token tem carência.
  if p_token is not null then
    if p_token <> v_mesa.qr_token then
      raise exception 'QR Code inválido — peça um QR Code novo pro restaurante';
    end if;
  else
    select * into v_empresa from restaurante.empresas where id = v_empresa_id;
    v_aceita_sem_token_ate := nullif(v_empresa.config->>'aceitarQrSemTokenAte','')::date;
    if v_aceita_sem_token_ate is null or current_date > v_aceita_sem_token_ate then
      raise exception 'QR Code desatualizado — peça um QR Code novo pro restaurante';
    end if;
  end if;

  if jsonb_array_length(p_itens) = 0 then
    raise exception 'Pedido vazio';
  end if;

  for v_elem in select * from jsonb_array_elements(p_itens)
  loop
    select * into v_produto from restaurante.produtos
      where id = (v_elem->>'produto_id')::uuid and empresa_id = v_empresa_id;
    if not found or not v_produto.ativo or v_produto.esgotado then
      raise exception 'Produto indisponível no cardápio';
    end if;
    v_qtd := (v_elem->>'quantidade')::numeric;
    if not (v_qtd > 0) then
      raise exception 'Quantidade inválida';
    end if;

    select coalesce(array_agg((elem->>'opcao_id')::uuid), '{}') into v_ids
      from jsonb_array_elements(coalesce(v_elem->'opcoes_selecionadas', '[]'::jsonb)) elem;

    for v_grupo in select * from restaurante.grupos_opcoes where produto_id = v_produto.id
    loop
      select count(*) into v_qtd_grupo
        from restaurante.opcoes o
        where o.grupo_id = v_grupo.id and o.id = any(v_ids);
      if v_grupo.obrigatorio and v_qtd_grupo < v_grupo.minimo then
        raise exception 'Escolha pelo menos % opção(ões) em "%" para "%"', v_grupo.minimo, v_grupo.nome, v_produto.nome;
      end if;
      if v_qtd_grupo > v_grupo.maximo then
        raise exception 'No máximo % opção(ões) em "%" para "%"', v_grupo.maximo, v_grupo.nome, v_produto.nome;
      end if;
    end loop;

    v_adicional := 0;
    v_opcoes_final := '[]'::jsonb;
    if array_length(v_ids, 1) is not null then
      for v_opcao_id in select unnest(v_ids)
      loop
        select o.id, o.nome, o.preco_adicional_centavos, o.ativo, g.produto_id as prod_id
          into v_opcao_row
          from restaurante.opcoes o
          join restaurante.grupos_opcoes g on g.id = o.grupo_id
          where o.id = v_opcao_id;
        if not found or v_opcao_row.prod_id <> v_produto.id or not v_opcao_row.ativo then
          raise exception 'Opção inválida para "%"', v_produto.nome;
        end if;
        v_adicional := v_adicional + v_opcao_row.preco_adicional_centavos;
        v_opcoes_final := v_opcoes_final || jsonb_build_object(
          'opcao_id', v_opcao_row.id, 'nome', v_opcao_row.nome,
          'preco_adicional_centavos', v_opcao_row.preco_adicional_centavos
        );
      end loop;
    end if;

    v_itens_final := v_itens_final || jsonb_build_object(
      'produto_id', v_produto.id, 'nome', v_produto.nome,
      'quantidade', v_qtd, 'preco_unit_centavos', v_produto.preco_centavos + v_adicional,
      'opcoes_selecionadas', v_opcoes_final
    );
  end loop;

  insert into restaurante.pedidos_qr (empresa_id, mesa_id, itens, observacao)
  values (v_empresa_id, v_mesa.id, v_itens_final, nullif(trim(coalesce(p_observacao,'')),''))
  returning id into v_pedido_id;

  return v_pedido_id;
exception
  when unique_violation then
    raise exception 'Essa mesa já tem um pedido aguardando confirmação do garçom';
end;
$$;

revoke all on function restaurante.criar_pedido_qr(text, int, jsonb, text, uuid) from public;
grant execute on function restaurante.criar_pedido_qr(text, int, jsonb, text, uuid) to anon, authenticated;

drop function if exists restaurante.criar_pedido_qr(text, int, jsonb, text);

-- data-limite inicial da carência: 30 dias a partir de quando esta
-- migration roda. Null = "sempre aceita sem token" nunca deveria
-- acontecer; aqui garante que todo restaurante já existente começa com a
-- carência de 30 dias (nunca sem data nenhuma, que seria "aceita pra
-- sempre" por engano se o config não tivesse essa chave ainda).
update restaurante.empresas
  set config = jsonb_set(config, '{aceitarQrSemTokenAte}', to_jsonb((current_date + 30)::text))
  where config->>'aceitarQrSemTokenAte' is null;

-- ========================================================================
-- 0.7 — 2FA (aal2) obrigatório pra operação sensível de ADMIN quando a
-- conta tem MFA cadastrado
-- ========================================================================
-- Só entra na jogada se o usuário TIVER MFA ativo — sem isso, bloquear
-- aal2 travaria todo mundo que nunca configurou (aal1 é o teto de quem
-- não tem segundo fator). Checa auth.mfa_factors direto (tabela interna
-- do GoTrue) em vez de confiar só no claim do JWT, porque o JWT é o
-- token emitido NO LOGIN — se o usuário cadastrou MFA depois de logar e
-- não relogou, o claim antigo não reflete isso; a tabela sim.

create or replace function restaurante.exige_aal2_se_mfa_ativo()
returns void
language plpgsql
security definer
set search_path = restaurante, auth, pg_temp
as $$
declare
  v_tem_mfa boolean;
  v_aal text;
begin
  select count(*) > 0 into v_tem_mfa from auth.mfa_factors
    where user_id = auth.uid() and status = 'verified';
  if v_tem_mfa then
    v_aal := coalesce(auth.jwt()->>'aal', 'aal1');
    if v_aal <> 'aal2' then
      raise exception 'Esta ação exige verificação em duas etapas — faça login de novo confirmando o código do app autenticador';
    end if;
  end if;
end;
$$;

revoke all on function restaurante.exige_aal2_se_mfa_ativo() from public;

create or replace function restaurante.criar_funcionario(p_nome text, p_papel restaurante.papel_usuario, p_pin text)
returns uuid
language plpgsql
security definer
set search_path = restaurante, extensions, pg_temp
as $$
declare
  v_email text;
  v_slug text;
  v_service_key text;
  v_project_url text;
  v_resposta extensions.http_response;
  v_body jsonb;
  v_new_id uuid;
begin
  if not restaurante.tem_permissao('admin.equipe.editar') then
    raise exception 'Sem permissão para criar usuários';
  end if;
  perform restaurante.exige_aal2_se_mfa_ativo();
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

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_service_key is null then
    raise exception 'Chave de serviço não configurada no Vault';
  end if;
  select coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'project_url'),
    'https://ybsyhjqtwiwomtxbloyu.supabase.co'
  ) into v_project_url;

  select * into v_resposta from extensions.http((
    'POST',
    v_project_url || '/auth/v1/admin/users',
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

create or replace function restaurante.trocar_pin_funcionario(p_usuario_id uuid, p_novo_pin text)
returns void
language plpgsql
security definer
set search_path = restaurante, extensions, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_alvo restaurante.usuarios%rowtype;
  v_service_key text;
  v_project_url text;
  v_resposta extensions.http_response;
begin
  if not restaurante.tem_permissao('admin.equipe.editar') then
    raise exception 'Sem permissão para alterar PIN';
  end if;
  perform restaurante.exige_aal2_se_mfa_ativo();
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
  select coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'project_url'),
    'https://ybsyhjqtwiwomtxbloyu.supabase.co'
  ) into v_project_url;

  select * into v_resposta from extensions.http((
    'PUT',
    v_project_url || '/auth/v1/admin/users/' || p_usuario_id::text,
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

create or replace function restaurante.relatorio_exportacao_contador(p_mes date)
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_desde date := date_trunc('month', p_mes)::date;
  v_ate date := (date_trunc('month', p_mes) + interval '1 month' - interval '1 day')::date;
  v_vendas jsonb;
  v_contas jsonb;
  v_fechamentos jsonb;
begin
  if not restaurante.tem_permissao('admin.financeiro.ver') then
    raise exception 'Sem permissão para exportar dados financeiros';
  end if;
  perform restaurante.exige_aal2_se_mfa_ativo();

  select coalesce(jsonb_agg(row_to_json(v)), '[]'::jsonb) into v_vendas
  from (
    select cm.forma_pagamento as forma, sum(cm.valor_centavos)::int as total, count(*) as quantidade
    from restaurante.caixa_movimentos cm
    join restaurante.caixa_sessoes cs on cs.id = cm.sessao_id
    where cs.empresa_id = v_empresa_id and cm.tipo = 'VENDA'
      and cm.created_at::date between v_desde and v_ate
    group by cm.forma_pagamento
    order by cm.forma_pagamento
  ) v;

  select coalesce(jsonb_agg(row_to_json(c) order by c.vencimento), '[]'::jsonb) into v_contas
  from (
    select tipo, descricao, categoria, valor_centavos, vencimento, pago_em
    from restaurante.contas
    where empresa_id = v_empresa_id
      and (vencimento between v_desde and v_ate or (pago_em is not null and pago_em::date between v_desde and v_ate))
  ) c;

  select coalesce(jsonb_agg(row_to_json(f) order by f.fechamento_em), '[]'::jsonb) into v_fechamentos
  from (
    select terminal, abertura_em, fechamento_em, saldo_inicial_centavos,
      saldo_calculado_centavos, saldo_informado_centavos, diferenca_centavos
    from restaurante.caixa_sessoes
    where empresa_id = v_empresa_id and status = 'FECHADA'
      and fechamento_em::date between v_desde and v_ate
  ) f;

  return jsonb_build_object(
    'mes', to_char(v_desde, 'YYYY-MM'),
    'vendas_por_forma', v_vendas,
    'contas', v_contas,
    'fechamentos_caixa', v_fechamentos
  );
end;
$$;

-- Configurações (empresas.config) também é operação sensível de ADMIN —
-- mas é escrita direto pelo client (sb.from("empresas").update(...)), não
-- uma RPC. Trigger BEFORE UPDATE cobre o mesmo caso sem precisar
-- converter a tela inteira de Configurações pra RPC.
create or replace function restaurante.trg_empresas_exige_aal2()
returns trigger
language plpgsql
set search_path = restaurante, pg_temp
as $$
begin
  if new.config is distinct from old.config or new.nome is distinct from old.nome or new.cnpj is distinct from old.cnpj then
    perform restaurante.exige_aal2_se_mfa_ativo();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_empresas_exige_aal2 on restaurante.empresas;
create trigger trg_empresas_exige_aal2
  before update on restaurante.empresas
  for each row execute function restaurante.trg_empresas_exige_aal2();

-- Ativar/desativar funcionário e trocar papel também são escritas diretas
-- do client (sb.from("usuarios").update(...)), não RPC — mesmo tratamento
-- da trigger acima, cobrindo o resto do que 0.7 pede ("funcionários").
create or replace function restaurante.trg_usuarios_exige_aal2()
returns trigger
language plpgsql
set search_path = restaurante, pg_temp
as $$
begin
  if new.ativo is distinct from old.ativo or new.papel is distinct from old.papel then
    perform restaurante.exige_aal2_se_mfa_ativo();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_usuarios_exige_aal2 on restaurante.usuarios;
create trigger trg_usuarios_exige_aal2
  before update on restaurante.usuarios
  for each row execute function restaurante.trg_usuarios_exige_aal2();

-- ========================================================================
-- 0.10 — registro de erros do front-end
-- ========================================================================

create table if not exists restaurante.erros_cliente (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references restaurante.empresas(id) on delete cascade,
  usuario_id uuid references restaurante.usuarios(id) on delete set null,
  tela text,
  mensagem text not null,
  stack_resumido text,
  versao text,
  created_at timestamptz not null default now()
);
create index if not exists idx_erros_cliente_empresa on restaurante.erros_cliente (empresa_id, created_at desc);

alter table restaurante.erros_cliente enable row level security;
-- Sem policy de select pro client (só quem olha é quem tem acesso direto
-- ao banco) — é log técnico, não dado de produto.

create or replace function restaurante.registrar_erro_cliente(
  p_tela text, p_mensagem text, p_stack_resumido text default null, p_versao text default null
)
returns void
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_contagem int;
begin
  if v_usuario_id is null then
    return; -- erro antes do login não tem pra quem atribuir; descarta
  end if;
  -- 20/min por sessão: conta os erros do mesmo usuário no último minuto.
  select count(*) into v_contagem from restaurante.erros_cliente
    where usuario_id = v_usuario_id and created_at > now() - interval '1 minute';
  if v_contagem >= 20 then
    return;
  end if;
  insert into restaurante.erros_cliente (empresa_id, usuario_id, tela, mensagem, stack_resumido, versao)
  values (v_empresa_id, v_usuario_id, left(coalesce(p_tela,''),100), left(p_mensagem,2000), left(coalesce(p_stack_resumido,''),2000), left(coalesce(p_versao,''),50));
end;
$$;

revoke all on function restaurante.registrar_erro_cliente(text, text, text, text) from public;
grant execute on function restaurante.registrar_erro_cliente(text, text, text, text) to authenticated;

-- ========================================================================
-- 0.5 — conflitos de sincronização offline
-- ========================================================================

create table if not exists restaurante.sync_conflitos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  comanda_id uuid references restaurante.comandas(id) on delete set null,
  tipo text not null check (tipo in ('pagamento')),
  payload jsonb not null,
  motivo text,
  status text not null default 'PENDENTE' check (status in ('PENDENTE','APLICADO','DESCARTADO')),
  resolvido_por uuid references restaurante.usuarios(id) on delete set null,
  resolvido_em timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_sync_conflitos_empresa on restaurante.sync_conflitos (empresa_id, status);

alter table restaurante.sync_conflitos enable row level security;
create policy sync_conflitos_select on restaurante.sync_conflitos for select
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.sync_conflitos.resolver'));

insert into restaurante.papeis_permissoes (papel, permissao) values
  ('ADMIN', 'admin.sync_conflitos.resolver'), ('GERENTE', 'admin.sync_conflitos.resolver')
on conflict (papel, permissao) do nothing;

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

revoke all on function restaurante.resolver_sync_conflito(uuid, boolean) from public;
grant execute on function restaurante.resolver_sync_conflito(uuid, boolean) to authenticated;
