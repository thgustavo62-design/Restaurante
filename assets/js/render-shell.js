"use strict";

// ---------- render ----------

var app = document.getElementById("app");
var NAV_ITEMS = [
  {view:"dashboard", label:"Dashboard", icon:"grid", perm:PERM.SALAO_VER, built:true},
  {view:"salao", label:"Atendimento", icon:"utensils", perm:PERM.SALAO_VER, built:true},
  {view:"caixa", label:"Caixa", icon:"wallet", perm:PERM.CAIXA_ABRIR, built:true},
  {view:"kds", label:"Cozinha", icon:"chef", perm:PERM.KDS_VER, built:true},
  {view:"cardapio", label:"Cardápio", icon:"book", perm:PERM.CARDAPIO, built:true},
  {view:"estoque", label:"Estoque", icon:"package", perm:PERM.ESTOQUE, built:true},
  {view:"financeiro", label:"Financeiro", icon:"landmark", perm:PERM.FINANCEIRO, built:true},
  {view:"relatorios", label:"Relatórios", icon:"chart", perm:PERM.RELATORIOS, built:true},
  {view:"equipe", label:"Equipe", icon:"users", perm:PERM.EQUIPE, built:true},
  {view:"auditoria", label:"Auditoria", icon:"alert", perm:PERM.AUDITORIA_VER, built:true},
  {view:"configuracoes", label:"Configurações", icon:"settings", perm:PERM.CONFIGURACOES, built:true}
];
var PAGE_TITLES = {dashboard:"Dashboard", salao:"Atendimento", comanda:"Atendimento", kds:"Cozinha (KDS)", caixa:"Caixa", auditoria:"Auditoria",
  cardapio:"Cardápio", estoque:"Estoque", financeiro:"Financeiro", relatorios:"Relatórios", equipe:"Equipe", configuracoes:"Configurações"};

function render(){
  var active = document.activeElement;
  var activeId = (active && active.id) ? active.id : null;
  var selStart = (active && typeof active.selectionStart === "number") ? active.selectionStart : null;
  var selEnd = (active && typeof active.selectionEnd === "number") ? active.selectionEnd : null;

  if(!state.usuarioAtualId){
    app.innerHTML = renderLogin();
    bindEvents();
    return;
  }
  if(state.carregando || !usuarioAtual()){
    app.innerHTML = '<div class="login-wrap"><div class="login-card">'+
      '<img class="login-logo" src="assets/logo/rancho-netto-white.png" alt="Rancho Netto">'+
      '<h1>CARREGANDO</h1><p>Sincronizando com o Supabase...</p></div></div>';
    return;
  }
  var html = '<div class="shell">'+
      renderSidebar()+
      '<div class="main-col">'+
        renderTopbar()+
        '<div class="content">'+renderView()+'</div>'+
        renderBottomNav()+
      '</div>'+
    '</div>'+
    renderToasts()+
    '<div class="print-only">'+(state.printHtml||"")+'</div>';
  if(state.modal) html += renderModal();
  app.innerHTML = html;
  bindEvents();

  if(activeId){
    var el = document.getElementById(activeId);
    if(el){
      el.focus();
      if(selStart!==null && el.setSelectionRange){
        try{ el.setSelectionRange(selStart, selEnd); }catch(e){}
      }
    }
  }
}

function renderSidebar(){
  var items = NAV_ITEMS.filter(function(n){ return can(n.perm); });
  return '<div class="sidebar '+(state.sidebarCollapsed?"collapsed":"")+'">'+
    '<div class="sidebar-brand">'+
      '<img class="sidebar-logo" src="assets/logo/rancho-netto-white.png" alt="Rancho Netto">'+
      '<div class="brand-text"><div class="name">RANCHO NETTO</div><div class="sub">BRASA &amp; FOGO</div></div>'+
    '</div>'+
    '<div class="nav-scroll">'+
      items.map(function(n){
        var active = state.view===n.view || (n.view==="salao" && state.view==="comanda");
        return '<div class="nav-item '+(active?"active":"")+' '+(n.built?"":"disabled")+'" '+(n.built?'data-action="nav-goto" data-view="'+n.view+'"':'')+'>'+
          icon(n.icon,18)+'<span class="nav-label">'+n.label+'</span>'+
          (n.built?'':'<span class="nav-badge">EM BREVE</span>')+
        '</div>';
      }).join("")+
    '</div>'+
    '<div class="sidebar-foot">'+
      '<div class="nav-item" data-action="logout">'+icon("door",18)+'<span class="nav-label">Sair</span></div>'+
    '</div>'+
  '</div>';
}

function renderTopbar(){
  var u = usuarioAtual();
  var title = PAGE_TITLES[state.view] || "";
  var aberto = estaAberto();
  return '<div class="topbar">'+
    '<button class="icon-btn" data-action="toggle-sidebar">'+icon("menu",18)+'</button>'+
    '<div class="topbar-title">'+title+'</div>'+
    '<div class="topbar-spacer"></div>'+
    '<div class="status-pill">'+
      '<span class="status-dot" style="background:'+(aberto?"var(--success)":"var(--danger)")+';"></span>'+
      (aberto?"ABERTO":"FECHADO")+
      ' <span style="color:var(--text-muted);">· '+state.config.horarioAbertura+'–'+state.config.horarioFechamento+'</span>'+
    '</div>'+
    '<div class="status-pill"><span class="status-dot" style="background:'+(navigator.onLine?"var(--success)":"var(--danger)")+';"></span>'+(navigator.onLine?"SUPABASE":"SEM CONEXÃO")+' <span style="color:var(--text-muted);">· '+(navigator.onLine?"sincronizado em tempo real":"reconectando...")+'</span></div>'+
    '<div class="user-chip">'+
      '<div class="avatar">'+escapeHtml(u.nome.charAt(0))+'</div>'+
      '<div class="meta"><div class="nome">'+escapeHtml(u.nome)+'</div><div class="papel">'+u.papel+'</div></div>'+
    '</div>'+
    '<button class="icon-btn" data-action="logout" title="Sair" style="margin-left:4px;">'+icon("door",16)+'</button>'+
  '</div>';
}

function renderBottomNav(){
  var items = [
    {view:"salao", label:"Salão", icon:"utensils", perm:PERM.SALAO_VER},
    {view:"kds", label:"Cozinha", icon:"chef", perm:PERM.KDS_VER},
    {view:"caixa", label:"Caixa", icon:"wallet", perm:PERM.CAIXA_ABRIR},
    {view:"dashboard", label:"Mais", icon:"more", perm:PERM.SALAO_VER}
  ].filter(function(n){ return can(n.perm); });
  return '<div class="bottom-nav">'+items.map(function(n){
    var active = state.view===n.view || (n.view==="salao" && state.view==="comanda");
    return '<div class="bn-item '+(active?"active":"")+'" data-action="nav-goto" data-view="'+n.view+'">'+icon(n.icon,20)+'<span>'+n.label+'</span></div>';
  }).join("")+'</div>';
}

function renderToasts(){
  if(!state.toasts.length) return "";
  return '<div class="toast-wrap">'+state.toasts.map(function(t){
    return '<div class="toast '+(t.tipo==="err"?"err":"")+'"><div class="tt">'+icon(t.tipo==="err"?"alert":"check",14)+' '+escapeHtml(t.titulo)+'</div>'+(t.desc?'<div class="td">'+escapeHtml(t.desc)+'</div>':'')+'</div>';
  }).join("")+'</div>';
}

function renderView(){
  if(state.view==="comanda") return renderComanda();
  if(state.view==="kds") return renderKds();
  if(state.view==="caixa") return renderCaixa();
  if(state.view==="auditoria") return renderAuditoria();
  if(state.view==="cardapio") return renderCardapio();
  if(state.view==="estoque") return renderEstoque();
  if(state.view==="financeiro") return renderFinanceiro();
  if(state.view==="relatorios") return renderRelatorios();
  if(state.view==="equipe") return renderEquipe();
  if(state.view==="configuracoes") return renderConfiguracoes();
  if(state.view==="dashboard") return renderDashboard();
  return renderSalao();
}

