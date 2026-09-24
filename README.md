# Rancho Netto — Brasa & Fogo

Sistema de Gestão para Restaurante/Bar

Sistema de atendimento, cozinha (KDS), caixa, estoque, financeiro e
administração para restaurante/bar, rodando **100% sobre o Supabase**
(Postgres + Auth + Realtime) — sem `localStorage`, sem estado local como
fonte de verdade. Qualquer dispositivo autenticado lê e escreve direto no
banco, e fica sincronizado com os demais via Realtime.

## Estado atual

O front-end é estático e modular — `index.html` só monta `<head>`/`<body>` e
referencia `assets/css/styles.css` e ~18 arquivos JavaScript puro em
`assets/js/` (config, ícones, helpers, mapeamento, dados/realtime, ações por
domínio, impressão e renderização), carregados como `<script>` clássicos em
ordem, mais `@supabase/supabase-js` via CDN — deliberadamente sem build step
nem bundler, pronto para hospedagem estática (Vercel, GitHub Pages, etc.).
Ele cobre: login por PIN (autenticação real), mapa de mesas, comandas e
lançamento de pedidos, KDS em Kanban, caixa com conferência cega, cardápio,
estoque com baixa automática por ficha técnica, financeiro, relatórios,
equipe e configurações.

### Backend (Supabase) — schema completo aplicado

- **Fase 0**: `empresas`, `usuarios`, `papeis_permissoes`, `auditoria`, RLS,
  RBAC (5 papéis × 23 permissões).
- **Fase 1**: `categorias`, `produtos`, `insumos`, `ficha_tecnica`,
  `estoque_movimentos`, `mesas`, `comandas`, `comanda_itens`,
  `caixa_sessoes`, `caixa_movimentos`, `pagamentos`, `contas` — todas com
  RLS por `empresa_id` + permissão do papel.
- Todas as migrations estão em [`supabase/migrations/`](supabase/migrations/),
  numeradas e aplicadas em ordem.

### Autenticação real (não é mock)

Cada funcionário é uma conta real do Supabase Auth. O PIN de 4 dígitos que
aparece na tela **é a senha** por trás de um e-mail interno gerado
(`nome@fogo.internal`). O JWT emitido no login carrega `empresa_id` e
`papel` via um *Custom Access Token Hook* (`public.custom_access_token_hook`,
`SECURITY DEFINER`) — é isso que a RLS usa para isolar os dados por empresa
e por papel em toda tabela.

Criar um novo funcionário (tela Equipe) chama a função
`public.criar_funcionario` (RPC, `SECURITY DEFINER`), que valida a
permissão do chamador, lê a chave de serviço do **Supabase Vault**
(nunca do código do cliente) e cria a conta via Admin API do GoTrue. A
chave secreta nunca é exposta ao navegador.

### Sincronização multi-dispositivo

`supabase-js` mantém um canal Realtime (`postgres_changes`) por empresa,
escutando `comandas`, `comanda_itens`, `caixa_sessoes`, `caixa_movimentos`,
`produtos`, `insumos`, `contas` e `usuarios`. Qualquer mudança em um
dispositivo dispara um recarregamento (debounced) nos demais. Se
`WebSocket` não estiver disponível no ambiente, o app degrada com
graça (sem Realtime, mas CRUD continua funcionando normalmente).

### Validado com testes de integração reais

Não há mocks — os testes (`node` + `jsdom`, com polyfill de `fetch`) rodam
o `index.html` de verdade contra o projeto Supabase de produção: login
real, criação de comanda, lançamento de item, abertura de caixa, pagamento,
baixa automática de estoque por ficha técnica, e leitura de
cardápio/financeiro/relatórios/equipe/configurações. Última rodada: 10/10
passos, 0 erros.

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

Migrations `0021` a `0027` reconstroem o schema completo (núcleo, RBAC,
cardápio/estoque, atendimento, caixa/pagamentos, financeiro, view de login,
`criar_funcionario`, grants, Realtime, e o modelo de venda por
balcão/ficha da Fase A do v2) nesse projeto. As migrations `0001` a `0020`
documentam a história original (schema `public`) mas **não devem ser
reaplicadas neste projeto** — foram substituídas pelas `0021+`.

**Funcionários recriados em 2026-09-24** (contas antigas perdidas junto
com o projeto morto): Ana/ADMIN, Bruno/GERENTE, Carla/CAIXA, Diego/GARCOM,
Eva/COZINHA — todos com **PIN temporário `1234`**, a trocar pela tela
Equipe assim que possível.

## Variáveis de ambiente

Copie `.env.example` para `.env` (não versionado). **Atenção:** como não
há build step, o `.env` é só documentação — o front-end lê a config de
verdade direto de `assets/js/config.js` (`SUPABASE_URL`/`SUPABASE_KEY`
hardcoded ali). Editar o `.env` sozinho não muda o comportamento do app.

## Aplicar/atualizar migrations

Sem `psql` disponível, as migrations 0021+ foram aplicadas via um script
Node (`pg`) direto contra a connection string do pooler. Pra rodar uma
migration nova:

```powershell
psql "postgresql://postgres.<ref>:<senha>@aws-1-us-west-2.pooler.supabase.com:5432/postgres" -f supabase/migrations/00XX_arquivo.sql
```

Senha do banco em **Project Settings → Database** no painel do Supabase
(reset se necessário — não fica salva em lugar nenhum do repositório).

Existe uma integração GitHub↔Supabase configurada no painel (deploy
automático de `supabase/migrations/` ao dar merge em `main`), mas nunca foi
testada de fato — as migrations atuais foram aplicadas manualmente.

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

## Pendências conhecidas

- **Notas fiscais reais (NFC-e)**: o app emite um *comprovante não fiscal*
  (recibo de pagamento) e relatório de fechamento de caixa, ambos
  imprimíveis via `window.print()`. Nota fiscal eletrônica de verdade exige
  integração com um provedor credenciado (Focus NFe, Tecnospeed etc.) via
  certificado A1 — fora do escopo atual, é a Fase 7 do projeto original.
- **PIX**: simulado (QR ilustrativo + código "copia e cola" fake,
  claramente rotulado como simulação) — não processa pagamento real.
