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
- `central_do_dono.test.js` — PRIORIDADE 1 (Central do Dono): faturamento
  de "hoje até agora" bate exatamente com o que `confirmar_pagamento`
  cobrou de verdade (nunca uma soma recalculada); ADMIN vê o resultado
  estimado do mês e GERENTE não (vem `null` de propósito, decidido no
  servidor — nunca só escondido no front); estoque negativo e conta a
  pagar vencendo entram em "precisa da sua atenção"; GARCOM (sem
  `admin.central_dono.ver`) não consegue nem chamar a RPC.
- `producao.test.js` — PRIORIDADE 2 (Produção/Pré-preparo): a sugestão do
  checklist bate com a média das últimas 4 semanas × ficha técnica;
  marcar/desmarcar "feito" grava e limpa quem e quando; produzir um lote
  de sub-receita baixa o ingrediente de verdade e dá entrada com custo
  médio ponderado (mesma fórmula do recebimento de compras, 0040); insumo
  comum (não marcado como sub-receita) não pode ser "produzido".
- `financeiro_simples.test.js` — PRIORIDADE 7 (Financeiro simples):
  despesa recorrente lança a conta do mês sozinha e é idempotente (rodar
  de novo no mesmo mês não duplica); `salvar_despesa_recorrente` exige
  `admin.financeiro.editar`; e o teste central do "Pronto quando" —
  `relatorio_financeiro_resumo` sempre bate entrou − saiu = sobrou, e as
  5 linhas de "pra onde foi o dinheiro" somam exatamente o saiu (nenhuma
  conta escondida fora das 5 linhas).
- `reservas_fila.test.js` — PRIORIDADE 8 (Reservas / Fila de espera): o
  teste central do "Pronto quando" — `sentar_reserva`/`sentar_fila` criam
  uma comanda de verdade (tipo MESA, `dia_operacional` calculado pelo
  timezone da empresa, não o default UTC da coluna) e vinculam o cliente;
  `listar_fila_espera` calcula posição e tempo estimado pelo tempo médio
  de ocupação das mesas; `atualizar_status_reserva`/`atualizar_status_fila`
  rejeitam status inválido e não deixam mexer em quem já sentou; e quem
  não tem `atendimento.comanda.abrir` (ex: COZINHA) não cria nem senta
  reserva/fila, nem vê a fila sem `atendimento.salao.ver`.
- `marketing_campanhas.test.js` — PRIORIDADE 9 (Marketing automático):
  `campanhas_hoje` só traz quem dá pra contatar de verdade — aniversariante
  de hoje (não de outro dia) com telefone e consentimento LGPD, reserva
  **CONFIRMADA** de hoje com telefone (nem AGUARDANDO, nem sem telefone
  entram); exige `admin.marketing.editar`.
- `expedicao.test.js` — PRIORIDADE 6 (Expedição da Cozinha): o único
  pedaço novo no banco (`categorias.tempo`) aceita só
  entrada/principal/sobremesa, com PRINCIPAL por padrão. "Liberar pro
  salão" não tem RPC própria — reaproveita o mesmo UPDATE em lote que o
  KDS já usava pra ticket inteiro.
- `controle_equipe.test.js` — PRIORIDADE 5 (Controle de Equipe): bater
  ponto confere o PIN de verdade (mesmo mecanismo da autorização de
  supervisor) e PIN errado é recusado; corrigir ponto exige
  `admin.equipe.editar` e fica na auditoria; `comanda_itens` grava
  `iniciado_em`/`pronto_em`/`entregue_em` sozinho quando o status muda
  (sem precisar tocar nos 3 lugares que escrevem status); `confirmar_pagamento`
  agora grava `taxa_servico_centavos`, somando em pagamento parcial; o
  fechamento rateia a taxa por peso de função e desconta vales; e só
  ADMIN vê remuneração/líquido (GERENTE vê o resto do mesmo relatório) —
  mesma régua na Central do Dono pro custo de equipe.
- `compras_inteligentes.test.js` — PRIORIDADE 4 (Compras Inteligentes): a
  lista de compras sugerida calcula pelo consumo real dos últimos 28 dias
  × ficha técnica e pelo prazo de entrega do fornecedor padrão do insumo;
  receber um pedido com quantidade/preço diferente do pedido usa o
  RECEBIDO (não o pedido) pro estoque e custo médio, e grava a
  divergência na auditoria; e o teste do "Pronto quando" do roteiro —
  receber um insumo 15% mais caro (acima do limite configurado de 10%)
  aparece como alerta no relatório de preços, com o impacto por unidade
  no prato que usa esse insumo na ficha técnica.
- `pin_alfanumerico.test.js` — PIN deixou de ser só numérico (0068):
  `criar_funcionario`/`trocar_pin_funcionario` aceitam PIN com letra e
  número e o login de verdade funciona com ele (não só "a RPC não deu
  erro"); PIN fora do formato (curto, longo, com símbolo) continua
  recusado; `verificar_pin_supervisor` (exercitado via `cancelar_item`)
  aceita PIN alfanumérico do supervisor.
- `vazamento_dados_leitura.test.js` — VF-005 do plano de auditoria
  (`docs/PLANO_DE_MELHORIAS.md`): `usuarios.email_interno` não é mais
  legível por nenhum papel via select direto (coluna revogada —
  qualquer um conseguia ler o e-mail de login de todo mundo antes),
  enquanto `nome`/`papel`/`ativo` continuam abertos (pickers de
  supervisor/ponto precisam); `contas` só retorna linha pra quem tem
  `admin.financeiro.ver` — GARCOM/CAIXA/COZINHA recebem lista vazia, não
  erro (RLS filtra silenciosamente).
- `blindagem_financeira.test.js` — VF-001 do plano de auditoria
  (`docs/PLANO_DE_MELHORIAS.md`): `UPDATE` direto pra `status=PAGA` ou
  `CANCELADA` é recusado pelo trigger (só `confirmar_pagamento`/
  `cancelar_comanda_vazia` conseguem, via bypass interno); `ABERTA<->
  FECHANDO` continua liberado (sem efeito financeiro); `cancelar_comanda_
  vazia` recusa comanda com item mesmo que o client minta que está
  vazia; `INSERT` direto em `pagamentos` é recusado (só
  `confirmar_pagamento` grava); `caixa_movimentos` só aceita
  `SANGRIA`/`SUPRIMENTO` por insert direto, `VENDA` fabricado é
  recusado; `contas` exige `admin.financeiro.ver` pra insert direto
  (a cláusula extra de `caixa.pagamento.registrar`, que só existia pra
  uma RPC que já ignora RLS, foi removida).
- `pin_contador_tentativas.test.js` — VF-004 do plano de auditoria
  (`docs/PLANO_DE_MELHORIAS.md`): o contador de "5 tentativas/5 min" de
  verdade bloqueia a 6ª (antes nunca acumulava — o INSERT da tentativa
  rodava na mesma transação que o `raise exception` do PIN errado, e
  Postgres desfazia os dois juntos); `registrar_tentativa_pin` exige
  usuário da mesma empresa; reusar uma tentativa já marcada como sucesso
  (replay) é recusado; tentativa registrada pra um supervisor não
  autoriza em nome de outro.
- `perdas.test.js` — PRIORIDADE 3 (Perdas e Desperdícios): perda manual de
  insumo baixa o estoque e vale pelo custo médio; perda manual de prato
  vale pelo CMV e **não** baixa ingrediente (ver nota de design na
  migration 0067); item cancelado já em preparo vira perda automática
  **e** baixa o ingrediente (único caso em que isso é seguro: nunca vai
  passar pela baixa de `confirmar_pagamento`); diferença negativa de
  inventário grava "perda não identificada" e diferença positiva (sobra)
  não grava nada; e o teste do "Pronto quando" do roteiro — registrar uma
  perda aparece no bloco de perdas da Central do Dono.
