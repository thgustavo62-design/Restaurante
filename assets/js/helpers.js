"use strict";

function uid(prefix){
  return (prefix||"id") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,9);
}
function brl(centavos){
  return (centavos/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];
  });
}
function minutosDesde(iso){
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime())/60000));
}
function fmtMin(min){
  if(min>=60){ var h=Math.floor(min/60), m=min%60; return (h<10?"0"+h:h)+"H"+(m<10?"0"+m:m); }
  return min+" MIN";
}
function splitCentavos(total, partes){
  partes = Math.max(1, partes|0);
  var base = Math.floor(total/partes);
  var resto = total - base*partes;
  var out = [];
  for(var i=0;i<partes;i++) out.push(base + (i<resto?1:0));
  return out;
}

var state = null;

function diasA(n){
  var d = new Date(Date.now()+n*86400000);
  return d.toISOString().slice(0,10);
}

function emailInterno(nome){
  return nome.trim().toLowerCase().replace(/[^a-z0-9]/g,"") + "@fogo.internal";
}
