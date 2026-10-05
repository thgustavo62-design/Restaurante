"use strict";
// PRIORIDADE 7 — Financeiro simples: despesa recorrente lança a conta do
// mês sozinha (gerar_despesas_recorrentes_do_mes), é idempotente (rodar
// duas vezes no mesmo mês não duplica), e relatorio_financeiro_resumo
// soma entrou/saiu/sobrou batendo com as 5 linhas de "pra onde foi o
// dinheiro" — é o teste que existe especificamente pra responder "quanto
// sobrou este mês e por quê" sem inventar número novo.

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

test("gerar_despesas_recorrentes_do_mes lança a conta do mês e é idempotente", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const adminCliente = await loginComo(seed.admin, "1234");

  const criada = await adminCliente.rpc("salvar_despesa_recorrente", {
    p_id: null, p_descricao: "Aluguel", p_categoria: "Contas fixas", p_valor_centavos: 150000, p_dia_vencimento: 10, p_ativo: true
  });
  if (criada.error) throw criada.error;

  const gerou1 = await adminCliente.rpc("gerar_despesas_recorrentes_do_mes");
  if (gerou1.error) throw gerou1.error;
  assert.equal(gerou1.data.length, 1, "deveria lançar a conta do mês na primeira vez");

  const gerou2 = await adminCliente.rpc("gerar_despesas_recorrentes_do_mes");
  if (gerou2.error) throw gerou2.error;
  assert.equal(gerou2.data.length, 0, "rodar de novo no mesmo mês não deveria duplicar a conta");

  const { data: contas } = await admin.from("contas").select("*").eq("despesa_recorrente_id", criada.data.id);
  assert.equal(contas.length, 1);
  assert.equal(contas[0].valor_centavos, 150000);
});

test("salvar_despesa_recorrente exige admin.financeiro.editar", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const garcomCliente = await loginComo(seed.garcom, "1234");

  const res = await garcomCliente.rpc("salvar_despesa_recorrente", {
    p_id: null, p_descricao: "Luz", p_categoria: "Contas fixas", p_valor_centavos: 50000, p_dia_vencimento: 15, p_ativo: true
  });
  assert.ok(res.error, "GARCOM não tem admin.financeiro.editar");
});

test("relatorio_financeiro_resumo: entrou - saiu = sobrou, e as 5 linhas somam o saiu", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const adminCliente = await loginComo(seed.admin, "1234");

  // uma venda paga hoje: entra faturamento, sai CMV.
  const caixaCliente = await loginComo(seed.caixa, "1234");
  const { data: comanda } = await caixaCliente.from("comandas").insert({
    empresa_id: seed.empresa.id, codigo: "FN" + Date.now(), mesa_id: seed.mesa.id, tipo: "MESA", status: "ABERTA", usuario_abertura: seed.caixa.id, taxa_servico_ativa: true
  }).select().single();
  await caixaCliente.from("comanda_itens").insert({
    comanda_id: comanda.id, produto_id: seed.produto.id, nome: "x", quantidade: 1, preco_unit_centavos: seed.produto.preco_centavos, status: "PENDENTE", usuario_id: seed.caixa.id, setor_producao: "COZINHA"
  });
  const { data: sessao } = await caixaCliente.from("caixa_sessoes").insert({ empresa_id: seed.empresa.id, terminal: "T1", usuario_abertura: seed.caixa.id, saldo_inicial_centavos: 0, status: "ABERTA" }).select().single();
  const total = Math.round(seed.produto.preco_centavos * 1.10);
  const pagto = await caixaCliente.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id, p_linhas: [{ forma: "DINHEIRO", valor_centavos: total }],
    p_cliente_id: null, p_item_ids: null, p_sessao_id: sessao.id, p_pontos_resgatados: 0
  });
  if (pagto.error) throw pagto.error;

  // uma despesa fixa do mês.
  const desp = await adminCliente.rpc("salvar_despesa_recorrente", {
    p_id: null, p_descricao: "Internet", p_categoria: "Contas fixas", p_valor_centavos: 20000, p_dia_vencimento: 10, p_ativo: true
  });
  if (desp.error) throw desp.error;
  const gerou = await adminCliente.rpc("gerar_despesas_recorrentes_do_mes");
  if (gerou.error) throw gerou.error;

  const hoje = new Date().toISOString().slice(0, 10);
  const res = await adminCliente.rpc("relatorio_financeiro_resumo", { p_mes: hoje });
  if (res.error) throw res.error;
  const r = res.data;

  assert.equal(r.entrou_centavos, total, "entrou deveria bater com o faturamento (total cobrado de verdade)");
  const somaLinhas = r.linhas.reduce((s, l) => s + l.valor_centavos, 0);
  assert.equal(somaLinhas, r.saiu_centavos, "as 5 linhas de 'pra onde foi o dinheiro' têm que somar exatamente o saiu");
  assert.equal(r.sobrou_centavos, r.entrou_centavos - r.saiu_centavos, "sobrou tem que ser entrou - saiu, sem outra conta escondida");

  const linhaContasFixas = r.linhas.find((l) => l.label === "Contas fixas");
  assert.equal(linhaContasFixas.valor_centavos, 20000, "despesa fixa gerada deveria aparecer na linha de contas fixas");

  assert.equal(r.fluxo_30_dias.length, 30, "fluxo projetado deveria cobrir os próximos 30 dias");
});
