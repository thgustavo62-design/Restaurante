-- Fase 0.5 — Relatórios confiáveis.
--
-- totaisComanda() no client sempre aplicava a taxa de serviço ATUAL
-- (state.config.taxaServicoPctPadrao) pra recalcular o total de QUALQUER
-- comanda, inclusive as já pagas há meses — mudar a taxa hoje reescrevia
-- o histórico de vendas inteiro nos relatórios. E a aba "Tudo" carregava
-- até 10 anos de comandas+itens completos no navegador.
--
-- comandas.total_centavos congela o valor de verdade cobrado no momento
-- do pagamento (gravado por confirmar_pagamento, nunca recalculado
-- depois). relatorio_vendas() agrega tudo no banco, com período limitado
-- e "desempenho por garçom" olhando quem LANÇOU cada item
-- (comanda_itens.usuario_id), não só quem abriu a mesa.

alter table restaurante.comandas add column if not exists total_centavos int;

-- backfill best-effort pras comandas já pagas antes desta migration — usa
-- a taxa de serviço ATUAL da empresa pra reconstituir o total, então é só
-- uma aproximação pra não deixar o campo vazio (a comanda não guarda a
-- taxa vigente em cada venda histórica). Dali pra frente é sempre o valor
-- real travado no momento do pagamento.
do $$
declare
  v_c record;
  v_subtotal int;
  v_taxa_pct numeric;
  v_taxa int;
  v_total int;
begin
  for v_c in
    select c.id, c.desconto_centavos, c.taxa_servico_ativa, c.empresa_id
    from restaurante.comandas c
    where c.status = 'PAGA' and c.total_centavos is null
  loop
    select coalesce(sum(preco_unit_centavos*quantidade),0)::int into v_subtotal
      from restaurante.comanda_itens where comanda_id = v_c.id and status <> 'CANCELADO';
    select coalesce((config->>'taxaServicoPctPadrao')::numeric,10) into v_taxa_pct
      from restaurante.empresas where id = v_c.empresa_id;
    if not v_c.taxa_servico_ativa then v_taxa_pct := 0; end if;
    v_taxa := round((v_subtotal - coalesce(v_c.desconto_centavos,0)) * v_taxa_pct / 100.0)::int;
    v_total := greatest(0, v_subtotal - coalesce(v_c.desconto_centavos,0) + v_taxa);
    update restaurante.comandas set total_centavos = v_total where id = v_c.id;
  end loop;
end $$;

-- ---------- confirmar_pagamento passa a gravar o total travado ----------

create or replace function restaurante.confirmar_pagamento(
  p_comanda_id uuid,
  p_linhas jsonb,
  p_fiado_cliente text default null
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
  v_desconto int;
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

  select * into v_empresa from restaurante.empresas where id = v_empresa_id;

  select coalesce(sum(preco_unit_centavos * quantidade), 0)::int into v_subtotal
    from restaurante.comanda_itens
    where comanda_id = p_comanda_id and status <> 'CANCELADO';

  v_desconto := coalesce(v_comanda.desconto_centavos, 0);
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

  select * into v_sessao from restaurante.caixa_sessoes
    where empresa_id = v_empresa_id and status = 'ABERTA'
    order by abertura_em desc limit 1
    for update;
  if not found then
    raise exception 'Abra o caixa antes de registrar pagamentos';
  end if;

  v_troco := v_soma - v_total;

  perform set_config('restaurante.bypass_protecao', 'true', true);
  update restaurante.comandas
    set status = 'PAGA', fechamento = v_fechamento, troco_centavos = v_troco, total_centavos = v_total
    where id = p_comanda_id;

  -- pagamentos
  for v_linha in select * from jsonb_array_elements(p_linhas)
  loop
    insert into restaurante.pagamentos (comanda_id, sessao_id, forma, valor_centavos)
    values (p_comanda_id, v_sessao.id, v_linha->>'forma', (v_linha->>'valor_centavos')::int)
    returning * into v_pag_row;
    v_pagamentos := v_pagamentos || to_jsonb(v_pag_row);
  end loop;

  -- caixa_movimentos (VENDA), descontando o troco da(s) linha(s) em DINHEIRO
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

  -- contas a receber (fiado/crédito/voucher)
  select * into v_mesa from restaurante.mesas where id = v_comanda.mesa_id;
  v_rotulo := case
    when v_comanda.tipo = 'BALCAO' then 'Balcão'
    when v_comanda.tipo = 'FICHA' then 'Ficha ' || v_comanda.ficha_numero::text
    else 'Mesa ' || coalesce(v_mesa.numero::text,'?')
  end;
  for v_linha in select * from jsonb_array_elements(p_linhas)
  loop
    v_forma := v_linha->>'forma';
    if v_forma in ('FIADO','CREDITO','VOUCHER') then
      insert into restaurante.contas (empresa_id, tipo, descricao, categoria, valor_centavos, vencimento)
      values (
        v_empresa_id, 'RECEBER',
        case when v_forma = 'FIADO'
          then 'Fiado — ' || trim(p_fiado_cliente) || ' — ' || v_rotulo || ' · ' || v_comanda.codigo
          else v_forma || ' — ' || v_rotulo || ' · ' || v_comanda.codigo
        end,
        case when v_forma = 'FIADO' then 'Fiado' else 'Recebíveis de cartão/voucher' end,
        (v_linha->>'valor_centavos')::int,
        current_date + (case when v_forma = 'FIADO' then 7 else 30 end)
      )
      returning * into v_conta_row;
      v_contas := v_contas || to_jsonb(v_conta_row);
    end if;
  end loop;

  -- baixa de estoque por ficha técnica (UPDATE atômico — sem corrida)
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
  end loop;

  insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
  values (v_empresa_id, v_usuario_id, 'comanda', p_comanda_id, 'PAGAMENTO_CONFIRMADO',
    v_comanda.codigo || ' · ' || v_total::text || ' centavos');

  select * into v_comanda from restaurante.comandas where id = p_comanda_id;

  return jsonb_build_object(
    'comanda', to_jsonb(v_comanda),
    'pagamentos', v_pagamentos,
    'caixa_movimentos', v_movimentos,
    'contas', v_contas,
    'estoque_movimentos', v_estoque_movs
  );
end;
$$;

revoke all on function restaurante.confirmar_pagamento(uuid, jsonb, text) from public;
grant execute on function restaurante.confirmar_pagamento(uuid, jsonb, text) to authenticated;

-- ---------- total_centavos também vira campo imutável (trigger 0038/0043) ----------

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
     or new.total_centavos is distinct from old.total_centavos then
    raise exception 'Campo somente leitura da comanda não pode ser alterado';
  end if;

  return new;
end;
$$;

-- ---------- relatorio_vendas: agregação no banco, período limitado ----------

create or replace function restaurante.relatorio_vendas(p_desde date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_total_vendas int;
  v_num_contas int;
  v_ranking jsonb;
  v_garcons jsonb;
begin
  if not restaurante.tem_permissao('admin.relatorios.ver') then
    raise exception 'Sem permissão para ver relatórios';
  end if;
  if p_ate < p_desde or (p_ate - p_desde) > 366 then
    raise exception 'Período inválido (máximo de 1 ano)';
  end if;

  select coalesce(sum(total_centavos),0)::int, count(*) into v_total_vendas, v_num_contas
    from restaurante.comandas
    where empresa_id = v_empresa_id and status = 'PAGA'
      and dia_operacional between p_desde and p_ate;

  select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb) into v_ranking
  from (
    select ci.nome, sum(ci.quantidade) as qtd, sum(ci.preco_unit_centavos*ci.quantidade)::int as total
    from restaurante.comanda_itens ci
    join restaurante.comandas c on c.id = ci.comanda_id
    where c.empresa_id = v_empresa_id and c.status = 'PAGA'
      and c.dia_operacional between p_desde and p_ate
      and ci.status <> 'CANCELADO'
    group by ci.nome
    order by total desc
    limit 10
  ) r;

  -- "desempenho por garçom" olha quem LANÇOU cada item (comanda_itens.usuario_id),
  -- não quem abriu a comanda — um garçom pode lançar em mesa aberta por outro.
  select coalesce(jsonb_agg(row_to_json(g)), '[]'::jsonb) into v_garcons
  from (
    select u.nome, sum(ci.preco_unit_centavos*ci.quantidade)::int as vendas, count(distinct ci.comanda_id) as contas
    from restaurante.comanda_itens ci
    join restaurante.comandas c on c.id = ci.comanda_id
    join restaurante.usuarios u on u.id = ci.usuario_id
    where c.empresa_id = v_empresa_id and c.status = 'PAGA'
      and c.dia_operacional between p_desde and p_ate
      and ci.status <> 'CANCELADO'
    group by u.nome
    order by vendas desc
  ) g;

  return jsonb_build_object(
    'total_vendas', v_total_vendas,
    'contas_fechadas', v_num_contas,
    'ranking_produtos', v_ranking,
    'desempenho_garcons', v_garcons
  );
end;
$$;

revoke all on function restaurante.relatorio_vendas(date, date) from public;
grant execute on function restaurante.relatorio_vendas(date, date) to authenticated;
