"use strict";

function renderLogin(){
  if(!state.loginSelectedUserId){
    return '<div class="login-wrap"><div class="login-card">'+
      '<img class="login-logo" src="assets/logo/rancho-netto-white.png" alt="Rancho Netto — Brasa &amp; Fogo">'+
      '<p>Selecione seu usuário para entrar</p>'+
      '<div class="user-grid">'+
        (state.usuariosLogin.length ? state.usuariosLogin.map(function(u){
          return '<div class="user-card" data-action="login-select" data-uid="'+u.id+'">'+
            '<div class="nome">'+escapeHtml(u.nome)+'</div>'+
          '</div>';
        }).join("") : '<div class="empty-hint">Conectando ao Supabase...</div>')+
      '</div>'+
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

