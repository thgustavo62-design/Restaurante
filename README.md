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
| **Comanda** | Catálogo de produtos por categoria (com busca e foto, se cadastrada) pra lançar itens — produto com perguntas/adicionais abre um seletor de opções antes de entrar no pedido; revisão do pedido antes de enviar pra cozinha; cancelar item e aplicar desconto (qualquer garçom pode pedir, mas sempre com PIN de um supervisor escolhido num dropdown — verificado no servidor); transferir item pra outra comanda, transferir a comanda pra outra mesa, juntar com outra mesa; fechar conta — inteira, dividida por pessoas ou **por item escolhido** (pagamento parcial: a comanda só fecha quando o último item é pago). Se o pagamento travar (aba fechou no meio), aparece "Reabrir" depois de 10 minutos em fechamento. |
| **Cozinha (KDS)** | Kanban (Pendente → Preparando → Pronto → Entregue) dos itens lançados, com abas pra filtrar por setor de produção (Bar / Cozinha / Brasa / Sobremesa) — cada produto tem um setor, gravado no item no momento do lançamento. Botão de som (precisa de 1 clique pra ativar, por causa do autoplay do navegador) toca um bipe quando chega pedido novo em qualquer terminal. Ticket com mais de um item ganha um botão pra avançar todos de uma vez, além do botão por item. Ordenado do pedido mais antigo pro mais novo. Atraso configurável por setor (Configurações). Mostra itens de qualquer comanda do dia operacional, **inclusive já paga** (balcão/ficha paga na hora não some mais da cozinha antes de sair). Alerta separado pra item cancelado depois de já estar em preparo. |
| **Atendimento (Salão)** — aviso de pronto | Mesa com item marcado **PRONTO** pela cozinha pisca um destaque amarelo no mapa de mesas, e a tela da comanda mostra um aviso "pronto para servir" — sem precisar recarregar (via Realtime). |
| **Atendimento (Salão)** — pedido pelo QR e delivery | Botões **Delivery** (escolhe cliente, endereço/bairro com taxa sugerida, agenda horário) e card de **pedidos pelo QR da mesa** aguardando confirmação do garçom (aceitar lança os itens na cozinha; rejeitar descarta) — nunca vai direto pra cozinha sem um humano aprovar. |
| **Caixa** | Terminal com nome configurável (lembrado neste dispositivo) — dois terminais com caixa aberto ao mesmo tempo fecham cada um só as próprias vendas. Abrir sessão com saldo inicial, registrar sangria/suprimento, ver movimentos da sessão. Fechamento é por **conferência cega calculada no servidor**: o client nunca recebe o esperado antes de mandar o valor contado; diferença acima do limite configurado exige justificativa escrita. |
| **Cardápio** | CRUD de produtos (nome, categoria, preço, foto por URL, setor de produção) e de categorias (criadas on-the-fly no formulário de produto). Marcar produto como esgotado/reativado sem precisar editar o preço. Botão **Opções** por produto: grupos de perguntas/adicionais (ex: "Ponto da carne" obrigatório, "Adicionais" opcional até N), cada opção com preço próprio opcional — aparecem no lançamento do pedido, no KDS, no recibo e no cardápio público. |
| **Estoque** | Insumos com estoque atual/mínimo, validade e custo médio; entrada/saída manual com motivo obrigatório; alerta de estoque baixo e de validade vencendo/vencida; botão **Fazer inventário** (contagem física de todos os insumos de uma vez, gera ajuste só no que divergir do sistema); botão **Sugerir pedido** nos itens abaixo do mínimo, pré-preenchendo um pedido de compra; botão **Rendimento** pra registrar o fator de perda medido de um insumo (ex: 85% depois de limpar/aparar) — hoje é só registro/consulta, não altera o cálculo de baixa automática (ver [Pendências](#pendências-conhecidas)). |
| **Compras** | Cadastro de fornecedores e pedidos de compra (Rascunho → Pedido realizado → Recebido). Receber um pedido lança entrada de estoque automaticamente e recalcula o custo médio ponderado do insumo. |
| **Financeiro** | Contas a pagar e a receber (as de receber de fiado/débito/crédito/voucher são geradas automaticamente ao fechar uma conta, já líquidas da taxa da maquininha configurada), com status pago/pendente/vencido. Botão **Exportar pro contador**: baixa 3 CSVs do mês (vendas por forma, contas, fechamentos de caixa). |
| **Clientes** | CRM básico: nome, telefone, endereço/bairro (pra delivery), aniversário, observações, consentimento LGPD. Ficha do cliente mostra saldo de fiado em aberto, **pontos de fidelidade** e histórico de visitas. Cliente é opcional em qualquer pagamento (ganha pontos — padrão 1 ponto por R$1, configurável) e obrigatório no fiado (não é mais texto livre); pontos acumulados podem ser resgatados como desconto na hora de fechar a conta. |
| **Relatórios** | Aba **Vendas**: ranking de produtos e desempenho por garçom (por quem **lançou** o item), por período (hoje / 7 dias / 30 dias / escolher mês). Aba **Gestão**: CMV e margem por produto (alerta quando custo ≥ preço), relatório anti-fraude (cancelamentos e descontos por funcionário), taxa de serviço estimada por garçom, curva ABC, heatmap de vendas por dia×hora e taxas pagas às maquininhas. Aba **DRE mensal**: faturamento − CMV − despesas = resultado, por mês. Tudo agregado no banco — não carrega mais comandas/itens completos no navegador, e o total de cada venda é o valor travado no pagamento, não recalculado com a taxa de serviço atual. |
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

**Pedido pelo QR da mesa (Fase 3.3)**: link com `?mesa=N` (o QR impresso
em cada mesa já codifica isso) libera carrinho de pedido — produto com
grupo de opção obrigatório fica marcado "peça direto com o garçom" (não
dá pra escolher opção pelo celular ainda). O pedido cai em
`restaurante.pedidos_qr`, status `PENDENTE`, **nunca** direto em
`comanda_itens` — só vira item de cozinha de verdade quando um garçom
confirma pela tela de Atendimento (RPC `confirmar_pedido_qr`, que relê o
preço do banco igual qualquer outro lançamento). anon não tem nenhuma
policy de insert/select direto nessa tabela, só a RPC grava; no máximo 1
pedido pendente por mesa por vez (trava spam — só dá pra mandar outro
depois do garçom confirmar ou rejeitar o anterior).

### Contingência sem internet (Fase 3.5)

Escopo mínimo aprovado: **lançar item, ver KDS local e receber em
dinheiro** — fechar em cartão/PIX/fiado/pontos continua exigindo conexão
(depende de taxa de maquininha e saldo de fidelidade que só o banco sabe
de verdade).

- **Service worker** (`sw.js`, registrado em `main.js`): cacheia o "app
  shell" (HTML/JS/CSS) com estratégia *network-first* (tenta a rede
  sempre que possível, só serve do cache quando a rede falha) — nunca
  serve versão velha do app por engano quando há internet. Nunca cacheia
  chamada pro Supabase.
- **Fila offline** (`assets/js/offline.js`, IndexedDB): quando lançar
  item, avançar status no KDS ou fechar em dinheiro falha por falta de
  rede (não por regra de negócio — isso continua mostrando erro na hora,
  nunca fica escondido), a ação é aplicada **localmente de forma
  otimista** (item/comanda aparecem marcados "OFFLINE · sincronizando")
  e guardada na fila. Ao reconectar (`window.addEventListener("online")`),
  a fila é reenviada em ordem — item lançado usa `comanda_itens.client_uuid`
  pra nunca duplicar se a escrita já tinha ido mas só a confirmação que se
  perdeu.
- **O que explicitamente não faz**: nenhuma leitura é inventada offline
  (a tela mostra só o que já tinha carregado antes de cair a conexão);
  pagamento em cartão/PIX/fiado/com resgate de pontos é bloqueado offline
  com mensagem clara, em vez de tentar adivinhar taxa ou saldo.

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
- `transferir_item` / `transferir_comanda` / `juntar_comandas` (`0048`) —
  move item entre comandas, muda a mesa de uma comanda, ou junta duas
  comandas numa só (a origem fecha como `CANCELADA`), sempre com
  `venda_movimentacoes` + auditoria gravados na mesma transação.
- `confirmar_pagamento` (`0049`/`0050`/`0051`) — aceita um subconjunto de
  itens (`p_item_ids`) pra pagamento parcial (a comanda só vira `PAGA`
  quando o último item pendente é coberto; desconto da comanda só entra
  quando fecha tudo de uma vez, não num pagamento parcial — suposição
  registrada no comentário da migration `0049`) e a sessão de caixa certa
  (`p_sessao_id`, pelo terminal do client, não mais "a sessão aberta mais
  recente"). Baixa de estoque (ficha técnica do produto e dos adicionais
  escolhidos) só acontece no pagamento que finalmente fecha a comanda.

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
  `ficha_numero`, `dia_operacional`, `total_centavos` acumulado a cada
  pagamento — parcial ou não, `updated_at`), `comanda_itens` (com
  `setor_producao`, `motivo_cancelamento`, `pago_em` — nulo até o item
  entrar num pagamento, parcial ou não — e `opcoes_selecionadas` jsonb),
  `venda_movimentacoes` (log de transferência/junção de mesa, `0027`,
  gravado só pelas RPCs `transferir_item`/`transferir_comanda`/
  `juntar_comandas`, `0048`).
- **Cardápio — perguntas/adicionais** (`0051`): `grupos_opcoes` (por
  produto, obrigatório ou não, mínimo/máximo de escolhas),
  `opcoes` (dentro de um grupo, com preço adicional opcional),
  `opcao_ficha_tecnica` (baixa de estoque própria do adicional, mesma
  ideia de `ficha_tecnica` mas pra opção).
- **Caixa/pagamentos**: `caixa_sessoes` (`terminal` agora realmente usado
  — um terminal só enxerga/fecha a sessão aberta com o nome salvo no
  próprio dispositivo), `caixa_movimentos`, `pagamentos`.
- **Financeiro**: `contas`.
- **Compras**: `fornecedores`, `pedidos_compra`, `pedidos_compra_itens`.
- **Cardápio público**: view `cardapio_publico_empresa` + policies `*_select_publico`
  (`to anon`) em `produtos`/`categorias`/`grupos_opcoes`/`opcoes`.

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
servidor (`0047`). As migrations `0048` a `0051` (Fase 1 — operação de
sexta à noite) adicionam: transferir item/comanda e juntar mesas via RPC
(`0048`), dividir conta por item com pagamento parcial (`0049`), múltiplos
caixas por terminal (`0050`) e perguntas/adicionais no produto com preço
calculado no servidor (`0051`). As migrations `0052` a `0057` (Fase 2 —
gestão e lucro do dono) adicionam: CMV/margem, anti-fraude, taxa por
garçom, curva ABC e heatmap (`0052`), taxas de maquininha com conta a
receber líquida (`0053`), inventário com ajuste e validade de insumo
(`0054`), cadastro de clientes com fiado vinculado (`0055`), couvert por
pessoa e happy hour (`0056`) e exportação CSV pro contador (`0057`). As
migrations `0058` e `0059` (Fase 3 — integrações construídas aqui dentro,
sem provedor externo) adicionam: fidelidade por pontos e delivery próprio
com taxa por bairro (`0058`) e pedido pelo QR da mesa, pendente de
confirmação do garçom (`0059`). As migrations `0060` e `0061` (Fase 4 —
produto Vision Food) desacoplam a URL do projeto Supabase de dentro das
RPCs que chamam a Admin API do GoTrue e corrigem uma regressão real
achada na revisão — `verificar_pin_supervisor` tinha voltado a
reconstruir e-mail a partir do nome em vez de `email_interno` (`0060`) —
e adicionam a função de onboarding de novo restaurante (`0061`).

## Migração pra projeto Supabase exclusivo (Fase 4.1)

Hoje o app roda num projeto compartilhado com outro produto do dono da
conta (ver [Banco de dados](#banco-de-dados-schema-restaurante-num-projeto-compartilhado)
acima). As migrations `0060`+ já tiram a URL do projeto de dentro das
RPCs (lida do Vault, com fallback pro valor de hoje — ver comentário da
`0060`), mas a migração em si **não foi executada** — criar um projeto
novo, mover dado de produção e trocar DNS/deploy são ações reais demais
pra fazer sem você decidir o momento. Roteiro de quando for a hora:

1. Criar o projeto Supabase novo (plano pago, se o tráfego justificar).
2. Aplicar todas as migrations de `supabase/migrations/` nele, em ordem.
3. Cadastrar `service_role_key` (e, já que a `0060` existe, também
   `project_url` com a URL do projeto NOVO) no Vault dele.
4. Expor o schema `restaurante` em `Data API → Exposed schemas` e apontar
   o Custom Access Token Hook pra `restaurante.custom_access_token_hook`
   (mesmos 2 passos manuais do setup original, ver
   [Consequências práticas](#banco-de-dados-schema-restaurante-num-projeto-compartilhado) acima).
5. Exportar os dados de produção (`pg_dump` do schema `restaurante`, ou
   `COPY` tabela a tabela pelo SQL Editor) e importar no projeto novo —
   **inclusive os usuários do Auth**, que não vêm num dump normal de
   schema (precisa recriar via Admin API/onboarding, com PIN novo pra
   cada funcionário — e-mail não precisa ser o mesmo, já que `0044`
   tornou o e-mail um UUID opaco).
6. Atualizar `SUPABASE_URL`/`SUPABASE_KEY` em `assets/js/config.js` e
   `cardapio-publico.js` (as 2 únicas linhas que o front-end ainda
   precisa ter a URL fixa — inevitável sem build step, mas é uma edição
   mecânica de 1 linha cada, não um problema real).
7. Trocar a connection string/projeto configurado na Vercel e fazer um
   novo deploy.

### Realtime incremental (Fase 1.7)

`comandas` e `comanda_itens` (o par que muda a cada pedido lançado, status
de KDS alterado ou comanda transferida) aplicam o payload do Realtime
direto no `state`, sem nenhuma consulta nova na maioria dos casos — antes,
qualquer mudança nessas tabelas disparava `carregarTudo()` inteiro
(~17 consultas) em todo terminal conectado. O único caso que ainda busca
algo (uma consulta leve, não o carregamento completo) é item que chega
numa comanda que não está em `state.comandas` — ex: venda de balcão/ficha
já paga. As demais tabelas (cardápio, estoque, financeiro, equipe,
compras) continuam recarregando tudo — mudam raramente, não valia a
complexidade de aplicar incremental em cada uma.

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

## Impressão por setor — proposta pendente (Fase 1.8)

[DECISÃO] — não implementado ainda, aguardando aprovação. Hoje toda
impressão (recibo, fechamento de caixa) é `window.print()`: abre o
diálogo do navegador, a pessoa escolhe a impressora na mão. Pra imprimir
automaticamente um ticket no bar e outro na cozinha (sem diálogo, sem
decidir manualmente), o navegador sozinho não consegue — ele não tem
acesso a impressoras específicas nem imprime em segundo plano. Os
sistemas do mercado (Saipos, Consumer) resolvem isso com um **agente
local** rodando num PC/mini-PC do restaurante, que recebe o pedido de
impressão da tela e manda pra impressora certa.

**Opção A — QZ Tray** (recomendada): programa gratuito e open-source que
roda num PC do restaurante; o app manda o ticket pra ele via WebSocket
local, e ele imprime na impressora térmica USB certa. Funciona com as
impressoras térmicas USB comuns (as que o restaurante provavelmente já
tem). Custo: zero pra uso básico; pra não aparecer aviso de segurança
toda hora, dá pra configurar um certificado — ou um autoassinado (grátis)
ou um confiável (~R$1.000–2.000/ano). Risco: precisa de um PC ligado e
com QZ Tray rodando sempre que o restaurante estiver funcionando — se
esse PC cair, a impressão automática para (teria que cair pro
`window.print()` de novo, que eu manteria como alternativa).

**Opção B — impressora de rede (Ethernet/Wi-Fi) via ESC/POS**: se as
impressoras suportam rede, dá pra mandar o comando de impressão direto
pela rede local. Mas o navegador também não abre conexão de rede crua
sozinho — ainda precisaria de uma pontezinha local (programinha rodando
num PC, tipo a opção A) ou trocar as impressoras atuais por modelos de
rede (~R$400–800 cada, se as de hoje forem só USB). Na prática, mistura a
complexidade da opção A com custo de hardware novo — só faz sentido se o
restaurante já tiver impressora de rede.

**Opção C — manter como está**: `window.print()` continua, sem
investimento nenhum, mas não resolve o "sem diálogo" pedido no roteiro.

Pra decidir, preciso saber: as impressoras térmicas do Rancho Netto são
USB ou já têm rede/Wi-Fi? E tem um PC/mini-PC que pode ficar ligado no
restaurante durante o expediente pra rodar o agente local? Com isso eu
fecho a proposta certa e começo a implementar.

## Fase 3 — Integrações e continuidade

Decisão do dono (2026-10): nada que dependa de provedor externo pago —
**3.1 (PIX real), 3.2 (NFC-e) e 3.4 (iFood) ficam de fora**, por natureza
exigem um terceiro (instituição de pagamento licenciada, homologação na
SEFAZ, a própria plataforma do iFood) e não tem como "construir por conta
própria". As propostas completas desses três continuam documentadas
abaixo, caso a decisão mude no futuro. **3.3, 3.5, 3.6 e 3.7 — tudo
construído aqui dentro, sem terceiro — foram implementados.**

### 3.1 — PIX real (QR dinâmico + baixa automática por webhook)

- **Provedor sugerido**: Efí Pay (ex-Gerencianet) — API Pix brasileira,
  sem mensalidade pra conta Pix básica, SDKs oficiais prontos. Exige
  certificado mTLS próprio (emitido pelo painel deles, sem custo). Mercado
  Pago é alternativa mais simples de integrar (não exige mTLS) mas cobra
  taxa por transação Pix (hoje na faixa de ~1% via Checkout Pro).
- **Custo**: Efí — sem mensalidade, sem taxa por Pix recebido (modelo
  atual deles); custo residual é gerenciar o certificado. Mercado Pago —
  sem mensalidade, ~1% por transação.
- **Edge Function**: **sim, obrigatória**. A chave/certificado do
  provedor nunca pode ir pro navegador (mesma regra de ouro da
  `service_role_key`), e o **webhook de confirmação de pagamento** —
  o provedor chamando de volta pra avisar "pago" — precisa de um endpoint
  HTTP público que só uma Edge Function fornece (o Postgres sozinho não
  recebe webhook).
- **Riscos**: se o provedor cair, o pagamento não confirma sozinho — o
  app precisa manter o botão manual "marcar como pago" que já existe
  (hoje o PIX é só simulado) como contingência, com auditoria de quem
  confirmou manualmente. Webhook duplicado/fora de ordem precisa de
  idempotência (checar se aquele pagamento já foi registrado antes de
  gravar de novo).

### 3.2 — NFC-e (nota fiscal de consumidor eletrônica)

- **Provedor sugerido**: Focus NFe — plano Varejo (NFC-e) **R$59,90/mês**,
  1 CNPJ, 500 NFC-e incluídas + 100 NF-e, nota extra R$0,05. Alternativas:
  Tecnospeed, eNotas (preços não confirmados nesta pesquisa).
- **Custo adicional**: certificado digital A1 da empresa, ~R$150–300/ano
  (comprado à parte, não incluso no plano do provedor).
- **Edge Function**: **sim, obrigatória**. Chamada autenticada (API key)
  pro provedor emitir a nota a cada venda fechada — não pode rodar no
  client.
- **Riscos**: se a SEFAZ ou o provedor cair, a venda não pode ficar
  travada esperando nota — precisa de **modo de contingência** (emite a
  nota depois, quando o serviço voltar, mantendo a venda registrada
  normalmente nesse meio tempo). Erro de configuração fiscal (NCM,
  CFOP, regime tributário errado) gera risco de multa — não é só um bug
  de software, precisa de alguém com conhecimento contábil validando a
  configuração antes de ligar pra valer.

### 3.3 — Pedido pelo QR da mesa

- **Provedor sugerido**: nenhum — estende o `cardapio.html` que já
  existe, sem custo de terceiro.
- **Edge Function**: não necessariamente — dá pra fazer com uma RPC
  `anon` que insere o pedido como "pendente de confirmação do garçom"
  (nunca direto em `comanda_itens` como pronto pra cozinha).
- **Riscos**: é a única do grupo sem custo externo, mas tem risco de
  abuso — sem autenticação, qualquer um com o link pode mandar pedido
  (spam, pedido de brincadeira). Precisa de rate limit por mesa/sessão e
  confirmação obrigatória do garçom antes de qualquer coisa ir pra
  cozinha ou virar cobrança.

### 3.4 — iFood

- **Provedor sugerido**: API oficial do iFood (Order, Catalog, Merchant,
  Financial) — vira parceiro iFood gratuitamente pra começar, inclusive
  como MEI, com acesso a loja de teste pra homologar antes de ir pra
  produção.
- **Custo**: a API em si não cobra; o custo real é a **comissão do iFood
  sobre cada pedido** (prática de mercado costuma ficar entre 12% e 27%
  dependendo do plano comercial — confirmar direto com o iFood, não achei
  número oficial atual).
- **Edge Function**: **sim, obrigatória**. Autenticação OAuth2 + webhook
  de eventos de pedido (novo pedido, cancelamento) — mesma razão do PIX.
- **Riscos**: pedido do iFood cai direto no KDS — se a integração falhar
  silenciosamente, perde pedido de verdade com cliente esperando.
  Precisa de um jeito de notar "parou de chegar pedido do iFood" (alerta,
  não só log).

### 3.5 — Modo de contingência sem internet

- **Não é integração com terceiro** — é arquitetura: service worker +
  fila local em IndexedDB (usando o padrão `client_uuid` que já existe em
  `caixa_movimentos`/`comandas` pra identificar o que foi criado offline)
  e sincronização quando a conexão volta.
- **Escopo mínimo sugerido**: lançar item, KDS local (só no dispositivo
  que ficou offline) e receber em dinheiro — fechar em cartão/PIX/fiado
  fica bloqueado offline (depende de serviço externo ou de conferência
  de caixa em tempo real).
- **Edge Function**: não.
- **Custo**: zero de terceiro, mas é a proposta com mais complexidade de
  engenharia do grupo — resolução de conflito (dois terminais offline
  editando a mesma comanda) é o ponto difícil de verdade.
- **Riscos**: dado perdido se o navegador limpar o IndexedDB antes de
  sincronizar; comanda duplicada se dois terminais abrirem a "mesma" mesa
  offline ao mesmo tempo.

### 3.6 — Fidelidade/cashback

- **Provedor sugerido**: nenhum — construído sobre o cadastro de
  clientes (2.7) que já existe, sem custo de terceiro.
- **Edge Function**: não.
- **Risco principal não é técnico, é de regra de negócio**: preciso que
  você defina quanto vale 1 ponto/1% de cashback, se expira, e se pode
  virar desconto direto na próxima conta ou só relatório — isso muda o
  desenho da tabela e eu não decido sozinho.

### 3.7 — Delivery próprio e pedidos agendados

- **Provedor sugerido**: nenhum obrigatório pro básico (endereço do
  cliente, taxa por bairro cadastrada manualmente, status do entregador
  trocado manualmente). Geocoding automático (calcular distância/taxa
  sozinho) precisaria de uma API de mapas paga (Google Maps ou similar,
  cobra por chamada) — proponho começar **sem** isso (taxa por bairro
  configurada à mão) e só considerar depois se o volume justificar.
- **Edge Function**: só se entrar geocoding automático depois.
- **Riscos**: sem um app/tela própria pro entregador, o controle de
  status vira manual — se o restaurante tiver muitos entregadores
  simultâneos, isso pode virar gargalo operacional antes de ser um
  problema de código.

## Estoque negativo — decisão pendente (Fase 2.6)

[DECISÃO] — não implementado. Hoje toda baixa de estoque (venda,
inventário, movimento manual) trava em zero
(`greatest(0, estoque_atual - quantidade)`): não deixa o número ficar
negativo mesmo que tenha vendido mais do que o sistema achava que tinha.
O roteiro original pede pra considerar deixar ficar negativo em vez de
travar — **mas não decidi isso sozinho porque errar pra qualquer lado tem
custo real**: travar em zero já causou (ou pode causar) uma venda "comer"
estoque que não existia sem avisar ninguém; deixar negativo mostra o
problema na cara (ex: -3 un.) mas pode confundir quem olha o relatório e
não sabe que number negativo significa "furo a investigar", não "estoque
de verdade". Pra decidir, preciso saber: quando a baixa automática por
ficha técnica tenta descontar mais do que existe, você prefere que o
sistema (a) trave em zero como hoje e avise discretamente, ou (b) deixe
ficar negativo (sinalizado em vermelho na tela de Estoque) pra forçar
alguém a investigar a divergência?

## Onboarding de novo restaurante (Fase 4.2)

`restaurante.onboarding_criar_empresa(...)` (migration `0061`) cria
empresa + primeiro ADMIN (login real) + mesas numeradas + categorias
iniciais numa chamada só, no SQL Editor:

```sql
select restaurante.onboarding_criar_empresa(
  'Nome do Restaurante',       -- p_nome_empresa
  'slug-do-restaurante',       -- p_slug (só minúscula/número/hífen)
  'Nome do Primeiro Admin',    -- p_nome_admin
  '1234',                      -- p_pin_admin (4 dígitos)
  10,                          -- p_qtd_mesas (opcional, padrão 10)
  array['Entradas','Pratos Principais','Bebidas','Sobremesas'] -- p_categorias (opcional)
);
```

Devolve `empresa_id`, `admin_id`, `link_login` (`/?r=slug`) e
`link_cardapio` (`/cardapio/slug`) prontos pra mandar pro cliente novo.
Propositalmente **sem grant pra authenticated/anon** — só o operador da
Vision Food chama, igual já aplica migration; não existe hoje o conceito
de "dono da plataforma" logado dentro do app (exigiria repensar o modelo
de permissão multi-tenant inteiro, fora do escopo pedido).

## Backups e 2FA do ADMIN (Fase 4.3)

- **Backups**: o Supabase já faz backup diário automático em todo
  projeto (inclusive plano free, retenção menor); planos pagos (Pro+)
  têm *Point-in-Time Recovery* (restaura pra qualquer minuto, não só o
  snapshot diário). Isso é configuração de painel (`Database → Backups`
  no projeto Supabase), não código — não dá pra "implementar" backup
  agendado no app, só documentar e checar se está ligado. Recomendo
  conferir esse painel e considerar o plano Pro antes de ter volume real
  de clientes multi-tenant.
- **Verificação em duas etapas (2FA) do ADMIN**: implementada com o MFA
  nativo do Supabase Auth (TOTP — Google Authenticator, Authy, etc.),
  sem provedor externo. Tela Configurações → card "Verificação em duas
  etapas" (só aparece pra quem está logado como ADMIN) → "Ativar" mostra
  o QR code, confirma com um código de 6 dígitos. No login, se a conta
  tiver 2FA ativada, pede o código depois do PIN, antes de soltar
  qualquer dado da empresa pro navegador. **Limite honesto**: isso é uma
  trava no nível do app (tela de login), não reforçada nas policies RLS
  — alguém que chamasse a API do Supabase Auth diretamente (fora do app)
  ainda completaria o login só com o PIN; o segundo fator não é hoje
  exigido por RLS pra nenhuma operação. Reforçar isso no banco (checar
  `auth.jwt()->>'aal'` nas policies mais sensíveis) é uma extensão
  possível, não implementada agora.

## Testes automatizados (Fase 4.4)

`tests/` — suíte com `node --test` (sem framework externo) cobrindo
`confirmar_pagamento`, conferência cega de caixa, `registrar_movimento_estoque`
e autorização de supervisor. **Escrita e revisada, mas nunca executada**
— precisa de um projeto Supabase à parte só pra teste (nunca o de
produção; o próprio `tests/setup.js` recusa rodar se a URL apontar pro
projeto do Rancho Netto). Ver `tests/README.md` pro setup completo antes
de rodar `npm test` pela primeira vez.

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
- **Impressão por setor em impressoras térmicas (Fase 1.8)**: ainda é
  `window.print()` com diálogo do navegador — ver proposta em
  [Impressão por setor — proposta pendente](#impressão-por-setor--proposta-pendente-fase-18)
  abaixo, aguardando aprovação antes de implementar.
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
