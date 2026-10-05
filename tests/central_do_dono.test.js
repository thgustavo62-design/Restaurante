"use strict";
// PRIORIDADE 1 — central_do_dono(): faturamento de hoje bate com o que foi
// cobrado de verdade, GERENTE não vê o resultado/lucro do mês (só ADMIN),
// estoque negativo e conta a pagar vencida entram em "precisa da sua
// atenção", e quem não tem a permissão nem consegue chamar a RPC.

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

async function criarGerente(admin, seed, sufixo){
  const email = `${sufixo}-gerente@${seed.empresa.slug}.internal`;
  const { data: authUser, error: eAuth } = await admin.auth.admin.createUser({
    email, password: "1234", email_confirm: true
  });
  if (eAuth) throw eAuth;
  const { error: eUsuario } = await admin.from("usuarios").insert({
    id: authUser.user.id, empresa_id: seed.empresa.id, nome: "Gerente Teste", papel: "GERENTE", ativo: true, email_interno: email
  });
  if (eUsuario) throw eUsuario;
  return { id: authUser.user.id, email, nome: "Gerente Teste", papel: "GERENTE" };
}

async function pagarUmaComanda(caixaCliente, seed){
  const { data: comanda, error: eComanda } = await caixaCliente
    .from("comandas")
    .insert({ empresa_id: seed.empresa.id, codigo: "CD" + Date.now(), mesa_id: seed.mesa.id, tipo: "MESA", status: "ABERTA", usuario_abertura: seed.caixa.id, taxa_servico_ativa: true })
    .select().single();
  if (eComanda) throw eComanda;
  const { data: item, error: eItem } = await caixaCliente
    .from("comanda_itens")
    .insert({ comanda_id: comanda.id, produto_id: seed.produto.id, nome: "x", quantidade: 1, preco_unit_centavos: seed.produto.preco_centavos, status: "PENDENTE", usuario_id: seed.caixa.id, setor_producao: "COZINHA" })
    .select().single();
  if (eItem) throw eItem;
  const { data: sessao, error: eSessao } = await caixaCliente
    .from("caixa_sessoes").insert({ empresa_id: seed.empresa.id, terminal: "Terminal Teste", usuario_abertura: seed.caixa.id, saldo_inicial_centavos: 0, status: "ABERTA" })
    .select().single();
  if (eSessao) throw eSessao;

  const total = Math.round(seed.produto.preco_centavos * 1.10);
  const res = await caixaCliente.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id, p_linhas: [{ forma: "DINHEIRO", valor_centavos: total }],
    p_cliente_id: null, p_item_ids: null, p_sessao_id: sessao.id, p_pontos_resgatados: 0
  });
  if (res.error) throw res.error;
  return total;
}

test("central_do_dono: faturamento de hoje bate com o que foi cobrado; ADMIN vê resultado, GERENTE não", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const gerente = await criarGerente(admin, seed, Date.now().toString(36));

  const caixaCliente = await loginComo(seed.caixa, "1234");
  const totalCobrado = await pagarUmaComanda(caixaCliente, seed);

  const adminCliente = await loginComo(seed.admin, "1234");
  const resAdmin = await adminCliente.rpc("central_do_dono");
  if (resAdmin.error) throw resAdmin.error;
  assert.equal(resAdmin.data.hoje.faturamento_centavos, totalCobrado, "faturamento de hoje deveria bater exatamente com o que foi cobrado");
  assert.equal(resAdmin.data.hoje.vendas, 1);
  assert.equal(resAdmin.data.mes.pode_ver_resultado, true, "ADMIN deveria ver o resultado do mês");
  assert.ok(resAdmin.data.mes.resultado_centavos !== null, "resultado do mês não deveria ser null pro ADMIN");

  const gerenteCliente = await loginComo(gerente, "1234");
  const resGerente = await gerenteCliente.rpc("central_do_dono");
  if (resGerente.error) throw resGerente.error;
  assert.equal(resGerente.data.hoje.faturamento_centavos, totalCobrado, "GERENTE também vê o faturamento operacional");
  assert.equal(resGerente.data.mes.pode_ver_resultado, false, "GERENTE não deveria ver o resultado/lucro do mês");
  assert.equal(resGerente.data.mes.resultado_centavos, null, "resultado do mês tem que vir null pro GERENTE, nunca só escondido no front");
  assert.equal(resGerente.data.mes.falta_para_cobrir_contas_centavos, null);
});

test("central_do_dono: estoque negativo e conta vencendo entram em 'precisa da sua atenção'", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));

  await admin.from("insumos").update({ estoque_atual: -5 }).eq("id", seed.insumo.id);

  const adminCliente = await loginComo(seed.admin, "1234");
  // "hoje" pro servidor é dia_operacional (timezone da empresa + hora da
  // virada), não o dia UTC do Node — pega do jeito que o próprio
  // central_do_dono() calcula, numa chamada antes de criar a conta, pra
  // não duplicar essa conta na mão e virar um teste piscante perto da
  // virada (0h-8h UTC = fim de tarde/noite no Brasil).
  const resAntes = await adminCliente.rpc("central_do_dono");
  if (resAntes.error) throw resAntes.error;
  const hoje = resAntes.data.dia_operacional;

  await admin.from("contas").insert({
    empresa_id: seed.empresa.id, tipo: "PAGAR", descricao: "Conta Teste", valor_centavos: 15000, vencimento: hoje
  });

  const res = await adminCliente.rpc("central_do_dono");
  if (res.error) throw res.error;

  const estoqueAlerta = res.data.atencao.find((a) => a.tipo === "ESTOQUE_NEGATIVO");
  assert.ok(estoqueAlerta, "insumo com estoque negativo deveria gerar alerta");
  assert.equal(estoqueAlerta.qtd, 1);

  const contaAlerta = res.data.atencao.find((a) => a.tipo === "CONTAS_VENCENDO");
  assert.ok(contaAlerta, "conta a pagar vencendo hoje deveria gerar alerta");
  assert.equal(contaAlerta.valor_centavos, 15000);
});

test("central_do_dono: quem não tem a permissão (GARCOM) não consegue chamar a RPC", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));

  const garcomCliente = await loginComo(seed.garcom, "1234");
  const res = await garcomCliente.rpc("central_do_dono");
  assert.ok(res.error, "GARCOM não tem admin.central_dono.ver — a RPC deveria recusar");
});
