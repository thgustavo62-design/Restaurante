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
//
// VF-002 do plano de auditoria (docs/PLANO_DE_MELHORIAS.md) —
// [ACHADO CONFIRMADO] offlineProcessarItem() devolvia só true/false:
// "true" significava tanto "enviou de verdade" quanto "o banco recusou,
// mas não trava a fila" — e offlineSincronizar() REMOVIA o item nos dois
// casos. Resultado: um pedido ou pagamento recusado pelo servidor
// desaparecia pra sempre depois de um toast que passa em alguns
// segundos, sem nenhum jeito de revisar depois. offlineEnfileirar()
// também engolia falha de gravação no IndexedDB só com console.error,
// enquanto o caller mostrava "guardado" mesmo sem ter guardado nada.

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
// VF-002 — devolve true/false de verdade (nunca lança) em vez de engolir
// a falha só no console; quem chama precisa saber se "guardou" é mentira
// antes de dizer isso pro usuário.
// VF-009 — a base IndexedDB é uma só por origem do navegador, então a fila
// de um aparelho compartilhado misturava restaurantes e funcionários. Todo
// item agora nasce com o CONTEXTO de quem o criou (empresa, usuário,
// terminal); só esse contexto sincroniza sozinho.
function offlineContextoAtual(){
  return {empresaId: state.empresaId||null, usuarioId: state.usuarioAtualId||null, terminal: state.caixaTerminalNome||null};
}
// "meu" | "outro_usuario" (mesma empresa) | "outra_empresa". Item gravado
// antes desta versão não tem contexto: é carimbado com o contexto de quem
// está logado agora (aparelho compartilhado + fila antiga é o cenário raro;
// descartar o item seria pior que atribuí-lo a quem está aqui).
function offlineDonoDoItem(item){
  if(!item.ctx){ item.ctx = offlineContextoAtual(); item._carimbadoAgora = true; return "meu"; }
  if(item.ctx.empresaId !== offlineContextoAtual().empresaId) return "outra_empresa";
  if(item.ctx.usuarioId !== offlineContextoAtual().usuarioId) return "outro_usuario";
  return "meu";
}
async function offlineEnfileirar(item){
  try{
    item.v = 2;
    if(!item.ctx) item.ctx = offlineContextoAtual();
    var db = await offlineDb();
    return await new Promise(function(resolve){
      var tx = db.transaction(OFFLINE_STORE, "readwrite");
      tx.objectStore(OFFLINE_STORE).put(item);
      tx.oncomplete = function(){ resolve(true); };
      tx.onerror = function(){ console.error("offlineEnfileirar falhou:", tx.error && tx.error.message); resolve(false); };
    });
  }catch(e){ console.error("offlineEnfileirar falhou:", e.message); return false; }
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
// VF-002 — três desfechos possíveis por item, não dois: ENVIADO (some da
// fila de verdade), PENDENTE_REDE (continua tentando, sem tocar no resto
// da fila pra manter a ordem) e RECUSADO (o banco disse não — fica
// guardado como pendência de revisão humana, nunca mais tenta sozinho,
// só quando alguém decidir "tentar de novo" ou "descartar" na tela de
// Pendências de sincronização).
async function offlineSincronizar(){
  if(offlineSincronizando || !navigator.onLine || !state || !state.usuarioAtualId) return;
  offlineSincronizando = true;
  try{
    var fila = (await offlineListar()).sort(function(a,b){ return a.criadoEm - b.criadoEm; });
    var sincronizados = 0;
    var recusados = 0;
    for(var i=0;i<fila.length;i++){
      if(fila[i].recusado) continue; // já é pendência de revisão — não tenta sozinho de novo
      // VF-009 — só sincroniza o que é DESTE restaurante E deste usuário.
      // O resto fica guardado intacto, esperando o dono voltar (ou um
      // gerente da mesma empresa assumir de forma explícita).
      var dono = offlineDonoDoItem(fila[i]);
      if(fila[i]._carimbadoAgora){ delete fila[i]._carimbadoAgora; await offlineSalvar(fila[i]); }
      if(dono!=="meu") continue;
      var resultado = await offlineProcessarItem(fila[i]);
      if(resultado.status==="ENVIADO"){
        await offlineRemover(fila[i].id);
        sincronizados++;
      } else if(resultado.status==="RECUSADO"){
        fila[i].recusado = true;
        fila[i].erroRecusa = resultado.erro;
        fila[i].registradoNoServidor = !!resultado.registradoNoServidor;
        fila[i].recusadoEm = Date.now();
        await offlineSalvar(fila[i]);
        recusados++;
        // não dá break — um item recusado (ex: comanda já cancelada) não
        // deveria travar outros pendentes válidos atrás dele na fila.
      } else {
        break; // PENDENTE_REDE — mantém a ordem, para no primeiro que ainda não deu pra mandar
      }
    }
    if(sincronizados>0) toast("ok","SINCRONIZADO", sincronizados+" pendência(s) offline enviada(s)");
    if(recusados>0) toast("err","PENDÊNCIAS PRA REVISAR", recusados+" item(ns) recusado(s) pelo servidor — veja em Configurações > Pendências de sincronização");
    if(typeof atualizarPendenciasOfflineRecusadas==="function") atualizarPendenciasOfflineRecusadas();
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
        if(res.error.code==="23505") return {status:"ENVIADO"}; // client_uuid já existia: sincronizou numa tentativa anterior
        if(erroDeRede(res)) return {status:"PENDENTE_REDE"};
        return {status:"RECUSADO", erro:res.error.message};
      }
      return {status:"ENVIADO"};
    }
    if(item.tipo==="kds_status"){
      var res2 = await sb.from("comanda_itens").update({status:item.status}).eq("id", item.itemId);
      if(res2.error){
        if(erroDeRede(res2)) return {status:"PENDENTE_REDE"};
        return {status:"RECUSADO", erro:res2.error.message};
      }
      return {status:"ENVIADO"};
    }
    if(item.tipo==="pagamento_dinheiro"){
      var res3 = await sb.rpc("confirmar_pagamento", item.payload);
      if(res3.error){
        if(erroDeRede(res3)) return {status:"PENDENTE_REDE"};
        // VF-010 — o dinheiro JÁ foi recebido fisicamente: avisa o servidor
        // da recusa (vira um conflito PENDENTE visível ao gerente e no aviso
        // do fechamento de caixa), em vez de depender só desta pendência
        // local, que um "Descartar" apaga sem rastro. Se nem isso der por
        // falta de rede, trata como pendente de rede e tenta o ciclo todo
        // de novo na próxima sincronização.
        var linhasPag = item.payload.p_linhas||[];
        var valorPag = linhasPag.reduce(function(s,l){ return s+(l.valor_centavos||0); },0);
        if(item.payload.p_chave && valorPag>0){
          var regRes = await sb.rpc("registrar_recebimento_offline_recusado", {
            p_chave: item.payload.p_chave, p_comanda_id: item.payload.p_comanda_id,
            p_valor_centavos: valorPag, p_motivo: res3.error.message,
            p_ocorrido_em: item.payload.p_ocorrido_em||null, p_terminal_id: item.payload.p_terminal_id||null
          });
          if(regRes.error && erroDeRede(regRes)) return {status:"PENDENTE_REDE"};
          if(!regRes.error) return {status:"RECUSADO", erro:res3.error.message, registradoNoServidor:true};
        }
        return {status:"RECUSADO", erro:res3.error.message};
      }
      // 0.5 — a comanda mudou entre o pagamento offline e agora: o
      // servidor não aplicou nada, só registrou o conflito pra um
      // GERENTE/ADMIN decidir — isso já tem fluxo de resolução próprio
      // (sync_conflitos em Configurações), não precisa virar pendência
      // offline também.
      if(res3.data && res3.data.conflito){
        toast("err","PAGAMENTO OFFLINE EM CONFLITO", "A comanda foi alterada por outro terminal — um GERENTE/ADMIN precisa revisar em Configurações.");
      }
      return {status:"ENVIADO"};
    }
  }catch(e){ return {status:"PENDENTE_REDE"}; }
  return {status:"ENVIADO"};
}

// VF-010 — dinheiro recebido offline que ainda não virou venda de verdade:
// o que está na fila deste aparelho (aguardando rede ou recusado) mais o
// que o servidor já tem como conflito pendente. Alimenta o AVISO do
// fechamento de caixa (só avisa, nunca bloqueia — decisão do Gustavo).
async function carregarAvisoConciliacaoOffline(){
  var fila = await offlineListar();
  // VF-009 — dinheiro de outro usuário da MESMA empresa neste aparelho
  // conta (a gaveta é uma só); de outra empresa nunca entra.
  var empresaAtual = offlineContextoAtual().empresaId;
  var local = fila.filter(function(it){
    return it.tipo==="pagamento_dinheiro" && (!it.ctx || it.ctx.empresaId===empresaAtual);
  });
  var localValor = local.reduce(function(s,it){
    return s + ((it.payload.p_linhas||[]).reduce(function(t,l){ return t+(l.valor_centavos||0); },0));
  },0);
  var servidor = {pendentes:0, valor_centavos:0};
  try{
    var r = await sb.rpc("contar_conciliacao_offline");
    if(!r.error && r.data) servidor = r.data;
  }catch(e){}
  // item recusado e já registrado no servidor aparece nos dois lugares —
  // conta só uma vez (no servidor).
  var soLocal = local.filter(function(it){ return !it.registradoNoServidor; });
  var soLocalValor = soLocal.reduce(function(s,it){
    return s + ((it.payload.p_linhas||[]).reduce(function(t,l){ return t+(l.valor_centavos||0); },0));
  },0);
  return {
    quantidade: soLocal.length + (servidor.pendentes||0),
    valorCentavos: soLocalValor + (servidor.valor_centavos||0),
    local: local.length, localValorCentavos: localValor, servidor: servidor.pendentes||0
  };
}

// VF-002 — área de Pendências de sincronização (Configurações): lista o
// que o servidor recusou de verdade, pra revisão humana. Carregada no
// boot (main.js) e depois de toda tentativa de sincronização.
async function atualizarPendenciasOfflineRecusadas(){
  var fila = await offlineListar();
  var minhas = [];
  var outraEmpresa = 0;
  fila.forEach(function(it){
    var dono = it.ctx ? offlineDonoDoItem(it) : "meu";
    if(dono==="outra_empresa"){ outraEmpresa++; return; } // nunca mostra o conteúdo de outro restaurante
    if(dono==="outro_usuario"){ minhas.push(Object.assign({}, it, {deOutroUsuario:true})); return; }
    if(it.recusado) minhas.push(it);
  });
  state.pendenciasOfflineRecusadas = minhas;
  state.pendenciasOfflineOutraEmpresa = outraEmpresa;
  render();
}
// VF-009 — um GERENTE/ADMIN da mesma empresa assume explicitamente um item
// que ficou parado por ser de outro usuário (ex: funcionário saiu sem
// internet voltar). Daí em diante é dele e entra na sincronização normal.
// Item de OUTRA empresa nunca chega aqui (nem aparece na lista).
async function offlineAssumirPendencia(id){
  if(!can(PERM.SYNC_CONFLITOS)) return;
  var fila = await offlineListar();
  var item = fila.find(function(it){ return it.id===id; });
  if(!item || !item.ctx || item.ctx.empresaId!==offlineContextoAtual().empresaId) return;
  item.assumidoDe = item.ctx.usuarioId;
  item.assumidoEm = Date.now();
  item.ctx = offlineContextoAtual();
  await offlineSalvar(item);
  await atualizarPendenciasOfflineRecusadas();
  toast("ok","PENDÊNCIA ASSUMIDA", "Entra na fila de sincronização com a sua sessão.");
  if(navigator.onLine) offlineSincronizar();
}
async function offlineDescartarPendencia(id){
  await offlineRemover(id);
  await atualizarPendenciasOfflineRecusadas();
  toast("ok","PENDÊNCIA DESCARTADA", "");
}
async function offlineTentarPendenciaDeNovo(id){
  var fila = await offlineListar();
  var item = fila.find(function(it){ return it.id===id; });
  if(!item) return;
  delete item.recusado; delete item.erroRecusa; delete item.recusadoEm;
  await offlineSalvar(item);
  await atualizarPendenciasOfflineRecusadas();
  toast("ok","VAI TENTAR DE NOVO", "Entra na fila de sincronização normal.");
  if(navigator.onLine) offlineSincronizar();
}
