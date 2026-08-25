-- Financeiro — contas a pagar/receber

create table public.contas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  tipo text not null check (tipo in ('PAGAR','RECEBER')),
  descricao text not null,
  categoria text not null default 'Geral',
  valor_centavos int not null check (valor_centavos > 0),
  vencimento date not null,
  pago_em timestamptz,
  created_at timestamptz not null default now()
);
create index idx_contas_empresa on public.contas (empresa_id, tipo, vencimento);

create trigger trg_contas_auditoria after insert or update or delete on public.contas
  for each row execute function public.fn_audit_trigger();
