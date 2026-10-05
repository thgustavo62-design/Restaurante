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
// Fase 1.4 — bipe de pedido novo no KDS. Web Audio puro (sem arquivo de
// áudio); autoplay do navegador exige um clique antes de tocar qualquer
// som, por isso o primeiro toque acontece no próprio botão "Ativar som"
// (events.js, kds-som-toggle).
function tocarBipKds(){
  try{
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if(!Ctx) return;
    if(!window.__kdsAudioCtx) window.__kdsAudioCtx = new Ctx();
    var ctx = window.__kdsAudioCtx;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = "sine"; o.frequency.value = 880;
    g.gain.value = 0.001;
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime+0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.35);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime+0.36);
  }catch(e){}
}
// Fase 2.9 — exportação pro contador: monta e baixa um CSV simples
// (sem lib externa — são poucas colunas, não vale a pena trazer uma
// dependência só pra isso).
function baixarCsv(nomeArquivo, colunas, linhas){
  var esc = function(v){
    v = v==null ? "" : String(v);
    return /[",;\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
  };
  var conteudo = colunas.join(";")+"\n"+linhas.map(function(l){ return l.map(esc).join(";"); }).join("\n");
  var blob = new Blob(["﻿"+conteudo], {type:"text/csv;charset=utf-8;"});
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = nomeArquivo;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
// ETAPA pós-10 — Configurações virou sub-abas: só os campos da aba aberta
// existem no DOM no momento do clique em "Salvar". Pra um campo de outra
// aba não virar undefined/apagado, lê do elemento quando ele existe, e
// cai pro valor que já estava salvo quando não existe.
function campoOuAtual(id, valorAtual){
  var el = document.getElementById(id);
  return el ? el.value : valorAtual;
}
function rotuloComanda(comanda, mesa){
  if(comanda.tipo==="BALCAO") return "Balcão";
  if(comanda.tipo==="FICHA") return "Ficha "+comanda.fichaNumero;
  return "Mesa "+(mesa?mesa.numero:"?");
}

// PRIORIDADE 10 — notificação só com o app aberto (mesmo neste dispositivo,
// mesmo em segundo plano) — opt-in explícito (botão no topbar), nunca pede
// permissão sozinho. Via registro do service worker (showNotification)
// quando existe — mais confiável em segundo plano/PWA instalado do que
// `new Notification()` direto, que alguns navegadores recusam fora de um
// gesto do usuário.
function notificarSeAtivo(titulo, corpo, tag){
  if(!state.notificacoesAtivas) return;
  if(typeof Notification==="undefined" || Notification.permission!=="granted") return;
  try{
    if(navigator.serviceWorker && navigator.serviceWorker.ready){
      navigator.serviceWorker.ready.then(function(reg){
        reg.showNotification(titulo, {body:corpo, tag:tag, icon:"assets/logo/vision-food-icon.png"});
      }).catch(function(){
        try{ new Notification(titulo, {body:corpo, tag:tag, icon:"assets/logo/vision-food-icon.png"}); }catch(e){}
      });
    } else {
      new Notification(titulo, {body:corpo, tag:tag, icon:"assets/logo/vision-food-icon.png"});
    }
  }catch(e){}
}
