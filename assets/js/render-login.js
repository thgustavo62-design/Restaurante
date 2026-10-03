"use strict";

function renderLogin(){
  if(!state.restauranteSlug){
    return '<div class="login-wrap"><div class="login-card">'+
      '<img class="login-logo" src="assets/logo/vision-food.png" alt="Vision Food">'+
      '<p>Digite o código do restaurante pra continuar</p>'+
      '<div class="field" style="text-align:left;"><input id="restauranteSlugInput" placeholder="ex: rancho-netto" value="'+escapeHtml(state.restauranteSlugInput||"")+'" data-action="restaurante-slug-input"></div>'+
      (state.restauranteSlugErro ? '<div class="pin-error">'+escapeHtml(state.restauranteSlugErro)+'</div>' : '')+
      '<button class="btn btn-primary btn-block" data-action="restaurante-slug-confirmar">Entrar</button>'+
    '</div></div>';
  }
  if(!state.loginSelectedUserId){
    return '<div class="login-wrap"><div class="login-card">'+
      '<img class="login-logo" src="assets/logo/vision-food.png" alt="Vision Food">'+
      '<p>Selecione seu usuário para entrar</p>'+
      '<div class="user-grid">'+
        (state.usuariosLogin.length ? state.usuariosLogin.map(function(u){
          return '<div class="user-card" data-action="login-select" data-uid="'+u.id+'">'+
            '<div class="nome">'+escapeHtml(u.nome)+'</div>'+
          '</div>';
        }).join("") : (state.restauranteSlugErro ? '<div class="pin-error">'+escapeHtml(state.restauranteSlugErro)+'</div>' : '<div class="empty-hint">Conectando...</div>'))+
      '</div>'+
      '<div style="margin-top:16px;"><button class="btn btn-ghost btn-sm" data-action="restaurante-trocar">Trocar restaurante</button></div>'+
    '</div></div>';
  }
  var u = state.usuariosLogin.find(function(x){ return x.id===state.loginSelectedUserId; });
  var dots = "";
  for(var i=0;i<PIN_LEN;i++) dots += '<div class="pin-dot '+(i<state.pinBuffer.length?"filled":"")+'"></div>';
  var keys = ["1","2","3","4","5","6","7","8","9","","0","back"];
  return '<div class="login-wrap"><div class="login-card">'+
    '<h1>'+escapeHtml(u.nome).toUpperCase()+'</h1><p>Digite seu PIN</p>'+
    '<div class="pin-dots">'+dots+'</div>'+
    '<div class="pin-error">'+escapeHtml(state.pinError||"")+'</div>'+
    '<div class="pinpad">'+
      keys.map(function(k){
        if(k==="") return '<span></span>';
        if(k==="back") return '<button data-action="login-pin-back">'+icon("arrowLeft",18)+'</button>';
        return '<button data-action="login-pin-digit" data-d="'+k+'">'+k+'</button>';
      }).join("")+
    '</div>'+
    '<div style="margin-top:18px;"><button class="btn btn-ghost" data-action="login-cancel">Voltar</button></div>'+
  '</div></div>';
}

