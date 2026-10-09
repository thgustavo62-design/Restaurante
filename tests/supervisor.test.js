"use strict";
// Fase 4.4 — autorização de supervisor (0043): GARCOM sem permissão
// própria consegue cancelar item / aplicar desconto usando o PIN de um
// supervisor (ADMIN/GERENTE), verificado no servidor. Cobre também o bug
// corrigido na 0060: verificar_pin_supervisor tinha voltado a reconstruir
// o e-mail do supervisor a partir do NOME em vez de usar email_interno —
// o teste de "supervisor renomeado" existe exatamente pra pegar essa
// regressão se ela voltar.

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

async function abrirComandaComItem(garcomCliente, seed){
  const { data: comanda } = await garcomCliente
    .from("comandas").insert({ empresa_id: seed.empresa.id, codigo: "T" + Date.now(), mesa_id: seed.mesa.id, tipo: "MESA", status: "ABERTA", usuario_abertura: seed.garcom.id, taxa_servico_ativa: true })
    .select().single();
  const { data: itens } = await garcomCliente.from("comanda_itens")
    .insert({ comanda_id: comanda.id, produto_id: seed.produto.id, nome: "x", quantidade: 1, preco_unit_centavos: 1, status: "PENDENTE", usuario_id: seed.garcom.id, setor_producao: "COZINHA" })
    .select();
  return { comanda, item: itens[0] };
}

test("cancelar_item — GARCOM sem permissão própria consegue com PIN do ADMIN", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const garcomCliente = await loginComo(seed.garcom, "1234");

  const { item } = await abrirComandaComItem(garcomCliente, seed);

  const tent = await garcomCliente.rpc("registrar_tentativa_pin", { p_usuario_id: seed.admin.id });
  if (tent.error) throw tent.error;
  const res = await garcomCliente.rpc("cancelar_item", {
    p_item_id: item.id, p_motivo: "Pedido em duplicidade",
    p_supervisor_id: seed.admin.id, p_supervisor_pin: "1234", p_tentativa_id: tent.data
  });
  if (res.error) throw res.error;
  assert.equal(res.data.status, "CANCELADO");

  const { data: auditoria } = await admin.from("auditoria").select("motivo").eq("entidade_id", item.id).eq("acao", "CANCELAR_ITEM").single();
  assert.ok(auditoria.motivo.includes("Admin Teste"), "auditoria deveria registrar quem aprovou");
});

test("cancelar_item — PIN errado do supervisor é recusado", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const garcomCliente = await loginComo(seed.garcom, "1234");

  const { item } = await abrirComandaComItem(garcomCliente, seed);
  const tent = await garcomCliente.rpc("registrar_tentativa_pin", { p_usuario_id: seed.admin.id });
  if (tent.error) throw tent.error;
  const res = await garcomCliente.rpc("cancelar_item", {
    p_item_id: item.id, p_motivo: "Teste",
    p_supervisor_id: seed.admin.id, p_supervisor_pin: "0000", p_tentativa_id: tent.data
  });
  assert.ok(res.error, "PIN errado deveria ser recusado");

  // VF-004 — a tentativa errada tem que sobreviver ao rollback do "raise
  // exception" de cancelar_item: é exatamente esse registro durável que
  // antes desaparecia (o INSERT acontecia na MESMA transação que falhava
  // logo em seguida, e Postgres desfazia os dois juntos).
  const { data: tentativa } = await admin.from("tentativas_autorizacao").select("sucesso").eq("id", tent.data).single();
  assert.equal(tentativa.sucesso, false, "a tentativa errada precisa continuar gravada como falha, não sumir com o rollback");
});

test("cancelar_item — supervisor renomeado depois de criado continua autorizando (regressão da 0060)", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));

  // renomeia o ADMIN DEPOIS de criado — se a verificação ainda
  // reconstruísse o e-mail a partir do nome (bug da 0060), isso quebraria
  // a autorização mesmo com o PIN certo.
  await admin.from("usuarios").update({ nome: "Administradora Renomeada Com Acentuação" }).eq("id", seed.admin.id);

  const garcomCliente = await loginComo(seed.garcom, "1234");
  const { item } = await abrirComandaComItem(garcomCliente, seed);

  const tent = await garcomCliente.rpc("registrar_tentativa_pin", { p_usuario_id: seed.admin.id });
  if (tent.error) throw tent.error;
  const res = await garcomCliente.rpc("cancelar_item", {
    p_item_id: item.id, p_motivo: "Teste pós-renomeação",
    p_supervisor_id: seed.admin.id, p_supervisor_pin: "1234", p_tentativa_id: tent.data
  });
  if (res.error) throw res.error;
  assert.equal(res.data.status, "CANCELADO", "renomear o supervisor não deveria quebrar a autorização de PIN dele");
});

test("aplicar_desconto — GERENTE/ADMIN dentro do limite não precisa de supervisor", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  await admin.from("empresas").update({ config: { taxaServicoPctPadrao: 10, limiteDescontoPct: 15 } }).eq("id", seed.empresa.id);

  const adminCliente = await loginComo(seed.admin, "1234");
  const { comanda } = await abrirComandaComItem(adminCliente, seed);

  const res = await adminCliente.rpc("aplicar_desconto", { p_comanda_id: comanda.id, p_percentual: 10, p_supervisor_id: null, p_supervisor_pin: null });
  if (res.error) throw res.error;
  assert.ok(res.data.desconto_centavos > 0);
});
