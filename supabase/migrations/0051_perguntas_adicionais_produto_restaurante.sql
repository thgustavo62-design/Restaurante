-- Fase 1.3 [NOVO] — Perguntas e adicionais no produto.
--
-- grupos_opcoes (ex: "Ponto da carne", obrigatório, escolhe 1) e opcoes
-- dentro de cada grupo (ex: "Ao ponto", pode ter preco_adicional_centavos
-- — ex: "Bacon +R$4"). opcao_ficha_tecnica é a ficha técnica própria do
-- adicional (espelha ficha_tecnica, mas pra opção em vez de produto —
-- tabela separada porque ficha_tecnica tem PK composta (produto_id,
-- insumo_id) não nula, então não dava pra só "abrir espaço" pra opção
-- sem mexer numa constraint que já tem dado de verdade em cima).
--
-- O preço final do item (produto + adicionais escolhidos) é calculado e
-- gravado por um trigger BEFORE INSERT em comanda_itens — o client manda
-- só os opcao_id escolhidos em opcoes_selecionadas; nome e preço de cada
-- opção são sempre relidos do banco ali dentro, nunca confiados no que
-- veio da tela. O mesmo trigger bloqueia o insert se um grupo obrigatório
-- não tiver o mínimo de opções escolhidas (ex: Picanha sem ponto).

create table restaurante.grupos_opcoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  produto_id uuid not null references restaurante.produtos(id) on delete cascade,
  nome text not null,
  obrigatorio boolean not null default false,
  minimo int not null default 0,
  maximo int not null default 1,
  ordem int not null default 0,
  created_at timestamptz not null default now(),
  check (minimo >= 0 and maximo >= minimo and maximo >= 1)
);
create index idx_grupos_opcoes_produto on restaurante.grupos_opcoes (produto_id);

create table restaurante.opcoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  grupo_id uuid not null references restaurante.grupos_opcoes(id) on delete cascade,
  nome text not null,
  preco_adicional_centavos int not null default 0 check (preco_adicional_centavos >= 0),
  ordem int not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_opcoes_grupo on restaurante.opcoes (grupo_id);

create table restaurante.opcao_ficha_tecnica (
  opcao_id uuid not null references restaurante.opcoes(id) on delete cascade,
  insumo_id uuid not null references restaurante.insumos(id) on delete cascade,
  quantidade numeric not null check (quantidade > 0),
  primary key (opcao_id, insumo_id)
);

alter table restaurante.comanda_itens add column if not exists opcoes_selecionadas jsonb not null default '[]'::jsonb;

alter table restaurante.grupos_opcoes enable row level security;
create policy grupos_opcoes_select on restaurante.grupos_opcoes for select
  using (empresa_id = restaurante.jwt_empresa_id());
create policy grupos_opcoes_write on restaurante.grupos_opcoes for all
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.cardapio.editar'))
  with check (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.cardapio.editar'));
create policy grupos_opcoes_select_publico on restaurante.grupos_opcoes for select
  to anon
  using (exists (select 1 from restaurante.produtos p where p.id = grupos_opcoes.produto_id and p.ativo = true));

alter table restaurante.opcoes enable row level security;
create policy opcoes_select on restaurante.opcoes for select
  using (empresa_id = restaurante.jwt_empresa_id());
create policy opcoes_write on restaurante.opcoes for all
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.cardapio.editar'))
  with check (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.cardapio.editar'));
create policy opcoes_select_publico on restaurante.opcoes for select
  to anon
  using (
    ativo = true
    and exists (
      select 1 from restaurante.grupos_opcoes g
      join restaurante.produtos p on p.id = g.produto_id
      where g.id = opcoes.grupo_id and p.ativo = true
    )
  );

alter table restaurante.opcao_ficha_tecnica enable row level security;
create policy opcao_ficha_tecnica_select on restaurante.opcao_ficha_tecnica for select
  using (exists (
    select 1 from restaurante.opcoes o where o.id = opcao_ficha_tecnica.opcao_id
      and o.empresa_id = restaurante.jwt_empresa_id()
  ));
create policy opcao_ficha_tecnica_write on restaurante.opcao_ficha_tecnica for all
  using (restaurante.tem_permissao('admin.cardapio.editar') and exists (
    select 1 from restaurante.opcoes o where o.id = opcao_ficha_tecnica.opcao_id
      and o.empresa_id = restaurante.jwt_empresa_id()
  ))
  with check (restaurante.tem_permissao('admin.cardapio.editar') and exists (
    select 1 from restaurante.opcoes o where o.id = opcao_ficha_tecnica.opcao_id
      and o.empresa_id = restaurante.jwt_empresa_id()
  ));

-- ---------- preço final calculado no servidor, grupo obrigatório validado ----------

create or replace function restaurante.trg_comanda_itens_calcula_preco()
returns trigger
language plpgsql
set search_path = restaurante, pg_temp
as $$
declare
  v_produto restaurante.produtos%rowtype;
  v_grupo restaurante.grupos_opcoes%rowtype;
  v_qtd_grupo int;
  v_adicional int := 0;
  v_opcoes_final jsonb := '[]'::jsonb;
  v_ids uuid[];
  v_opcao_id uuid;
  v_opcao_row record;
begin
  select * into v_produto from restaurante.produtos where id = new.produto_id;
  if not found then
    raise exception 'Produto não encontrado';
  end if;

  select coalesce(array_agg((elem->>'opcao_id')::uuid), '{}') into v_ids
    from jsonb_array_elements(coalesce(new.opcoes_selecionadas, '[]'::jsonb)) elem;

  for v_grupo in select * from restaurante.grupos_opcoes where produto_id = new.produto_id
  loop
    select count(*) into v_qtd_grupo
      from restaurante.opcoes o
      where o.grupo_id = v_grupo.id and o.id = any(v_ids);
    if v_grupo.obrigatorio and v_qtd_grupo < v_grupo.minimo then
      raise exception 'Escolha pelo menos % opção(ões) em "%"', v_grupo.minimo, v_grupo.nome;
    end if;
    if v_qtd_grupo > v_grupo.maximo then
      raise exception 'No máximo % opção(ões) em "%"', v_grupo.maximo, v_grupo.nome;
    end if;
  end loop;

  if array_length(v_ids, 1) is not null then
    for v_opcao_id in select unnest(v_ids)
    loop
      select o.id, o.nome, o.preco_adicional_centavos, o.ativo, g.produto_id as prod_id
        into v_opcao_row
        from restaurante.opcoes o
        join restaurante.grupos_opcoes g on g.id = o.grupo_id
        where o.id = v_opcao_id;
      if not found or v_opcao_row.prod_id <> new.produto_id or not v_opcao_row.ativo then
        raise exception 'Opção inválida para este produto';
      end if;
      v_adicional := v_adicional + v_opcao_row.preco_adicional_centavos;
      v_opcoes_final := v_opcoes_final || jsonb_build_object(
        'opcao_id', v_opcao_row.id, 'nome', v_opcao_row.nome,
        'preco_adicional_centavos', v_opcao_row.preco_adicional_centavos
      );
    end loop;
  end if;

  new.opcoes_selecionadas := v_opcoes_final;
  new.preco_unit_centavos := v_produto.preco_centavos + v_adicional;
  return new;
end;
$$;

drop trigger if exists trg_comanda_itens_calcula_preco on restaurante.comanda_itens;
create trigger trg_comanda_itens_calcula_preco
  before insert on restaurante.comanda_itens
  for each row execute function restaurante.trg_comanda_itens_calcula_preco();

-- opcoes_selecionadas vira imutável depois de lançado, igual produto/nome/
-- preço/quantidade já eram (0038) — sem isso o cálculo do trigger de
-- insert podia ser contornado com um update direto depois.
create or replace function restaurante.trg_comanda_itens_protege_colunas()
returns trigger
language plpgsql
set search_path = restaurante, pg_temp
as $$
begin
  if current_setting('restaurante.bypass_protecao', true) = 'true' then
    return new;
  end if;

  if new.status = 'CANCELADO' and old.status <> 'CANCELADO' then
    if not restaurante.tem_permissao('atendimento.comanda.item.cancelar') then
      raise exception 'Sem permissão para cancelar item';
    end if;
    if coalesce(trim(new.motivo_cancelamento), '') = '' then
      raise exception 'Motivo do cancelamento é obrigatório';
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

  return new;
end;
$$;

-- confirmar_pagamento ganha a baixa de estoque dos adicionais escolhidos
-- (opcao_ficha_tecnica), lida de opcoes_selecionadas — mesma lógica da
-- ficha técnica do produto, só que por opção, e só quando ela tiver ficha
-- técnica própria cadastrada (maioria não tem, fica sem efeito).
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

      -- Fase 1.3 — ficha técnica própria dos adicionais escolhidos nesse item
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
