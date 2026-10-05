"use strict";
// PRIORIDADE 8 — Reservas / fila de espera: cobre o fluxo "pronto quando"
// do roteiro — reserva criada vira registro visível, "sentar" transforma
// reserva/fila numa comanda de mesa de verdade (tipo MESA, dia_operacional
// calculado com timezone, cliente vinculado), status inválido/duplo-sentar
// são barrados, e quem não tem atendimento.comanda.abrir não mexe em nada.

const test = require("node:test");
const assert = require("node:assert/strict");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

test("criar_reserva cria a reserva AGUARDANDO; atualizar_status_reserva confirma/marca não veio", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixaCliente = await loginComo(seed.caixa, "1234");

  const dataHora = new Date(Date.now() + 2 * 3600000).toISOString();
  const criada = await caixaCliente.rpc("criar_reserva", {
    p_nome: "Família Souza", p_telefone: "27999990000", p_pessoas: 4,
    p_data_hora: dataHora, p_observacao: "janela", p_mesa_sugerida_id: seed.mesa.id
  });
  if (criada.error) throw criada.error;
  assert.equal(criada.data.status, "AGUARDANDO");
  assert.equal(criada.data.mesa_sugerida_id, seed.mesa.id);

  const confirmada = await caixaCliente.rpc("atualizar_status_reserva", {
    p_reserva_id: criada.data.id, p_status: "CONFIRMADA"
  });
  if (confirmada.error) throw confirmada.error;
  assert.equal(confirmada.data.status, "CONFIRMADA");

  const naoVeio = await caixaCliente.rpc("atualizar_status_reserva", {
    p_reserva_id: criada.data.id, p_status: "NAO_VEIO"
  });
  if (naoVeio.error) throw naoVeio.error;
  assert.equal(naoVeio.data.status, "NAO_VEIO");
});

test("atualizar_status_reserva rejeita status inválido e não mexe em reserva já sentada", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixaCliente = await loginComo(seed.caixa, "1234");

  const criada = await caixaCliente.rpc("criar_reserva", {
    p_nome: "Teste Status", p_telefone: null, p_pessoas: 2,
    p_data_hora: new Date(Date.now() + 3600000).toISOString(), p_observacao: null, p_mesa_sugerida_id: null
  });
  if (criada.error) throw criada.error;

  const statusInvalido = await caixaCliente.rpc("atualizar_status_reserva", {
    p_reserva_id: criada.data.id, p_status: "SENTADO"
  });
  assert.ok(statusInvalido.error, "SENTADO só pode vir de sentar_reserva, não de atualizar_status_reserva");

  const sentada = await caixaCliente.rpc("sentar_reserva", {
    p_reserva_id: criada.data.id, p_mesa_id: seed.mesa.id, p_cliente_id: null
  });
  if (sentada.error) throw sentada.error;

  const tentaMexerDeNovo = await caixaCliente.rpc("atualizar_status_reserva", {
    p_reserva_id: criada.data.id, p_status: "CONFIRMADA"
  });
  assert.ok(tentaMexerDeNovo.error, "não deveria conseguir mudar status de reserva já sentada");
});

test("sentar_reserva cria comanda tipo MESA com dia_operacional e vincula o cliente", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixaCliente = await loginComo(seed.caixa, "1234");

  const { data: cliente, error: eCliente } = await admin.from("clientes").insert({
    empresa_id: seed.empresa.id, nome: "Cliente Reserva", consentimento_lgpd: true
  }).select().single();
  if (eCliente) throw eCliente;

  const criada = await caixaCliente.rpc("criar_reserva", {
    p_nome: "Mesa Reservada", p_telefone: "27988880000", p_pessoas: 3,
    p_data_hora: new Date(Date.now() + 3600000).toISOString(), p_observacao: null, p_mesa_sugerida_id: seed.mesa.id
  });
  if (criada.error) throw criada.error;

  const sentada = await caixaCliente.rpc("sentar_reserva", {
    p_reserva_id: criada.data.id, p_mesa_id: seed.mesa.id, p_cliente_id: cliente.id
  });
  if (sentada.error) throw sentada.error;

  assert.equal(sentada.data.comanda.tipo, "MESA");
  assert.equal(sentada.data.comanda.status, "ABERTA");
  assert.equal(sentada.data.comanda.mesa_id, seed.mesa.id);
  assert.ok(sentada.data.comanda.dia_operacional, "dia_operacional deveria vir preenchido (calculado via timezone)");
  assert.equal(sentada.data.reserva.status, "SENTADO");
  assert.equal(sentada.data.reserva.comanda_id, sentada.data.comanda.id);
  assert.equal(sentada.data.reserva.cliente_id, cliente.id);

  const { data: comandaNoBanco } = await admin.from("comandas").select("*").eq("id", sentada.data.comanda.id).single();
  assert.equal(comandaNoBanco.cliente_id, cliente.id, "comanda deveria ter o cliente da reserva vinculado");
});

test("entrar_fila + listar_fila_espera calcula posição e tempo estimado; sentar_fila cria a comanda", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixaCliente = await loginComo(seed.caixa, "1234");

  const entrada1 = await caixaCliente.rpc("entrar_fila", { p_nome: "Primeiro", p_telefone: "27900001111", p_pessoas: 2 });
  if (entrada1.error) throw entrada1.error;
  const entrada2 = await caixaCliente.rpc("entrar_fila", { p_nome: "Segundo", p_telefone: null, p_pessoas: 5 });
  if (entrada2.error) throw entrada2.error;

  const lista = await caixaCliente.rpc("listar_fila_espera");
  if (lista.error) throw lista.error;
  assert.equal(lista.data.length, 2);
  assert.equal(lista.data[0].id, entrada1.data.id, "primeiro a entrar deveria ser posição 1");
  assert.equal(lista.data[0].posicao, 1);
  assert.equal(lista.data[1].posicao, 2);
  assert.ok(lista.data[0].tempo_estimado_min >= 0);

  const chamado = await caixaCliente.rpc("atualizar_status_fila", { p_fila_id: entrada1.data.id, p_status: "CHAMADO" });
  if (chamado.error) throw chamado.error;
  assert.equal(chamado.data.status, "CHAMADO");

  const sentado = await caixaCliente.rpc("sentar_fila", { p_fila_id: entrada1.data.id, p_mesa_id: seed.mesa.id, p_cliente_id: null });
  if (sentado.error) throw sentado.error;
  assert.equal(sentado.data.comanda.tipo, "MESA");
  assert.equal(sentado.data.fila.status, "SENTADO");

  const listaDepois = await caixaCliente.rpc("listar_fila_espera");
  if (listaDepois.error) throw listaDepois.error;
  assert.equal(listaDepois.data.length, 1, "quem sentou não deveria mais aparecer na fila");
  assert.equal(listaDepois.data[0].id, entrada2.data.id);
});

test("atualizar_status_fila rejeita status inválido e não mexe em quem já sentou", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixaCliente = await loginComo(seed.caixa, "1234");

  const entrada = await caixaCliente.rpc("entrar_fila", { p_nome: "Status Teste", p_telefone: null, p_pessoas: 2 });
  if (entrada.error) throw entrada.error;

  const statusInvalido = await caixaCliente.rpc("atualizar_status_fila", { p_fila_id: entrada.data.id, p_status: "SENTADO" });
  assert.ok(statusInvalido.error, "SENTADO só pode vir de sentar_fila");

  const sentado = await caixaCliente.rpc("sentar_fila", { p_fila_id: entrada.data.id, p_mesa_id: seed.mesa.id, p_cliente_id: null });
  if (sentado.error) throw sentado.error;

  const tentaDesistir = await caixaCliente.rpc("atualizar_status_fila", { p_fila_id: entrada.data.id, p_status: "DESISTIU" });
  assert.ok(tentaDesistir.error, "não deveria conseguir mexer em quem já sentou");
});

test("quem não tem atendimento.comanda.abrir não cria nem senta reserva/fila", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));

  const sufixo = Date.now().toString(36);
  const email = `${sufixo}-cozinha@${seed.empresa.slug}.internal`;
  const { data: authUser, error: eAuth } = await admin.auth.admin.createUser({ email, password: "1234", email_confirm: true });
  if (eAuth) throw eAuth;
  const { error: eUsuario } = await admin.from("usuarios").insert({
    id: authUser.user.id, empresa_id: seed.empresa.id, nome: "Cozinha Teste", papel: "COZINHA", ativo: true, email_interno: email
  });
  if (eUsuario) throw eUsuario;
  t.after(() => admin.auth.admin.deleteUser(authUser.user.id).catch(() => {}));

  const cozinhaCliente = await loginComo({ email }, "1234");

  const tentaCriar = await cozinhaCliente.rpc("criar_reserva", {
    p_nome: "Não deveria", p_telefone: null, p_pessoas: 2,
    p_data_hora: new Date(Date.now() + 3600000).toISOString(), p_observacao: null, p_mesa_sugerida_id: null
  });
  assert.ok(tentaCriar.error, "COZINHA não tem atendimento.comanda.abrir, não deveria criar reserva");

  const tentaEntrarFila = await cozinhaCliente.rpc("entrar_fila", { p_nome: "Não deveria", p_telefone: null, p_pessoas: 2 });
  assert.ok(tentaEntrarFila.error, "COZINHA não deveria colocar ninguém na fila");

  // mas pode ver a fila (atendimento.salao.ver é de quem já tem KDS_VER? não —
  // COZINHA só tem KDS_VER/ITEM_STATUS, então listar_fila_espera também barra.
  const tentaListar = await cozinhaCliente.rpc("listar_fila_espera");
  assert.ok(tentaListar.error, "COZINHA não tem atendimento.salao.ver");
});
