"use strict";
// VF-005 do plano de auditoria (docs/PLANO_DE_MELHORIAS.md) —
// usuarios.email_interno e a tabela contas só filtravam por empresa_id,
// sem checar permissão — qualquer papel logado, inclusive COZINHA,
// conseguia ler o e-mail de login de todo mundo e todas as contas a
// pagar/receber via API direta.

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

test("usuarios: email_interno não é mais legível por ninguém via select direto (coluna revogada)", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));

  for (const quem of ["garcom", "caixa", "admin"]) {
    const cliente = await loginComo(seed[quem], "1234");
    const res = await cliente.from("usuarios").select("email_interno").eq("id", seed.admin.id);
    assert.ok(res.error, `${quem} não deveria conseguir ler email_interno nem da própria conta, nem de ninguém — coluna é revogada pra qualquer papel`);
  }
});

test("usuarios: nome/papel/ativo continuam legíveis por qualquer papel (pickers de supervisor/ponto precisam disso)", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const garcomCliente = await loginComo(seed.garcom, "1234");

  const res = await garcomCliente.from("usuarios").select("id, nome, papel, ativo").order("nome");
  if (res.error) throw res.error;
  assert.ok(res.data.length >= 3, "GARCOM precisa continuar vendo nome/papel dos colegas (supervisor picker, ponto, etc.)");
  assert.ok(res.data.some((u) => u.id === seed.admin.id), "deveria incluir o ADMIN na lista (candidato a supervisor)");
});

test("contas: só quem tem admin.financeiro.ver lê a tabela — GARCOM/COZINHA/CAIXA ficam de fora", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));

  await admin.from("contas").insert({
    empresa_id: seed.empresa.id, tipo: "PAGAR", descricao: "Aluguel", categoria: "Contas fixas", valor_centavos: 150000, vencimento: "2026-12-10"
  });

  const garcomCliente = await loginComo(seed.garcom, "1234");
  const resGarcom = await garcomCliente.from("contas").select("*");
  if (resGarcom.error) throw resGarcom.error;
  assert.equal(resGarcom.data.length, 0, "GARCOM não tem admin.financeiro.ver — a consulta tem que voltar vazia, não com as contas da empresa");

  const caixaCliente = await loginComo(seed.caixa, "1234");
  const resCaixa = await caixaCliente.from("contas").select("*");
  if (resCaixa.error) throw resCaixa.error;
  assert.equal(resCaixa.data.length, 0, "CAIXA tem caixa.pagamento.registrar mas não admin.financeiro.ver — não deveria ver as contas");

  const adminCliente = await loginComo(seed.admin, "1234");
  const resAdmin = await adminCliente.from("contas").select("*");
  if (resAdmin.error) throw resAdmin.error;
  assert.equal(resAdmin.data.length, 1, "ADMIN tem admin.financeiro.ver — deveria ver a conta normalmente");
});
