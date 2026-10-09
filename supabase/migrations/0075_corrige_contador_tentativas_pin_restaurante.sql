-- VF-004 do plano de auditoria (docs/PLANO_DE_MELHORIAS.md) — corrige o
-- contador de tentativas de PIN que nunca acumulava de verdade.
--
-- Causa raiz confirmada no código: em verificar_pin_supervisor e em
-- bater_ponto, o `insert into tentativas_autorizacao` acontecia e, logo
-- em seguida, um `raise exception` disparava quando o PIN estava errado
-- — tudo dentro da MESMA transação. Em Postgres, uma exceção não
-- capturada aborta a transação inteira, desfazendo também o INSERT que
-- já tinha "funcionado". Resultado: nenhuma tentativa errada ficava
-- registrada de verdade, e o bloqueio de "5 falhas/5 min" nunca entrava
-- em ação.
--
-- Não existe jeito de um INSERT sobreviver a um `raise exception` mais
-- adiante NA MESMA transação sem autonomous transaction (dblink, que
-- exige credencial própria — complexidade/risco maior que o problema) —
-- então a correção divide em duas chamadas de RPC:
--
--   1. registrar_tentativa_pin(usuario) — chamada PRIMEIRO, sozinha, pelo
--      client. É sua própria transação (sua própria chamada ao
--      PostgREST): grava a linha com sucesso=false e COMMITA de verdade,
--      já checando o limite de 5 falhas/5min antes de deixar prosseguir.
--   2. verificar_pin_supervisor / bater_ponto — chamada depois, recebem
--      o id da tentativa já registrada. Se o PIN bater, fazem um UPDATE
--      pra sucesso=true (esse UPDATE só roda no caminho de sucesso, que
--      não lança exceção — commita normal). Se o PIN não bater, só dão
--      raise — a linha sucesso=false já está lá, gravada na chamada
--      anterior, e sobrevive ao rollback desta.
--
-- Isso muda a ASSINATURA de verificar_pin_supervisor, cancelar_item,
-- aplicar_desconto, confirmar_pagamento e bater_ponto (ganham
-- p_tentativa_id). As assinaturas antigas são derrubadas explicitamente
-- — senão ficariam paralelas no catálogo, ainda chamáveis, e a correção
-- não valeria nada (bastaria continuar chamando a versão velha).

drop function if exists restaurante.verificar_pin_supervisor(uuid, text, text);
drop function if exists restaurante.cancelar_item(uuid, text, uuid, text);
drop function if exists restaurante.aplicar_desconto(uuid, numeric, uuid, text);
drop function if exists restaurante.confirmar_pagamento(uuid, jsonb, uuid, uuid[], uuid, int, text, uuid, text, timestamptz);
drop function if exists restaurante.bater_ponto(uuid, text, text);

-- ========================================================================
-- registrar_tentativa_pin: chamada isolada, própria transação, sempre
-- commita (sucesso ou falha de verdade só acontece se o backend recusar
-- por limite excedido — e nesse caso nada é gravado, igual já era).
-- ========================================================================
create or replace function restaurante.registrar_tentativa_pin(p_usuario_id uuid)
returns uuid
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_atual uuid := auth.uid();
  v_falhas int;
  v_id uuid;
begin
  if v_usuario_atual is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if not exists (select 1 from restaurante.usuarios where id = p_usuario_id and empresa_id = v_empresa_id) then
    raise exception 'Usuário não encontrado';
  end if;

  select count(*) into v_falhas from restaurante.tentativas_autorizacao
    where supervisor_id = p_usuario_id and sucesso = false
      and created_at > now() - interval '5 minutes';
  if v_falhas >= 5 then
    raise exception 'Muitas tentativas de PIN — aguarde alguns minutos';
  end if;

  insert into restaurante.tentativas_autorizacao (empresa_id, supervisor_id, sucesso)
  values (v_empresa_id, p_usuario_id, false)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function restaurante.registrar_tentativa_pin(uuid) from public;
grant execute on function restaurante.registrar_tentativa_pin(uuid) to authenticated;

-- ========================================================================
-- verificar_pin_supervisor — ganha p_tentativa_id, não insere mais em
-- tentativas_autorizacao (só confirma a tentativa pré-registrada e
-- marca sucesso=true quando o PIN bate). Continua sem grant direto pra
-- authenticated — só é chamada internamente por outras RPCs
-- SECURITY DEFINER, nunca pelo client via sb.rpc().
-- ========================================================================
create or replace function restaurante.verificar_pin_supervisor(p_supervisor_id uuid, p_pin text, p_permissao text, p_tentativa_id uuid)
returns restaurante.usuarios
language plpgsql
security definer
set search_path = restaurante, extensions, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_supervisor restaurante.usuarios%rowtype;
  v_project_url text;
  v_resposta extensions.http_response;
  v_body jsonb;
  v_access_token text;
  v_ok boolean := false;
begin
  select * into v_supervisor from restaurante.usuarios
    where id = p_supervisor_id and empresa_id = v_empresa_id and ativo = true;
  if not found then
    raise exception 'Supervisor não encontrado';
  end if;

  if not exists (
    select 1 from restaurante.papeis_permissoes
    where papel = v_supervisor.papel and permissao = p_permissao
  ) then
    raise exception 'Usuário selecionado não tem essa permissão';
  end if;

  if not exists (
    select 1 from restaurante.tentativas_autorizacao
    where id = p_tentativa_id and empresa_id = v_empresa_id and supervisor_id = p_supervisor_id and sucesso = false
  ) then
    raise exception 'Tentativa de PIN inválida ou já usada — tente de novo';
  end if;

  if p_pin !~ '^[A-Za-z0-9]{4}$' then
    raise exception 'PIN inválido';
  end if;

  if v_supervisor.email_interno is null then
    raise exception 'Supervisor sem e-mail de login configurado — peça pra alguém trocar o PIN dele uma vez na tela Equipe';
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
    jsonb_build_object('email', v_supervisor.email_interno, 'password', p_pin)::text
  )::extensions.http_request);

  v_body := v_resposta.content::jsonb;
  v_access_token := v_body->>'access_token';
  v_ok := v_resposta.status = 200 and v_access_token is not null;

  if not v_ok then
    raise exception 'PIN inválido para o supervisor selecionado';
  end if;

  update restaurante.tentativas_autorizacao set sucesso = true where id = p_tentativa_id;

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

  return v_supervisor;
end;
$$;

revoke all on function restaurante.verificar_pin_supervisor(uuid, text, text, uuid) from public;

-- ========================================================================
-- cancelar_item — ganha p_tentativa_id, repassa pra verificar_pin_supervisor.
-- Resto idêntico à versão anterior (0067).
-- ========================================================================
create or replace function restaurante.cancelar_item(
  p_item_id uuid, p_motivo text, p_supervisor_id uuid, p_supervisor_pin text, p_tentativa_id uuid
)
returns restaurante.comanda_itens
language plpgsql
security definer
set search_path = restaurante, extensions, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_item restaurante.comanda_itens%rowtype;
  v_supervisor restaurante.usuarios%rowtype;
  v_ja_preparado boolean;
  v_dia_operacional date;
  v_valor_centavos int;
  v_ft record;
  v_qtd_baixa numeric;
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Motivo é obrigatório';
  end if;

  select ci.* into v_item from restaurante.comanda_itens ci
    join restaurante.comandas c on c.id = ci.comanda_id
    where ci.id = p_item_id and c.empresa_id = v_empresa_id
    for update of ci;
  if not found then
    raise exception 'Item não encontrado';
  end if;
  if v_item.status = 'CANCELADO' then
    raise exception 'Item já está cancelado';
  end if;

  v_supervisor := restaurante.verificar_pin_supervisor(p_supervisor_id, p_supervisor_pin, 'atendimento.comanda.item.cancelar', p_tentativa_id);
  v_ja_preparado := v_item.status in ('PREPARANDO','PRONTO');

  perform set_config('restaurante.bypass_protecao', 'true', true);
  update restaurante.comanda_itens
    set status = 'CANCELADO', cancelado_apos_preparo = v_ja_preparado, motivo_cancelamento = trim(p_motivo)
    where id = p_item_id
    returning * into v_item;

  insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
  values (v_empresa_id, v_usuario_id, 'comanda_itens', p_item_id, 'CANCELAR_ITEM',
    trim(p_motivo) || ' (aprovado por ' || v_supervisor.nome || ')' || (case when v_ja_preparado then ' [já em preparo]' else '' end));

  -- PRIORIDADE 3 — já foi preparado = ingrediente já saiu de verdade da
  -- cozinha, e cancelado nunca vai passar pela baixa de confirmar_pagamento
  -- (que só baixa item pago). Baixa aqui e grava a perda, pra não ficar
  -- sumido pra sempre.
  if v_ja_preparado then
    select dia_operacional into v_dia_operacional from restaurante.comandas where id = v_item.comanda_id;

    select coalesce(sum((ft.quantidade / restaurante.rendimento_atual(ft.insumo_id)) * i.custo_medio_centavos), 0) * v_item.quantidade
      into v_valor_centavos
      from restaurante.ficha_tecnica ft join restaurante.insumos i on i.id = ft.insumo_id
      where ft.produto_id = v_item.produto_id;

    insert into restaurante.perdas (empresa_id, tipo, produto_id, comanda_item_id, quantidade, motivo, valor_centavos, usuario_id, dia_operacional)
    values (v_empresa_id, 'PRATO', v_item.produto_id, p_item_id, v_item.quantidade, 'CANCELADO_APOS_PREPARO', round(v_valor_centavos)::int, v_usuario_id, v_dia_operacional);

    for v_ft in
      select ft.insumo_id, ft.quantidade
      from restaurante.ficha_tecnica ft
      where ft.produto_id = v_item.produto_id
    loop
      v_qtd_baixa := v_item.quantidade * v_ft.quantidade / restaurante.rendimento_atual(v_ft.insumo_id);
      update restaurante.insumos set estoque_atual = estoque_atual - v_qtd_baixa
        where id = v_ft.insumo_id and empresa_id = v_empresa_id;
      insert into restaurante.estoque_movimentos (empresa_id, insumo_id, tipo, quantidade, motivo, origem, origem_id, usuario_id)
      values (v_empresa_id, v_ft.insumo_id, 'SAIDA', v_qtd_baixa, 'Perda: cancelado após preparo', 'PERDA', p_item_id, v_usuario_id);
    end loop;
  end if;

  return v_item;
end;
$$;

revoke all on function restaurante.cancelar_item(uuid, text, uuid, text, uuid) from public;
grant execute on function restaurante.cancelar_item(uuid, text, uuid, text, uuid) to authenticated;

-- ========================================================================
-- aplicar_desconto — ganha p_tentativa_id (default null, só exigido
-- quando o fluxo de supervisor é mesmo acionado). Resto idêntico (0043).
-- ========================================================================
create or replace function restaurante.aplicar_desconto(
  p_comanda_id uuid, p_percentual numeric, p_supervisor_id uuid default null, p_supervisor_pin text default null, p_tentativa_id uuid default null
)
returns restaurante.comandas
language plpgsql
security definer
set search_path = restaurante, extensions, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_comanda restaurante.comandas%rowtype;
  v_empresa restaurante.empresas%rowtype;
  v_supervisor restaurante.usuarios%rowtype;
  v_aprovador_nome text;
  v_subtotal int;
  v_desconto_centavos int;
  v_limite numeric;
begin
  if v_usuario_id is null or v_empresa_id is null then
    raise exception 'Não autenticado';
  end if;
  if not (p_percentual > 0 and p_percentual <= 100) then
    raise exception 'Percentual de desconto inválido';
  end if;

  select * into v_comanda from restaurante.comandas
    where id = p_comanda_id and empresa_id = v_empresa_id and status = 'ABERTA'
    for update;
  if not found then
    raise exception 'Comanda não encontrada ou não está aberta';
  end if;

  select * into v_empresa from restaurante.empresas where id = v_empresa_id;
  v_limite := coalesce((v_empresa.config->>'limiteDescontoPct')::numeric, 10);

  if restaurante.tem_permissao('atendimento.comanda.desconto.aplicar') and p_percentual <= v_limite then
    v_aprovador_nome := null;
  else
    if p_supervisor_id is null or coalesce(trim(p_supervisor_pin), '') = '' or p_tentativa_id is null then
      raise exception 'Desconto acima do limite (ou sem permissão) exige autorização de supervisor';
    end if;
    v_supervisor := restaurante.verificar_pin_supervisor(p_supervisor_id, p_supervisor_pin, 'atendimento.comanda.desconto.aplicar', p_tentativa_id);
    v_aprovador_nome := v_supervisor.nome;
  end if;

  select coalesce(sum(preco_unit_centavos * quantidade), 0)::int into v_subtotal
    from restaurante.comanda_itens
    where comanda_id = p_comanda_id and status <> 'CANCELADO';
  v_desconto_centavos := round(v_subtotal * p_percentual / 100.0)::int;

  perform set_config('restaurante.bypass_protecao', 'true', true);
  update restaurante.comandas set desconto_centavos = v_desconto_centavos
    where id = p_comanda_id
    returning * into v_comanda;

  if v_aprovador_nome is not null then
    insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, motivo)
    values (v_empresa_id, v_usuario_id, 'comandas', p_comanda_id, 'DESCONTO_ACIMA_LIMITE',
      p_percentual::text || '% aprovado por ' || v_aprovador_nome);
  end if;

  return v_comanda;
end;
$$;

revoke all on function restaurante.aplicar_desconto(uuid, numeric, uuid, text, uuid) from public;
grant execute on function restaurante.aplicar_desconto(uuid, numeric, uuid, text, uuid) to authenticated;

-- ========================================================================
-- confirmar_pagamento — ganha p_tentativa_id (11º parâmetro, default
-- null, só exigido quando desconto total acima do limite exige
-- supervisor). Resto idêntico à versão de 0070 (a mais recente).
-- ========================================================================
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
  p_tentativa_id uuid default null
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

revoke all on function restaurante.confirmar_pagamento(uuid, jsonb, uuid, uuid[], uuid, int, text, uuid, text, timestamptz, uuid) from public;
grant execute on function restaurante.confirmar_pagamento(uuid, jsonb, uuid, uuid[], uuid, int, text, uuid, text, timestamptz, uuid) to authenticated;

-- ========================================================================
-- bater_ponto — ganha p_tentativa_id, não insere mais em
-- tentativas_autorizacao (só confirma e marca sucesso=true). Resto
-- idêntico à versão de 0070.
-- ========================================================================
create or replace function restaurante.bater_ponto(p_usuario_id uuid, p_pin text, p_tipo text, p_tentativa_id uuid)
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

  if not exists (
    select 1 from restaurante.tentativas_autorizacao
    where id = p_tentativa_id and empresa_id = v_empresa_id and supervisor_id = p_usuario_id and sucesso = false
  ) then
    raise exception 'Tentativa de PIN inválida ou já usada — tente de novo';
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

  if not v_ok then
    raise exception 'PIN inválido';
  end if;

  update restaurante.tentativas_autorizacao set sucesso = true where id = p_tentativa_id;

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

revoke all on function restaurante.bater_ponto(uuid, text, text, uuid) from public;
grant execute on function restaurante.bater_ponto(uuid, text, text, uuid) to authenticated;
