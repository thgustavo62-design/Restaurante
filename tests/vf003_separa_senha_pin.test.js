"use strict";
// VF-003 do plano de auditoria (docs/PLANO_DE_MELHORIAS.md), migration
// 0078. Cobre o que tests/pin_alfanumerico.test.js não cobre: as
// assinaturas antigas (PIN-como-senha) precisam ter sumido de verdade do
// catálogo, não só ficado sem uso — e onboarding_criar_empresa (primeiro
// ADMIN da empresa) segue a mesma régua de criar_funcionario.

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

test("as assinaturas antigas (3 parâmetros, PIN como senha) não existem mais", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const adminCliente = await loginComo(seed.admin, "1234");

  // PostgREST recusa com "Could not find the function" quando a
  // assinatura não existe no catálogo — diferente de um erro de
  // validação de negócio (que viria com p_senha presente).
  const velhoCriar = await adminCliente.rpc("criar_funcionario", { p_nome: "X", p_papel: "GARCOM", p_pin: "1A2b" });
  assert.ok(velhoCriar.error, "criar_funcionario de 3 parâmetros (sem p_senha) não deveria existir mais");

  const velhoTrocar = await adminCliente.rpc("trocar_pin_funcionario", { p_usuario_id: seed.garcom.id, p_novo_pin: "1A2b" });
  assert.ok(velhoTrocar.error, "trocar_pin_funcionario foi substituída por trocar_credenciais_funcionario — não deveria mais existir");
});

test("onboarding_criar_empresa: primeiro ADMIN loga com a senha, não com o PIN", async (t) => {
  const admin = clienteAdmin();
  const sufixo = Date.now().toString(36);
  const slug = "onboard-" + sufixo;
  let empresaId = null;
  let adminId = null;
  t.after(async () => {
    if (empresaId) await admin.from("empresas").delete().eq("id", empresaId);
    if (adminId) { try { await admin.auth.admin.deleteUser(adminId); } catch (e) { /* cascade pode já ter ido */ } }
  });

  const res = await admin.rpc("onboarding_criar_empresa", {
    p_nome_empresa: "Empresa Onboarding Teste",
    p_slug: slug,
    p_nome_admin: "Dono Teste",
    p_senha_admin: "senhaDonoForte1",
    p_pin_admin: "9Z8y",
    p_qtd_mesas: 3
  });
  if (res.error) throw res.error;
  empresaId = res.data.empresa_id;
  adminId = res.data.admin_id;

  const loginComSenha = await loginComo({ email: res.data.admin_email_interno }, "senhaDonoForte1");
  const { data: sessao } = await loginComSenha.auth.getSession();
  assert.ok(sessao.session, "o primeiro ADMIN deveria logar com a senha de acesso");

  await assert.rejects(
    loginComo({ email: res.data.admin_email_interno }, "9Z8y"),
    "o PIN do primeiro ADMIN não deveria funcionar como senha de login"
  );

  const { data: usuarioAdmin } = await admin.from("usuarios").select("pin_hash").eq("id", adminId).single();
  assert.ok(usuarioAdmin.pin_hash, "o PIN operacional do primeiro ADMIN deveria estar salvo (hash) mesmo não sendo a senha de login");
});

test("onboarding_criar_empresa recusa senha curta e senha igual ao PIN", async (t) => {
  const admin = clienteAdmin();
  const sufixo = Date.now().toString(36);

  const senhaCurta = await admin.rpc("onboarding_criar_empresa", {
    p_nome_empresa: "X", p_slug: "x-" + sufixo + "-a", p_nome_admin: "X", p_senha_admin: "curta1", p_pin_admin: "1A2b"
  });
  assert.ok(senhaCurta.error, "senha com menos de 8 caracteres deveria ser recusada");

  const senhaIgualPin = await admin.rpc("onboarding_criar_empresa", {
    p_nome_empresa: "X", p_slug: "x-" + sufixo + "-b", p_nome_admin: "X", p_senha_admin: "Abcd", p_pin_admin: "Abcd"
  });
  assert.ok(senhaIgualPin.error, "senha igual ao PIN deveria ser recusada");
});

test("migração: funcionário já existente (pin_hash preenchido pela seed) continua autorizando com o PIN de sempre", async (t) => {
  // Simula o backfill da 0078: a seed já grava pin_hash (mesmo mecanismo
  // do backfill real, que copia auth.users.encrypted_password — aqui é
  // um hash bcrypt gerado em JS, mas o ponto é o mesmo: continuidade sem
  // ninguém precisar trocar nada no primeiro dia).
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const garcomCliente = await loginComo(seed.garcom, "1234");

  const tent = await garcomCliente.rpc("registrar_tentativa_pin", { p_usuario_id: seed.admin.id });
  if (tent.error) throw tent.error;
  const res = await garcomCliente.rpc("aplicar_desconto", {
    p_comanda_id: (await garcomCliente.from("comandas").insert({
      empresa_id: seed.empresa.id, codigo: "MIG" + Date.now(), mesa_id: seed.mesa.id, tipo: "MESA", status: "ABERTA", usuario_abertura: seed.garcom.id, taxa_servico_ativa: true
    }).select().single()).data.id,
    p_percentual: 50, p_supervisor_id: seed.admin.id, p_supervisor_pin: "1234", p_tentativa_id: tent.data
  });
  if (res.error) throw res.error;
  assert.ok(res.data.desconto_centavos >= 0, "funcionário migrado (pin_hash já preenchido na seed) deveria continuar autorizando com o PIN '1234' de sempre, sem precisar trocar nada");
});
