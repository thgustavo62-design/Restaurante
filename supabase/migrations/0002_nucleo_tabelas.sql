-- Fase 0 — Núcleo: empresas, usuários, RBAC, auditoria

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj text,
  timezone text not null default 'America/Sao_Paulo',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id) on delete restrict,
  nome text not null,
  papel public.papel_usuario not null,
  pin_hash text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_usuarios_empresa on public.usuarios (empresa_id);
create unique index idx_usuarios_empresa_pin on public.usuarios (empresa_id, pin_hash) where pin_hash is not null;

-- Catálogo de permissões por papel. Não é dado de exemplo/demonstração —
-- é configuração do RBAC do sistema, semeada em 0005_seed_papeis_permissoes.sql.
create table public.papeis_permissoes (
  papel public.papel_usuario not null,
  permissao text not null,
  primary key (papel, permissao)
);

create table public.auditoria (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  usuario_id uuid references public.usuarios (id) on delete set null,
  entidade text not null,
  entidade_id uuid,
  acao text not null,
  dados_antes jsonb,
  dados_depois jsonb,
  created_at timestamptz not null default now()
);
create index idx_auditoria_empresa on public.auditoria (empresa_id, created_at desc);
create index idx_auditoria_entidade on public.auditoria (entidade, entidade_id);

create trigger trg_empresas_updated_at
  before update on public.empresas
  for each row execute function public.set_updated_at();

create trigger trg_usuarios_updated_at
  before update on public.usuarios
  for each row execute function public.set_updated_at();

-- Trigger de auditoria genérica, reutilizada pelas fases seguintes em
-- qualquer tabela que tenha colunas `id` e `empresa_id`.
create or replace function public.fn_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa_id uuid;
begin
  v_empresa_id := case when TG_OP = 'DELETE' then old.empresa_id else new.empresa_id end;

  insert into public.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, dados_antes, dados_depois)
  values (
    v_empresa_id,
    auth.uid(),
    TG_TABLE_NAME,
    case when TG_OP = 'DELETE' then old.id else new.id end,
    TG_OP,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('UPDATE', 'INSERT') then to_jsonb(new) else null end
  );

  return coalesce(new, old);
end;
$$;

create trigger trg_usuarios_auditoria
  after insert or update or delete on public.usuarios
  for each row execute function public.fn_audit_trigger();
