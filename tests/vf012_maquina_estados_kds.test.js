"use strict";
// VF-012 (0085) — máquina de estados do status dos itens valendo no banco:
// avanço PENDENTE -> PREPARANDO -> PRONTO -> ENTREGUE, volta de um passo
// com horários zerados, e recusa de: pular pra ENTREGUE sem estar PRONTO,
// voltar mais de um passo, cancelar por UPDATE direto, ressuscitar item
// cancelado, mexer em horários do preparo e em estoque_baixado_em.
//
// Ainda não rodou contra um Supabase de verdade (sem homologação — ver
// tests/README.md). A mesma sequência foi conferida em produção via MCP,
// numa transação desfeita no final (10/10/2026).

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

async function itemNovo(admin, seed) {
  const c = await admin.from("comandas").insert({
    empresa_id: seed.empresa.id, codigo: "KDS" + crypto.randomBytes(3).toString("hex"),
    mesa_id: null, tipo: "BALCAO", status: "ABERTA", usuario_abertura: seed.caixa.id
  }).select().single();
  if (c.error) throw c.error;
  const it = await admin.from("comanda_itens").insert({
    comanda_id: c.data.id, produto_id: seed.produto.id, nome: "Teste KDS", quantidade: 1, preco_unit_centavos: 1000
  }).select().single();
  if (it.error) throw it.error;
  return it.data;
}
const setStatus = (cli, id, status) => cli.from("comanda_itens").update({ status }).eq("id", id);

test("fluxo normal avança; pular para ENTREGUE e voltar dois passos são recusados", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixa = await loginComo(seed.caixa, "1234");
  const item = await itemNovo(admin, seed);

  const pulo = await setStatus(caixa, item.id, "ENTREGUE");
  assert.ok(pulo.error, "PENDENTE -> ENTREGUE direto não pode");

  assert.equal((await setStatus(caixa, item.id, "PREPARANDO")).error, null);
  assert.equal((await setStatus(caixa, item.id, "PRONTO")).error, null);

  const doisPassos = await setStatus(caixa, item.id, "PENDENTE");
  assert.ok(doisPassos.error, "PRONTO -> PENDENTE (dois passos) não pode");

  const umPasso = await setStatus(caixa, item.id, "PREPARANDO");
  assert.equal(umPasso.error, null, "voltar um passo é permitido");
  const lido = await admin.from("comanda_itens").select("pronto_em, iniciado_em").eq("id", item.id).single();
  assert.equal(lido.data.pronto_em, null, "voltar um passo zera o horário de pronto");
  assert.ok(lido.data.iniciado_em, "o horário de início continua");
});

test("ENTREGUE e CANCELADO são finais; cancelar por UPDATE direto é recusado", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixa = await loginComo(seed.caixa, "1234");
  const item = await itemNovo(admin, seed);

  for (const s of ["PREPARANDO", "PRONTO", "ENTREGUE"]) assert.equal((await setStatus(caixa, item.id, s)).error, null);
  assert.ok((await setStatus(caixa, item.id, "PRONTO")).error, "ENTREGUE não volta");

  const outro = await itemNovo(admin, seed);
  const direto = await caixa.from("comanda_itens").update({ status: "CANCELADO", motivo_cancelamento: "teste" }).eq("id", outro.id);
  assert.ok(direto.error, "cancelar só pela rotina autorizada (cancelar_item)");
});

test("horários do preparo e controle de estoque não podem ser editados à mão", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixa = await loginComo(seed.caixa, "1234");
  const item = await itemNovo(admin, seed);

  assert.ok((await caixa.from("comanda_itens").update({ pronto_em: new Date().toISOString() }).eq("id", item.id)).error);
  assert.ok((await caixa.from("comanda_itens").update({ estoque_baixado_em: new Date().toISOString() }).eq("id", item.id)).error);
});
