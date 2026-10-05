-- PRIORIDADE 5 — Controle de Equipe (Equipe → sub-abas: Funcionários ·
-- Escala · Ponto · Desempenho · Custo)
--
-- [DECISÃO DE DESIGN] Salário/diária é sensível por natureza (o roteiro
-- diz "campo visível só para ADMIN") e `usuarios` é lido por TODO
-- funcionário da empresa (usuarios_select não filtra por permissão — um
-- GARCOM precisa ver o nome de outro GARCOM pra transferir item, por
-- exemplo). Por isso remuneração vai numa tabela PRÓPRIA
-- (funcionarios_remuneracao), nunca em usuarios, com uma permissão NOVA
-- (admin.equipe.custos.ver, só ADMIN) — GERENTE continua com
-- admin.equipe.editar (cria funcionário, troca PIN, edita escala) mas
-- NÃO ganha acesso a salário/custo. `peso_rateio_taxa` não é sensível
-- (é só um multiplicador de rateio, não um valor em R$) e fica em
-- `usuarios` mesmo, editável por quem já tem admin.equipe.editar.
--
-- [DECISÃO DE DESIGN] "10% da taxa de serviço rateado" = a taxa de
-- serviço cobrada do cliente (hoje 100% receita, sem nenhuma alocação pra
-- equipe) passa a ser distribuída entre os funcionários ativos — não é
-- "10% da taxa", é a PRÓPRIA taxa de serviço (que por padrão É 10%,
-- `taxaServicoPctPadrao`), prática padrão de rateio de serviço no Brasil.
-- Pra isso funcionar, a taxa cobrada em cada comanda precisa ficar
-- gravada (hoje ela só existe efêmera dentro de confirmar_pagamento,
-- somada ao total sem separar) — por isso comandas ganha
-- taxa_servico_centavos e confirmar_pagamento é redefinida só pra
-- gravar esse valor (nenhuma outra linha mudou).
--
-- [DECISÃO DE DESIGN] "Ponto com PIN no terminal": qualquer usuário
-- logado pode bater o PIN de si mesmo OU de um colega (o PIN já é a
-- senha real da conta — mesma confiança que autorização de supervisor já
-- usa, restaurante.verificar_pin_supervisor, 0043/0060). bater_ponto
-- reaproveita a MESMA tabela de freio de força-bruta
-- (tentativas_autorizacao) e o mesmo truque de verificar a senha via
-- GoTrue (login + logout imediato), só que sem exigir nenhuma permissão
-- específica do papel de quem bate o PIN — qualquer um pode se
-- identificar. Corrigir um ponto já registrado exige admin.equipe.editar
-- (GERENTE/ADMIN), com motivo obrigatório e auditoria.
--
-- Pontos novos no roteiro desta fase cobertos aqui: iniciado_em/pronto_em/
-- entregue_em em comanda_itens (tempo médio de preparo), escalas (turno/
-- folga semanal), pontos (entrada/saída/intervalo), funcionarios_remuneracao
-- e vales_adiantamentos (custo), e o custo de equipe de verdade entrando
-- na Central do Dono (0065/0067 deixavam isso em 0/indisponível).

-- ========================================================================
-- comanda_itens: timestamp por status (tempo médio de preparo) — trigger
-- independente da proteção de colunas (0051), roda em QUALQUER UPDATE que
-- mude o status, online ou pela fila offline, sem precisar tocar nos 3
-- call sites que hoje escrevem direto na tabela (kdsSetStatus,
-- kdsAvancarTicket, fila offline).
-- ========================================================================
alter table restaurante.comanda_itens add column if not exists iniciado_em timestamptz;
alter table restaurante.comanda_itens add column if not exists pronto_em timestamptz;
alter table restaurante.comanda_itens add column if not exists entregue_em timestamptz;

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
  end if;
  return new;
end;
$$;

drop trigger if exists trg_comanda_itens_timestamps on restaurante.comanda_itens;
create trigger trg_comanda_itens_timestamps
  before update on restaurante.comanda_itens
  for each row execute function restaurante.trg_comanda_itens_timestamps_status();

-- ========================================================================
-- peso de rateio (não sensível — fica em usuarios mesmo)
-- ========================================================================
alter table restaurante.usuarios add column if not exists peso_rateio_taxa numeric not null default 1 check (peso_rateio_taxa > 0);

-- ========================================================================
-- taxa de serviço gravada por comanda (pra dar pra ratear de verdade)
-- ========================================================================
alter table restaurante.comandas add column if not exists taxa_servico_centavos int not null default 0;

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

-- ========================================================================
-- permissão nova: custo de equipe (salário/diária/vales/rateio em R$) —
-- só ADMIN. GERENTE mantém admin.equipe.editar (funcionário, PIN, escala).
-- ========================================================================
insert into restaurante.papeis_permissoes (papel, permissao) values
  ('ADMIN', 'admin.equipe.custos.ver')
on conflict (papel, permissao) do nothing;

-- ========================================================================
-- Escala semanal (turno/folga)
-- ========================================================================
create table if not exists restaurante.escalas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  usuario_id uuid not null references restaurante.usuarios(id) on delete cascade,
  dia_semana int not null check (dia_semana between 0 and 6),
  turno_inicio time,
  turno_fim time,
  tipo text not null default 'TRABALHO' check (tipo in ('TRABALHO','FOLGA')),
  created_at timestamptz not null default now()
);
create index if not exists idx_escalas_empresa on restaurante.escalas (empresa_id, usuario_id);
create index if not exists idx_escalas_dia on restaurante.escalas (empresa_id, dia_semana);

alter table restaurante.escalas enable row level security;
drop policy if exists escalas_select on restaurante.escalas;
create policy escalas_select on restaurante.escalas for select
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.equipe.editar'));
-- sem policy de insert/update/delete — só pela RPC abaixo.

create or replace function restaurante.salvar_escala(p_usuario_id uuid, p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_linha jsonb;
  v_resultado jsonb := '[]'::jsonb;
  v_row restaurante.escalas%rowtype;
begin
  if not restaurante.tem_permissao('admin.equipe.editar') then
    raise exception 'Sem permissão para editar escala';
  end if;
  if not exists (select 1 from restaurante.usuarios where id = p_usuario_id and empresa_id = v_empresa_id) then
    raise exception 'Funcionário não encontrado';
  end if;

  delete from restaurante.escalas where usuario_id = p_usuario_id and empresa_id = v_empresa_id;

  for v_linha in select * from jsonb_array_elements(p_linhas)
  loop
    insert into restaurante.escalas (empresa_id, usuario_id, dia_semana, turno_inicio, turno_fim, tipo)
    values (
      v_empresa_id, p_usuario_id, (v_linha->>'dia_semana')::int,
      nullif(v_linha->>'turno_inicio','')::time, nullif(v_linha->>'turno_fim','')::time,
      coalesce(v_linha->>'tipo','TRABALHO')
    )
    returning * into v_row;
    v_resultado := v_resultado || to_jsonb(v_row);
  end loop;

  return v_resultado;
end;
$$;

revoke all on function restaurante.salvar_escala(uuid, jsonb) from public;
grant execute on function restaurante.salvar_escala(uuid, jsonb) to authenticated;

create or replace function restaurante.escala_hoje()
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_tz text; v_virada int; v_agora_local timestamp; v_dia date; v_dia_semana int;
  v_inicio_hoje timestamptz;
  v_resultado jsonb;
begin
  if not restaurante.tem_permissao('admin.equipe.editar') then
    raise exception 'Sem permissão para ver a escala';
  end if;
  select timezone, virada_dia_operacional_hora into v_tz, v_virada from restaurante.empresas where id = v_empresa_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  v_virada := coalesce(v_virada, 5);
  v_agora_local := now() at time zone v_tz;
  v_dia := (v_agora_local - ((v_virada)::text || ' hours')::interval)::date;
  v_dia_semana := extract(dow from v_dia)::int;
  v_inicio_hoje := (v_dia::timestamp + ((v_virada)::text || ' hours')::interval) at time zone v_tz;

  select coalesce(jsonb_agg(jsonb_build_object(
      'usuario_id', u.id, 'nome', u.nome, 'turno_inicio', e.turno_inicio, 'turno_fim', e.turno_fim,
      'bateu_ponto', exists(select 1 from restaurante.pontos p where p.usuario_id = u.id and p.tipo = 'ENTRADA' and p.registrado_em >= v_inicio_hoje)
    ) order by u.nome), '[]'::jsonb) into v_resultado
  from restaurante.escalas e
  join restaurante.usuarios u on u.id = e.usuario_id and u.empresa_id = v_empresa_id and u.ativo
  where e.empresa_id = v_empresa_id and e.dia_semana = v_dia_semana and e.tipo = 'TRABALHO';

  return v_resultado;
end;
$$;

revoke all on function restaurante.escala_hoje() from public;
grant execute on function restaurante.escala_hoje() to authenticated;

-- ========================================================================
-- Ponto: entrada/saída/intervalo com PIN no terminal — controle interno,
-- não substitui o registro de ponto oficial exigido pela legislação.
-- ========================================================================
create table if not exists restaurante.pontos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  usuario_id uuid not null references restaurante.usuarios(id) on delete cascade,
  tipo text not null check (tipo in ('ENTRADA','SAIDA','INICIO_INTERVALO','FIM_INTERVALO')),
  registrado_em timestamptz not null default now(),
  corrigido boolean not null default false,
  corrigido_por uuid references restaurante.usuarios(id) on delete set null,
  motivo_correcao text,
  created_at timestamptz not null default now()
);
create index if not exists idx_pontos_empresa_usuario on restaurante.pontos (empresa_id, usuario_id, registrado_em desc);

alter table restaurante.pontos enable row level security;
drop policy if exists pontos_select on restaurante.pontos;
create policy pontos_select on restaurante.pontos for select
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.equipe.editar'));
-- sem policy de insert/update — só pelas RPCs abaixo.

create or replace function restaurante.bater_ponto(p_usuario_id uuid, p_pin text, p_tipo text)
returns restaurante.pontos
language plpgsql
security definer
set search_path = restaurante, extensions, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_logado uuid := auth.uid();
  v_funcionario restaurante.usuarios%rowtype;
  v_project_url text;
  v_resposta extensions.http_response;
  v_body jsonb;
  v_access_token text;
  v_falhas int;
  v_ok boolean := false;
  v_ponto restaurante.pontos%rowtype;
begin
  if v_usuario_logado is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if p_tipo not in ('ENTRADA','SAIDA','INICIO_INTERVALO','FIM_INTERVALO') then
    raise exception 'Tipo de ponto inválido';
  end if;

  select * into v_funcionario from restaurante.usuarios
    where id = p_usuario_id and empresa_id = v_empresa_id and ativo = true;
  if not found then
    raise exception 'Funcionário não encontrado';
  end if;

  select count(*) into v_falhas from restaurante.tentativas_autorizacao
    where supervisor_id = p_usuario_id and sucesso = false and created_at > now() - interval '5 minutes';
  if v_falhas >= 5 then
    raise exception 'Muitas tentativas de PIN — aguarde alguns minutos';
  end if;

  if p_pin !~ '^[A-Za-z0-9]{4}$' then
    raise exception 'PIN inválido';
  end if;
  if v_funcionario.email_interno is null then
    raise exception 'Funcionário sem e-mail de login configurado — peça pra alguém trocar o PIN dele uma vez na tela Equipe';
  end if;

  select coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'project_url'),
    'https://ybsyhjqtwiwomtxbloyu.supabase.co'
  ) into v_project_url;

  select * into v_resposta from extensions.http((
    'POST',
    v_project_url || '/auth/v1/token?grant_type=password',
    ARRAY[
      extensions.http_header('apikey', 'sb_publishable_35oPPu0kJ7Da0LtintHzOw_MO_n1oN3'),
      extensions.http_header('Content-Type', 'application/json')
    ],
    'application/json',
    jsonb_build_object('email', v_funcionario.email_interno, 'password', p_pin)::text
  )::extensions.http_request);

  v_body := v_resposta.content::jsonb;
  v_access_token := v_body->>'access_token';
  v_ok := v_resposta.status = 200 and v_access_token is not null;

  insert into restaurante.tentativas_autorizacao (empresa_id, supervisor_id, sucesso)
  values (v_empresa_id, p_usuario_id, v_ok);

  if not v_ok then
    raise exception 'PIN inválido';
  end if;

  perform extensions.http((
    'POST',
    v_project_url || '/auth/v1/logout',
    ARRAY[
      extensions.http_header('apikey', 'sb_publishable_35oPPu0kJ7Da0LtintHzOw_MO_n1oN3'),
      extensions.http_header('Authorization', 'Bearer ' || v_access_token)
    ],
    'application/json',
    '{}'
  )::extensions.http_request);

  insert into restaurante.pontos (empresa_id, usuario_id, tipo, registrado_em)
  values (v_empresa_id, p_usuario_id, p_tipo, now())
  returning * into v_ponto;

  return v_ponto;
end;
$$;

revoke all on function restaurante.bater_ponto(uuid, text, text) from public;
grant execute on function restaurante.bater_ponto(uuid, text, text) to authenticated;

create or replace function restaurante.corrigir_ponto(p_ponto_id uuid, p_novo_registrado_em timestamptz, p_motivo text)
returns restaurante.pontos
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_anterior timestamptz;
  v_ponto restaurante.pontos%rowtype;
begin
  if not restaurante.tem_permissao('admin.equipe.editar') then
    raise exception 'Sem permissão para corrigir ponto';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Motivo é obrigatório';
  end if;

  select registrado_em into v_anterior from restaurante.pontos where id = p_ponto_id and empresa_id = v_empresa_id;
  if not found then
    raise exception 'Registro de ponto não encontrado';
  end if;

  update restaurante.pontos
    set registrado_em = p_novo_registrado_em, corrigido = true, corrigido_por = v_usuario_id, motivo_correcao = trim(p_motivo)
    where id = p_ponto_id
    returning * into v_ponto;

  insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, dados_antes, dados_depois, motivo)
  values (
    v_empresa_id, v_usuario_id, 'pontos', p_ponto_id, 'PONTO_CORRIGIDO',
    jsonb_build_object('registrado_em', v_anterior), jsonb_build_object('registrado_em', p_novo_registrado_em), trim(p_motivo)
  );

  return v_ponto;
end;
$$;

revoke all on function restaurante.corrigir_ponto(uuid, timestamptz, text) from public;
grant execute on function restaurante.corrigir_ponto(uuid, timestamptz, text) to authenticated;

-- ========================================================================
-- Custo: remuneração (sensível, só admin.equipe.custos.ver) e vales
-- ========================================================================
create table if not exists restaurante.funcionarios_remuneracao (
  usuario_id uuid primary key references restaurante.usuarios(id) on delete cascade,
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('MENSAL','DIARIA')),
  valor_centavos int not null check (valor_centavos >= 0),
  updated_at timestamptz not null default now()
);

alter table restaurante.funcionarios_remuneracao enable row level security;
drop policy if exists funcionarios_remuneracao_select on restaurante.funcionarios_remuneracao;
create policy funcionarios_remuneracao_select on restaurante.funcionarios_remuneracao for select
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.equipe.custos.ver'));
-- sem policy de insert/update — só pela RPC abaixo.

create or replace function restaurante.salvar_remuneracao(p_usuario_id uuid, p_tipo text, p_valor_centavos int)
returns restaurante.funcionarios_remuneracao
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_row restaurante.funcionarios_remuneracao%rowtype;
begin
  if not restaurante.tem_permissao('admin.equipe.custos.ver') then
    raise exception 'Sem permissão para editar remuneração';
  end if;
  if p_tipo not in ('MENSAL','DIARIA') then
    raise exception 'Tipo de remuneração inválido';
  end if;
  if not (p_valor_centavos >= 0) then
    raise exception 'Valor inválido';
  end if;
  if not exists (select 1 from restaurante.usuarios where id = p_usuario_id and empresa_id = v_empresa_id) then
    raise exception 'Funcionário não encontrado';
  end if;

  insert into restaurante.funcionarios_remuneracao (usuario_id, empresa_id, tipo, valor_centavos, updated_at)
  values (p_usuario_id, v_empresa_id, p_tipo, p_valor_centavos, now())
  on conflict (usuario_id) do update set tipo = excluded.tipo, valor_centavos = excluded.valor_centavos, updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function restaurante.salvar_remuneracao(uuid, text, int) from public;
grant execute on function restaurante.salvar_remuneracao(uuid, text, int) to authenticated;

create table if not exists restaurante.vales_adiantamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  usuario_id uuid not null references restaurante.usuarios(id) on delete cascade,
  valor_centavos int not null check (valor_centavos > 0),
  motivo text not null,
  data date not null default current_date,
  usuario_lancou_id uuid references restaurante.usuarios(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_vales_empresa_usuario on restaurante.vales_adiantamentos (empresa_id, usuario_id, data);

alter table restaurante.vales_adiantamentos enable row level security;
drop policy if exists vales_adiantamentos_select on restaurante.vales_adiantamentos;
create policy vales_adiantamentos_select on restaurante.vales_adiantamentos for select
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.equipe.custos.ver'));
-- sem policy de insert/update — só pela RPC abaixo.

create or replace function restaurante.registrar_vale(p_usuario_id uuid, p_valor_centavos int, p_motivo text, p_data date default null)
returns restaurante.vales_adiantamentos
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_logado uuid := auth.uid();
  v_row restaurante.vales_adiantamentos%rowtype;
begin
  if not restaurante.tem_permissao('admin.equipe.custos.ver') then
    raise exception 'Sem permissão para lançar vale/adiantamento';
  end if;
  if not (p_valor_centavos > 0) then
    raise exception 'Valor deve ser maior que zero';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Motivo é obrigatório';
  end if;
  if not exists (select 1 from restaurante.usuarios where id = p_usuario_id and empresa_id = v_empresa_id) then
    raise exception 'Funcionário não encontrado';
  end if;

  insert into restaurante.vales_adiantamentos (empresa_id, usuario_id, valor_centavos, motivo, data, usuario_lancou_id)
  values (v_empresa_id, p_usuario_id, p_valor_centavos, trim(p_motivo), coalesce(p_data, current_date), v_usuario_logado)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function restaurante.registrar_vale(uuid, int, text, date) from public;
grant execute on function restaurante.registrar_vale(uuid, int, text, date) to authenticated;

-- ========================================================================
-- Desempenho: vendas/ticket/cancelamentos por garçom + itens por hora
-- trabalhada (pontos) + tempo médio de preparo por setor (cozinha).
-- ========================================================================
create or replace function restaurante.relatorio_desempenho_equipe(p_desde date, p_ate date)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_desde_ts timestamptz;
  v_ate_ts timestamptz;
  v_usuario record;
  v_ponto record;
  v_entrada_aberta timestamptz;
  v_intervalo_aberto timestamptz;
  v_horas numeric;
  v_por_garcom jsonb := '[]'::jsonb;
  v_vendas int; v_contas int; v_itens numeric; v_cancelamentos int;
  v_tempo_preparo jsonb;
begin
  if not restaurante.tem_permissao('admin.equipe.editar') then
    raise exception 'Sem permissão para ver desempenho da equipe';
  end if;
  if p_ate < p_desde or (p_ate - p_desde) > 366 then
    raise exception 'Período inválido (máximo de 1 ano)';
  end if;
  v_desde_ts := p_desde::timestamptz;
  v_ate_ts := (p_ate + 1)::timestamptz;

  for v_usuario in select id, nome from restaurante.usuarios where empresa_id = v_empresa_id and ativo = true
  loop
    -- horas trabalhadas: ENTRADA..SAIDA menos INICIO_INTERVALO..FIM_INTERVALO,
    -- em ordem — um loop simples é mais claro aqui que tentar expressar
    -- pareamento sequencial de eventos numa consulta só.
    v_horas := 0; v_entrada_aberta := null; v_intervalo_aberto := null;
    for v_ponto in
      select tipo, registrado_em from restaurante.pontos
      where usuario_id = v_usuario.id and registrado_em >= v_desde_ts and registrado_em < v_ate_ts
      order by registrado_em
    loop
      if v_ponto.tipo = 'ENTRADA' then
        v_entrada_aberta := v_ponto.registrado_em;
      elsif v_ponto.tipo = 'SAIDA' and v_entrada_aberta is not null then
        v_horas := v_horas + extract(epoch from (v_ponto.registrado_em - v_entrada_aberta)) / 3600.0;
        v_entrada_aberta := null;
      elsif v_ponto.tipo = 'INICIO_INTERVALO' then
        v_intervalo_aberto := v_ponto.registrado_em;
      elsif v_ponto.tipo = 'FIM_INTERVALO' and v_intervalo_aberto is not null then
        v_horas := v_horas - extract(epoch from (v_ponto.registrado_em - v_intervalo_aberto)) / 3600.0;
        v_intervalo_aberto := null;
      end if;
    end loop;
    v_horas := greatest(0, round(v_horas, 1));

    select coalesce(sum(ci.preco_unit_centavos * ci.quantidade), 0)::int, coalesce(sum(ci.quantidade), 0),
        count(distinct ci.comanda_id)
      into v_vendas, v_itens, v_contas
      from restaurante.comanda_itens ci
      join restaurante.comandas c on c.id = ci.comanda_id
      where ci.usuario_id = v_usuario.id and c.empresa_id = v_empresa_id and c.status = 'PAGA'
        and ci.status <> 'CANCELADO' and c.dia_operacional between p_desde and p_ate;

    select count(*) into v_cancelamentos
      from restaurante.comanda_itens ci join restaurante.comandas c on c.id = ci.comanda_id
      where ci.usuario_id = v_usuario.id and c.empresa_id = v_empresa_id and ci.status = 'CANCELADO'
        and c.dia_operacional between p_desde and p_ate;

    if v_vendas > 0 or v_horas > 0 then
      v_por_garcom := v_por_garcom || jsonb_build_object(
        'usuario_id', v_usuario.id, 'nome', v_usuario.nome,
        'vendas_centavos', v_vendas, 'contas', v_contas,
        'ticket_medio_centavos', case when v_contas>0 then round(v_vendas::numeric/v_contas)::int else 0 end,
        'horas_trabalhadas', v_horas,
        'itens_por_hora', case when v_horas>0 then round(v_itens/v_horas, 1) else null end,
        'cancelamentos', v_cancelamentos
      );
    end if;
  end loop;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_tempo_preparo
  from (
    select setor_producao, round(avg(extract(epoch from (pronto_em - iniciado_em))/60.0), 1) as minutos_medio, count(*) as qtd
    from restaurante.comanda_itens ci join restaurante.comandas c on c.id = ci.comanda_id
    where c.empresa_id = v_empresa_id and c.dia_operacional between p_desde and p_ate
      and ci.iniciado_em is not null and ci.pronto_em is not null
    group by setor_producao
  ) t;

  return jsonb_build_object('por_garcom', v_por_garcom, 'tempo_preparo_por_setor', v_tempo_preparo);
end;
$$;

revoke all on function restaurante.relatorio_desempenho_equipe(date, date) from public;
grant execute on function restaurante.relatorio_desempenho_equipe(date, date) to authenticated;

-- ========================================================================
-- Fechamento (horas, rateio da taxa de serviço, vales) — remuneração base
-- e líquido só aparecem pra ADMIN (mesma régua de custo de equipe).
-- ========================================================================
create or replace function restaurante.relatorio_fechamento_equipe(p_desde date, p_ate date)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_papel text := restaurante.jwt_papel();
  v_desde_ts timestamptz;
  v_ate_ts timestamptz;
  v_metodo_rateio text;
  v_taxa_total int;
  v_soma_pesos numeric;
  v_usuario record;
  v_ponto record;
  v_entrada_aberta timestamptz;
  v_intervalo_aberto timestamptz;
  v_horas numeric;
  v_peso_efetivo numeric;
  v_rateio int;
  v_vales int;
  v_remuneracao restaurante.funcionarios_remuneracao%rowtype;
  v_dias_trabalhados int;
  v_remuneracao_base int;
  v_resultado jsonb := '[]'::jsonb;
begin
  if not restaurante.tem_permissao('admin.equipe.editar') then
    raise exception 'Sem permissão para ver o fechamento da equipe';
  end if;
  if p_ate < p_desde or (p_ate - p_desde) > 90 then
    raise exception 'Período inválido (máximo de 90 dias)';
  end if;
  v_desde_ts := p_desde::timestamptz;
  v_ate_ts := (p_ate + 1)::timestamptz;

  select coalesce(config->>'rateioTaxaServico', 'IGUALITARIO') into v_metodo_rateio
    from restaurante.empresas where id = v_empresa_id;

  select coalesce(sum(taxa_servico_centavos), 0)::int into v_taxa_total
    from restaurante.comandas
    where empresa_id = v_empresa_id and status = 'PAGA' and dia_operacional between p_desde and p_ate;

  select coalesce(sum(case when v_metodo_rateio = 'PESO' then peso_rateio_taxa else 1 end), 0) into v_soma_pesos
    from restaurante.usuarios where empresa_id = v_empresa_id and ativo = true;

  for v_usuario in select id, nome, peso_rateio_taxa from restaurante.usuarios where empresa_id = v_empresa_id and ativo = true
  loop
    v_horas := 0; v_entrada_aberta := null; v_intervalo_aberto := null; v_dias_trabalhados := 0;
    for v_ponto in
      select tipo, registrado_em from restaurante.pontos
      where usuario_id = v_usuario.id and registrado_em >= v_desde_ts and registrado_em < v_ate_ts
      order by registrado_em
    loop
      if v_ponto.tipo = 'ENTRADA' then
        v_entrada_aberta := v_ponto.registrado_em;
      elsif v_ponto.tipo = 'SAIDA' and v_entrada_aberta is not null then
        v_horas := v_horas + extract(epoch from (v_ponto.registrado_em - v_entrada_aberta)) / 3600.0;
        v_entrada_aberta := null;
      elsif v_ponto.tipo = 'INICIO_INTERVALO' then
        v_intervalo_aberto := v_ponto.registrado_em;
      elsif v_ponto.tipo = 'FIM_INTERVALO' and v_intervalo_aberto is not null then
        v_horas := v_horas - extract(epoch from (v_ponto.registrado_em - v_intervalo_aberto)) / 3600.0;
        v_intervalo_aberto := null;
      end if;
    end loop;
    v_horas := greatest(0, round(v_horas, 1));

    select count(distinct registrado_em::date) into v_dias_trabalhados
      from restaurante.pontos
      where usuario_id = v_usuario.id and tipo = 'ENTRADA' and registrado_em >= v_desde_ts and registrado_em < v_ate_ts;

    v_peso_efetivo := case when v_metodo_rateio = 'PESO' then v_usuario.peso_rateio_taxa else 1 end;
    v_rateio := case when v_soma_pesos > 0 then round(v_taxa_total * v_peso_efetivo / v_soma_pesos)::int else 0 end;

    select coalesce(sum(valor_centavos), 0)::int into v_vales
      from restaurante.vales_adiantamentos
      where usuario_id = v_usuario.id and data between p_desde and p_ate;

    select * into v_remuneracao from restaurante.funcionarios_remuneracao where usuario_id = v_usuario.id;
    v_remuneracao_base := case
      when v_remuneracao.usuario_id is null then 0
      when v_remuneracao.tipo = 'MENSAL' then v_remuneracao.valor_centavos
      else v_remuneracao.valor_centavos * v_dias_trabalhados
    end;

    v_resultado := v_resultado || jsonb_build_object(
      'usuario_id', v_usuario.id, 'nome', v_usuario.nome,
      'horas_trabalhadas', v_horas, 'dias_trabalhados', v_dias_trabalhados,
      'rateio_taxa_centavos', v_rateio, 'vales_centavos', v_vales,
      'remuneracao_base_centavos', case when v_papel = 'ADMIN' then v_remuneracao_base else null end,
      'liquido_centavos', case when v_papel = 'ADMIN' then (v_remuneracao_base + v_rateio - v_vales) else null end
    );
  end loop;

  return jsonb_build_object('taxa_total_centavos', v_taxa_total, 'metodo_rateio', v_metodo_rateio, 'pode_ver_remuneracao', (v_papel = 'ADMIN'), 'funcionarios', v_resultado);
end;
$$;

revoke all on function restaurante.relatorio_fechamento_equipe(date, date) from public;
grant execute on function restaurante.relatorio_fechamento_equipe(date, date) to authenticated;

-- ========================================================================
-- Central do Dono: custo de equipe de verdade (0065/0067 deixavam 0/
-- indisponível). Mesma régua de resultado_centavos: só ADMIN vê o valor
-- (soma salário/diária proporcional ao mês é informação de folha).
-- ========================================================================
create or replace function restaurante.central_do_dono()
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_papel text := restaurante.jwt_papel();
  v_tz text;
  v_virada int;
  v_atraso_cfg jsonb;
  v_meta_cmv_pct numeric;
  v_meta_perdas_pct numeric;
  v_meta_custo_equipe_pct numeric;
  v_meta_diferenca_caixa_mes int;
  v_limite_diferenca_caixa int;

  v_agora_local timestamp;
  v_dia_operacional date;
  v_inicio_hoje timestamptz;
  v_elapsed interval;
  v_mes_inicio date;
  v_mes_fim date;

  v_faturamento_hoje int;
  v_vendas_hoje int;
  v_ticket_hoje int;
  v_faturamento_sem_passada int;
  v_vendas_sem_passada int;
  v_ticket_sem_passada int;

  v_k int;
  v_inicio_k timestamptz;
  v_parcial_k int;
  v_total_dia_k int;
  v_soma_ritmo numeric := 0;
  v_amostras int := 0;
  v_projecao int;

  v_faturamento_mes int;
  v_cmv_mes int;
  v_perdas_mes int;
  v_despesas_mes int;
  v_custo_equipe_mes int;
  v_resultado_mes int;
  v_contas_pendentes_mes int;
  v_falta_contas int;

  v_diferenca_caixa_mes int;

  v_atencao jsonb := '[]'::jsonb;
  v_tmp_qtd int;
  v_tmp_valor int;
  v_cancelamentos_hoje int;
  v_cancelamentos_media numeric;

  v_mesas_total int;
  v_mesas_ocupadas int;
  v_pedidos_atrasados int;
  v_caixas_abertos int;

  v_metodo_rateio text;
  v_taxa_mes int;
  v_usuario record;
  v_dias_trabalhados int;
  v_remuneracao restaurante.funcionarios_remuneracao%rowtype;
begin
  if not restaurante.tem_permissao('admin.central_dono.ver') then
    raise exception 'Sem permissão para ver a Central do Dono';
  end if;

  select e.timezone, e.virada_dia_operacional_hora, e.config->'atrasoPorSetor',
      coalesce((e.config->'metasCentralDono'->>'cmvPct')::numeric, 35),
      coalesce((e.config->'metasCentralDono'->>'perdasPctFaturamento')::numeric, 3),
      coalesce((e.config->'metasCentralDono'->>'custoEquipePct')::numeric, 30),
      coalesce((e.config->'metasCentralDono'->>'diferencaCaixaCentavosMes')::int, 5000),
      coalesce((e.config->>'limiteDiferencaCentavos')::int, 500),
      coalesce(e.config->>'rateioTaxaServico', 'IGUALITARIO')
    into v_tz, v_virada, v_atraso_cfg, v_meta_cmv_pct, v_meta_perdas_pct, v_meta_custo_equipe_pct,
      v_meta_diferenca_caixa_mes, v_limite_diferenca_caixa, v_metodo_rateio
    from restaurante.empresas e where e.id = v_empresa_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  v_virada := coalesce(v_virada, 5);

  v_agora_local := now() at time zone v_tz;
  v_dia_operacional := (v_agora_local - ((v_virada)::text || ' hours')::interval)::date;
  v_inicio_hoje := (v_dia_operacional::timestamp + ((v_virada)::text || ' hours')::interval) at time zone v_tz;
  v_elapsed := now() - v_inicio_hoje;
  v_mes_inicio := date_trunc('month', v_dia_operacional)::date;
  v_mes_fim := (date_trunc('month', v_dia_operacional) + interval '1 month' - interval '1 day')::date;

  select coalesce(sum(total_centavos),0)::int, count(*) into v_faturamento_hoje, v_vendas_hoje
    from restaurante.comandas
    where empresa_id = v_empresa_id and status = 'PAGA'
      and fechamento >= v_inicio_hoje and fechamento <= now();
  v_ticket_hoje := case when v_vendas_hoje>0 then round(v_faturamento_hoje::numeric/v_vendas_hoje)::int else 0 end;

  select coalesce(sum(total_centavos),0)::int, count(*) into v_faturamento_sem_passada, v_vendas_sem_passada
    from restaurante.comandas
    where empresa_id = v_empresa_id and status = 'PAGA'
      and fechamento >= v_inicio_hoje - interval '7 days'
      and fechamento <= v_inicio_hoje - interval '7 days' + v_elapsed;
  v_ticket_sem_passada := case when v_vendas_sem_passada>0 then round(v_faturamento_sem_passada::numeric/v_vendas_sem_passada)::int else 0 end;

  for v_k in 1..4 loop
    v_inicio_k := v_inicio_hoje - ((v_k*7)::text || ' days')::interval;
    select coalesce(sum(total_centavos),0)::int into v_parcial_k
      from restaurante.comandas
      where empresa_id = v_empresa_id and status = 'PAGA'
        and fechamento >= v_inicio_k and fechamento <= v_inicio_k + v_elapsed;
    select coalesce(sum(total_centavos),0)::int into v_total_dia_k
      from restaurante.comandas
      where empresa_id = v_empresa_id and status = 'PAGA'
        and fechamento >= v_inicio_k and fechamento < v_inicio_k + interval '1 day';
    if v_parcial_k > 0 then
      v_soma_ritmo := v_soma_ritmo + (v_total_dia_k::numeric / v_parcial_k);
      v_amostras := v_amostras + 1;
    end if;
  end loop;
  v_projecao := round(v_faturamento_hoje * (case when v_amostras>0 then v_soma_ritmo/v_amostras else 1 end))::int;

  select coalesce(sum(total_centavos),0)::int into v_faturamento_mes
    from restaurante.comandas
    where empresa_id = v_empresa_id and status = 'PAGA' and dia_operacional between v_mes_inicio and v_mes_fim;

  select coalesce(sum(ci.quantidade * coalesce((
      select sum((ft.quantidade / restaurante.rendimento_atual(ft.insumo_id)) * i.custo_medio_centavos)
      from restaurante.ficha_tecnica ft join restaurante.insumos i on i.id = ft.insumo_id
      where ft.produto_id = ci.produto_id
    ), 0)), 0)::int into v_cmv_mes
    from restaurante.comanda_itens ci
    join restaurante.comandas c on c.id = ci.comanda_id
    where c.empresa_id = v_empresa_id and c.status = 'PAGA' and c.dia_operacional between v_mes_inicio and v_mes_fim
      and ci.status <> 'CANCELADO';

  select coalesce(sum(valor_centavos),0)::int into v_perdas_mes
    from restaurante.perdas
    where empresa_id = v_empresa_id and dia_operacional between v_mes_inicio and v_mes_fim;

  select coalesce(sum(valor_centavos),0)::int into v_despesas_mes
    from restaurante.contas
    where empresa_id = v_empresa_id and tipo = 'PAGAR' and vencimento between v_mes_inicio and v_mes_fim;

  -- PRIORIDADE 5 — custo de equipe de verdade: rateio da taxa de serviço
  -- do mês (100% dela — ver nota no topo da 0070) + remuneração base
  -- (mensal cheia, ou diária × dias com ENTRADA no mês).
  select coalesce(sum(taxa_servico_centavos),0)::int into v_taxa_mes
    from restaurante.comandas
    where empresa_id = v_empresa_id and status = 'PAGA' and dia_operacional between v_mes_inicio and v_mes_fim;

  v_custo_equipe_mes := v_taxa_mes;
  for v_usuario in select id from restaurante.usuarios where empresa_id = v_empresa_id and ativo = true
  loop
    select * into v_remuneracao from restaurante.funcionarios_remuneracao where usuario_id = v_usuario.id;
    if v_remuneracao.usuario_id is not null then
      if v_remuneracao.tipo = 'MENSAL' then
        v_custo_equipe_mes := v_custo_equipe_mes + v_remuneracao.valor_centavos;
      else
        select count(distinct registrado_em::date) into v_dias_trabalhados
          from restaurante.pontos
          where usuario_id = v_usuario.id and tipo = 'ENTRADA'
            and registrado_em >= (v_mes_inicio::timestamp at time zone v_tz)
            and registrado_em < ((v_mes_fim+1)::timestamp at time zone v_tz);
        v_custo_equipe_mes := v_custo_equipe_mes + v_remuneracao.valor_centavos * v_dias_trabalhados;
      end if;
    end if;
  end loop;

  v_resultado_mes := v_faturamento_mes - v_cmv_mes - v_perdas_mes - v_despesas_mes - v_custo_equipe_mes;

  select coalesce(sum(valor_centavos),0)::int into v_contas_pendentes_mes
    from restaurante.contas
    where empresa_id = v_empresa_id and tipo = 'PAGAR' and pago_em is null and vencimento between v_mes_inicio and v_mes_fim;
  v_falta_contas := greatest(0, v_contas_pendentes_mes - v_resultado_mes);

  select coalesce(sum(abs(diferenca_centavos)),0)::int into v_diferenca_caixa_mes
    from restaurante.caixa_sessoes
    where empresa_id = v_empresa_id and status = 'FECHADA' and fechamento_em is not null
      and (fechamento_em at time zone v_tz)::date between v_mes_inicio and v_mes_fim;

  select count(*) into v_tmp_qtd from restaurante.insumos where empresa_id = v_empresa_id and estoque_atual < 0;
  if v_tmp_qtd > 0 then
    v_atencao := v_atencao || jsonb_build_object('tipo','ESTOQUE_NEGATIVO','gravidade',90,'view','estoque','qtd',v_tmp_qtd);
  end if;

  select count(*), coalesce(sum(valor_centavos),0)::int into v_tmp_qtd, v_tmp_valor
    from restaurante.contas
    where empresa_id = v_empresa_id and tipo = 'PAGAR' and pago_em is null and vencimento <= v_dia_operacional;
  if v_tmp_qtd > 0 then
    v_atencao := v_atencao || jsonb_build_object('tipo','CONTAS_VENCENDO','gravidade',85,'view','financeiro','qtd',v_tmp_qtd,'valor_centavos',v_tmp_valor);
  end if;

  select cs.diferenca_centavos into v_tmp_valor
    from restaurante.caixa_sessoes cs
    where cs.empresa_id = v_empresa_id and cs.status = 'FECHADA' and cs.fechamento_em >= v_inicio_hoje
    order by cs.fechamento_em desc limit 1;
  if v_tmp_valor is not null and abs(v_tmp_valor) > v_limite_diferenca_caixa then
    v_atencao := v_atencao || jsonb_build_object('tipo','DIFERENCA_CAIXA','gravidade',80,'view','caixa','valor_centavos',v_tmp_valor);
  end if;

  select count(*) into v_tmp_qtd from restaurante.sync_conflitos where empresa_id = v_empresa_id and status = 'PENDENTE';
  if v_tmp_qtd > 0 then
    v_atencao := v_atencao || jsonb_build_object('tipo','CONFLITOS_OFFLINE','gravidade',75,'view','configuracoes','qtd',v_tmp_qtd);
  end if;

  select count(*) into v_cancelamentos_hoje
    from restaurante.comanda_itens ci join restaurante.comandas c on c.id = ci.comanda_id
    where c.empresa_id = v_empresa_id and c.dia_operacional = v_dia_operacional and ci.status = 'CANCELADO';
  select coalesce(avg(coalesce(x.cnt,0)),0) into v_cancelamentos_media
    from generate_series((v_dia_operacional - 7)::timestamp, (v_dia_operacional - 1)::timestamp, interval '1 day') as d(dia)
    left join (
      select c.dia_operacional as dia, count(*) as cnt
      from restaurante.comanda_itens ci join restaurante.comandas c on c.id = ci.comanda_id
      where c.empresa_id = v_empresa_id and ci.status = 'CANCELADO'
      group by c.dia_operacional
    ) x on x.dia = d.dia::date;
  if v_cancelamentos_hoje >= 3 and v_cancelamentos_hoje > (v_cancelamentos_media * 2) then
    v_atencao := v_atencao || jsonb_build_object('tipo','CANCELAMENTOS_ACIMA_DO_NORMAL','gravidade',70,'view','auditoria','qtd',v_cancelamentos_hoje,'media',round(v_cancelamentos_media,1));
  end if;

  select count(*) into v_mesas_total from restaurante.mesas where empresa_id = v_empresa_id;
  select count(distinct mesa_id) into v_mesas_ocupadas
    from restaurante.comandas
    where empresa_id = v_empresa_id and status in ('ABERTA','FECHANDO') and mesa_id is not null;
  select count(*) into v_caixas_abertos from restaurante.caixa_sessoes where empresa_id = v_empresa_id and status = 'ABERTA';
  select count(*) into v_pedidos_atrasados
    from restaurante.comanda_itens ci
    join restaurante.comandas c on c.id = ci.comanda_id
    join restaurante.produtos p on p.id = ci.produto_id
    where c.empresa_id = v_empresa_id and c.status in ('ABERTA','FECHANDO')
      and ci.status in ('PENDENTE','PREPARANDO')
      and now() - ci.enviado_em > (coalesce(v_atraso_cfg->>p.setor_producao,'10') || ' minutes')::interval;

  return jsonb_build_object(
    'dia_operacional', v_dia_operacional,
    'hoje', jsonb_build_object(
      'faturamento_centavos', v_faturamento_hoje, 'vendas', v_vendas_hoje, 'ticket_medio_centavos', v_ticket_hoje,
      'faturamento_semana_passada_centavos', v_faturamento_sem_passada, 'vendas_semana_passada', v_vendas_sem_passada,
      'ticket_medio_semana_passada_centavos', v_ticket_sem_passada,
      'variacao_faturamento_pct', case when v_faturamento_sem_passada>0 then round((v_faturamento_hoje - v_faturamento_sem_passada)::numeric/v_faturamento_sem_passada*100,1) else null end,
      'variacao_vendas_pct', case when v_vendas_sem_passada>0 then round((v_vendas_hoje - v_vendas_sem_passada)::numeric/v_vendas_sem_passada*100,1) else null end,
      'variacao_ticket_pct', case when v_ticket_sem_passada>0 then round((v_ticket_hoje - v_ticket_sem_passada)::numeric/v_ticket_sem_passada*100,1) else null end,
      'projecao_fechamento_centavos', v_projecao
    ),
    'mes', jsonb_build_object(
      'faturamento_centavos', v_faturamento_mes, 'cmv_centavos', v_cmv_mes, 'perdas_centavos', v_perdas_mes,
      'despesas_centavos', v_despesas_mes,
      'custo_equipe_centavos', case when v_papel='ADMIN' then v_custo_equipe_mes else null end,
      'custo_equipe_disponivel', true,
      'pode_ver_resultado', (v_papel = 'ADMIN'),
      'resultado_centavos', case when v_papel='ADMIN' then v_resultado_mes else null end,
      'contas_a_pagar_pendentes_centavos', v_contas_pendentes_mes,
      'falta_para_cobrir_contas_centavos', case when v_papel='ADMIN' then v_falta_contas else null end
    ),
    'semaforos', jsonb_build_object(
      'cmv_pct', case when v_faturamento_mes>0 then round(v_cmv_mes::numeric/v_faturamento_mes*100,1) else null end,
      'perdas_pct_faturamento', case when v_faturamento_mes>0 then round(v_perdas_mes::numeric/v_faturamento_mes*100,1) else null end,
      'custo_equipe_pct', case when v_papel='ADMIN' and v_faturamento_mes>0 then round(v_custo_equipe_mes::numeric/v_faturamento_mes*100,1) else null end,
      'custo_equipe_disponivel', true,
      'diferenca_caixa_centavos_mes', v_diferenca_caixa_mes,
      'metas', jsonb_build_object('cmv_pct',v_meta_cmv_pct,'perdas_pct_faturamento',v_meta_perdas_pct,'custo_equipe_pct',v_meta_custo_equipe_pct,'diferenca_caixa_centavos_mes',v_meta_diferenca_caixa_mes)
    ),
    'atencao', v_atencao,
    'salao', jsonb_build_object(
      'mesas_total', v_mesas_total, 'mesas_ocupadas', v_mesas_ocupadas,
      'pedidos_atrasados_cozinha', v_pedidos_atrasados, 'caixas_abertos', v_caixas_abertos
    )
  );
end;
$$;

revoke all on function restaurante.central_do_dono() from public;
grant execute on function restaurante.central_do_dono() to authenticated;
