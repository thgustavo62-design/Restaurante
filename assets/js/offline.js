"use strict";

// Fase 3.5 [NOVO] — contingência sem internet, escopo mínimo aprovado:
// lançar item, KDS local, receber em dinheiro. Fila em IndexedDB (não
// localStorage — quantidade/estrutura de pedidos pode crescer e
// localStorage é síncrono, trava a aba em listas grandes).
//
// O que NÃO entra aqui de propósito: fechar em cartão/PIX/fiado offline
// (depende de taxa de maquininha e saldo de pontos que só o banco sabe
// de verdade — fechar olhando só o que o navegador tinha em cache podia
// cobrar errado), e qualquer leitura (a tela sempre mostra o que já
// tinha carregado antes de cair a conexão, nunca inventa dado novo).

var OFFLINE_DB_NAME = "vision_food_offline";
var OFFLINE_STORE = "fila";
var offlineDbPromise = null;

function offlineDb(){
  if(offlineDbPromise) return offlineDbPromise;
  offlineDbPromise = new Promise(function(resolve, reject){
    if(!window.indexedDB){ reject(new Error("IndexedDB indisponível")); return; }
    var req = indexedDB.open(OFFLINE_DB_NAME, 1);
    req.onupgradeneeded = function(){ req.result.createObjectStore(OFFLINE_STORE, {keyPath:"id"}); };
    req.onsuccess = function(){ resolve(req.result); };
    req.onerror = function(){ reject(req.error); };
  });
  return offlineDbPromise;
}
async function offlineEnfileirar(item){
  try{
    var db = await offlineDb();
    return new Promise(function(resolve, reject){
      var tx = db.transaction(OFFLINE_STORE, "readwrite");
      tx.objectStore(OFFLINE_STORE).put(item);
      tx.oncomplete = function(){ resolve(); };
      tx.onerror = function(){ reject(tx.error); };
    });
  }catch(e){ console.error("offlineEnfileirar falhou:", e.message); }
}
async function offlineListar(){
  try{
    var db = await offlineDb();
    return new Promise(function(resolve, reject){
      var tx = db.transaction(OFFLINE_STORE, "readonly");
      var req = tx.objectStore(OFFLINE_STORE).getAll();
      req.onsuccess = function(){ resolve(req.result||[]); };
      req.onerror = function(){ reject(req.error); };
    });
  }catch(e){ return []; }
}
async function offlineRemover(id){
  try{
    var db = await offlineDb();
    return new Promise(function(resolve, reject){
      var tx = db.transaction(OFFLINE_STORE, "readwrite");
      tx.objectStore(OFFLINE_STORE).delete(id);
      tx.oncomplete = function(){ resolve(); };
      tx.onerror = function(){ reject(tx.error); };
    });
  }catch(e){}
}
async function offlineSalvar(item){
  try{
    var db = await offlineDb();
    return new Promise(function(resolve, reject){
      var tx = db.transaction(OFFLINE_STORE, "readwrite");
      tx.objectStore(OFFLINE_STORE).put(item);
      tx.oncomplete = function(){ resolve(); };
      tx.onerror = function(){ reject(tx.error); };
    });
  }catch(e){}
}
// item lançado offline que ainda está na fila (nem tentou sincronizar
// ainda) — muda o status GUARDADO na própria fila, sem RPC nenhuma,
// porque o item nem existe no servidor pra receber um update.
async function offlineAtualizarStatusNaFila(clientUuid, novoStatus){
  var fila = await offlineListar();
  for(var i=0;i<fila.length;i++){
    if(fila[i].tipo!=="lancar_item") continue;
    var achou = false;
    fila[i].payload.forEach(function(p){ if(p.client_uuid===clientUuid){ p.status = novoStatus; achou = true; } });
    if(achou){ await offlineSalvar(fila[i]); return; }
  }
}

// Erro de validação/regra de negócio do Postgres sempre vem com um code
// (ex: "23505", "P0001"); erro de rede do fetch não tem — é a heurística
// usada pra decidir "guarda pra tentar depois" vs "mostra erro de vez".
function erroDeRede(res){
  return !navigator.onLine || !!(res && res.error && !res.error.code);
}

var offlineSincronizando = false;
async function offlineSincronizar(){
  if(offlineSincronizando || !navigator.onLine || !state || !state.usuarioAtualId) return;
  offlineSincronizando = true;
  try{
    var fila = (await offlineListar()).sort(function(a,b){ return a.criadoEm - b.criadoEm; });
    var sincronizados = 0;
    for(var i=0;i<fila.length;i++){
      var ok = await offlineProcessarItem(fila[i]);
      if(ok){ await offlineRemover(fila[i].id); sincronizados++; }
      else break; // mantém a ordem — para no primeiro que ainda não deu pra mandar
    }
    if(sincronizados>0) toast("ok","SINCRONIZADO", sincronizados+" pendência(s) offline enviada(s)");
    // reconectar sempre busca o estado de verdade do servidor, com ou
    // sem fila pendente — mesmo comportamento de antes desta fase.
    await carregarTudo();
  } finally {
    offlineSincronizando = false;
  }
}
async function offlineProcessarItem(item){
  try{
    if(item.tipo==="lancar_item"){
      var res = await sb.from("comanda_itens").insert(item.payload).select();
      if(res.error){
        if(res.error.code==="23505") return true; // client_uuid já existia: sincronizou numa tentativa anterior
        if(erroDeRede(res)) return false;
        toast("err","PEDIDO OFFLINE NÃO FOI ACEITO", res.error.message);
        return true; // erro de regra de negócio não trava o resto da fila; fica avisado
      }
      return true;
    }
    if(item.tipo==="kds_status"){
      var res2 = await sb.from("comanda_itens").update({status:item.status}).eq("id", item.itemId);
      if(res2.error && erroDeRede(res2)) return false;
      return true;
    }
    if(item.tipo==="pagamento_dinheiro"){
      var res3 = await sb.rpc("confirmar_pagamento", item.payload);
      if(res3.error){
        if(erroDeRede(res3)) return false;
        toast("err","PAGAMENTO OFFLINE PRECISA DE ATENÇÃO", item.payload.p_comanda_id+": "+res3.error.message);
        return true;
      }
      // 0.5 — a comanda mudou entre o pagamento offline e agora: o
      // servidor não aplicou nada, só registrou o conflito pra um
      // GERENTE/ADMIN decidir (ver sync_conflitos em Configurações).
      if(res3.data && res3.data.conflito){
        toast("err","PAGAMENTO OFFLINE EM CONFLITO", "A comanda foi alterada por outro terminal — um GERENTE/ADMIN precisa revisar em Configurações.");
      }
      return true;
    }
  }catch(e){ return false; }
  return true;
}
