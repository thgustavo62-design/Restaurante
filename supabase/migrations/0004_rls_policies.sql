-- Fase 0 — RLS por empresa + papel

alter table public.empresas enable row level security;
alter table public.usuarios enable row level security;
alter table public.papeis_permissoes enable row level security;
alter table public.auditoria enable row level security;

-- EMPRESAS: cada usuário só enxerga a própria empresa.
create policy empresas_select on public.empresas
  for select
  using (id = public.jwt_empresa_id());

create policy empresas_update_admin on public.empresas
  for update
  using (id = public.jwt_empresa_id() and public.tem_permissao('admin.configuracoes.editar'))
  with check (id = public.jwt_empresa_id());

-- USUARIOS: visível a qualquer autenticado da mesma empresa; escrita
-- restrita a quem tem admin.equipe.editar (ou ao próprio usuário, campos
-- não sensíveis ficam a cargo da UI/edge function).
create policy usuarios_select on public.usuarios
  for select
  using (empresa_id = public.jwt_empresa_id());

create policy usuarios_insert_admin on public.usuarios
  for insert
  with check (
    empresa_id = public.jwt_empresa_id()
    and public.tem_permissao('admin.equipe.editar')
  );

create policy usuarios_update_self_or_admin on public.usuarios
  for update
  using (
    empresa_id = public.jwt_empresa_id()
    and (id = auth.uid() or public.tem_permissao('admin.equipe.editar'))
  )
  with check (empresa_id = public.jwt_empresa_id());

-- usuários nunca são apagados fisicamente (Seção 14) — apenas desativados
-- via update de `ativo`. Não existe policy de DELETE.

-- PAPEIS_PERMISSOES: catálogo de leitura para qualquer autenticado (usado
-- pelo front-end para montar guards de rota); escrita só para quem já tem
-- admin.equipe.editar, via service role / edge function administrativa.
create policy papeis_permissoes_select on public.papeis_permissoes
  for select
  using (auth.role() = 'authenticated');

-- AUDITORIA: leitura restrita a quem tem auditoria.ver na própria empresa;
-- inserção liberada para qualquer autenticado da empresa (é o que os
-- triggers de auditoria fazem em nome do usuário logado), sem update/delete
-- — trilha é imutável.
create policy auditoria_select on public.auditoria
  for select
  using (
    empresa_id = public.jwt_empresa_id()
    and public.tem_permissao('auditoria.ver')
  );

create policy auditoria_insert on public.auditoria
  for insert
  with check (empresa_id = public.jwt_empresa_id());
