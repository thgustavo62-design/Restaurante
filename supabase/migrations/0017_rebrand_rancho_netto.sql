-- Rebrand: "Fogo Gestão Restaurante & Bar" -> "Rancho Netto — Brasa & Fogo".
-- Nome comercial exibido em topo de recibo, fechamento de caixa e configurações.

update public.empresas
set nome = 'Rancho Netto — Brasa & Fogo'
where nome = 'Fogo Gestão Restaurante & Bar';
