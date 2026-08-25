-- Fase 2 — Caixa e pagamentos

create table public.caixa_sessoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  terminal text not null default 'Terminal 1',
  usuario_abertura uuid references public.usuarios (id) on delete set null,
  abertura_em timestamptz not null default now(),
  saldo_inicial_centavos int not null default 0,
  usuario_fechamento uuid references public.usuarios (id) on delete set null,
  fechamento_em timestamptz,
  saldo_calculado_centavos int,
  saldo_informado_centavos int,
  diferenca_centavos int,
  fechamento_detalhe jsonb,
  status text not null default 'ABERTA' check (status in ('ABERTA','FECHADA')),
  created_at timestamptz not null default now()
);
create index idx_caixa_sessoes_empresa on public.caixa_sessoes (empresa_id, status);

create table public.caixa_movimentos (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null references public.caixa_sessoes (id) on delete cascade,
  tipo text not null check (tipo in ('SUPRIMENTO','SANGRIA','VENDA','ESTORNO','AJUSTE')),
  valor_centavos int not null check (valor_centavos >= 0),
  forma_pagamento text not null default 'DINHEIRO',
  comanda_id uuid references public.comandas (id) on delete set null,
  usuario_id uuid references public.usuarios (id) on delete set null,
  motivo text,
  client_uuid uuid,
  created_at timestamptz not null default now()
);
create index idx_caixa_mov_sessao on public.caixa_movimentos (sessao_id, created_at);
create unique index idx_caixa_mov_client_uuid on public.caixa_movimentos (client_uuid) where client_uuid is not null;

create table public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  comanda_id uuid not null references public.comandas (id) on delete cascade,
  sessao_id uuid references public.caixa_sessoes (id) on delete set null,
  forma text not null,
  valor_centavos int not null check (valor_centavos >= 0),
  created_at timestamptz not null default now()
);
create index idx_pagamentos_comanda on public.pagamentos (comanda_id);
create index idx_pagamentos_sessao on public.pagamentos (sessao_id);

create trigger trg_caixa_sessoes_auditoria after insert or update or delete on public.caixa_sessoes
  for each row execute function public.fn_audit_trigger();
