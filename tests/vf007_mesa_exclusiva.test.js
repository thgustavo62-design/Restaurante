"use strict";
// VF-007 (0081) — no máximo uma comanda de MESA ativa por mesa: duas reservas
// disputando a mesma mesa ao mesmo tempo, reserva NAO_VEIO e fila DESISTIU
// não podem ser sentadas, e o INSERT direto do client (abrirComanda) também
// esbarra no índice único.
//
// Ainda não rodou contra um Supabase de verdade (sem projeto de
// homologação — ver tests/README.md). A lógica equivalente foi conferida em
// produção via MCP com transação desfeita no final (10/10/2026).

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

async function novaReserva(cliente, nome) {
  const r = await cliente.rpc("criar_reserva", {
    p_nome: nome, p_telefone: null, p_pessoas: 2,
    p_data_hora: new Date(Date.now() + 3600000).toISOString(), p_observacao: null, p_mesa_sugerida_id: null
  });
  if (r.error) throw r.error;
  return r.data;
}

test("duas reservas sentando na mesma mesa ao mesmo tempo: só uma vira comanda", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixa = await loginComo(seed.caixa, "1234");

  const r1 = await novaReserva(caixa, "Corrida A");
  const r2 = await novaReserva(caixa, "Corrida B");

  const [a, b] = await Promise.all([
    caixa.rpc("sentar_reserva", { p_reserva_id: r1.id, p_mesa_id: seed.mesa.id, p_cliente_id: null }),
    caixa.rpc("sentar_reserva", { p_reserva_id: r2.id, p_mesa_id: seed.mesa.id, p_cliente_id: null })
  ]);
  const sucessos = [a, b].filter((x) => !x.error);
  const falhas = [a, b].filter((x) => x.error);
  assert.equal(sucessos.length, 1, "exatamente uma das duas deve sentar");
  assert.equal(falhas.length, 1);
  assert.match(falhas[0].error.message, /ocupada/i);

  const ativas = await admin.from("comandas").select("id")
    .eq("mesa_id", seed.mesa.id).in("status", ["ABERTA", "FECHANDO"]);
  assert.equal(ativas.data.length, 1, "nunca duas comandas ativas na mesma mesa");
});

test("reserva NAO_VEIO não pode ser sentada; mesa ocupada recusa sentar", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixa = await loginComo(seed.caixa, "1234");

  const naoVeio = await novaReserva(caixa, "Não veio");
  const marcou = await caixa.rpc("atualizar_status_reserva", { p_reserva_id: naoVeio.id, p_status: "NAO_VEIO" });
  if (marcou.error) throw marcou.error;
  const tentativa = await caixa.rpc("sentar_reserva", { p_reserva_id: naoVeio.id, p_mesa_id: seed.mesa.id, p_cliente_id: null });
  assert.ok(tentativa.error);
  assert.match(tentativa.error.message, /NAO_VEIO/);

  const ok = await novaReserva(caixa, "Vai sentar");
  const sentou = await caixa.rpc("sentar_reserva", { p_reserva_id: ok.id, p_mesa_id: seed.mesa.id, p_cliente_id: null });
  if (sentou.error) throw sentou.error;

  const outra = await novaReserva(caixa, "Mesa já ocupada");
  const recusada = await caixa.rpc("sentar_reserva", { p_reserva_id: outra.id, p_mesa_id: seed.mesa.id, p_cliente_id: null });
  assert.ok(recusada.error);
  assert.match(recusada.error.message, /ocupada/i);
});

test("INSERT direto de segunda comanda ativa na mesma mesa viola o índice único", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixa = await loginComo(seed.caixa, "1234");

  const base = { empresa_id: seed.empresa.id, mesa_id: seed.mesa.id, tipo: "MESA", status: "ABERTA", usuario_abertura: seed.caixa.id };
  const primeira = await caixa.from("comandas").insert({ ...base, codigo: "VF7A" + Date.now().toString(36) }).select().single();
  if (primeira.error) throw primeira.error;
  const segunda = await caixa.from("comandas").insert({ ...base, codigo: "VF7B" + Date.now().toString(36) }).select().single();
  assert.ok(segunda.error);
  assert.equal(segunda.error.code, "23505");
});
