-- Fase 1 — View pública mínima para a tela de login (antes de autenticar).
--
-- A tela de seleção de usuário precisa listar nome + id sem que o visitante
-- já esteja autenticado — mas a tabela `usuarios` tem RLS exigindo
-- empresa_id via JWT. Esta view expõe apenas o essencial (id, nome,
-- empresa_id) para usuários ativos; papel, pin_hash e demais colunas
-- continuam protegidos pela RLS da tabela base. A view roda com os
-- privilégios do dono (postgres), então ignora a RLS da tabela de
-- propósito — é o único ponto de acesso anônimo do sistema.

create view public.usuarios_login as
select id, empresa_id, nome
from public.usuarios
where ativo = true;

grant select on public.usuarios_login to anon, authenticated;
