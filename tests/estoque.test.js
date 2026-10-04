"use strict";
// Fase 4.4 — registrar_movimento_estoque (0036): UPDATE atômico, não
// "lê depois escreve" — é exatamente o tipo de corrida que só aparece com
// dois terminais mexendo no mesmo insumo ao mesmo tempo. Testa entrada,
// saída, e que não deixa o estoque ir negativo mesmo saindo mais do que tem.

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

test("registrar_movimento_estoque — entrada soma, saída subtrai", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin); // insumo começa com estoque_atual = 100
  t.after(() => limparEmpresaTeste(admin, seed));
  const adminCliente = await loginComo(seed.admin, "1234");

  const entrada = await adminCliente.rpc("registrar_movimento_estoque", {
    p_insumo_id: seed.insumo.id, p_tipo: "ENTRADA", p_quantidade: 20, p_motivo: "Compra teste"
  });
  if (entrada.error) throw entrada.error;
  assert.equal(Number(entrada.data.insumo.estoque_atual), 120);

  const saida = await adminCliente.rpc("registrar_movimento_estoque", {
    p_insumo_id: seed.insumo.id, p_tipo: "SAIDA", p_quantidade: 50, p_motivo: "Perda teste"
  });
  if (saida.error) throw saida.error;
  assert.equal(Number(saida.data.insumo.estoque_atual), 70);
});

test("registrar_movimento_estoque — ETAPA 0.8: fica negativo em vez de travar em zero", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin); // 100 em estoque
  t.after(() => limparEmpresaTeste(admin, seed));
  const adminCliente = await loginComo(seed.admin, "1234");

  const saida = await adminCliente.rpc("registrar_movimento_estoque", {
    p_insumo_id: seed.insumo.id, p_tipo: "SAIDA", p_quantidade: 500, p_motivo: "Saída maior que o estoque"
  });
  if (saida.error) throw saida.error;
  // [DECISÃO TOMADA] 0.8 — estoque negativo sinaliza "furo a investigar"
  // em vez de esconder a diferença travando em zero (greatest(0,...)
  // removido de todas as baixas na migration 0064).
  assert.equal(Number(saida.data.insumo.estoque_atual), -400, "100 - 500 deveria dar -400, sem travar em zero");
});

test("registrar_movimento_estoque — motivo obrigatório, tipo inválido recusado", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const adminCliente = await loginComo(seed.admin, "1234");

  const semMotivo = await adminCliente.rpc("registrar_movimento_estoque", {
    p_insumo_id: seed.insumo.id, p_tipo: "ENTRADA", p_quantidade: 1, p_motivo: ""
  });
  assert.ok(semMotivo.error, "motivo vazio deveria ser recusado");

  const tipoInvalido = await adminCliente.rpc("registrar_movimento_estoque", {
    p_insumo_id: seed.insumo.id, p_tipo: "VENDA", p_quantidade: 1, p_motivo: "x"
  });
  assert.ok(tipoInvalido.error, "VENDA é gerado só pelo pagamento — não deveria ser aceito aqui");
});
