-- Fase 1 — Atendimento: mesas, comandas, itens

create table public.mesas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  numero int not null,
  capacidade int not null default 2,
  area text not null default 'Salão',
  created_at timestamptz not null default now(),
  unique (empresa_id, numero)
);

create table public.comandas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  codigo text not null,
  mesa_id uuid references public.mesas (id) on delete restrict,
  tipo text not null default 'MESA' check (tipo in ('MESA','BALCAO','DELIVERY','RETIRADA')),
  status text not null default 'ABERTA' check (status in ('ABERTA','FECHANDO','PAGA','CANCELADA')),
  abertura timestamptz not null default now(),
  fechamento timestamptz,
  usuario_abertura uuid references public.usuarios (id) on delete set null,
  taxa_servico_ativa boolean not null default true,
  desconto_centavos int not null default 0,
  troco_centavos int not null default 0,
  client_uuid uuid,
  created_at timestamptz not null default now(),
  unique (empresa_id, codigo)
);
create index idx_comandas_empresa_status on public.comandas (empresa_id, status);
create index idx_comandas_mesa on public.comandas (mesa_id);
create unique index idx_comandas_client_uuid on public.comandas (client_uuid) where client_uuid is not null;

create table public.comanda_itens (
  id uuid primary key default gen_random_uuid(),
  comanda_id uuid not null references public.comandas (id) on delete cascade,
  produto_id uuid not null references public.produtos (id) on delete restrict,
  nome text not null,
  observacao text,
  quantidade numeric not null check (quantidade > 0),
  preco_unit_centavos int not null check (preco_unit_centavos >= 0),
  status text not null default 'PENDENTE' check (status in ('PENDENTE','PREPARANDO','PRONTO','ENTREGUE','CANCELADO')),
  usuario_id uuid references public.usuarios (id) on delete set null,
  enviado_em timestamptz not null default now(),
  client_uuid uuid,
  created_at timestamptz not null default now()
);
create index idx_comanda_itens_comanda on public.comanda_itens (comanda_id);
create unique index idx_comanda_itens_client_uuid on public.comanda_itens (client_uuid) where client_uuid is not null;

create trigger trg_comandas_auditoria after insert or update or delete on public.comandas
  for each row execute function public.fn_audit_trigger();

-- comanda_itens não tem empresa_id direto; auditoria genérica exige essa coluna,
-- então itens são auditados através da própria comanda (trigger acima) e não
-- individualmente por enquanto.
