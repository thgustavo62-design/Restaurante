"use strict";
// VF-002 do plano de auditoria (docs/PLANO_DE_MELHORIAS.md) —
// offlineProcessarItem() devolvia só true/false: recusa definitiva do
// servidor e sucesso de verdade eram tratados igual, e o item sumia da
// fila nos dois casos. Agora devolve um status explícito (ENVIADO/
// PENDENTE_REDE/RECUSADO) e só item ENVIADO sai da fila.
//
// Diferente dos outros arquivos de teste: este não precisa de
// TEST_SUPABASE_URL — é lógica pura do client (assets/js/offline.js),
// testada num sandbox de VM com `sb`/`state`/`toast` mockados, sem rede
// nem IndexedDB real.

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function carregarOfflineJs(sbMock){
  const sandbox = {
    console,
    navigator: { onLine: true },
    state: { usuarioAtualId: "u1" },
    sb: sbMock,
    toast: function(){},
    carregarTudo: async function(){},
    render: function(){},
    window: {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "offline.js"), "utf8");
  vm.runInContext(src, sandbox, { filename: "offline.js" });
  return sandbox;
}

test("offlineProcessarItem: lancar_item — sucesso, recusa de negócio e erro de rede devolvem estados diferentes", async (t) => {
  const sandbox = carregarOfflineJs({
    from: function(){
      return {
        insert: function(){
          return {
            select: async function(){ return sandbox.__resultadoFake; }
          };
        }
      };
    }
  });

  sandbox.__resultadoFake = { error: null };
  const sucesso = await sandbox.offlineProcessarItem({ tipo: "lancar_item", payload: [{}] });
  assert.equal(sucesso.status, "ENVIADO");

  sandbox.__resultadoFake = { error: { code: "P0001", message: "Comanda já está paga" } };
  const recusado = await sandbox.offlineProcessarItem({ tipo: "lancar_item", payload: [{}] });
  assert.equal(recusado.status, "RECUSADO", "erro com code (regra de negócio do Postgres) tem que virar pendência, não sumir");
  assert.equal(recusado.erro, "Comanda já está paga");

  sandbox.navigator.onLine = false;
  const semRede = await sandbox.offlineProcessarItem({ tipo: "lancar_item", payload: [{}] });
  assert.equal(semRede.status, "PENDENTE_REDE", "sem internet não pode virar pendência — é só questão de tentar depois");
  sandbox.navigator.onLine = true;

  sandbox.__resultadoFake = { error: { code: "23505", message: "duplicado" } };
  const duplicado = await sandbox.offlineProcessarItem({ tipo: "lancar_item", payload: [{}] });
  assert.equal(duplicado.status, "ENVIADO", "client_uuid duplicado = já sincronizou numa tentativa anterior, conta como sucesso");
});

test("offlineProcessarItem: pagamento_dinheiro recusado vira RECUSADO, não ENVIADO", async (t) => {
  const sandbox = carregarOfflineJs({
    rpc: async function(){ return { error: { code: "P0001", message: "Faltam 500 centavos para cobrir o total" } }; }
  });
  const res = await sandbox.offlineProcessarItem({ tipo: "pagamento_dinheiro", payload: {} });
  assert.equal(res.status, "RECUSADO");
  assert.equal(res.erro, "Faltam 500 centavos para cobrir o total");
});

test("offlineSincronizar: só remove da fila o que foi ENVIADO — item RECUSADO fica marcado, não desaparece", async (t) => {
  const filaFake = [
    { id: "a", tipo: "lancar_item", criadoEm: 1, payload: [{}] },
    { id: "b", tipo: "lancar_item", criadoEm: 2, payload: [{}] },
  ];
  const removidos = [];
  const salvos = [];
  const sandbox = carregarOfflineJs({
    from: function(){
      return {
        insert: function(){
          return {
            select: async function(){
              // "a" é aceito pelo servidor, "b" é recusado (regra de negócio)
              return { error: null };
            }
          };
        }
      };
    }
  });
  // sobrescreve as funções de fila pra rodar sem IndexedDB de verdade
  sandbox.offlineListar = async function(){ return filaFake; };
  sandbox.offlineRemover = async function(id){ removidos.push(id); };
  sandbox.offlineSalvar = async function(item){ salvos.push(JSON.parse(JSON.stringify(item))); };
  // o segundo item ("b") precisa ser recusado — troca o mock do sb só pra ele
  var chamada = 0;
  sandbox.sb.from = function(){
    chamada++;
    var souB = chamada === 2;
    return {
      insert: function(){
        return {
          select: async function(){
            if(souB) return { error: { code: "P0001", message: "recusado" } };
            return { error: null };
          }
        };
      }
    };
  };

  await sandbox.offlineSincronizar();

  assert.deepEqual(removidos, ["a"], "só o item aceito deveria sumir da fila");
  assert.equal(salvos.length, 1, "o item recusado deveria ser regravado (marcado), não removido nem ignorado");
  assert.equal(salvos[0].id, "b");
  assert.equal(salvos[0].recusado, true);
  assert.equal(salvos[0].erroRecusa, "recusado");
});
