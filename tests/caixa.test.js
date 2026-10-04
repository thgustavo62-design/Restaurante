"use strict";
// Fase 4.4 — conferência cega do fechamento de caixa (0042): o esperado é
// calculado no servidor a partir das vendas reais da sessão, e diferença
// acima do limite configurado (ou o padrão de R$5 quando não configurado)
// exige justificativa pra fechar.

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

async function abrirCaixaComVenda(caixaCliente, seed, valorVendaCentavos){
  const { data: sessao } = await caixaCliente
    .from("caixa_sessoes").insert({ empresa_id: seed.empresa.id, terminal: "Terminal Teste", usuario_abertura: seed.caixa.id, saldo_inicial_centavos: 0, status: "ABERTA" })
    .select().single();

  const { data: comanda } = await caixaCliente
    .from("comandas").insert({ empresa_id: seed.empresa.id, codigo: "T" + Date.now(), mesa_id: seed.mesa.id, tipo: "MESA", status: "ABERTA", usuario_abertura: seed.caixa.id, taxa_servico_ativa: false })
    .select().single();
  await caixaCliente.from("comanda_itens")
    .insert({ comanda_id: comanda.id, produto_id: seed.produto.id, nome: "x", quantidade: 1, preco_unit_centavos: seed.produto.preco_centavos, status: "PENDENTE", usuario_id: seed.caixa.id, setor_producao: "COZINHA" });

  await caixaCliente.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id,
    p_linhas: [{ forma: "DINHEIRO", valor_centavos: valorVendaCentavos }],
    p_cliente_id: null, p_item_ids: null, p_sessao_id: sessao.id, p_pontos_resgatados: 0
  });
  return sessao;
}

test("conferir_fechamento_caixa — bate exato quando informado = vendido", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixaCliente = await loginComo(seed.caixa, "1234");

  const sessao = await abrirCaixaComVenda(caixaCliente, seed, seed.produto.preco_centavos);

  const { data: resultado, error } = await caixaCliente.rpc("conferir_fechamento_caixa", {
    p_sessao_id: sessao.id,
    p_informados: { DINHEIRO: seed.produto.preco_centavos }
  });
  if (error) throw error;

  assert.equal(resultado.diferenca_dinheiro, 0);
  assert.equal(resultado.precisa_justificativa, false);
  assert.equal(resultado.esperados.DINHEIRO, seed.produto.preco_centavos, "esperado calculado no servidor deveria bater com a venda real");
});

test("fechar_caixa — diferença grande sem justificativa é recusada; com justificativa fecha e audita", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixaCliente = await loginComo(seed.caixa, "1234");

  const sessao = await abrirCaixaComVenda(caixaCliente, seed, seed.produto.preco_centavos);
  const informadoErrado = { DINHEIRO: seed.produto.preco_centavos - 10000 }; // R$100 de diferença — bem acima do limite padrão

  const semJustificativa = await caixaCliente.rpc("fechar_caixa", { p_sessao_id: sessao.id, p_informados: informadoErrado, p_justificativa: null });
  assert.ok(semJustificativa.error, "deveria recusar fechar sem justificativa quando a diferença é grande");

  const comJustificativa = await caixaCliente.rpc("fechar_caixa", { p_sessao_id: sessao.id, p_informados: informadoErrado, p_justificativa: "Gaveta contada errado, conferido depois" });
  if (comJustificativa.error) throw comJustificativa.error;
  assert.equal(comJustificativa.data.precisa_justificativa, true);

  const { data: sessaoDepois } = await admin.from("caixa_sessoes").select("status").eq("id", sessao.id).single();
  assert.equal(sessaoDepois.status, "FECHADA");

  const { data: auditoria } = await admin.from("auditoria").select("*").eq("entidade_id", sessao.id).eq("acao", "DIFERENCA_JUSTIFICADA");
  assert.equal(auditoria.length, 1, "diferença justificada deveria gerar uma linha de auditoria");
});
