-- KDS: comanda_itens não guardava o setor de produção do item (só existia
-- em produtos), então toda leitura de item tinha que adivinhar/hardcodar.
-- Guardado como snapshot no lançamento — igual nome e preco_unit_centavos
-- já fazem — pra não mudar de área se o produto for reclassificado depois
-- que o item já foi lançado.

alter table restaurante.comanda_itens add column if not exists setor_producao text
  check (setor_producao in ('BAR','COZINHA','BRASA','SOBREMESA'));

update restaurante.comanda_itens ci
set setor_producao = p.setor_producao
from restaurante.produtos p
where ci.produto_id = p.id and ci.setor_producao is null;
