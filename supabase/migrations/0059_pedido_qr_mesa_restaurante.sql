-- Fase 3.3 — Pedido pelo QR da mesa.
--
-- Cliente pede pelo celular (cardapio.html com ?mesa=N), cai como
-- "pedido QR pendente" — NUNCA direto em comanda_itens. Um garçom
-- confirma (aí sim vira item de verdade, pela mesma trigger que calcula
-- preço pra qualquer lançamento, 0051/0056) ou rejeita. anon não tem
-- nenhuma policy de insert/select direto nessa tabela — só a RPC
-- criar_pedido_qr (SECURITY DEFINER) grava, com preço relido do banco,
-- nunca do que o celular do cliente mandou. No máximo 1 pedido QR
-- pendente por mesa de cada vez (trava spam: não dá pra mandar outro até
-- o garçom confirmar/rejeitar o anterior).

create table restaurante.pedidos_qr (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  mesa_id uuid not null references restaurante.mesas(id) on delete cascade,
  itens jsonb not null,
  observacao text,
  status text not null default 'PENDENTE' check (status in ('PENDENTE','CONFIRMADO','REJEITADO')),
  motivo_rejeicao text,
  confirmado_por uuid references restaurante.usuarios(id) on delete set null,
  comanda_id uuid references restaurante.comandas(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_pedidos_qr_empresa on restaurante.pedidos_qr (empresa_id, status);
create unique index idx_pedidos_qr_mesa_pendente on restaurante.pedidos_qr (mesa_id) where status = 'PENDENTE';

alter table restaurante.pedidos_qr enable row level security;
create policy pedidos_qr_select on restaurante.pedidos_qr for select
  using (empresa_id = restaurante.jwt_empresa_id());
create policy pedidos_qr_update on restaurante.pedidos_qr for update
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('atendimento.comanda.item.lancar'));

create trigger trg_pedidos_qr_auditoria
  after insert or update or delete on restaurante.pedidos_qr
  for each row execute function restaurante.fn_audit_trigger();

-- ---------- criar_pedido_qr: chamada pelo celular do cliente (anon) ----------

create or replace function restaurante.criar_pedido_qr(
  p_slug text, p_mesa_numero int, p_itens jsonb, p_observacao text default null
)
returns uuid
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid;
  v_mesa_id uuid;
  v_elem jsonb;
  v_produto restaurante.produtos%rowtype;
  v_itens_final jsonb := '[]'::jsonb;
  v_qtd numeric;
  v_pedido_id uuid;
begin
  select id into v_empresa_id from restaurante.empresas where slug = p_slug;
  if v_empresa_id is null then
    raise exception 'Restaurante não encontrado';
  end if;

  select id into v_mesa_id from restaurante.mesas where empresa_id = v_empresa_id and numero = p_mesa_numero;
  if v_mesa_id is null then
    raise exception 'Mesa não encontrada';
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
    if exists (select 1 from restaurante.grupos_opcoes where produto_id = v_produto.id and obrigatorio) then
      raise exception '"%" precisa de atendimento do garçom pra escolher opções', v_produto.nome;
    end if;
    v_qtd := (v_elem->>'quantidade')::numeric;
    if not (v_qtd > 0) then
      raise exception 'Quantidade inválida';
    end if;
    v_itens_final := v_itens_final || jsonb_build_object(
      'produto_id', v_produto.id, 'nome', v_produto.nome,
      'quantidade', v_qtd, 'preco_unit_centavos', v_produto.preco_centavos
    );
  end loop;

  insert into restaurante.pedidos_qr (empresa_id, mesa_id, itens, observacao)
  values (v_empresa_id, v_mesa_id, v_itens_final, nullif(trim(coalesce(p_observacao,'')),''))
  returning id into v_pedido_id;

  return v_pedido_id;
exception
  when unique_violation then
    raise exception 'Essa mesa já tem um pedido aguardando confirmação do garçom';
end;
$$;

revoke all on function restaurante.criar_pedido_qr(text, int, jsonb, text) from public;
grant execute on function restaurante.criar_pedido_qr(text, int, jsonb, text) to anon, authenticated;

-- ---------- confirmar/rejeitar: só pra quem lança item (garçom+) ----------

create or replace function restaurante.confirmar_pedido_qr(p_pedido_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
  v_usuario_id uuid := auth.uid();
  v_pedido restaurante.pedidos_qr%rowtype;
  v_comanda restaurante.comandas%rowtype;
  v_elem jsonb;
  v_produto restaurante.produtos%rowtype;
  v_novo_item restaurante.comanda_itens%rowtype;
  v_itens_criados jsonb := '[]'::jsonb;
begin
  if not restaurante.tem_permissao('atendimento.comanda.item.lancar') then
    raise exception 'Sem permissão para lançar item';
  end if;

  select * into v_pedido from restaurante.pedidos_qr
    where id = p_pedido_id and empresa_id = v_empresa_id for update;
  if not found then
    raise exception 'Pedido não encontrado';
  end if;
  if v_pedido.status <> 'PENDENTE' then
    raise exception 'Pedido já foi %', v_pedido.status;
  end if;

  select * into v_comanda from restaurante.comandas
    where mesa_id = v_pedido.mesa_id and empresa_id = v_empresa_id and status in ('ABERTA','FECHANDO')
    order by abertura desc limit 1 for update;
  if not found then
    insert into restaurante.comandas (empresa_id, codigo, mesa_id, tipo, status, usuario_abertura, taxa_servico_ativa, desconto_centavos)
    values (v_empresa_id, 'C'||to_char(now(),'YYYYMMDDHH24MISS'), v_pedido.mesa_id, 'MESA', 'ABERTA', v_usuario_id, true, 0)
    returning * into v_comanda;
  end if;

  for v_elem in select * from jsonb_array_elements(v_pedido.itens)
  loop
    select * into v_produto from restaurante.produtos where id = (v_elem->>'produto_id')::uuid;
    if found and v_produto.ativo and not v_produto.esgotado then
      insert into restaurante.comanda_itens
        (comanda_id, produto_id, nome, observacao, quantidade, preco_unit_centavos, status, usuario_id, setor_producao)
      values (
        v_comanda.id, v_produto.id, v_produto.nome, v_pedido.observacao,
        (v_elem->>'quantidade')::numeric, v_produto.preco_centavos, 'PENDENTE', v_usuario_id, v_produto.setor_producao
      )
      returning * into v_novo_item;
      v_itens_criados := v_itens_criados || to_jsonb(v_novo_item);
    end if;
  end loop;

  update restaurante.pedidos_qr
    set status = 'CONFIRMADO', confirmado_por = v_usuario_id, comanda_id = v_comanda.id
    where id = p_pedido_id;

  return jsonb_build_object('comanda', to_jsonb(v_comanda), 'itens', v_itens_criados);
end;
$$;

revoke all on function restaurante.confirmar_pedido_qr(uuid) from public;
grant execute on function restaurante.confirmar_pedido_qr(uuid) to authenticated;

create or replace function restaurante.rejeitar_pedido_qr(p_pedido_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = restaurante, pg_temp
as $$
declare
  v_empresa_id uuid := restaurante.jwt_empresa_id();
begin
  if not restaurante.tem_permissao('atendimento.comanda.item.lancar') then
    raise exception 'Sem permissão para lançar item';
  end if;
  update restaurante.pedidos_qr
    set status = 'REJEITADO', motivo_rejeicao = nullif(trim(coalesce(p_motivo,'')),''), confirmado_por = auth.uid()
    where id = p_pedido_id and empresa_id = v_empresa_id and status = 'PENDENTE';
  if not found then
    raise exception 'Pedido não encontrado ou já processado';
  end if;
end;
$$;

revoke all on function restaurante.rejeitar_pedido_qr(uuid, text) from public;
grant execute on function restaurante.rejeitar_pedido_qr(uuid, text) to authenticated;
