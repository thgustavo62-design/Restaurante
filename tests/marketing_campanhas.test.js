"use strict";
// PRIORIDADE 9 — Marketing automático: campanhas_hoje() é o "banco
// identifica sozinho, humano clica" aprovado no lugar de envio automático
// de verdade — cobre quem entra na lista (aniversariante de hoje, reserva
// confirmada de hoje), quem fica de fora (aniversário em outro dia,
// reserva sem confirmar, cliente sem consentimento LGPD ou sem telefone —
// nada que não dá pra contatar de verdade aparece aqui) e a permissão.

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

function hojeISO(){
  return new Date().toISOString().slice(0, 10);
}
function outroDiaISO(){
  const d = new Date();
  d.setMonth(d.getMonth() === 0 ? 6 : 0, 15);
  return d.toISOString().slice(0, 10);
}

test("campanhas_hoje traz aniversariante de hoje com telefone e consentimento", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const adminCliente = await loginComo(seed.admin, "1234");

  const { error: e1 } = await admin.from("clientes").insert({
    empresa_id: seed.empresa.id, nome: "Aniversariante Hoje", telefone: "27999991111",
    aniversario: hojeISO(), consentimento_lgpd: true
  });
  if (e1) throw e1;
  const { error: e2 } = await admin.from("clientes").insert({
    empresa_id: seed.empresa.id, nome: "Aniversário em outro dia", telefone: "27999992222",
    aniversario: outroDiaISO(), consentimento_lgpd: true
  });
  if (e2) throw e2;
  const { error: e3 } = await admin.from("clientes").insert({
    empresa_id: seed.empresa.id, nome: "Sem consentimento", telefone: "27999993333",
    aniversario: hojeISO(), consentimento_lgpd: false
  });
  if (e3) throw e3;
  const { error: e4 } = await admin.from("clientes").insert({
    empresa_id: seed.empresa.id, nome: "Sem telefone", telefone: null,
    aniversario: hojeISO(), consentimento_lgpd: true
  });
  if (e4) throw e4;

  const res = await adminCliente.rpc("campanhas_hoje");
  if (res.error) throw res.error;

  assert.equal(res.data.aniversariantes.length, 1, "só o aniversariante de hoje com telefone e consentimento deveria aparecer");
  assert.equal(res.data.aniversariantes[0].nome, "Aniversariante Hoje");
  assert.equal(res.data.aniversariantes[0].telefone, "27999991111");
});

test("campanhas_hoje traz reserva CONFIRMADA de hoje, não traz AGUARDANDO nem sem telefone", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixaCliente = await loginComo(seed.caixa, "1234");
  const adminCliente = await loginComo(seed.admin, "1234");

  const confirmadaComTel = await caixaCliente.rpc("criar_reserva", {
    p_nome: "Reserva Confirmada", p_telefone: "27988887777", p_pessoas: 2,
    p_data_hora: new Date(Date.now() + 2 * 3600000).toISOString(), p_observacao: null, p_mesa_sugerida_id: null
  });
  if (confirmadaComTel.error) throw confirmadaComTel.error;
  const c1 = await caixaCliente.rpc("atualizar_status_reserva", { p_reserva_id: confirmadaComTel.data.id, p_status: "CONFIRMADA" });
  if (c1.error) throw c1.error;

  const aindaAguardando = await caixaCliente.rpc("criar_reserva", {
    p_nome: "Ainda Aguardando", p_telefone: "27988886666", p_pessoas: 2,
    p_data_hora: new Date(Date.now() + 3 * 3600000).toISOString(), p_observacao: null, p_mesa_sugerida_id: null
  });
  if (aindaAguardando.error) throw aindaAguardando.error;

  const semTelefone = await caixaCliente.rpc("criar_reserva", {
    p_nome: "Sem Telefone", p_telefone: null, p_pessoas: 2,
    p_data_hora: new Date(Date.now() + 4 * 3600000).toISOString(), p_observacao: null, p_mesa_sugerida_id: null
  });
  if (semTelefone.error) throw semTelefone.error;
  const c2 = await caixaCliente.rpc("atualizar_status_reserva", { p_reserva_id: semTelefone.data.id, p_status: "CONFIRMADA" });
  if (c2.error) throw c2.error;

  const res = await adminCliente.rpc("campanhas_hoje");
  if (res.error) throw res.error;

  assert.equal(res.data.reservas_confirmadas.length, 1, "só a reserva CONFIRMADA de hoje com telefone deveria aparecer");
  assert.equal(res.data.reservas_confirmadas[0].nome, "Reserva Confirmada");
});

test("campanhas_hoje exige admin.marketing.editar", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const garcomCliente = await loginComo(seed.garcom, "1234");

  const res = await garcomCliente.rpc("campanhas_hoje");
  assert.ok(res.error, "GARCOM não tem admin.marketing.editar");
});
