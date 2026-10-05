-- PRIORIDADE 6 — Expedição da Cozinha (Cozinha → sub-aba "Expedição")
--
-- "Tempo" do item (entrada/principal/sobremesa) é campo de CATEGORIA, não
-- de produto, exatamente como o roteiro pediu ("campo na categoria") —
-- cada produto já pertence a uma categoria, então classificar a
-- categoria cobre todos os produtos dela de uma vez. Categoria sempre
-- foi criada/editada só pelo formulário de produto (nunca teve tela
-- própria) — o campo novo entra ali, sem inventar uma tela de categorias
-- só pra isto.
--
-- Nenhuma RPC nova: "liberar pro salão" é um UPDATE comum
-- (`comanda_itens.status = 'ENTREGUE'` em todos os itens do grupo),
-- mesmo padrão que o KDS já usa pra avançar um ticket inteiro
-- (`kdsAvancarTicket`) — RLS de `cozinha.item.atualizar_status` já cobre
-- isso, e o trigger de timestamps da 0070 já grava `entregue_em` sozinho.

alter table restaurante.categorias add column if not exists tempo text not null default 'PRINCIPAL' check (tempo in ('ENTRADA','PRINCIPAL','SOBREMESA'));

-- backfill só pelo nome, pras categorias que o onboarding já semeia
-- ('Entradas', 'Sobremesas') e variações comuns — o resto (inclusive
-- 'Bebidas') fica em PRINCIPAL por padrão, dono reclassifica pela tela
-- se quiser (salvar qualquer produto da categoria já atualiza o tempo).
update restaurante.categorias set tempo = 'ENTRADA' where nome ilike '%entrada%';
update restaurante.categorias set tempo = 'SOBREMESA' where nome ilike '%sobremesa%' or nome ilike '%dessert%';
