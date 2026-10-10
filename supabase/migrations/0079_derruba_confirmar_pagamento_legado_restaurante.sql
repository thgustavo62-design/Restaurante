-- Achado ao aplicar 0075–0078 em produção (10/10/2026): sobrou no catálogo
-- a assinatura ORIGINAL de confirmar_pagamento(uuid, jsonb, text) — a da
-- 0035, com o 3º parâmetro p_fiado_cliente. As migrations 0043/0049/0070/
-- 0075 foram criando assinaturas novas com `create or replace`, e como
-- parâmetros diferentes = função diferente no Postgres, a antiga nunca foi
-- substituída: continuava SECURITY DEFINER e com grant pra authenticated.
--
-- Ela fecha a comanda sem passar por calcular_totais_pagamento, sem limite
-- de desconto total, sem tentativa de PIN, sem pagamento parcial — ou seja,
-- um caminho paralelo que anulava justamente o que 0075 queria garantir.
-- Nenhum código do client chama essa assinatura (conferido em assets/js:
-- actions-caixa.js e offline.js só passam p_comanda_id/p_linhas/... com
-- nome), então derrubar não quebra nada.

drop function if exists restaurante.confirmar_pagamento(uuid, jsonb, text);
