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
  {view:"compras", label:"Compras", icon:"package", perm:PERM.ESTOQUE, built:true},
  {view:"financeiro", label:"Financeiro", icon:"landmark", perm:PERM.FINANCEIRO, built:true},
  {view:"relatorios", label:"Relatórios", icon:"chart", perm:PERM.RELATORIOS, built:true},
  {view:"equipe", label:"Equipe", icon:"users", perm:PERM.EQUIPE, built:true},
  {view:"auditoria", label:"Auditoria", icon:"alert", perm:PERM.AUDITORIA_VER, built:true},
  {view:"configuracoes", label:"Configurações", icon:"settings", perm:PERM.CONFIGURACOES, built:true}
];
var PAGE_TITLES = {dashboard:"Dashboard", salao:"Atendimento", comanda:"Atendimento", kds:"Cozinha (KDS)", caixa:"Caixa", auditoria:"Auditoria",
  cardapio:"Cardápio", estoque:"Estoque", compras:"Compras", financeiro:"Financeiro", relatorios:"Relatórios", equipe:"Equipe", configuracoes:"Configurações"};

// Cabeçalho padrão de tela (ícone em destaque + título + subtítulo [+ ações
// à direita]) — uso progressivo: cada tela passa a chamar isso conforme é
// reconstruída nas próximas etapas, em vez de montar o <div class="page-header">
// à mão.
function renderPageHeader(iconName, title, sub, acoesHtml){
  return '<div class="page-header">'+
      '<div style="display:flex; align-items:center; gap:14px;">'+
        '<div class="page-icon-badge">'+icon(iconName,22)+'</div>'+
        '<div><div class="page-title">'+title+'</div><div class="page-sub">'+sub+'</div></div>'+
      '</div>'+
      (acoesHtml||'')+
    '</div>';
}

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
      '<img class="login-logo" src="assets/logo/vision-food.png" alt="Vision Food">'+
      '<h1>CARREGANDO</h1><p>Sincronizando dados...</p></div></div>';
    return;
  }
  var html = '<div class="shell">'+
      renderSidebar()+
      (state.sidebarMobileAberto ? '<div class="sidebar-backdrop" data-action="sidebar-fechar"></div>' : '')+
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
  return '<div class="sidebar '+(state.sidebarCollapsed?"collapsed":"")+' '+(state.sidebarMobileAberto?"mobile-open":"")+'">'+
    '<div class="sidebar-brand">'+
      '<img class="sidebar-logo" src="assets/logo/vision-food-icon.png" alt="Vision Food">'+
      '<div class="brand-text"><div class="name"><span class="vf-vision">VISION</span> <span class="vf-food">FOOD</span></div>'+
        '<div class="sub">A inovação tecnológica para o seu restaurante</div></div>'+
      '<button class="icon-btn sidebar-close" data-action="sidebar-fechar">'+icon("x",16)+'</button>'+
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

var MESES_EXTENSO = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
var DIAS_SEMANA_EXTENSO = ["Domingo","Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado"];
function formatarDataPorExtenso(d){
  return DIAS_SEMANA_EXTENSO[d.getDay()]+", "+d.getDate()+" de "+MESES_EXTENSO[d.getMonth()]+" de "+d.getFullYear();
}
function formatarHoraMin(d){
  return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
}
function atualizarRelogioTopbar(){
  var agora = new Date();
  var elHora = document.getElementById("topbarHora");
  var elData = document.getElementById("topbarData");
  if(elHora) elHora.textContent = formatarHoraMin(agora);
  if(elData) elData.textContent = formatarDataPorExtenso(agora);
}
function iniciarRelogioTopbar(){
  atualizarRelogioTopbar();
  setInterval(atualizarRelogioTopbar, 15000);
}

function renderTopbar(){
  var u = usuarioAtual();
  var title = PAGE_TITLES[state.view] || "";
  var aberto = estaAberto();
  var agora = new Date();

  // "Sincronizado" reflete o canal Realtime de verdade (data.js), não um
  // texto fixo — offline, conectando (canal ainda não assinado) ou
  // sincronizado (canal ativo) são os três estados reais possíveis.
  var online = navigator.onLine;
  var canalAtivo = (typeof realtimeChannel !== "undefined") && !!realtimeChannel;
  var conexaoCor = !online ? "var(--danger)" : (canalAtivo ? "var(--success)" : "var(--warning)");
  var conexaoTexto = !online ? "SEM CONEXÃO" : (canalAtivo ? "SINCRONIZADO" : "CONECTANDO");
  var conexaoDetalhe = !online ? "reconectando..." : (canalAtivo ? "tempo real ativo" : "aguardando canal...");

  return '<div class="topbar">'+
    '<button class="icon-btn" data-action="toggle-sidebar">'+icon("menu",18)+'</button>'+
    '<div class="topbar-title">'+title+'</div>'+
    '<div class="topbar-spacer"></div>'+
    '<div class="status-pill topbar-clock"><span class="data-extenso" id="topbarData">'+formatarDataPorExtenso(agora)+'</span>'+
      '<span style="margin-left:6px;" id="topbarHora">'+formatarHoraMin(agora)+'</span></div>'+
    '<div class="status-pill">'+
      '<span class="status-dot" style="background:'+(aberto?"var(--success)":"var(--danger)")+';"></span>'+
      (aberto?"ABERTO":"FECHADO")+
      ' <span class="pill-detail" style="color:var(--text-muted);">· '+state.config.horarioAbertura+'–'+state.config.horarioFechamento+'</span>'+
    '</div>'+
    '<div class="status-pill pill-conexao"><span class="status-dot" style="background:'+conexaoCor+';"></span>'+conexaoTexto+' <span class="pill-detail" style="color:var(--text-muted);">· '+conexaoDetalhe+'</span></div>'+
    renderSinoAlertas()+
    '<div class="user-chip">'+
      '<div class="avatar">'+escapeHtml(u.nome.charAt(0))+'</div>'+
      '<div class="meta"><div class="nome">'+escapeHtml(u.nome)+'</div><div class="papel">'+u.papel+'</div></div>'+
    '</div>'+
    '<button class="icon-btn" data-action="logout" title="Sair" style="margin-left:4px;">'+icon("door",16)+'</button>'+
  '</div>';
}

function renderSinoAlertas(){
  if(!can(PERM.SALAO_VER)) return "";
  var alertas = alertasOperacionais();
  var n = alertas.length;
  return '<button class="icon-btn" data-action="nav-goto" data-view="dashboard" title="'+n+' alerta(s)" style="position:relative;">'+
    icon("bell",17)+
    (n ? '<span style="position:absolute; top:-3px; right:-3px; background:var(--danger); color:#fff; font-size:9px; font-weight:800; min-width:16px; height:16px; line-height:16px; border-radius:999px; text-align:center; padding:0 3px;">'+(n>9?"9+":n)+'</span>' : '')+
  '</button>';
}

function renderBottomNav(){
  var items = [
    {view:"salao", label:"Salão", icon:"utensils", perm:PERM.SALAO_VER},
    {view:"kds", label:"Cozinha", icon:"chef", perm:PERM.KDS_VER},
    {view:"caixa", label:"Caixa", icon:"wallet", perm:PERM.CAIXA_ABRIR}
  ].filter(function(n){ return can(n.perm); });
  return '<div class="bottom-nav">'+items.map(function(n){
    var active = state.view===n.view || (n.view==="salao" && state.view==="comanda");
    return '<div class="bn-item '+(active?"active":"")+'" data-action="nav-goto" data-view="'+n.view+'">'+icon(n.icon,20)+'<span>'+n.label+'</span></div>';
  }).join("")+
    '<div class="bn-item '+(state.sidebarMobileAberto?"active":"")+'" data-action="sidebar-abrir">'+icon("menu",20)+'<span>Menu</span></div>'+
  '</div>';
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
  if(state.view==="compras") return renderCompras();
  if(state.view==="financeiro") return renderFinanceiro();
  if(state.view==="relatorios") return renderRelatorios();
  if(state.view==="equipe") return renderEquipe();
  if(state.view==="configuracoes") return renderConfiguracoes();
  if(state.view==="dashboard") return renderDashboard();
  return renderSalao();
}

