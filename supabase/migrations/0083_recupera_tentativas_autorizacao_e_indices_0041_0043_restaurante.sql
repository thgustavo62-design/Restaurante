-- Recuperação de deriva entre o repositório e o banco de produção.
--
-- Ao aplicar 0075–0082 via MCP em 10/10/2026, a conferência de objetos
-- (tabelas, funções, colunas, índices, triggers e policies criados pelas
-- migrations 0001–0082 contra o catálogo real) mostrou que três coisas das
-- migrations antigas NUNCA tinham chegado ao banco — apesar do README dizer
-- que tudo foi aplicado pelo SQL Editor:
--
--   - 0046: comandas.updated_at + trigger + reabrir_comanda. confirmar_pagamento
--     (0064/0070/0075/0082) lê v_comanda.updated_at, então sem a coluna
--     TODA chamada de pagamento falhava com "record v_comanda has no field
--     updated_at". Aplicada à parte (arquivo 0046 já existente no repo,
--     reaplicado sem mudança — é idempotente).
--   - 0043: tabela tentativas_autorizacao. Sem ela, registrar_tentativa_pin
--     (0075), verificar_pin_supervisor e bater_ponto falhavam em runtime
--     (plpgsql só resolve a tabela na execução, não na criação).
--   - 0041: índices idx_comanda_itens_ativos e idx_comandas_dia_operacional
--     (só performance do KDS).
--
-- Este arquivo repete só a parte de 0043/0041, idempotente, para o repo
-- refletir exatamente o que foi aplicado.

create table if not exists restaurante.tentativas_autorizacao (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references restaurante.empresas(id) on delete cascade,
  supervisor_id uuid not null references restaurante.usuarios(id) on delete cascade,
  sucesso boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_tentativas_autorizacao_supervisor
  on restaurante.tentativas_autorizacao (supervisor_id, created_at desc);

alter table restaurante.tentativas_autorizacao enable row level security;

create index if not exists idx_comanda_itens_ativos
  on restaurante.comanda_itens (status)
  where status in ('PENDENTE','PREPARANDO','PRONTO');

create index if not exists idx_comandas_dia_operacional
  on restaurante.comandas (empresa_id, dia_operacional);
