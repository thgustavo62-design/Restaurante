# Vision Food

Sistema de gestão para restaurante/bar: atendimento de salão, cozinha (KDS),
caixa, cardápio, estoque, compras, financeiro, clientes/fidelidade,
marketing (cupons, reativação, banner), relatórios, equipe e pedido pelo
QR da mesa (cardápio público completo, com opções/adicionais, sem precisar
de atendente pra anotar) — rodando **100% sobre o Supabase** (Postgres +
Auth + Realtime). Não há backend próprio: o front-end fala direto com o
banco, e a segurança (quem pode ver e escrever o quê) é garantida pelo
próprio Postgres via Row Level Security (RLS), não pela interface.

Todas as fases do roteiro de evolução (Fase 0 a Fase 5) estão
implementadas e em produção — ver a tabela de telas, o histórico de
migrations e [Pendências conhecidas](#pendências-conhecidas) abaixo pro
que ainda depende de decisão humana ou de um provedor externo pago.

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
- **Autenticação**: cada funcionário é uma conta real do Supabase Auth —
  não é mock. Senha de acesso (login, 8+ caracteres) e PIN operacional
  (4 caracteres, autorização de supervisor/bater ponto) são
  independentes desde a `0078` (detalhes
  [abaixo](#autenticação-e-segurança)).
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
Itens relacionados ficam agrupados num menu que expande ao clicar
(Atendimento/QR Codes, Estoque/Compras, Financeiro/Relatórios,
Clientes/Equipe) — Caixa, Cozinha, Cardápio, Marketing, Auditoria e
Configurações continuam soltos, por não terem um par óbvio. O ícone de
menu (☰) no topo, ao lado do título da página, colapsa a barra lateral
pra só os ícones — preferência salva neste aparelho (`localStorage`,
mesmo padrão do nome do terminal), não reseta ao recarregar a página.

| Tela | O que faz |
|---|---|
| **Central do Dono** | PRIORIDADE 1 — primeira tela depois do login pra ADMIN/GERENTE (`admin.central_dono.ver`). Uma RPC só (`central_do_dono`, agregada no banco, nunca baixa comandas/itens pra somar no navegador), atualizada a cada 60s e quando o Realtime avisa de uma venda nova: faturamento/vendas/ticket de hoje comparados com a mesma janela de horário da semana passada, projeção de fechamento do dia pelo ritmo das últimas 4 semanas, "sobrou no mês" (resultado estimado — **só ADMIN vê**, GERENTE recebe `null` decidido no servidor, não só escondido no front), semáforos de CMV/perdas/diferença de caixa contra metas configuráveis (Configurações), até 5 alertas por gravidade ("precisa da sua atenção": estoque negativo, conta vencendo, diferença de caixa, conflito offline, cancelamentos acima do normal) e a foto do salão agora (mesas ocupadas, pedidos atrasados, caixa aberto/fechado). |
| **Dashboard** | Vendas do dia, ticket médio, mesas ocupadas, gráfico de vendas por hora, situação da cozinha e alertas (mesa atrasada, caixa fechado, sangria recomendada). |
| **Atendimento (Salão)** | Duas sub-abas (ETAPA 0.11). **Mapa de mesas**: status (livre / ocupada / aguardando pagamento) e tempo de ocupação — mesa com reserva nas próximas 2h ganha um aviso "Reservada". Botões **Balcão** e **Nova ficha** abrem uma venda sem mesa (fila por balcão ou ficha numerada — número atribuído automaticamente, até o limite configurado de fichas). Painel lateral lista todas as comandas abertas, seja de mesa, balcão ou ficha. **Reservas e fila** (PRIORIDADE 8): cadastro de reserva (nome, telefone, pessoas, data/hora, observação, mesa sugerida) com status aguardando/confirmada/sentado/não veio e botão WhatsApp (mensagem pronta, só abre o app); fila de espera walk-in com posição e tempo estimado pelo tempo médio de ocupação das mesas; botão **Sentar** (de uma reserva ou da fila) escolhe uma mesa livre e vira comanda de verdade, vinculando o cliente. |
| **Comanda** | Catálogo de produtos por categoria (com busca e foto, se cadastrada) pra lançar itens — produto com perguntas/adicionais abre um seletor de opções antes de entrar no pedido; revisão do pedido antes de enviar pra cozinha; cancelar item e aplicar desconto (qualquer garçom pode pedir, mas sempre com PIN de um supervisor escolhido num dropdown — verificado no servidor); transferir item pra outra comanda, transferir a comanda pra outra mesa, juntar com outra mesa; fechar conta — inteira, dividida por pessoas ou **por item escolhido** (pagamento parcial: a comanda só fecha quando o último item é pago). No fechamento (modo "dividir por pessoas"): escolher cliente (ganha pontos de fidelidade), resgatar pontos como desconto, e **aplicar cupom de marketing** (código validado na hora, mostra o desconto antes de confirmar) — os três descontos empilham entre si, e o total exibido vem sempre do servidor (`calcular_total_pagamento`, recalculado a cada mudança — nunca mais fórmula própria no navegador, ETAPA 0.1); empilhado passando do limite configurado pede PIN de supervisor (ETAPA 0.2); pagar a mais sem nenhuma linha em dinheiro é recusado (sem pra onde ir o troco). Se o pagamento travar (aba fechou no meio), aparece "Reabrir" depois de 10 minutos em fechamento. |
| **Cozinha (KDS / Produção / Expedição)** | Três sub-abas (componente genérico da ETAPA 0.11). **KDS**: kanban (Pendente → Preparando → Pronto → Entregue) dos itens lançados, com abas pra filtrar por setor de produção (Bar / Cozinha / Brasa / Sobremesa) — cada produto tem um setor, gravado no item no momento do lançamento. Botão de som (precisa de 1 clique pra ativar, por causa do autoplay do navegador) toca um bipe quando chega pedido novo em qualquer terminal. Ticket com mais de um item ganha um botão pra avançar todos de uma vez, além do botão por item. Ordenado do pedido mais antigo pro mais novo. Atraso configurável por setor (Configurações). Mostra itens de qualquer comanda do dia operacional, **inclusive já paga** (balcão/ficha paga na hora não some mais da cozinha antes de sair). Alerta separado pra item cancelado depois de já estar em preparo. **Produção** (PRIORIDADE 2 — Produção/Pré-preparo): checklist diário de pré-preparo, sugerido pelo banco a partir da média de vendas das últimas 4 semanas × ficha técnica; campo de ajuste % pra feriado/evento; marcar item como feito grava quem e quando; insumo marcado como **sub-receita** (produzido internamente, ex: vinagrete) ganha botão **Produzir lote** — baixa os ingredientes da receita própria (Estoque → checkbox "produzida internamente" + botão Receita) e dá entrada já com custo médio recalculado, imprimindo a etiqueta de manipulação. **Expedição** (PRIORIDADE 6): agrupa os itens ativos de cada comanda por "tempo" (entrada/principal/sobremesa — campo da categoria, definido junto com o produto no Cardápio) e só mostra o grupo quando pelo menos um item já está pronto; grupo com tudo pronto ganha o botão **Liberar para o salão** (marca todos como entregue de uma vez — mesmo UPDATE em lote que o "ticket inteiro" do KDS já fazia); grupo com só parte pronta mostra "esperando o resto" com o tempo que cada item pronto já está esperando. |
| **Atendimento (Salão)** — aviso de pronto | Mesa com item marcado **PRONTO** pela cozinha pisca um destaque amarelo no mapa de mesas, e a tela da comanda mostra um aviso "pronto para servir" — sem precisar recarregar (via Realtime). |
| **Atendimento (Salão)** — pedido pelo QR e delivery | Botões **Delivery** (escolhe cliente, endereço/bairro com taxa sugerida, agenda horário) e card de **pedidos pelo QR da mesa** aguardando confirmação do garçom (aceitar lança os itens na cozinha; rejeitar descarta) — nunca vai direto pra cozinha sem um humano aprovar. |
| **Caixa** | Terminal com nome configurável (lembrado neste dispositivo) — dois terminais com caixa aberto ao mesmo tempo fecham cada um só as próprias vendas. Abrir sessão com saldo inicial, registrar sangria/suprimento, ver movimentos da sessão. Fechamento é por **conferência cega calculada no servidor**: o client nunca recebe o esperado antes de mandar o valor contado; diferença acima do limite configurado exige justificativa escrita. |
| **Cardápio** | CRUD de produtos (nome, categoria, preço, foto por URL, setor de produção, **tempo** — entrada/principal/sobremesa, usado pela Expedição, PRIORIDADE 6) e de categorias (criadas on-the-fly no formulário de produto — tempo é campo da categoria, então salvar qualquer produto dela atualiza o tempo de todos). Marcar produto como esgotado/reativado sem precisar editar o preço. Botão **Opções** por produto: grupos de perguntas/adicionais (ex: "Ponto da carne" obrigatório, "Adicionais" opcional até N), cada opção com preço próprio opcional — aparecem no lançamento do pedido, no KDS, no recibo e no cardápio público. |
| **Estoque (Estoque / Perdas)** | Duas sub-abas (ETAPA 0.11). **Estoque**: insumos com estoque atual/mínimo, validade e custo médio — **pode ficar negativo** (selo "Furo — investigar" em vermelho + alerta no topo, ETAPA 0.8) em vez de travar em zero; entrada/saída manual com motivo obrigatório; alerta de estoque baixo e de validade vencendo/vencida; botão **Fazer inventário** (contagem física de todos os insumos de uma vez, gera ajuste só no que divergir do sistema — diferença **negativa** também grava uma perda "não identificada", PRIORIDADE 3); botão **Sugerir pedido** nos itens abaixo do mínimo, pré-preenchendo um pedido de compra; botão **Rendimento** pra registrar o fator de perda medido de um insumo (ex: 85% depois de limpar/aparar) — entra direto na baixa automática por venda e no CMV dos relatórios (ETAPA 0.9); checkbox **produzida internamente (sub-receita)** (PRIORIDADE 2) libera os botões **Receita** (ficha técnica própria, insumo→insumo) e **Produzir lote**. **Perdas** (PRIORIDADE 3): botão **Registrar perda** (insumo ou prato pronto, motivo, quantidade — valor sempre calculado no servidor pelo custo médio/CMV); período (hoje/7d/30d/mês); KPIs de total perdido e % do faturamento; top 5 "onde o dinheiro está sumindo"; por motivo; por semana; lista dos registros recentes (inclusive os automáticos: item cancelado após preparo e diferença de inventário). |
| **Compras (4 sub-abas)** | PRIORIDADE 4. **Lista de compras**: sugestão automática por insumo (consumo real dos últimos 28 dias ÷ 28 × prazo de entrega do fornecedor padrão do insumo, cobrindo até o mínimo), agrupada por fornecedor — botão "Criar pedido" pré-preenche o pedido de compra de sempre. **Pedidos**: cadastro de fornecedores (nome, contato, telefone, prazo de entrega e dia de entrega) e pedidos de compra (Rascunho → Pedido realizado → Recebido) — receber abre uma **conferência** (quantidade/preço realmente recebidos, pré-preenchidos com o pedido mas editáveis; diferente do pedido vira registro na Auditoria) e é o recebido, não o pedido, que entra no estoque/custo médio. **Cotação**: compara até 3 fornecedores com preço digitado à mão lado a lado, destaca o menor preço por item, "Gerar pedidos" cria um pedido por fornecedor vencedor. **Preços**: histórico por insumo (alimentado em cada recebimento), alerta quando sobe mais que o limite configurado (Configurações), e quais pratos perderam margem com o aumento. |
| **Financeiro (Resumo / Contas)** | PRIORIDADE 7. **Resumo** (aba padrão): "Entrou · Saiu · Sobrou" do mês em linguagem simples, com as 5 linhas de "pra onde foi o dinheiro" (mercadoria/CMV, equipe, contas fixas, perdas, taxas de maquininha), comparação com o mês anterior, despesas fixas (aluguel, luz...) que lançam a conta do mês sozinhas, e o fluxo projetado dos próximos 30 dias (a receber − a pagar, acumulado) destacando a partir de quando o saldo fica negativo. **Contas**: a tela de sempre — contas a pagar e a receber (as de receber de fiado/débito/crédito/voucher são geradas automaticamente ao fechar uma conta, já líquidas da taxa da maquininha configurada), com status pago/pendente/vencido. Botão **Exportar pro contador**: baixa 3 CSVs do mês (vendas por forma, contas, fechamentos de caixa). |
| **Clientes** | CRM básico: nome, telefone, endereço/bairro (pra delivery), aniversário, observações, consentimento LGPD. Ficha do cliente mostra saldo de fiado em aberto, **pontos de fidelidade** e histórico de visitas. Cliente é opcional em qualquer pagamento (ganha pontos — padrão 1 ponto por R$1, configurável) e obrigatório no fiado (não é mais texto livre); pontos acumulados podem ser resgatados como desconto na hora de fechar a conta. |
| **Relatórios** | Três sub-abas (componente genérico de sub-abas, ETAPA 0.11 — dado busca só ao abrir a aba, link direto tipo `#relatorios/dre` abre nela). Aba **Vendas**: ranking de produtos e desempenho por garçom (por quem **lançou** o item), por período (hoje / 7 dias / 30 dias / escolher mês). Aba **Gestão**: CMV e margem por produto (alerta quando custo ≥ preço), relatório anti-fraude (cancelamentos e descontos por funcionário), taxa de serviço estimada por garçom, curva ABC, heatmap de vendas por dia×hora e taxas pagas às maquininhas. Aba **DRE mensal**: faturamento − CMV − despesas = resultado, por mês. Tudo agregado no banco — não carrega mais comandas/itens completos no navegador, e o total de cada venda é o valor travado no pagamento, não recalculado com a taxa de serviço atual. |
| **QR Codes das mesas** | Gera o QR de cada mesa cadastrada direto no navegador (biblioteca client-side, sem nenhum serviço externo), aponta pra `/cardapio/:slug?mesa=N&t=token` — o token (ETAPA 0.6) impede trocar o número da URL e abrir pedido em outra mesa. Imprimir individual, imprimir todas numa grade, baixar PNG, ou **Gerar novo QR** (invalida o impresso na hora). Dentro do grupo **Atendimento** no menu. |
| **Marketing** | Quatro sub-abas (mesmo componente genérico de Relatórios, ETAPA 0.11): **Campanhas** (PRIORIDADE 9 — o banco identifica sozinho quem avisar hoje: aniversariantes e reservas confirmadas, cada um com botão WhatsApp de mensagem pronta); **Cupons** (código, desconto percentual ou valor fixo, validade, limite de usos; ativar/desativar; contador de usos — aplicado direto na tela de pagamento do Caixa, empilha com desconto manual e pontos de fidelidade); **Clientes inativos** (busca por "sem comprar há N dias", com telefone e saldo de pontos, e botão WhatsApp pra reativação); **Banner do cardápio** (texto + produto em destaque, aparece no topo do `cardapio.html` público, visível a qualquer cliente que escaneie o QR). |
| **Equipe (5 sub-abas)** | PRIORIDADE 5. **Funcionários**: criar (nome, papel, senha de acesso + PIN operacional — independentes desde a VF-003, `0078`), ativar/desativar, botão **Credenciais** (troca senha e/ou PIN, cada um opcional), peso de rateio da taxa de serviço. **Escala**: turno/folga por dia da semana, por funcionário; aviso de quem está escalado hoje e ainda não bateu ponto. **Ponto**: entrada/saída/intervalo com PIN (controle interno — não substitui o registro oficial exigido pela legislação); correção só por GERENTE/ADMIN, com motivo e auditoria. **Desempenho**: vendas/ticket/cancelamentos por garçom, itens por hora trabalhada, tempo médio de preparo por setor da cozinha. **Custo** (só ADMIN, `admin.equipe.custos.ver`): salário/diária por funcionário, vales/adiantamentos, e o fechamento do período (horas, rateio da taxa de serviço, vales, líquido a pagar) — GERENTE tem `admin.equipe.editar` mas não acessa esta sub-aba. |
| **Auditoria** | Trilha de ações sensíveis (desconto aprovado, item cancelado, preço alterado, caixa fechado com diferença, PIN alterado, etc.), com quem fez e quando. |
| **Configurações** | Seis sub-abas (componente genérico da ETAPA 0.11): **Geral** (dados da empresa, horário de funcionamento), **Vendas e pagamento** (taxa de serviço, limites de desconto/diferença de caixa/sangria, taxas das maquininhas, fidelidade por pontos), **Metas e alertas** (metas da Central do Dono, alerta de preço de insumo, atraso por setor no KDS), **Atendimento** (couvert/happy hour, taxa de entrega por bairro, link do cardápio público — a tela QR Codes das mesas já gera o QR pronto pra imprimir, este link aqui é só pra referência/compartilhar manualmente —, carência de QR Code sem token da ETAPA 0.6), **Impressão** (largura da impressora, rodapé do recibo) e **Segurança** (verificação em duas etapas, ETAPA 0.7). Um único botão **Salvar configurações**, fora das sub-abas (sempre visível): cada clique só grava de novo os campos da aba aberta no momento — os das abas fechadas (fora do DOM) mantêm o valor que já estava salvo, nunca são apagados. Card **Conflitos de sincronização offline** (ETAPA 0.5, acima das sub-abas, só aparece quando tem pendência) — Aplicar mesmo assim ou Descartar. Card **Pendências de sincronização** (VF-002, `0075`+, mesmo lugar/permissão — pedido/pagamento/status offline que o servidor recusou de verdade) — Descartar ou Tentar de novo. Editar config, criar funcionário e trocar credenciais exigem o segundo fator (2FA) se a conta ADMIN tiver MFA ativo. |

### Cardápio público (`cardapio.html`)

Página HTML separada, sem login, acessível em `/cardapio/:slug` (rewrite
configurado em `vercel.json`, servido estaticamente igual ao app
principal) ou em `cardapio.html?slug=:slug`. Lê só nome, preço, categoria,
status de esgotado, foto e opções/adicionais dos produtos *ativos* — nunca
estoque, custo, funcionários ou vendas. Usa seu próprio script
(`assets/js/cardapio-publico.js`), com a mesma chave pública do Supabase,
mas via políticas de RLS específicas para o papel `anon`
(ver `0030_cardapio_publico_restaurante.sql`).

Sempre visível, com ou sem mesa (modo só-leitura pra quem só quer ver o
cardápio sem pedir):

- **Busca** (filtra por nome, em tempo real) e **navegação por categoria**
  (chips no topo que rolam até a seção — fica fixo no topo da tela ao
  rolar).
- **Banner opcional** (Fase 5/Marketing): texto + produto em destaque,
  configurado em Marketing → Banner do cardápio; some automaticamente se
  não tiver sido ativado.

**Pedido pelo QR da mesa (Fase 3.3, completo na Fase 5)**: link com
`?mesa=N` (o QR impresso em cada mesa — gerado na tela **QR Codes das
mesas** do app — já codifica isso) libera o carrinho de pedido:

- Produto **sem** nenhuma opção/adicional: botões `+`/`−` direto no card,
  igual uma loja comum.
- Produto **com** grupo de opção (obrigatório ou não — ex: "Ponto da
  carne", "Adicionais") abre um modal de escolha antes de entrar no
  carrinho, com a mesma validação de mínimo/máximo/obrigatoriedade que o
  app interno já usa pra qualquer lançamento de garçom
  (`trg_comanda_itens_calcula_preco`, `0051`/`0056`) — **nenhum produto
  fica de fora do autoatendimento**. Combinações diferentes de opções do
  mesmo produto (ex: "Picanha ao ponto" × "Picanha mal passada") viram
  linhas separadas no carrinho.
- Revisão do pedido antes de enviar: +/−/remover por linha, observação
  geral opcional, total recalculado na hora.
- O pedido cai em `restaurante.pedidos_qr`, status `PENDENTE`, **nunca**
  direto em `comanda_itens` — só vira item de cozinha de verdade quando um
  garçom confirma pela tela de Atendimento (card "Pedidos pelo QR da
  mesa", mostrando os itens **e** as opções escolhidas antes de aceitar).
  RPC `confirmar_pedido_qr` relê e revalida tudo do banco de novo nesse
  momento (preço, opções, produto ainda ativo/não esgotado) — nunca confia
  no que ficou gravado entre o pedido e a confirmação. anon não tem
  nenhuma policy de insert/select direto na tabela `pedidos_qr`, só a RPC
  `criar_pedido_qr` grava; no máximo 1 pedido pendente por mesa por vez
  (trava spam — só dá pra mandar outro depois do garçom confirmar ou
  rejeitar o anterior).
- **Por que ainda passa pelo garçom**: decisão deliberada, não limitação
  técnica — nenhum pedido vira produção/cobrança sem um humano conferir
  (produto esgotado na hora, erro de digitação do cliente, mesa errada).
  Tirar essa aprovação é uma mudança de risco real (ver
  [Pendências conhecidas](#pendências-conhecidas)), não foi pedida.

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

Cinco papéis — `ADMIN`, `GERENTE`, `CAIXA`, `GARCOM`, `COZINHA` — e 28
permissões no formato `modulo.recurso.acao` (ex:
`atendimento.comanda.item.cancelar`), cada uma concedida por papel numa
tabela de configuração (`papeis_permissoes`, semeada nas migrations, não é
dado de exemplo). Catálogo completo e matriz papel × permissão em
[`docs/rotas-permissoes.md`](docs/rotas-permissoes.md) (reescrito na
ETAPA 0, item 0.12, a partir do catálogo real — a versão anterior descrevia
uma arquitetura React que este app nunca usou).

Dois lugares guardam esse catálogo e precisam ficar em sincronia manual:
a tabela `papeis_permissoes` no banco (quem efetivamente bloqueia) e o
objeto `PERM`/`MATRIZ` em `assets/js/config.js` (usado só pra esconder
botões/telas que o usuário não pode usar — nunca é a trava real).

**Regra de ouro do sistema**: a UI esconder um botão é conveniência, não
segurança. Quem decide o que cada papel pode gravar é o Postgres — RLS e,
pras operações mais sensíveis (fechar conta, mexer em estoque, trocar PIN),
funções `SECURITY DEFINER` chamadas via RPC.

## Autenticação e segurança

### Senha de login e PIN operacional — separados (VF-003, `0078`)

Cada funcionário é uma conta real do Supabase Auth. **Até a `0078`, o PIN
de 4 caracteres ERA a senha real dessa conta** — achado P0 confirmado do
plano de auditoria (`docs/PLANO_DE_MELHORIAS.md`, VF-003): um PIN de 4
caracteres como senha de uma conta de verdade, combinado com VF-005
(e-mail de login legível por qualquer papel) e o bug do contador de
tentativas (VF-004), formava uma cadeia prática de escalonamento de
privilégio. Aprovado pelo Gustavo em 10/10/2026 ("separar PIN de senha"),
agora são dois segredos independentes:

- **Senha de acesso** (login diário, `tentarLogin` →
  `signInWithPassword`, mesmo mecanismo de sempre) — 8+ caracteres,
  definida por `criar_funcionario`/`trocar_credenciais_funcionario` via
  Admin API do GoTrue (chave de serviço no Vault, nunca exposta ao
  navegador).
- **PIN operacional** (4 caracteres, letras e números — autorização de
  supervisor, bater ponto) — hash local em `usuarios.pin_hash`
  (`pgcrypto`, `crypt()`/`gen_salt('bf')`, mesmo algoritmo — bcrypt —
  que o próprio Auth usa internamente). `verificar_pin_supervisor`/
  `bater_ponto` conferem contra esse hash **sem nenhuma chamada HTTP pro
  Auth** — mais simples e mais rápido que o mecanismo antigo
  (login-e-logout contra `/auth/v1/token` a cada autorização).

**Migração sem interromper o expediente**: toda conta já existente teve
o PIN atual copiado pra `pin_hash` automaticamente (`auth.users.
encrypted_password`, que já é bcrypt, copiado direto — zero
recálculo) — ninguém perdeu acesso nem precisou trocar nada no primeiro
dia. A senha de login de cada funcionário continua sendo o PIN antigo
até um ADMIN/GERENTE trocar pela tela Equipe (botão **Credenciais** —
senha e PIN são campos independentes e opcionais ali, dá pra trocar um
sem mexer no outro).

Login continua pedindo primeiro o **código do restaurante** (slug, igual
ao usado no cardápio público — URL `?r=slug` ou salvo em `localStorage`),
que resolve a lista de usuários via
`restaurante.usuarios_login_por_empresa(slug)` — antes disso era uma view
(`usuarios_login`) aberta pra `anon` **sem filtro de empresa nenhum**,
listando funcionário de toda empresa que compartilha este projeto
Supabase. O e-mail de login deixou de ser derivado do nome
(`nome@fogo.internal` — acento sumia, nome duplicado colidia, renomear
quebrava o login); agora é um UUID aleatório + domínio da própria empresa
(`<uuid>@<slug>.internal`), gravado em `usuarios.email_interno` e nunca
mais recalculado a partir do nome. Funcionários criados antes dessa
mudança foram migrados automaticamente (`0044`). `email_interno` não é
mais legível por `select` direto de nenhum papel desde a `0077` (VF-005).

O JWT emitido no login carrega `empresa_id` e `papel` via um *Custom
Access Token Hook* (`restaurante.custom_access_token_hook`,
`SECURITY DEFINER`) — é esse claim que toda policy de RLS usa pra isolar
dados por empresa e por papel.

### Autorização de supervisor (desconto acima do limite, cancelar item)

Antes, o client testava o PIN digitado contra **todas** as contas com a
permissão necessária (um `signInWithPassword` por candidato) e a escrita
final rodava com a sessão de quem estava logado — que o trigger de coluna
(abaixo) sempre bloqueou pra GARCOM/CAIXA, então esses papéis nunca
conseguiam de fato cancelar item nem aplicar desconto, mesmo com PIN
correto. Agora o garçom escolhe **um** supervisor (não testa vários) e as
RPCs `restaurante.cancelar_item(...)` / `restaurante.aplicar_desconto(...)`
verificam o PIN dele contra o hash local (`usuarios.pin_hash`, ver seção
acima — desde a `0078`, nenhuma chamada ao Auth), conferem a permissão,
aplicam a escrita e gravam auditoria — tudo atômico. Tentativas falhas
por supervisor ficam em `tentativas_autorizacao`: uma RPC própria
(`registrar_tentativa_pin`, `0075`) registra a tentativa **antes** da
verificação, numa transação separada que sempre commita — o bloqueio de
5 falhas/5min só passou a funcionar de verdade a partir daí (antes, o
`INSERT` da tentativa rodava na mesma transação que a exceção do PIN
errado, e Postgres desfazia os dois juntos). Desconto dentro do limite
continua sem pedir supervisor pra quem já tem a permissão (mesmo
comportamento de sempre); cancelar item sempre pede, mesmo pra ADMIN.

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

- PIN de 4 caracteres é curto por natureza (mesmo agora aceitando letras e
  números, não só os 10 mil dígitos de antes) — **mas desde a `0078` não
  é mais a senha de nenhuma conta do Supabase Auth** (VF-003, corrigido):
  é um segredo próprio, com hash local (`usuarios.pin_hash`), só pra
  autorização de supervisor e bater ponto. A senha de login de verdade
  (8+ caracteres) é outro campo, trocado independentemente. O app
  bloqueia por 30s após 5 tentativas erradas na própria UI, e as RPCs de
  supervisor têm seu próprio limite (5 tentativas / 5 min por
  supervisor, tabela `tentativas_autorizacao`, **corrigido na `0075`** —
  até então o `INSERT` da tentativa rodava na mesma transação que o
  `raise exception` do PIN errado, e Postgres desfazia os dois juntos: o
  contador nunca acumulava de verdade, VF-004 do plano de auditoria).
  Rate limit/CAPTCHA do próprio Supabase Auth (**Auth → Rate Limits** no
  painel) continua valendo só pra tentativa de LOGIN (senha), não pro
  PIN — que agora nem passa pelo Auth.
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

- **Núcleo**: `empresas` (com `slug`, agora com trigger de auditoria **e**
  de 2FA obrigatório pra editar config quando o ADMIN tem MFA, `0064`),
  `usuarios` (com `email_interno`, estável — não é mais derivado do nome
  —, trigger de 2FA pra ativar/desativar/trocar papel, `0064`),
  `papeis_permissoes`, `auditoria`, `tentativas_autorizacao` (rate limit
  das RPCs de supervisor, sem policy pro client), `erros_cliente` (log
  técnico de erro do front-end — `window.onerror`/falha de RPC/promise
  rejeitada, 20/min por usuário, sem policy de select pro client, `0064`).
- **Cardápio/estoque**: `categorias` (com `tempo`, `0071`), `produtos` (com `setor_producao`,
  `foto_url`), `insumos` (com `eh_sub_receita`, `0066`, e
  `fornecedor_padrao_id`, `0069`), `ficha_tecnica`,
  `ficha_tecnica_insumo` (receita de sub-receita, insumo→insumo, `0066`),
  `estoque_movimentos` (estoque pode ficar negativo desde `0064`),
  `insumo_rendimentos` (agora entra de verdade na baixa de estoque e no
  CMV, `0064`), `pre_preparo_checklist` (checklist diário de pré-preparo,
  `0066`), `perdas` (insumo ou prato, valor pelo custo médio/CMV, `0067`).
- **Atendimento**: `mesas` (com `qr_token`, `0064`), `comandas` (tipo
  `MESA`/`BALCAO`/`FICHA`, `ficha_numero`, `dia_operacional`,
  `total_centavos` acumulado a cada pagamento — parcial ou não,
  `taxa_servico_centavos` idem, `0070`, `updated_at`), `comanda_itens`
  (com `setor_producao`, `motivo_cancelamento`, `pago_em` — nulo até o
  item entrar num pagamento, parcial ou não —, `opcoes_selecionadas`
  jsonb, `estoque_baixado_em` — trava contra baixar o mesmo item duas
  vezes, `0064` —, e `iniciado_em`/`pronto_em`/`entregue_em`, gravados
  sozinhos por um trigger quando o status muda, `0070`),
  `venda_movimentacoes` (log de transferência/junção de mesa, `0027`,
  gravado só pelas RPCs `transferir_item`/`transferir_comanda`/
  `juntar_comandas`, `0048`), `sync_conflitos` (pagamento offline em
  conflito aguardando decisão de GERENTE/ADMIN, `0064`).
- **Equipe** (`0070`): `usuarios` com `peso_rateio_taxa` (multiplicador
  do rateio da taxa de serviço — não sensível, qualquer um com
  `admin.equipe.editar` edita), `escalas` (turno/folga semanal),
  `pontos` (entrada/saída/intervalo, com `corrigido`/`corrigido_por`/
  `motivo_correcao`), `funcionarios_remuneracao` (salário/diária — só
  `admin.equipe.custos.ver`, nunca em `usuarios`, que todo funcionário
  lê) e `vales_adiantamentos` (idem).
- **Cardápio — perguntas/adicionais** (`0051`): `grupos_opcoes` (por
  produto, obrigatório ou não, mínimo/máximo de escolhas),
  `opcoes` (dentro de um grupo, com preço adicional opcional),
  `opcao_ficha_tecnica` (baixa de estoque própria do adicional, mesma
  ideia de `ficha_tecnica` mas pra opção).
- **Caixa/pagamentos**: `caixa_sessoes` (`terminal` agora realmente usado
  — um terminal só enxerga/fecha a sessão aberta com o nome salvo no
  próprio dispositivo), `caixa_movimentos`, `pagamentos`.
- **Financeiro**: `contas` (com `despesa_recorrente_id`, `0072`),
  `despesas_recorrentes` (aluguel, luz... — lançam a conta do mês
  sozinhas, `0072`).
- **Compras**: `fornecedores` (com `prazo_entrega_dias`/`dia_entrega_semana`,
  `0069`), `pedidos_compra`, `pedidos_compra_itens` (com
  `quantidade_recebida`/`preco_unit_recebido_centavos`, `0069`),
  `historico_precos_insumo` (preço de cada recebimento, só gravável pela
  RPC de recebimento, `0069`).
- **Clientes** (`0055`): `clientes` (CRM — nome, telefone, endereço/bairro,
  aniversário, LGPD, `pontos_fidelidade`); `comandas.cliente_id` e
  `contas.cliente_id` vinculam venda e fiado a um cliente de verdade.
- **Reservas/fila** (`0073`): `reservas` (nome/telefone/pessoas/data_hora/
  mesa sugerida, status aguardando/confirmada/sentado/não veio) e
  `fila_espera` (walk-in, status aguardando/chamado/sentado/desistiu) —
  sem policy de insert/update, só pelas RPCs (`criar_reserva`,
  `sentar_reserva`, `entrar_fila`, `sentar_fila`...); "sentar" cria a
  comanda (tipo MESA) e grava `comanda_id`/`cliente_id` na reserva/fila de
  origem.
- **Pedido pelo QR da mesa** (`0059`, opções na `0063`): `pedidos_qr`
  (fila de aprovação do garçom — nunca escrito direto em `comanda_itens`).
- **Marketing** (`0062`): `cupons` (código único por empresa, percentual
  ou valor fixo, validade, limite de usos); banner do cardápio público
  fica em `empresas.config.marketing`, nunca numa tabela própria.
- **Cardápio público**: view `cardapio_publico_empresa` (nome, slug e os
  3 campos seguros do banner — nunca o `config` inteiro) + policies
  `*_select_publico` (`to anon`) em `produtos`/`categorias`/`grupos_opcoes`/`opcoes`.

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
e adicionam a função de onboarding de novo restaurante (`0061`). As
migrations `0062` e `0063` (Fase 5 — menu em grupos, QR Codes das mesas e
Marketing) adicionam: cupons de desconto, relatório de clientes inativos e
banner do cardápio público (`0062`), e opções/adicionais no pedido pelo QR
da mesa — removendo a restrição que deixava produto com opção obrigatória
fora do autoatendimento (`0063`). Menu em grupos e a tela QR Codes das
mesas são só front-end, sem migration própria. A migration `0064`
(ETAPA 0 — correções de erros reais + base de sub-abas) reescreve
`confirmar_pagamento` com um cálculo de total compartilhado com o preview
do modal (acabando com a cobrança a mais no cartão quando tinha cupom/
pontos), desconto empilhado acima do limite exigindo supervisor, baixa de
estoque por pagamento parcial sem duplicar, rendimento entrando na baixa,
estoque podendo ficar negativo, token por mesa no QR Code, 2FA obrigatório
em operação sensível de ADMIN quando a conta tem MFA, LGPD no relatório de
clientes inativos, registro de erros do front-end e conflitos de
sincronização offline — ver [ETAPA 0](#etapa-0--correções-de-erros-reais-e-base-de-sub-abas-0064)
abaixo.

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
  (spam, pedido de brincadeira). Mitigado com 1 pedido pendente por mesa
  por vez (índice único em `pedidos_qr`) e confirmação obrigatória do
  garçom antes de qualquer coisa ir pra cozinha ou virar cobrança — não
  tem rate limit por IP/sessão além disso.
- **Status**: implementado e completo (Fase 5, migration `0063`) —
  inclusive produto com opção obrigatória, que ficou de fora até então.
  Ver [Cardápio público](#cardápio-público-cardapiohtml) acima pro
  funcionamento atual.

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

## ETAPA 0 — Correções de erros reais e base de sub-abas (0064)

Reúne 0.1 a 0.12 do roteiro de correções, todos implementados e em
produção. A maioria converge em `confirmar_pagamento` — reescrita uma vez
só, com cuidado, em vez de 5 migrations tocando a mesma função.

**0.1 — Cobrança a mais no cartão com cupom/pontos.** O modal de
pagamento calculava "valor cheio − desconto" no navegador, mas o servidor
sempre calculou a taxa de serviço sobre a base **já descontada** —
divergência que fazia o cartão cobrar mais do que `confirmar_pagamento`
de fato fechava. Corrigido extraindo o cálculo pra uma função interna só
(`calcular_totais_pagamento`), usada tanto por uma RPC nova de preview
(`calcular_total_pagamento`, que o modal chama a cada mudança — cliente,
pontos, cupom, modo, itens selecionados, com debounce de ~280ms) quanto
por `confirmar_pagamento`. Pagar a mais sem nenhuma linha em dinheiro
(sem pra onde ir o troco) agora é recusado.

**0.2 — Desconto empilhado sem teto.** Desconto manual + pontos + cupom,
somados, podiam passar longe do `limiteDescontoPct` configurado sem
ninguém aprovar nada (cada um isolado ficava dentro do limite). Agora
`confirmar_pagamento` calcula o percentual empilhado e exige PIN de
supervisor (mesma RPC `verificar_pin_supervisor` de `aplicar_desconto`,
0043) quando passa do limite — o modal já mostra o aviso antes de
confirmar.

**0.3 — LGPD no relatório de clientes inativos.** `relatorio_clientes_inativos`
(Marketing → Clientes inativos) agora só mostra telefone de quem tem
`consentimento_lgpd = true` — o cliente continua aparecendo na lista (pra
quem decide reativar saber quem é), só o contato vem vazio sem
consentimento.

**0.4 — Baixa de estoque no pagamento parcial.** Antes, a baixa por ficha
técnica só rodava quando a comanda fechava por completo — num pagamento
parcial (dividir por item), o item pago agora baixa o estoque na hora,
não só quando o último item da comanda for pago. `comanda_itens.estoque_baixado_em`
trava contra baixar o mesmo item duas vezes se a função rodar de novo
pro resto da comanda depois.

**0.5 — Conflito de sincronização offline.** Pagamento em dinheiro feito
sem internet guarda o `comandas.updated_at` de quando foi enfileirado; se
a comanda mudou noutro terminal antes de sincronizar de verdade, o
servidor não aplica o pagamento — grava em `sync_conflitos` pra um
GERENTE/ADMIN decidir (card em Configurações: "Aplicar mesmo assim" ou
"Descartar", ambos com auditoria).

**0.6 — QR Code por mesa com token.** `mesas.qr_token` (UUID aleatório)
entra na URL do QR (`?mesa=N&t=token`) — trocar só o número na URL não
abre mais pedido em outra mesa. Botão **Gerar novo QR** por mesa (tela QR
Codes das Mesas) invalida o QR impresso na hora. QR impresso antes desta
fase (sem token) continua aceito até a data em
`config.aceitarQrSemTokenAte` (30 dias da migration por padrão,
editável/removível em Configurações pra desligar mais cedo).

**0.7 — 2FA obrigatório em operação sensível de ADMIN.** Criar
funcionário, trocar PIN, ativar/desativar funcionário, editar
Configurações e exportar pro contador agora exigem `aal2` (segundo fator
confirmado) **quando a conta logada tem MFA cadastrado** — sem MFA, nada
muda. `restaurante.exige_aal2_se_mfa_ativo()` checa `auth.mfa_factors`
direto (não só o claim do JWT, que pode estar desatualizado se o MFA foi
ativado depois do login). Funcionário/Configurações são escritos direto
pelo client (não RPC) — cobertos por trigger `BEFORE UPDATE` em
`usuarios`/`empresas` em vez de converter as telas inteiras pra RPC.

**0.8 — [DECISÃO TOMADA] Estoque pode ficar negativo.** `greatest(0, ...)`
removido de toda baixa de estoque (venda, saída manual). Insumo com
estoque negativo mostra o número em vermelho e o selo **"Furo —
investigar"** na tela Estoque, com um alerta próprio no topo — em vez de
esconder a diferença travando em zero.

**0.9 — [DECISÃO TOMADA] Rendimento entra na baixa.** Ficha técnica
continua cadastrada em peso limpo; a baixa de estoque agora é
`ficha_tecnica.quantidade ÷ rendimento mais recente do insumo`
(`insumo_rendimentos`, sem medição = fator 1, sem mudança de
comportamento pra quem nunca mediu nada). CMV (Relatórios → Gestão e DRE)
usa o mesmo custo corrigido.

**0.10 — Registro de erros do front-end.** `window.onerror`,
`unhandledrejection` e toda falha de RPC (interceptada uma vez só, no
`sb.rpc` — não precisou tocar nos ~40 call sites espalhados pelo app)
gravam em `restaurante.erros_cliente` (tela, mensagem, stack resumida,
versão) via `registrar_erro_cliente`, limitado a 20/min por usuário.
Nunca grava PIN, token ou dado de pagamento — só o que esses três gatilhos
já expõem. Sem policy de SELECT pro client (log técnico, não dado de
produto).

**0.11 — Componente de sub-abas.** `renderSubAbas(tela)` genérico — aba
sem permissão não aparece, dado busca só ao abrir a aba pela primeira vez
(nunca em `carregarTudo`), estado também fica na URL (`#relatorios/dre`
abre direto naquela aba). Relatórios e Marketing migrados pra ele.

**0.12 — `docs/rotas-permissoes.md` reescrito** a partir do catálogo real
(`papeis_permissoes`) — a versão anterior descrevia uma arquitetura React
que este app nunca usou.

## PRIORIDADE 1 — Central do Dono (0065)

Tela nova, primeira depois do login pra quem tem `admin.central_dono.ver`
(ADMIN e GERENTE — GARCOM/CAIXA/COZINHA continuam caindo em Salão/KDS como
antes). Uma RPC só (`restaurante.central_do_dono()`, sem parâmetro — ela
mesma calcula "hoje" e "o mês" a partir de `empresas.timezone` +
`virada_dia_operacional_hora`, nunca do relógio do navegador), agregada
inteiramente no banco: a tela nunca baixa comandas/itens pra somar no
JavaScript, só formata o que a RPC já devolve pronto.

- **Hoje até agora**: faturamento, nº de vendas e ticket médio, cada um
  comparado com a mesma janela de horário do mesmo dia da semana passada
  (seta verde/vermelha + %), mais a **projeção de fechamento do dia** —
  pega o "ritmo" das últimas 4 semanas (quanto o dia inteiro costumava
  faturar frente ao que já tinha faturado até este mesmo ponto) e aplica
  no que já foi vendido hoje.
- **Sobrou no mês**: faturamento − CMV (mesmo cálculo corrigido por
  rendimento da ETAPA 0.9) − perdas − despesas lançadas = resultado
  estimado, com "quanto falta pra cobrir as contas do mês" (contas a
  pagar pendentes do mês menos o resultado já acumulado). **Só ADMIN vê
  este bloco** — pra GERENTE a RPC devolve `resultado_centavos: null` de
  propósito (decidido no servidor, nunca só escondido no front, pela
  mesma regra de ouro de permissões do resto do sistema). Custo de equipe
  entra como 0/indisponível até a Prioridade 5 existir de verdade.
- **Semáforos** (verde/amarelo/vermelho): CMV %, perdas % do faturamento,
  diferença de caixa acumulada no mês — contra metas configuráveis em
  Configurações → "Metas da Central do Dono" (`config.metasCentralDono`).
  Custo de equipe aparece cinza/indisponível pelo mesmo motivo do bloco
  anterior.
- **Precisa da sua atenção** (até 5, por gravidade, cada um levando pra
  tela certa): estoque negativo, conta a pagar vencendo hoje/atrasada,
  diferença no último fechamento de caixa acima do limite configurado,
  conflito de sincronização offline pendente (ETAPA 0.5), cancelamentos
  de hoje acima da média dos últimos 7 dias.
- **Agora no salão**: mesas ocupadas, pedidos atrasados na cozinha (mesmo
  limite por setor de Configurações), caixa aberto/fechado.
- Atualiza sozinha a cada 60s enquanto a tela estiver aberta, e de
  imediato quando o Realtime avisa de uma comanda que acabou de virar
  `PAGA` — sem precisar recarregar a página.

**O que ficou de fora de propósito** (precisa de dado que ainda não
existe): "validade vencendo" e "insumo que ficou mais caro" não entraram
nos alertas — não existe hoje controle de validade/lote por insumo nem
histórico de preço de compra (isso é a Prioridade 4). "Perdas" por ora é
uma aproximação pelo valor das saídas manuais de estoque (`estoque_movimentos`
tipo `SAIDA`) a custo médio — ainda não existe registro estruturado de
perda com motivo (Prioridade 3); quando essa tabela existir, a RPC deve
trocar pra ela em vez desta aproximação.

## PRIORIDADE 2 — Produção / Pré-preparo (0066)

Cozinha ganhou uma segunda sub-aba, **Produção** (mesmo componente
genérico da ETAPA 0.11 — `cozinha.kds.ver` dá acesso às duas abas, "Produzir
lote" exige `admin.estoque.editar` por afetar estoque/custo de verdade).

- **Lista de pré-preparo do dia**: `restaurante.abrir_checklist_pre_preparo(p_ajuste_pct)`
  calcula, pra cada insumo que aparece em alguma ficha técnica de produto,
  a média vendida nos últimos 4 mesmos-dias-da-semana (ex: 4 sextas
  anteriores) × ficha técnica ÷ rendimento do insumo (mesma régua da
  ETAPA 0.9) — cobre tanto "porcionar 6kg de picanha" (insumo direto)
  quanto "fazer 3kg de vinagrete" (sub-receita, que também é só um insumo
  usado em algum produto — não precisou resolver árvore de receita
  aninhada). Essas linhas **persistem** por dia operacional
  (`pre_preparo_checklist`) — reabrir a aba no mesmo dia não recalcula do
  zero, só lê o que já tem. Campo de ajuste % (feriado, evento) recalcula
  de novo, mas só as linhas **ainda não marcadas feitas**.
- **Marcar feito**: grava quem e quando (`marcar_pre_preparo_feito`),
  sobrevive a recarregar a página — dá histórico de "o que foi preparado
  todo dia".
- **Sub-receita** [DECISÃO TOMADA NA CONVERSA]: é um **insumo normal**
  com a flag `insumos.eh_sub_receita` — não uma tabela separada, reusa
  toda a tela de Estoque (nome, unidade, estoque, custo médio). Ganha uma
  ficha técnica própria (`ficha_tecnica_insumo`, insumo→insumo — mesmo
  formato de `ficha_tecnica`, só que ingrediente também é insumo) editável
  em Estoque → botão **Receita** (troca a lista inteira de uma vez, mesmo
  padrão simples usado em listas pequenas do app).
- **Produzir lote** (`restaurante.produzir_lote_sub_receita`): baixa cada
  ingrediente da receita (÷ rendimento mais recente, 0.9), dá entrada no
  insumo produzido com **custo médio ponderado** (mesma fórmula já usada
  no recebimento de pedido de compra, `0040`) e devolve tudo que a
  **etiqueta de manipulação** precisa (produto, quantidade, data de
  produção, validade do lote — digitada na hora, não existe validade
  padrão por insumo — e responsável) pra imprimir na hora, sem outra
  consulta. Estoque pode ficar negativo (0.8): não trava se faltar
  ingrediente de verdade.
- Pronto quando: numa sexta a lista sugere quantidades baseadas nas 4
  sextas anteriores; produzir 5kg de vinagrete baixa os ingredientes, dá
  entrada no estoque (com custo médio recalculado) e imprime a etiqueta.

**Nota pra decisão futura**: hoje só ADMIN/GERENTE (`admin.estoque.editar`)
produzem um lote — COZINHA só marca o checklist como feito, mesma régua
de permissão que todo o resto do estoque já usa (COZINHA nunca teve
`admin.estoque.editar`). Se o fluxo real de cozinha precisar que o próprio
cozinheiro registre a produção sem depender de um gerente, isso é uma
mudança na matriz de permissões (`papeis_permissoes`/`MATRIZ`), não nesta
RPC — avise se for esse o caso.

## PRIORIDADE 3 — Perdas e Desperdícios (0067)

Estoque ganhou uma segunda sub-aba, **Perdas** (mesmo componente genérico
da ETAPA 0.11, mesma permissão `admin.estoque.editar` da aba Estoque — não
criou permissão nova).

- **Registrar perda** (`restaurante.registrar_perda`): insumo (ex: "2kg de
  picanha vencida") OU prato pronto (ex: "sobra do dia"), com motivo
  (venceu, estragou, queimou, caiu, devolvido, erro de pedido, sobra),
  quantidade e responsável (o usuário logado). **Valor sempre calculado
  no servidor** — insumo pelo custo médio, prato pelo CMV (ficha técnica
  ÷ rendimento × custo médio, mesma fórmula de `relatorio_dre`/`relatorio_gestao`/
  Central do Dono) — nunca mandado pelo client.
- **Automática ao cancelar item já em preparo** (`cancelar_item`, 0043):
  motivo `CANCELADO_APOS_PREPARO`. [DECISÃO DE DESIGN — ver comentário no
  topo da migration `0067`] Esse é o ÚNICO caso em que uma perda de prato
  também baixa o estoque do ingrediente — o item cancelado nunca vai ser
  pago, e a baixa deste app só acontece no pagamento, então sem baixar
  aqui o ingrediente que já saiu de verdade da cozinha ficaria contado
  como se ainda estivesse no estoque pra sempre. Perda manual de prato
  **não** baixa estoque (não dá pra saber se aquele prato específico já
  passou por uma venda paga ou não — baixaria duas vezes ou nenhuma).
- **Automática no inventário** (`registrar_inventario`, 0054): diferença
  **negativa** (contado menor que o sistema) grava "perda não
  identificada" (`AJUSTE_INVENTARIO`). Sobra (contado maior) não é perda.
- **Relatório** (`restaurante.relatorio_perdas`, agregado no banco): total
  perdido no período, % do faturamento, por motivo, por semana, e top 5
  "onde o dinheiro está sumindo" (insumo + prato juntos, por valor).
- **Central do Dono** (0065) parou de aproximar perdas pelas saídas
  manuais de estoque — agora soma direto de `perdas`, o dado de verdade.
- Pronto quando: registro 2kg de picanha vencida e a Central do Dono
  mostra o valor no bloco de perdas.

## PRIORIDADE 4 — Compras Inteligentes (0069)

Compras ganhou 4 sub-abas (mesmo componente da ETAPA 0.11), todas sob
`admin.estoque.editar` (não criou permissão nova).

- **Lista de compras** (`restaurante.lista_compras_sugerida`): pra cada
  insumo, consumo médio diário = (vendas dos últimos 28 dias × ficha
  técnica ÷ rendimento) ÷ 28; consumo previsto até a próxima entrega =
  consumo médio × prazo de entrega do fornecedor padrão do insumo (ou 7
  dias, sem fornecedor padrão); sugestão = estoque mínimo + previsto −
  estoque atual. Agrupado por fornecedor — insumo sem fornecedor padrão
  cai num grupo "sem fornecedor definido". [DECISÃO DE DESIGN] Não
  existia "qual fornecedor fornece qual insumo" em lugar nenhum do
  schema; adicionei `insumos.fornecedor_padrao_id` (um fornecedor
  preferencial por insumo, editável direto na tela Estoque) em vez de
  inventar uma tabela pivot que o roteiro não pediu.
- **Pedidos**: a tela de sempre (fornecedores + pedidos de compra), com
  fornecedor agora editável (não só criar) e dois campos novos —
  **prazo de entrega** e **dia de entrega** (exatamente como o roteiro
  pediu, "campos novos em fornecedores"). Receber um pedido abre uma
  **conferência**: quantidade e preço pré-preenchidos com o que foi
  pedido, mas editáveis pro que chegou de verdade — diferente do pedido
  vira registro em Auditoria (`DIVERGENCIA_RECEBIMENTO`, sem tabela nova
  só pra isso), e é o **recebido** (não o pedido) que entra no estoque e
  no custo médio ponderado.
- **Cotação**: compara até 3 fornecedores com preço **digitado à mão**
  lado a lado (botão "Importar da lista de compras" traz os itens
  sugeridos com a quantidade já preenchida — "mesma lista" do roteiro),
  destaca o menor preço por linha, e "Gerar pedidos" cria um pedido de
  compra por fornecedor vencedor (reaproveita `criar_pedido_compra`,
  0040 — cotação não tem RPC nem tabela própria, é comparação 100% do
  client, preço final nunca calculado, sempre digitado).
- **Preços** (`restaurante.relatorio_precos_insumo`): histórico por
  insumo alimentado em cada recebimento (`historico_precos_insumo`, só
  gravável pela RPC de recebimento); alerta quando o preço sobe mais que
  o limite configurado (Configurações → "Compras — alerta de preço",
  10% por padrão) frente ao recebimento anterior; pra insumo em alerta,
  lista os pratos que usam ele na ficha técnica com o impacto por
  unidade vendida (ficha técnica ÷ rendimento × diferença de preço).
- Pronto quando: a lista sugere quanto comprar de cada insumo até a
  próxima entrega, e receber picanha 15% mais cara mostra quais pratos
  perderam margem.

## PRIORIDADE 5 — Controle de Equipe (0070)

Equipe ganhou 5 sub-abas. Permissão nova: `admin.equipe.custos.ver` (só
ADMIN) — GERENTE continua com `admin.equipe.editar` (funcionário, PIN,
escala, ponto, desempenho) mas **não** acessa a sub-aba Custo.

- **Funcionários**: a tela de sempre, mais o **peso de rateio** da taxa
  de serviço por funcionário (não sensível — qualquer um com
  `admin.equipe.editar` edita).
- **Escala**: turno/folga por dia da semana, por funcionário
  (`restaurante.salvar_escala`, troca a semana inteira de uma vez — mesmo
  padrão simples de lista pequena editada por inteiro). Avisa quem está
  escalado hoje e ainda não bateu ponto (`restaurante.escala_hoje`).
- **Ponto**: entrada/saída/intervalo com PIN — texto fixo "controle
  interno — não substitui o registro de ponto oficial exigido pela
  legislação". `restaurante.bater_ponto` confere a identidade de quem
  está batendo com o MESMO mecanismo de `verificar_pin_supervisor`
  (0043/0060 — login real via GoTrue, logout imediato, sem exigir
  nenhuma permissão de quem bate: o PIN já é a prova); qualquer um
  logado pode bater o próprio PIN ou o de um colega. Correção
  (`restaurante.corrigir_ponto`) só por GERENTE/ADMIN, com motivo e
  auditoria.
- **Desempenho**: vendas/ticket/cancelamentos por garçom, itens por hora
  trabalhada (horas calculadas a partir dos pares de ponto do período) e
  tempo médio de preparo por setor da cozinha — usa
  `comanda_itens.iniciado_em`/`pronto_em` (novos, `0070`), gravados
  sozinhos por um trigger (`trg_comanda_itens_timestamps`) quando o
  status do item muda, sem precisar tocar nos 3 lugares que hoje
  escrevem status direto na tabela (KDS online, ticket inteiro, fila
  offline).
- **Custo** (só ADMIN): salário/diária por funcionário
  (`funcionarios_remuneracao`, nunca em `usuarios` — essa tabela é lida
  por **todo** funcionário da empresa, então salário não podia morar
  ali) e vales/adiantamentos (`vales_adiantamentos`). O **fechamento do
  período** (`restaurante.relatorio_fechamento_equipe`) mostra horas,
  rateio da taxa de serviço e vales pra **todo mundo com
  admin.equipe.editar** (GERENTE incluído — não é dado de remuneração),
  mas remuneração base e líquido a pagar só aparecem pra ADMIN (viram
  `null` no JSON, decidido no servidor — mesma régua de `resultado_centavos`
  na Central do Dono).
- **"10% da taxa de serviço rateado"** [DECISÃO DE DESIGN]: não é mais
  100% receita da casa — `comandas.taxa_servico_centavos` (novo, gravado
  por `confirmar_pagamento`) guarda o que foi cobrado de taxa em cada
  comanda, e o fechamento distribui o total do período entre os
  funcionários ativos, **igualitário** ou **por peso de função**
  (`empresas.config.rateioTaxaServico`, configurável).
- **Central do Dono** (0065/0067) parava de deixar custo de equipe em
  0/indisponível — agora soma remuneração proporcional ao mês (mensal
  cheio, diária × dias com ponto de entrada) + rateio da taxa do mês.
  Valor em R$ e % só aparecem pra ADMIN (mesma régua do resultado).
- Pronto quando: o fechamento da quinzena mostra horas, rateio da taxa e
  vales de cada um, e a Central do Dono mostra custo de equipe %.

## PRIORIDADE 6 — Expedição da Cozinha (0071)

A mais leve das prioridades até aqui — quase tudo já existia. Cozinha
ganhou uma terceira sub-aba, **Expedição**, sem permissão nova
(`cozinha.kds.ver`, mesma do KDS).

- **"Tempo" do item** [DECISÃO DE DESIGN]: entrada/principal/sobremesa é
  campo de **categoria** (`categorias.tempo`, `0071`), exatamente como o
  roteiro pediu ("campo na categoria") — não de produto. Como categoria
  nunca teve tela própria (sempre foi criada/editada on-the-fly no
  formulário de produto, desde sempre), o campo novo entrou ali: salvar
  qualquer produto de uma categoria atualiza o tempo dela pra todo mundo
  que a usa. Migration faz um backfill simples por nome ("Entradas" →
  `ENTRADA`, "Sobremesas" → `SOBREMESA`) — o resto, inclusive "Bebidas",
  fica em `PRINCIPAL` por padrão (o roteiro só pediu 3 valores).
- **Expedição**: agrupa os itens ativos de cada comanda por (comanda,
  tempo) — só aparece na tela quando pelo menos um item do grupo já está
  **PRONTO**. Grupo com **todos** prontos ganha o botão **Liberar para o
  salão**; grupo com só parte pronta mostra "esperando o resto" com
  quanto tempo cada item pronto já está esperando (usa
  `comanda_itens.pronto_em`, que a 0070 já passou a gravar sozinha).
- **Nenhuma RPC nova**: "liberar" é o mesmo UPDATE em lote que o botão
  "ticket inteiro" do KDS já fazia (`kdsAvancarTicket`, reaproveitado
  direto) — RLS de `cozinha.item.atualizar_status` já cobre, e o aviso
  de "mesa com item pronto" (realtime) já existia.
- Pronto quando: picanha pronta e salada ainda em preparo da mesma mesa
  não aparecem como "liberar" até a salada ficar pronta.

## PRIORIDADE 7 — Financeiro simples para o dono (0072)

Financeiro ganhou 2 sub-abas — **Resumo** (nova, virou a aba padrão) e
**Contas** (tela de sempre). Mesma permissão de sempre
(`admin.financeiro.ver` pra ver, `admin.financeiro.editar` pra despesa
fixa) — nenhuma permissão nova.

- **Entrou · Saiu · Sobrou**: `restaurante.relatorio_financeiro_resumo`
  reaproveita a MESMA lógica de `relatorio_dre` (CMV, 0064) e
  `central_do_dono` (perdas/custo de equipe, 0070) em vez de duplicar
  cálculo — "entrou" é o faturamento do mês, "saiu" é a soma das 5 linhas
  de "pra onde foi o dinheiro" (mercadoria/CMV, equipe, contas fixas,
  perdas, **taxas de maquininha** — essa última reaproveita a mesma
  consulta de `relatorio_taxas_maquininha`, 0053), "sobrou" é a
  diferença — sempre bate exatamente, nunca sobra um valor escondido fora
  das 5 linhas.
- **Despesas recorrentes** (`despesas_recorrentes`, novo cadastro):
  aluguel, luz, contador... com dia de vencimento fixo. A conta do mês
  (`contas`, tipo `PAGAR`) é lançada sozinha por
  `restaurante.gerar_despesas_recorrentes_do_mes`, chamada ao abrir a aba
  Resumo — idempotente por um índice único em (despesa recorrente, mês),
  não por controle manual: rodar de novo no mesmo mês não duplica.
- **Comparação com o mês anterior**: mesmos 3 números (entrou/saiu/sobrou)
  do mês passado, só pra comparação — não reabre o detalhe por linha.
- **Fluxo projetado — próximos 30 dias**: a receber − a pagar de cada dia
  (contas ainda não pagas, pelo vencimento), acumulado a partir de hoje —
  destaca a partir de qual dia o saldo projetado fica negativo.
- Pronto quando: sem saber contabilidade, consigo responder "quanto
  sobrou este mês e por quê".

## PRIORIDADE 8 — Reservas / Fila de espera (0073)

Salão (Atendimento) ganhou sub-abas (mesmo componente da 0.11): **Mapa de
mesas** (tela de sempre, agora mostra a mesa reservada nas próximas 2h) e
**Reservas e fila** (nova). Nenhuma permissão nova — `atendimento.salao.ver`
pra ver, `atendimento.comanda.abrir` pra criar/confirmar/sentar.

- **[DECISÃO DE DESIGN] Reserva e fila viram tabelas separadas**
  (`reservas`, `fila_espera`), não uma tabela só com "tipo": os status são
  de verdade diferentes (reserva tem CONFIRMADA/NAO_VEIO, fila tem
  CHAMADO/DESISTIU) e reserva tem `data_hora` agendada enquanto fila é só
  ordem de chegada — forçar as duas num schema só deixaria várias colunas
  sempre nulas dependendo do tipo.
- **Reservas carregam direto em `carregarTudo`** (só as em aberto — lista
  pequena, do tamanho de fornecedores/categorias, não é "comandas/itens
  completos" que a regra de agregação no banco proíbe baixar) porque o
  Mapa de mesas precisa saber quem está reservado pras próximas 2h mesmo
  sem a sub-aba Reservas e fila nunca ter sido aberta. A fila de espera é
  lazy (`listar_fila_espera`, só quando a sub-aba abre).
- **"Sentar"** (de uma reserva ou da fila) sempre cria a comanda pela mesma
  régua de `abrirComanda` (tipo MESA, status ABERTA, taxa de serviço
  ativa) — só que aqui é a RPC, no servidor, que calcula o
  `dia_operacional` com o timezone da empresa (mesmo padrão de
  `central_do_dono`/`abrir_checklist_pre_preparo`), não o default UTC da
  coluna. `sentar_reserva`/`sentar_fila` vinculam o `cliente_id` (quando
  informado) tanto na comanda nova quanto na reserva/fila de origem.
- **Fila de espera com tempo estimado**: `listar_fila_espera` calcula a
  posição (ordem de chegada) e o tempo estimado pela média de ocupação das
  últimas 50 mesas fechadas — tudo agregado no banco, nada somado no
  navegador.
- **Botão WhatsApp**: `wa.me/<telefone>?text=<mensagem pronta>` — só abre
  o WhatsApp do aparelho, nunca manda nada por conta própria (não existe
  provedor de envio aqui).
- Pronto quando: reserva das 20h aparece na mesa a partir das 18h e vira
  comanda com o cliente ao sentar.

## PRIORIDADE 9 — Marketing automático (0074)

`[PROPOR antes de implementar]` — proposta apresentada com 2 escopos
possíveis (banco identifica e um humano clica, sem custo nem provedor
externo × envio de verdade sem clique nenhum, via WhatsApp Business
API/Twilio ou SendGrid, com custo recorrente e escopo de engenharia bem
maior) e **aprovado o primeiro**: nenhum envio sai sozinho da Vision
Food — mesma régua de segurança usada em todo o app (ex: wa.me da
PRIORIDADE 8, que só abre o WhatsApp do aparelho).

Marketing ganhou uma 4ª sub-aba, **Campanhas** (antes de Cupons), mesma
permissão de sempre (`admin.marketing.editar`) — nenhuma permissão nova.

- **`restaurante.campanhas_hoje()`**: agrega, num call só, quem faz
  aniversário hoje e quem tem reserva **CONFIRMADA** pra hoje — "hoje" é
  data de calendário no timezone da empresa (`empresas.timezone`), não
  `dia_operacional` (aniversário é data de calendário, não "dia de
  venda"). Só entra na lista quem dá pra contatar de verdade: sem
  telefone ou sem consentimento LGPD não aparece — diferente de
  `relatorio_clientes_inativos` (que mantém a linha sem telefone só pro
  dono saber "quem" parou de vir).
- Cada linha tem um botão **WhatsApp** (`wa.me` com mensagem pronta —
  aniversário ou lembrete de reserva) — e **Clientes inativos** (sub-aba
  já existente) ganhou o mesmo botão, sem nenhuma RPC nova lá.
- Pronto quando: abro Marketing → Campanhas de manhã e já vejo, prontos
  pra clicar, quem fazer aniversário e quem tem reserva confirmada hoje.

## PRIORIDADE 10 — Painel pelo celular (manifest.json, sw.js)

App já era responsivo pra celular desde sempre (é o mesmo `index.html`
usado no QR da mesa, e tem `renderBottomNav` pra Salão/Cozinha/Caixa em
tela pequena) — o que faltava era dar pra **instalar** de verdade. Dois
sub-itens do roteiro, dois tratamentos diferentes:

- **PWA instalável** — implementado direto (não tinha `[PROPOR]`).
  **Achado no caminho**: `main.js` já tinha o registro de
  `navigator.serviceWorker.register("/sw.js")` desde a "Fase 3.5" (e
  `sw.js` existia num commit antigo, com a mesma estratégia), mas o
  arquivo tinha sumido do diretório de trabalho — o registro vinha
  falhando em silêncio (só um `console.error`) até alguém notar.
  Recriado `sw.js` (estratégia
  **sempre network-first**, nunca cache-first: o app está em
  desenvolvimento ativo, schema muda toda semana — servir JS velho do
  cache por padrão podia rodar lógica desatualizada contra um banco novo
  sem ninguém perceber; o cache só entra como fallback quando a rede
  falha de verdade, e só pra arquivo estático do próprio site, nunca pra
  chamada da Supabase) e `manifest.json` (reaproveita
  `vision-food-icon.png`/`vision-food-favicon.png`, já usados no
  sidebar/favicon) — "Adicionar à tela inicial" no celular do dono agora
  funciona de verdade.
- **Notificações** `[PROPOR]` — proposta com 3 níveis (nenhuma novidade
  além da instalação × notificação só com o app aberto, reaproveitando o
  Realtime que o app já usa em tudo × push de verdade com app
  fechado/bloqueado, que exigiria a primeira Edge Function do projeto —
  infra nova, chave VAPID, tabela de inscrição, novo passo de deploy) e
  **aprovado o nível do meio**. Botão de sino no topbar (`icon-btn` ao
  lado do sino de alertas — qualquer papel vê, é preferência por
  **aparelho**, salva em `localStorage`, mesmo padrão de
  `caixaTerminalNome`, não por conta de quem logou nele) pede permissão
  do navegador e liga `notificarSeAtivo()`. Dois gatilhos, escolhidos por
  serem raros e exigirem decisão humana que pode passar batido com a tela
  de Salão fechada: **pedido pelo QR** aguardando aprovação e
  **pagamento offline em conflito** (`sync_conflitos`, que ganhou
  assinatura Realtime nova — antes só carregava uma vez em
  `carregarTudo`, sem Realtime nenhum). Dispara na hora, direto do
  payload do Realtime (não espera o `agendarRefresh`, que é
  *debounced* e pausado com a aba em segundo plano — exatamente quando a
  notificação mais importa). **Limite assumido**: só funciona com a aba
  aberta (mesmo em segundo plano); app fechado ou celular bloqueado não
  recebe nada — push de verdade fica pra quando/se fizer sentido o custo
  de manter uma Edge Function.
- Nenhuma RPC nova — PRIORIDADE 10 é 100% front-end, por isso não tem
  arquivo em `tests/` (a suíte cobre RPC/RLS, não Notification API/Service
  Worker do navegador).
- Pronto quando: o dono instala o app no celular pela tela de login, e um
  pedido novo pelo QR aparece como notificação do sistema mesmo com o
  app em segundo plano.

## Backlog (registrado, fora do escopo das 10 prioridades)

Itens citados no roteiro original como backlog — só registro aqui, sem
implementação, até alguém pedir explicitamente cada um:

- **Combos**: produto composto por vários itens com preço próprio
  (diferente de opções/adicionais, que são variação de UM produto).
- **Engenharia de cardápio**: cruzar margem × popularidade de cada
  produto (ex: matriz "estrela/dúvida/abacaxi/vaca leiteira") pra sugerir
  o que promover, reprecificar ou tirar do cardápio.
- **Disponibilidade por horário**: produto só aparecer no cardápio (e no
  QR) em certas janelas (ex: café da manhã até 11h) — hoje só existe
  esgotado/reativado manual.
- **Chamar garçom / pedir a conta pelo QR**: hoje o QR só lança pedido
  pendente de aprovação (PRIORIDADE 8 trouxe reserva/fila pro salão
  presencial, não pro QR) — um botão "chamar garçom"/"fechar a conta"
  direto do celular do cliente ainda não existe.
- **Pré-conta / cortesia**: imprimir/mostrar a conta sem fechar de
  verdade (cliente conferir antes de pagar), e marcar item/conta como
  cortesia (sem cobrar, sem contar como desconto).
- **Delivery kanban**: hoje delivery é só mais um tipo de comanda; um
  quadro por etapa (preparando → saiu pra entrega → entregue), com tempo
  por etapa, não existe.
- **Conciliação de maquininha**: hoje a taxa é configurada manualmente
  (Configurações → Taxas das maquininhas) e aplicada na hora do
  pagamento; bater automaticamente contra o extrato real da operadora
  (importar arquivo/API) não existe.
- **Relatório por canal**: separar faturamento por canal (salão × QR ×
  delivery × balcão/ficha) — hoje os relatórios somam tudo junto.
- **Anomalias na Auditoria**: hoje a Auditoria só lista o que aconteceu;
  destacar sozinho padrão fora do normal (ex: mesmo usuário cancelando
  muito mais que a média) não existe.
- **Avaliações / NPS**: pedir nota/comentário do cliente depois da visita
  (ex: por WhatsApp, reaproveitando o `wa.me` da PRIORIDADE 8/9) — não
  implementado.
- **Impressão por setor** (impressoras térmicas, sem diálogo do
  navegador): proposta já escrita, aguardando aprovação — ver
  [Impressão por setor — proposta pendente](#impressão-por-setor--proposta-pendente-fase-18).

## Auditoria de segurança — VF-007 e VF-008 corrigidos (0079–0081)

Aplicadas direto em produção via MCP em 10/10/2026 (0075–0078 também —
até então só estavam no repositório, não no banco).

- **0079** — derruba `confirmar_pagamento(uuid, jsonb, text)`, a
  assinatura original da 0035 que sobrou no catálogo (parâmetros
  diferentes = função diferente; nunca foi substituída). Era um caminho
  paralelo, ainda chamável, sem limite de desconto nem PIN.
- **0080 (VF-008)** — `jwt_empresa_id()`/`jwt_papel()` agora consultam
  `usuarios` (ativo + papel atuais) em vez de confiar só no que está
  congelado no JWT. Funcionário desativado perde acesso na hora (RLS,
  RPCs e Realtime), e rebaixar o papel também vale na hora. Trigger
  derruba `auth.sessions` ao desativar.
- **0081 (VF-007)** — índice único parcial `comandas_mesa_ativa_uk`: no
  máximo uma comanda `MESA` em `ABERTA`/`FECHANDO` por mesa.
  `sentar_reserva`/`sentar_fila` travam a mesa (`FOR UPDATE`), recusam
  mesa ocupada e reserva `NAO_VEIO`/fila `DESISTIU`; `transferir_comanda`
  trava a mesa destino antes de checar. `abrirComanda()` mostra "Mesa já
  ocupada" no erro `23505`. Testes: `tests/vf007_mesa_exclusiva.test.js`
  (não rodou ainda contra Supabase real; a lógica foi conferida em
  produção com transação desfeita).

## Auditoria de segurança — VF-001 a VF-005 corrigidos (0075–0078)

`docs/PLANO_DE_MELHORIAS.md` é um plano de 26 itens (VF-001 a VF-026,
P0 a P3) de uma auditoria externa estática do repositório. Os 6 achados
**P0** foram validados linha a linha contra o código real em 09/10/2026 —
todos confirmados, nenhum especulativo (um deles, a combinação
VF-003+VF-004+VF-005, forma uma cadeia prática de escalonamento de
privilégio). O primeiro corrigido foi **VF-004**:

- **Causa raiz**: `verificar_pin_supervisor` e `bater_ponto` inseriam a
  tentativa em `tentativas_autorizacao` e, logo em seguida, davam
  `raise exception` quando o PIN estava errado — tudo na mesma
  transação. Postgres desfaz a transação inteira quando uma exceção não
  é capturada, INSERT junto. O contador de "5 falhas/5 min" nunca
  acumulava de verdade.
- **Correção**: nova RPC `registrar_tentativa_pin(usuario)`, chamada
  **antes** da verificação, numa transação própria que sempre commita —
  já aplica o limite de 5 falhas/5min ali (não dá nem pra registrar uma
  6ª tentativa nesse caso). `verificar_pin_supervisor`/`bater_ponto`
  recebem o id dessa tentativa (`p_tentativa_id`), confirmam que ela
  existe, é do supervisor certo e ainda não foi usada, e só fazem um
  `UPDATE` pra `sucesso = true` no caminho de sucesso — que não lança
  exceção, então commita normal.
- **Assinaturas mudaram**: `verificar_pin_supervisor`, `cancelar_item`,
  `aplicar_desconto`, `confirmar_pagamento` e `bater_ponto` ganharam
  `p_tentativa_id`. As assinaturas antigas foram derrubadas
  explicitamente (`drop function`) — senão ficariam paralelas no
  catálogo, ainda chamáveis, e a correção não valeria nada.
- **Zero mudança visível pro usuário** — PIN errado continua mostrando o
  mesmo erro, PIN certo continua funcionando igual. A mudança é só no
  número de chamadas RPC que o client faz por baixo.
- Testes: `tests/pin_contador_tentativas.test.js` (novo — bloqueio de
  verdade na 6ª tentativa, replay de tentativa já usada, tentativa de
  outro supervisor, tentativa de outra empresa) + `supervisor.test.js`,
  `pin_alfanumerico.test.js`, `perdas.test.js`, `controle_equipe.test.js`
  atualizados pra nova assinatura.

**VF-001** foi o segundo corrigido:

- **Achado confirmado, mais sério do que parecia no texto original do
  plano**: o CLIENT já fazia `UPDATE` direto em `comandas.status`/
  `fechamento` em 3 lugares reais — `cancelarComanda()`
  (`status='CANCELADA'`, confiando só no navegador que a comanda estava
  vazia, nada no servidor conferia) e os dois lados do toggle
  `ABERTA<->FECHANDO` (`abrirFecharConta`/`fecharModalAtual`/pagamento
  parcial, esses sem risco financeiro — só coordenação de UI). E a
  policy de `INSERT` de `caixa_movimentos` deixava qualquer um com
  `caixa.pagamento.registrar` (ex: CAIXA) gravar `tipo='VENDA'` direto
  na tabela — fabricando uma venda que nunca aconteceu pra fechar a
  conferência de caixa artificialmente.
- **Correção cirúrgica, não um bloqueio geral**: o trigger
  `trg_comandas_protege_colunas` passou a recusar `UPDATE` direto só
  quando `status` muda **para** `PAGA` ou `CANCELADA` (os dois estados
  que têm efeito financeiro de verdade) — `ABERTA<->FECHANDO` continua
  livre, exatamente como o client já usa. `fechamento` e
  `troco_centavos` entraram na lista de campos somente-leitura (junto de
  `total_centavos`). Nova RPC `cancelar_comanda_vazia` substitui o
  `UPDATE` direto do cancelamento, repetindo a checagem "zero item" no
  **servidor** (antes só existia no client).
- **`pagamentos`**: `INSERT` direto fechado de vez — nenhum código do
  client nunca usou essa porta, só `confirmar_pagamento` grava.
- **`caixa_movimentos`**: `INSERT` direto agora só aceita
  `tipo in ('SANGRIA','SUPRIMENTO')` (uso real do client,
  `registrarMovimento`) — `VENDA`/`ESTORNO`/`AJUSTE` só pela RPC
  (`SECURITY DEFINER`, ignora RLS).
- **`contas`**: `INSERT` direto exige `admin.financeiro.ver` (mesmo gate
  do botão "Nova conta" no client) — a cláusula extra de
  `caixa.pagamento.registrar` foi removida (só existia pra
  `confirmar_pagamento`, que já ignora RLS; na prática só deixava CAIXA
  inserir conta manual sem acesso à tela Financeiro).
- Testes: `tests/blindagem_financeira.test.js` (novo).

**VF-005** fechou o lote:

- **Achado confirmado**: `usuarios_select` e `contas_select` só
  filtravam por `empresa_id`, sem checar permissão — qualquer papel
  logado, **inclusive COZINHA**, lia `email_interno` de todo mundo e
  todas as contas a pagar/receber via API direta. Combinado com VF-003
  (o PIN é a senha real da conta) e VF-004 (contador de tentativas, já
  corrigido), formava uma cadeia prática: ler o e-mail do ADMIN e tentar
  a senha de 4 caracteres dele.
- **`usuarios.email_interno`**: coluna revogada por `REVOKE`
  (`anon`/`authenticated`) — RLS filtra **linha**, não dá pra restringir
  só uma coluna por política, por isso o `GRANT`/`REVOKE` por coluna.
  `mapUsuario` (client) nunca leu esse campo de volta — era puro resíduo
  do `select('*')` antigo, trocado por lista explícita de colunas em
  `carregarTudo()`. `nome`/`papel`/`ativo` continuam abertos pra
  qualquer papel (precisam disso pro picker de supervisor na autorização
  de PIN, pro picker de funcionário em Bater Ponto). Nenhuma RPC afetada
  — `SECURITY DEFINER` roda com o privilégio de quem criou a função, não
  de `authenticated`.
- **`contas`**: ganhou o mesmo `admin.financeiro.ver` que já esconde a
  aba Financeiro e o botão "Nova conta" no client — conferido que
  nenhuma tela de GARCOM/CAIXA/COZINHA usa `state.contas` pra nada.
- **[DECISÃO DE DESIGN — avise se quiser diferente] `clientes` ficou de
  fora.** O plano também cita essa tabela, mas diferente de `usuarios`/
  `contas`, GARCOM/CAIXA usam telefone/endereço/pontos de qualquer
  cliente o tempo todo — é o fluxo real de escolher cliente pra
  fiado/pontos/delivery no pagamento, não só a tela admin de cadastro
  (`admin.clientes.editar`). Restringir do mesmo jeito quebraria esse
  fluxo; resolver direito exigiria uma projeção de colunas separada
  (RPC/view só com nome+id pro picker de venda, linha completa só pra
  quem edita cadastro) — escopo maior que esta correção. Registrado em
  `docs/PLANO_DE_MELHORIAS.md`, não resolvido ainda.
- Testes: `tests/vazamento_dados_leitura.test.js` (novo).

**VF-002** (fila offline) fechou o lote dos P0 acionáveis sem decisão de
produto nem ambiente novo:

- **Achado confirmado**: `offlineProcessarItem()` devolvia só
  `true`/`false` — sucesso de verdade e recusa definitiva do servidor
  (ex: "comanda já paga", "faltam R$5 pra cobrir o total") eram o mesmo
  `true`, e `offlineSincronizar()` **removia o item da fila nos dois
  casos**. Um pedido ou pagamento em dinheiro recusado desaparecia pra
  sempre depois de um toast que passa em segundos, sem nenhum jeito de
  revisar depois. `offlineEnfileirar()` também engolia falha de
  gravação no IndexedDB só com `console.error`, enquanto quem chamou
  mostrava "guardado" mesmo sem ter guardado nada.
- **Correção**: `offlineProcessarItem` devolve um status explícito —
  `ENVIADO` (sai da fila), `PENDENTE_REDE` (sem internet, mantém a
  ordem, tenta de novo depois) ou `RECUSADO` (o servidor disse não —
  fica marcado na própria fila, `recusado`/`erroRecusa`/`recusadoEm`,
  **nunca mais tenta sozinho**). `offlineEnfileirar` devolve
  `true`/`false` de verdade; os 3 pontos que enfileiram
  (`enviarPedidoOffline`, `confirmarPagamentoOffline`, `kdsSetStatus`)
  passaram a enfileirar **antes** de mexer no `state` — se o IndexedDB
  falhar, nada na tela finge que foi guardado, e o item (pedido/
  pagamento) não entra na comanda como se tivesse ido pro servidor.
- **Nova área "Pendências de sincronização"** (Configurações, mesmo
  card/permissão de "Conflitos de sincronização offline", `admin.
  sync_conflitos.resolver`): lista o que foi recusado, com tipo,
  descrição (produto/valor/comanda quando dá pra identificar),
  mensagem de erro do servidor e quando — com **Descartar** (remove de
  vez) e **Tentar de novo** (volta pra fila normal).
- Testes: `tests/offline_pendencias.test.js` (novo — **esse já rodou de
  verdade e passou**, é lógica pura do client, não precisa de Supabase;
  ver `tests/README.md`).

**VF-003** (`0078`) — o mais grave do plano, e o único que exigia decisão
do Gustavo antes de mexer (muda o login de todo mundo): aprovado em
10/10/2026, "separar PIN (operação) de senha (login)". Ver seção
completa em [Senha de login e PIN operacional — separados](#senha-de-login-e-pin-operacional--separados-vf-003-0078),
acima. Resumo: senha de acesso (8+ caracteres) e PIN operacional (4
caracteres, hash local via `pgcrypto`) viram independentes;
`criar_funcionario`/`onboarding_criar_empresa` exigem os dois;
`trocar_pin_funcionario` virou `trocar_credenciais_funcionario` (senha
e/ou PIN, cada um opcional); `verificar_pin_supervisor`/`bater_ponto`
não fazem mais nenhuma chamada ao Auth. Migração automática: todo
funcionário já existente teve o PIN atual copiado pra `pin_hash`
(`auth.users.encrypted_password`, já bcrypt) — ninguém perdeu acesso no
dia da migration; a senha de login de cada um continua sendo o PIN
antigo até um ADMIN/GERENTE trocar pela tela Equipe. Testes:
`tests/vf003_separa_senha_pin.test.js` (novo) + `pin_alfanumerico.test.js`
reescrito pro comportamento novo + `tests/setup.js` atualizado (usuário
de teste ganha `pin_hash` via `bcryptjs`, nova devDependency).

Dos 6 achados **P0** do plano, **5 estão corrigidos** (VF-001, VF-002,
VF-003, VF-004, VF-005). Falta só **VF-006** (staging real + suíte
rodada de verdade — depende de um projeto Supabase separado do de
produção, ação de conta que só o Gustavo consegue fazer).

## Onboarding de novo restaurante (Fase 4.2)

`restaurante.onboarding_criar_empresa(...)` (migration `0061`, assinatura
atualizada na `0078` — VF-003, senha e PIN separados) cria empresa +
primeiro ADMIN (login real) + mesas numeradas + categorias iniciais numa
chamada só, no SQL Editor:

```sql
select restaurante.onboarding_criar_empresa(
  'Nome do Restaurante',       -- p_nome_empresa
  'slug-do-restaurante',       -- p_slug (só minúscula/número/hífen)
  'Nome do Primeiro Admin',    -- p_nome_admin
  'umaSenhaForte123',          -- p_senha_admin (8+ caracteres — senha de login de verdade)
  '1A2B',                      -- p_pin_admin (4 caracteres, letras e números — PIN operacional, não loga mais sozinho)
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
  O contador de tentativas (VF-004, `0075`) e o PIN deixar de ser a senha
  de conta (VF-003, `0078`) já foram corrigidos — o que continua
  pendente é o rate limit do próprio Supabase Auth (**Auth → Rate
  Limits** no painel, configuração de conta, não código) pra senha de
  login.
- **Testes automatizados existem mas nunca rodaram de verdade**: ver
  [Testes automatizados](#testes-automatizados-fase-44) acima — escritos e
  revisados, faltando só um projeto Supabase de teste pra confirmar.
- **Pedido pelo QR sem aprovação do garçom**: decisão deliberada, não
  limitação — todo pedido feito pelo celular cai pendente em
  `pedidos_qr` até um humano confirmar (produto esgotado, erro de
  digitação, mesa errada). Tirar essa aprovação (autoatendimento 100%
  automático) é uma mudança de risco real, não implementada até alguém
  pedir explicitamente.
- **Push de verdade (app fechado/celular bloqueado)**: PRIORIDADE 10
  implementou só notificação com o app aberto (mesmo em segundo plano,
  via Realtime) — decisão explícita do dono, não limitação técnica. Push
  de verdade exigiria a primeira Edge Function do projeto (infra nova,
  chave VAPID, tabela de inscrição por usuário, novo passo de deploy via
  Supabase CLI além do SQL Editor) — ver
  [PRIORIDADE 10](#prioridade-10--painel-pelo-celular-manifestjson-swjs).
- **Preview de desconto no modal de pagamento não recalcula a taxa de
  serviço sobre a base já descontada**: ao resgatar pontos de fidelidade
  ou aplicar cupom, o Caixa mostra o total como "valor cheio menos o
  desconto direto", mas o servidor (`confirmar_pagamento`) calcula a taxa
  de serviço **já sobre** a base descontada (valor um pouco menor). A
  diferença se resolve sozinha no troco (o sistema sempre calcula o troco
  certo em cima do total real do servidor), então nenhum valor é cobrado
  errado — só o número exibido antes de confirmar não bate centavo a
  centavo com o que o servidor vai cobrar. Pré-existente desde a Fase 3.6
  (pontos), não causado pelo cupom — não corrigido ainda por exigir mexer
  na fórmula de taxa usada em várias telas (dashboard, recibo, relatórios).
