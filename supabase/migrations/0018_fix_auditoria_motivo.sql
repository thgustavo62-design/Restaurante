-- Bug: registrarAuditoria() (client) sempre insere a coluna "motivo", que nunca
-- existiu em public.auditoria (0002 só criou dados_antes/dados_depois jsonb).
-- Todo insert em auditoria falhava silenciosamente (erro só ia pro console),
-- deixando a tela de Auditoria sempre vazia. Adiciona a coluna que falta.

alter table public.auditoria add column if not exists motivo text;
