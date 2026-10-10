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
  // (VF-009: itens antigos, sem contexto, também são regravados uma vez com o
  // carimbo — por isso filtra só as gravações de recusa)
  const regravadosRecusa = salvos.filter((x) => x.recusado);
  assert.equal(regravadosRecusa.length, 1, "o item recusado deveria ser regravado (marcado), não removido nem ignorado");
  assert.equal(regravadosRecusa[0].id, "b");
  assert.equal(regravadosRecusa[0].erroRecusa, "recusado");
});

// VF-010 fase 2 — recebimento em dinheiro offline recusado de verdade: o
// aparelho avisa o servidor (registrar_recebimento_offline_recusado) pra o
// dinheiro físico não depender só da pendência local.
test("pagamento_dinheiro recusado com chave: registra a recusa no servidor e marca registradoNoServidor", async (t) => {
  const chamadas = [];
  const sandbox = carregarOfflineJs({
    rpc: async function(nome, args){
      chamadas.push({ nome, args });
      if (nome === "confirmar_pagamento") return { error: { code: "P0001", message: "Sessão de caixa informada não está aberta" } };
      return { data: "id-conflito", error: null };
    }
  });
  const res = await sandbox.offlineProcessarItem({
    tipo: "pagamento_dinheiro",
    payload: { p_comanda_id: "c1", p_linhas: [{ forma: "DINHEIRO", valor_centavos: 4500 }], p_chave: "k1", p_terminal_id: "Caixa 1", p_ocorrido_em: "2026-10-10T20:00:00Z" }
  });
  assert.equal(res.status, "RECUSADO");
  assert.equal(res.registradoNoServidor, true);
  const reg = chamadas.find((c) => c.nome === "registrar_recebimento_offline_recusado");
  assert.ok(reg, "tem que avisar o servidor da recusa");
  assert.equal(reg.args.p_valor_centavos, 4500);
  assert.equal(reg.args.p_chave, "k1");
  assert.equal(reg.args.p_terminal_id, "Caixa 1");
});

test("pagamento_dinheiro recusado, mas sem rede pra registrar a recusa: continua PENDENTE_REDE (tenta tudo de novo depois)", async (t) => {
  const sandbox = carregarOfflineJs({
    rpc: async function(nome){
      if (nome === "confirmar_pagamento") return { error: { code: "P0001", message: "Sessão de caixa informada não está aberta" } };
      return { error: { message: "Failed to fetch" } }; // sem code = erro de rede
    }
  });
  const res = await sandbox.offlineProcessarItem({
    tipo: "pagamento_dinheiro",
    payload: { p_comanda_id: "c1", p_linhas: [{ forma: "DINHEIRO", valor_centavos: 4500 }], p_chave: "k2" }
  });
  assert.equal(res.status, "PENDENTE_REDE");
});

test("carregarAvisoConciliacaoOffline: soma fila local e conflitos do servidor sem contar duas vezes o que já foi registrado", async (t) => {
  const fila = [
    { id: "1", tipo: "pagamento_dinheiro", payload: { p_linhas: [{ valor_centavos: 1000 }] } },
    { id: "2", tipo: "pagamento_dinheiro", registradoNoServidor: true, payload: { p_linhas: [{ valor_centavos: 2000 }] } },
    { id: "3", tipo: "lancar_item", payload: [{}] },
  ];
  const sandbox = carregarOfflineJs({
    rpc: async function(){ return { data: { pendentes: 1, valor_centavos: 2000 }, error: null }; }
  });
  sandbox.offlineListar = async function(){ return fila; };
  const aviso = await sandbox.carregarAvisoConciliacaoOffline();
  assert.equal(aviso.quantidade, 2, "1 só local + 1 no servidor (o 2 é o mesmo registrado, não conta dobrado)");
  assert.equal(aviso.valorCentavos, 3000);
});

// VF-009 — fila isolada por empresa e usuário: aparelho compartilhado não
// pode mandar o item de um restaurante/funcionário na sessão de outro.
function sandboxComFila(filaFake, estado){
  const enviados = [];
  const removidos = [];
  const salvos = [];
  const sandbox = carregarOfflineJs({
    from: function(){ return { insert: function(p){ enviados.push(p); return { select: async function(){ return { error: null }; } }; } }; }
  });
  Object.assign(sandbox.state, estado);
  sandbox.offlineListar = async function(){ return filaFake; };
  sandbox.offlineRemover = async function(id){ removidos.push(id); };
  sandbox.offlineSalvar = async function(item){ salvos.push(JSON.parse(JSON.stringify(item))); };
  return { sandbox, enviados, removidos, salvos };
}

test("VF-009: só sincroniza item do mesmo restaurante E do mesmo usuário; o resto fica intacto na fila", async (t) => {
  const fila = [
    { id: "meu", tipo: "lancar_item", criadoEm: 1, payload: [{}], ctx: { empresaId: "E1", usuarioId: "U1" } },
    { id: "outro-user", tipo: "lancar_item", criadoEm: 2, payload: [{}], ctx: { empresaId: "E1", usuarioId: "U2" } },
    { id: "outra-empresa", tipo: "lancar_item", criadoEm: 3, payload: [{}], ctx: { empresaId: "E2", usuarioId: "U9" } },
  ];
  const { sandbox, enviados, removidos } = sandboxComFila(fila, { empresaId: "E1", usuarioAtualId: "U1" });
  await sandbox.offlineSincronizar();
  assert.equal(enviados.length, 1, "só 1 item pode sair com a sessão atual");
  assert.deepEqual(removidos, ["meu"], "os de outro usuário/empresa não podem ser removidos nem enviados");
});

test("VF-009: item antigo sem contexto é carimbado com quem está logado (não é perdido nem fica órfão)", async (t) => {
  const fila = [{ id: "antigo", tipo: "lancar_item", criadoEm: 1, payload: [{}] }];
  const { sandbox, enviados, removidos, salvos } = sandboxComFila(fila, { empresaId: "E1", usuarioAtualId: "U1" });
  await sandbox.offlineSincronizar();
  assert.equal(enviados.length, 1);
  assert.deepEqual(removidos, ["antigo"]);
  assert.equal(salvos[0].ctx.empresaId, "E1", "foi carimbado antes de enviar");
});

test("VF-009: lista de pendências mostra item de outro usuário da mesma empresa, mas só CONTA os de outra empresa", async (t) => {
  const fila = [
    { id: "a", tipo: "lancar_item", payload: [{ quantidade: 1, nome: "Suco" }], ctx: { empresaId: "E1", usuarioId: "U2" } },
    { id: "b", tipo: "lancar_item", payload: [{ quantidade: 1, nome: "SEGREDO" }], ctx: { empresaId: "E2", usuarioId: "U9" } },
    { id: "c", tipo: "lancar_item", payload: [{}], ctx: { empresaId: "E1", usuarioId: "U1" } },
  ];
  const { sandbox } = sandboxComFila(fila, { empresaId: "E1", usuarioAtualId: "U1" });
  await sandbox.atualizarPendenciasOfflineRecusadas();
  const ids = sandbox.state.pendenciasOfflineRecusadas.map((p) => p.id);
  assert.equal(JSON.stringify(ids), JSON.stringify(["a"]), "o meu, não recusado, não é pendência; o de outro usuário aparece");
  assert.equal(sandbox.state.pendenciasOfflineRecusadas[0].deOutroUsuario, true);
  assert.equal(sandbox.state.pendenciasOfflineOutraEmpresa, 1);
  assert.ok(!JSON.stringify(sandbox.state.pendenciasOfflineRecusadas).includes("SEGREDO"), "conteúdo de outra empresa nunca vai pra tela");
});

test("VF-009: gerente da mesma empresa assume item de outro usuário; de outra empresa não dá", async (t) => {
  const fila = [
    { id: "a", tipo: "lancar_item", payload: [{}], ctx: { empresaId: "E1", usuarioId: "U2" } },
    { id: "b", tipo: "lancar_item", payload: [{}], ctx: { empresaId: "E2", usuarioId: "U9" } },
  ];
  const { sandbox, salvos } = sandboxComFila(fila, { empresaId: "E1", usuarioAtualId: "U1" });
  sandbox.can = function(){ return true; };
  sandbox.PERM = { SYNC_CONFLITOS: "x" };
  sandbox.navigator.onLine = false; // não dispara sincronização no teste
  await sandbox.offlineAssumirPendencia("b");
  assert.equal(salvos.length, 0, "item de outra empresa não pode ser assumido");
  await sandbox.offlineAssumirPendencia("a");
  const assumido = salvos.find((s) => s.id === "a");
  assert.equal(assumido.ctx.usuarioId, "U1");
  assert.equal(assumido.assumidoDe, "U2", "fica registrado de quem era");
});
