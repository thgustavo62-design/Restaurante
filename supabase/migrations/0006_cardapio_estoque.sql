-- Fase 1 — Cardápio e estoque

create table public.categorias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  nome text not null,
  ordem int not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, nome)
);

create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  categoria_id uuid not null references public.categorias (id) on delete restrict,
  nome text not null,
  preco_centavos int not null check (preco_centavos >= 0),
  ativo boolean not null default true,
  esgotado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_produtos_empresa on public.produtos (empresa_id);
create index idx_produtos_categoria on public.produtos (categoria_id);

create table public.insumos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  nome text not null,
  unidade text not null,
  estoque_atual numeric not null default 0,
  estoque_minimo numeric not null default 0,
  custo_medio_centavos int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_insumos_empresa on public.insumos (empresa_id);

create table public.ficha_tecnica (
  produto_id uuid not null references public.produtos (id) on delete cascade,
  insumo_id uuid not null references public.insumos (id) on delete cascade,
  quantidade numeric not null check (quantidade > 0),
  primary key (produto_id, insumo_id)
);

create table public.estoque_movimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  insumo_id uuid not null references public.insumos (id) on delete restrict,
  tipo text not null check (tipo in ('ENTRADA','SAIDA','VENDA')),
  quantidade numeric not null check (quantidade > 0),
  motivo text,
  origem text,
  origem_id uuid,
  usuario_id uuid references public.usuarios (id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_estoque_mov_empresa on public.estoque_movimentos (empresa_id, created_at desc);
create index idx_estoque_mov_insumo on public.estoque_movimentos (insumo_id);

create trigger trg_produtos_updated_at before update on public.produtos
  for each row execute function public.set_updated_at();
create trigger trg_insumos_updated_at before update on public.insumos
  for each row execute function public.set_updated_at();

create trigger trg_produtos_auditoria after insert or update or delete on public.produtos
  for each row execute function public.fn_audit_trigger();
create trigger trg_insumos_auditoria after insert or update or delete on public.insumos
  for each row execute function public.fn_audit_trigger();
