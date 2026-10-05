"use strict";
// PRIORIDADE 6 — Expedição da Cozinha: o único pedaço novo no banco é
// `categorias.tempo` (entrada/principal/sobremesa) — "liberar pro salão"
// reaproveita o UPDATE em lote que o KDS já usava pra ticket inteiro
// (coberto por supervisor.test.js/etapa0.test.js indiretamente, nenhuma
// RPC nova aqui). A lógica de agrupamento em si (tempoDoItem/
// renderExpedicaoConteudo) é JS puro de tela, sem acesso a banco.

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, limparEmpresaTeste } = require("./setup");

test("categorias.tempo aceita só ENTRADA/PRINCIPAL/SOBREMESA, com PRINCIPAL por padrão", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));

  const { data: categoriaPadrao } = await admin.from("categorias").select("tempo").eq("id", seed.categoria.id).single();
  assert.equal(categoriaPadrao.tempo, "PRINCIPAL", "categoria sem classificação explícita deveria ficar PRINCIPAL");

  const atualizou = await admin.from("categorias").update({ tempo: "ENTRADA" }).eq("id", seed.categoria.id);
  assert.equal(atualizou.error, null);

  const invalido = await admin.from("categorias").update({ tempo: "BEBIDA" }).eq("id", seed.categoria.id);
  assert.ok(invalido.error, "tempo fora de ENTRADA/PRINCIPAL/SOBREMESA deveria ser recusado pela CHECK constraint");
});
