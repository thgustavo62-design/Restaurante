-- Adiciona as tabelas do restaurante à publicação de Realtime — por padrão
-- `supabase_realtime` só cobre o schema public, e o restaurante agora vive
-- em `restaurante`.

alter publication supabase_realtime add table restaurante.comandas;
alter publication supabase_realtime add table restaurante.comanda_itens;
alter publication supabase_realtime add table restaurante.caixa_sessoes;
alter publication supabase_realtime add table restaurante.caixa_movimentos;
alter publication supabase_realtime add table restaurante.produtos;
alter publication supabase_realtime add table restaurante.insumos;
alter publication supabase_realtime add table restaurante.contas;
alter publication supabase_realtime add table restaurante.usuarios;
