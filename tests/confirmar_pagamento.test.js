"use strict";
// Fase 4.4 — confirmar_pagamento é a RPC mais crítica do sistema (dinheiro
// de verdade, estoque, auditoria). Cobre: fechamento completo com baixa
// de estoque certa, pagamento parcial por item (não fecha a comanda) e
// pontos de fidelidade ganhos quando um cliente é vinculado.

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

async function abrirComandaComItem(caixaCliente, seed, quantidade){
  const { data: comanda, error: eComanda } = await caixaCliente
    .from("comandas")
    .insert({ empresa_id: seed.empresa.id, codigo: "T" + Date.now(), mesa_id: seed.mesa.id, tipo: "MESA", status: "ABERTA", usuario_abertura: seed.caixa.id, taxa_servico_ativa: true })
    .select().single();
  if (eComanda) throw eComanda;

  const { data: itens, error: eItem } = await caixaCliente
    .from("comanda_itens")
    .insert({ comanda_id: comanda.id, produto_id: seed.produto.id, nome: "placeholder", quantidade, preco_unit_centavos: 1, status: "PENDENTE", usuario_id: seed.caixa.id, setor_producao: "COZINHA" })
    .select();
  if (eItem) throw eItem;
  return { comanda, item: itens[0] };
}

test("confirmar_pagamento — fechamento completo baixa o estoque certo", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));

  const caixaCliente = await loginComo(seed.caixa, "1234");
  const { comanda, item } = await abrirComandaComItem(caixaCliente, seed, 1);

  // confere que o trigger (0051/0056) recalculou o preço no servidor —
  // nunca confia no "preco_unit_centavos: 1" mandado de propósito errado acima.
  assert.equal(item.preco_unit_centavos, seed.produto.preco_centavos, "preço deveria ter sido recalculado no servidor, não aceito o valor forjado");

  const { data: sessao, error: eSessao } = await caixaCliente
    .from("caixa_sessoes").insert({ empresa_id: seed.empresa.id, terminal: "Terminal Teste", usuario_abertura: seed.caixa.id, saldo_inicial_centavos: 0, status: "ABERTA" })
    .select().single();
  if (eSessao) throw eSessao;

  const total = Math.round(seed.produto.preco_centavos * 1.10); // taxa de serviço 10%
  const { data: resultado, error: ePag } = await caixaCliente.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id,
    p_linhas: [{ forma: "DINHEIRO", valor_centavos: total }],
    p_cliente_id: null, p_item_ids: null, p_sessao_id: sessao.id, p_pontos_resgatados: 0
  });
  if (ePag) throw ePag;

  assert.equal(resultado.fechou, true);
  assert.equal(resultado.comanda.status, "PAGA");

  const { data: insumoDepois } = await admin.from("insumos").select("estoque_atual").eq("id", seed.insumo.id).single();
  // ficha_tecnica: 2 unidades do insumo por produto, 1 produto vendido = -2
  assert.equal(Number(insumoDepois.estoque_atual), 98, "baixa de estoque deveria ser ficha_tecnica.quantidade (2) × itens vendidos (1)");
});

test("confirmar_pagamento — pagamento parcial por item não fecha a comanda", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));

  const caixaCliente = await loginComo(seed.caixa, "1234");
  const { comanda } = await abrirComandaComItem(caixaCliente, seed, 1);
  // segundo item na mesma comanda — só o primeiro será pago
  const { data: segundoItem, error: eSegundo } = await caixaCliente
    .from("comanda_itens")
    .insert({ comanda_id: comanda.id, produto_id: seed.produto.id, nome: "x", quantidade: 1, preco_unit_centavos: 1, status: "PENDENTE", usuario_id: seed.caixa.id, setor_producao: "COZINHA" })
    .select().single();
  if (eSegundo) throw eSegundo;

  const { data: primeiroItem } = await caixaCliente.from("comanda_itens").select("id").eq("comanda_id", comanda.id).neq("id", segundoItem.id).single();

  const { data: sessao } = await caixaCliente
    .from("caixa_sessoes").insert({ empresa_id: seed.empresa.id, terminal: "Terminal Teste", usuario_abertura: seed.caixa.id, saldo_inicial_centavos: 0, status: "ABERTA" })
    .select().single();

  const totalUmItem = Math.round(seed.produto.preco_centavos * 1.10);
  const { data: resultado, error: ePag } = await caixaCliente.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id,
    p_linhas: [{ forma: "DINHEIRO", valor_centavos: totalUmItem }],
    p_cliente_id: null, p_item_ids: [primeiroItem.id], p_sessao_id: sessao.id, p_pontos_resgatados: 0
  });
  if (ePag) throw ePag;

  assert.equal(resultado.fechou, false, "ainda falta pagar o segundo item — comanda não deveria fechar");
  assert.equal(resultado.comanda.status, "ABERTA");
});

test("confirmar_pagamento — cliente vinculado ganha pontos de fidelidade", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));

  await admin.from("empresas").update({ config: { taxaServicoPctPadrao: 0, fidelidade: { pontosPorReal: 1, valorPontoCentavos: 10 } } }).eq("id", seed.empresa.id);
  const { data: cliente } = await admin.from("clientes").insert({ empresa_id: seed.empresa.id, nome: "Cliente Teste", consentimento_lgpd: true }).select().single();

  const caixaCliente = await loginComo(seed.caixa, "1234");
  const { comanda } = await abrirComandaComItem(caixaCliente, seed, 1);
  const { data: sessao } = await caixaCliente
    .from("caixa_sessoes").insert({ empresa_id: seed.empresa.id, terminal: "Terminal Teste", usuario_abertura: seed.caixa.id, saldo_inicial_centavos: 0, status: "ABERTA" })
    .select().single();

  await caixaCliente.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id,
    p_linhas: [{ forma: "DINHEIRO", valor_centavos: seed.produto.preco_centavos }],
    p_cliente_id: cliente.id, p_item_ids: null, p_sessao_id: sessao.id, p_pontos_resgatados: 0
  });

  const { data: clienteDepois } = await admin.from("clientes").select("pontos_fidelidade").eq("id", cliente.id).single();
  // R$10,00 pagos × 1 ponto por real = 10 pontos
  assert.equal(clienteDepois.pontos_fidelidade, Math.floor(seed.produto.preco_centavos / 100));
});
