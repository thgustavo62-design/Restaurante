"use strict";

// ---------- dashboard helpers ----------
function comandasPagasHoje(){
  return state.vendasHoje;
}
function itensKdsAtivos(){
  var out = {PENDENTE:0, PREPARANDO:0, PRONTO:0};
  state.comandas.filter(function(c){ return c.status==="ABERTA" || c.status==="FECHANDO"; }).forEach(function(c){
    c.itens.forEach(function(it){ if(out[it.status]!==undefined) out[it.status]++; });
  });
  return out;
}

