# Rotas e Matriz de Permissão por Papel

## 1. Papéis

`ADMIN` · `GERENTE` · `CAIXA` · `GARCOM` · `COZINHA`

## 2. Catálogo de permissões

Cada permissão é uma string `modulo.recurso.acao` gravada em
`papeis_permissoes` e verificada via `public.tem_permissao(text)` nas
policies de RLS (ver `0004_rls_policies.sql`). O mesmo catálogo é usado como
guard de rota no front-end (`core/auth`).

| # | Permissão | Descrição |
|---|---|---|
| 1 | `atendimento.salao.ver` | Ver mapa de mesas e status |
| 2 | `atendimento.comanda.abrir` | Abrir comanda (mesa/balcão/delivery/retirada) |
| 3 | `atendimento.comanda.item.lancar` | Lançar/enviar itens para a cozinha |
| 4 | `atendimento.comanda.item.cancelar` | Cancelar item já enviado (operação sensível) |
| 5 | `atendimento.comanda.desconto.aplicar` | Aplicar desconto acima do limite do papel |
| 6 | `atendimento.comanda.transferir` | Transferir itens entre comandas/mesas |
| 7 | `atendimento.comanda.reabrir` | Reabrir comanda já paga (operação sensível) |
| 8 | `atendimento.comanda.fechar` | Fechar conta / iniciar pagamento |
| 9 | `cozinha.kds.ver` | Ver telas de KDS por setor |
| 10 | `cozinha.item.atualizar_status` | Marcar item como preparando/pronto |
| 11 | `caixa.sessao.abrir` | Abrir sessão de caixa em um terminal |
| 12 | `caixa.sessao.fechar` | Executar fechamento (conferência cega) |
| 13 | `caixa.movimento.sangria` | Registrar sangria |
| 14 | `caixa.movimento.suprimento` | Registrar suprimento |
| 15 | `caixa.pagamento.registrar` | Registrar pagamento (dinheiro/PIX/cartão/etc.) |
| 16 | `admin.cardapio.editar` | CRUD de categorias, produtos, variações, adicionais |
| 17 | `admin.estoque.editar` | CRUD de insumos, fichas técnicas, movimentações |
| 18 | `admin.equipe.editar` | CRUD de usuários, papéis, PINs |
| 19 | `admin.financeiro.ver` | Ver contas a pagar/receber, DRE |
| 20 | `admin.financeiro.editar` | Lançar/editar contas a pagar/receber |
| 21 | `admin.relatorios.ver` | Ver relatórios e dashboards |
| 22 | `admin.configuracoes.editar` | Dados fiscais, impressoras, taxas, limites |
| 23 | `auditoria.ver` | Ver trilha de auditoria |

## 3. Matriz papel × permissão

| Permissão | ADMIN | GERENTE | CAIXA | GARCOM | COZINHA |
|---|:---:|:---:|:---:|:---:|:---:|
| atendimento.salao.ver | ✔ | ✔ | ✔ | ✔ | – |
| atendimento.comanda.abrir | ✔ | ✔ | ✔ | ✔ | – |
| atendimento.comanda.item.lancar | ✔ | ✔ | ✔ | ✔ | – |
| atendimento.comanda.item.cancelar | ✔ | ✔ | – | – | – |
| atendimento.comanda.desconto.aplicar | ✔ | ✔ | – | – | – |
| atendimento.comanda.transferir | ✔ | ✔ | – | – | – |
| atendimento.comanda.reabrir | ✔ | ✔ | – | – | – |
| atendimento.comanda.fechar | ✔ | ✔ | ✔ | ✔ | – |
| cozinha.kds.ver | ✔ | ✔ | – | – | ✔ |
| cozinha.item.atualizar_status | ✔ | ✔ | – | – | ✔ |
| caixa.sessao.abrir | ✔ | ✔ | ✔ | – | – |
| caixa.sessao.fechar | ✔ | ✔ | ✔ | – | – |
| caixa.movimento.sangria | ✔ | ✔ | ✔ | – | – |
| caixa.movimento.suprimento | ✔ | ✔ | ✔ | – | – |
| caixa.pagamento.registrar | ✔ | ✔ | ✔ | – | – |
| admin.cardapio.editar | ✔ | ✔ | – | – | – |
| admin.estoque.editar | ✔ | ✔ | – | – | – |
| admin.equipe.editar | ✔ | ✔ | – | – | – |
| admin.financeiro.ver | ✔ | ✔ | – | – | – |
| admin.financeiro.editar | ✔ | ✔ | – | – | – |
| admin.relatorios.ver | ✔ | ✔ | – | – | – |
| admin.configuracoes.editar | ✔ | – | – | – | – |
| auditoria.ver | ✔ | ✔ | – | – | – |

**Notas de decisão:**
- `GERENTE` tem praticamente as mesmas permissões de `ADMIN`, exceto
  `admin.configuracoes.editar` (dados fiscais/certificado/impressoras) —
  reservado ao dono/responsável técnico do estabelecimento.
- Operações marcadas como "sensíveis" no prompt mestre (cancelar item
  enviado, desconto acima do limite, transferir, reabrir) exigem PIN de
  `ADMIN`/`GERENTE` mesmo quando disparadas a partir da tela de um
  `GARCOM`/`CAIXA` — a UI pede o PIN, mas a policy de RLS é quem
  efetivamente bloqueia a escrita sem a permissão.
- `CAIXA` fecha comanda e registra pagamento, mas não cancela item nem
  aplica desconto — essas ações passam pela mesma trava de supervisor.
- `COZINHA` só enxerga o próprio módulo (KDS); não vê salão, caixa ou admin.

## 4. Rotas do front-end

Prefixo de guarda: cada rota abaixo lista a(s) permissão(ões) mínima(s)
exigida(s) para renderizar (guard em `app/`, redundante com a RLS no banco).

| Rota | Módulo | Permissão mínima |
|---|---|---|
| `/login` | auth | pública |
| `/selecionar-empresa` | auth | autenticado |
| `/salao` | atendimento | `atendimento.salao.ver` |
| `/comandas/:id` | atendimento | `atendimento.comanda.abrir` |
| `/comandas/:id/novo-pedido` | atendimento | `atendimento.comanda.item.lancar` |
| `/balcao` | atendimento | `atendimento.comanda.abrir` |
| `/delivery` | atendimento | `atendimento.comanda.abrir` |
| `/delivery/:id` | atendimento | `atendimento.comanda.abrir` |
| `/kds` | cozinha | `cozinha.kds.ver` |
| `/kds/:setor` | cozinha | `cozinha.kds.ver` |
| `/caixa` | caixa | `caixa.sessao.abrir` |
| `/caixa/abrir` | caixa | `caixa.sessao.abrir` |
| `/caixa/fechar` | caixa | `caixa.sessao.fechar` |
| `/caixa/sangria` | caixa | `caixa.movimento.sangria` |
| `/caixa/suprimento` | caixa | `caixa.movimento.suprimento` |
| `/caixa/pagamento/:comandaId` | caixa | `caixa.pagamento.registrar` |
| `/admin/cardapio` | admin | `admin.cardapio.editar` |
| `/admin/cardapio/produtos/:id` | admin | `admin.cardapio.editar` |
| `/admin/estoque` | admin | `admin.estoque.editar` |
| `/admin/equipe` | admin | `admin.equipe.editar` |
| `/admin/financeiro` | admin | `admin.financeiro.ver` |
| `/admin/relatorios` | admin | `admin.relatorios.ver` |
| `/admin/configuracoes` | admin | `admin.configuracoes.editar` |
| `/admin/auditoria` | admin | `auditoria.ver` |

## 5. Onde isso é aplicado no código (fases seguintes)

- Guard de rota: `src/app/guards/RequirePermission.tsx` lê o papel/claims do
  usuário autenticado e compara contra este catálogo.
- RLS: `public.tem_permissao(text)` em `0004_rls_policies.sql` consulta
  `papeis_permissoes` usando o `papel` presente no JWT (custom claim, ver
  `0003_funcoes_auth.sql`).
- Um único catálogo (`docs/rotas-permissoes.md` → seed SQL → front-end)
  evita divergência entre o que a UI esconde e o que o banco realmente
  bloqueia.
