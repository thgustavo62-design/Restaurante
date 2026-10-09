"use strict";
// VF-004 do plano de auditoria (docs/PLANO_DE_MELHORIAS.md) —
// registrar_tentativa_pin existe porque o INSERT em tentativas_autorizacao
// não podia mais morar dentro de verificar_pin_supervisor/bater_ponto: a
// exceção que essas funções lançam quando o PIN está errado desfazia a
// transação inteira, o INSERT junto — o contador de "5 falhas/5 min"
// nunca acumulava de verdade. Agora o registro acontece numa chamada à
// parte, que sempre commita, ANTES da verificação de verdade.

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

async function abrirComandaComItem(cliente, seed){
  const { data: comanda } = await cliente.from("comandas").insert({
    empresa_id: seed.empresa.id, codigo: "TPIN" + Date.now(), mesa_id: seed.mesa.id, tipo: "MESA", status: "ABERTA", usuario_abertura: seed.garcom.id, taxa_servico_ativa: true
  }).select().single();
  const { data: item } = await cliente.from("comanda_itens").insert({
    comanda_id: comanda.id, produto_id: seed.produto.id, nome: "x", quantidade: 1, preco_unit_centavos: seed.produto.preco_centavos, status: "PENDENTE", usuario_id: seed.garcom.id, setor_producao: "COZINHA"
  }).select().single();
  return { comanda, item };
}

test("registrar_tentativa_pin bloqueia de verdade depois de 5 falhas em 5 minutos", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const garcomCliente = await loginComo(seed.garcom, "1234");

  // 5 tentativas registradas e nunca confirmadas como certas (ninguém
  // chamou cancelar_item/bater_ponto pra marcar sucesso=true) — é
  // exatamente o estado de "5 PINs errados seguidos".
  for (let i = 0; i < 5; i++) {
    const tent = await garcomCliente.rpc("registrar_tentativa_pin", { p_usuario_id: seed.admin.id });
    if (tent.error) throw tent.error;
  }

  const sexta = await garcomCliente.rpc("registrar_tentativa_pin", { p_usuario_id: seed.admin.id });
  assert.ok(sexta.error, "a 6ª tentativa dentro da janela de 5 min deveria ser bloqueada no backend");

  const { data: tentativas } = await admin.from("tentativas_autorizacao").select("id").eq("supervisor_id", seed.admin.id);
  assert.equal(tentativas.length, 5, "deveriam existir exatamente 5 tentativas gravadas — nenhuma a mais (a 6ª foi recusada antes de inserir), nenhuma a menos (é esse o bug que o VF-004 corrige)");
});

test("verificar_pin_supervisor (via cancelar_item) recusa tentativa já usada (replay)", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const garcomCliente = await loginComo(seed.garcom, "1234");

  const { item: item1 } = await abrirComandaComItem(garcomCliente, seed);
  const { item: item2 } = await abrirComandaComItem(garcomCliente, seed);

  const tent = await garcomCliente.rpc("registrar_tentativa_pin", { p_usuario_id: seed.admin.id });
  if (tent.error) throw tent.error;

  const primeiro = await garcomCliente.rpc("cancelar_item", {
    p_item_id: item1.id, p_motivo: "Primeiro cancelamento", p_supervisor_id: seed.admin.id, p_supervisor_pin: "1234", p_tentativa_id: tent.data
  });
  if (primeiro.error) throw primeiro.error;

  // reusar o MESMO tentativa_id pra autorizar um SEGUNDO cancelamento —
  // sem registrar uma tentativa nova — tem que ser recusado.
  const replay = await garcomCliente.rpc("cancelar_item", {
    p_item_id: item2.id, p_motivo: "Segundo cancelamento (replay)", p_supervisor_id: seed.admin.id, p_supervisor_pin: "1234", p_tentativa_id: tent.data
  });
  assert.ok(replay.error, "reusar uma tentativa já marcada como sucesso deveria ser recusado");
});

test("verificar_pin_supervisor recusa tentativa_id inexistente ou de outro supervisor", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const garcomCliente = await loginComo(seed.garcom, "1234");
  const { item } = await abrirComandaComItem(garcomCliente, seed);

  const aleatorio = await garcomCliente.rpc("cancelar_item", {
    p_item_id: item.id, p_motivo: "Sem tentativa registrada",
    p_supervisor_id: seed.admin.id, p_supervisor_pin: "1234",
    p_tentativa_id: "00000000-0000-0000-0000-000000000000"
  });
  assert.ok(aleatorio.error, "tentativa_id que não existe deveria ser recusada");

  // tentativa registrada pro CAIXA, usada pra autorizar com o PIN do ADMIN
  // — não pode valer, mistura identidade de quem está sendo autorizado.
  const tentDoCaixa = await garcomCliente.rpc("registrar_tentativa_pin", { p_usuario_id: seed.caixa.id });
  if (tentDoCaixa.error) throw tentDoCaixa.error;
  const cruzado = await garcomCliente.rpc("cancelar_item", {
    p_item_id: item.id, p_motivo: "Tentativa de outro supervisor",
    p_supervisor_id: seed.admin.id, p_supervisor_pin: "1234",
    p_tentativa_id: tentDoCaixa.data
  });
  assert.ok(cruzado.error, "tentativa registrada pro CAIXA não deveria autorizar uma ação em nome do ADMIN");
});

test("registrar_tentativa_pin exige usuário da mesma empresa", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  const seed2 = await seedEmpresaTeste(admin);
  t.after(async () => { await limparEmpresaTeste(admin, seed); await limparEmpresaTeste(admin, seed2); });
  const garcomCliente = await loginComo(seed.garcom, "1234");

  const res = await garcomCliente.rpc("registrar_tentativa_pin", { p_usuario_id: seed2.admin.id });
  assert.ok(res.error, "não deveria conseguir registrar tentativa pra um usuário de outra empresa");
});
