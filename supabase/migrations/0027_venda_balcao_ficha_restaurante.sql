-- Fase A1 do v2 (Fogo Gestão, Fase Bar) — modelo de venda: balcão, ficha,
-- mesa. Adaptado do supabase/migrations/0010_venda_balcao_ficha.sql do
-- restaurante-v2 para o schema restaurante (em vez de public) deste banco
-- compartilhado.

alter table restaurante.comandas drop constraint comandas_tipo_check;
alter table restaurante.comandas add constraint comandas_tipo_check
  check (tipo in ('MESA','FICHA','BALCAO'));

alter table restaurante.comandas alter column mesa_id drop not null;

alter table restaurante.comandas add column if not exists ficha_numero int;
alter table restaurante.comandas add column if not exists dia_operacional date not null default current_date;

create unique index if not exists comandas_ficha_aberta_uk
  on restaurante.comandas (empresa_id, ficha_numero)
  where ficha_numero is not null and status in ('ABERTA','FECHANDO');

create table if not exists restaurante.venda_movimentacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  venda_id uuid not null references restaurante.comandas(id) on delete cascade,
  tipo text not null check (tipo in ('TRANSFERENCIA','JUNCAO')),
  origem text not null,
  destino text not null,
  usuario_id uuid not null references restaurante.usuarios(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_venda_movimentacoes_empresa on restaurante.venda_movimentacoes (empresa_id, venda_id);

alter table restaurante.venda_movimentacoes enable row level security;
create policy venda_movimentacoes_select on restaurante.venda_movimentacoes for select
  using (empresa_id = restaurante.jwt_empresa_id());
create policy venda_movimentacoes_insert on restaurante.venda_movimentacoes for insert
  with check (
    empresa_id = restaurante.jwt_empresa_id()
    and (restaurante.tem_permissao('atendimento.comanda.fechar') or restaurante.tem_permissao('atendimento.comanda.abrir'))
  );

alter table restaurante.produtos add column if not exists setor_producao text not null default 'COZINHA'
  check (setor_producao in ('BAR','COZINHA','BRASA','SOBREMESA'));
alter table restaurante.produtos add column if not exists favorito_fixado boolean not null default false;

alter table restaurante.empresas add column if not exists total_fichas int not null default 50;
alter table restaurante.empresas add column if not exists virada_dia_operacional_hora int not null default 5;

update restaurante.comandas
set dia_operacional = (abertura - interval '5 hours')::date
where dia_operacional = current_date and abertura is not null;
