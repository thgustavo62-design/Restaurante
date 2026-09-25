-- Compras e fornecedores (schema restaurante).
-- Fluxo: Rascunho -> Pedido realizado -> Recebido. Ao marcar como
-- recebido, a entrada no estoque é lançada automaticamente (aplicação no
-- client, via estornarBaixa() do domínio — matematicamente é a mesma
-- coisa que devolver estoque, só que a origem é compra em vez de
-- cancelamento).

create table restaurante.fornecedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  nome text not null,
  contato text,
  telefone text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_fornecedores_empresa on restaurante.fornecedores (empresa_id);

create table restaurante.pedidos_compra (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  fornecedor_id uuid not null references restaurante.fornecedores(id) on delete restrict,
  status text not null default 'RASCUNHO' check (status in ('RASCUNHO','PEDIDO_REALIZADO','RECEBIDO')),
  usuario_id uuid not null references restaurante.usuarios(id),
  recebido_em timestamptz,
  created_at timestamptz not null default now()
);
create index idx_pedidos_compra_empresa on restaurante.pedidos_compra (empresa_id, status);

create table restaurante.pedidos_compra_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references restaurante.pedidos_compra(id) on delete cascade,
  insumo_id uuid not null references restaurante.insumos(id) on delete restrict,
  quantidade numeric not null check (quantidade > 0),
  custo_unit_centavos int
);
create index idx_pedidos_compra_itens_pedido on restaurante.pedidos_compra_itens (pedido_id);

alter table restaurante.fornecedores enable row level security;
alter table restaurante.pedidos_compra enable row level security;
alter table restaurante.pedidos_compra_itens enable row level security;

create policy fornecedores_select on restaurante.fornecedores for select
  using (empresa_id = restaurante.jwt_empresa_id());
create policy fornecedores_insert on restaurante.fornecedores for insert
  with check (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.estoque.editar'));
create policy fornecedores_update on restaurante.fornecedores for update
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.estoque.editar'));

create policy pedidos_compra_select on restaurante.pedidos_compra for select
  using (empresa_id = restaurante.jwt_empresa_id());
create policy pedidos_compra_insert on restaurante.pedidos_compra for insert
  with check (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.estoque.editar'));
create policy pedidos_compra_update on restaurante.pedidos_compra for update
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.estoque.editar'));

create policy pedidos_compra_itens_select on restaurante.pedidos_compra_itens for select
  using (exists (select 1 from restaurante.pedidos_compra p where p.id = pedido_id and p.empresa_id = restaurante.jwt_empresa_id()));
create policy pedidos_compra_itens_insert on restaurante.pedidos_compra_itens for insert
  with check (
    restaurante.tem_permissao('admin.estoque.editar')
    and exists (select 1 from restaurante.pedidos_compra p where p.id = pedido_id and p.empresa_id = restaurante.jwt_empresa_id())
  );

grant select on restaurante.fornecedores, restaurante.pedidos_compra, restaurante.pedidos_compra_itens to anon, authenticated;
grant insert, update on restaurante.fornecedores, restaurante.pedidos_compra to authenticated;
grant insert on restaurante.pedidos_compra_itens to authenticated;
