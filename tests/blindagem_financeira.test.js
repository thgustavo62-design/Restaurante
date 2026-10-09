"use strict";
// VF-001 do plano de auditoria (docs/PLANO_DE_MELHORIAS.md) — comandas.
// status/fechamento/troco_centavos viram somente leitura pra UPDATE
// direto (só confirmar_pagamento/cancelar_comanda_vazia, via
// set_config('restaurante.bypass_protecao', ...), conseguem mudar);
// INSERT direto em pagamentos fica fechado; caixa_movimentos só aceita
// SANGRIA/SUPRIMENTO direto (VENDA só pela RPC); contas só aceita quem
// tem admin.financeiro.ver, não mais caixa.pagamento.registrar sozinho.

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

async function abrirComanda(cliente, seed){
  const { data: comanda } = await cliente.from("comandas").insert({
    empresa_id: seed.empresa.id, codigo: "VF1" + Date.now(), mesa_id: seed.mesa.id, tipo: "MESA", status: "ABERTA", usuario_abertura: seed.garcom.id, taxa_servico_ativa: true
  }).select().single();
  return comanda;
}

test("GARCOM não consegue marcar comanda como PAGA direto (sem passar por confirmar_pagamento)", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const garcomCliente = await loginComo(seed.garcom, "1234");
  const comanda = await abrirComanda(garcomCliente, seed);

  const res = await garcomCliente.from("comandas").update({ status: "PAGA", fechamento: new Date().toISOString() }).eq("id", comanda.id);
  assert.ok(res.error, "UPDATE direto pra status=PAGA deveria ser recusado pelo trigger");

  const { data: comandaDepois } = await admin.from("comandas").select("status, fechamento").eq("id", comanda.id).single();
  assert.equal(comandaDepois.status, "ABERTA", "a comanda tem que continuar ABERTA — nenhuma alteração parcial deveria ter passado");
  assert.equal(comandaDepois.fechamento, null);
});

test("CAIXA não consegue cancelar comanda direto por UPDATE (precisa da RPC cancelar_comanda_vazia)", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixaCliente = await loginComo(seed.caixa, "1234");
  const comanda = await abrirComanda(caixaCliente, seed);

  const res = await caixaCliente.from("comandas").update({ status: "CANCELADA", fechamento: new Date().toISOString() }).eq("id", comanda.id);
  assert.ok(res.error, "UPDATE direto pra status=CANCELADA deveria ser recusado pelo trigger");
});

test("ABERTA<->FECHANDO continua liberado por UPDATE direto (coordenação de UI, sem efeito financeiro)", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const garcomCliente = await loginComo(seed.garcom, "1234");
  const comanda = await abrirComanda(garcomCliente, seed);

  const fechando = await garcomCliente.from("comandas").update({ status: "FECHANDO" }).eq("id", comanda.id);
  assert.equal(fechando.error, null, "ABERTA -> FECHANDO precisa continuar funcionando (abrirFecharConta usa isso)");

  const voltaAberta = await garcomCliente.from("comandas").update({ status: "ABERTA" }).eq("id", comanda.id);
  assert.equal(voltaAberta.error, null, "FECHANDO -> ABERTA precisa continuar funcionando (fecharModalAtual/pagamento parcial usa isso)");
});

test("cancelar_comanda_vazia cancela comanda sem item, mas recusa comanda com item (mesmo que o client minta)", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const garcomCliente = await loginComo(seed.garcom, "1234");

  const vazia = await abrirComanda(garcomCliente, seed);
  const okVazia = await garcomCliente.rpc("cancelar_comanda_vazia", { p_comanda_id: vazia.id });
  if (okVazia.error) throw okVazia.error;
  assert.equal(okVazia.data.status, "CANCELADA");
  assert.ok(okVazia.data.fechamento);

  const comItem = await abrirComanda(garcomCliente, seed);
  await garcomCliente.from("comanda_itens").insert({
    comanda_id: comItem.id, produto_id: seed.produto.id, nome: "x", quantidade: 1, preco_unit_centavos: 1, status: "PENDENTE", usuario_id: seed.garcom.id, setor_producao: "COZINHA"
  });
  const recusa = await garcomCliente.rpc("cancelar_comanda_vazia", { p_comanda_id: comItem.id });
  assert.ok(recusa.error, "comanda com item (mesmo que o client ache que está vazia) não pode ser cancelada por essa rota");

  const { data: comandaDepois } = await admin.from("comandas").select("status").eq("id", comItem.id).single();
  assert.equal(comandaDepois.status, "ABERTA", "a comanda com item tem que continuar ABERTA depois da tentativa recusada");
});

test("INSERT direto em pagamentos é recusado — só confirmar_pagamento grava", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixaCliente = await loginComo(seed.caixa, "1234");
  const comanda = await abrirComanda(caixaCliente, seed);

  const res = await caixaCliente.from("pagamentos").insert({ comanda_id: comanda.id, forma: "DINHEIRO", valor_centavos: 999999 });
  assert.ok(res.error, "CAIXA não deveria conseguir inserir um pagamento avulso direto na tabela");
});

test("caixa_movimentos: insert direto só aceita SANGRIA/SUPRIMENTO — VENDA é recusado", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixaCliente = await loginComo(seed.caixa, "1234");
  const { data: sessao } = await caixaCliente.from("caixa_sessoes").insert({
    empresa_id: seed.empresa.id, terminal: "T1", usuario_abertura: seed.caixa.id, saldo_inicial_centavos: 0, status: "ABERTA"
  }).select().single();

  const venda = await caixaCliente.from("caixa_movimentos").insert({
    sessao_id: sessao.id, tipo: "VENDA", valor_centavos: 500000, forma_pagamento: "DINHEIRO", usuario_id: seed.caixa.id
  });
  assert.ok(venda.error, "fabricar um tipo=VENDA direto na tabela deveria ser recusado — só confirmar_pagamento pode gravar venda");

  const sangria = await caixaCliente.from("caixa_movimentos").insert({
    sessao_id: sessao.id, tipo: "SANGRIA", valor_centavos: 1000, forma_pagamento: "DINHEIRO", usuario_id: seed.caixa.id, motivo: "teste"
  });
  assert.equal(sangria.error, null, "sangria continua funcionando por insert direto (fluxo real do caixa)");
});

test("contas: GARCOM/COZINHA (sem admin.financeiro.ver) não conseguem inserir conta manual direto", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixaCliente = await loginComo(seed.caixa, "1234");

  // CAIXA tem caixa.pagamento.registrar mas NÃO admin.financeiro.ver —
  // antes da 0076 conseguia inserir conta direto por causa da cláusula
  // extra na policy; agora não deveria mais.
  const res = await caixaCliente.from("contas").insert({
    empresa_id: seed.empresa.id, tipo: "PAGAR", descricao: "Conta fabricada", categoria: "Teste", valor_centavos: 100000, vencimento: "2026-12-31"
  });
  assert.ok(res.error, "CAIXA não tem admin.financeiro.ver — não deveria conseguir inserir conta direto");
});
