-- Fase 5 (continuação) — Marketing: cupons/promoções, clientes inativos
-- (reativação) e banner de destaque no cardápio público. Primeira peça do
-- menu em grupos (migration anterior foi só front-end) a precisar de banco.
--
-- Permissão nova: admin.marketing.editar (ADMIN/GERENTE, mesmo padrão de
-- admin.clientes.editar).

insert into restaurante.papeis_permissoes (papel, permissao) values
  ('ADMIN', 'admin.marketing.editar'), ('GERENTE', 'admin.marketing.editar')
on conflict (papel, permissao) do nothing;

-- ---------- cupons ----------
-- Cupom aplica desconto (percentual ou valor fixo) no fechamento da conta
-- inteira, junto com o restante do fluxo de pagamento — nunca com
-- pagamento parcial por item (mesma trava já usada pra pontos de
-- fidelidade e desconto manual da comanda, pra não ter que decidir "de
-- quem" é o desconto quando a conta é dividida).

create table restaurante.cupons (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  codigo text not null,
  tipo text not null check (tipo in ('PERCENTUAL','VALOR_FIXO')),
  valor int not null check (valor > 0),
  valido_de date,
  valido_ate date,
  usos_max int check (usos_max is null or usos_max > 0),
  usos_atuais int not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  check (tipo <> 'PERCENTUAL' or valor <= 100)
);
create unique index idx_cupons_codigo on restaurante.cupons (empresa_id, upper(codigo));

alter table restaurante.cupons enable row level security;
create policy cupons_select on restaurante.cupons for select
  using (empresa_id = restaurante.jwt_empresa_id());
create policy cupons_write on restaurante.cupons for all
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.marketing.editar'))
  with check (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.marketing.editar'));

create trigger trg_cupons_auditoria
  after insert or update or delete on restaurante.cupons
  for each row execute function restaurante.fn_audit_trigger();

-- ---------- confirmar_pagamento ganha p_cupom_codigo ----------
-- Mesma função de sempre (0045→...→0058), só acrescentando a validação e
-- aplicação do cupom — desconto da comanda, desconto de pontos resgatados
-- e desconto de cupom empilham (somam), igual pontos já empilhava com
-- desconto manual desde a 0058.

create or replace function restaurante.confirmar_pagamento(
  p_comanda_id uuid,
  p_linhas jsonb,
  p_cliente_id uuid default null,
  p_item_ids uuid[] default null,
  p_sessao_id uuid default null,
  p_pontos_resgatados int default 0,
  p_cupom_codigo text default null
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
  v_cliente restaurante.clientes%rowtype;
  v_cupom restaurante.cupons%rowtype;
  v_rotulo text;
  v_subtotal int := 0;
  v_desconto int := 0;
  v_desconto_pontos int := 0;
  v_desconto_cupom int := 0;
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
  v_pontos_por_real numeric;
  v_valor_ponto_centavos int;
  v_pontos_ganhos int;
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

  if p_item_ids is not null and p_pontos_resgatados > 0 then
    raise exception 'Resgate de pontos só vale fechando a conta inteira';
  end if;
  if p_item_ids is not null and p_cupom_codigo is not null then
    raise exception 'Cupom só vale fechando a conta inteira';
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

  -- cliente: opcional em qualquer forma (pontos de fidelidade), mas
  -- obrigatório se tiver linha FIADO
  select coalesce(bool_or(l->>'forma' = 'FIADO'), false) into v_tem_fiado
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

  if p_pontos_resgatados > 0 then
    if p_pontos_resgatados > v_cliente.pontos_fidelidade then
      raise exception 'Cliente só tem % pontos disponíveis', v_cliente.pontos_fidelidade;
    end if;
    v_valor_ponto_centavos := coalesce((v_empresa.config->'fidelidade'->>'valorPontoCentavos')::int, 0);
    v_desconto_pontos := p_pontos_resgatados * v_valor_ponto_centavos;
  end if;

  select coalesce(sum(preco_unit_centavos * quantidade), 0)::int into v_subtotal
    from restaurante.comanda_itens
    where comanda_id = p_comanda_id and status <> 'CANCELADO' and pago_em is null
      and (p_item_ids is null or id = any(p_item_ids));

  if v_subtotal = 0 then
    raise exception 'Não há itens pendentes de pagamento nesta seleção';
  end if;

  v_desconto := case when p_item_ids is null then coalesce(v_comanda.desconto_centavos, 0) else 0 end;

  if p_cupom_codigo is not null then
    select * into v_cupom from restaurante.cupons
      where empresa_id = v_empresa_id and upper(codigo) = upper(trim(p_cupom_codigo))
      for update;
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

  select coalesce(sum((l->>'valor_centavos')::int), 0) into v_soma
    from jsonb_array_elements(p_linhas) l;
  if v_soma < v_total then
    raise exception 'Faltam % centavos para cobrir o total', (v_total - v_soma);
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

  -- fidelidade: resgata (se pediu) e ganha pontos sobre o que foi pago
  -- nesta chamada (parcial ou não) — nunca sobre o valor bruto, pra não
  -- dar ponto em cima de desconto que o próprio ponto (ou cupom) gerou.
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
    v_comanda.codigo || ' · ' || v_total::text || ' centavos' || (case when v_fechou then '' else ' (parcial)' end)
      || (case when v_cupom.id is not null then ' · cupom ' || v_cupom.codigo else '' end));

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

revoke all on function restaurante.confirmar_pagamento(uuid, jsonb, uuid, uuid[], uuid, int, text) from public;
grant execute on function restaurante.confirmar_pagamento(uuid, jsonb, uuid, uuid[], uuid, int, text) to authenticated;

drop function if exists restaurante.confirmar_pagamento(uuid, jsonb, uuid, uuid[], uuid, int);

-- ---------- clientes inativos (reativação) ----------

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
    select cl.id, cl.nome, cl.telefone, cl.pontos_fidelidade,
      max(co.fechamento) as ultima_compra,
      (current_date - max(co.fechamento)::date) as dias_sem_comprar
    from restaurante.clientes cl
    left join restaurante.comandas co on co.cliente_id = cl.id and co.status = 'PAGA'
    where cl.empresa_id = v_empresa_id
    group by cl.id, cl.nome, cl.telefone, cl.pontos_fidelidade
    having max(co.fechamento) is null or max(co.fechamento) < now() - (p_dias || ' days')::interval
  ) c;

  return v_resultado;
end;
$$;

revoke all on function restaurante.relatorio_clientes_inativos(int) from public;
grant execute on function restaurante.relatorio_clientes_inativos(int) to authenticated;

-- ---------- banner de destaque no cardápio público ----------
-- Só 3 campos seguros ficam públicos (texto, se está ativo, e qual produto
-- destacar) — nunca o config inteiro, que tem taxa de maquininha, limites
-- de caixa etc.

create or replace view restaurante.cardapio_publico_empresa as
select id, slug, nome,
  coalesce((config->'marketing'->>'bannerAtivo')::boolean, false) as banner_ativo,
  config->'marketing'->>'bannerTexto' as banner_texto,
  nullif(config->'marketing'->>'produtoDestaqueId','')::uuid as produto_destaque_id
from restaurante.empresas;

grant select on restaurante.cardapio_publico_empresa to anon, authenticated;
