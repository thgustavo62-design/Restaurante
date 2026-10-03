-- pin_hash nunca foi preenchido em lugar nenhum (nem em criar_funcionario,
-- nem em trocar_pin_funcionario) — o PIN sempre foi a senha real do
-- Supabase Auth, não um hash guardado à parte. Coluna e índice mortos.

drop index if exists restaurante.idx_usuarios_empresa_pin;
alter table restaurante.usuarios drop column if exists pin_hash;
