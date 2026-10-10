"use strict";
// VF-011 / VF-010 fase 1 (0082) — confirmar_pagamento com p_chave: reenvio
// com a mesma chave devolve o resultado original (repetido: true) sem gravar
// de novo; mesma chave com valores diferentes é erro; sem chave, o reenvio
// continua recusado por "já está paga".
//
// Ainda não rodou contra um Supabase de verdade (sem homologação — ver
// tests/README.md). A mesma sequência foi conferida em produção via MCP,
// numa transação desfeita no final (10/10/2026).

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

async function comandaComItem(caixa, seed, valor) {
  const c = await caixa.from("comandas").insert({
    empresa_id: seed.empresa.id, codigo: "IDEM" + crypto.randomBytes(3).toString("hex"),
    mesa_id: null, tipo: "BALCAO", status: "ABERTA", usuario_abertura: seed.caixa.id, taxa_servico_ativa: false
  }).select().single();
  if (c.error) throw c.error;
  const it = await caixa.from("comanda_itens").insert({
    comanda_id: c.data.id, produto_id: seed.produto.id, nome: "Teste", quantidade: 1, preco_unit_centavos: valor
  });
  if (it.error) throw it.error;
  return c.data;
}

test("mesma chave + mesmos valores: segundo envio devolve o original e não duplica pagamento", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixa = await loginComo(seed.caixa, "1234");
  const sessao = await caixa.from("caixa_sessoes").insert({
    empresa_id: seed.empresa.id, terminal: "T-IDEM", usuario_abertura: seed.caixa.id, saldo_inicial_centavos: 0, status: "ABERTA"
  }).select().single();
  if (sessao.error) throw sessao.error;
  const comanda = await comandaComItem(caixa, seed, 1000);

  const chave = crypto.randomUUID();
  const args = {
    p_comanda_id: comanda.id, p_linhas: [{ forma: "DINHEIRO", valor_centavos: 5000 }],
    p_sessao_id: sessao.data.id, p_chave: chave, p_terminal_id: "T-IDEM"
  };
  const a = await caixa.rpc("confirmar_pagamento", args);
  if (a.error) throw a.error;
  assert.equal(a.data.fechou, true);
  assert.equal(a.data.repetido, undefined);

  const b = await caixa.rpc("confirmar_pagamento", args);
  if (b.error) throw b.error;
  assert.equal(b.data.repetido, true);
  assert.equal(b.data.comanda.total_centavos, a.data.comanda.total_centavos);

  const pags = await admin.from("pagamentos").select("id").eq("comanda_id", comanda.id);
  assert.equal(pags.data.length, 1, "reenvio não pode gravar um segundo pagamento");
});

test("mesma chave com outro valor é recusada; sem chave o reenvio cai em 'já está paga'", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixa = await loginComo(seed.caixa, "1234");
  const sessao = await caixa.from("caixa_sessoes").insert({
    empresa_id: seed.empresa.id, terminal: "T-IDEM2", usuario_abertura: seed.caixa.id, saldo_inicial_centavos: 0, status: "ABERTA"
  }).select().single();
  if (sessao.error) throw sessao.error;
  const comanda = await comandaComItem(caixa, seed, 1000);

  const chave = crypto.randomUUID();
  const ok = await caixa.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id, p_linhas: [{ forma: "DINHEIRO", valor_centavos: 5000 }], p_sessao_id: sessao.data.id, p_chave: chave
  });
  if (ok.error) throw ok.error;

  const outroValor = await caixa.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id, p_linhas: [{ forma: "DINHEIRO", valor_centavos: 6000 }], p_sessao_id: sessao.data.id, p_chave: chave
  });
  assert.ok(outroValor.error);
  assert.match(outroValor.error.message, /Chave de operação já usada/);

  const semChave = await caixa.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id, p_linhas: [{ forma: "DINHEIRO", valor_centavos: 5000 }], p_sessao_id: sessao.data.id
  });
  assert.ok(semChave.error);
  assert.match(semChave.error.message, /já está paga/);
});
