"use strict";

// ---------- dashboard helpers ----------
function hojeStr(){ return new Date().toDateString(); }
function comandasPagasHoje(){
  return state.comandas.filter(function(c){
    return c.status==="PAGA" && c.fechamento && new Date(c.fechamento).toDateString()===hojeStr();
  });
}
function itensKdsAtivos(){
  var out = {PENDENTE:0, PREPARANDO:0, PRONTO:0};
  state.comandas.filter(function(c){ return c.status!=="PAGA"; }).forEach(function(c){
    c.itens.forEach(function(it){ if(out[it.status]!==undefined) out[it.status]++; });
  });
  return out;
}

