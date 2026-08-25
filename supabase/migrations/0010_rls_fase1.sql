-- Fase 1 — RLS para cardápio, estoque, atendimento, caixa e financeiro
-- Padrão: SELECT liberado para qualquer autenticado da mesma empresa;
-- INSERT/UPDATE exigem a permissão correspondente do papel (via tem_permissao());
-- sem policy de DELETE em nenhuma tabela — trilha sempre preservada (cancelamento, não exclusão).

alter table public.categorias enable row level security;
alter table public.produtos enable row level security;
alter table public.insumos enable row level security;
alter table public.ficha_tecnica enable row level security;
alter table public.estoque_movimentos enable row level security;
alter table public.mesas enable row level security;
alter table public.comandas enable row level security;
alter table public.comanda_itens enable row level security;
alter table public.caixa_sessoes enable row level security;
alter table public.caixa_movimentos enable row level security;
alter table public.pagamentos enable row level security;
alter table public.contas enable row level security;

-- CATEGORIAS
create policy categorias_select on public.categorias for select
  using (empresa_id = public.jwt_empresa_id());
create policy categorias_write on public.categorias for insert
  with check (empresa_id = public.jwt_empresa_id() and public.tem_permissao('admin.cardapio.editar'));
create policy categorias_update on public.categorias for update
  using (empresa_id = public.jwt_empresa_id() and public.tem_permissao('admin.cardapio.editar'));

-- PRODUTOS
create policy produtos_select on public.produtos for select
  using (empresa_id = public.jwt_empresa_id());
create policy produtos_write on public.produtos for insert
  with check (empresa_id = public.jwt_empresa_id() and public.tem_permissao('admin.cardapio.editar'));
create policy produtos_update on public.produtos for update
  using (empresa_id = public.jwt_empresa_id() and public.tem_permissao('admin.cardapio.editar'));

-- INSUMOS
create policy insumos_select on public.insumos for select
  using (empresa_id = public.jwt_empresa_id());
create policy insumos_write on public.insumos for insert
  with check (empresa_id = public.jwt_empresa_id() and public.tem_permissao('admin.estoque.editar'));
create policy insumos_update on public.insumos for update
  using (empresa_id = public.jwt_empresa_id() and public.tem_permissao('admin.estoque.editar'));

-- FICHA_TECNICA (escopo via produto)
create policy ficha_tecnica_select on public.ficha_tecnica for select
  using (exists (select 1 from public.produtos p where p.id = produto_id and p.empresa_id = public.jwt_empresa_id()));
create policy ficha_tecnica_write on public.ficha_tecnica for insert
  with check (
    public.tem_permissao('admin.estoque.editar')
    and exists (select 1 from public.produtos p where p.id = produto_id and p.empresa_id = public.jwt_empresa_id())
  );

-- ESTOQUE_MOVIMENTOS
create policy estoque_mov_select on public.estoque_movimentos for select
  using (empresa_id = public.jwt_empresa_id());
create policy estoque_mov_insert on public.estoque_movimentos for insert
  with check (
    empresa_id = public.jwt_empresa_id()
    and (public.tem_permissao('admin.estoque.editar') or public.tem_permissao('caixa.pagamento.registrar'))
  );

-- MESAS
create policy mesas_select on public.mesas for select
  using (empresa_id = public.jwt_empresa_id());
create policy mesas_write on public.mesas for insert
  with check (empresa_id = public.jwt_empresa_id() and public.tem_permissao('admin.cardapio.editar'));
create policy mesas_update on public.mesas for update
  using (empresa_id = public.jwt_empresa_id() and public.tem_permissao('admin.cardapio.editar'));

-- COMANDAS
create policy comandas_select on public.comandas for select
  using (empresa_id = public.jwt_empresa_id());
create policy comandas_insert on public.comandas for insert
  with check (empresa_id = public.jwt_empresa_id() and public.tem_permissao('atendimento.comanda.abrir'));
create policy comandas_update on public.comandas for update
  using (
    empresa_id = public.jwt_empresa_id()
    and (public.tem_permissao('atendimento.comanda.fechar') or public.tem_permissao('atendimento.comanda.abrir')
         or public.tem_permissao('atendimento.comanda.desconto.aplicar') or public.tem_permissao('atendimento.comanda.reabrir'))
  );

-- COMANDA_ITENS (escopo via comanda)
create policy comanda_itens_select on public.comanda_itens for select
  using (exists (select 1 from public.comandas c where c.id = comanda_id and c.empresa_id = public.jwt_empresa_id()));
create policy comanda_itens_insert on public.comanda_itens for insert
  with check (
    public.tem_permissao('atendimento.comanda.item.lancar')
    and exists (select 1 from public.comandas c where c.id = comanda_id and c.empresa_id = public.jwt_empresa_id())
  );
create policy comanda_itens_update on public.comanda_itens for update
  using (
    (public.tem_permissao('cozinha.item.atualizar_status') or public.tem_permissao('atendimento.comanda.item.cancelar'))
    and exists (select 1 from public.comandas c where c.id = comanda_id and c.empresa_id = public.jwt_empresa_id())
  );

-- CAIXA_SESSOES
create policy caixa_sessoes_select on public.caixa_sessoes for select
  using (empresa_id = public.jwt_empresa_id());
create policy caixa_sessoes_insert on public.caixa_sessoes for insert
  with check (empresa_id = public.jwt_empresa_id() and public.tem_permissao('caixa.sessao.abrir'));
create policy caixa_sessoes_update on public.caixa_sessoes for update
  using (empresa_id = public.jwt_empresa_id() and public.tem_permissao('caixa.sessao.fechar'));

-- CAIXA_MOVIMENTOS (escopo via sessão)
create policy caixa_mov_select on public.caixa_movimentos for select
  using (exists (select 1 from public.caixa_sessoes s where s.id = sessao_id and s.empresa_id = public.jwt_empresa_id()));
create policy caixa_mov_insert on public.caixa_movimentos for insert
  with check (
    (public.tem_permissao('caixa.movimento.sangria') or public.tem_permissao('caixa.movimento.suprimento') or public.tem_permissao('caixa.pagamento.registrar'))
    and exists (select 1 from public.caixa_sessoes s where s.id = sessao_id and s.empresa_id = public.jwt_empresa_id())
  );

-- PAGAMENTOS (escopo via comanda)
create policy pagamentos_select on public.pagamentos for select
  using (exists (select 1 from public.comandas c where c.id = comanda_id and c.empresa_id = public.jwt_empresa_id()));
create policy pagamentos_insert on public.pagamentos for insert
  with check (
    public.tem_permissao('caixa.pagamento.registrar')
    and exists (select 1 from public.comandas c where c.id = comanda_id and c.empresa_id = public.jwt_empresa_id())
  );

-- CONTAS
create policy contas_select on public.contas for select
  using (empresa_id = public.jwt_empresa_id());
create policy contas_insert on public.contas for insert
  with check (empresa_id = public.jwt_empresa_id() and public.tem_permissao('admin.financeiro.ver'));
create policy contas_update on public.contas for update
  using (empresa_id = public.jwt_empresa_id() and public.tem_permissao('admin.financeiro.ver'));
