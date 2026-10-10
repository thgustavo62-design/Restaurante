# Vision Food — instruções permanentes do projeto

Restaurante é um app de gestão para restaurantes (schema `restaurante` no
Supabase, front-end em JS puro). Este arquivo é a política de aprovação
combinada com o Gustavo — existe pra eu não re-perguntar nem redescobrir
o que já foi decidido. Lido automaticamente no início de cada sessão
neste diretório.

## O que já está aprovado (não precisa perguntar de novo)

- **Commit e push direto em `main`** depois de qualquer mudança de código
  ou migration, sem pedir confirmação a cada vez — desde que a mudança em
  si já tenha sido pedida/aprovada pelo Gustavo nesta conversa. Mensagem
  de commit sempre explicando o "porquê", nunca `git push --force`.
- **Escrever migrations novas** para qualquer funcionalidade já pedida,
  seguindo as regras da seção "Regras não-negociáveis" abaixo, sem
  precisar aprovar o SQL campo a campo antes de escrever o arquivo.
- **Corrigir bug que eu mesmo encontrar no caminho** (ex: coluna errada,
  `date_trunc` em índice, função de janela dentro de agregado) — conserto
  e documento no commit, sem parar pra perguntar "posso corrigir isso
  também?".
- **Atualizar `README.md`/`docs/rotas-permissoes.md`/`tests/`** junto de
  qualquer mudança funcional, sem pedir aprovação separada pra cada
  atualização de documentação.
- **Rodar a suíte de verificação estática** (checagem de sintaxe,
  cross-reference de `data-action`, balanceamento de `$$`/parênteses,
  teste de render em sandbox) antes de entregar qualquer coisa — já é
  esperado, não é "trabalho extra" a confirmar.

## O que SEMPRE exige aprovação explícita antes de mexer

- Qualquer mudança que troque **como o funcionário loga** hoje (ex: PIN
  virar senha separada, MFA obrigatório) — impacto real no dia a dia de
  cada conta, inclusive do próprio Gustavo.
- Qualquer item marcado `[PROPOR]` no roteiro original ou no plano de
  melhorias — apresento opções/custo/risco primeiro, só implemento depois
  da escolha.
- Decisão de regra de negócio ambígua (ex: perda de prato baixar estoque
  ou não) — documento como `[DECISÃO DE DESIGN]` se eu decidir sozinho
  pra não travar o trabalho, mas aviso explicitamente que é uma escolha
  minha e pode ser revertida.
- Qualquer coisa destrutiva ou difícil de reverter: `git reset --hard`,
  apagar dado em produção, revogar acesso de usuário, alterar
  schema de um jeito que perca dado existente.
- Rodar algo contra o Supabase de **produção** fora do fluxo normal
  (colar migration no SQL Editor é o Gustavo quem faz — eu não tenho
  credencial nem conexão com o banco neste ambiente).

## Regras não-negociáveis de arquitetura (desde a ETAPA 0)

- **Front-end**: JS puro, sem build/bundler/framework. `index.html` +
  `assets/js/*.js` (scripts clássicos, `"use strict"`, `var`, render via
  concatenação de string) + `assets/css/styles.css`. Nunca introduzir
  React/Vue/webpack/etc.
- **Banco**: schema `restaurante` **sempre**, nunca `public`. Segurança
  mora no banco: RLS + triggers de proteção de coluna + RPC
  `SECURITY DEFINER` com `set search_path = restaurante, pg_temp`,
  validando `restaurante.jwt_empresa_id()`/`restaurante.tem_permissao()`.
  Toda função nova leva `revoke all ... from public` +
  `grant execute ... to authenticated` explícitos (exceção: função
  auxiliar pura não-`SECURITY DEFINER`, tipo `restaurante.mes_competencia`,
  que não precisa — mesmo padrão de `restaurante.rendimento_atual`).
- **Migrations**: numeradas sequencialmente (`NNNN_descricao_restaurante.sql`),
  com comentário no topo explicando o quê e o porquê. **De verdade
  idempotentes**: `create table if not exists`, `create index if not
  exists`, `drop policy if exists X; create policy X ...` antes de toda
  policy nova, `create or replace function` sempre. O SQL Editor do
  Supabase roda o arquivo inteiro como uma transação só — um erro no
  meio desfaz tudo, inclusive o que já tinha funcionado antes, então
  reaplicar o arquivo corrigido tem que ser seguro.
- **Permissões**: `assets/js/config.js` (`PERM`/`MATRIZ`) tem que ficar
  em sincronia com `papeis_permissoes` seedada nas migrations — qualquer
  permissão nova precisa entrar nos dois lugares, mais uma linha em
  `docs/rotas-permissoes.md`.
- **Dinheiro**: sempre centavos inteiros (`int`, nunca `numeric`/`float`
  pra valor monetário). Cálculo financeiro sempre no servidor — o client
  nunca recalcula total/taxa/desconto pra decidir quanto cobrar.
- **Indicadores agregados**: sempre via RPC que agrega no banco
  (`sum`/`count`/etc. em SQL). Nunca baixar comandas/itens completos pro
  navegador só pra somar.
- **Visual**: reaproveita classes CSS existentes (`.card`, `.tabs`/`.tab`,
  `.kpi-card`, `.badge-status-*`) e `renderPageHeader()`/`renderSubAbas()`
  de `render-shell.js` — nunca inventa um componente novo se um
  equivalente já existe.

## Onde cada coisa mora (evita reexplorar o repo toda sessão)

- `assets/js/state.js` — `estadoVazio()`, o único lugar que define todo
  campo de `state`.
- `assets/js/data.js` — `carregarTudo()` (carga inicial + Realtime),
  `can()`/`mesaStatus()`/`totaisComanda()` e outros helpers de leitura.
- `assets/js/events.js` — **todo** `data-action` de clique passa por um
  `if(action===...)` gigante dentro de `app.onclick`. Campo de texto que
  muda estado ao digitar fica num listener separado mais abaixo no mesmo
  arquivo.
- `assets/js/render-screens.js` — uma função `render<Tela>()` por tela,
  registro de `SUB_ABAS.<tela>` logo depois das funções da tela.
- `assets/js/render-modals.js` — `renderModal()` despacha por
  `state.modal.type`; uma função por modal.
- `assets/js/actions-*.js` — funções `async function algumaAcao(...)`
  chamadas pelos handlers de `events.js`; cada arquivo agrupa por área
  (atendimento, caixa, compras, gestão, financeiro-equipe, marketing).
- `assets/js/helpers.js` — funções puras sem efeito colateral de rede
  (formatação, cálculo local, `campoOuAtual`, etc.).
- `supabase/migrations/` — uma migration por funcionalidade, nunca editar
  uma já aplicada em produção sem o Gustavo confirmar que ainda não
  rodou (ver histórico da conversa/commits antes de presumir).
- `tests/` — `node --test`, nunca rodou contra o Supabase de verdade
  ainda (sem projeto de homologação configurado) — ver `tests/README.md`.

## Auditoria de segurança em andamento

`docs/PLANO_DE_MELHORIAS.md` é um plano de 26 itens (VF-001 a VF-026,
P0 a P3) feito por auditoria externa estática do repositório. Em
09/10/2026 os 6 achados **P0** foram conferidos linha a linha contra o
código real e **confirmados, não especulativos**:

- **VF-001** — `comandas.status`/`fechamento` não são protegidos pelo
  trigger `trg_comandas_protege_colunas` (só `desconto_centavos`,
  `mesa_id`/`tipo`, e um bloco de campos somente-leitura que inclui
  `total_centavos` mas não `status`/`fechamento`). `pagamentos`,
  `caixa_movimentos` e `contas` aceitam `INSERT` direto de quem tem a
  permissão certa, sem exigir passar pela RPC de negócio.
- **VF-002** — `offlineProcessarItem()` (`assets/js/offline.js`) retorna
  `true` (= remove da fila) em recusa definitiva de regra de negócio nos
  3 tipos de operação offline, inclusive pagamento em dinheiro — só um
  toast temporário, sem registro recuperável. `offlineEnfileirar()`
  engole falha de IndexedDB só com `console.error`.
- **VF-003** — confirmado que é **mais grave** do que o plano descreve:
  não é só a autorização de supervisor, é o **login diário de qualquer
  papel** (`tentarLogin` em `actions-atendimento.js` →
  `signInWithPassword`) que usa o PIN de 4 caracteres alfanuméricos como
  senha real da conta no Supabase Auth — inclusive a conta ADMIN do
  dono.
- **VF-004** — confirmado nas duas funções que usam o padrão
  (`verificar_pin_supervisor` e `bater_ponto`): o `insert into
  tentativas_autorizacao` acontece antes do `raise exception` dentro da
  mesma transação — a exceção desfaz o INSERT junto, então o contador de
  "5 tentativas/5 min" nunca acumula de verdade.
- **VF-005** — confirmado: `usuarios_select`, `contas_select` e
  `clientes_select` só filtram por `empresa_id`, sem checar permissão —
  **qualquer papel logado, inclusive COZINHA**, lê e-mail interno de
  todo mundo, todas as contas a pagar/receber e todos os dados de
  cliente via API direta (não é só UI escondendo botão).
- **VF-006** — confirmado (já sabido): testes em `tests/` nunca rodaram
  contra um Supabase de homologação de verdade.

**Achado combinado, mais grave que qualquer item isolado**: VF-003 +
VF-004 + VF-005 formam uma cadeia prática de escalonamento de
privilégio — um funcionário comum lê o e-mail de login do ADMIN
(VF-005), a senha real dele são 4 caracteres (VF-003), e o bloqueio por
tentativas erradas nunca ativa de verdade (VF-004).

**Status de execução**:

- **VF-004 — corrigido (migration `0075`)**. Nova RPC
  `registrar_tentativa_pin(usuario)`, chamada numa transação própria
  ANTES da verificação (por isso sobrevive ao rollback do `raise
  exception` quando o PIN está errado). `verificar_pin_supervisor`,
  `cancelar_item`, `aplicar_desconto`, `confirmar_pagamento` e
  `bater_ponto` ganharam `p_tentativa_id` — assinaturas antigas
  derrubadas (`drop function`) pra não ficarem paralelas, ainda
  chamáveis, no catálogo. Client atualizado em 3 arquivos
  (`actions-atendimento.js`, `actions-caixa.js`,
  `actions-financeiro-equipe.js`). Testes existentes que chamavam essas
  RPCs (`supervisor.test.js`, `pin_alfanumerico.test.js`,
  `perdas.test.js`, `controle_equipe.test.js`) atualizados pra nova
  assinatura; teste novo `pin_contador_tentativas.test.js` cobre o
  bloqueio de verdade. Detalhes no README, seção "Auditoria de
  segurança — VF-004 corrigido (0075)".
- **VF-001 — corrigido (migration `0076`)**. Trigger
  `trg_comandas_protege_colunas` recusa `UPDATE` direto pra
  `status IN ('PAGA','CANCELADA')` (ABERTA<->FECHANDO continua livre,
  sem efeito financeiro) + `fechamento`/`troco_centavos` viram somente
  leitura. Nova RPC `cancelar_comanda_vazia` substitui o `UPDATE` direto
  de `cancelarComanda()` no client, repetindo a checagem "zero item" no
  servidor. `pagamentos_insert` derrubada (ninguém usava direto);
  `caixa_mov_insert` só aceita `SANGRIA`/`SUPRIMENTO` (não mais `VENDA`
  fabricado); `contas_insert` exige `admin.financeiro.ver` (tirada a
  cláusula de `caixa.pagamento.registrar` que só existia pra uma RPC que
  já ignora RLS). Teste novo: `tests/blindagem_financeira.test.js`.
- **VF-005 — corrigido (migration `0077`)**. `usuarios.email_interno`
  revogada por coluna (`REVOKE`/`GRANT` explícito — RLS não restringe
  coluna, só linha); `nome`/`papel`/`ativo` continuam abertos pra
  qualquer papel (pickers de supervisor/ponto precisam). `contas_select`
  ganhou `admin.financeiro.ver`. `clientes` ficou **de propósito** fora
  do lote — GARCOM/CAIXA usam telefone/endereço/pontos de clientes no
  fluxo real de pagamento (fiado/pontos/delivery), restringir do mesmo
  jeito quebraria; resolver direito precisa de uma projeção de colunas
  separada (escopo maior, registrado mas não feito). Teste novo:
  `tests/vazamento_dados_leitura.test.js`.
- **VF-002 — corrigido (sem migration, só client)**.
  `offlineProcessarItem` (`assets/js/offline.js`) devolve status
  explícito (`ENVIADO`/`PENDENTE_REDE`/`RECUSADO`) em vez de
  `true`/`false` — antes, recusa definitiva do servidor e sucesso real
  eram o mesmo `true`, e o item sumia da fila nos dois casos.
  `offlineEnfileirar` devolve `true`/`false` de verdade; os 3 pontos que
  enfileiram (`enviarPedidoOffline`, `confirmarPagamentoOffline`,
  `kdsSetStatus`) enfileiram ANTES de mexer no `state`. Nova área
  "Pendências de sincronização" em Configurações (mesmo gate de
  `sync_conflitos`) com Descartar/Tentar de novo. Teste
  `tests/offline_pendencias.test.js` **já rodou de verdade e passou**
  (lógica pura do client, sandbox de VM, não precisa de Supabase).
- **VF-003 — corrigido (migration `0078`)**. Aprovado pelo Gustavo em
  10/10/2026: "separar PIN (operação) de senha (login)". Senha de acesso
  (Auth, 8+ caracteres) e PIN operacional (hash local, `pgcrypto`
  `crypt()`/`gen_salt('bf')`, `usuarios.pin_hash`) viram independentes.
  `criar_funcionario`/`onboarding_criar_empresa` exigem os dois;
  `trocar_pin_funcionario` virou `trocar_credenciais_funcionario`
  (ambos opcionais, pelo menos um). `verificar_pin_supervisor`/
  `bater_ponto` não fazem mais NENHUMA chamada ao Auth — só conferem o
  hash local (mais simples e mais rápido que o mecanismo antigo).
  **Migração sem interrupção**: todo funcionário já existente teve o PIN
  atual copiado pra `pin_hash` (`auth.users.encrypted_password`, já
  bcrypt — zero recálculo); a senha de login de cada um continua sendo
  o PIN antigo até um ADMIN trocar pela tela Equipe (botão
  "Credenciais"). `pin_hash` NUNCA exposta por select direto (mesmo
  tratamento de `email_interno`, 0077). Testes:
  `tests/vf003_separa_senha_pin.test.js` (novo — inclusive confirma que
  as assinaturas antigas sumiram do catálogo) + `pin_alfanumerico.test.js`
  reescrito + `tests/setup.js` ganhou `bcryptjs` (devDependency) pra
  seedar `pin_hash` dos usuários de teste.
- **Todos os 6 P0 do plano estão corrigidos ou só faltam ação de conta**:
  dos 6, 5 têm código corrigido (VF-001 a VF-005); só falta **VF-006**
  (staging real + suíte rodada de verdade — ação de conta do Gustavo,
  não é código).
- Os itens P1–P3 (VF-007 em diante) não foram conferidos linha a linha,
  só herdados do documento original.

Antes de implementar qualquer VF-XXX novo (P1 em diante), perguntar ao
Gustavo qual prioridade entrar primeiro — mudança de produto/fluxo visível
(não só correção de backend) continua exigindo aprovação explícita antes,
mesma régua que valeu pro VF-003.
