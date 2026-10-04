-- Fase 2.5 [NOVO] — Taxas das maquininhas.
--
-- Cadastro de taxa (%) e prazo de recebimento (dias) por forma de
-- pagamento (débito, crédito, voucher) em empresas.config.taxasMaquininha.
-- confirmar_pagamento passa a gerar a conta a receber já com o valor
-- LÍQUIDO (descontada a taxa) e vencimento no prazo configurado — antes só
-- crédito/voucher geravam conta a receber (30 dias fixo, valor bruto);
-- débito também passa a gerar (hoje normalmente D+1, mas configurável).
-- Dinheiro em caixa (caixa_movimentos) continua registrando o valor BRUTO
-- — é o que entrou na gaveta/extrato na hora; a taxa só desconta o que
-- finalmente cai na conta.

create or replace function restaurante.confirmar_pagamento(
  p_comanda_id uuid,
  p_linhas jsonb,
  p_fiado_cliente text default null,
  p_item_ids uuid[] default null,
  p_sessao_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_comanda restaurante.comandas%rowtype;
  v_empresa restaurante.empresas%rowtype;
  v_sessao restaurante.caixa_sessoes%rowtype;
  v_mesa restaurante.mesas%rowtype;
  v_rotulo text;
  v_subtotal int := 0;
  v_desconto int := 0;
  v_taxa_pct numeric;
  v_taxa int;
  v_total int;
  v_soma int := 0;
  v_troco int;
  v_troco_restante int;
  v_linha jsonb;
  v_forma text;
  v_valor int;
  v_tem_fiado boolean := false;
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

  select coalesce(sum(preco_unit_centavos * quantidade), 0)::int into v_subtotal
    from restaurante.comanda_itens
    where comanda_id = p_comanda_id and status <> 'CANCELADO' and pago_em is null
      and (p_item_ids is null or id = any(p_item_ids));

  if v_subtotal = 0 then
    raise exception 'Não há itens pendentes de pagamento nesta seleção';
  end if;

  v_desconto := case when p_item_ids is null then coalesce(v_comanda.desconto_centavos, 0) else 0 end;
  v_taxa_pct := case when v_comanda.taxa_servico_ativa
    then coalesce((v_empresa.config->>'taxaServicoPctPadrao')::numeric, 10)
    else 0 end;
  v_taxa := round((v_subtotal - v_desconto) * v_taxa_pct / 100.0)::int;
  v_total := greatest(0, v_subtotal - v_desconto + v_taxa);

  select coalesce(sum((l->>'valor_centavos')::int), 0) into v_soma
    from jsonb_array_elements(p_linhas) l;
  if v_soma < v_total then
    raise exception 'Faltam % centavos para cobrir o total', (v_total - v_soma);
  end if;

  select coalesce(bool_or(l->>'forma' = 'FIADO'), false) into v_tem_fiado
    from jsonb_array_elements(p_linhas) l;
  if v_tem_fiado and coalesce(trim(p_fiado_cliente), '') = '' then
    raise exception 'Informe o nome do cliente para gerar a conta a receber do fiado';
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

  update restaurante.comanda_itens
    set pago_em = v_fechamento
    where comanda_id = p_comanda_id and status <> 'CANCELADO' and pago_em is null
      and (p_item_ids is null or id = any(p_item_ids));

  select count(*) into v_restantes from restaurante.comanda_itens
    where comanda_id = p_comanda_id and status <> 'CANCELADO' and pago_em is null;
  v_fechou := (v_restantes = 0);

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

  for v_linha in select * from jsonb_array_elements(p_linhas)
  loop
    insert into restaurante.pagamentos (comanda_id, sessao_id, forma, valor_centavos)
    values (p_comanda_id, v_sessao.id, v_linha->>'forma', (v_linha->>'valor_centavos')::int)
    returning * into v_pag_row;
    v_pagamentos := v_pagamentos || to_jsonb(v_pag_row);
  end loop;

  -- caixa_movimentos registra o BRUTO (o que efetivamente entrou agora)
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

  -- contas a receber: fiado (texto livre, prazo fixo de 7 dias, valor
  -- cheio) e débito/crédito/voucher (valor líquido da taxa configurada,
  -- prazo configurado — 0 se a forma não tiver taxa cadastrada)
  select * into v_mesa from restaurante.mesas where id = v_comanda.mesa_id;
  v_rotulo := case
    when v_comanda.tipo = 'BALCAO' then 'Balcão'
    when v_comanda.tipo = 'FICHA' then 'Ficha ' || v_comanda.ficha_numero::text
    else 'Mesa ' || coalesce(v_mesa.numero::text,'?')
  end;
  for v_linha in select * from jsonb_array_elements(p_linhas)
  loop
    v_forma := v_linha->>'forma';
    if v_forma = 'FIADO' then
      insert into restaurante.contas (empresa_id, tipo, descricao, categoria, valor_centavos, vencimento)
      values (
        v_empresa_id, 'RECEBER',
        'Fiado — ' || trim(p_fiado_cliente) || ' — ' || v_rotulo || ' · ' || v_comanda.codigo,
        'Fiado', (v_linha->>'valor_centavos')::int, current_date + 7
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

  if v_fechou then
    for v_item in
      select * from restaurante.comanda_itens
      where comanda_id = p_comanda_id
        and not (status = 'CANCELADO' and not cancelado_apos_preparo)
    loop
      for v_ficha in
        select * from restaurante.ficha_tecnica where produto_id = v_item.produto_id
      loop
        v_qtd := v_ficha.quantidade * v_item.quantidade;
        update restaurante.insumos
          set estoque_atual = greatest(0, estoque_atual - v_qtd)
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
          v_qtd := v_ficha.quantidade * v_item.quantidade;
          update restaurante.insumos
            set estoque_atual = greatest(0, estoque_atual - v_qtd)
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
    end loop;
  end if;

  insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
  values (v_empresa_id, v_usuario_id, 'comanda', p_comanda_id,
    case when v_fechou then 'PAGAMENTO_CONFIRMADO' else 'PAGAMENTO_PARCIAL_CONFIRMADO' end,
    v_comanda.codigo || ' · ' || v_total::text || ' centavos' || (case when v_fechou then '' else ' (parcial)' end));

  select * into v_comanda from restaurante.comandas where id = p_comanda_id;

  return jsonb_build_object(
    'comanda', to_jsonb(v_comanda),
    'fechou', v_fechou,
    'pagamentos', v_pagamentos,
    'caixa_movimentos', v_movimentos,
    'contas', v_contas,
    'estoque_movimentos', v_estoque_movs
  );
end;
$$;

revoke all on function restaurante.confirmar_pagamento(uuid, jsonb, text, uuid[], uuid) from public;
grant execute on function restaurante.confirmar_pagamento(uuid, jsonb, text, uuid[], uuid) to authenticated;

-- ---------- relatório de quanto foi pago em taxas, por forma ----------

create or replace function restaurante.relatorio_taxas_maquininha(p_desde date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_config jsonb;
  v_resultado jsonb;
begin
  if not restaurante.tem_permissao('admin.relatorios.ver') then
    raise exception 'Sem permissão para ver relatórios';
  end if;

  select config->'taxasMaquininha' into v_config from restaurante.empresas where id = v_empresa_id;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_resultado
  from (
    select cm.forma_pagamento as forma,
      sum(cm.valor_centavos)::int as bruto,
      coalesce((v_config->cm.forma_pagamento->>'pct')::numeric, 0) as taxa_pct,
      round(sum(cm.valor_centavos) * coalesce((v_config->cm.forma_pagamento->>'pct')::numeric, 0) / 100.0)::int as taxa_paga
    from restaurante.caixa_movimentos cm
    join restaurante.caixa_sessoes cs on cs.id = cm.sessao_id
    where cs.empresa_id = v_empresa_id and cm.tipo = 'VENDA'
      and cm.forma_pagamento in ('DEBITO','CREDITO','VOUCHER')
      and cm.created_at::date between p_desde and p_ate
    group by cm.forma_pagamento
  ) t;

  return coalesce(v_resultado, '[]'::jsonb);
end;
$$;

revoke all on function restaurante.relatorio_taxas_maquininha(date, date) from public;
grant execute on function restaurante.relatorio_taxas_maquininha(date, date) to authenticated;
