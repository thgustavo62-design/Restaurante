"use strict";
// VF-017 — o total mostrado no modal de pagamento nunca pode ser o de uma
// consulta velha: (1) resposta atrasada de uma consulta antiga não
// sobrescreve a mais nova; (2) o botão "Confirmar" é bloqueado no instante em
// que algo muda, sem esperar a nova consulta começar.
//
// Lógica pura do client (assets/js/actions-caixa.js), sandbox de VM com
// `sb`/`state`/`render` mockados — não precisa de Supabase. (O lado do
// servidor, p_total_esperado_centavos, é coberto em blindagem/tests com banco.)

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function carregar(sbMock, extra) {
  const botao = { disabled: false };
  const sandbox = Object.assign({
    console, setTimeout, clearTimeout,
    state: { modal: null, comandas: [] },
    sb: sbMock,
    render: function () {},
    toast: function () {},
    document: { querySelector: function () { return botao; } },
    __botao: botao,
  }, extra || {});
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "actions-caixa.js"), "utf8");
  vm.runInContext(src, sandbox, { filename: "actions-caixa.js" });
  return sandbox;
}

function modalBase() {
  return { type: "pagamento", comandaId: "c1", modo: "pessoas", itensSelecionados: {}, pontosResgatados: 0, cupomCodigo: "", linhas: [], totaisServidor: null, totaisCarregando: false };
}

test("resposta atrasada de uma consulta antiga NÃO sobrescreve a mais nova", async () => {
  const pendentes = [];
  const sandbox = carregar({
    rpc: function () { return new Promise(function (resolve) { pendentes.push(resolve); }); }
  });
  const m = modalBase();
  sandbox.state.modal = m;

  const primeira = sandbox.executarAtualizarTotaisPagamento();   // consulta 1 no ar
  m.cupomCodigo = "NOVO";
  const segunda = sandbox.executarAtualizarTotaisPagamento();    // consulta 2 no ar
  assert.equal(pendentes.length, 2);

  pendentes[1]({ data: { total: 4500, subtotal: 5000 }, error: null }); // a nova volta primeiro
  await segunda;
  pendentes[0]({ data: { total: 9999, subtotal: 9999 }, error: null }); // a velha chega DEPOIS
  await primeira;

  assert.equal(m.totaisServidor.total, 4500, "a resposta velha não pode ter vencido");
  assert.equal(m.totaisCarregando, false);
});

test("atualizarTotaisPagamento bloqueia o botão Confirmar imediatamente, antes do debounce", async () => {
  const sandbox = carregar({ rpc: async function () { return { data: { total: 1000, subtotal: 1000 }, error: null }; } });
  const m = modalBase();
  m.totaisServidor = { total: 1000, subtotal: 1000 };
  sandbox.state.modal = m;
  assert.equal(sandbox.__botao.disabled, false);

  sandbox.atualizarTotaisPagamento();

  assert.equal(m.totaisCarregando, true, "total na tela já está velho");
  assert.equal(sandbox.__botao.disabled, true, "botão bloqueado na hora");
});
