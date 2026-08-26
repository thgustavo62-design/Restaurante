# Sistema de Gestão para Restaurante/Bar — Fogo Gestão

Sistema de atendimento, cozinha (KDS), caixa, estoque, financeiro e
administração para restaurante/bar, rodando **100% sobre o Supabase**
(Postgres + Auth + Realtime) — sem `localStorage`, sem estado local como
fonte de verdade. Qualquer dispositivo autenticado lê e escreve direto no
banco, e fica sincronizado com os demais via Realtime.

## Estado atual

O front-end é um único arquivo estático (`index.html`, ~2.900 linhas,
JavaScript puro + `@supabase/supabase-js` via CDN) — deliberadamente sem
build step, pronto para hospedagem estática (Vercel, GitHub Pages, etc.).
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

## Variáveis de ambiente

Copie `.env.example` para `.env` (não versionado). O front-end usa apenas
`VITE_SUPABASE_URL` e a chave **publicável** (`sb_publishable_...`, segura
para expor no navegador). A chave secreta (`sb_secret_...`) nunca é usada
no front-end — só no Vault, por dentro da função `criar_funcionario`.

## Aplicar/atualizar migrations

```powershell
psql "postgresql://postgres.<ref>:<senha>@aws-0-us-west-2.pooler.supabase.com:5432/postgres" -f supabase/migrations/000X_arquivo.sql
```

Senha do banco em **Project Settings → Database** no painel do Supabase
(reset se necessário — não fica salva em lugar nenhum do repositório).

## Pendências conhecidas

- **Deploy**: ainda não publicado na Vercel (próximo passo).
- **Notas fiscais reais (NFC-e)**: o app emite um *comprovante não fiscal*
  (recibo de pagamento) e relatório de fechamento de caixa, ambos
  imprimíveis via `window.print()`. Nota fiscal eletrônica de verdade exige
  integração com um provedor credenciado (Focus NFe, Tecnospeed etc.) via
  certificado A1 — fora do escopo atual, é a Fase 7 do projeto original.
- **PIX**: simulado (QR ilustrativo + código "copia e cola" fake,
  claramente rotulado como simulação) — não processa pagamento real.
