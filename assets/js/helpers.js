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
  var m = String(d.getMonth()+1).padStart(2,"0");
  var day = String(d.getDate()).padStart(2,"0");
  return d.getFullYear()+"-"+m+"-"+day;
}

// Fase 0.4 — o e-mail de login deixou de ser derivado do nome
// (acento sumia, nome duplicado colidia, renomear quebrava o login).
// Vem pronto do servidor via usuarios_login_por_empresa (data.js).

// dia operacional: um bar que abre à noite e vira a madrugada não deve
// "trocar de dia" à meia-noite — vendas até a hora de virada configurada
// ainda contam como o dia anterior.
function diaOperacionalDe(dataOrIso){
  var d = new Date(dataOrIso);
  d.setHours(d.getHours() - VIRADA_DIA_OPERACIONAL_HORA);
  var m = String(d.getMonth()+1).padStart(2,"0");
  var day = String(d.getDate()).padStart(2,"0");
  return d.getFullYear()+"-"+m+"-"+day;
}
function hojeOperacionalStr(){
  return diaOperacionalDe(new Date());
}

// Freio de força-bruta em PIN (login e overrides de supervisor): compartilhado
// pelas três telas que pedem PIN, porque todas atacam a mesma conta do
// Supabase Auth. Só ajuda contra alguém tentando pela UI do app — não
// impede uma chamada direta ao endpoint de Auth do Supabase (isso exige
// rate limit/CAPTCHA configurado no painel do Supabase, fora do alcance do
// código do app).
function pinLockoutAtivo(){
  return !!(state.loginBloqueadoAte && Date.now() < state.loginBloqueadoAte);
}
function pinLockoutSegundosRestantes(){
  return Math.max(0, Math.ceil((state.loginBloqueadoAte-Date.now())/1000));
}
function registrarFalhaPin(){
  state.loginTentativas = (state.loginTentativas||0) + 1;
  if(state.loginTentativas >= 5){
    state.loginBloqueadoAte = Date.now() + 30000;
    state.loginTentativas = 0;
    return true;
  }
  return false;
}
function limparFalhasPin(){
  state.loginTentativas = 0;
  state.loginBloqueadoAte = null;
}

// comanda pode ser de mesa, balcão ou ficha numerada (venda por balcão/ficha) —
// centraliza o rótulo pra não espalhar "mesa?mesa.numero:..." em cada tela.
function rotuloComanda(comanda, mesa){
  if(comanda.tipo==="BALCAO") return "Balcão";
  if(comanda.tipo==="FICHA") return "Ficha "+comanda.fichaNumero;
  return "Mesa "+(mesa?mesa.numero:"?");
}
