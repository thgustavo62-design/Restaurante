"use strict";
// PIN deixou de ser só numérico (0068) — agora aceita letras e números,
// ainda com 4 caracteres. Cobre as 3 RPCs que validam o formato
// (criar_funcionario, trocar_pin_funcionario, verificar_pin_supervisor,
// esta última exercitada via cancelar_item) e confirma que o PIN novo
// funciona de ponta a ponta (login de verdade, não só "a RPC não deu
// erro") — e que formatos claramente inválidos continuam recusados.

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

test("criar_funcionario aceita PIN alfanumérico e o funcionário loga com ele", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  let novoId = null;
  t.after(async () => {
    if (novoId) { try { await admin.auth.admin.deleteUser(novoId); } catch (e) { /* já pode ter ido com o cascade */ } }
    await limparEmpresaTeste(admin, seed);
  });
  const adminCliente = await loginComo(seed.admin, "1234");

  const res = await adminCliente.rpc("criar_funcionario", { p_nome: "Novo Garçom", p_papel: "GARCOM", p_pin: "1A2b" });
  if (res.error) throw res.error;
  novoId = res.data;

  const { data: usuarioNovo } = await admin.from("usuarios").select("email_interno").eq("id", novoId).single();
  const loginNovo = await loginComo({ email: usuarioNovo.email_interno }, "1A2b");
  const { data: sessao } = await loginNovo.auth.getSession();
  assert.ok(sessao.session, "deveria logar de verdade com o PIN alfanumérico recém-criado");
});

test("criar_funcionario recusa PIN fora do formato (curto, longo ou com símbolo)", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const adminCliente = await loginComo(seed.admin, "1234");

  for (const pinInvalido of ["12A", "12345", "1A2#", ""]) {
    const res = await adminCliente.rpc("criar_funcionario", { p_nome: "X", p_papel: "GARCOM", p_pin: pinInvalido });
    assert.ok(res.error, `PIN "${pinInvalido}" deveria ser recusado`);
  }
});

test("trocar_pin_funcionario aceita alfanumérico e o novo PIN passa a valer pro login", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const adminCliente = await loginComo(seed.admin, "1234");

  const res = await adminCliente.rpc("trocar_pin_funcionario", { p_usuario_id: seed.garcom.id, p_novo_pin: "zZ9k" });
  if (res.error) throw res.error;

  const loginComNovoPin = await loginComo(seed.garcom, "zZ9k");
  const { data: sessao } = await loginComNovoPin.auth.getSession();
  assert.ok(sessao.session, "deveria logar com o novo PIN alfanumérico");
});

test("verificar_pin_supervisor (via cancelar_item) aceita PIN alfanumérico do supervisor", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const adminCliente = await loginComo(seed.admin, "1234");
  const trocou = await adminCliente.rpc("trocar_pin_funcionario", { p_usuario_id: seed.admin.id, p_novo_pin: "Ab12" });
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
});
