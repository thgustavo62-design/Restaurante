"use strict";
// PRIORIDADE 3 — Perdas e Desperdícios: registro manual de insumo (baixa
// estoque, valor = custo médio) e de prato (valor = CMV, NUNCA baixa
// ingrediente — ver nota de design na migration 0067), item cancelado já
// em preparo vira perda automática E baixa o ingrediente (porque nunca
// vai passar pela baixa de confirmar_pagamento), diferença negativa de
// inventário vira "perda não identificada", e a Central do Dono (0065)
// soma direto da tabela de verdade — é o teste que existe especificamente
// pro "Pronto quando" do roteiro: registrar 2kg de picanha vencida e ver
// o valor no bloco de perdas da Central do Dono.

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

async function abrirComandaComItem(cliente, seed, status){
  const { data: comanda, error: eComanda } = await cliente
    .from("comandas").insert({ empresa_id: seed.empresa.id, codigo: "PD" + Date.now(), mesa_id: seed.mesa.id, tipo: "MESA", status: "ABERTA", usuario_abertura: seed.garcom.id, taxa_servico_ativa: true })
    .select().single();
  if (eComanda) throw eComanda;
  const { data: item, error: eItem } = await cliente.from("comanda_itens")
    .insert({ comanda_id: comanda.id, produto_id: seed.produto.id, nome: "x", quantidade: 1, preco_unit_centavos: seed.produto.preco_centavos, status: status||"PENDENTE", usuario_id: seed.garcom.id, setor_producao: "COZINHA" })
    .select().single();
  if (eItem) throw eItem;
  return { comanda, item };
}

test("registrar_perda (INSUMO) baixa o estoque e calcula o valor pelo custo médio", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  // seed.insumo: estoque 100, custo médio 200 centavos.

  const adminCliente = await loginComo(seed.admin, "1234");
  const res = await adminCliente.rpc("registrar_perda", {
    p_tipo: "INSUMO", p_insumo_id: seed.insumo.id, p_produto_id: null, p_quantidade: 2, p_motivo: "VENCEU"
  });
  if (res.error) throw res.error;
  assert.equal(res.data.perda.valor_centavos, 400, "2 x custo médio (200) = 400");
  assert.equal(Number(res.data.insumo.estoque_atual), 98, "perda de insumo baixa o estoque de verdade");
});

test("registrar_perda (PRATO) calcula pelo CMV do produto e não toca o estoque do ingrediente", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  // seed.produto: ficha_tecnica = 2 x seed.insumo (custo médio 200, rendimento 1) => CMV = 400/unidade.

  const adminCliente = await loginComo(seed.admin, "1234");
  const res = await adminCliente.rpc("registrar_perda", {
    p_tipo: "PRATO", p_insumo_id: null, p_produto_id: seed.produto.id, p_quantidade: 3, p_motivo: "SOBRA"
  });
  if (res.error) throw res.error;
  assert.equal(res.data.perda.valor_centavos, 1200, "3 pratos x CMV (400) = 1200");

  const { data: insumoDepois } = await admin.from("insumos").select("estoque_atual").eq("id", seed.insumo.id).single();
  assert.equal(Number(insumoDepois.estoque_atual), 100, "perda manual de PRATO não deveria mexer no estoque do ingrediente");
});

test("cancelar_item já em preparo vira perda automática e baixa o ingrediente", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const garcomCliente = await loginComo(seed.garcom, "1234");
  const { item } = await abrirComandaComItem(garcomCliente, seed, "PREPARANDO");

  const tent = await garcomCliente.rpc("registrar_tentativa_pin", { p_usuario_id: seed.admin.id });
  if (tent.error) throw tent.error;
  const res = await garcomCliente.rpc("cancelar_item", {
    p_item_id: item.id, p_motivo: "Erro da cozinha",
    p_supervisor_id: seed.admin.id, p_supervisor_pin: "1234", p_tentativa_id: tent.data
  });
  if (res.error) throw res.error;
  assert.equal(res.data.cancelado_apos_preparo, true);

  const { data: perda } = await admin.from("perdas").select("*").eq("comanda_item_id", item.id).single();
  assert.equal(perda.motivo, "CANCELADO_APOS_PREPARO");
  assert.equal(perda.tipo, "PRATO");
  assert.equal(perda.valor_centavos, 400, "CMV de 1 unidade do produto (ficha 2 x custo 200)");

  const { data: insumoDepois } = await admin.from("insumos").select("estoque_atual").eq("id", seed.insumo.id).single();
  assert.equal(Number(insumoDepois.estoque_atual), 98, "ingrediente já preparado precisa baixar — nunca vai passar por confirmar_pagamento");
});

test("registrar_inventario com contagem menor que o sistema grava perda não identificada", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const adminCliente = await loginComo(seed.admin, "1234");

  const res = await adminCliente.rpc("registrar_inventario", {
    p_itens: [{ insumo_id: seed.insumo.id, contado: 90 }]
  });
  if (res.error) throw res.error;

  const { data: perda } = await admin.from("perdas").select("*").eq("insumo_id", seed.insumo.id).eq("motivo", "AJUSTE_INVENTARIO").single();
  assert.equal(Number(perda.quantidade), 10);
  assert.equal(perda.valor_centavos, 2000, "10 x custo médio (200) = 2000");
});

test("registrar_inventario com contagem maior (sobra) NÃO gera perda", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const adminCliente = await loginComo(seed.admin, "1234");

  const res = await adminCliente.rpc("registrar_inventario", {
    p_itens: [{ insumo_id: seed.insumo.id, contado: 110 }]
  });
  if (res.error) throw res.error;

  const { data: perda } = await admin.from("perdas").select("*").eq("insumo_id", seed.insumo.id);
  assert.equal(perda.length, 0, "sobra não é perda");
});

test("Pronto quando: registrar perda de insumo aparece no bloco de perdas da Central do Dono", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const adminCliente = await loginComo(seed.admin, "1234");

  const resPerda = await adminCliente.rpc("registrar_perda", {
    p_tipo: "INSUMO", p_insumo_id: seed.insumo.id, p_produto_id: null, p_quantidade: 2, p_motivo: "VENCEU"
  });
  if (resPerda.error) throw resPerda.error;

  const resCentral = await adminCliente.rpc("central_do_dono");
  if (resCentral.error) throw resCentral.error;
  assert.equal(resCentral.data.mes.perdas_centavos, 400, "a Central do Dono deveria mostrar o valor da perda recém-registrada no mês");
});
