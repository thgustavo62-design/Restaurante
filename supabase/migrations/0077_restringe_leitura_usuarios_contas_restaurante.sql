-- VF-005 do plano de auditoria (docs/PLANO_DE_MELHORIAS.md) — restringe
-- leitura de usuarios.email_interno e da tabela contas, que só filtravam
-- por empresa_id, sem checar permissão nenhuma.
--
-- [ACHADO CONFIRMADO] qualquer papel logado, inclusive COZINHA, lia
-- email_interno de todo mundo via `usuarios_select` (sem checagem de
-- permissão) e todas as contas a pagar/receber via `contas_select`
-- (idem) — não é só a UI escondendo botão, dava pra ler via API direta.
-- Combinado com VF-003 (o PIN É a senha real da conta no Supabase Auth)
-- e VF-004 (contador de tentativas, já corrigido na 0075), isso formava
-- uma cadeia prática de escalonamento de privilégio: ler o e-mail do
-- ADMIN e tentar a senha de 4 caracteres dele.
--
-- [DECISÃO DE DESIGN — `clientes` ficou de fora, avise se quiser
-- diferente] o plano também cita `clientes`, mas diferente de `usuarios`
-- e `contas`, o client usa telefone/endereço/pontos de QUALQUER cliente
-- o tempo todo — é o fluxo real de GARCOM/CAIXA escolhendo cliente pra
-- fiado/pontos/delivery no pagamento, não só a tela admin de cadastro.
-- Restringir por `admin.clientes.editar` quebraria esses fluxos. Dar
-- certo exigiria uma projeção de colunas separada (RPC/view só com
-- nome+id pro picker de venda, full row só pra quem edita cadastro) —
-- escopo maior que esta correção, registrado em
-- docs/PLANO_DE_MELHORIAS.md mas não resolvido aqui.
--
-- `usuarios.email_interno`: o client nunca leu essa coluna de volta
-- (mapUsuario nem inclui o campo) — é puro resíduo do `select('*')`
-- antigo. Revogada por coluna (não dá pra restringir só UMA coluna via
-- RLS — RLS filtra LINHA, não coluna); authenticated/anon perdem acesso
-- à coluna, e um `select('*')` no client agora falharia — por isso a
-- 0077 troca pra lista explícita de colunas em carregarTudo()
-- (assets/js/data.js). Nenhuma RPC é afetada: SECURITY DEFINER roda com
-- o privilégio de quem criou a função (postgres), não de
-- authenticated/anon, então continuam lendo email_interno numa boa
-- (criar_funcionario, verificar_pin_supervisor, bater_ponto, etc.).
--
-- `contas`: ganha a mesma permissão que já gate o botão "Nova conta" e a
-- tela Financeiro no client (admin.financeiro.ver) — ninguém de baixo
-- privilégio usa essa tabela pra nada hoje (conferido: state.contas só é
-- lido pelo render da aba Financeiro, já escondida pra quem não tem essa
-- permissão).

revoke select on restaurante.usuarios from anon, authenticated, public;
grant select (id, empresa_id, nome, papel, ativo, peso_rateio_taxa, created_at, updated_at)
  on restaurante.usuarios to anon, authenticated;

drop policy if exists contas_select on restaurante.contas;
create policy contas_select on restaurante.contas for select
  using (empresa_id = restaurante.jwt_empresa_id() and restaurante.tem_permissao('admin.financeiro.ver'));
