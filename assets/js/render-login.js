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
  return '<div class="login-wrap"><div class="login-card">'+
    '<img class="login-logo" src="assets/logo/vision-food.png" alt="Vision Food">'+
    '<p>Entrar</p>'+
    '<div class="field" style="text-align:left;"><input id="loginUsuarioInput" placeholder="Usuário" autocapitalize="off" value="'+escapeHtml(state.loginUsuarioInput||"")+'" data-action="login-usuario-input"></div>'+
    '<div class="field" style="text-align:left;"><input id="loginSenhaInput" type="password" placeholder="Senha" value="'+escapeHtml(state.loginSenhaInput||"")+'" data-action="login-senha-input"></div>'+
    (state.loginErro ? '<div class="pin-error">'+escapeHtml(state.loginErro)+'</div>' : '')+
    '<button class="btn btn-primary btn-block" data-action="login-confirmar" '+(state.loginVerificando?"disabled":"")+'>'+(state.loginVerificando?"Entrando...":"Entrar")+'</button>'+
    '<div style="margin-top:16px;"><button class="btn btn-ghost btn-sm" data-action="restaurante-trocar">Trocar restaurante</button></div>'+
  '</div></div>';
}

