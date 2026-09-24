-- Bootstrap do restaurante num banco compartilhado com outro app (Campo
-- Forte, em `public`). Consolida 0001-0010 (núcleo, auth, cardápio/estoque,
-- atendimento, caixa/pagamentos, financeiro, RLS fase 1) num schema próprio
-- — `restaurante` — para não colidir com tabelas de outro app no mesmo
-- projeto Supabase. Mesma lógica das migrations originais, só relocada.

create schema if not exists restaurante;

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

do $$
begin
  create type restaurante.papel_usuario as enum ('ADMIN', 'GERENTE', 'CAIXA', 'GARCOM', 'COZINHA');
exception
  when duplicate_object then null;
end
$$;

create or replace function restaurante.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

/* ---------- núcleo ---------- */

create table restaurante.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj text,
  timezone text not null default 'America/Sao_Paulo',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table restaurante.usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  empresa_id uuid not null references restaurante.empresas (id) on delete restrict,
  nome text not null,
  papel restaurante.papel_usuario not null,
  pin_hash text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_usuarios_empresa on restaurante.usuarios (empresa_id);
create unique index idx_usuarios_empresa_pin on restaurante.usuarios (empresa_id, pin_hash) where pin_hash is not null;

create table restaurante.papeis_permissoes (
  papel restaurante.papel_usuario not null,
  permissao text not null,
  primary key (papel, permissao)
);

create table restaurante.auditoria (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas (id) on delete cascade,
  usuario_id uuid references restaurante.usuarios (id) on delete set null,
  entidade text not null,
  entidade_id uuid,
  acao text not null,
  dados_antes jsonb,
  dados_depois jsonb,
  motivo text,
  created_at timestamptz not null default now()
);
create index idx_auditoria_empresa on restaurante.auditoria (empresa_id, created_at desc);
create index idx_auditoria_entidade on restaurante.auditoria (entidade, entidade_id);

create trigger trg_empresas_updated_at
  before update on restaurante.empresas
  for each row execute function restaurante.set_updated_at();

create trigger trg_usuarios_updated_at
  before update on restaurante.usuarios
  for each row execute function restaurante.set_updated_at();

create or replace function restaurante.fn_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = restaurante
as $$
declare
  v_empresa_id uuid;
begin
  v_empresa_id := case when TG_OP = 'DELETE' then old.empresa_id else new.empresa_id end;

  insert into restaurante.auditoria (empresa_id, usuario_id, entidade, entidade_id, acao, dados_antes, dados_depois)
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
  after insert or update or delete on restaurante.usuarios
  for each row execute function restaurante.fn_audit_trigger();

/* ---------- claims de JWT e permissão ---------- */

create or replace function restaurante.jwt_empresa_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'empresa_id', '')::uuid
$$;

create or replace function restaurante.jwt_papel()
returns text
language sql
stable
as $$
  select current_setting('request.jwt.claims', true)::jsonb ->> 'papel'
$$;

create or replace function restaurante.tem_permissao(p_permissao text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from restaurante.papeis_permissoes pp
    where pp.papel = restaurante.jwt_papel()::restaurante.papel_usuario
      and pp.permissao = p_permissao
  )
$$;

-- IMPORTANTE: registrar este hook em Auth > Hooks no painel do Supabase,
-- schema `restaurante`, função `custom_access_token_hook` — não é feito por
-- migration SQL, é configuração do serviço de Auth.
create or replace function restaurante.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = restaurante, pg_temp
as $$
declare
  claims jsonb;
  v_empresa_id uuid;
  v_papel restaurante.papel_usuario;
begin
  select u.empresa_id, u.papel
  into v_empresa_id, v_papel
  from restaurante.usuarios u
  where u.id = (event ->> 'user_id')::uuid
    and u.ativo = true;

  claims := event -> 'claims';

  if v_empresa_id is not null then
    claims := jsonb_set(claims, '{empresa_id}', to_jsonb(v_empresa_id::text));
    claims := jsonb_set(claims, '{papel}', to_jsonb(v_papel::text));
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

grant execute on function restaurante.custom_access_token_hook to supabase_auth_admin;
revoke execute on function restaurante.custom_access_token_hook from authenticated, anon, public;

grant usage on schema restaurante to supabase_auth_admin;
grant select on restaurante.usuarios to supabase_auth_admin;

/* ---------- RLS: núcleo ---------- */

alter table restaurante.empresas enable row level security;
alter table restaurante.usuarios enable row level security;
alter table restaurante.papeis_permissoes enable row level security;
alter table restaurante.auditoria enable row level security;

create policy empresas_select on restaurante.empresas
  for select
  using (id = restaurante.jwt_empresa_id());

create policy empresas_update_admin on restaurante.empresas
  for update
  using (id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.configuracoes.editar'))
  with check (id = restaurante.jwt_empresa_id());

create policy usuarios_select on restaurante.usuarios
  for select
  using (empresa_id = restaurante.jwt_empresa_id());

create policy usuarios_insert_admin on restaurante.usuarios
  for insert
  with check (
    empresa_id = restaurante.jwt_empresa_id()
    and restaurante.tem_permissao('admin.equipe.editar')
  );

create policy usuarios_update_self_or_admin on restaurante.usuarios
  for update
  using (
    empresa_id = restaurante.jwt_empresa_id()
    and (id = auth.uid() or restaurante.tem_permissao('admin.equipe.editar'))
  )
  with check (empresa_id = restaurante.jwt_empresa_id());

create policy papeis_permissoes_select on restaurante.papeis_permissoes
  for select
  using (auth.role() = 'authenticated');

create policy auditoria_select on restaurante.auditoria
  for select
  using (
    empresa_id = restaurante.jwt_empresa_id()
    and restaurante.tem_permissao('auditoria.ver')
  );

create policy auditoria_insert on restaurante.auditoria
  for insert
  with check (empresa_id = restaurante.jwt_empresa_id());

/* ---------- seed RBAC (config do sistema, espelha docs/rotas-permissoes.md) ---------- */

insert into restaurante.papeis_permissoes (papel, permissao) values
  ('ADMIN', 'atendimento.salao.ver'), ('ADMIN', 'atendimento.comanda.abrir'),
  ('ADMIN', 'atendimento.comanda.item.lancar'), ('ADMIN', 'atendimento.comanda.item.cancelar'),
  ('ADMIN', 'atendimento.comanda.desconto.aplicar'), ('ADMIN', 'atendimento.comanda.transferir'),
  ('ADMIN', 'atendimento.comanda.reabrir'), ('ADMIN', 'atendimento.comanda.fechar'),
  ('ADMIN', 'cozinha.kds.ver'), ('ADMIN', 'cozinha.item.atualizar_status'),
  ('ADMIN', 'caixa.sessao.abrir'), ('ADMIN', 'caixa.sessao.fechar'),
  ('ADMIN', 'caixa.movimento.sangria'), ('ADMIN', 'caixa.movimento.suprimento'),
  ('ADMIN', 'caixa.pagamento.registrar'), ('ADMIN', 'admin.cardapio.editar'),
  ('ADMIN', 'admin.estoque.editar'), ('ADMIN', 'admin.equipe.editar'),
  ('ADMIN', 'admin.financeiro.ver'), ('ADMIN', 'admin.financeiro.editar'),
  ('ADMIN', 'admin.relatorios.ver'), ('ADMIN', 'admin.configuracoes.editar'),
  ('ADMIN', 'auditoria.ver'),

  ('GERENTE', 'atendimento.salao.ver'), ('GERENTE', 'atendimento.comanda.abrir'),
  ('GERENTE', 'atendimento.comanda.item.lancar'), ('GERENTE', 'atendimento.comanda.item.cancelar'),
  ('GERENTE', 'atendimento.comanda.desconto.aplicar'), ('GERENTE', 'atendimento.comanda.transferir'),
  ('GERENTE', 'atendimento.comanda.reabrir'), ('GERENTE', 'atendimento.comanda.fechar'),
  ('GERENTE', 'cozinha.kds.ver'), ('GERENTE', 'cozinha.item.atualizar_status'),
  ('GERENTE', 'caixa.sessao.abrir'), ('GERENTE', 'caixa.sessao.fechar'),
  ('GERENTE', 'caixa.movimento.sangria'), ('GERENTE', 'caixa.movimento.suprimento'),
  ('GERENTE', 'caixa.pagamento.registrar'), ('GERENTE', 'admin.cardapio.editar'),
  ('GERENTE', 'admin.estoque.editar'), ('GERENTE', 'admin.equipe.editar'),
  ('GERENTE', 'admin.financeiro.ver'), ('GERENTE', 'admin.financeiro.editar'),
  ('GERENTE', 'admin.relatorios.ver'), ('GERENTE', 'auditoria.ver'),

  ('CAIXA', 'atendimento.salao.ver'), ('CAIXA', 'atendimento.comanda.abrir'),
  ('CAIXA', 'atendimento.comanda.item.lancar'), ('CAIXA', 'atendimento.comanda.fechar'),
  ('CAIXA', 'caixa.sessao.abrir'), ('CAIXA', 'caixa.sessao.fechar'),
  ('CAIXA', 'caixa.movimento.sangria'), ('CAIXA', 'caixa.movimento.suprimento'),
  ('CAIXA', 'caixa.pagamento.registrar'),

  ('GARCOM', 'atendimento.salao.ver'), ('GARCOM', 'atendimento.comanda.abrir'),
  ('GARCOM', 'atendimento.comanda.item.lancar'), ('GARCOM', 'atendimento.comanda.fechar'),

  ('COZINHA', 'cozinha.kds.ver'), ('COZINHA', 'cozinha.item.atualizar_status')
on conflict (papel, permissao) do nothing;

/* ---------- cardápio e estoque ---------- */

create table restaurante.categorias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas (id) on delete cascade,
  nome text not null,
  ordem int not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, nome)
);

create table restaurante.produtos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas (id) on delete cascade,
  categoria_id uuid not null references restaurante.categorias (id) on delete restrict,
  nome text not null,
  preco_centavos int not null check (preco_centavos >= 0),
  ativo boolean not null default true,
  esgotado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_produtos_empresa on restaurante.produtos (empresa_id);
create index idx_produtos_categoria on restaurante.produtos (categoria_id);

create table restaurante.insumos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas (id) on delete cascade,
  nome text not null,
  unidade text not null,
  estoque_atual numeric not null default 0,
  estoque_minimo numeric not null default 0,
  custo_medio_centavos int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_insumos_empresa on restaurante.insumos (empresa_id);

create table restaurante.ficha_tecnica (
  produto_id uuid not null references restaurante.produtos (id) on delete cascade,
  insumo_id uuid not null references restaurante.insumos (id) on delete cascade,
  quantidade numeric not null check (quantidade > 0),
  primary key (produto_id, insumo_id)
);

create table restaurante.estoque_movimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas (id) on delete cascade,
  insumo_id uuid not null references restaurante.insumos (id) on delete restrict,
  tipo text not null check (tipo in ('ENTRADA','SAIDA','VENDA')),
  quantidade numeric not null check (quantidade > 0),
  motivo text,
  origem text,
  origem_id uuid,
  usuario_id uuid references restaurante.usuarios (id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_estoque_mov_empresa on restaurante.estoque_movimentos (empresa_id, created_at desc);
create index idx_estoque_mov_insumo on restaurante.estoque_movimentos (insumo_id);

create trigger trg_produtos_updated_at before update on restaurante.produtos
  for each row execute function restaurante.set_updated_at();
create trigger trg_insumos_updated_at before update on restaurante.insumos
  for each row execute function restaurante.set_updated_at();

create trigger trg_produtos_auditoria after insert or update or delete on restaurante.produtos
  for each row execute function restaurante.fn_audit_trigger();
create trigger trg_insumos_auditoria after insert or update or delete on restaurante.insumos
  for each row execute function restaurante.fn_audit_trigger();

/* ---------- atendimento: mesas, comandas, itens ---------- */

create table restaurante.mesas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas (id) on delete cascade,
  numero int not null,
  capacidade int not null default 2,
  area text not null default 'Salão',
  created_at timestamptz not null default now(),
  unique (empresa_id, numero)
);

create table restaurante.comandas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas (id) on delete cascade,
  codigo text not null,
  mesa_id uuid references restaurante.mesas (id) on delete restrict,
  tipo text not null default 'MESA' check (tipo in ('MESA','BALCAO','DELIVERY','RETIRADA')),
  status text not null default 'ABERTA' check (status in ('ABERTA','FECHANDO','PAGA','CANCELADA')),
  abertura timestamptz not null default now(),
  fechamento timestamptz,
  usuario_abertura uuid references restaurante.usuarios (id) on delete set null,
  taxa_servico_ativa boolean not null default true,
  desconto_centavos int not null default 0,
  troco_centavos int not null default 0,
  client_uuid uuid,
  created_at timestamptz not null default now(),
  unique (empresa_id, codigo)
);
create index idx_comandas_empresa_status on restaurante.comandas (empresa_id, status);
create index idx_comandas_mesa on restaurante.comandas (mesa_id);
create unique index idx_comandas_client_uuid on restaurante.comandas (client_uuid) where client_uuid is not null;

create table restaurante.comanda_itens (
  id uuid primary key default gen_random_uuid(),
  comanda_id uuid not null references restaurante.comandas (id) on delete cascade,
  produto_id uuid not null references restaurante.produtos (id) on delete restrict,
  nome text not null,
  observacao text,
  quantidade numeric not null check (quantidade > 0),
  preco_unit_centavos int not null check (preco_unit_centavos >= 0),
  status text not null default 'PENDENTE' check (status in ('PENDENTE','PREPARANDO','PRONTO','ENTREGUE','CANCELADO')),
  usuario_id uuid references restaurante.usuarios (id) on delete set null,
  enviado_em timestamptz not null default now(),
  client_uuid uuid,
  created_at timestamptz not null default now(),
  cancelado_apos_preparo boolean not null default false
);
create index idx_comanda_itens_comanda on restaurante.comanda_itens (comanda_id);
create unique index idx_comanda_itens_client_uuid on restaurante.comanda_itens (client_uuid) where client_uuid is not null;

create trigger trg_comandas_auditoria after insert or update or delete on restaurante.comandas
  for each row execute function restaurante.fn_audit_trigger();

/* ---------- caixa e pagamentos ---------- */

create table restaurante.caixa_sessoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas (id) on delete cascade,
  terminal text not null default 'Terminal 1',
  usuario_abertura uuid references restaurante.usuarios (id) on delete set null,
  abertura_em timestamptz not null default now(),
  saldo_inicial_centavos int not null default 0,
  usuario_fechamento uuid references restaurante.usuarios (id) on delete set null,
  fechamento_em timestamptz,
  saldo_calculado_centavos int,
  saldo_informado_centavos int,
  diferenca_centavos int,
  fechamento_detalhe jsonb,
  status text not null default 'ABERTA' check (status in ('ABERTA','FECHADA')),
  created_at timestamptz not null default now()
);
create index idx_caixa_sessoes_empresa on restaurante.caixa_sessoes (empresa_id, status);

create table restaurante.caixa_movimentos (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null references restaurante.caixa_sessoes (id) on delete cascade,
  tipo text not null check (tipo in ('SUPRIMENTO','SANGRIA','VENDA','ESTORNO','AJUSTE')),
  valor_centavos int not null check (valor_centavos >= 0),
  forma_pagamento text not null default 'DINHEIRO',
  comanda_id uuid references restaurante.comandas (id) on delete set null,
  usuario_id uuid references restaurante.usuarios (id) on delete set null,
  motivo text,
  client_uuid uuid,
  created_at timestamptz not null default now()
);
create index idx_caixa_mov_sessao on restaurante.caixa_movimentos (sessao_id, created_at);
create unique index idx_caixa_mov_client_uuid on restaurante.caixa_movimentos (client_uuid) where client_uuid is not null;

create table restaurante.pagamentos (
  id uuid primary key default gen_random_uuid(),
  comanda_id uuid not null references restaurante.comandas (id) on delete cascade,
  sessao_id uuid references restaurante.caixa_sessoes (id) on delete set null,
  forma text not null,
  valor_centavos int not null check (valor_centavos >= 0),
  created_at timestamptz not null default now()
);
create index idx_pagamentos_comanda on restaurante.pagamentos (comanda_id);
create index idx_pagamentos_sessao on restaurante.pagamentos (sessao_id);

create trigger trg_caixa_sessoes_auditoria after insert or update or delete on restaurante.caixa_sessoes
  for each row execute function restaurante.fn_audit_trigger();

/* ---------- financeiro ---------- */

create table restaurante.contas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas (id) on delete cascade,
  tipo text not null check (tipo in ('PAGAR','RECEBER')),
  descricao text not null,
  categoria text not null default 'Geral',
  valor_centavos int not null check (valor_centavos > 0),
  vencimento date not null,
  pago_em timestamptz,
  created_at timestamptz not null default now()
);
create index idx_contas_empresa on restaurante.contas (empresa_id, tipo, vencimento);

create trigger trg_contas_auditoria after insert or update or delete on restaurante.contas
  for each row execute function restaurante.fn_audit_trigger();

/* ---------- RLS fase 1: cardápio, estoque, atendimento, caixa, financeiro ---------- */

alter table restaurante.categorias enable row level security;
alter table restaurante.produtos enable row level security;
alter table restaurante.insumos enable row level security;
alter table restaurante.ficha_tecnica enable row level security;
alter table restaurante.estoque_movimentos enable row level security;
alter table restaurante.mesas enable row level security;
alter table restaurante.comandas enable row level security;
alter table restaurante.comanda_itens enable row level security;
alter table restaurante.caixa_sessoes enable row level security;
alter table restaurante.caixa_movimentos enable row level security;
alter table restaurante.pagamentos enable row level security;
alter table restaurante.contas enable row level security;

create policy categorias_select on restaurante.categorias for select
  using (empresa_id = restaurante.jwt_empresa_id());
create policy categorias_write on restaurante.categorias for insert
  with check (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.cardapio.editar'));
create policy categorias_update on restaurante.categorias for update
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.cardapio.editar'));

create policy produtos_select on restaurante.produtos for select
  using (empresa_id = restaurante.jwt_empresa_id());
create policy produtos_write on restaurante.produtos for insert
  with check (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.cardapio.editar'));
create policy produtos_update on restaurante.produtos for update
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.cardapio.editar'));

create policy insumos_select on restaurante.insumos for select
  using (empresa_id = restaurante.jwt_empresa_id());
create policy insumos_write on restaurante.insumos for insert
  with check (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.estoque.editar'));
create policy insumos_update on restaurante.insumos for update
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.estoque.editar'));

create policy ficha_tecnica_select on restaurante.ficha_tecnica for select
  using (exists (select 1 from restaurante.produtos p where p.id = produto_id and p.empresa_id = restaurante.jwt_empresa_id()));
create policy ficha_tecnica_write on restaurante.ficha_tecnica for insert
  with check (
    restaurante.tem_permissao('admin.estoque.editar')
    and exists (select 1 from restaurante.produtos p where p.id = produto_id and p.empresa_id = restaurante.jwt_empresa_id())
  );

create policy estoque_mov_select on restaurante.estoque_movimentos for select
  using (empresa_id = restaurante.jwt_empresa_id());
create policy estoque_mov_insert on restaurante.estoque_movimentos for insert
  with check (
    empresa_id = restaurante.jwt_empresa_id()
    and (restaurante.tem_permissao('admin.estoque.editar') or restaurante.tem_permissao('caixa.pagamento.registrar'))
  );

create policy mesas_select on restaurante.mesas for select
  using (empresa_id = restaurante.jwt_empresa_id());
create policy mesas_write on restaurante.mesas for insert
  with check (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.cardapio.editar'));
create policy mesas_update on restaurante.mesas for update
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.cardapio.editar'));

create policy comandas_select on restaurante.comandas for select
  using (empresa_id = restaurante.jwt_empresa_id());
create policy comandas_insert on restaurante.comandas for insert
  with check (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('atendimento.comanda.abrir'));
create policy comandas_update on restaurante.comandas for update
  using (
    empresa_id = restaurante.jwt_empresa_id()
    and (restaurante.tem_permissao('atendimento.comanda.fechar') or restaurante.tem_permissao('atendimento.comanda.abrir')
         or restaurante.tem_permissao('atendimento.comanda.desconto.aplicar') or restaurante.tem_permissao('atendimento.comanda.reabrir'))
  );

create policy comanda_itens_select on restaurante.comanda_itens for select
  using (exists (select 1 from restaurante.comandas c where c.id = comanda_id and c.empresa_id = restaurante.jwt_empresa_id()));
create policy comanda_itens_insert on restaurante.comanda_itens for insert
  with check (
    restaurante.tem_permissao('atendimento.comanda.item.lancar')
    and exists (select 1 from restaurante.comandas c where c.id = comanda_id and c.empresa_id = restaurante.jwt_empresa_id())
  );
create policy comanda_itens_update on restaurante.comanda_itens for update
  using (
    (restaurante.tem_permissao('cozinha.item.atualizar_status') or restaurante.tem_permissao('atendimento.comanda.item.cancelar'))
    and exists (select 1 from restaurante.comandas c where c.id = comanda_id and c.empresa_id = restaurante.jwt_empresa_id())
  );

create policy caixa_sessoes_select on restaurante.caixa_sessoes for select
  using (empresa_id = restaurante.jwt_empresa_id());
create policy caixa_sessoes_insert on restaurante.caixa_sessoes for insert
  with check (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('caixa.sessao.abrir'));
create policy caixa_sessoes_update on restaurante.caixa_sessoes for update
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('caixa.sessao.fechar'));

create policy caixa_mov_select on restaurante.caixa_movimentos for select
  using (exists (select 1 from restaurante.caixa_sessoes s where s.id = sessao_id and s.empresa_id = restaurante.jwt_empresa_id()));
create policy caixa_mov_insert on restaurante.caixa_movimentos for insert
  with check (
    (restaurante.tem_permissao('caixa.movimento.sangria') or restaurante.tem_permissao('caixa.movimento.suprimento') or restaurante.tem_permissao('caixa.pagamento.registrar'))
    and exists (select 1 from restaurante.caixa_sessoes s where s.id = sessao_id and s.empresa_id = restaurante.jwt_empresa_id())
  );

create policy pagamentos_select on restaurante.pagamentos for select
  using (exists (select 1 from restaurante.comandas c where c.id = comanda_id and c.empresa_id = restaurante.jwt_empresa_id()));
create policy pagamentos_insert on restaurante.pagamentos for insert
  with check (
    restaurante.tem_permissao('caixa.pagamento.registrar')
    and exists (select 1 from restaurante.comandas c where c.id = comanda_id and c.empresa_id = restaurante.jwt_empresa_id())
  );

create policy contas_select on restaurante.contas for select
  using (empresa_id = restaurante.jwt_empresa_id());
-- já nasce com a correção da 0020: caixa.pagamento.registrar também pode gerar recebível de FIADO/CREDITO/VOUCHER.
create policy contas_insert on restaurante.contas for insert
  with check (
    empresa_id = restaurante.jwt_empresa_id()
    and (restaurante.tem_permissao('admin.financeiro.ver') or restaurante.tem_permissao('caixa.pagamento.registrar'))
  );
create policy contas_update on restaurante.contas for update
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.financeiro.ver'));
