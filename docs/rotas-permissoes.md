# Papéis e permissões — Vision Food

Reescrito na ETAPA 0 (0.12) a partir do catálogo real do sistema
(`papeis_permissoes` nas migrations + `assets/js/config.js`). A versão
anterior deste documento descrevia um desenho original que este app nunca
usou (schema `public`, rotas de uma arquitetura React com
`src/app/guards/...`) — igual o `docs/ER.md` estava antes de ser
corrigido. Esta versão reflete o que roda de verdade em produção.

## 1. Papéis

`ADMIN` · `GERENTE` · `CAIXA` · `GARCOM` · `COZINHA`

Cinco papéis fixos (não é possível criar papel novo pela UI — exigiria
mudar o enum `restaurante.papel_usuario` no banco e todo o catálogo
abaixo).

## 2. Catálogo de permissões

Cada permissão é uma string `modulo.recurso.acao`, gravada na tabela
`restaurante.papeis_permissoes` (semeada nas migrations, nunca dado de
exemplo) e verificada em toda escrita sensível via
`restaurante.tem_permissao(text)` — dentro de policies de RLS e dentro de
RPCs `SECURITY DEFINER`. O mesmo catálogo é espelhado em
`assets/js/config.js` (`PERM`/`MATRIZ`), usado **só** pra esconder
botões/telas na UI — nunca é a trava real, e os dois lugares precisam
ficar manualmente em sincronia (ver nota no README).

| # | Permissão | O que libera |
|---|---|---|
| 1 | `atendimento.salao.ver` | Ver o mapa de mesas e a lista de comandas abertas |
| 2 | `atendimento.comanda.abrir` | Abrir comanda (mesa/balcão/ficha/delivery) |
| 3 | `atendimento.comanda.item.lancar` | Lançar item no pedido e confirmar pedido pelo QR |
| 4 | `atendimento.comanda.item.cancelar` | Cancelar item já lançado (sempre exige PIN de supervisor, mesmo quem tem a permissão) |
| 5 | `atendimento.comanda.desconto.aplicar` | Aplicar desconto na comanda; dentro do limite configurado não pede supervisor, acima pede |
| 6 | `atendimento.comanda.transferir` | Transferir item/comanda entre mesas, juntar mesas |
| 7 | `atendimento.comanda.reabrir` | Reabrir comanda travada em `FECHANDO` (pagamento interrompido) |
| 8 | `atendimento.comanda.fechar` | Abrir o modal de fechar conta |
| 9 | `cozinha.kds.ver` | Ver o KDS (Kanban da cozinha) |
| 10 | `cozinha.item.atualizar_status` | Avançar status de item no KDS |
| 11 | `caixa.sessao.abrir` | Abrir sessão de caixa num terminal |
| 12 | `caixa.sessao.fechar` | Conferir e fechar sessão de caixa |
| 13 | `caixa.movimento.sangria` | Registrar sangria |
| 14 | `caixa.movimento.suprimento` | Registrar suprimento |
| 15 | `caixa.pagamento.registrar` | Confirmar pagamento (`confirmar_pagamento`) e consultar o total (`calcular_total_pagamento`) |
| 16 | `auditoria.ver` | Ver a trilha de auditoria |
| 17 | `admin.cardapio.editar` | CRUD de produtos/categorias/opções; gerar novo QR de mesa (0.6) |
| 18 | `admin.estoque.editar` | Entrada/saída manual de estoque, inventário, rendimento |
| 19 | `admin.equipe.editar` | Criar funcionário, trocar PIN, ativar/desativar, editar escala, bater/corrigir ponto, ver desempenho e o fechamento (sem remuneração) |
| 20 | `admin.financeiro.ver` | Ver contas a pagar/receber e exportação pro contador |
| 21 | `admin.financeiro.editar` | Lançar/editar contas a pagar/receber |
| 22 | `admin.relatorios.ver` | Ver as três abas de Relatórios (Vendas/Gestão/DRE) |
| 23 | `admin.configuracoes.editar` | Editar Configurações (dados fiscais, limites, impressão, horário) |
| 24 | `admin.clientes.editar` | CRUD de clientes (CRM) |
| 25 | `admin.marketing.editar` | CRUD de cupons, busca de clientes inativos, banner do cardápio |
| 26 | `admin.sync_conflitos.resolver` | Aplicar/descartar um conflito de sincronização offline (0.5) |
| 27 | `admin.central_dono.ver` | Ver a Central do Dono (PRIORIDADE 1) — resultado estimado do mês só aparece pra quem é `ADMIN` |
| 28 | `admin.equipe.custos.ver` | Ver/editar salário-diária, vales e o fechamento completo da equipe (PRIORIDADE 5) — só `ADMIN` |

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
| auditoria.ver | ✔ | ✔ | – | – | – |
| admin.cardapio.editar | ✔ | ✔ | – | – | – |
| admin.estoque.editar | ✔ | ✔ | – | – | – |
| admin.equipe.editar | ✔ | ✔ | – | – | – |
| admin.financeiro.ver | ✔ | ✔ | – | – | – |
| admin.financeiro.editar | ✔ | ✔ | – | – | – |
| admin.relatorios.ver | ✔ | ✔ | – | – | – |
| admin.configuracoes.editar | ✔ | – | – | – | – |
| admin.clientes.editar | ✔ | ✔ | – | – | – |
| admin.marketing.editar | ✔ | ✔ | – | – | – |
| admin.sync_conflitos.resolver | ✔ | ✔ | – | – | – |
| admin.central_dono.ver | ✔ | ✔ | – | – | – |
| admin.equipe.custos.ver | ✔ | – | – | – | – |

**Notas de decisão:**

- `GERENTE` tem praticamente as mesmas permissões de `ADMIN`, exceto
  `admin.configuracoes.editar` — reservado ao dono/responsável técnico do
  estabelecimento (dados fiscais, limites de alçada, 2FA). Mesma lógica
  na Central do Dono: `GERENTE` tem `admin.central_dono.ver`, mas a RPC
  devolve o resultado/lucro estimado do mês como `null` pra quem não é
  `ADMIN` — decidido no servidor, não só escondido na tela. E em Equipe:
  `GERENTE` tem `admin.equipe.editar` (funcionário, PIN, escala, ponto,
  desempenho) mas não `admin.equipe.custos.ver` — salário/diária fica
  numa tabela própria (`funcionarios_remuneracao`), nunca em `usuarios`
  (que todo funcionário lê); o fechamento da equipe devolve horas/rateio/
  vales pra `GERENTE` mas `null` em remuneração/líquido.
- Cancelar item e transferir/juntar comanda **sempre** passam por um
  trigger de coluna no banco (`trg_comandas_protege_colunas` /
  `trg_comanda_itens_protege_colunas`), não só pela permissão de linha —
  um `GARCOM` com `UPDATE` liberado na comanda (porque tem
  `atendimento.comanda.fechar`, por exemplo) ainda não consegue gravar
  `desconto_centavos` ou `status=CANCELADO` sem a permissão específica
  daquela coluna.
- Operações sensíveis demais pra confiar só numa permissão (cancelar
  item, desconto acima do limite configurado — incluindo o desconto
  **empilhado**, manual + pontos + cupom, desde a 0.2) exigem PIN de um
  supervisor verificado no servidor (`verificar_pin_supervisor`), mesmo
  quando quem está pedindo já tem a permissão.
- `CAIXA` fecha comanda e registra pagamento, mas não cancela item nem
  aplica desconto — essas ações, se precisarem acontecer no fluxo dele,
  passam pela mesma trava de supervisor que um `GARCOM` usaria.
- `COZINHA` só enxerga o próprio módulo (KDS); não vê salão, caixa ou
  admin.
- Operações de ADMIN especialmente sensíveis (criar funcionário, trocar
  PIN, editar Configurações, exportar pro contador) exigem adicionalmente
  verificação em duas etapas (`aal2`) quando a conta logada tiver MFA
  cadastrado — ver `restaurante.exige_aal2_se_mfa_ativo()` (0.7). Sem MFA
  cadastrado, nada muda (não existe obrigação de ativar).

## 4. Onde cada permissão aparece no app

Não existem "rotas" no sentido de URLs de uma SPA com router — é um
app de tela única (`index.html`) que troca `state.view` (e, desde a
0.11, `state.subAba[tela]` pras telas com sub-abas). A tabela abaixo
mapeia tela/sub-aba → permissão mínima, equivalente ao que seria um guard
de rota:

| Tela (e sub-aba) | Permissão mínima |
|---|---|
| Central do Dono | `admin.central_dono.ver` |
| Dashboard | `atendimento.salao.ver` |
| Atendimento → Salão → Mapa de mesas | `atendimento.salao.ver` |
| Atendimento → Salão → Reservas e fila | `atendimento.salao.ver` pra ver (criar reserva, entrar na fila, confirmar/sentar/não veio/chamar/desistiu exige `atendimento.comanda.abrir`) |
| Atendimento → QR Codes das mesas | `atendimento.salao.ver` (gerar novo QR exige `admin.cardapio.editar`) |
| Caixa | `caixa.sessao.abrir` |
| Cozinha → KDS / Produção / Expedição | `cozinha.kds.ver` (botão "Produzir lote" em Produção exige `admin.estoque.editar`) |
| Cardápio | `admin.cardapio.editar` |
| Estoque → Estoque / Perdas | `admin.estoque.editar` |
| Compras → Lista de compras / Pedidos / Cotação / Preços | `admin.estoque.editar` |
| Financeiro → Resumo / Contas | `admin.financeiro.ver` (despesa fixa exige `admin.financeiro.editar`) |
| Relatórios | `admin.relatorios.ver` |
| Pessoas → Clientes | `admin.clientes.editar` |
| Pessoas → Equipe → Funcionários / Escala / Ponto / Desempenho | `admin.equipe.editar` |
| Pessoas → Equipe → Custo | `admin.equipe.custos.ver` |
| Marketing (Campanhas/Cupons/Inativos/Banner) | `admin.marketing.editar` |
| Auditoria | `auditoria.ver` |
| Configurações | `admin.configuracoes.editar` (conflitos de sincronização exige `admin.sync_conflitos.resolver`) |

## 5. Onde isso é aplicado no código

- **Trava real**: `restaurante.tem_permissao(text)` (lida no JWT via
  `restaurante.jwt_empresa_id()`/claim `papel`), usada dentro de policies
  de RLS e no início de toda RPC `SECURITY DEFINER`.
- **Conveniência de UI**: `can(permissao)` em `assets/js/data.js`, que
  consulta `MATRIZ[papel]` em `assets/js/config.js` — determina só o que
  aparece na tela, nunca o que o banco aceita gravar.
- **Catálogo único**: este documento → `insert into
  restaurante.papeis_permissoes` nas migrations → `PERM`/`MATRIZ` no
  client. Os três precisam ser atualizados juntos sempre que uma
  permissão nova for criada — não existe sincronização automática.
