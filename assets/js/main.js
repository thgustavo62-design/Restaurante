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

render();
if(state.restauranteSlug) carregarUsuariosLogin();
iniciarRelogioTopbar();
