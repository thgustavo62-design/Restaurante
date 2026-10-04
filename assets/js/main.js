"use strict";

state = estadoVazio();

// Fase 0.4 — resolve o restaurante antes de listar usuários: ?r=slug na
// URL manda (e já salva), senão usa o que tiver em localStorage.
(function resolverRestauranteSlug(){
  var porUrl = new URLSearchParams(window.location.search).get("r");
  if(porUrl){
    state.restauranteSlug = porUrl.trim().toLowerCase();
    try{ localStorage.setItem("restauranteSlug", state.restauranteSlug); }catch(e){}
    return;
  }
  try{
    var salvo = localStorage.getItem("restauranteSlug");
    if(salvo) state.restauranteSlug = salvo;
  }catch(e){}
})();

// Fase 1.6 — nome do terminal fica salvo neste dispositivo (não no
// usuário nem na empresa): é o PDV físico que é "Terminal 1"/"Caixa Bar",
// não quem está logado nele.
(function resolverTerminal(){
  try{
    var salvo = localStorage.getItem("caixaTerminalNome");
    if(salvo) state.caixaTerminalNome = salvo;
  }catch(e){}
})();

render();
if(state.restauranteSlug) carregarUsuariosLogin();
iniciarRelogioTopbar();

// Fase 3.5 — service worker só cuida do "app shell" (app abrir offline);
// dado sempre vem do Supabase ou da fila local, nunca de cache de API.
if("serviceWorker" in navigator){
  window.addEventListener("load", function(){
    navigator.serviceWorker.register("/sw.js").catch(function(e){ console.error("Service worker falhou:", e.message); });
  });
}
