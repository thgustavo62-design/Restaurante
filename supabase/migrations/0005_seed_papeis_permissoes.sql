-- Fase 0 — Catálogo RBAC (configuração do sistema, não dado de exemplo)
--
-- Espelha a matriz em docs/rotas-permissoes.md §3. Qualquer alteração na
-- matriz deve ser feita nos dois lugares.

insert into public.papeis_permissoes (papel, permissao) values
  -- ADMIN: todas as permissões
  ('ADMIN', 'atendimento.salao.ver'),
  ('ADMIN', 'atendimento.comanda.abrir'),
  ('ADMIN', 'atendimento.comanda.item.lancar'),
  ('ADMIN', 'atendimento.comanda.item.cancelar'),
  ('ADMIN', 'atendimento.comanda.desconto.aplicar'),
  ('ADMIN', 'atendimento.comanda.transferir'),
  ('ADMIN', 'atendimento.comanda.reabrir'),
  ('ADMIN', 'atendimento.comanda.fechar'),
  ('ADMIN', 'cozinha.kds.ver'),
  ('ADMIN', 'cozinha.item.atualizar_status'),
  ('ADMIN', 'caixa.sessao.abrir'),
  ('ADMIN', 'caixa.sessao.fechar'),
  ('ADMIN', 'caixa.movimento.sangria'),
  ('ADMIN', 'caixa.movimento.suprimento'),
  ('ADMIN', 'caixa.pagamento.registrar'),
  ('ADMIN', 'admin.cardapio.editar'),
  ('ADMIN', 'admin.estoque.editar'),
  ('ADMIN', 'admin.equipe.editar'),
  ('ADMIN', 'admin.financeiro.ver'),
  ('ADMIN', 'admin.financeiro.editar'),
  ('ADMIN', 'admin.relatorios.ver'),
  ('ADMIN', 'admin.configuracoes.editar'),
  ('ADMIN', 'auditoria.ver'),

  -- GERENTE: tudo exceto configurações fiscais/sistema
  ('GERENTE', 'atendimento.salao.ver'),
  ('GERENTE', 'atendimento.comanda.abrir'),
  ('GERENTE', 'atendimento.comanda.item.lancar'),
  ('GERENTE', 'atendimento.comanda.item.cancelar'),
  ('GERENTE', 'atendimento.comanda.desconto.aplicar'),
  ('GERENTE', 'atendimento.comanda.transferir'),
  ('GERENTE', 'atendimento.comanda.reabrir'),
  ('GERENTE', 'atendimento.comanda.fechar'),
  ('GERENTE', 'cozinha.kds.ver'),
  ('GERENTE', 'cozinha.item.atualizar_status'),
  ('GERENTE', 'caixa.sessao.abrir'),
  ('GERENTE', 'caixa.sessao.fechar'),
  ('GERENTE', 'caixa.movimento.sangria'),
  ('GERENTE', 'caixa.movimento.suprimento'),
  ('GERENTE', 'caixa.pagamento.registrar'),
  ('GERENTE', 'admin.cardapio.editar'),
  ('GERENTE', 'admin.estoque.editar'),
  ('GERENTE', 'admin.equipe.editar'),
  ('GERENTE', 'admin.financeiro.ver'),
  ('GERENTE', 'admin.financeiro.editar'),
  ('GERENTE', 'admin.relatorios.ver'),
  ('GERENTE', 'auditoria.ver'),

  -- CAIXA: atendimento básico + módulo de caixa
  ('CAIXA', 'atendimento.salao.ver'),
  ('CAIXA', 'atendimento.comanda.abrir'),
  ('CAIXA', 'atendimento.comanda.item.lancar'),
  ('CAIXA', 'atendimento.comanda.fechar'),
  ('CAIXA', 'caixa.sessao.abrir'),
  ('CAIXA', 'caixa.sessao.fechar'),
  ('CAIXA', 'caixa.movimento.sangria'),
  ('CAIXA', 'caixa.movimento.suprimento'),
  ('CAIXA', 'caixa.pagamento.registrar'),

  -- GARCOM: atendimento de salão
  ('GARCOM', 'atendimento.salao.ver'),
  ('GARCOM', 'atendimento.comanda.abrir'),
  ('GARCOM', 'atendimento.comanda.item.lancar'),
  ('GARCOM', 'atendimento.comanda.fechar'),

  -- COZINHA: apenas KDS
  ('COZINHA', 'cozinha.kds.ver'),
  ('COZINHA', 'cozinha.item.atualizar_status')
on conflict (papel, permissao) do nothing;
