"use strict";
// ETAPA 0 — cobre as mudanças novas em confirmar_pagamento/RPCs
// relacionadas: cálculo de total compartilhado com o preview do modal
// (0.1), desconto empilhado acima do limite exigindo supervisor (0.2),
// LGPD no relatório de clientes inativos (0.3), baixa de estoque por
// pagamento parcial sem duplicar (0.4) e rendimento entrando na baixa
// (0.9). 0.8 (estoque negativo) está coberto em estoque.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

async function abrirComandaComItens(caixaCliente, seed, quantidadeItens){
  const { data: comanda, error: eComanda } = await caixaCliente
    .from("comandas")
    .insert({ empresa_id: seed.empresa.id, codigo: "T" + Date.now(), mesa_id: seed.mesa.id, tipo: "MESA", status: "ABERTA", usuario_abertura: seed.caixa.id, taxa_servico_ativa: true })
    .select().single();
  if (eComanda) throw eComanda;

  const itens = [];
  for (let i = 0; i < quantidadeItens; i++) {
    const { data: item, error: eItem } = await caixaCliente
      .from("comanda_itens")
      .insert({ comanda_id: comanda.id, produto_id: seed.produto.id, nome: "x", quantidade: 1, preco_unit_centavos: 1, status: "PENDENTE", usuario_id: seed.caixa.id, setor_producao: "COZINHA" })
      .select().single();
    if (eItem) throw eItem;
    itens.push(item);
  }
  return { comanda, itens };
}
async function abrirSessaoCaixa(caixaCliente, seed){
  const { data: sessao, error } = await caixaCliente
    .from("caixa_sessoes").insert({ empresa_id: seed.empresa.id, terminal: "Terminal Teste", usuario_abertura: seed.caixa.id, saldo_inicial_centavos: 0, status: "ABERTA" })
    .select().single();
  if (error) throw error;
  return sessao;
}

test("0.9 — rendimento do insumo entra na baixa de estoque", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin); // insumo com 100, ficha_tecnica = 2 por produto
  t.after(() => limparEmpresaTeste(admin, seed));

  const { error: eRend } = await admin.from("insumo_rendimentos").insert({
    empresa_id: seed.empresa.id, insumo_id: seed.insumo.id, fator: 0.5, usuario_id: seed.admin.id
  });
  if (eRend) throw eRend;

  const caixaCliente = await loginComo(seed.caixa, "1234");
  const { comanda } = await abrirComandaComItens(caixaCliente, seed, 1);
  const sessao = await abrirSessaoCaixa(caixaCliente, seed);

  const total = Math.round(seed.produto.preco_centavos * 1.10);
  const res = await caixaCliente.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id, p_linhas: [{ forma: "DINHEIRO", valor_centavos: total }],
    p_cliente_id: null, p_item_ids: null, p_sessao_id: sessao.id, p_pontos_resgatados: 0
  });
  if (res.error) throw res.error;

  const { data: insumoDepois } = await admin.from("insumos").select("estoque_atual").eq("id", seed.insumo.id).single();
  // ficha_tecnica.quantidade (2) ÷ rendimento (0.5) = 4 baixados, não 2.
  assert.equal(Number(insumoDepois.estoque_atual), 96, "com rendimento 50%, baixa deveria dobrar (2÷0.5=4)");
});

test("0.4 — baixa de estoque no pagamento parcial, item por item, nunca duas vezes", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));

  const caixaCliente = await loginComo(seed.caixa, "1234");
  const { comanda, itens } = await abrirComandaComItens(caixaCliente, seed, 2);
  const sessao = await abrirSessaoCaixa(caixaCliente, seed);

  const totalUmItem = Math.round(seed.produto.preco_centavos * 1.10);

  const res1 = await caixaCliente.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id, p_linhas: [{ forma: "DINHEIRO", valor_centavos: totalUmItem }],
    p_cliente_id: null, p_item_ids: [itens[0].id], p_sessao_id: sessao.id, p_pontos_resgatados: 0
  });
  if (res1.error) throw res1.error;
  assert.equal(res1.data.fechou, false);

  const { data: aposPrimeiro } = await admin.from("insumos").select("estoque_atual").eq("id", seed.insumo.id).single();
  assert.equal(Number(aposPrimeiro.estoque_atual), 98, "só o item 1 (ficha_tecnica=2) deveria ter baixado");

  const res2 = await caixaCliente.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id, p_linhas: [{ forma: "DINHEIRO", valor_centavos: totalUmItem }],
    p_cliente_id: null, p_item_ids: [itens[1].id], p_sessao_id: sessao.id, p_pontos_resgatados: 0
  });
  if (res2.error) throw res2.error;
  assert.equal(res2.data.fechou, true, "os dois itens foram pagos — deveria fechar agora");

  const { data: aposSegundo } = await admin.from("insumos").select("estoque_atual").eq("id", seed.insumo.id).single();
  assert.equal(Number(aposSegundo.estoque_atual), 96, "item 2 deveria baixar mais 2 (não duplicar o item 1, que já tinha baixado)");
});

test("0.1 — calcular_total_pagamento devolve o mesmo total que confirmar_pagamento cobra", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  // taxa de serviço 10% (padrão do seed) + desconto manual 10% (dentro do
  // limite, auto-aprovado) — o bug original cobrava a mais no cartão
  // porque o client calculava "subtotal - desconto" sem a taxa recalculada
  // sobre essa base já descontada.
  const caixaCliente = await loginComo(seed.caixa, "1234");
  const { comanda } = await abrirComandaComItens(caixaCliente, seed, 1);
  const sessao = await abrirSessaoCaixa(caixaCliente, seed);

  const descRes = await caixaCliente.rpc("aplicar_desconto", { p_comanda_id: comanda.id, p_percentual: 10 });
  if (descRes.error) throw descRes.error;

  const preview = await caixaCliente.rpc("calcular_total_pagamento", {
    p_comanda_id: comanda.id, p_item_ids: null, p_pontos_resgatados: 0, p_cupom_codigo: null
  });
  if (preview.error) throw preview.error;
  // subtotal 1000, desconto 100, base 900, taxa 10% de 900 = 90, total 990.
  assert.equal(preview.data.total, 990);

  const res = await caixaCliente.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id, p_linhas: [{ forma: "CREDITO", valor_centavos: preview.data.total }],
    p_cliente_id: null, p_item_ids: null, p_sessao_id: sessao.id, p_pontos_resgatados: 0
  });
  if (res.error) throw res.error;
  assert.equal(res.data.comanda.total_centavos, preview.data.total, "o total cobrado de verdade deveria bater exatamente com o preview");
});

test("0.2 — desconto empilhado (manual + pontos) acima do limite exige supervisor", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  await admin.from("empresas").update({ config: { taxaServicoPctPadrao: 10, limiteDescontoPct: 10, fidelidade: { pontosPorReal: 1, valorPontoCentavos: 10 } } }).eq("id", seed.empresa.id);
  const { data: cliente } = await admin.from("clientes").insert({ empresa_id: seed.empresa.id, nome: "Cliente Teste", consentimento_lgpd: true, pontos_fidelidade: 10 }).select().single();

  const caixaCliente = await loginComo(seed.caixa, "1234");
  const { comanda } = await abrirComandaComItens(caixaCliente, seed, 1);
  const sessao = await abrirSessaoCaixa(caixaCliente, seed);

  // 10% manual (no limite, auto-aprovado) + 5 pontos (R$0,50 = 5% de
  // R$10,00) = 15% empilhado, acima do limite de 10%.
  const descRes = await caixaCliente.rpc("aplicar_desconto", { p_comanda_id: comanda.id, p_percentual: 10 });
  if (descRes.error) throw descRes.error;

  const semSupervisor = await caixaCliente.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id, p_linhas: [{ forma: "DINHEIRO", valor_centavos: 1000 }],
    p_cliente_id: cliente.id, p_item_ids: null, p_sessao_id: sessao.id, p_pontos_resgatados: 5
  });
  assert.ok(semSupervisor.error, "sem supervisor, desconto empilhado acima do limite deveria ser recusado");

  const comSupervisor = await caixaCliente.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id, p_linhas: [{ forma: "DINHEIRO", valor_centavos: 1000 }],
    p_cliente_id: cliente.id, p_item_ids: null, p_sessao_id: sessao.id, p_pontos_resgatados: 5,
    p_supervisor_id: seed.admin.id, p_supervisor_pin: "1234"
  });
  if (comSupervisor.error) throw comSupervisor.error;
  assert.equal(comSupervisor.data.fechou, true, "com PIN de supervisor válido, deveria fechar normalmente");
});

test("0.3 — relatorio_clientes_inativos esconde telefone de quem não consentiu (LGPD)", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));

  await admin.from("clientes").insert([
    { empresa_id: seed.empresa.id, nome: "Com Consentimento", telefone: "11999990000", consentimento_lgpd: true },
    { empresa_id: seed.empresa.id, nome: "Sem Consentimento", telefone: "11999991111", consentimento_lgpd: false }
  ]);

  const adminCliente = await loginComo(seed.admin, "1234");
  const res = await adminCliente.rpc("relatorio_clientes_inativos", { p_dias: 1 });
  if (res.error) throw res.error;

  const comConsentimento = res.data.find((c) => c.nome === "Com Consentimento");
  const semConsentimento = res.data.find((c) => c.nome === "Sem Consentimento");
  assert.ok(comConsentimento, "cliente com consentimento deveria aparecer na lista");
  assert.ok(semConsentimento, "cliente sem consentimento também aparece (só o telefone some)");
  assert.equal(comConsentimento.telefone, "11999990000");
  assert.equal(semConsentimento.telefone, null, "telefone de quem não consentiu nunca deveria vir preenchido");
});
