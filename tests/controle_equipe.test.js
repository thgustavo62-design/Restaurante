"use strict";
// PRIORIDADE 5 — Controle de Equipe: bater ponto verifica o PIN de
// verdade (mesmo mecanismo de autorização de supervisor) e PIN errado é
// recusado; corrigir ponto exige admin.equipe.editar e fica registrado
// na auditoria; comanda_itens grava iniciado_em/pronto_em/entregue_em
// sozinho quando o status muda; confirmar_pagamento agora grava
// taxa_servico_centavos (inclusive somando em pagamento parcial); o
// fechamento rateia a taxa (igualitário e por peso) e some com vales; e
// só ADMIN vê remuneração/líquido — GERENTE vê o resto do mesmo relatório.

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

async function criarGerente(admin, seed){
  const sufixo = Date.now().toString(36);
  const email = `${sufixo}-gerente@${seed.empresa.slug}.internal`;
  const { data: authUser, error: eAuth } = await admin.auth.admin.createUser({ email, password: "1234", email_confirm: true });
  if (eAuth) throw eAuth;
  const { error: eUsuario } = await admin.from("usuarios").insert({
    id: authUser.user.id, empresa_id: seed.empresa.id, nome: "Gerente Teste", papel: "GERENTE", ativo: true, email_interno: email
  });
  if (eUsuario) throw eUsuario;
  return { id: authUser.user.id, email, nome: "Gerente Teste", papel: "GERENTE" };
}

async function abrirComandaComItem(cliente, seed, status){
  const { data: comanda } = await cliente.from("comandas").insert({
    empresa_id: seed.empresa.id, codigo: "EQ" + Date.now(), mesa_id: seed.mesa.id, tipo: "MESA", status: "ABERTA", usuario_abertura: seed.garcom.id, taxa_servico_ativa: true
  }).select().single();
  const { data: item } = await cliente.from("comanda_itens").insert({
    comanda_id: comanda.id, produto_id: seed.produto.id, nome: "x", quantidade: 1, preco_unit_centavos: seed.produto.preco_centavos, status: status||"PENDENTE", usuario_id: seed.garcom.id, setor_producao: "COZINHA"
  }).select().single();
  return { comanda, item };
}

test("bater_ponto confere o PIN de verdade — certo registra, errado é recusado", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const garcomCliente = await loginComo(seed.garcom, "1234");

  const errado = await garcomCliente.rpc("bater_ponto", { p_usuario_id: seed.garcom.id, p_pin: "0000", p_tipo: "ENTRADA" });
  assert.ok(errado.error, "PIN errado deveria ser recusado");

  const certo = await garcomCliente.rpc("bater_ponto", { p_usuario_id: seed.garcom.id, p_pin: "1234", p_tipo: "ENTRADA" });
  if (certo.error) throw certo.error;
  assert.equal(certo.data.tipo, "ENTRADA");
  assert.equal(certo.data.usuario_id, seed.garcom.id);
});

test("corrigir_ponto exige admin.equipe.editar e grava a correção na auditoria", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const garcomCliente = await loginComo(seed.garcom, "1234");
  const bateu = await garcomCliente.rpc("bater_ponto", { p_usuario_id: seed.garcom.id, p_pin: "1234", p_tipo: "ENTRADA" });
  if (bateu.error) throw bateu.error;

  const semPermissao = await garcomCliente.rpc("corrigir_ponto", {
    p_ponto_id: bateu.data.id, p_novo_registrado_em: new Date().toISOString(), p_motivo: "teste"
  });
  assert.ok(semPermissao.error, "GARCOM não tem admin.equipe.editar — corrigir ponto deveria ser recusado");

  const adminCliente = await loginComo(seed.admin, "1234");
  const novoHorario = new Date(Date.now() - 3600000).toISOString();
  const corrigido = await adminCliente.rpc("corrigir_ponto", { p_ponto_id: bateu.data.id, p_novo_registrado_em: novoHorario, p_motivo: "Esqueceu de bater" });
  if (corrigido.error) throw corrigido.error;
  assert.equal(corrigido.data.corrigido, true);

  const { data: auditoria } = await admin.from("auditoria").select("*").eq("entidade", "pontos").eq("acao", "PONTO_CORRIGIDO").eq("entidade_id", bateu.data.id).single();
  assert.ok(auditoria, "correção de ponto deveria ficar na auditoria");
  assert.equal(auditoria.motivo, "Esqueceu de bater");
});

test("comanda_itens grava iniciado_em/pronto_em/entregue_em sozinho quando o status muda", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const garcomCliente = await loginComo(seed.garcom, "1234");
  const { item } = await abrirComandaComItem(garcomCliente, seed, "PENDENTE");

  await garcomCliente.from("comanda_itens").update({ status: "PREPARANDO" }).eq("id", item.id);
  const { data: apos1 } = await admin.from("comanda_itens").select("iniciado_em, pronto_em, entregue_em").eq("id", item.id).single();
  assert.ok(apos1.iniciado_em, "iniciado_em deveria ser preenchido ao virar PREPARANDO");
  assert.equal(apos1.pronto_em, null);

  await garcomCliente.from("comanda_itens").update({ status: "PRONTO" }).eq("id", item.id);
  await garcomCliente.from("comanda_itens").update({ status: "ENTREGUE" }).eq("id", item.id);
  const { data: apos2 } = await admin.from("comanda_itens").select("iniciado_em, pronto_em, entregue_em").eq("id", item.id).single();
  assert.ok(apos2.pronto_em, "pronto_em deveria ser preenchido ao virar PRONTO");
  assert.ok(apos2.entregue_em, "entregue_em deveria ser preenchido ao virar ENTREGUE");
  assert.equal(apos2.iniciado_em, apos1.iniciado_em, "iniciado_em não deveria mudar depois de já preenchido");
});

test("confirmar_pagamento grava taxa_servico_centavos (soma em pagamento parcial)", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixaCliente = await loginComo(seed.caixa, "1234");

  const { data: comanda } = await caixaCliente.from("comandas").insert({
    empresa_id: seed.empresa.id, codigo: "TX" + Date.now(), mesa_id: seed.mesa.id, tipo: "MESA", status: "ABERTA", usuario_abertura: seed.caixa.id, taxa_servico_ativa: true
  }).select().single();
  const { data: itens } = await caixaCliente.from("comanda_itens").insert([
    { comanda_id: comanda.id, produto_id: seed.produto.id, nome: "x", quantidade: 1, preco_unit_centavos: 1000, status: "PENDENTE", usuario_id: seed.caixa.id, setor_producao: "COZINHA" },
    { comanda_id: comanda.id, produto_id: seed.produto.id, nome: "x", quantidade: 1, preco_unit_centavos: 1000, status: "PENDENTE", usuario_id: seed.caixa.id, setor_producao: "COZINHA" }
  ]).select();
  const sessaoRes = await caixaCliente.from("caixa_sessoes").insert({ empresa_id: seed.empresa.id, terminal: "T1", usuario_abertura: seed.caixa.id, saldo_inicial_centavos: 0, status: "ABERTA" }).select().single();
  const sessao = sessaoRes.data;

  // paga item 1 (1000 + 10% = 1100)
  const res1 = await caixaCliente.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id, p_linhas: [{ forma: "DINHEIRO", valor_centavos: 1100 }],
    p_cliente_id: null, p_item_ids: [itens[0].id], p_sessao_id: sessao.id, p_pontos_resgatados: 0
  });
  if (res1.error) throw res1.error;
  // paga item 2
  const res2 = await caixaCliente.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id, p_linhas: [{ forma: "DINHEIRO", valor_centavos: 1100 }],
    p_cliente_id: null, p_item_ids: [itens[1].id], p_sessao_id: sessao.id, p_pontos_resgatados: 0
  });
  if (res2.error) throw res2.error;

  const { data: comandaFinal } = await admin.from("comandas").select("taxa_servico_centavos").eq("id", comanda.id).single();
  assert.equal(comandaFinal.taxa_servico_centavos, 200, "taxa de 10% de cada item (100+100) deveria somar nos dois pagamentos parciais");
});

test("relatorio_fechamento_equipe rateia a taxa (peso de função) e esconde remuneração de quem não é ADMIN", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const gerente = await criarGerente(admin, seed);

  await admin.from("empresas").update({ config: { taxaServicoPctPadrao: 10, rateioTaxaServico: "PESO" } }).eq("id", seed.empresa.id);
  await admin.from("usuarios").update({ peso_rateio_taxa: 3 }).eq("id", seed.garcom.id); // peso 3
  // seed.caixa fica com peso padrão 1 — garcom deveria levar 3x mais rateio.

  const caixaCliente = await loginComo(seed.caixa, "1234");
  const { comanda } = await abrirComandaComItem(caixaCliente, seed, "PENDENTE");
  const { data: sessao } = await caixaCliente.from("caixa_sessoes").insert({ empresa_id: seed.empresa.id, terminal: "T1", usuario_abertura: seed.caixa.id, saldo_inicial_centavos: 0, status: "ABERTA" }).select().single();
  const total = Math.round(seed.produto.preco_centavos * 1.10);
  const pagto = await caixaCliente.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id, p_linhas: [{ forma: "DINHEIRO", valor_centavos: total }],
    p_cliente_id: null, p_item_ids: null, p_sessao_id: sessao.id, p_pontos_resgatados: 0
  });
  if (pagto.error) throw pagto.error;

  const adminCliente = await loginComo(seed.admin, "1234");
  const valeRes = await adminCliente.rpc("registrar_vale", { p_usuario_id: seed.garcom.id, p_valor_centavos: 500, p_motivo: "Adiantamento", p_data: null });
  if (valeRes.error) throw valeRes.error;

  const hoje = new Date().toISOString().slice(0, 10);
  const resAdmin = await adminCliente.rpc("relatorio_fechamento_equipe", { p_desde: hoje, p_ate: hoje });
  if (resAdmin.error) throw resAdmin.error;
  assert.equal(resAdmin.data.pode_ver_remuneracao, true);
  const garcomLinhaAdmin = resAdmin.data.funcionarios.find((f) => f.usuario_id === seed.garcom.id);
  const caixaLinhaAdmin = resAdmin.data.funcionarios.find((f) => f.usuario_id === seed.caixa.id);
  assert.ok(garcomLinhaAdmin.rateio_taxa_centavos > caixaLinhaAdmin.rateio_taxa_centavos, "peso 3 deveria ratear mais que peso 1");
  assert.equal(garcomLinhaAdmin.vales_centavos, 500);
  assert.ok(garcomLinhaAdmin.liquido_centavos !== null, "ADMIN deveria ver o líquido");

  const gerenteCliente = await loginComo(gerente, "1234");
  const resGerente = await gerenteCliente.rpc("relatorio_fechamento_equipe", { p_desde: hoje, p_ate: hoje });
  if (resGerente.error) throw resGerente.error;
  assert.equal(resGerente.data.pode_ver_remuneracao, false);
  const garcomLinhaGerente = resGerente.data.funcionarios.find((f) => f.usuario_id === seed.garcom.id);
  assert.equal(garcomLinhaGerente.remuneracao_base_centavos, null, "GERENTE não deveria ver remuneração");
  assert.equal(garcomLinhaGerente.liquido_centavos, null, "GERENTE não deveria ver o líquido (revela remuneração)");
  assert.ok(garcomLinhaGerente.rateio_taxa_centavos > 0, "GERENTE ainda vê o rateio (não é dado de remuneração)");
});

test("central_do_dono mostra custo de equipe de verdade só pra ADMIN", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const gerente = await criarGerente(admin, seed);

  const salvou = await (await loginComo(seed.admin, "1234")).rpc("salvar_remuneracao", { p_usuario_id: seed.garcom.id, p_tipo: "MENSAL", p_valor_centavos: 150000 });
  if (salvou.error) throw salvou.error;

  const adminCliente = await loginComo(seed.admin, "1234");
  const resAdmin = await adminCliente.rpc("central_do_dono");
  if (resAdmin.error) throw resAdmin.error;
  assert.equal(resAdmin.data.mes.custo_equipe_disponivel, true);
  assert.ok(resAdmin.data.mes.custo_equipe_centavos >= 150000, "custo de equipe do mês deveria incluir o salário mensal cadastrado");

  const gerenteCliente = await loginComo(gerente, "1234");
  const resGerente = await gerenteCliente.rpc("central_do_dono");
  if (resGerente.error) throw resGerente.error;
  assert.equal(resGerente.data.mes.custo_equipe_centavos, null, "GERENTE não deveria ver o valor de custo de equipe (revela folha)");
});
