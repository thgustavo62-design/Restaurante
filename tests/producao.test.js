"use strict";
// PRIORIDADE 2 — Produção/Pré-preparo: a sugestão do checklist bate com a
// média das últimas 4 semanas × ficha técnica (0.9 — rendimento entra na
// conta), produzir um lote de sub-receita baixa o ingrediente de verdade
// e dá entrada com custo médio ponderado, e só sub-receita pode ser
// "produzida" (insumo comum não).

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

test("abrir_checklist_pre_preparo sugere quantidade pela média das últimas 4 semanas", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));

  const seteDiasAtras = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const { data: comandaPassada, error: eComanda } = await admin.from("comandas").insert({
    empresa_id: seed.empresa.id, codigo: "HIST" + Date.now(), tipo: "BALCAO", status: "PAGA",
    usuario_abertura: seed.caixa.id, dia_operacional: seteDiasAtras,
    fechamento: seteDiasAtras + "T12:00:00Z", total_centavos: 3000
  }).select().single();
  if (eComanda) throw eComanda;
  const { error: eItem } = await admin.from("comanda_itens").insert({
    comanda_id: comandaPassada.id, produto_id: seed.produto.id, nome: "x", quantidade: 3,
    preco_unit_centavos: seed.produto.preco_centavos, status: "ENTREGUE", usuario_id: seed.caixa.id, setor_producao: "COZINHA"
  });
  if (eItem) throw eItem;

  const adminCliente = await loginComo(seed.admin, "1234");
  const res = await adminCliente.rpc("abrir_checklist_pre_preparo", { p_ajuste_pct: 0 });
  if (res.error) throw res.error;
  const item = res.data.itens.find((i) => i.insumo_id === seed.insumo.id);
  assert.ok(item, "insumo da ficha técnica do produto deveria aparecer na sugestão de hoje");
  // 3 unidades vendidas há 7 dias × ficha_tecnica (2, rendimento 1) = 6,
  // dividido pelas 4 semanas da média (só 1 tem venda) = 1.5.
  assert.equal(Number(item.quantidade_sugerida), 1.5);
});

test("marcar_pre_preparo_feito grava quem e quando, e desmarcar limpa de novo", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));

  const hoje = new Date().toISOString().slice(0, 10);
  const { data: linha, error: eLinha } = await admin.from("pre_preparo_checklist").insert({
    empresa_id: seed.empresa.id, dia_operacional: hoje, insumo_id: seed.insumo.id, quantidade_sugerida: 4
  }).select().single();
  if (eLinha) throw eLinha;

  const adminCliente = await loginComo(seed.admin, "1234");
  const resFeito = await adminCliente.rpc("marcar_pre_preparo_feito", { p_checklist_id: linha.id, p_feito: true });
  if (resFeito.error) throw resFeito.error;
  const { data: depoisFeito } = await admin.from("pre_preparo_checklist").select("*").eq("id", linha.id).single();
  assert.ok(depoisFeito.feito_em, "feito_em deveria estar preenchido");
  assert.equal(depoisFeito.feito_por, seed.admin.id);

  const resDesmarcar = await adminCliente.rpc("marcar_pre_preparo_feito", { p_checklist_id: linha.id, p_feito: false });
  if (resDesmarcar.error) throw resDesmarcar.error;
  const { data: depoisDesmarcar } = await admin.from("pre_preparo_checklist").select("*").eq("id", linha.id).single();
  assert.equal(depoisDesmarcar.feito_em, null);
  assert.equal(depoisDesmarcar.feito_por, null);
});

test("produzir_lote_sub_receita baixa o ingrediente e dá entrada com custo médio ponderado", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  // seed.insumo: estoque 100, custo médio 200 centavos.

  const { data: vinagrete, error: eSub } = await admin.from("insumos").insert({
    empresa_id: seed.empresa.id, nome: "Vinagrete", unidade: "kg", estoque_atual: 0, estoque_minimo: 0,
    custo_medio_centavos: 0, eh_sub_receita: true
  }).select().single();
  if (eSub) throw eSub;
  const { error: eFti } = await admin.from("ficha_tecnica_insumo").insert({
    insumo_produzido_id: vinagrete.id, insumo_ingrediente_id: seed.insumo.id, quantidade: 1
  });
  if (eFti) throw eFti;

  const adminCliente = await loginComo(seed.admin, "1234");

  const resErro = await adminCliente.rpc("produzir_lote_sub_receita", { p_insumo_id: seed.insumo.id, p_quantidade: 1 });
  assert.ok(resErro.error, "insumo comum (não marcado como sub-receita) não deveria poder ser 'produzido'");

  const res = await adminCliente.rpc("produzir_lote_sub_receita", { p_insumo_id: vinagrete.id, p_quantidade: 5, p_validade: null });
  if (res.error) throw res.error;
  assert.equal(Number(res.data.insumo.estoque_atual), 5, "produzir 5kg deveria dar entrada de 5 no insumo produzido");
  assert.equal(res.data.insumo.custo_medio_centavos, 200, "custo do lote (5 × 200 ÷ 5) deveria virar o custo médio do vinagrete, que estava zerado");
  assert.equal(res.data.etiqueta.nome, "Vinagrete");
  assert.equal(res.data.etiqueta.quantidade, 5);

  const { data: ingredienteDepois } = await admin.from("insumos").select("estoque_atual").eq("id", seed.insumo.id).single();
  assert.equal(Number(ingredienteDepois.estoque_atual), 95, "ingrediente deveria baixar 5 (produção de 5kg × 1 unidade por kg)");
});
