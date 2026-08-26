-- Bug: cancelar um item já em PREPARANDO/PRONTO pulava a baixa de estoque
-- (baixarEstoqueDaVenda ignorava todo item CANCELADO, sem distinguir se o
-- insumo já tinha sido de fato usado no preparo). Esta coluna marca que o
-- cancelamento aconteceu depois do preparo já ter começado, para que a
-- baixa de estoque aconteça mesmo assim.

alter table public.comanda_itens
  add column if not exists cancelado_apos_preparo boolean not null default false;
