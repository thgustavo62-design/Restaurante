# VISION FOOD — PLANO DE MELHORIAS TÉCNICAS E COMERCIAIS

> **Documento de planejamento — somente leitura.** Este arquivo foi produzido a partir da auditoria estática do repositório [thgustavo62-design/Restaurante](https://github.com/thgustavo62-design/Restaurante), branch `main`, commit de referência `3298da29e648fc73aa024e688a594380abe39298` (05/10/2026).
> **Data do plano:** 09/10/2026.
> **Escopo:** arquitetura, autenticação, autorização, atendimento, comandas, cozinha/KDS, caixa, estoque, financeiro, offline, testes, operação e preparação para comercialização.
> **Nenhum arquivo, commit, migração, configuração ou dado do repositório foi alterado.**
>
> **Nota de validação (09/10/2026):** os 6 achados P0 (VF-001 a VF-006) foram conferidos linha a linha contra o código real do repositório e estão **todos confirmados** — não são risco especulativo. Ver `CLAUDE.md` na raiz do projeto pra status de execução.

---

## 1. Objetivo e regras de implementação

O Vision Food já dispõe de módulos extensos para operação de restaurantes, mas deve priorizar **segurança, integridade das vendas e confiabilidade antes de adicionar novas funcionalidades**. Este documento funciona como um backlog para execução por um desenvolvedor ou agente de programação.

**Regras obrigatórias para qualquer execução futura:**

1. Não alterar a produção diretamente. Usar branch de desenvolvimento, projeto Supabase de homologação e dados artificiais.
2. Não remover funcionalidades, redesenhar todas as telas ou migrar o framework sem uma justificativa técnica e testes de regressão.
3. Preservar os fluxos existentes de salão, balcão, ficha, delivery, QR, KDS, caixa, estoque, compras, financeiro e clientes.
4. Para regras financeiras e de permissão, o **servidor/banco** é a fonte de verdade; esconder botões no navegador não é controle de segurança.
5. Manter histórico financeiro auditável. Evitar `UPDATE`/`DELETE` irrestritos em registros de pagamentos, caixa e movimentações.
6. Qualquer migração deve ter uma estratégia de rollback ou recuperação, bem como testes com a sequência completa das migrações.
7. Nunca usar credenciais de produção nos testes, divulgar `service_role`, desabilitar validação TLS ou executar testes destrutivos no restaurante real.
8. Verificar o estado atual do código antes de implementar: uma migration posterior pode ter substituído uma função anterior. A análise corresponde ao commit acima, não necessariamente a versões futuras.

### 1.1. Critérios para interpretar os achados

- **Confirmado no código:** o comportamento ou a ausência de checagem aparece nos arquivos inspecionados.
- **Risco potencial:** há um caminho plausível, mas a explorabilidade e o impacto real dependem de configuração, outras políticas, triggers ou execução contra staging.
- **Não verificado:** depende de acesso ao ambiente de produção, serviços externos, experiência de usuário real ou teste de integração.

**Prioridades:**

| Nível | Significado | Condição de avanço |
|---|---|---|
| **P0 — Bloqueador** | Risco direto a segurança, dinheiro, consistência do pedido ou capacidade de homologar | Resolver antes de operação financeira não supervisionada e antes de vender |
| **P1 — Alta** | Pode causar conflito, exposição indevida, erro de fluxo ou instabilidade | Resolver antes de expandir para vários estabelecimentos |
| **P2 — Média** | Escalabilidade, usabilidade, manutenção e operação | Evoluir após os bloqueadores |
| **P3 — Comercial** | Estrutura SaaS, integrações e novas oportunidades | Iniciar após estabilidade e piloto validado |

---

## 2. Resumo executivo — por onde começar

| ID | Prioridade | Melhoria | Resultado esperado |
|---|---|---|---|
| VF-001 | **P0** | Proteger status e totais das comandas no banco | Não existir alteração financeira fora das RPCs autorizadas |
| VF-002 | **P0** | Impedir descarte silencioso de operações offline | Nenhum pedido ou pagamento pendente sumir por falha de sincronização |
| VF-003 | **P0** | Fortalecer a autenticação e o controle de acesso | Senha robusta; PIN curto apenas como autorização operacional limitada |
| VF-004 | **P0** | Corrigir a contagem de falhas de PIN | Bloqueio/limite confiável mesmo quando o PIN está incorreto |
| VF-005 | **P0** | Restringir acesso a clientes e informações financeiras por perfil | Funcionários acessam apenas o necessário |
| VF-006 | **P0** | Criar homologação e executar testes existentes | Testes realmente executados, com resultados registrados |
| VF-007 | **P1** | Evitar duas comandas ativas para a mesma mesa | Mesa ocupada somente uma vez em concorrência |
| VF-008 | **P1** | Revogação efetiva de funcionários | Acesso antigo não continuar operando após desativação |
| VF-009 | **P1** | Isolar a fila offline por empresa, usuário e terminal | Dados não cruzam sessões no mesmo dispositivo |
| VF-010 | **P1** | Conciliar pagamentos em dinheiro feitos offline | Operações têm protocolo, status e resolução auditáveis |
| VF-011 | **P1** | Fortalecer idempotência de ações críticas | Reenvio não duplica pedidos, pagamentos ou descontos |
| VF-012 | **P1** | Validar autorizações e transições do KDS | Não alterar diretamente valores ou status indevidos |
| VF-013 | **P1** | Garantir backup, restore e rastreabilidade de deploy | Recuperar o sistema em caso de incidente |
| VF-014 | **P1** | Restringir ou endurecer a descoberta de logins | Reduzir exposição e abuso na superfície de autenticação |
| VF-015 | **P2** | Paginar e modularizar `carregarTudo()` | Abertura mais rápida e estável com muitos registros |
| VF-016 | **P2** | Quebrar componentes JS de grande porte por domínio | Diminuir acoplamento e regressões |
| VF-017 | **P2** | Alinhar interface do caixa com cálculo do servidor | Valor apresentado, confirmado e recibo sempre conciliados |
| VF-018 | **P2** | Otimizar refresh/Realtime, UX de erro e estados vazios | Uso consistente em terminais lentos e rede instável |
| VF-019 | **P2** | Padronizar relatórios financeiros e indicadores | KPIs auditáveis e reconciliáveis |
| VF-020 | **P2** | Completar impressão térmica operacional | Tickets corretos por setor, com fallback |
| VF-021 | **P2** | Revisar documentação e migrações | Documentação não contradiz código nem produção |
| VF-022 | **P3** | Provisionamento multiempresa e planos | Cadastro e ativação comercial sem SQL manual |
| VF-023 | **P3** | Personalização de marca por restaurante | Dados, recibos e cardápio com marca própria |
| VF-024 | **P3** | Integração Pix real | Cobrança e conciliação seguras, se escolhida |
| VF-025 | **P3** | Emissão fiscal NFC-e | Atendimento às necessidades fiscais aplicáveis |
| VF-026 | **P3** | Suporte, observabilidade e gestão de incidentes | Operação multi-cliente sustentável |

---

# 3. P0 — BLOQUEADORES

## VF-001 — Blindar comandas e registros financeiros no banco

**Classificação:** P0 — crítico.
**Achado:** as políticas de `UPDATE` das comandas são abrangentes. Os triggers de proteção inspecionados controlam algumas colunas (`desconto_centavos`, `mesa_id`, `tipo` etc.), mas não comprovam a proteção específica de todos os campos de liquidação (`status`, `fechamento`, `total_centavos` e outros). **A ausência de validação explícita nesses caminhos é confirmada no código inspecionado; a exploração efetiva deve ser reproduzida no staging.**

**Referências:**

- `supabase/migrations/0021_bootstrap_schema_restaurante.sql`
- `supabase/migrations/0038_protege_colunas_sensiveis_restaurante.sql`
- `supabase/migrations/0043_rpc_autorizacao_supervisor_restaurante.sql`
- `supabase/migrations/0064_etapa0_correcoes_e_subabas_restaurante.sql`
- `supabase/migrations/0070_controle_equipe_restaurante.sql`
- `assets/js/actions-caixa.js`

**Solução recomendada:**

1. Levantar a **definição efetiva** de policies, triggers e grants de `restaurante.comandas`, `restaurante.comanda_itens`, `restaurante.pagamentos`, `restaurante.caixa_movimentos`, `restaurante.contas` e `restaurante.caixa_sessoes` após aplicar **todas** as migrations.
2. Definir uma máquina de estados autorizada: `ABERTA → FECHANDO → PAGA`, retorno controlado de `FECHANDO` e cancelamento somente pelo fluxo permitido.
3. Impedir que clientes alterem diretamente `status`, `fechamento`, `total_centavos`, `troco_centavos`, campos de pagamento consolidado e marcadores de baixa em estoque.
4. Centralizar liquidação, cancelamento financeiro, reabertura e ajustes nas RPCs autorizadas, com auditoria e verificação de papel/empresa.
5. Garantir que o bypass de trigger seja utilizado apenas por rotinas privilegiadas e não possa ser ativado por usuários comuns por meio de funções públicas.
6. Revisar o `INSERT` direto em `pagamentos`, `caixa_movimentos` e `contas`, especialmente quando um perfil possui `caixa.pagamento.registrar`: preferir gravação exclusivamente através das transações de negócio.
7. Criar testes de permissão usando perfis `ADMIN`, `GERENTE`, `CAIXA`, `GARCOM`, `COZINHA`, incluindo tentativas diretas por API.

**Critérios de aceite:**

- [ ] Um GARCOM não consegue marcar uma comanda como `PAGA` diretamente.
- [ ] Um CAIXA não consegue editar `total_centavos` fora da RPC de pagamento.
- [ ] Não é possível inserir um pagamento avulso que falseie faturamento/caixa.
- [ ] `confirmar_pagamento` segue fechando corretamente, incluindo divisão por item, fidelidade, cupom e estoque.
- [ ] Todas as tentativas negadas deixam a integridade da comanda intacta.
- [ ] Existem testes reproduzíveis que comprovam os controles acima.

## VF-002 — Corrigir perda silenciosa da fila offline

**Classificação:** P0 — crítico.
**Achado confirmado:** `offlineProcessarItem()` retorna sucesso para algumas recusas definitivas do servidor; `offlineSincronizar()` remove o item quando recebe `true`. `offlineEnfileirar()` também captura falhas de persistência sem necessariamente propagá-las ao fluxo chamador.

**Referências:** `assets/js/offline.js`, `assets/js/actions-caixa.js`, `assets/js/actions-atendimento.js`.

**Solução recomendada:**

1. Trocar retornos booleanos por estados explícitos: `ENVIADO`, `PENDENTE_REDE`, `RECUSADO_VALIDACAO`, `CONFLITO`, `FALHA_LOCAL`.
2. **Excluir da fila somente após confirmação inequívoca de persistência no servidor** ou conciliação explícita de duplicidade.
3. Para erros de validação, manter o item visível e recuperável; não descartar após exibir um toast temporário.
4. Deixar a falha de gravação no IndexedDB chegar ao chamador. Não exibir "guardado no aparelho" quando a persistência falhar.
5. Disponibilizar uma área de **Pendências de sincronização**, com data, terminal, operador, tipo, valor e ação de resolução.
6. Em pagamentos recusados, criar um fluxo de conferência humana com histórico antes de qualquer descarte.
7. Testar interrupção de rede, fechamento do navegador, armazenamento indisponível, duplicidade e reconexão com login diferente.

**Critérios de aceite:**

- [ ] Pedido rejeitado pelo banco continua disponível e identificável.
- [ ] Pagamento offline rejeitado permanece pendente de conciliação.
- [ ] Se o IndexedDB falhar, a interface alerta de forma bloqueante e não diz que gravou.
- [ ] Falha transitória não elimina dados.
- [ ] Usuário consegue localizar e resolver cada pendência com trilha de auditoria.

## VF-003 — Autenticação robusta; separar senha de PIN operacional

**Classificação:** P0 — crítico.
**Achado confirmado:** quatro caracteres alfanuméricos são aceitos como **senha real** das contas do Supabase Auth; o bloqueio local do navegador não protege chamadas diretas ao Auth.

**Referências:**

- `supabase/migrations/0068_pin_alfanumerico_restaurante.sql`
- `assets/js/actions-atendimento.js`
- `assets/js/render-login.js`
- `assets/js/config.js`
- `docs/rotas-permissoes.md`

**Solução recomendada:**

1. Usar credenciais fortes para login de conta (senha compatível com a política de segurança definida, autenticação por e-mail, passkey ou outro método seguro adequado ao contexto).
2. Tratar PIN curto como **autorização operacional secundária**, com escopo, expiração, tentativas limitadas e, quando necessário, segundo fator; não usá-lo como a única senha de uma conta administrativa.
3. Exigir MFA para operações administrativas sensíveis ou pelo menos obrigá-lo para proprietários/admins e para troca de credenciais.
4. Configurar limites de autenticação e mecanismos antiabuso no servidor/provedor, sem depender apenas de temporizador em JavaScript.
5. Planejar migração gradual dos funcionários existentes sem interromper o expediente, incluindo recuperação segura de conta e troca forçada das credenciais fracas.
6. Não guardar senhas, tokens, PINs ou respostas de autenticação em logs de erros.

**Critérios de aceite:**

- [ ] Não existe conta administrativa autenticada exclusivamente por senha de quatro caracteres.
- [ ] O rate limit de autenticação é aplicado no serviço, inclusive fora da interface.
- [ ] Criação e recuperação de credenciais possuem fluxo seguro.
- [ ] A autorização rápida de supervisor continua operacional, mas com controles próprios.
- [ ] Migração e rollback foram ensaiados em homologação.

## VF-004 — Corrigir a persistência de tentativas de PIN inválidas

**Classificação:** P0 — crítico.
**Achado confirmado:** no fluxo de `verificar_pin_supervisor` e de `bater_ponto`, uma tentativa é inserida em `tentativas_autorizacao` e depois o código lança uma exceção quando o PIN é incorreto. Em PostgreSQL, a exceção não capturada aborta a transação e normalmente desfaz o próprio `INSERT`. A proteção de 5 falhas/5 minutos pode, portanto, não acumular as tentativas como esperado.

**Referências:**

- `supabase/migrations/0068_pin_alfanumerico_restaurante.sql`
- `supabase/migrations/0070_controle_equipe_restaurante.sql`
- `supabase/migrations/0043_rpc_autorizacao_supervisor_restaurante.sql`

**Solução recomendada:**

1. Desacoplar a gravação das tentativas da transação que gera erro. Preferir um mecanismo confiável de rate limit fora da mesma transação (serviço/API de autorização apropriado) ou um resultado controlado que seja confirmado sem rollback.
2. Definir limites por usuário, restaurante, origem e janela de tempo, considerando limitações e privacidade.
3. Assegurar que o controle resista a várias sessões/dispositivos.
4. Verificar que a contagem de tentativas não cria uma possibilidade de negação de serviço injustificada.
5. Testar a quinta e a sexta tentativa, a expiração do bloqueio e a tentativa correta após o prazo.

**Critérios de aceite:**

- [ ] Cinco senhas erradas geram cinco tentativas persistidas.
- [ ] A tentativa seguinte dentro da janela é bloqueada no backend.
- [ ] Reiniciar navegador ou mudar de computador não contorna o limite.
- [ ] O fluxo de supervisor e o registro de ponto continuam funcionando com PIN válido.

## VF-005 — Restringir leitura de dados por papel e necessidade

**Classificação:** P0 — segurança e privacidade.
**Achado confirmado no código inspecionado:** políticas de `SELECT` em algumas tabelas como `clientes`, `contas` e `usuarios` restringem apenas pelo `empresa_id`; isso não é o mesmo que restringir pelos privilégios do perfil. Reavaliar as permissões efetivas após todas as migrations.

**Referências:** `supabase/migrations/0021_bootstrap_schema_restaurante.sql`, `supabase/migrations/0055_cadastro_clientes_restaurante.sql`, `docs/rotas-permissoes.md`.

**Solução recomendada:**

1. Criar matriz por perfil e **por operação**: leitura, cadastro, atualização, exclusão, cancelamento, exportação.
2. Proteger contas e saldos do financeiro para perfis com direito de visualização, sem bloquear os resumos mínimos necessários ao caixa.
3. Minimizar campos pessoais de clientes expostos ao garçom/cozinha; usar views ou RPCs com projeção reduzida quando adequado.
4. Proteger e-mails internos, dados de credenciais, campos administrativos e remuneração dos funcionários.
5. Revisar `SECURITY DEFINER` para evitar que RPCs retornem colunas além do necessário.
6. Testar acesso direto via Supabase JS/PostgREST, não apenas a visibilidade das abas.

**Critérios de aceite:**

- [ ] COZINHA não consegue consultar contas financeiras por API.
- [ ] GARCOM vê apenas os dados de cliente exigidos pelo atendimento.
- [ ] GERENTE/ADMIN acessam dados permitidos conforme matriz definida.
- [ ] Um restaurante nunca consegue consultar dados de outro.
- [ ] Testes de RLS cobrem pelo menos os cinco papéis do sistema.

## VF-006 — Criar staging e homologar testes que hoje não têm execução comprovada

**Classificação:** P0 — confiabilidade.
**Achado confirmado:** há testes em `tests/`, mas `tests/README.md` afirma que não foram executados em um Supabase de homologação. O repositório não apresentou histórico de execuções de CI durante a auditoria, e `main` estava sem proteção de branch.

**Referências:** `tests/README.md`, `tests/setup.js`, `tests/*.test.js`, `supabase/migrations/`, configurações do repositório.

**Solução recomendada:**

1. Criar um projeto Supabase **separado** de produção, com variáveis e credenciais exclusivas.
2. Aplicar as migrations **de `0001` até `0074` em ordem**, sem saltar etapas; validar criação em base limpa.
3. Rodar `npm test` na pasta `tests` e salvar evidências das falhas e aprovações.
4. Corrigir incompatibilidades e suposições dos testes antes de declarar a suíte verde.
5. Adicionar pipeline para sintaxe JavaScript, testes de banco, testes de interface (E2E) e verificações de segurança.
6. Impedir deploy em produção quando testes obrigatórios falharem; exigir revisão ou aprovação para migrações críticas.
7. Verificar o mecanismo de deploy de migrations: o README registra aplicação manual e menciona uma integração automática não confirmada.

**Critérios de aceite:**

- [ ] Banco de staging nasce do zero só com migrations versionadas.
- [ ] Todos os testes automatizados executam e têm resultado registrado.
- [ ] Fluxo de venda completa e parcial, desconto, estoque, NFC/QR fictícios, caixa e permissões possuem cobertura.
- [ ] Branch principal exige verificações mínimas e processo de revisão.
- [ ] Testes continuam impossibilitados de acessar a produção.

---

# 4. P1 — CONFIABILIDADE, CONCORRÊNCIA E CONTROLE

## VF-007 — Exclusividade de mesa ocupada e reservas concorrentes

**Achado:** `sentar_reserva` e `sentar_fila` validam a mesa e criam comanda, mas o código inspecionado não confirma uma checagem transacional suficiente para impedir duas comandas ativas no mesmo lugar.

**Arquivos:** `supabase/migrations/0073_reservas_fila_restaurante.sql`, `assets/js/actions-atendimento.js`, `supabase/migrations/0021_bootstrap_schema_restaurante.sql`.

**Ações:**

- Verificar a disponibilidade da mesa **dentro da mesma transação**, com bloqueio/serialização apropriados.
- Estabelecer uma invariável no banco que impeça ocupações incompatíveis, respeitando transferências e mesas agrupadas.
- Recusar reserva `NAO_VEIO` ou status indevido ao tentar sentar; validar transições permitidas.
- Criar teste com duas sessões competindo pela mesma mesa.

**Aceite:** só uma transação consegue criar a ocupação ativa; a outra recebe erro claro sem gerar comanda duplicada.

## VF-008 — Revogar permissões de funcionários desativados imediatamente

**Achado:** as funções de RLS utilizam `empresa_id` e papel registrados no JWT, emitido quando o usuário estava ativo. Um token antigo pode sobreviver à alteração do cadastro.

**Arquivos:** `supabase/migrations/0021_bootstrap_schema_restaurante.sql`, `supabase/migrations/0064_etapa0_correcoes_e_subabas_restaurante.sql`.

**Ações:** revisar operações críticas para exigir estado atual do funcionário (`ativo` e `papel`), definir revogação de sessões no Auth e testar a expiração/revogação de leitura e escrita, inclusive Realtime.

**Aceite:** um usuário desativado não consegue executar operações protegidas nem recuperar dados sensíveis com o token pré-existente.

## VF-009 — Isolar o offline por empresa, funcionário e terminal

**Achado:** a base IndexedDB `vision_food_offline` é global para a origem, e a fila não usa uma partição obrigatória pelo contexto de autenticação.

**Arquivos:** `assets/js/offline.js`, `assets/js/main.js`, `assets/js/actions-atendimento.js`.

**Ações:** associar registros a `empresa_id`, `usuario_id`, `terminal_id`, versão do payload e protocolo único; impedir sincronização em contexto divergente; manter dados pendentes mesmo ao fazer logout, protegidos contra acesso por outra conta; permitir transferência ou resolução explícita com autorização.

**Aceite:** trocar de restaurante ou usuário no mesmo navegador não envia dados da sessão anterior.

## VF-010 — Conciliar pagamentos em dinheiro realizados sem internet

**Achado:** há pagamento em dinheiro offline com confirmação posterior e `sync_conflitos`. O recurso merece uma reconciliação reforçada para perdas, duplicidade, troca de caixa e término de expediente.

**Arquivos:** `assets/js/actions-caixa.js`, `assets/js/offline.js`, `supabase/migrations/0064_etapa0_correcoes_e_subabas_restaurante.sql`, `supabase/migrations/0070_controle_equipe_restaurante.sql`.

**Ações:**

1. Cada recebimento offline deve possuir protocolo próprio, valor, comanda, itens, operador, terminal, caixa e instante local.
2. O backend deve reconhecer o protocolo e aceitar a operação **uma única vez**.
3. Operações recusadas permanecem em área de conciliação, com motivo e decisão humana rastreável.
4. Fechamento de caixa deve alertar para recebimentos offline ainda pendentes.
5. Exibir diferença entre **recebido fisicamente**, **registrado no servidor** e **em conciliação**.

**Aceite:** reconexão repetida não duplica a venda; erro de conexão não perde dinheiro em registro; gerente consegue conciliar com comprovante.

## VF-011 — Idempotência e recuperação de ações críticas

**Achado:** existem UUIDs de cliente para itens e filas, mas é preciso provar a idempotência de cada operação importante.

**Arquivos:** `supabase/migrations/0070_controle_equipe_restaurante.sql`, `supabase/migrations/0048_transferir_item_comanda_juntar_mesas_restaurante.sql`, `assets/js/offline.js`.

**Ações:** exigir chave única nas operações financeiras e nos pedidos offline; persistir estado `RECEBIDO/PROCESSANDO/APLICADO/ERRO`; resposta idêntica ao repetir a mesma chave; não reutilizar chave para ações diferentes; criar teste de confirmação sem resposta seguida de retry.

**Aceite:** qualquer reenvio deliberado de um pagamento previamente confirmado retorna o resultado anterior sem duplicar pagamento, pontos ou estoque.

## VF-012 — Máquina de estados do KDS e operação por setor

**Achado:** existem alterações de `comanda_itens.status` por `UPDATE` direto. A proteção inspecionada verifica cancelamento, mas não demonstra todas as transições válidas por perfil e etapa.

**Arquivos:** `assets/js/actions-caixa.js`, `assets/js/actions-atendimento.js`, `supabase/migrations/0038_protege_colunas_sensiveis_restaurante.sql`, `supabase/migrations/0070_controle_equipe_restaurante.sql`.

**Ações:** validar no banco transições `PENDENTE → PREPARANDO → PRONTO → ENTREGUE`, com exceções autorizadas; impedir regressões não justificadas, mudanças em itens pagos/cancelados e manipulação de timestamps; proteger KDS de alterações de preço/produto; testar avanço de ticket e expedição parcial.

**Aceite:** transição ilegal falha no banco e não é exibida como sucesso no tablet.

## VF-013 — Backup, recuperação e deploy rastreável

**Achado:** a auditoria do repositório não comprovou política efetiva de backups automáticos ou teste de restauração. Isso **não significa** que o Supabase não possua proteção externa; o estado de produção precisa ser verificado.

**Arquivos/locais:** configuração do Supabase, histórico de migrações, README de implantação, GitHub Actions.

**Ações:** inventariar backups gerenciados, agendar exportações independentes quando necessário, definir objetivos RPO/RTO, documentar restore em ambiente isolado, proteger migrations e registrar versão do banco no deploy.

**Aceite:** restauração completa de base de teste a partir de backup realista, com registro de duração e integridade.

## VF-014 — Reduzir enumeração de funcionários e abuso de autenticação

**Achado:** `usuarios_login_por_empresa(p_slug)` é chamável sem autenticação e devolve nomes e e-mails internos dos usuários ativos para aquele restaurante. O slug é público no cardápio.

**Arquivos:** `supabase/migrations/0044_login_por_empresa_email_estavel_restaurante.sql`, `assets/js/data.js`, `assets/js/render-login.js`.

**Ações:** evitar devolver e-mails internos ao cliente; preferir resolver usuário→identidade de login em endpoint próprio com proteção antiabuso; não listar funcionários publicamente sem necessidade; limitar chamadas e registrar padrões abusivos. Reavaliar conveniência de login por nome em dispositivos compartilhados.

**Aceite:** conhecer o slug público não permite enumerar credenciais de login internas; fluxo legítimo continua simples.

---

# 5. P2 — QUALIDADE OPERACIONAL, PERFORMANCE E MANUTENÇÃO

## VF-015 — Redesenhar carregamento de dados sem perder funcionalidades

**Achado:** `carregarTudo()` executa muitas chamadas `select('*')`, inclusive para clientes e contas, e aplica paginação apenas em parte dos recursos.

**Arquivo:** `assets/js/data.js`.

**Ações:**

- Criar carregamento essencial: empresa, permissões, mesas, comandas ativas e cardápio.
- Carregar dados de compras, financeiro, equipe, auditoria e histórico sob demanda por aba.
- Aplicar paginação, filtros por período e projeção de colunas.
- Evitar recarregar todos os módulos após uma alteração de baixa abrangência.
- Medir desempenho com volume simulado (por exemplo, 100/1.000/10.000 clientes e históricos crescentes).

**Aceite:** primeiro acesso mostra o salão sem esperar consultas não essenciais; nenhuma lista grande depende de buscar o histórico completo.

## VF-016 — Refatoração gradual dos arquivos JavaScript grandes

**Achado:** `render-screens.js`, `render-modals.js` e `events.js` concentram muitas responsabilidades e dependem de globais.

**Arquivos:** `assets/js/render-screens.js`, `assets/js/render-modals.js`, `assets/js/events.js`, `assets/js/state.js`, `index.html`.

**Ações:** extrair módulos por domínio (`atendimento`, `caixa`, `estoque`, `compras`, `equipe`, `relatorios`), padronizar contratos e dados tipados via JSDoc/TypeScript progressivo se útil; criar testes antes de separar. Considerar módulos ES, sem exigir migração completa de framework.

**Aceite:** telas mantêm o comportamento; arquivos por domínio possuem funções menores e testes; dependências deixam de depender de ordem implícita de carregamento quando possível.

## VF-017 — Usar valor calculado no banco em todos os pontos de cobrança

**Achado:** a documentação registra divergências históricas de prévia de desconto/taxa; o código atual já chama `calcular_total_pagamento`, mas é necessário validar todas as combinações, inclusive pagamento parcial.

**Arquivos:** `assets/js/actions-caixa.js`, `assets/js/render-modals.js`, `supabase/migrations/0070_controle_equipe_restaurante.sql`.

**Ações:** unificar prévia, confirmação, troco, recibo e relatórios em dados devolvidos pelo servidor; tratar respostas assíncronas antigas; bloquear confirmação enquanto o cálculo de preço está desatualizado; testar descontos manuais + cupom + pontos + taxa + métodos mistos.

**Aceite:** a diferença entre valor mostrado ao operador e o valor gravado é zero centavo nos casos homologados.

## VF-018 — Melhorar UX de erro, Realtime e retomada

**Arquivos:** `assets/js/data.js`, `assets/js/main.js`, `assets/js/render-screens.js`, `assets/js/offline.js`.

**Ações:** padronizar estados `CARREGANDO`, `ATUALIZADO`, `SEM_CONEXAO`, `CONFLITO`, `ERRO`, com mensagem contextual; usar badges discretos de sincronização; evitar renderizações completas em excesso; implementar reconexão controlada e recarga parcial; registrar métricas de falhas.

**Aceite:** o funcionário distingue sem ambiguidade um pedido salvo, pendente, recusado ou ainda não enviado.

## VF-019 — Conciliação entre Central do Dono, DRE e movimentos

**Arquivos:** `supabase/migrations/0065_central_do_dono_restaurante.sql`, `supabase/migrations/0072_financeiro_simples_restaurante.sql`, `supabase/migrations/0045_relatorios_confiaveis_restaurante.sql`, `supabase/migrations/0052_relatorio_gestao_restaurante.sql`.

**Ações:** definir semanticamente faturamento, receita recebida, recebíveis, CMV, perdas, taxa de serviço, custo de equipe e resultado; reconciliar todos os indicadores com movimentos de origem; impedir dupla contagem em pagamentos parciais e cancelamentos; demonstrar fórmulas e período ao usuário.

**Aceite:** relatórios fecham entre si para cenários de venda parcial, desconto, cancelamento e recebíveis.

## VF-020 — Impressão térmica e contingência por setor

**Achado confirmado pela documentação:** a impressão depende de `window.print()`; impressão automática por setor não está implementada.

**Arquivos:** `assets/js/print.js`, `README.md` e configurações de impressão.

**Ações:** planejar agente local como QZ Tray ou alternativa com impressora de rede; mapear setores (bar/cozinha/brasa/sobremesa) e terminais; criar fila de impressão com idempotência e reimpressão auditada; manter fallback manual; definir comportamento sem internet/agente offline.

**Aceite:** um pedido de vários setores produz tickets separados, cada um apenas uma vez, com reimpressão identificada.

## VF-021 — Documentação e coerência entre código, migrations e produção

**Achado:** o README descreve algumas pendências antigas que já foram implementadas em migrations posteriores; ele também registra deploy manual e automação não confirmada.

**Arquivos:** `README.md`, `docs/ER.md`, `docs/rotas-permissoes.md`, `tests/README.md`, `supabase/migrations/`.

**Ações:** manter matriz **implementado / parcial / não implementado / não homologado**; gerar o diagrama ER do schema atual; registrar a versão efetiva em produção; documentar onboarding, incidentes, backup, restauração e deploy; revisar informações de funcionalidades conforme commits.

**Aceite:** alguém novo consegue subir o sistema de staging seguindo somente a documentação, sem depender de instruções informais.

---

# 6. P3 — PREPARAÇÃO PARA VENDA E EXPANSÃO

## VF-022 — Construir a operação SaaS multi-restaurante

**Estado atual:** há estrutura multiempresa e onboarding por função SQL, mas não foi confirmado um ciclo comercial completo de contratação, cobrança, ativação, suspensão e cancelamento.

**Ações:**

1. Definir planos, limites e recursos por assinatura.
2. Criar provisionamento de restaurante e primeiro administrador com fluxo seguro.
3. Introduzir assinatura, período de teste, estado de cobrança e bloqueio gracioso.
4. Garantir que a configuração de um cliente não interfira nos dados de outro.
5. Criar painel interno de operação e suporte, com acesso privilegiado restrito e auditado.
6. Prever migração de dados e exportação ao encerrar o contrato.

**Aceite:** restaurante de teste consegue contratar/ativar, configurar cardápio, criar equipe e iniciar operação sem execução manual de SQL.

## VF-023 — White-label e personalização por restaurante

**Estado atual:** Vision Food é marca da plataforma, mas ainda há recursos estáticos ligados ao Rancho Netto, inclusive favicon/imagens do cardápio público.

**Ações:** nome comercial, logotipo, favicon, cores opcionais, dados empresariais, rodapé de recibos, domínio/cardápio, QR, setores de produção, taxa de serviço e configurações por empresa.

**Aceite:** novo restaurante visualiza somente a própria identidade nas superfícies voltadas ao cliente.

## VF-024 — Pagamento Pix real e conciliação (opcional)

**Estado atual:** Pix na interface está marcado como simulado. Não considerá-lo um pagamento bancário confirmado.

**Ações:** escolher provedor, integrar via backend/Edge Function com segredos protegidos, criar cobrança única, receber webhooks autenticados e idempotentes, conciliar retorno com comanda e caixa; prever fallback manual auditado.

**Aceite:** teste homologado de pagamento, expiração, duplicidade de webhook, estorno e indisponibilidade do provedor. Não apresentar QR ilustrativo como pagamento real.

## VF-025 — NFC-e e requisitos fiscais (opcional conforme operação)

**Estado atual:** o sistema imprime comprovantes **não fiscais**; emissão NFC-e não foi implementada.

**Ações:** avaliar necessidade fiscal por UF e operação com contador, selecionar integrador e certificado, desenhar emissão/contingência, registrar vínculos entre venda e documento fiscal e gerir falhas.

**Aceite:** fluxo homologado aplicável ao estabelecimento com autorização, rejeição, cancelamento e contingência; recibos não fiscais devidamente identificados.

## VF-026 — Suporte, observabilidade e gestão de incidentes

**Estado atual:** há registro de erros de cliente; não foi identificada uma operação completa de suporte multiempresa.

**Ações:** logs estruturados com identificação de correlação, alertas de falha em pagamento/QR/sync, painel de incidentes, trilha de mudanças, resposta operacional, status de dependências, retenção adequada e controle do acesso de suporte a dados pessoais.

**Aceite:** incidente de venda ou sincronização pode ser localizado sem expor PIN/token/dados sensíveis, e a equipe consegue entender seu estado e resolução.

---

# 7. PLANO DE HOMOLOGAÇÃO — CENÁRIOS OBRIGATÓRIOS

## 7.1. Segurança e autorização

- [ ] GARCOM tenta alterar total/status da comanda diretamente via API: bloqueado.
- [ ] COZINHA tenta cancelar item sem supervisor: bloqueado.
- [ ] CAIXA tenta acessar dados financeiros fora do seu escopo: bloqueado.
- [ ] Funcionário da Empresa A tenta listar dados da Empresa B: bloqueado.
- [ ] Funcionário desativado tenta operar com token emitido antes da desativação: bloqueado.
- [ ] Cinco PINs incorretos são registrados; próxima tentativa é bloqueada no backend.
- [ ] Ter o slug público não permite descobrir e-mails internos de funcionários.
- [ ] Usuário não consegue elevar papel ou alterar campos sensíveis por API.

## 7.2. Atendimento, caixa e concorrência

- [ ] Dois operadores tentam abrir a mesma mesa ao mesmo tempo: uma ocupação válida.
- [ ] Abrir, dividir por itens, pagar parcialmente e finalizar: sem pagamento duplicado.
- [ ] Pagamento com dinheiro + cartão e troco: valores reconciliados.
- [ ] Desconto manual + pontos + cupom + taxa: prévia, cobrança e recibo iguais.
- [ ] Cancelar item após iniciar preparo: efeito de estoque/perda consistente.
- [ ] Fechar caixa com diferença: justificativa e auditoria conforme regra.
- [ ] Duas sessões de caixa operam sem registrar movimentos uma na outra.
- [ ] Reenvio da mesma solicitação de pagamento: exatamente uma operação financeira.

## 7.3. Offline e retomada

- [ ] Pedido offline entra na fila e é confirmado após reconectar.
- [ ] Banco recusa um pedido: item fica em pendências, nunca desaparece.
- [ ] Pagamento offline com erro de validação: fica em conciliação.
- [ ] IndexedDB indisponível: erro explícito; aplicativo não finge gravação.
- [ ] Operador troca de conta/restaurante antes de sincronizar: não cruza operações.
- [ ] Reenvio após perda da resposta: nenhuma duplicidade de pedido/pagamento.
- [ ] Fechamento de caixa com valores offline pendentes exige revisão.

## 7.4. Estoque, produção e relatórios

- [ ] Venda com ficha técnica baixa insumos uma única vez.
- [ ] Produção de sub-receita consome ingredientes e credita lote corretamente.
- [ ] Cancelamento após preparo registra perda sem dupla baixa.
- [ ] Inventário registra diferença e efeito financeiro de modo consistente.
- [ ] Central do Dono, DRE, pagamentos e movimentos conciliam no mesmo período.
- [ ] KDS não deixa avançar item cancelado nem retroceder sem fluxo autorizado.
- [ ] Realtime em dois terminais converge sem perder um status mais recente.

## 7.5. Recuperação e implantação

- [ ] Staging recriado do zero com todas as migrations.
- [ ] Suíte de integração executada integralmente com resultados registrados.
- [ ] Testes E2E dos caminhos críticos aprovados.
- [ ] Backup restaurado em ambiente isolado.
- [ ] Mudança SQL não chega à produção antes de testes e aprovação.
- [ ] Existe plano de recuperação documentado e conhecido pela operação.

---

# 8. ORDEM DE EXECUÇÃO RECOMENDADA

## Fase A — Segurança financeira e autenticação

**Escopo:** VF-001, VF-003, VF-004, VF-005, VF-014.

**Entrega:** impedir adulteração financeira por API, endurecer a autenticação e fechar exposições desnecessárias. Incluir testes de regressão e de permissões desde o início.

**Critério de saída:** não existem caminhos conhecidos e reproduzíveis de escrita financeira sem autorização ou vazamento excessivo de dados por perfil.

## Fase B — Offline seguro e consistência de operação

**Escopo:** VF-002, VF-007, VF-009, VF-010, VF-011, VF-012.

**Entrega:** filas recuperáveis, operações idempotentes, mesa exclusiva e KDS com transições válidas.

**Critério de saída:** nenhuma falha simulada de conexão pode gerar perda silenciosa, duplicidade de cobrança ou mesa ocupada duas vezes.

## Fase C — Homologação e recuperação

**Escopo:** VF-006, VF-008, VF-013, VF-017, VF-019, VF-021.

**Entrega:** staging, testes integrados, regressão, relatórios conciliados, backups e documentação confiável.

**Critério de saída:** fluxos essenciais passam em testes automáticos e em um piloto monitorado, com plano de recuperação testado.

## Fase D — Experiência, escalabilidade e operação

**Escopo:** VF-015, VF-016, VF-018, VF-020.

**Entrega:** desempenho, manutenção mais simples, estados de sincronização claros e impressão operacional.

**Critério de saída:** operação estável em aparelhos e rede típicos do restaurante, sem degradação relevante com volume crescente.

## Fase E — Comercialização

**Escopo:** VF-022 a VF-026.

**Entrega:** onboarding SaaS, planos, identidade por restaurante, integrações selecionadas e suporte.

**Critério de saída:** segundo restaurante inicia uma operação de teste sem ações manuais arriscadas nem dependência da estrutura do primeiro.

---

# 9. MODELO DE TAREFA PARA EXECUÇÃO POR IA OU DESENVOLVEDOR

Para cada item deste plano, copiar o seguinte modelo para a descrição da implementação:

```md
## Tarefa: VF-XXX — [título]

### Objetivo
Descrever o comportamento a corrigir e por que importa para o restaurante.

### Inspeção obrigatória
Ler migrations existentes e descobrir a definição efetiva de funções,
triggers, policies e chamadas do cliente. Não presumir que migration
antiga seja a versão atual.

### Restrições
- Não alterar produção diretamente.
- Não remover funcionalidades existentes.
- Preservar isolamento por restaurante e RBAC.
- Não registrar dados sensíveis em logs.
- Manter operações financeiras transacionais e idempotentes.

### Implementação
1. Criar testes que reproduzam o problema no staging.
2. Fazer a menor correção segura possível.
3. Criar nova migration versionada quando necessário.
4. Atualizar documentação relevante.
5. Rodar regressão completa dos fluxos afetados.

### Critérios de aceite
[Inserir checklist do item VF-XXX]

### Evidências a entregar
- Arquivos alterados e justificativa.
- Migration(s) adicionada(s), se houver.
- Testes executados e resultados.
- Riscos remanescentes e procedimento de rollback.
```

---

# 10. INDICADORES PARA SABER SE AS MELHORIAS FUNCIONARAM

Estabelecer linha de base antes de comparar resultados. As métricas abaixo são sugestões de gestão, não valores atualmente medidos.

| Indicador | Meta inicial sugerida |
|---|---|
| Operações offline descartadas sem conciliação | **0** |
| Pagamentos duplicados por reenvio | **0** |
| Comandas ativas incompatíveis na mesma mesa | **0** |
| Mudanças financeiras diretas sem RPC autorizada | **0** |
| Testes de permissão críticos passando no staging | **100%** |
| Testes de integração críticos passando antes de deploy | **100%** |
| Backups recuperáveis validados | **Sim, em teste periódico** |
| Falhas de sincronização sem visibilidade para o operador | **0** |
| Diferença entre cobrança, recibo e movimento financeiro | **R$ 0,00** nos cenários homologados |
| Tempo de abertura do salão / KDS | Medir em dispositivo real e estabelecer SLA |

---

# 11. DECISÃO DE PRODUTO — O QUE NÃO FAZER AGORA

Até completar P0 e os P1 de integridade, **não priorizar**:

- Reescrever o aplicativo inteiro em outro framework apenas por estética.
- Lançar mais módulos grandes de gestão sem testes do caixa e do estoque.
- Abrir contratos com muitos restaurantes sem controle consistente de autenticação, migração e backup.
- Tratar o Pix demonstrativo como integração bancária pronta.
- Tratar recibos de `window.print()` como emissão fiscal.
- Automatizar toda a aceitação de pedidos QR sem prova de resistência a abuso e de capacidade operacional.

---

# 12. CHECKLIST FINAL DE PRONTIDÃO PARA VENDER

- [ ] Segurança do login e permissões auditadas por papéis.
- [ ] Registro de comandas, caixa e estoque íntegro contra escrita direta.
- [ ] Offline com recuperação, conciliação e idempotência.
- [ ] Testes de integração executados em staging, não apenas escritos.
- [ ] Testes de navegador para atendimento, KDS, caixa, QR e administração.
- [ ] Backup e restauração comprovados.
- [ ] Atualização e rollback de migrations documentados.
- [ ] Abertura e ocupação de mesas sem colisão entre terminais.
- [ ] Indicadores financeiros consistentes e verificáveis.
- [ ] Contrato, privacidade, retenção e suporte definidos.
- [ ] Onboarding de nova empresa isolado e reproduzível.
- [ ] Explicitação comercial do que **não** está incluído (PIX real, NFC-e, impressão automática etc., enquanto não homologados).
- [ ] Piloto acompanhado em restaurante real, com registros de incidentes e correções.

---

## Conclusão

**O Vision Food possui escopo funcional suficiente para justificar investimento em qualidade, não uma reconstrução total.** O próximo ciclo deve priorizar **segurança financeira, autenticação, offline recuperável e homologação automatizada**. Somente depois faz sentido ampliar a oferta SaaS, integrações e marketing.

**Limitação desta análise:** o plano decorre de inspeção de arquivos, migrations, documentação e configurações visíveis do GitHub. Não houve teste de penetração, execução da suíte, inspeção de produção, verificação efetiva do Supabase ou validação em terminais reais. Alguns riscos precisam ser reproduzidos em staging antes de serem tratados como falhas exploráveis em produção.

**Repositório de referência:** https://github.com/thgustavo62-design/Restaurante

**Estado:** planejamento apenas. Nenhuma mudança aplicada ao código ou ao banco.
