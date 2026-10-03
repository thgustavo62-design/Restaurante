-- Fase 0.1 — Cozinha não pode mais perder pedido de comanda que já foi paga
-- (balcão/ficha paga na hora, item ainda não saiu). O front vai passar a
-- consultar comanda_itens ativos do dia operacional direto, independente do
-- status da comanda pai — estes índices sustentam essa consulta nova.

create index if not exists idx_comanda_itens_ativos
  on restaurante.comanda_itens (status)
  where status in ('PENDENTE','PREPARANDO','PRONTO');

create index if not exists idx_comandas_dia_operacional
  on restaurante.comandas (empresa_id, dia_operacional);
