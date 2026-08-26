-- Fase 1 — Seed de contas financeiras (esquecido na migration 0011).
-- Configuração inicial do módulo Financeiro, não dado de demonstração
-- descartável — ponto de partida editável pelos usuários.

insert into public.contas (empresa_id, tipo, descricao, categoria, valor_centavos, vencimento) values
  ('11111111-1111-1111-1111-111111111111','PAGAR','Fornecedor de carnes — Frigorífico Bom Boi','Insumos',458000, current_date + 5),
  ('11111111-1111-1111-1111-111111111111','PAGAR','Aluguel do salão','Instalações',650000, current_date + 10),
  ('11111111-1111-1111-1111-111111111111','PAGAR','Conta de energia elétrica','Utilidades',189000, current_date - 2),
  ('11111111-1111-1111-1111-111111111111','RECEBER','Evento corporativo — Empresa XPTO','Eventos',320000, current_date + 7);
