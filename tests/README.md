# Testes automatizados — Fase 4.4

Cobre as RPCs mais críticas do sistema: `confirmar_pagamento` (dinheiro de
verdade, baixa de estoque, fidelidade), `conferir_fechamento_caixa` /
`fechar_caixa` (conferência cega), `registrar_movimento_estoque` (ajuste
atômico) e `cancelar_item` / `aplicar_desconto` (autorização de
supervisor).

**Nunca rodam contra o projeto de produção** (`ybsyhjqtwiwomtxbloyu`) — o
próprio código (`setup.js`) recusa executar se `TEST_SUPABASE_URL` apontar
pra ele, mesmo que alguém configure errado sem querer.

## Por que isso ainda não rodou

Escrevi e revisei o código com cuidado (toda chamada de RPC confere com a
assinatura exata de cada migration), mas **nunca executei de verdade** —
não existe um projeto Supabase de teste disponível neste ambiente, só o
de produção do Rancho Netto, e rodar os testes ali seria exatamente o que
a Fase 4.4 pede pra nunca fazer. Antes de confiar neles, rode pelo menos
uma vez com um projeto de teste de verdade e confira se passam.

## Setup (uma vez)

1. Crie um projeto Supabase **novo, só pra teste** (plano free serve).
   Nunca aponte isso pro projeto de produção.
2. No SQL Editor desse projeto, aplique **todas** as migrations de
   `supabase/migrations/` em ordem — mesmo processo manual já usado em
   produção (ver seção "Aplicar/atualizar migrations" do README
   principal).
3. Cadastre o secret `service_role_key` no Vault desse projeto de teste
   (mesma função `vault.create_secret(...)` usada em produção) — os
   testes de `confirmar_pagamento`/`cancelar_item` passam pelas RPCs que
   chamam a Admin API do GoTrue, que depende dela.
4. No painel desse projeto de teste: `Data API → Exposed schemas` precisa
   incluir `restaurante` (mesmo passo do README principal).
5. Instale as dependências dos testes (só valem pra esta pasta, nunca vão
   pro front-end):
   ```
   cd tests
   npm install
   ```
6. Exporte as variáveis de ambiente (ou crie um `tests/.env.test` e
   carregue antes — não versionado, já coberto pelo `.gitignore` raiz):
   ```
   export TEST_SUPABASE_URL="https://SEU-PROJETO-DE-TESTE.supabase.co"
   export TEST_SUPABASE_ANON_KEY="sb_publishable_..."
   export TEST_SUPABASE_SERVICE_KEY="sb_secret_..."
   ```

## Rodar

```
cd tests
npm test
```

Usa `node --test` (nativo do Node 18+, sem framework de teste externo).
Cada arquivo cria sua própria empresa de teste isolada (slug com
timestamp) e remove tudo no final (`t.after`) — rodar os arquivos em
paralelo ou em qualquer ordem é seguro, nenhum teste depende de outro.

## O que cada arquivo cobre

- `confirmar_pagamento.test.js` — fechamento completo com baixa de
  estoque correta (ficha técnica), pagamento parcial por item não fecha
  a comanda, cliente vinculado ganha pontos de fidelidade.
- `caixa.test.js` — conferência cega bate exata quando informado = o que
  o servidor calculou; diferença acima do limite exige justificativa pra
  fechar, e fica registrada na auditoria.
- `estoque.test.js` — entrada soma, saída subtrai; **ETAPA 0.8**: saída
  maior que o estoque agora fica **negativa** (não trava mais em zero —
  decisão tomada, `greatest(0,...)` removido de todas as baixas).
- `supervisor.test.js` — garçom sem permissão própria consegue cancelar
  item/aplicar desconto com PIN de um supervisor; PIN errado é recusado;
  **supervisor renomeado depois de criado continua autorizando** — esse
  teste existe especificamente pra pegar se a regressão corrigida na
  migration `0060` (e-mail do supervisor reconstruído a partir do nome
  em vez de `email_interno`) voltar a acontecer.
- `etapa0.test.js` — as mudanças novas da ETAPA 0 em `confirmar_pagamento`
  e RPCs relacionadas: rendimento do insumo entrando na baixa de estoque
  (0.9), baixa por pagamento parcial sem duplicar (0.4), o total que
  `calcular_total_pagamento` mostra batendo exatamente com o que
  `confirmar_pagamento` cobra (0.1 — é o teste que existe especificamente
  pra pegar a cobrança a mais no cartão com cupom/pontos se voltar a
  acontecer), desconto empilhado acima do limite exigindo supervisor
  (0.2), e telefone escondido pra cliente sem consentimento LGPD no
  relatório de inativos (0.3).
