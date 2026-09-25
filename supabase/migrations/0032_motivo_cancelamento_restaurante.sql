-- Cancelamento com motivo obrigatório: comanda_itens não guardava por quê
-- um item foi cancelado ("cliente desistiu", "erro de lançamento", "produto
-- indisponível", "erro de preparo") — sem isso não dá pra saber depois se o
-- cancelamento foi falha da casa ou do cliente, nem somar por funcionário.

alter table restaurante.comanda_itens add column if not exists motivo_cancelamento text;
