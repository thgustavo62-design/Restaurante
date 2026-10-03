# Vision Food

Sistema de gestão para restaurante/bar: atendimento de salão, cozinha (KDS),
caixa, cardápio, estoque, compras, financeiro, relatórios e equipe — rodando
**100% sobre o Supabase** (Postgres + Auth + Realtime). Não há backend
próprio: o front-end fala direto com o banco, e a segurança (quem pode ver
e escrever o quê) é garantida pelo próprio Postgres via Row Level Security
(RLS), não pela interface.

**Vision Food** é o produto/plataforma; o restaurante que usa esta instância
hoje é o **Rancho Netto — Brasa & Fogo**, cadastrado em `empresas` e exibido
como marca própria no login, no cardápio público e nos recibos impressos —
só a casca do sistema (sidebar, topbar, telas internas) carrega a marca
Vision Food. Ver [Identidade visual](#identidade-visual) abaixo.

Este documento é a referência completa de como o sistema funciona hoje —
telas, permissões, segurança, dados e deploy. Para o catálogo detalhado de
permissões e rotas, ver [`docs/rotas-permissoes.md`](docs/rotas-permissoes.md).
O diagrama em [`docs/ER.md`](docs/ER.md) é **histórico** (descreve o desenho
original do projeto, anterior ao schema `restaurante` atual) — para a
estrutura de tabelas real, a fonte de verdade são as migrations em
[`supabase/migrations/`](supabase/migrations/).

## Visão geral

- **Front-end**: `index.html` + ~20 arquivos JavaScript puro em
  `assets/js/`, carregados como `<script>` clássicos em ordem fixa — sem
  build step, sem bundler, sem framework. Pronto pra qualquer hospedagem
  estática (hoje: Vercel). `assets/js/config.js` guarda a URL e a chave
  pública (`publishable key`) do Supabase; não há segredo no front-end.
- **Backend**: Postgres do Supabase, schema `restaurante` (ver
  [abaixo](#banco-de-dados-schema-restaurante-num-projeto-compartilhado)),
  com RLS em toda tabela e algumas operações sensíveis feitas por função
  `SECURITY DEFINER` (RPC) em vez de escrita direta de tabela.
- **Autenticação**: PIN de 4 dígitos, mas é a senha real de uma conta do
  Supabase Auth — não é mock (detalhes [abaixo](#autenticação-e-segurança)).
- **Sincronização**: Realtime do Supabase — qualquer mudança em um
  dispositivo aparece nos outros em menos de 1 segundo, sem precisar
  recarregar a página.
- **Página pública**: `cardapio.html`, separada do app autenticado, para o
  cliente ver o cardápio pelo celular via QR Code, sem login.

## Identidade visual

Tema único (escuro), sem alternância claro/escuro. Tokens de cor, raio de
borda e fonte ficam centralizados em `:root` no topo de
`assets/css/styles.css` (e replicados num `<style>` próprio em
`cardapio.html`, que é uma página isolada) — qualquer ajuste de paleta
começa ali, nunca com cor solta espalhada pelo CSS/JS.

- **Base**: preto quase neutro (`--background`/`--surface-01/02/03`), não
  azul-marinho — o azul (`--primary` `#1E8BFF` + `--accent-cyan`) aparece só
  como destaque (botões, estado ativo, glow sutil nos cantos da tela e nos
  cards em evidência via `--glow-primary`).
- **Tipografia**: `Exo 2` (700/800, caixa-alta) pra títulos e números
  grandes, `Inter` pro resto — carregadas via Google Fonts (`<link>` no
  `<head>`, não `@import` no CSS, por performance).
  `--on-accent`/`--on-success` resolvem a cor de texto sobre botões/estados
  coloridos (branco ou quase-preto, conforme contraste).
- **Componentes reutilizáveis**: `.kpi-card` (ícone + rótulo + valor, usado
  em todo KPI do app), `.card`/`.card-title`, `.chip`/`.tab` (filtros em
  pílula), `.badge`/`.badge-status-*` (com bolinha colorida), `.table-dark`
  (tabelas com cabeçalho caixa-alta), `renderPageHeader()` em
  `render-shell.js` (ícone circular + título + subtítulo, usado por toda
  tela interna).
- **Logo**: `assets/logo/vision-food.png` (lockup completo, login),
  `vision-food-icon.png` (ícone só, sidebar) e `vision-food-favicon.png`
  (favicon) — fundo removido via script (chroma-key por distância de cor,
  não é arte vetorial original). Os PNGs antigos `rancho-netto-*.png`
  continuam em `assets/logo/` porque o cardápio público ainda os usa (marca
  do restaurante, não da plataforma).
- **Impressão** (`print.js`, `.receipt-preview`): fundo branco/texto preto
  fixos, de propósito — não usa os tokens de cor do app (impressora
  térmica). O "logo" do recibo é o nome da empresa em texto, não uma
  imagem.
- **Cozinha (KDS)**: única tela com tipografia/botões maiores
  (`.kds-grande` no CSS) — é operada em tablet na cozinha, precisa ser
  legível/tocável de mais longe que as outras telas.

## Telas do app (`index.html`)

Depois do login, a navegação lateral mostra só as telas que o papel do
usuário logado pode acessar (ver [Papéis e permissões](#papéis-e-permissões)).

| Tela | O que faz |
|---|---|
| **Dashboard** | Vendas do dia, ticket médio, mesas ocupadas, gráfico de vendas por hora, situação da cozinha e alertas (mesa atrasada, caixa fechado, sangria recomendada). |
| **Atendimento (Salão)** | Mapa de mesas com status (livre / ocupada / aguardando pagamento) e tempo de ocupação. Botões **Balcão** e **Nova ficha** abrem uma venda sem mesa (fila por balcão ou ficha numerada — number atribuído automaticamente, até o limite configurado de fichas). Painel lateral lista todas as comandas abertas, seja de mesa, balcão ou ficha. |
| **Comanda** | Catálogo de produtos por categoria (com busca e foto, se cadastrada) pra lançar itens; revisão do pedido antes de enviar pra cozinha; cancelar item e aplicar desconto (qualquer garçom pode pedir, mas sempre com PIN de um supervisor escolhido num dropdown — verificado no servidor); fechar conta. Se o pagamento travar (aba fechou no meio), aparece "Reabrir" depois de 10 minutos em fechamento. |
| **Cozinha (KDS)** | Kanban (Pendente → Preparando → Pronto → Entregue) dos itens lançados, com abas pra filtrar por setor de produção (Bar / Cozinha / Brasa / Sobremesa) — cada produto tem um setor, gravado no item no momento do lançamento. Mostra itens de qualquer comanda do dia operacional, **inclusive já paga** (balcão/ficha paga na hora não some mais da cozinha antes de sair). Alerta separado pra item cancelado depois de já estar em preparo. |
| **Caixa** | Abrir sessão com saldo inicial, registrar sangria/suprimento, ver movimentos da sessão. Fechamento é por **conferência cega calculada no servidor**: o client nunca recebe o esperado antes de mandar o valor contado; diferença acima do limite configurado exige justificativa escrita. |
| **Cardápio** | CRUD de produtos (nome, categoria, preço, foto por URL, setor de produção) e de categorias (criadas on-the-fly no formulário de produto). Marcar produto como esgotado/reativado sem precisar editar o preço. |
| **Estoque** | Insumos com estoque atual/mínimo e custo médio; entrada/saída manual com motivo obrigatório; alerta de estoque baixo; botão **Rendimento** pra registrar o fator de perda medido de um insumo (ex: 85% depois de limpar/aparar) — hoje é só registro/consulta, não altera o cálculo de baixa automática (ver [Pendências](#pendências-conhecidas)). |
| **Compras** | Cadastro de fornecedores e pedidos de compra (Rascunho → Pedido realizado → Recebido). Receber um pedido lança entrada de estoque automaticamente e recalcula o custo médio ponderado do insumo. |
| **Financeiro** | Contas a pagar e a receber (as de receber de fiado/cartão/voucher são geradas automaticamente ao fechar uma conta), com status pago/pendente/vencido. |
| **Relatórios** | Ranking de produtos e desempenho por garçom (por quem **lançou** o item), por período (hoje / 7 dias / 30 dias / escolher mês). Tudo agregado no banco — não carrega mais comandas/itens completos no navegador, e o total de cada venda é o valor travado no pagamento, não recalculado com a taxa de serviço atual. |
| **Equipe** | Criar funcionário (nome, papel, PIN), ativar/desativar, e **trocar PIN** de um funcionário existente sem precisar recriá-lo. |
| **Auditoria** | Trilha de ações sensíveis (desconto aprovado, item cancelado, preço alterado, caixa fechado com diferença, PIN alterado, etc.), com quem fez e quando. |
| **Configurações** | Dados da empresa, taxa de serviço, limites (desconto sem aprovação, diferença de caixa tolerada, alerta de sangria), impressão de recibo, horário de funcionamento, e o **link do cardápio público** (pra gerar o QR Code em qualquer gerador gratuito e imprimir nas mesas). |

### Cardápio público (`cardapio.html`)

Página HTML separada, sem login, acessível em `/cardapio/:slug` (rewrite
configurado em `vercel.json`, servido estaticamente igual ao app
principal). Lê só nome, preço, categoria, status de esgotado e foto dos
produtos *ativos* — nunca estoque, custo, funcionários ou vendas. Usa seu
próprio script (`assets/js/cardapio-publico.js`), com a mesma chave pública
do Supabase, mas via políticas de RLS específicas para o papel `anon`
(ver `0030_cardapio_publico_restaurante.sql`).

## Papéis e permissões

Cinco papéis — `ADMIN`, `GERENTE`, `CAIXA`, `GARCOM`, `COZINHA` — e 23
permissões no formato `modulo.recurso.acao` (ex:
`atendimento.comanda.item.cancelar`), cada uma concedida por papel numa
tabela de configuração (`papeis_permissoes`, semeada nas migrations, não é
dado de exemplo). O catálogo completo e a matriz papel × permissão estão em
[`docs/rotas-permissoes.md`](docs/rotas-permissoes.md).

Dois lugares guardam esse catálogo e precisam ficar em sincronia manual:
a tabela `papeis_permissoes` no banco (quem efetivamente bloqueia) e o
objeto `PERM`/`MATRIZ` em `assets/js/config.js` (usado só pra esconder
botões/telas que o usuário não pode usar — nunca é a trava real).

**Regra de ouro do sistema**: a UI esconder um botão é conveniência, não
segurança. Quem decide o que cada papel pode gravar é o Postgres — RLS e,
pras operações mais sensíveis (fechar conta, mexer em estoque, trocar PIN),
funções `SECURITY DEFINER` chamadas via RPC.

## Autenticação e segurança

### PIN = senha real do Supabase Auth

Cada funcionário é uma conta real do Supabase Auth. O PIN de 4 dígitos
digitado na tela de login **é a senha**. Login agora pede primeiro o
**código do restaurante** (slug, igual ao usado no cardápio público — URL
`?r=slug` ou salvo em `localStorage`), que resolve a lista de usuários via
`restaurante.usuarios_login_por_empresa(slug)` — antes disso era uma view
(`usuarios_login`) aberta pra `anon` **sem filtro de empresa nenhum**,
listando funcionário de toda empresa que compartilha este projeto
Supabase. O e-mail de login deixou de ser derivado do nome
(`nome@fogo.internal` — acento sumia, nome duplicado colidia, renomear
quebrava o login); agora é um UUID aleatório + domínio da própria empresa
(`<uuid>@<slug>.internal`), gravado em `usuarios.email_interno` e nunca
mais recalculado a partir do nome. Funcionários criados antes dessa
mudança foram migrados automaticamente (`0044`).

O JWT emitido no login carrega `empresa_id` e `papel` via um *Custom
Access Token Hook* (`restaurante.custom_access_token_hook`,
`SECURITY DEFINER`) — é esse claim que toda policy de RLS usa pra isolar
dados por empresa e por papel.

Criar funcionário (`restaurante.criar_funcionario`) e trocar PIN
(`restaurante.trocar_pin_funcionario`) são RPCs `SECURITY DEFINER` que
validam a permissão do chamador, leem a chave de serviço do **Supabase
Vault** (nunca do código do cliente) e chamam a Admin API do GoTrue
diretamente — a chave secreta nunca é exposta ao navegador.

### Autorização de supervisor (desconto acima do limite, cancelar item)

Antes, o client testava o PIN digitado contra **todas** as contas com a
permissão necessária (um `signInWithPassword` por candidato) e a escrita
final rodava com a sessão de quem estava logado — que o trigger de coluna
(abaixo) sempre bloqueou pra GARCOM/CAIXA, então esses papéis nunca
conseguiam de fato cancelar item nem aplicar desconto, mesmo com PIN
correto. Agora o garçom escolhe **um** supervisor (não testa vários) e as
RPCs `restaurante.cancelar_item(...)` / `restaurante.aplicar_desconto(...)`
verificam o PIN dele chamando o próprio Supabase Auth de dentro da
transação, conferem a permissão, aplicam a escrita e gravam auditoria —
tudo atômico. Tentativas falhas por supervisor ficam em
`tentativas_autorizacao`, com bloqueio de 5 minutos após 5 falhas (além do
rate limit do próprio Supabase Auth). Desconto dentro do limite continua
sem pedir supervisor pra quem já tem a permissão (mesmo comportamento de
sempre); cancelar item sempre pede, mesmo pra ADMIN.

### RLS por linha **e** por coluna

Toda tabela tem RLS habilitado, escopado por `empresa_id` + permissão do
papel (via `restaurante.tem_permissao(text)`). Isso resolve "pode ver/gravar
nesta tabela", mas não "pode gravar *esta coluna específica*" — por
exemplo, GARCOM tem permissão pra abrir/fechar comanda, o que por si só
libera `UPDATE` na linha inteira da comanda, incluindo colunas que GARCOM
não devia poder tocar (desconto). Pra isso, `comandas` e `comanda_itens`
têm **triggers** (`0038_protege_colunas_sensiveis_restaurante.sql`) que
comparam o valor antigo e o novo de cada coluna sensível e exigem a
permissão certa coluna a coluna:

- Mudar `desconto_centavos` exige `atendimento.comanda.desconto.aplicar`.
- Marcar item como `CANCELADO` exige `atendimento.comanda.item.cancelar` **e**
  motivo preenchido.
- Produto, nome, preço e quantidade de um item já lançado são imutáveis.
- Mudar mesa/tipo da comanda exige `atendimento.comanda.transferir`.
- `total_centavos` (valor cobrado, travado no pagamento) nunca muda depois
  de gravado.

As RPCs que precisam escrever essas colunas em nome de um supervisor (não
de quem está logado) usam um bypass controlado:
`set_config('restaurante.bypass_protecao', 'true', true)` — local à
transação da própria RPC, inalcançável por SQL arbitrário do client (a API
só expõe CRUD de tabela sob RLS e RPCs com grant explícito).

### Operações transacionais (RPC em vez de múltiplas escritas)

Fechar conta, fechar caixa, cancelar item, aplicar desconto, lançar/receber
pedido de compra, reabrir comanda travada e movimentar estoque manualmente
passam por funções `SECURITY DEFINER` que fazem tudo numa transação só —
se qualquer passo falhar, nada é gravado:

- `confirmar_pagamento` — fecha a comanda, grava pagamentos, movimentos de
  caixa, contas a receber (fiado/crédito/voucher), baixa de estoque e o
  `total_centavos` travado da venda.
- `conferir_fechamento_caixa` / `fechar_caixa` — calculam o esperado por
  forma **no servidor**; o client nunca recebe esse número antes de mandar
  o que o operador contou (conferência cega de verdade — antes o esperado
  já estava disponível no navegador via `state.caixaMovimentos`, só não
  aparecia na tela).
- `cancelar_item` / `aplicar_desconto` — verificam o PIN do supervisor
  escolhido e gravam a alteração + auditoria atomicamente.
- `reabrir_comanda` — reabre comanda travada em `FECHANDO` há mais de 10
  minutos (permissão `atendimento.comanda.reabrir`).
- `registrar_movimento_estoque` — entrada/saída manual, com
  `estoque_atual = estoque_atual - qtd` atômico (evita perder baixa quando
  dois terminais mexem no mesmo insumo ao mesmo tempo).
- `criar_pedido_compra` / `receber_pedido_compra` — mesma lógica pra
  compras: criar pedido sem item por falha no meio não acontece, e receber
  lança entrada de estoque + recalcula custo médio ponderado atomicamente.
- `relatorio_vendas(desde, até)` — agrega vendas/ranking/desempenho por
  garçom no banco (nunca envia comandas+itens completos pro navegador);
  "desempenho por garçom" conta quem **lançou** cada item
  (`comanda_itens.usuario_id`), não quem abriu a mesa.

### Conferência cega e trilha de auditoria

Fechamento de caixa esconde o saldo esperado até o operador informar o
valor contado — e agora isso é garantido pelo RPC, não só pela UI (ver
acima). Auditoria passou a ser gravada **só pelo servidor**
(`0047`): tabelas com trigger genérico (`comandas`, `comanda_itens` via
RPC, `usuarios`, `produtos`, `empresas`) ou RPC `SECURITY DEFINER` gravam
sozinhas; a policy `auditoria_insert` foi removida, então nenhum client
consegue mais inserir direto. O client ainda faz um "otimismo visual"
local (`registrarAuditoriaLocal`, sem gravar nada) só pra tela de Auditoria
não parecer travada entre o clique e o próximo refresh.

### Pendências de segurança (ver também [Pendências conhecidas](#pendências-conhecidas))

- PIN de 4 dígitos é curto por natureza (10 mil combinações). O app bloqueia
  por 30s após 5 tentativas erradas na própria UI, e as RPCs de supervisor
  têm seu próprio limite (5 tentativas / 5 min por supervisor, tabela
  `tentativas_autorizacao`) — mas nada disso impede uma chamada direta ao
  endpoint de Auth do Supabase fora do app; rate limit/CAPTCHA de verdade
  precisam ser configurados em **Auth → Rate Limits** no painel.
- `usuarios_login_por_empresa(slug)` não exige mais nome-derivado, mas o
  slug em si **não é secreto** — é o mesmo usado na URL pública do
  cardápio (`/cardapio/:slug`). Quem souber o slug ainda consegue listar
  nomes dos funcionários daquela empresa (não mais de todas). Resolve o
  vazamento entre empresas; não torna a lista de nomes secreta.
- Os PINs devem ser trocados regularmente e nunca deixados no padrão de
  criação de conta.

## Banco de dados: schema `restaurante` num projeto compartilhado

O projeto Supabase original saiu do ar em 2026-09 (projeto pausado/expirado
sem aviso). O app roda hoje em **`ybsyhjqtwiwomtxbloyu`**
(`https://ybsyhjqtwiwomtxbloyu.supabase.co`), que é **compartilhado com
outro app do dono da conta** ("Campo Forte", dados de café/commodities no
schema `public`). Por isso todo o restaurante vive isolado no schema
**`restaurante`** — nenhuma migration deste projeto deve criar nada em
`public`.

Consequências práticas:

- `Data API → Exposed schemas` (painel do Supabase) precisa incluir
  `restaurante`.
- Schemas criados manualmente não herdam grants de `anon`/`authenticated`
  automaticamente — ver `supabase/migrations/0026_grants_schema_restaurante.sql`.
  Sem isso o PostgREST devolve "could not find table in schema cache" mesmo
  com o schema exposto.
- O Custom Access Token Hook (`Authentication → Hooks` no painel) precisa
  apontar pra `restaurante.custom_access_token_hook`, não pra `public.`.
- `assets/js/config.js` cria o client com `db: { schema: "restaurante" }`,
  e os filtros de Realtime em `assets/js/data.js` usam `schema:"restaurante"`
  em vez de `"public"`.

### Principais tabelas

- **Núcleo**: `empresas` (com `slug`, agora com trigger de auditoria),
  `usuarios` (com `email_interno`, estável — não é mais derivado do nome),
  `papeis_permissoes`, `auditoria`, `tentativas_autorizacao` (rate limit
  das RPCs de supervisor, sem policy pro client).
- **Cardápio/estoque**: `categorias`, `produtos` (com `setor_producao`,
  `foto_url`), `insumos`, `ficha_tecnica`, `estoque_movimentos`,
  `insumo_rendimentos`.
- **Atendimento**: `mesas`, `comandas` (tipo `MESA`/`BALCAO`/`FICHA`,
  `ficha_numero`, `dia_operacional`, `total_centavos` travado no
  pagamento, `updated_at`), `comanda_itens` (com `setor_producao` e
  `motivo_cancelamento`).
- **Caixa/pagamentos**: `caixa_sessoes`, `caixa_movimentos`, `pagamentos`.
- **Financeiro**: `contas`.
- **Compras**: `fornecedores`, `pedidos_compra`, `pedidos_compra_itens`.
- **Cardápio público**: view `cardapio_publico_empresa` + policies `*_select_publico`
  (`to anon`) em `produtos`/`categorias`.

Todas numeradas e aplicadas em ordem em
[`supabase/migrations/`](supabase/migrations/). Migrations `0001` a `0020`
documentam a história original (schema `public`) mas **não devem ser
reaplicadas neste projeto** — foram substituídas pelas `0021+`. As
migrations `0021` a `0040` (2026-09/10) reconstroem o schema completo,
incluindo venda por balcão/ficha, rendimento de insumo, cardápio público,
setor de produção, compras/fornecedores, foto de produto, e as correções
de integridade/RLS descritas [acima](#autenticação-e-segurança). As
migrations `0041` a `0047` (Fase 0 do roteiro de evolução — correções de
risco operacional/financeiro) adicionam: índices pro KDS enxergar comanda
paga (`0041`), fechamento de caixa calculado no servidor (`0042`),
autorização de supervisor via RPC (`0043`), login por restaurante + e-mail
estável (`0044`), relatórios agregados no banco com total travado
(`0045`), reabertura de comanda travada (`0046`) e auditoria só pelo
servidor (`0047`).

## Variáveis de ambiente

Copie `.env.example` para `.env` (não versionado). **Atenção:** como não
há build step, o `.env` é só documentação — o front-end lê a config de
verdade direto de `assets/js/config.js` (`SUPABASE_URL`/`SUPABASE_KEY`
hardcoded ali). Editar o `.env` sozinho não muda o comportamento do app.

## Aplicar/atualizar migrations

Conexão direta (`db.<ref>.supabase.co`) costuma falhar por DNS nesta rede
(provavelmente só IPv6, sem o add-on de IPv4). O pooler
(`aws-1-us-west-2.pooler.supabase.com`) resolve, mas uma tentativa de
conexão via script (`pg`/Node) teve o certificado TLS rejeitado tanto pelo
runtime quanto pela validação nativa do Windows — não investigado a fundo,
e **nunca contorne isso desabilitando a verificação de certificado** (a
connection string carrega a senha do banco em texto puro).

Caminho que funcionou e é o recomendado: **SQL Editor do Supabase** (painel
→ SQL Editor), colando o conteúdo de cada arquivo de `supabase/migrations/`
em ordem e rodando. Sem risco de rede/TLS.

Existe uma integração GitHub↔Supabase configurada no painel (deploy
automático de `supabase/migrations/` ao dar merge em `main`), mas nunca foi
confirmada de fato — as migrations atuais foram todas aplicadas manualmente
pelo SQL Editor.

## Deploy (Vercel)

Publicado em produção desde 2026-09-24. Três ajustes de configuração do
projeto na Vercel foram necessários (nenhum é código, são settings do
painel):

- **Require Verified Commits** (Settings → Git) estava `Enabled` e
  cancelava todo deploy de commit não assinado — mudado pra `Disabled`.
- **Framework Preset** estava configurado como Next.js (o app é HTML/JS
  estático, sem framework) — mudado pra `Other`.
- **Deployment Protection** estava exigindo login na Vercel até pra
  Production, bloqueando qualquer usuário real — desligado.

`vercel.json` também define o rewrite de `/cardapio/:slug` para
`/cardapio.html?slug=:slug`, usado pelo cardápio público.

## Pendências conhecidas

- **Notas fiscais reais (NFC-e)**: o app emite um *comprovante não fiscal*
  (recibo de pagamento) e relatório de fechamento de caixa, ambos
  imprimíveis via `window.print()`. Nota fiscal eletrônica de verdade exige
  integração com um provedor credenciado (Focus NFe, Tecnospeed etc.) via
  certificado A1 — fora do escopo atual.
- **PIX**: simulado (QR ilustrativo + código "copia e cola" fake,
  claramente rotulado como simulação) — não processa pagamento real.
- **Rendimento de insumo não afeta a baixa de estoque**: o fator medido na
  tela Estoque é só registro/consulta hoje. Aplicá-lo na fórmula de baixa
  automática (ficha técnica × venda) é decisão de negócio — multiplicar ou
  dividir a quantidade pelo fator muda o resultado pra lados opostos, e
  errar isso bagunça o estoque de verdade. Não implementado até alguém com
  esse contexto decidir a direção certa.
- **Transferir/juntar comandas**: a permissão `atendimento.comanda.transferir`
  existe no catálogo e a tabela `venda_movimentacoes` existe no banco
  (`0027`), mas não há tela pra isso ainda — hoje não dá pra mover item ou
  juntar duas mesas pela interface.
- **Força-bruta de PIN via API do Supabase / slug do restaurante não é
  secreto**: ver
  [Pendências de segurança](#pendências-de-segurança-ver-também-pendências-conhecidas) acima.
- **`docs/ER.md` está desatualizado**: descreve o desenho original
  (schema `public`, tabelas que não existem no `restaurante` atual, como
  `produto_variacoes`/`notas_fiscais`/`formas_pagamento`). Não reflete o
  schema real — use as migrations como fonte de verdade.
- **Sem testes automatizados no repositório**: não há arquivo de teste
  versionado, apesar de versões anteriores deste documento mencionarem
  testes de integração reais contra o Supabase de produção. Se existiram,
  nunca foram commitados.
