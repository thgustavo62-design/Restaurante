"use strict";

// 0.10 — registro de erros do front-end: tela + mensagem + stack resumida,
// nunca PIN/token/dado de pagamento (só o que window.onerror/
// unhandledrejection/falha de RPC já expõem, que são só mensagens de
// erro). "Silencioso": nunca lança, nunca mostra toast — logar o log
// falhando não pode virar mais um erro pro usuário ver. Rate limit de
// verdade é no servidor (registrar_erro_cliente, 20/min); isto aqui só
// evita nem tentar mandar se já sabemos que vai estourar.
var APP_VERSION = "2026-10-04";
var errosClienteEnviados = 0;
var errosClienteJanelaInicio = Date.now();
function registrarErroClienteSilencioso(tela, mensagem, stack){
  try{
    if(!state || !state.usuarioAtualId || typeof sb==="undefined") return;
    var agora = Date.now();
    if(agora - errosClienteJanelaInicio > 60000){ errosClienteJanelaInicio = agora; errosClienteEnviados = 0; }
    if(errosClienteEnviados >= 20) return;
    errosClienteEnviados++;
    sb.rpc("registrar_erro_cliente", {
      p_tela: tela||state.view||"", p_mensagem: String(mensagem||"").slice(0,2000),
      p_stack_resumido: String(stack||"").slice(0,2000), p_versao: APP_VERSION
    });
  }catch(e){ /* nunca deixa o log de erro virar outro erro */ }
}
window.onerror = function(msg, source, lineno, colno, error){
  registrarErroClienteSilencioso(state&&state.view, msg, error&&error.stack);
};
window.addEventListener("unhandledrejection", function(e){
  var reason = e && e.reason;
  registrarErroClienteSilencioso(state&&state.view, reason&&reason.message||String(reason), reason&&reason.stack);
});

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

// PRIORIDADE 1 — Central do Dono "atualizada a cada 60s": só refaz a RPC
// enquanto a tela estiver mesmo aberta (o Realtime em vendas, em data.js,
// cobre o resto do tempo).
setInterval(function(){
  if(state.view==="central" && state.usuarioAtualId) carregarCentralDono();
}, 60000);

// Fase 3.5 — service worker só cuida do "app shell" (app abrir offline);
// dado sempre vem do Supabase ou da fila local, nunca de cache de API.
if("serviceWorker" in navigator){
  window.addEventListener("load", function(){
    navigator.serviceWorker.register("/sw.js").catch(function(e){ console.error("Service worker falhou:", e.message); });
  });
}

// PRIORIDADE 10 — notificação do navegador só com o app aberto (reaproveita
// o Realtime que o app já usa em tudo, nunca um push de verdade — isso
// exigiria uma Edge Function e infra nova, fora do escopo aprovado agora).
// Preferência é por dispositivo (localStorage), não por usuário — é o
// aparelho na mesa/balcão que fica de olho, não a conta de quem logou nele,
// mesmo padrão de caixaTerminalNome (Fase 1.6).
(function resolverNotificacoes(){
  try{
    var salvo = localStorage.getItem("notificacoesAtivas")==="1";
    state.notificacoesAtivas = salvo && typeof Notification!=="undefined" && Notification.permission==="granted";
  }catch(e){}
})();
function alternarNotificacoes(){
  if(state.notificacoesAtivas){
    state.notificacoesAtivas = false;
    try{ localStorage.setItem("notificacoesAtivas","0"); }catch(e){}
    render();
    return;
  }
  if(typeof Notification==="undefined"){ toast("err","NÃO DISPONÍVEL","Este navegador não suporta notificações."); return; }
  if(Notification.permission==="denied"){
    toast("err","BLOQUEADO","Notificações foram bloqueadas pra este site nas configurações do navegador.");
    return;
  }
  Notification.requestPermission().then(function(permissao){
    if(permissao==="granted"){
      state.notificacoesAtivas = true;
      try{ localStorage.setItem("notificacoesAtivas","1"); }catch(e){}
      notificarSeAtivo("Notificações ativadas", "Você vai ser avisado aqui neste aparelho sobre pedido pelo QR aguardando aprovação e pagamento offline pra revisar.", "notificacoes-teste");
    } else {
      toast("err","NÃO AUTORIZADO","Permissão de notificação não foi concedida.");
    }
    render();
  });
}
