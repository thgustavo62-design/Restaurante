"use strict";
// PIN aceita letras e números desde a 0068 (4 caracteres,
// `^[A-Za-z0-9]{4}$`) — isso continua igual. O que mudou na 0078
// (VF-003 do plano de auditoria): o PIN **não é mais a senha de login**
// de ninguém. criar_funcionario exige senha de acesso (8+ caracteres,
// Supabase Auth) separada do PIN operacional (hash local, pgcrypto) —
// só a senha loga; o PIN autoriza supervisor/bate ponto, nunca mais
// `/auth/v1/token`.

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

test("criar_funcionario: a SENHA loga, o PIN sozinho NÃO loga mais", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  let novoId = null;
  t.after(async () => {
    if (novoId) { try { await admin.auth.admin.deleteUser(novoId); } catch (e) { /* já pode ter ido com o cascade */ } }
    await limparEmpresaTeste(admin, seed);
  });
  const adminCliente = await loginComo(seed.admin, "1234");

  const res = await adminCliente.rpc("criar_funcionario", { p_nome: "Novo Garçom", p_papel: "GARCOM", p_senha: "senhaForte123", p_pin: "1A2b" });
  if (res.error) throw res.error;
  novoId = res.data;

  const { data: usuarioNovo } = await admin.from("usuarios").select("email_interno").eq("id", novoId).single();

  const loginComSenha = await loginComo({ email: usuarioNovo.email_interno }, "senhaForte123");
  const { data: sessaoComSenha } = await loginComSenha.auth.getSession();
  assert.ok(sessaoComSenha.session, "deveria logar com a senha de acesso de verdade");

  await assert.rejects(
    loginComo({ email: usuarioNovo.email_interno }, "1A2b"),
    "o PIN sozinho não deveria mais funcionar como senha de login (era exatamente isso que o VF-003 corrigia)"
  );
});

test("criar_funcionario recusa senha curta, PIN fora do formato, e senha igual ao PIN", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const adminCliente = await loginComo(seed.admin, "1234");

  const senhaCurta = await adminCliente.rpc("criar_funcionario", { p_nome: "X", p_papel: "GARCOM", p_senha: "curta12", p_pin: "1A2b" });
  assert.ok(senhaCurta.error, "senha com menos de 8 caracteres deveria ser recusada");

  for (const pinInvalido of ["12A", "12345", "1A2#", ""]) {
    const res = await adminCliente.rpc("criar_funcionario", { p_nome: "X", p_papel: "GARCOM", p_senha: "senhaForte123", p_pin: pinInvalido });
    assert.ok(res.error, `PIN "${pinInvalido}" deveria ser recusado`);
  }

  const senhaIgualPin = await adminCliente.rpc("criar_funcionario", { p_nome: "X", p_papel: "GARCOM", p_senha: "Abcd", p_pin: "Abcd" });
  assert.ok(senhaIgualPin.error, "senha igual ao PIN deveria ser recusada mesmo que o formato de cada um sozinho seja válido");
});

test("trocar_credenciais_funcionario troca senha e PIN de forma independente", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const adminCliente = await loginComo(seed.admin, "1234");

  // só o PIN: a senha de login ("1234") continua valendo igual antes.
  const soPin = await adminCliente.rpc("trocar_credenciais_funcionario", { p_usuario_id: seed.garcom.id, p_novo_pin: "zZ9k" });
  if (soPin.error) throw soPin.error;
  const loginSenhaAntiga = await loginComo(seed.garcom, "1234");
  const { data: sessaoSenhaAntiga } = await loginSenhaAntiga.auth.getSession();
  assert.ok(sessaoSenhaAntiga.session, "trocar só o PIN não deveria mexer na senha de login");

  // só a senha: o PIN recém-trocado continua valendo pra autorização.
  const soSenha = await adminCliente.rpc("trocar_credenciais_funcionario", { p_usuario_id: seed.garcom.id, p_nova_senha: "novaSenhaForte1" });
  if (soSenha.error) throw soSenha.error;
  const loginNovaSenha = await loginComo(seed.garcom, "novaSenhaForte1");
  const { data: sessaoNovaSenha } = await loginNovaSenha.auth.getSession();
  assert.ok(sessaoNovaSenha.session, "deveria logar com a senha nova");

  // nenhum dos dois preenchido: recusado.
  const nenhum = await adminCliente.rpc("trocar_credenciais_funcionario", { p_usuario_id: seed.garcom.id });
  assert.ok(nenhum.error, "sem senha nem PIN novo não deveria aceitar a chamada");
});

test("verificar_pin_supervisor (via cancelar_item) confere o PIN contra o hash local, não contra o Auth", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const adminCliente = await loginComo(seed.admin, "1234");
  const trocou = await adminCliente.rpc("trocar_credenciais_funcionario", { p_usuario_id: seed.admin.id, p_novo_pin: "Ab12" });
  if (trocou.error) throw trocou.error;

  const garcomCliente = await loginComo(seed.garcom, "1234");
  const { data: comanda } = await garcomCliente.from("comandas").insert({
    empresa_id: seed.empresa.id, codigo: "PINT" + Date.now(), mesa_id: seed.mesa.id, tipo: "MESA", status: "ABERTA", usuario_abertura: seed.garcom.id, taxa_servico_ativa: true
  }).select().single();
  const { data: item } = await garcomCliente.from("comanda_itens").insert({
    comanda_id: comanda.id, produto_id: seed.produto.id, nome: "x", quantidade: 1, preco_unit_centavos: 1, status: "PENDENTE", usuario_id: seed.garcom.id, setor_producao: "COZINHA"
  }).select().single();

  const tent = await garcomCliente.rpc("registrar_tentativa_pin", { p_usuario_id: seed.admin.id });
  if (tent.error) throw tent.error;
  const res = await garcomCliente.rpc("cancelar_item", {
    p_item_id: item.id, p_motivo: "Teste PIN alfanumérico", p_supervisor_id: seed.admin.id, p_supervisor_pin: "Ab12", p_tentativa_id: tent.data
  });
  if (res.error) throw res.error;
  assert.equal(res.data.status, "CANCELADO");

  // trocar o PIN NÃO deveria ter mexido na senha de login do ADMIN — a
  // prova real de que os dois são independentes de verdade.
  const loginAdminSenhaAntiga = await loginComo(seed.admin, "1234");
  const { data: sessaoAdmin } = await loginAdminSenhaAntiga.auth.getSession();
  assert.ok(sessaoAdmin.session, "trocar o PIN do ADMIN não deveria ter trocado a senha de login dele");
});

test("verificar_pin_supervisor recusa quando o funcionário nunca teve PIN definido (pin_hash nulo)", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  // zera o pin_hash do admin pra simular uma conta migrada sem PIN ainda definido.
  await admin.from("usuarios").update({ pin_hash: null }).eq("id", seed.admin.id);

  const garcomCliente = await loginComo(seed.garcom, "1234");
  const { data: comanda } = await garcomCliente.from("comandas").insert({
    empresa_id: seed.empresa.id, codigo: "PINN" + Date.now(), mesa_id: seed.mesa.id, tipo: "MESA", status: "ABERTA", usuario_abertura: seed.garcom.id, taxa_servico_ativa: true
  }).select().single();
  const { data: item } = await garcomCliente.from("comanda_itens").insert({
    comanda_id: comanda.id, produto_id: seed.produto.id, nome: "x", quantidade: 1, preco_unit_centavos: 1, status: "PENDENTE", usuario_id: seed.garcom.id, setor_producao: "COZINHA"
  }).select().single();

  const tent = await garcomCliente.rpc("registrar_tentativa_pin", { p_usuario_id: seed.admin.id });
  if (tent.error) throw tent.error;
  const res = await garcomCliente.rpc("cancelar_item", {
    p_item_id: item.id, p_motivo: "Teste pin_hash nulo", p_supervisor_id: seed.admin.id, p_supervisor_pin: "1234", p_tentativa_id: tent.data
  });
  assert.ok(res.error, "sem pin_hash definido, nenhum PIN deveria autorizar — nunca cair pra validar contra o Auth de novo");
});
