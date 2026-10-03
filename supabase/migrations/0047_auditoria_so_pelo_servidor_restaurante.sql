-- Fase 0.7 — Auditoria só pelo servidor.
--
-- registrarAuditoria() no client inseria direto em auditoria sem checar
-- erro. Conferindo os 9 lugares que chamavam isso: comandas, usuarios e
-- produtos já têm trigger genérico (fn_audit_trigger, 0021) que grava
-- sozinho em qualquer INSERT/UPDATE — incluindo os feitos por RPC
-- SECURITY DEFINER (trigger dispara independente de quem fez a escrita).
-- CANCELAR_ITEM/DESCONTO_ACIMA_LIMITE/DIFERENCA_JUSTIFICADA já passaram a
-- gravar auditoria dentro das RPCs (0042/0043). A única tabela sem
-- trigger genérico era empresas (usada só por CONFIG_ALTERADA) — ganha
-- um agora. Com isso, nenhuma ação deixa de ser auditada mesmo bloqueando
-- o insert direto do client.

drop trigger if exists trg_empresas_auditoria on restaurante.empresas;
create trigger trg_empresas_auditoria
  after insert or update or delete on restaurante.empresas
  for each row execute function restaurante.fn_audit_trigger();

-- A partir daqui, toda gravação em auditoria vem de trigger (dono da
-- tabela, bypassa RLS) ou de RPC SECURITY DEFINER — nenhum client
-- precisa mais inserir direto.
drop policy if exists auditoria_insert on restaurante.auditoria;
