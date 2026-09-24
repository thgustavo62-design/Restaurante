-- Fase B1 (Fogo Gestão v2) — insumo_rendimentos, no schema restaurante.
-- Adaptado do rendimento.ts do domínio: uma linha "atual" por insumo
-- (unique em empresa_id+insumo_id), medir de novo substitui a anterior.

create table restaurante.insumo_rendimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  insumo_id uuid not null references restaurante.insumos(id) on delete cascade,
  fator numeric(4,3) not null check (fator > 0 and fator <= 1),
  observacao text,
  medido_em date not null default current_date,
  usuario_id uuid not null references restaurante.usuarios(id)
);
create unique index insumo_rendimentos_atual_uk on restaurante.insumo_rendimentos (empresa_id, insumo_id);

alter table restaurante.insumo_rendimentos enable row level security;

create policy insumo_rendimentos_select on restaurante.insumo_rendimentos for select
  using (empresa_id = restaurante.jwt_empresa_id());

create policy insumo_rendimentos_upsert on restaurante.insumo_rendimentos for insert
  with check (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.estoque.editar'));

create policy insumo_rendimentos_update on restaurante.insumo_rendimentos for update
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.estoque.editar'));

grant select on restaurante.insumo_rendimentos to anon, authenticated;
grant insert, update on restaurante.insumo_rendimentos to authenticated;
