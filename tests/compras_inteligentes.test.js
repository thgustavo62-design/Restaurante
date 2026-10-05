"use strict";
// PRIORIDADE 4 — Compras Inteligentes: lista de compras sugerida usa o
// consumo real dos últimos 28 dias × ficha técnica e o prazo de entrega
// do fornecedor padrão do insumo; receber um pedido com quantidade/preço
// diferente do pedido usa o RECEBIDO (não o pedido) pro estoque/custo
// médio e grava a divergência na auditoria; e o teste do "Pronto quando"
// do roteiro — receber um insumo mais caro que o limite configurado
// aparece como alerta, com os pratos que perderam margem.

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

test("lista_compras_sugerida calcula pelo consumo dos últimos 28 dias e pelo prazo do fornecedor", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  // seed.insumo: estoque 100, mínimo 10. ficha_tecnica do seed.produto = 2x seed.insumo.

  const { data: fornecedor } = await admin.from("fornecedores").insert({
    empresa_id: seed.empresa.id, nome: "Fornecedor Teste", ativo: true, prazo_entrega_dias: 7
  }).select().single();
  await admin.from("insumos").update({ fornecedor_padrao_id: fornecedor.id, estoque_atual: 5 }).eq("id", seed.insumo.id);

  const dezDiasAtras = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  const { data: comandaPassada } = await admin.from("comandas").insert({
    empresa_id: seed.empresa.id, codigo: "CI" + Date.now(), tipo: "BALCAO", status: "PAGA",
    usuario_abertura: seed.caixa.id, dia_operacional: dezDiasAtras,
    fechamento: dezDiasAtras + "T12:00:00Z", total_centavos: 1000
  }).select().single();
  await admin.from("comanda_itens").insert({
    comanda_id: comandaPassada.id, produto_id: seed.produto.id, nome: "x", quantidade: 14,
    preco_unit_centavos: seed.produto.preco_centavos, status: "ENTREGUE", usuario_id: seed.caixa.id, setor_producao: "COZINHA"
  });

  const adminCliente = await loginComo(seed.admin, "1234");
  const res = await adminCliente.rpc("lista_compras_sugerida");
  if (res.error) throw res.error;

  const grupo = res.data.find((g) => g.fornecedor_id === fornecedor.id);
  assert.ok(grupo, "deveria agrupar pelo fornecedor padrão do insumo");
  const item = grupo.itens.find((i) => i.insumo_id === seed.insumo.id);
  assert.ok(item, "insumo com consumo deveria aparecer sugerido");
  // consumo: 14 unidades x ficha_tecnica(2) / rendimento(1) = 28, numa janela de 28 dias = 1/dia.
  // consumo previsto (prazo 7d) = 7. sugestão = mínimo(10) + previsto(7) - estoque(5) = 12.
  assert.equal(Number(item.quantidade_sugerida), 12);
});

test("receber_pedido_compra usa quantidade/preço RECEBIDOS (não os pedidos) e registra a divergência", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const { data: fornecedor } = await admin.from("fornecedores").insert({
    empresa_id: seed.empresa.id, nome: "Fornecedor Teste", ativo: true
  }).select().single();
  const adminCliente = await loginComo(seed.admin, "1234");

  const criado = await adminCliente.rpc("criar_pedido_compra", {
    p_fornecedor_id: fornecedor.id,
    p_itens: [{ insumo_id: seed.insumo.id, quantidade: 10, custo_unit_centavos: 200 }]
  });
  if (criado.error) throw criado.error;
  const itemPedido = criado.data.itens[0];

  // recebeu 8 (não 10) a 250 (não 200) — diverge nos dois campos.
  const recebido = await adminCliente.rpc("receber_pedido_compra", {
    p_pedido_id: criado.data.pedido.id,
    p_itens_recebidos: [{ item_id: itemPedido.id, quantidade_recebida: 8, preco_unit_recebido_centavos: 250 }]
  });
  if (recebido.error) throw recebido.error;

  const { data: insumoDepois } = await admin.from("insumos").select("estoque_atual, custo_medio_centavos").eq("id", seed.insumo.id).single();
  assert.equal(Number(insumoDepois.estoque_atual), 108, "estoque deveria subir pela quantidade RECEBIDA (8), não a pedida (10)");
  // custo médio: (100*200 + 8*250) / (100+8) = 22000/108 ≈ 204.
  assert.equal(insumoDepois.custo_medio_centavos, Math.round((100 * 200 + 8 * 250) / 108));

  const { data: divergencia } = await admin.from("auditoria")
    .select("*").eq("entidade", "pedidos_compra_itens").eq("acao", "DIVERGENCIA_RECEBIMENTO").eq("entidade_id", itemPedido.id).single();
  assert.ok(divergencia, "deveria gravar a divergência na auditoria");
  assert.equal(divergencia.dados_antes.quantidade_pedida, 10);
  assert.equal(divergencia.dados_depois.quantidade_recebida, 8);

  const { data: historico } = await admin.from("historico_precos_insumo").select("*").eq("insumo_id", seed.insumo.id).single();
  assert.equal(historico.preco_centavos, 250, "histórico de preço usa o preço RECEBIDO, não o pedido");
});

test("Pronto quando: receber insumo mais caro que o limite mostra alerta e os pratos que perderam margem", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  // seed.produto: ficha_tecnica = 2x seed.insumo (rendimento 1).
  const { data: fornecedor } = await admin.from("fornecedores").insert({
    empresa_id: seed.empresa.id, nome: "Fornecedor Teste", ativo: true
  }).select().single();
  const adminCliente = await loginComo(seed.admin, "1234");

  // primeiro recebimento a 200 (preço-base), depois 230 (+15%, acima do limite padrão de 10%).
  const pedido1 = await adminCliente.rpc("criar_pedido_compra", { p_fornecedor_id: fornecedor.id, p_itens: [{ insumo_id: seed.insumo.id, quantidade: 5, custo_unit_centavos: 200 }] });
  if (pedido1.error) throw pedido1.error;
  const r1 = await adminCliente.rpc("receber_pedido_compra", { p_pedido_id: pedido1.data.pedido.id });
  if (r1.error) throw r1.error;

  const pedido2 = await adminCliente.rpc("criar_pedido_compra", { p_fornecedor_id: fornecedor.id, p_itens: [{ insumo_id: seed.insumo.id, quantidade: 5, custo_unit_centavos: 230 }] });
  if (pedido2.error) throw pedido2.error;
  const r2 = await adminCliente.rpc("receber_pedido_compra", { p_pedido_id: pedido2.data.pedido.id });
  if (r2.error) throw r2.error;

  const res = await adminCliente.rpc("relatorio_precos_insumo");
  if (res.error) throw res.error;
  const item = res.data.insumos.find((i) => i.insumo_id === seed.insumo.id);
  assert.ok(item, "insumo com histórico deveria aparecer no relatório");
  assert.equal(item.variacao_pct, 15);
  assert.equal(item.alerta, true, "15% de aumento deveria passar do limite padrão de 10%");

  const prato = item.pratos_afetados.find((p) => p.produto_id === seed.produto.id);
  assert.ok(prato, "produto que usa esse insumo na ficha técnica deveria aparecer afetado");
  // impacto: ficha_tecnica(2) / rendimento(1) * (230-200) = 60 centavos por unidade vendida.
  assert.equal(prato.impacto_centavos, 60);
});
