"use strict";

var SETOR_COR = {BAR:"var(--info)", COZINHA:"var(--primary)", BRASA:"var(--danger)", SOBREMESA:"var(--purple)"};
var PAPEL_COR = {ADMIN:"var(--purple)", GERENTE:"var(--primary)", CAIXA:"var(--success)", GARCOM:"var(--info)", COZINHA:"var(--warning)"};

// Criticidade por ação de auditoria — mapa simples e fácil de editar.
// Ações sensíveis explícitas viram Alta/Média; qualquer ação não listada
// aqui cai em Baixa por padrão.
var AUDITORIA_CRITICIDADE = {
  CANCELAR_ITEM: "Alta",
  DIFERENCA_JUSTIFICADA: "Alta",
  DESCONTO_ACIMA_LIMITE: "Média",
  PRECO_ALTERADO: "Média",
  PIN_ALTERADO: "Média",
  USUARIO_DESATIVADO: "Média"
};
function criticidadeDe(acao){
  return AUDITORIA_CRITICIDADE[acao] || "Baixa";
}
var CRITICIDADE_CLS = {Alta:"badge-status-critico", Média:"badge-status-atencao", Baixa:"badge-status-ok"};

// PRIORIDADE 1 — Central do Dono: tela nova, primeira depois do login pra
// ADMIN/GERENTE. Tudo vem pronto de state.centralDono (RPC central_do_dono,
// carregada em data.js) — nenhuma soma feita aqui, só formatação.
var ATENCAO_INFO = {
  ESTOQUE_NEGATIVO: {titulo:"Estoque negativo", detalhe:function(a){ return a.qtd+" insumo(s) com estoque abaixo de zero — possível furo."; }},
  CONTAS_VENCENDO: {titulo:"Contas a pagar vencendo", detalhe:function(a){ return a.qtd+" conta(s) · "+brl(a.valorCentavos||0)+" no total."; }},
  DIFERENCA_CAIXA: {titulo:"Diferença no caixa de hoje", detalhe:function(a){ return brl(a.valorCentavos||0)+" de diferença no último fechamento."; }},
  CONFLITOS_OFFLINE: {titulo:"Conflitos de sincronização", detalhe:function(a){ return a.qtd+" pagamento(s) offline esperando decisão."; }},
  CANCELAMENTOS_ACIMA_DO_NORMAL: {titulo:"Cancelamentos acima do normal", detalhe:function(a){ return a.qtd+" hoje (média dos últimos 7 dias: "+a.media+")."; }}
};
function corSemaforo(valor, meta){
  if(valor===null || valor===undefined) return "var(--text-muted)";
  if(valor<=meta) return "var(--success)";
  if(valor<=meta*1.2) return "var(--warning)";
  return "var(--danger)";
}
function variacaoHtml(pct){
  if(pct===null || pct===undefined) return '<div class="kpi-caption">sem comparação</div>';
  var cor = pct>=0 ? "var(--success)" : "var(--danger)";
  var seta = pct>=0 ? "▲" : "▼";
  return '<div class="kpi-caption" style="color:'+cor+'; font-weight:700;">'+seta+' '+Math.abs(pct)+'% vs semana passada</div>';
}
function renderCentralDono(){
  var d = state.centralDono;
  if(!d){
    return renderPageHeader("target", "Central do Dono", "Entenda o restaurante em 30 segundos")+
      '<div class="empty-hint">Carregando...</div>';
  }
  var h = d.hoje, m = d.mes, s = d.semaforos, sal = d.salao;

  var blocoHoje = '<div class="section-label">Hoje até agora</div>'+
    '<div class="metric-grid">'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("trendingUp",20)+'</div><div class="kpi-body">'+
        '<div class="kpi-label">Faturamento</div><div class="kpi-value">'+brl(h.faturamentoCentavos)+'</div>'+variacaoHtml(h.variacaoFaturamentoPct)+'</div></div>'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("utensils",20)+'</div><div class="kpi-body">'+
        '<div class="kpi-label">Vendas</div><div class="kpi-value">'+h.vendas+'</div>'+variacaoHtml(h.variacaoVendasPct)+'</div></div>'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("target",20)+'</div><div class="kpi-body">'+
        '<div class="kpi-label">Ticket médio</div><div class="kpi-value">'+brl(h.ticketMedioCentavos)+'</div>'+variacaoHtml(h.variacaoTicketPct)+'</div></div>'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("chart",20)+'</div><div class="kpi-body">'+
        '<div class="kpi-label">Projeção de fechamento</div><div class="kpi-value">'+brl(h.projecaoFechamentoCentavos)+'</div>'+
        '<div class="kpi-caption">pelo ritmo das últimas 4 semanas</div></div></div>'+
    '</div>';

  var blocoMes = '<div class="section-label">Sobrou no mês</div>'+
    (m.podeVerResultado ?
      '<div class="card">'+
        '<div class="metric-grid">'+
          '<div class="metric-card"><div class="metric-label">Faturamento</div><div class="metric-value small">'+brl(m.faturamentoCentavos)+'</div></div>'+
          '<div class="metric-card"><div class="metric-label">CMV</div><div class="metric-value small">'+brl(m.cmvCentavos)+'</div></div>'+
          '<div class="metric-card"><div class="metric-label">Perdas</div><div class="metric-value small">'+brl(m.perdasCentavos)+'</div></div>'+
          '<div class="metric-card"><div class="metric-label">Despesas</div><div class="metric-value small">'+brl(m.despesasCentavos)+'</div></div>'+
        '</div>'+
        '<div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">'+
          '<div><div class="kpi-label">Resultado estimado do mês</div><div class="kpi-value" style="color:'+(m.resultadoCentavos>=0?"var(--success)":"var(--danger)")+';">'+brl(m.resultadoCentavos)+'</div></div>'+
          (m.faltaParaCobrirContasCentavos>0 ?
            '<div style="text-align:right;"><div class="kpi-label">Falta pra cobrir as contas do mês</div><div class="kpi-value" style="color:var(--warning);">'+brl(m.faltaParaCobrirContasCentavos)+'</div></div>'
            : '<div class="chip" style="background:rgba(34,197,94,.15); color:var(--success); cursor:default;">'+icon("check",14)+' contas do mês cobertas</div>')+
        '</div>'+
        (!m.custoEquipeDisponivel ? '<p style="font-size:11px; color:var(--text-muted); margin:10px 0 0;">Custo de equipe ainda não entra nesta conta (chega na Prioridade 5).</p>' : '')+
      '</div>'
      : '<div class="empty-hint">Disponível só para ADMIN.</div>')+
    '<div class="section-label">Semáforos</div>'+
    '<div class="metric-grid">'+
      '<div class="metric-card"><div class="metric-label"><span class="status-dot" style="background:'+corSemaforo(s.cmvPct, s.metas.cmvPct)+';"></span> CMV</div>'+
        '<div class="metric-value small">'+(s.cmvPct!==null?s.cmvPct+"%":"—")+'</div><div style="font-size:11px; color:var(--text-muted);">meta '+s.metas.cmvPct+'%</div></div>'+
      '<div class="metric-card"><div class="metric-label"><span class="status-dot" style="background:'+corSemaforo(s.perdasPctFaturamento, s.metas.perdasPctFaturamento)+';"></span> Perdas</div>'+
        '<div class="metric-value small">'+(s.perdasPctFaturamento!==null?s.perdasPctFaturamento+"%":"—")+'</div><div style="font-size:11px; color:var(--text-muted);">meta '+s.metas.perdasPctFaturamento+'%</div></div>'+
      '<div class="metric-card"><div class="metric-label"><span class="status-dot" style="background:var(--text-muted);"></span> Custo de equipe</div>'+
        '<div class="metric-value small">—</div><div style="font-size:11px; color:var(--text-muted);">chega na Prioridade 5</div></div>'+
      '<div class="metric-card"><div class="metric-label"><span class="status-dot" style="background:'+corSemaforo(s.diferencaCaixaCentavosMes, s.metas.diferencaCaixaCentavosMes)+';"></span> Diferença de caixa (mês)</div>'+
        '<div class="metric-value small">'+brl(s.diferencaCaixaCentavosMes)+'</div><div style="font-size:11px; color:var(--text-muted);">meta '+brl(s.metas.diferencaCaixaCentavosMes)+'</div></div>'+
    '</div>';

  var blocoAtencao = '<div class="section-label">Precisa da sua atenção</div>'+
    (d.atencao.length ? d.atencao.map(function(a){
      var info = ATENCAO_INFO[a.tipo] || {titulo:a.tipo, detalhe:function(){ return ""; }};
      return '<div class="alert-row danger" data-action="nav-goto" data-view="'+a.view+'" style="cursor:pointer;">'+icon("alert",16)+
        '<div style="flex:1;"><span class="t">'+escapeHtml(info.titulo)+'</span><span class="d">'+escapeHtml(info.detalhe(a))+'</span></div>'+
        icon("chevronRight",16)+
      '</div>';
    }).join("") : '<div class="empty-hint">Nada precisando de atenção agora.</div>');

  var blocoSalao = '<div class="section-label">Agora no salão</div>'+
    '<div class="metric-grid">'+
      '<div class="metric-card"><div class="metric-label">Mesas ocupadas</div><div class="metric-value small">'+sal.mesasOcupadas+' / '+sal.mesasTotal+'</div></div>'+
      '<div class="metric-card"><div class="metric-label">Pedidos atrasados na cozinha</div><div class="metric-value small" style="color:'+(sal.pedidosAtrasadosCozinha>0?"var(--danger)":"var(--success)")+';">'+sal.pedidosAtrasadosCozinha+'</div></div>'+
      '<div class="metric-card"><div class="metric-label">Caixa</div><div class="metric-value small" style="color:'+(sal.caixasAbertos>0?"var(--success)":"var(--danger)")+';">'+(sal.caixasAbertos>0?"ABERTO":"FECHADO")+'</div></div>'+
    '</div>';

  return renderPageHeader("target", "Central do Dono", "Entenda o restaurante em 30 segundos · dia operacional "+(d.diaOperacional?new Date(d.diaOperacional+"T00:00:00").toLocaleDateString("pt-BR"):""))+
    blocoHoje + blocoMes + blocoAtencao + blocoSalao;
}

function renderDashboard(){
  var u = usuarioAtual();
  var pagas = comandasPagasHoje();
  var vendasHoje = pagas.reduce(function(s,c){ return s+totaisComanda(c).total; },0);
  var nPedidos = pagas.length;
  var ticketMedio = nPedidos? Math.round(vendasHoje/nPedidos) : 0;
  var ocupadas = state.mesas.filter(function(m){ return mesaStatus(m.id)!=="livre"; }).length;

  var porHora = {};
  pagas.forEach(function(c){
    var h = new Date(c.fechamento).getHours();
    porHora[h] = (porHora[h]||0) + totaisComanda(c).total;
  });
  var horas = [];
  for(var h=11; h<=23; h++) horas.push(h);
  for(var h2=0; h2<VIRADA_DIA_OPERACIONAL_HORA; h2++) horas.push(h2);
  var maxHora = Math.max(1, Math.max.apply(null, horas.map(function(h){ return porHora[h]||0; })));

  var livres = state.mesas.filter(function(m){ return mesaStatus(m.id)==="livre"; }).length;
  var ocup = state.mesas.filter(function(m){ return mesaStatus(m.id)==="ocupada"; }).length;
  var aguardando = state.mesas.filter(function(m){ return mesaStatus(m.id)==="pagamento"; }).length;

  var kds = itensKdsAtivos();

  var alerts = alertasOperacionais();

  return renderPageHeader("grid", "Bom dia, "+escapeHtml(u.nome).toUpperCase(),
      "Operação de hoje · "+new Date().toLocaleDateString("pt-BR",{day:"2-digit",month:"short",year:"numeric"}).toUpperCase())+
    '<div class="metric-grid">'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("trendingUp",20)+'</div><div class="kpi-body"><div class="kpi-label">Vendas hoje</div><div class="kpi-value">'+brl(vendasHoje)+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("utensils",20)+'</div><div class="kpi-body"><div class="kpi-label">Pedidos</div><div class="kpi-value">'+nPedidos+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("target",20)+'</div><div class="kpi-body"><div class="kpi-label">Ticket médio</div><div class="kpi-value">'+brl(ticketMedio)+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("grid",20)+'</div><div class="kpi-body"><div class="kpi-label">Mesas ocupadas</div><div class="kpi-value">'+ocupadas+' / '+state.mesas.length+'</div></div></div>'+
    '</div>'+
    '<div class="section-label">Vendas do dia</div>'+
    '<div class="card">'+
      '<div class="chart-bars">'+horas.map(function(h){
        var v = porHora[h]||0;
        var pct = Math.max(2, Math.round(v/maxHora*100));
        return '<div class="chart-bar '+(v>0?"has":"")+'" style="height:'+pct+'%" title="'+h+'h · '+brl(v)+'"></div>';
      }).join("")+'</div>'+
      '<div class="chart-labels">'+horas.map(function(h){ return '<span>'+h+'</span>'; }).join("")+'</div>'+
    '</div>'+
    '<div class="grid-2">'+
      '<div class="card">'+
        '<div class="card-title">Situação do salão</div>'+
        '<div class="metric-grid">'+
          '<div class="metric-card"><div class="metric-label">Livres</div><div class="metric-value small" style="color:var(--success);">'+livres+'</div></div>'+
          '<div class="metric-card"><div class="metric-label">Ocupadas</div><div class="metric-value small" style="color:var(--primary);">'+ocup+'</div></div>'+
          '<div class="metric-card"><div class="metric-label">Aguardando conta</div><div class="metric-value small" style="color:var(--danger);">'+aguardando+'</div></div>'+
        '</div>'+
      '</div>'+
      '<div class="card">'+
        '<div class="card-title">Cozinha agora</div>'+
        '<div class="metric-grid">'+
          '<div class="metric-card"><div class="metric-label">Pendentes</div><div class="metric-value small" style="color:var(--danger);">'+kds.PENDENTE+'</div></div>'+
          '<div class="metric-card"><div class="metric-label">Preparando</div><div class="metric-value small" style="color:var(--warning);">'+kds.PREPARANDO+'</div></div>'+
          '<div class="metric-card"><div class="metric-label">Prontos</div><div class="metric-value small" style="color:var(--success);">'+kds.PRONTO+'</div></div>'+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div class="section-label">Alertas</div>'+
    (alerts.length ? alerts.map(function(a){
      return '<div class="alert-row '+(a.danger?"danger":"")+'"'+(a.view?' data-action="nav-goto" data-view="'+a.view+'" style="cursor:pointer;"':'')+'>'+icon("alert",16)+
        '<div style="flex:1;"><span class="t">'+a.t+'</span><span class="d">'+a.d+'</span></div>'+
        (a.view?icon("chevronRight",16):'')+
      '</div>';
    }).join("") : '<div class="empty-hint">Nenhum alerta no momento.</div>');
}

// PRIORIDADE 8 — Salão ganhou sub-abas (mesmo componente da 0.11): Mapa
// de mesas (tela de sempre) e Reservas e fila. Reservas (só as de hoje
// em diante, status ainda aberto) carregam direto em carregarTudo —
// lista pequena, do tamanho de fornecedores/categorias, não é "comandas/
// itens completos" — porque o Mapa precisa saber quem está reservado pra
// já sem depender da sub-aba Reservas ter sido aberta.
function renderSalao(){
  return renderPageHeader("utensils", "Atendimento", "Mapa de salão em tempo real",
      (can(PERM.COMANDA_ABRIR) ? '<div class="action-row" style="flex:0 0 auto;">'+
        '<button class="btn btn-primary" data-action="balcao-abrir">'+icon("plus",15)+' Balcão</button>'+
        '<button class="btn btn-primary" data-action="ficha-abrir">'+icon("plus",15)+' Ficha</button>'+
        '<button class="btn btn-primary" data-action="delivery-abrir">'+icon("truck",15)+' Delivery</button>'+
      '</div>' : ''))+
    renderSubAbas("salao");
}
function reservaProximaDaMesa(mesaId){
  var agora = Date.now(), em2h = agora + 2*3600000, tolerancia = agora - 15*60000;
  return state.reservas.find(function(r){
    var t = new Date(r.dataHora).getTime();
    return r.mesaSugeridaId===mesaId && (r.status==="AGUARDANDO"||r.status==="CONFIRMADA") && t>=tolerancia && t<=em2h;
  });
}
function renderMapaConteudo(){
  var filtro = state.salaoFiltro;
  var tabs = [["TODAS","Todas"],["LIVRES","Livres"],["OCUPADAS","Ocupadas"],["CONTA","Conta"]];
  var mesasFiltradas = state.mesas.filter(function(m){
    var st = mesaStatus(m.id);
    if(filtro==="LIVRES") return st==="livre";
    if(filtro==="OCUPADAS") return st==="ocupada";
    if(filtro==="CONTA") return st==="pagamento";
    return true;
  });
  var cards = mesasFiltradas.map(function(m){
    var st = mesaStatus(m.id);
    var abertas = comandasAbertasDaMesa(m.id);
    var min = mesaMinutos(m.id);
    var timeCls = min>=60?"danger":(min>=30?"warn":"");
    var soma = abertas.reduce(function(s,c){ return s + totaisComanda(c).total; },0);
    var pronto = st!=="livre" && mesaTemItemPronto(m.id);
    var reserva = reservaProximaDaMesa(m.id);
    return '<div class="mesa-block '+st+(pronto?" pronto":"")+'" data-action="mesa-open" data-mesa="'+m.id+'">'+
      '<div class="mesa-top"><div class="num">'+String(m.numero).padStart(2,"0")+'</div><div class="label">Mesa</div></div>'+
      (st==="livre" ?
        '<div><div class="mesa-mid">'+m.capacidade+' lugares</div><div class="mesa-status-txt" style="margin-top:8px;">Livre</div>'+
        (reserva ? '<div class="mesa-status-txt" style="color:var(--info); font-weight:700;">'+icon("clock",12)+' Reservada '+formatarHoraMin(new Date(reserva.dataHora))+'</div>' : '')+'</div>'
        :
        '<div><div class="mesa-mid">'+m.capacidade+' lugares</div>'+
        (pronto ? '<div class="mesa-status-txt" style="color:var(--warning); font-weight:700;">'+icon("check",12)+' PRONTO</div>' : '')+
        '<div class="mesa-bottom"><span class="mesa-valor">'+brl(soma)+'</span>'+
        '<span class="mesa-time '+timeCls+'">'+icon("clock",11)+' '+fmtMin(min)+'</span></div></div>'
      )+
    '</div>';
  }).join("");
  var comandasAbertas = state.comandas.filter(function(c){ return c.status==="ABERTA" || c.status==="FECHANDO"; });

  return (state.pedidosQr.length && can(PERM.ITEM_LANCAR) ? renderPedidosQrPendentes() : '')+
    '<div class="tabs">'+tabs.map(function(t){ return '<div class="tab '+(filtro===t[0]?"active":"")+'" data-action="salao-filtro" data-f="'+t[0]+'">'+t[1]+'</div>'; }).join("")+'</div>'+
    '<div class="grid-2">'+
      '<div class="mesas-grid">'+(cards||'<div class="empty-hint">Nenhuma mesa neste filtro.</div>')+'</div>'+
      '<div class="card comandas-side">'+
        '<div class="card-title">Comandas abertas</div>'+
        (comandasAbertas.length ? comandasAbertas.map(function(c){
          var mesa = state.mesas.find(function(m){ return m.id===c.mesaId; });
          var t = totaisComanda(c);
          return '<div class="item" data-action="comanda-open" data-comanda="'+c.id+'">'+
            '<div>'+rotuloComanda(c, mesa)+'<div class="t">'+fmtMin(minutosDesde(c.abertura))+'</div></div>'+
            '<div>'+brl(t.total)+'</div>'+
          '</div>';
        }).join("") : '<div class="empty-hint">Salão livre no momento.</div>')+
      '</div>'+
    '</div>';
}
// wa.me só abre o WhatsApp do aparelho com a mensagem pronta — nunca
// manda nada por conta própria (não existe provedor de envio aqui).
function linkWhatsapp(telefone, mensagem){
  var limpo = (telefone||"").replace(/\D/g,"");
  if(limpo && limpo.slice(0,2)!=="55") limpo = "55"+limpo;
  return "https://wa.me/"+limpo+"?text="+encodeURIComponent(mensagem);
}
var RESERVA_STATUS_LBL = {AGUARDANDO:"Aguardando", CONFIRMADA:"Confirmada", SENTADO:"Sentado", NAO_VEIO:"Não veio"};
var FILA_STATUS_LBL = {AGUARDANDO:"Aguardando", CHAMADO:"Chamado", SENTADO:"Sentado", DESISTIU:"Desistiu"};
function renderReservasFilaConteudo(){
  var podeEditar = can(PERM.COMANDA_ABRIR);
  var reservasAbertas = state.reservas.filter(function(r){ return r.status==="AGUARDANDO"||r.status==="CONFIRMADA"; })
    .sort(function(a,b){ return new Date(a.dataHora)-new Date(b.dataHora); });
  var fila = state.filaEspera;

  var blocoReservas = '<div class="section-label">Reservas</div>'+
    (podeEditar ? '<div class="action-row" style="margin-bottom:10px;"><button class="btn btn-sm btn-primary" data-action="reserva-nova">'+icon("plus",14)+' Nova reserva</button></div>' : '')+
    '<div class="card" style="margin-bottom:14px;">'+
    (reservasAbertas.length ? reservasAbertas.map(function(r){
      var mesa = state.mesas.find(function(m){ return m.id===r.mesaSugeridaId; });
      var msg = "Olá "+r.nome+"! Confirmando sua reserva pra "+r.pessoas+" pessoa(s) hoje às "+formatarHoraMin(new Date(r.dataHora))+".";
      return '<div class="data-row"><div class="main"><div class="nome">'+escapeHtml(r.nome)+' · '+r.pessoas+' pessoa(s)</div>'+
        '<div class="sub">'+new Date(r.dataHora).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})+
          (mesa?' · mesa '+mesa.numero:'')+(r.observacao?' · '+escapeHtml(r.observacao):'')+' · <span class="badge badge-status-info">'+RESERVA_STATUS_LBL[r.status]+'</span></div></div>'+
        (podeEditar ? '<div class="acts">'+
          (r.telefone ? '<a class="btn btn-sm" href="'+linkWhatsapp(r.telefone,msg)+'" target="_blank" rel="noopener">'+icon("check",14)+' WhatsApp</a>' : '')+
          (r.status==="AGUARDANDO" ? '<button class="btn btn-sm" data-action="reserva-confirmar" data-reserva="'+r.id+'">Confirmar</button>' : '')+
          '<button class="btn btn-sm btn-success" data-action="sentar-abrir" data-tipo="reserva" data-id="'+r.id+'" data-mesa-sugerida="'+(r.mesaSugeridaId||"")+'">Sentar</button>'+
          '<button class="btn btn-sm" data-action="reserva-nao-veio" data-reserva="'+r.id+'" style="color:var(--danger);">Não veio</button>'+
        '</div>' : '')+
      '</div>';
    }).join("") : '<div class="empty-hint">Nenhuma reserva em aberto.</div>')+
    '</div>';

  var blocoFila = '<div class="section-label">Fila de espera</div>'+
    (podeEditar ? '<div class="action-row" style="margin-bottom:10px;"><button class="btn btn-sm btn-primary" data-action="fila-nova">'+icon("plus",14)+' Entrar na fila</button></div>' : '')+
    '<div class="card">'+
    (!fila ? '<div class="empty-hint">Carregando...</div>' : !fila.length ? '<div class="empty-hint">Ninguém na fila agora.</div>' : fila.map(function(f){
      var msg = "Olá "+f.nome+"! Sua mesa já está pronta, pode vir até o restaurante.";
      return '<div class="data-row"><div class="main"><div class="nome">#'+f.posicao+' · '+escapeHtml(f.nome)+' · '+f.pessoas+' pessoa(s)</div>'+
        '<div class="sub">espera estimada ~'+f.tempo_estimado_min+' min · <span class="badge badge-status-info">'+FILA_STATUS_LBL[f.status]+'</span></div></div>'+
        (podeEditar ? '<div class="acts">'+
          (f.telefone ? '<a class="btn btn-sm" href="'+linkWhatsapp(f.telefone,msg)+'" target="_blank" rel="noopener">'+icon("check",14)+' WhatsApp</a>' : '')+
          (f.status==="AGUARDANDO" ? '<button class="btn btn-sm" data-action="fila-chamar" data-fila="'+f.id+'">Chamar</button>' : '')+
          '<button class="btn btn-sm btn-success" data-action="sentar-abrir" data-tipo="fila" data-id="'+f.id+'">Sentar</button>'+
          '<button class="btn btn-sm" data-action="fila-desistiu" data-fila="'+f.id+'" style="color:var(--danger);">Desistiu</button>'+
        '</div>' : '')+
      '</div>';
    }).join(""))+
    '</div>';

  return blocoReservas + blocoFila;
}
SUB_ABAS.salao = [
  {id:"mapa", rotulo:"Mapa de mesas", permissao:PERM.SALAO_VER, render:renderMapaConteudo},
  {id:"reservas", rotulo:"Reservas e fila", permissao:PERM.SALAO_VER, render:renderReservasFilaConteudo,
    carregar:function(){ carregarFilaEspera(); },
    carregado:function(){ return !!state.filaEspera; }}
];

// Fase 3.3 — pedidos vindos do QR da mesa, aguardando confirmação do
// garçom (nunca vão direto pra cozinha).
function renderPedidosQrPendentes(){
  return '<div class="card" style="margin-bottom:14px; border-left:4px solid var(--primary);">'+
    '<div class="card-title">'+icon("bell",16)+' Pedidos pelo QR da mesa ('+state.pedidosQr.length+')</div>'+
    state.pedidosQr.map(function(p){
      var mesa = state.mesas.find(function(m){ return m.id===p.mesaId; });
      var totalItens = p.itens.reduce(function(s,it){ return s+Number(it.quantidade); },0);
      return '<div class="data-row">'+
        '<div class="main"><div class="nome">Mesa '+(mesa?mesa.numero:"?")+'</div>'+
        '<div class="sub">'+p.itens.map(function(it){
          var opcoesTxt = (it.opcoes_selecionadas||[]).map(function(o){ return o.nome; }).join(", ");
          return it.quantidade+'x '+escapeHtml(it.nome)+(opcoesTxt?' ('+escapeHtml(opcoesTxt)+')':'');
        }).join(", ")+
        (p.observacao?' · '+escapeHtml(p.observacao):'')+'</div></div>'+
        '<div class="acts">'+
          '<button class="btn btn-sm btn-success" data-action="pedidoqr-confirmar" data-pedido="'+p.id+'">Confirmar</button>'+
          '<button class="btn btn-sm" data-action="pedidoqr-rejeitar" data-pedido="'+p.id+'" style="color:var(--danger);">Rejeitar</button>'+
        '</div>'+
      '</div>';
    }).join("")+
  '</div>';
}

function renderComanda(){
  var comanda = state.comandas.find(function(c){ return c.id===state.viewParams.comandaId; });
  if(!comanda) return '<div class="empty-hint">Comanda não encontrada.</div>';
  if(!state.draft || state.draft.comandaId!==comanda.id) irParaComanda(comanda.id);
  var mesa = state.mesas.find(function(m){ return m.id===comanda.mesaId; });
  var t = totaisComanda(comanda);
  var naoPagos = itensNaoPagos(comanda);
  var podeFechar = can(PERM.COMANDA_FECHAR) && comanda.status==="ABERTA" && naoPagos.length>0;
  var podeCancelarComanda = can(PERM.COMANDA_ABRIR) && comanda.status==="ABERTA" && comanda.itens.length===0;
  var podeLancar = can(PERM.ITEM_LANCAR) && comanda.status==="ABERTA";
  var itensProntos = comanda.itens.filter(function(it){ return it.status==="PRONTO"; });
  // Fase 0.6 — se o pagamento travou (aba fechou no meio), libera reabrir
  // manualmente depois de 10 minutos em FECHANDO; nunca reabre sozinho.
  var podeReabrir = can(PERM.COMANDA_REABRIR) && comanda.status==="FECHANDO" && comanda.updatedAt && minutosDesde(comanda.updatedAt)>10;
  var draftCount = Object.keys(state.draft.itens).reduce(function(s,k){ return s+state.draft.itens[k].qtd; },0)
    + (state.draft.itensComOpcoes||[]).reduce(function(s,l){ return s+l.qtd; },0);

  var sentItemsHtml = comanda.itens.length ? comanda.itens.map(function(it){
    // Fase 0.3: cancelar item agora exige PIN de supervisor validado no
    // servidor (RPC cancelar_item) sempre — a trava real não é mais essa
    // checagem de permissão do próprio usuário, só decide se o botão
    // aparece. Qualquer um que lança item também pode pedir cancelamento.
    var podeCancel = it.status!=="CANCELADO" && it.status!=="ENTREGUE" && !it.pagoEm && can(PERM.ITEM_LANCAR);
    var podeTransferirItem = it.status!=="CANCELADO" && !it.pagoEm && can(PERM.COMANDA_TRANSFERIR) && comanda.status==="ABERTA";
    return '<div class="item-row">'+
      '<div class="info"><div class="nome">'+it.quantidade+'x '+escapeHtml(it.nome)+'</div>'+
      ((it.opcoesSelecionadas&&it.opcoesSelecionadas.length)?'<div class="obs">'+it.opcoesSelecionadas.map(function(o){return escapeHtml(o.nome);}).join(" + ")+'</div>':'')+
      (it.observacao?'<div class="obs">'+escapeHtml(it.observacao)+'</div>':'')+
      '<div class="meta"><span class="status-badge status-'+it.status+'">'+it.status+'</span>'+
      (it.pagoEm?'<span class="badge badge-status-ok" style="margin-left:6px;">PAGO</span>':'')+
      (it._pendingSync?'<span class="badge badge-status-atencao" style="margin-left:6px;">OFFLINE · sincronizando</span>':'')+'</div></div>'+
      '<div class="preco">'+brl(it.precoUnitCentavos*it.quantidade)+'</div>'+
      (podeTransferirItem ? '<button class="icon-btn" data-action="item-transferir" data-item="'+it.id+'" title="Transferir pra outra comanda">'+icon("arrowLeft",14)+'</button>' : '')+
      (podeCancel ? '<button class="icon-btn" data-action="item-cancelar" data-item="'+it.id+'" style="color:var(--danger);">'+icon("x",14)+'</button>' : '')+
    '</div>';
  }).join("") : '<div class="empty-hint">Nenhum item enviado ainda.</div>';

  var draftHtmlSimples = Object.keys(state.draft.itens).map(function(pid){
    var p = state.produtos.find(function(x){ return x.id===pid; });
    var d = state.draft.itens[pid];
    var chipsHtml = '<div class="ingrediente-chips">'+INGREDIENTES_COMUNS.map(function(nome){
      var ativo = (d.semItens||[]).indexOf(nome)!==-1;
      return '<button type="button" class="ingrediente-chip '+(ativo?"ativo":"")+'" data-action="draft-ingrediente-toggle" data-produto="'+pid+'" data-nome="'+nome+'">'+
        (ativo?'SEM ':'')+escapeHtml(nome)+
      '</button>';
    }).join("")+'</div>';
    return '<div class="draft-line">'+
      '<div class="draft-line-top"><div class="nome">'+escapeHtml(p.nome)+'</div>'+
        '<div class="qty-ctrl">'+
          '<button data-action="draft-menos" data-produto="'+pid+'">'+icon("minus",13)+'</button>'+
          '<span>'+d.qtd+'</span>'+
          '<button data-action="draft-mais" data-produto="'+pid+'">'+icon("plus",13)+'</button>'+
        '</div></div>'+
      chipsHtml+
      '<input class="obs-input" id="obs-'+pid+'" data-action="draft-obs" data-produto="'+pid+'" placeholder="Observação extra (ex: ponto da carne)" value="'+escapeHtml(d.obs)+'">'+
    '</div>';
  }).join("");
  var draftHtmlComOpcoes = (state.draft.itensComOpcoes||[]).map(function(l){
    var p = state.produtos.find(function(x){ return x.id===l.produtoId; });
    return '<div class="draft-line">'+
      '<div class="draft-line-top"><div class="nome">'+escapeHtml(p?p.nome:"?")+
        (l.opcoesSelecionadas.length ? ' <span style="color:var(--text-muted); font-weight:400; font-size:11.5px;">— '+l.opcoesSelecionadas.map(function(o){return escapeHtml(o.nome);}).join(" + ")+'</span>' : '')+
      '</div>'+
        '<div class="qty-ctrl">'+
          '<button data-action="draftopt-menos" data-linha="'+l.id+'">'+icon("minus",13)+'</button>'+
          '<span>'+l.qtd+'</span>'+
          '<button data-action="draftopt-mais" data-linha="'+l.id+'">'+icon("plus",13)+'</button>'+
        '</div></div>'+
      (l.obs?'<div class="obs">'+escapeHtml(l.obs)+'</div>':'')+
      '<button class="btn btn-ghost btn-sm" style="margin-top:6px; color:var(--danger);" data-action="draftopt-remover" data-linha="'+l.id+'">'+icon("x",13)+' Remover</button>'+
    '</div>';
  }).join("");
  var draftHtml = draftCount===0 ? '<div class="empty-hint" style="padding:16px;">Toque num produto para adicionar.</div>' : (draftHtmlSimples+draftHtmlComOpcoes);

  var produtosFiltrados = state.produtos.filter(function(p){
    if(!p.ativo) return false;
    var okCat = p.categoria===state.draft.categoria;
    var okBusca = !state.draft.busca || p.nome.toLowerCase().indexOf(state.draft.busca.toLowerCase())!==-1;
    return okCat && okBusca;
  });

  var catalogHtml = '<div class="search-box">'+icon("search",16)+
      '<input id="buscaProdutoInput" placeholder="Buscar produto, código ou categoria..." value="'+escapeHtml(state.draft.busca)+'" data-action="draft-busca">'+
    '</div>'+
    '<div class="cat-tabs">'+state.categorias.map(function(c){
      return '<div class="cat-tab '+(c===state.draft.categoria?"active":"")+'" data-action="picker-cat" data-cat="'+escapeHtml(c)+'">'+escapeHtml(c)+'</div>';
    }).join("")+'</div>'+
    '<div class="product-grid">'+produtosFiltrados.map(function(p){
      if(p.esgotado){
        return '<div class="product-card" style="opacity:.4; cursor:not-allowed;">'+
          '<div class="nome">'+escapeHtml(p.nome)+'</div><div class="preco" style="color:var(--text-muted);">ESGOTADO</div></div>';
      }
      var temOpcoes = gruposDoProduto(p.id).length>0;
      return '<div class="product-card" data-action="produto-clicar" data-produto="'+p.id+'">'+
        (p.fotoUrl ? '<img class="thumb" src="'+escapeHtml(p.fotoUrl)+'" onerror="this.style.display=\'none\'">' : '')+
        '<div class="nome">'+escapeHtml(p.nome)+(temOpcoes?' <span style="color:var(--text-muted); font-size:9.5px;">(opções)</span>':'')+'</div><div class="preco">'+brl(p.precoCentavos)+'</div></div>';
    }).join("")+'</div>';

  var orderPanel = '<div class="order-panel">'+
      '<div><div class="order-panel-title">Novo pedido — '+rotuloComanda(comanda, mesa)+'</div>'+
      (podeLancar ? '<div style="margin-top:10px;">'+draftHtml+'</div>' : '')+
      (podeLancar && draftCount>0 ? '<button class="btn btn-primary btn-lg btn-block" style="margin-top:8px;" data-action="pedido-revisar-abrir">'+icon("check",16)+' Revisar e enviar ('+draftCount+')</button>' : '')+
      '</div>'+
      '<div><div class="order-panel-title" style="margin-bottom:8px;">Itens da comanda</div>'+sentItemsHtml+'</div>'+
      '<div class="totais-box">'+
        '<div class="totais-linha"><span>Subtotal</span><span>'+brl(t.subtotal)+'</span></div>'+
        (t.desconto>0 ? '<div class="totais-linha"><span>Desconto</span><span>-'+brl(t.desconto)+'</span></div>' : '')+
        '<div class="totais-linha"><span>Taxa de serviço ('+t.taxaPct+'%)</span><span>'+brl(t.taxa)+'</span></div>'+
        (t.taxaEntrega>0 ? '<div class="totais-linha"><span>Taxa de entrega</span><span>'+brl(t.taxaEntrega)+'</span></div>' : '')+
        '<div class="totais-linha total"><span>Total</span><span>'+brl(t.total)+'</span></div>'+
      '</div>'+
      '<div class="action-row">'+
        // idem: desconto acima do limite (ou sem a permissão) pede PIN de
        // supervisor pelo RPC aplicar_desconto; dentro do limite e com a
        // permissão, aplica direto — mesma regra de negócio de antes.
        (can(PERM.COMANDA_ABRIR) && comanda.status==="ABERTA" ? '<button class="btn" data-action="desconto-abrir">Desconto</button>' : '')+
        '<label class="btn" style="cursor:pointer;"><input type="checkbox" data-action="toggle-taxa" '+(comanda.taxaServicoAtiva?"checked":"")+' style="margin-right:6px;">Taxa</label>'+
      '</div>'+
      (podeLancar && comanda.tipo==="MESA" ? '<div class="action-row" style="align-items:center;">'+
        '<input type="number" min="0" step="1" placeholder="Nº pessoas" value="'+(comanda.pessoas||"")+'" style="width:100px;" data-action="comanda-pessoas" data-comanda="'+comanda.id+'">'+
        (state.config.produtoCouvertId && comanda.pessoas>0 ? '<button class="btn btn-sm" data-action="comanda-couvert-adicionar" data-comanda="'+comanda.id+'">'+icon("plus",14)+' Couvert ('+comanda.pessoas+')</button>' : '')+
      '</div>' : '')+
      (can(PERM.COMANDA_TRANSFERIR) && comanda.status==="ABERTA" ? '<div class="action-row">'+
        (comanda.tipo==="MESA" ? '<button class="btn" data-action="comanda-transferir-mesa-abrir" data-comanda="'+comanda.id+'">'+icon("arrowLeft",15)+' Transferir mesa</button>' : '')+
        '<button class="btn" data-action="comanda-juntar-abrir" data-comanda="'+comanda.id+'">'+icon("plus",15)+' Juntar com outra mesa</button>'+
      '</div>' : '')+
      (podeFechar ? '<button class="btn btn-danger btn-lg btn-block" data-action="fechar-conta-abrir">Fechar conta · '+brl(totaisNaoPagos(comanda).total)+'</button>' : '')+
      (podeCancelarComanda ? '<button class="btn btn-ghost btn-block" data-action="comanda-cancelar-confirmar" data-comanda="'+comanda.id+'" style="margin-top:8px; color:var(--danger); border-color:var(--danger);">'+icon("x",15)+' Cancelar comanda (mesa aberta por engano)</button>' : '')+
      (podeReabrir ? '<div class="alert-row danger" style="margin-top:8px;">'+icon("alert",16)+
        '<div style="flex:1;"><span class="t">PAGAMENTO TRAVADO</span><span class="d">Em fechamento há '+fmtMin(minutosDesde(comanda.updatedAt))+' sem concluir.</span></div>'+
        '<button class="btn btn-sm" data-action="comanda-reabrir-travada" data-comanda="'+comanda.id+'">Reabrir</button>'+
      '</div>' : '')+
    '</div>';

  return '<div class="comanda-head">'+
      '<div><div class="titulo">'+rotuloComanda(comanda, mesa).toUpperCase()+' <span style="color:var(--text-muted); font-size:14px;">· '+comanda.codigo+'</span></div>'+
      '<div class="sub">Aberta há '+fmtMin(minutosDesde(comanda.abertura))+' · '+comanda.status+'</div></div>'+
      '<button class="btn btn-ghost" data-action="nav-goto" data-view="salao">'+icon("arrowLeft",16)+' Salão</button>'+
    '</div>'+
    (itensProntos.length ? '<div class="alert-row">'+icon("check",16)+
      '<div><span class="t">PRONTO PARA SERVIR</span><span class="d">'+
      itensProntos.map(function(it){ return it.quantidade+'x '+escapeHtml(it.nome); }).join(" · ")+
      '</span></div></div>' : '')+
    (comanda._pendingSync ? '<div class="alert-row">'+icon("wifiOff",16)+
      '<div><span class="t">FECHADA OFFLINE</span><span class="d">Pagamento guardado localmente, sincroniza sozinho quando a conexão voltar.</span></div></div>' : '')+
    (comanda.tipo==="DELIVERY" ? '<div class="card" style="margin-bottom:14px;">'+
      '<div class="card-title">Entrega</div>'+
      '<p style="font-size:13px; color:var(--text-secondary); margin:0 0 10px;">'+escapeHtml(comanda.enderecoEntrega)+'</p>'+
      (comanda.agendadoPara ? '<p style="font-size:12px; color:var(--text-muted); margin:0 0 10px;">Agendado para '+new Date(comanda.agendadoPara).toLocaleString("pt-BR")+'</p>' : '')+
      '<div style="display:flex; align-items:center; gap:10px;">'+
        '<span class="badge '+(comanda.statusEntregador==="ENTREGUE"?"badge-status-ok":(comanda.statusEntregador==="SAIU_PARA_ENTREGA"?"badge-status-atencao":""))+'">'+(comanda.statusEntregador||"PENDENTE")+'</span>'+
        (PROXIMO_STATUS_ENTREGADOR[comanda.statusEntregador] ? '<button class="btn btn-sm" data-action="comanda-entregador-avancar" data-comanda="'+comanda.id+'">Avançar pra '+PROXIMO_STATUS_ENTREGADOR[comanda.statusEntregador]+'</button>' : '')+
      '</div></div>' : '')+
    '<div class="split '+(state.draft.mobileCatalog?"mobile-catalog":"")+'">'+
      '<div class="split-main">'+catalogHtml+'</div>'+
      '<div class="split-side">'+orderPanel+'</div>'+
    '</div>'+
    (podeLancar ? '<button class="fab" data-action="toggle-mobile-catalog">'+icon(state.draft.mobileCatalog?"check":"plus",24)+'</button>' : '');
}

// PRIORIDADE 2 — Cozinha ganhou sub-abas (mesmo componente da 0.11):
// KDS (o kanban de sempre) e Produção (checklist de pré-preparo). O
// botão de som fica no cabeçalho de fora porque vale pras duas abas.
function renderKds(){
  return renderPageHeader("chef", "Cozinha", "Kanban da cozinha e pré-preparo do dia",
      '<button class="btn '+(state.kdsSomAtivo?"btn-primary":"")+'" data-action="kds-som-toggle">'+icon("bell",15)+' '+(state.kdsSomAtivo?"Som ativado":"Ativar som")+'</button>')+
    renderSubAbas("kds");
}
function renderKdsConteudo(){
  var cols = [["PENDENTE","Pendente","INICIAR PREPARO"],["PREPARANDO","Preparando","MARCAR PRONTO"],["PRONTO","Pronto","ENTREGUE"]];
  var nextStatus = {PENDENTE:"PREPARANDO", PREPARANDO:"PRONTO", PRONTO:"ENTREGUE"};
  var setorFiltro = state.kdsSetorFiltro || "TODOS";
  var setorTabs = ["TODOS"].concat(SETORES_PRODUCAO);
  var abertas = state.comandas.filter(function(c){ return c.status==="ABERTA" || c.status==="FECHANDO"; });
  var cards = {PENDENTE:[], PREPARANDO:[], PRONTO:[]};
  var cancelados = [];
  var cargaPorSetor = {};
  SETORES_PRODUCAO.forEach(function(s){ cargaPorSetor[s] = 0; });

  // fontes de itens pro KDS: comandas abertas (normal) + itens avulsos de
  // comandas já pagas hoje (balcão/ficha) que ainda não foram entregues —
  // ver carregarKdsItensHoje() em data.js (Fase 0.1).
  var fontes = abertas.map(function(c){
    var mesa = state.mesas.find(function(m){ return m.id===c.mesaId; });
    return {comandaId:c.id, codigo:c.codigo, rotulo:rotuloComanda(c, mesa), itens:c.itens};
  });
  var avulsosPorComanda = {};
  var ordemAvulsos = [];
  (state.kdsItensAvulsos||[]).forEach(function(it){
    var cid = it._comanda.id;
    if(!avulsosPorComanda[cid]){
      var mesaAvulsa = state.mesas.find(function(m){ return m.id===it._comanda.mesaId; });
      avulsosPorComanda[cid] = {comandaId:cid, codigo:it._comanda.codigo, rotulo:rotuloComanda(it._comanda, mesaAvulsa), itens:[]};
      ordemAvulsos.push(cid);
    }
    avulsosPorComanda[cid].itens.push(it);
  });
  fontes = fontes.concat(ordemAvulsos.map(function(cid){ return avulsosPorComanda[cid]; }));

  var atrasoPorSetor = state.config.atrasoPorSetor || {};
  function limiteAtraso(setor){ return atrasoPorSetor[setor]||10; }

  fontes.forEach(function(c){
    var rotulo = c.rotulo;
    c.itens.forEach(function(it){
      var setorItem = it.setorProducao||"COZINHA";
      if(cards[it.status] && cargaPorSetor[setorItem]!==undefined) cargaPorSetor[setorItem]++;
      if(setorFiltro!=="TODOS" && setorItem!==setorFiltro) return;
      if(cards[it.status]) cards[it.status].push({comandaId:c.comandaId, codigo:c.codigo, item:it, rotulo:rotulo});
      if(it.status==="CANCELADO" && it.canceladoAposPreparo) cancelados.push({comandaId:c.comandaId, codigo:c.codigo, item:it, rotulo:rotulo});
    });
  });
  var total = cards.PENDENTE.length+cards.PREPARANDO.length+cards.PRONTO.length;
  var todosAtivos = cards.PENDENTE.concat(cards.PREPARANDO).concat(cards.PRONTO);
  var maisAntigoMin = todosAtivos.length ? Math.max.apply(null, todosAtivos.map(function(c){ return minutosDesde(c.item.enviadoEm); })) : 0;
  var maxCarga = Math.max(1, Math.max.apply(null, SETORES_PRODUCAO.map(function(s){ return cargaPorSetor[s]; })));

  var kpisHtml = '<div class="metric-grid">'+
      '<div class="kpi-card"><div class="kpi-icon" style="background:rgba(239,68,68,.14); color:var(--danger);">'+icon("alert",20)+'</div><div class="kpi-body"><div class="kpi-label">Pendentes</div><div class="kpi-value">'+cards.PENDENTE.length+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon" style="background:rgba(245,176,20,.14); color:var(--warning);">'+icon("clock",20)+'</div><div class="kpi-body"><div class="kpi-label">Preparando</div><div class="kpi-value">'+cards.PREPARANDO.length+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon" style="background:rgba(34,197,94,.14); color:var(--success);">'+icon("check",20)+'</div><div class="kpi-body"><div class="kpi-label">Prontos</div><div class="kpi-value">'+cards.PRONTO.length+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("clock",20)+'</div><div class="kpi-body"><div class="kpi-label">Pedido mais antigo</div><div class="kpi-value">'+(todosAtivos.length?fmtMin(maisAntigoMin):"—")+'</div></div></div>'+
    '</div>';

  var cargaHtml = '<div class="card">'+
    '<div class="card-title">Carga por setor</div>'+
    SETORES_PRODUCAO.map(function(s){
      var n = cargaPorSetor[s]||0;
      var pct = Math.max(4, Math.round(n/maxCarga*100));
      return '<div style="margin-bottom:10px;">'+
        '<div style="display:flex; justify-content:space-between; font-size:11.5px; margin-bottom:4px;"><span style="color:'+SETOR_COR[s]+'; font-weight:700;">'+s+'</span><span style="color:var(--text-muted);">'+n+' item(ns)</span></div>'+
        '<div class="stock-bar"><div class="stock-bar-fill" style="width:'+pct+'%; background:'+SETOR_COR[s]+';"></div></div>'+
      '</div>';
    }).join("")+
  '</div>';

  var kanbanHtml = '<div class="kanban">'+
    cols.map(function(col){
      var status = col[0], lista = cards[status];
      var porComanda = {};
      var ordem = [];
      lista.forEach(function(c){
        if(!porComanda[c.comandaId]){ porComanda[c.comandaId] = {codigo:c.codigo, rotulo:c.rotulo, itens:[]}; ordem.push(c.comandaId); }
        porComanda[c.comandaId].itens.push(c.item);
      });
      // Fase 1.4 — mais antigo primeiro, pra cozinha trabalhar na ordem
      // de chegada em vez da ordem em que as comandas foram abertas.
      ordem.sort(function(a,b){
        var maxA = Math.max.apply(null, porComanda[a].itens.map(function(it){ return minutosDesde(it.enviadoEm); }));
        var maxB = Math.max.apply(null, porComanda[b].itens.map(function(it){ return minutosDesde(it.enviadoEm); }));
        return maxB - maxA;
      });
      return '<div class="kanban-col" data-status="'+status+'">'+
        '<div class="kanban-col-head"><span class="t">'+col[1]+'</span><span class="n">'+lista.length+'</span></div>'+
        (ordem.length ? ordem.map(function(comandaId){
          var ticket = porComanda[comandaId];
          var itensAtrasados = ticket.itens.filter(function(it){ return minutosDesde(it.enviadoEm) > limiteAtraso(it.setorProducao||"COZINHA"); });
          var minTicket = Math.max.apply(null, ticket.itens.map(function(it){ return minutosDesde(it.enviadoEm); }));
          var atrasoTicket = itensAtrasados.length>0;
          var idsTicket = ticket.itens.map(function(it){ return it.id; }).join(",");
          return '<div class="kanban-card col-'+status+'">'+
            '<div class="kanban-card-top"><span class="codigo">'+ticket.codigo+'</span><span class="tempo '+(atrasoTicket?"atraso":"")+'">'+icon("clock",11)+' '+fmtMin(minTicket)+'</span></div>'+
            '<div class="mesa">'+ticket.rotulo.toUpperCase()+'</div>'+
            ticket.itens.map(function(item){
              var min = minutosDesde(item.enviadoEm);
              var atraso = min > limiteAtraso(item.setorProducao||"COZINHA");
              var user = state.usuarios.find(function(u){ return u.id===item.usuarioId; });
              var setorItem = item.setorProducao||"COZINHA";
              return '<div class="kanban-item" draggable="true" data-comanda="'+comandaId+'" data-item="'+item.id+'">'+
                '<div class="produto">'+item.quantidade+'x '+escapeHtml(item.nome).toUpperCase()+' <span class="tempo '+(atraso?"atraso":"")+'" style="float:right;">'+fmtMin(min)+'</span></div>'+
                '<span class="badge" style="background:rgba(255,255,255,.08); color:'+SETOR_COR[setorItem]+'; margin-top:4px;">'+setorItem+'</span>'+
                ((item.opcoesSelecionadas&&item.opcoesSelecionadas.length)?'<div class="obs" style="font-weight:700;">'+item.opcoesSelecionadas.map(function(o){return escapeHtml(o.nome).toUpperCase();}).join(" + ")+'</div>':'')+
                (item.observacao?'<div class="obs">'+escapeHtml(item.observacao)+'</div>':'')+
                (item._pendingSync?'<div class="obs" style="color:var(--warning);">OFFLINE · sincronizando</div>':'')+
                (user?'<div class="garcom">Garçom: '+escapeHtml(user.nome)+'</div>':'')+
                (can(PERM.ITEM_STATUS) ? '<button class="btn '+(status==="PRONTO"?"btn-success":"btn-primary")+' btn-block btn-sm" style="margin-top:8px;" data-action="kds-set" data-comanda="'+comandaId+'" data-item="'+item.id+'" data-status="'+nextStatus[status]+'">'+col[2]+'</button>' : '')+
              '</div>';
            }).join("")+
            (can(PERM.ITEM_STATUS) && ticket.itens.length>1 ? '<button class="btn btn-ghost btn-block btn-sm" style="margin-top:8px;" data-action="kds-avancar-ticket" data-comanda="'+comandaId+'" data-itens="'+idsTicket+'" data-status="'+nextStatus[status]+'">'+col[2]+' · TICKET INTEIRO ('+ticket.itens.length+')</button>' : '')+
          '</div>';
        }).join("") : '<div class="empty-hint">Vazio</div>')+
      '</div>';
    }).join("")+
  '</div>';

  return '<div class="kds-grande">'+
    '<div class="section-label">'+total+' pedidos ativos</div>'+
    kpisHtml+
    '<div class="tabs">'+setorTabs.map(function(s){ return '<div class="chip '+(setorFiltro===s?"chip-active":"")+'" data-action="kds-filtro" data-f="'+s+'">'+(s==="TODOS"?"Todos":s)+'</div>'; }).join("")+'</div>'+
    (cancelados.length ? '<div class="alert-row danger">'+icon("alert",16)+'<div><span class="t">CANCELADO DEPOIS DE PRONTO/EM PREPARO — PARE</span><span class="d">'+
      cancelados.map(function(c){ return c.rotulo+' · '+c.item.quantidade+'x '+escapeHtml(c.item.nome); }).join(" · ")+
      '</span></div></div>' : '')+
    '<div style="margin-bottom:14px;">'+cargaHtml+'</div>'+
    kanbanHtml+
  '</div>';
}

// PRIORIDADE 2 — checklist de pré-preparo do dia: sugestão calculada no
// banco (média das últimas 4 semanas × ficha técnica, abrir_checklist_pre_preparo),
// "feito" grava quem e quando, e sub-receita (vinagrete, molho...) ganha
// botão "Produzir lote" — baixa os ingredientes e dá entrada de verdade.
function renderProducaoConteudo(){
  var c = state.preProducaoChecklist;
  var podeProduzir = can(PERM.ESTOQUE);
  var ajusteAtual = state.preProducaoAjustePct || 0;
  var cabecalho = '<div class="card" style="margin-bottom:14px;">'+
    '<div class="field" style="display:flex; align-items:flex-end; gap:10px; margin-bottom:0;">'+
      '<div style="flex:1;"><label>Ajuste pra hoje (feriado, evento...)</label>'+
        '<input id="producaoAjustePct" type="number" step="5" value="'+ajusteAtual+'" placeholder="0"> %</div>'+
      '<button class="btn btn-primary" data-action="producao-recalcular">Recalcular lista</button>'+
    '</div>'+
    '<p style="font-size:11px; color:var(--text-muted); margin:8px 0 0;">Só recalcula o que ainda não foi marcado feito — o que já foi feito hoje fica como está.</p>'+
  '</div>';

  if(!c) return cabecalho+'<div class="empty-hint">Carregando...</div>';
  if(!c.itens.length) return cabecalho+'<div class="empty-hint">Nenhum insumo com venda nas últimas 4 semanas pra sugerir pré-preparo hoje.</div>';

  return cabecalho+'<div class="card">'+
    c.itens.map(function(it){
      var feito = !!it.feitoEm;
      return '<div class="data-row">'+
        '<div class="main">'+
          '<div class="nome">'+escapeHtml(it.nome)+(it.ehSubReceita?' <span class="badge badge-status-info">Sub-receita</span>':'')+'</div>'+
          '<div class="sub">Sugestão: '+it.quantidadeSugerida+' '+escapeHtml(it.unidade)+(feito?' · feito por '+escapeHtml(it.feitoPorNome||"—"):'')+'</div>'+
        '</div>'+
        '<div class="acts">'+
          (it.ehSubReceita && podeProduzir ? '<button class="btn btn-sm" data-action="produzir-lote-abrir" data-insumo="'+it.insumoId+'" data-sugerido="'+it.quantidadeSugerida+'">Produzir lote</button>' : '')+
          '<button class="btn btn-sm '+(feito?"btn-success":"")+'" data-action="pre-preparo-marcar" data-checklist="'+it.id+'" data-feito="'+(!feito)+'">'+(feito?icon("check",14)+" Feito":"Marcar feito")+'</button>'+
        '</div>'+
      '</div>';
    }).join("")+
  '</div>';
}
// PRIORIDADE 6 — Expedição: agrupa os itens ativos de cada comanda por
// "tempo" (entrada/principal/sobremesa, campo da categoria) e só mostra
// o grupo quando pelo menos um item já está PRONTO — ou pra liberar
// (todos prontos) ou pra avisar que tem prato esfriando esperando o
// resto do mesmo tempo. "Liberar" é só um UPDATE em lote (mesmo padrão
// do "ticket inteiro" do KDS) — vira ENTREGUE e o aviso de mesa pronta
// (realtime) já existe, não precisou de nada novo pra isso.
function tempoDoItem(item){
  var p = state.produtos.find(function(x){ return x.id===item.produtoId; });
  return (p && p.tempo) || "PRINCIPAL";
}
function renderExpedicaoConteudo(){
  var abertas = state.comandas.filter(function(c){ return c.status==="ABERTA" || c.status==="FECHANDO"; });
  var grupos = {};
  abertas.forEach(function(c){
    var mesa = state.mesas.find(function(m){ return m.id===c.mesaId; });
    c.itens.forEach(function(it){
      if(it.status==="CANCELADO" || it.status==="ENTREGUE") return;
      var tempo = tempoDoItem(it);
      var chave = c.id+"|"+tempo;
      if(!grupos[chave]) grupos[chave] = {comandaId:c.id, rotulo:rotuloComanda(c,mesa), tempo:tempo, itens:[]};
      grupos[chave].itens.push(it);
    });
  });
  var lista = Object.keys(grupos).map(function(k){ return grupos[k]; }).filter(function(g){
    return g.itens.some(function(it){ return it.status==="PRONTO"; });
  });
  lista.sort(function(a,b){ return a.rotulo.localeCompare(b.rotulo); });

  if(!lista.length) return '<div class="empty-hint">Nenhum pedido pronto esperando expedição agora.</div>';

  return lista.map(function(g){
    var tudoPronto = g.itens.every(function(it){ return it.status==="PRONTO"; });
    var idsTodos = g.itens.map(function(it){ return it.id; }).join(",");
    return '<div class="card" style="margin-bottom:12px; '+(tudoPronto?'border-color:var(--success);':'')+'">'+
      '<div class="card-title"><span>'+escapeHtml(g.rotulo.toUpperCase())+' · '+g.tempo+'</span>'+
        (tudoPronto && can(PERM.ITEM_STATUS) ? '<button class="btn btn-sm btn-success" data-action="expedicao-liberar" data-comanda="'+g.comandaId+'" data-itens="'+idsTodos+'">'+icon("check",14)+' Liberar para o salão</button>' : '')+
      '</div>'+
      g.itens.map(function(it){
        var pronto = it.status==="PRONTO";
        var esperando = pronto ? fmtMin(minutosDesde(it.prontoEm||it.enviadoEm)) : null;
        return '<div class="data-row"><div class="main"><div class="nome">'+it.quantidade+'x '+escapeHtml(it.nome)+'</div>'+
          '<div class="sub">'+(pronto ? '<span style="color:var(--warning); font-weight:700;">Pronto há '+esperando+' — esperando o resto</span>' : 'Em preparo ('+it.status+')')+'</div></div>'+
          '<span class="badge '+(pronto?"badge-status-atencao":"badge-status-info")+'">'+it.status+'</span>'+
        '</div>';
      }).join("")+
    '</div>';
  }).join("");
}
SUB_ABAS.kds = [
  {id:"kds", rotulo:"KDS", permissao:PERM.KDS_VER, render:renderKdsConteudo},
  {id:"producao", rotulo:"Produção", permissao:PERM.KDS_VER, render:renderProducaoConteudo,
    carregar:function(){ carregarChecklistPreProducao(state.preProducaoAjustePct); },
    carregado:function(){ return !!state.preProducaoChecklist; }},
  {id:"expedicao", rotulo:"Expedição", permissao:PERM.KDS_VER, render:renderExpedicaoConteudo}
];

function renderCaixa(){
  if(!state.caixaSessao || state.caixaSessao.status==="FECHADA"){
    var ultima = state.caixaSessao;
    return renderPageHeader("wallet", "Caixa", "Nenhuma sessão aberta")+
      '<div class="card" style="max-width:420px;">'+
      (ultima ? '<div class="alert-row '+(ultima.diferencaCentavos?"danger":"")+'">'+icon("alert",16)+'<div><span class="t">ÚLTIMO FECHAMENTO</span><span class="d">Diferença de '+brl(ultima.diferencaCentavos||0)+'</span></div></div>' : '')+
      '<div class="field"><label>Nome deste terminal</label><input id="terminalNomeInput" value="'+escapeHtml(state.caixaTerminalNome)+'" placeholder="Ex: Terminal 1, Caixa Bar"></div>'+
      '<div class="field"><label>Saldo inicial (troco)</label><input type="number" id="saldoInicialInput" placeholder="0,00" min="0" step="0.01"></div>'+
      '<button class="btn btn-primary btn-lg btn-block" data-action="caixa-abrir-confirmar">Abrir caixa</button>'+
      (state.caixaSessoesHistorico.length ? '<button class="btn btn-block" style="margin-top:10px;" data-action="fechamento-imprimir" data-sessao="'+state.caixaSessoesHistorico[state.caixaSessoesHistorico.length-1].id+'">'+icon("book",15)+' Reimprimir último fechamento</button>' : '')+
      '</div>';
  }
  var s = state.caixaSessao;
  var esperadoDinheiro = saldoDinheiroEsperado();
  var porForma = totaisPorForma();
  var movs = movimentosDaSessao();
  var podeVerSaldoEsperado = ["ADMIN","GERENTE"].indexOf(usuarioAtual().papel)!==-1;
  var precisaSangria = podeVerSaldoEsperado && esperadoDinheiro > state.config.limiteAlertaSangriaCentavos;
  return renderPageHeader("wallet", "Caixa", s.terminal)+
    '<div class="card caixa-status-card">'+
      '<div class="left"><div class="t"><span class="status-dot" style="display:inline-block; margin-right:6px;"></span>ABERTO</div>'+
      '<div class="d">Desde '+new Date(s.aberturaEm).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})+' · '+escapeHtml(usuarioAtual().nome)+'</div></div>'+
    '</div>'+
    (precisaSangria ? '<div class="alert-row danger">'+icon("alert",16)+'<div><span class="t">FAÇA UMA SANGRIA</span><span class="d">Dinheiro em gaveta passou de '+brl(state.config.limiteAlertaSangriaCentavos)+'</span></div></div>' : '')+
    '<div class="metric-grid">'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("wallet",20)+'</div><div class="kpi-body"><div class="kpi-label">Dinheiro em gaveta</div><div class="kpi-value">'+(podeVerSaldoEsperado ? brl(esperadoDinheiro) : '••••••')+'</div>'+
      (podeVerSaldoEsperado ? '' : '<div class="kpi-caption">Oculto · conferência cega</div>')+
      '</div></div>'+
      Object.keys(porForma).map(function(f){
        return '<div class="kpi-card"><div class="kpi-icon">'+icon("landmark",20)+'</div><div class="kpi-body"><div class="kpi-label">'+f+'</div><div class="kpi-value">'+brl(porForma[f])+'</div></div></div>';
      }).join("")+
    '</div>'+
    '<div class="action-row">'+
      (can(PERM.SANGRIA) ? '<button class="btn" data-action="caixa-mov-abrir" data-tipo="SANGRIA">'+icon("minus",15)+' Sangria</button>' : '')+
      (can(PERM.SUPRIMENTO) ? '<button class="btn" data-action="caixa-mov-abrir" data-tipo="SUPRIMENTO">'+icon("plus",15)+' Suprimento</button>' : '')+
      (can(PERM.CAIXA_FECHAR) ? '<button class="btn btn-danger" data-action="caixa-fechar-abrir">Conferência cega</button>' : '')+
    '</div>'+
    '<div class="shortcut-hint"><span><kbd>F8</kbd> Sangria</span><span><kbd>ESC</kbd> Fechar popup</span><span><kbd>ENTER</kbd> Confirmar</span></div>'+
    '<div class="section-label">Movimentos da sessão</div>'+
    '<div class="card"><div style="overflow-x:auto;"><table class="table-dark"><thead><tr><th>Tipo</th><th>Descrição</th><th>Horário</th><th style="text-align:right;">Valor</th></tr></thead><tbody>'+
    (movs.length ? movs.slice().reverse().map(function(m){
      return '<tr><td><span class="mov-tipo '+m.tipo+'">'+m.tipo+'</span></td>'+
        '<td>'+(m.motivo?escapeHtml(m.motivo):escapeHtml(m.formaPagamento))+'</td>'+
        '<td>'+new Date(m.createdAt).toLocaleTimeString("pt-BR")+'</td>'+
        '<td style="text-align:right; font-weight:700;">'+brl(m.valorCentavos)+'</td></tr>';
    }).join("") : '<tr><td colspan="4"><div class="empty-hint">Nenhum movimento ainda.</div></td></tr>')+
    '</tbody></table></div></div>';
}

function renderAuditoria(){
  var busca = (state.auditoriaBusca||"").trim().toLowerCase();
  var filtroUsuario = state.auditoriaFiltroUsuario || "TODOS";
  var filtroAcao = state.auditoriaFiltroAcao || "TODAS";

  var usuariosComEvento = {};
  var acoesDistintas = {};
  state.auditoria.forEach(function(a){
    if(a.usuarioId) usuariosComEvento[a.usuarioId] = true;
    acoesDistintas[a.acao] = true;
  });
  var opcoesUsuario = Object.keys(usuariosComEvento).map(function(id){
    return state.usuarios.find(function(u){ return u.id===id; });
  }).filter(Boolean).sort(function(a,b){ return a.nome<b.nome?-1:1; });
  var opcoesAcao = Object.keys(acoesDistintas).sort();

  var lista = state.auditoria.filter(function(a){
    if(filtroUsuario!=="TODOS" && a.usuarioId!==filtroUsuario) return false;
    if(filtroAcao!=="TODAS" && a.acao!==filtroAcao) return false;
    if(busca){
      var u = state.usuarios.find(function(x){ return x.id===a.usuarioId; });
      var texto = (a.acao+" "+a.entidade+" "+(a.motivo||"")+" "+(u?u.nome:"")).toLowerCase();
      if(texto.indexOf(busca)===-1) return false;
    }
    return true;
  });

  return renderPageHeader("alert", "Auditoria", lista.length+" de "+state.auditoria.length+" eventos")+
    '<div class="filter-row">'+
      '<div class="search-box" style="flex:1; min-width:220px; margin-bottom:0;">'+icon("search",16)+
        '<input id="auditoriaBuscaInput" placeholder="Buscar por usuário, ação ou motivo..." value="'+escapeHtml(state.auditoriaBusca||"")+'" data-action="auditoria-busca">'+
      '</div>'+
      '<div class="field"><select data-action="auditoria-filtro-usuario">'+
        '<option value="TODOS">Todos os usuários</option>'+
        opcoesUsuario.map(function(u){ return '<option value="'+u.id+'" '+(filtroUsuario===u.id?"selected":"")+'>'+escapeHtml(u.nome)+'</option>'; }).join("")+
      '</select></div>'+
      '<div class="field"><select data-action="auditoria-filtro-acao">'+
        '<option value="TODAS">Todas as ações</option>'+
        opcoesAcao.map(function(a){ return '<option value="'+a+'" '+(filtroAcao===a?"selected":"")+'>'+a+'</option>'; }).join("")+
      '</select></div>'+
    '</div>'+
    '<div class="card"><div style="overflow-x:auto;"><table class="table-dark"><thead><tr>'+
      '<th>Data/hora</th><th>Usuário</th><th>Entidade</th><th>Ação</th><th>Descrição/Motivo</th><th>Criticidade</th>'+
    '</tr></thead><tbody>'+
    (lista.length ? lista.map(function(a){
      var u = state.usuarios.find(function(x){ return x.id===a.usuarioId; });
      var crit = criticidadeDe(a.acao);
      return '<tr>'+
        '<td>'+new Date(a.createdAt).toLocaleString("pt-BR")+'</td>'+
        '<td><div style="display:flex; align-items:center; gap:8px;">'+
          '<div class="avatar-sm">'+(u?escapeHtml(u.nome.charAt(0)):"?")+'</div>'+
          '<div><div style="font-weight:600;">'+(u?escapeHtml(u.nome):"—")+'</div>'+
          (u?'<div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">'+u.papel+'</div>':'')+'</div>'+
        '</div></td>'+
        '<td>'+escapeHtml(a.entidade)+'</td>'+
        '<td>'+escapeHtml(a.acao)+'</td>'+
        '<td>'+(a.motivo?escapeHtml(a.motivo):'<span style="color:var(--text-muted);">—</span>')+'</td>'+
        '<td><span class="badge '+CRITICIDADE_CLS[crit]+'">'+crit+'</span></td>'+
      '</tr>';
    }).join("") : '<tr><td colspan="6"><div class="empty-hint">Nenhum evento encontrado.</div></td></tr>')+
    '</tbody></table></div></div>';
}

function renderCardapio(){
  var podeEditar = can(PERM.CARDAPIO);
  var filtro = state.cardapioFiltro || "Todos";
  var tabs = ["Todos"].concat(state.categorias);
  var lista = state.produtos.filter(function(p){ return filtro==="Todos" || p.categoria===filtro; });
  var ativos = state.produtos.filter(function(p){ return p.ativo; }).length;
  var esgotados = state.produtos.filter(function(p){ return p.esgotado; }).length;
  var semFoto = state.produtos.filter(function(p){ return !p.fotoUrl; }).length;
  return renderPageHeader("book", "Cardápio", state.produtos.length+" produtos · "+state.categorias.length+" categorias",
      (podeEditar ? '<button class="btn btn-primary" data-action="produto-novo">'+icon("plus",15)+' Novo produto</button>' : ''))+
    '<div class="metric-grid">'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("book",20)+'</div><div class="kpi-body"><div class="kpi-label">Produtos ativos</div><div class="kpi-value">'+ativos+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon" style="background:rgba(239,68,68,.14); color:var(--danger);">'+icon("alert",20)+'</div><div class="kpi-body"><div class="kpi-label">Esgotados</div><div class="kpi-value">'+esgotados+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("grid",20)+'</div><div class="kpi-body"><div class="kpi-label">Categorias</div><div class="kpi-value">'+state.categorias.length+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("image",20)+'</div><div class="kpi-body"><div class="kpi-label">Sem foto</div><div class="kpi-value">'+semFoto+'</div></div></div>'+
    '</div>'+
    '<div class="tabs">'+tabs.map(function(c){ return '<div class="tab '+(filtro===c?"active":"")+'" data-action="cardapio-filtro" data-f="'+escapeHtml(c)+'">'+escapeHtml(c)+'</div>'; }).join("")+'</div>'+
    '<div class="card">'+
    (lista.length ? lista.map(function(p){
      return '<div class="data-row">'+
        (p.fotoUrl ? '<img class="produto-thumb" src="'+escapeHtml(p.fotoUrl)+'" onerror="this.style.display=\'none\'">' : '')+
        '<div class="main"><div class="nome">'+escapeHtml(p.nome)+(p.esgotado?' <span class="badge badge-esgotado">Esgotado</span>':'')+(!p.ativo?' <span class="badge badge-inativo">Inativo</span>':'')+'</div>'+
        '<div class="sub">'+escapeHtml(p.categoria)+' · '+p.setorProducao+'</div></div>'+
        '<div class="num">'+brl(p.precoCentavos)+'</div>'+
        (podeEditar ? '<div class="acts">'+
          '<button class="btn btn-sm" data-action="produto-esgotar" data-produto="'+p.id+'">'+(p.esgotado?"Reativar":"Esgotar")+'</button>'+
          '<button class="btn btn-sm" data-action="opcoesproduto-abrir" data-produto="'+p.id+'">Opções</button>'+
          '<button class="icon-btn" data-action="produto-editar" data-produto="'+p.id+'">'+icon("edit",15)+'</button>'+
        '</div>' : '')+
      '</div>';
    }).join("") : '<div class="empty-hint">Nenhum produto nesta categoria.</div>')+
    '</div>';
}

// ---------- QR Codes das mesas ----------
// Link do cardápio público por mesa (mesmo formato do rewrite /cardapio/:slug
// em vercel.json) — gerado e desenhado só no navegador, nunca chamando
// nenhum serviço externo de QR (sem terceiros, conforme decidido na Fase 3).
// 0.6 — o token (mesas.qr_token) vai na URL pra impedir trocar o número
// da mesa e abrir pedido em outra (ver criar_pedido_qr, 0064). Link sem
// token (QR impresso antes desta fase) ainda é aceito dentro da carência
// configurada em config.aceitarQrSemTokenAte.
function urlQrMesa(mesa){
  return window.location.origin + "/cardapio/" + encodeURIComponent(state.restauranteSlug||"") + "?mesa=" + mesa.numero + "&t=" + mesa.qrToken;
}
function renderQrCodes(){
  var mesas = state.mesas.slice().sort(function(a,b){ return a.numero-b.numero; });
  var podeRotacionar = can(PERM.CARDAPIO);
  var carenciaAte = state.config.aceitarQrSemTokenAte;
  var carenciaAtiva = carenciaAte && carenciaAte>=diasA(0);
  return renderPageHeader("qrcode", "QR Codes das Mesas", mesas.length+" mesas — o cliente aponta a câmera e já cai pedindo direto naquela mesa",
      (mesas.length ? '<button class="btn btn-primary" data-action="qrcodes-imprimir-todas">'+icon("qrcode",15)+' Imprimir todas</button>' : ''))+
    (carenciaAtiva ? '<div class="alert-row" style="margin-bottom:14px;">'+icon("alert",16)+'<div><span class="t">QR CODES ANTIGOS AINDA VALEM</span><span class="d">'+
      'Links impressos antes da '+new Date(carenciaAte).toLocaleDateString("pt-BR")+' sem o token novo ainda funcionam até lá — depois disso, reimprima todos (botão abaixo gera um QR novo por mesa).'+
      '</span></div></div>' : '')+
    (mesas.length ? '<div class="qr-grid">'+
      mesas.map(function(m){
        return '<div class="qr-card">'+
          '<div class="qr-card-titulo">Mesa '+m.numero+'</div>'+
          '<div class="qr-card-sub">'+escapeHtml(m.area||"")+'</div>'+
          '<canvas id="qrCanvas-'+m.id+'" width="160" height="160"></canvas>'+
          '<div class="qr-card-link">'+escapeHtml(urlQrMesa(m))+'</div>'+
          '<div class="qr-card-acts">'+
            '<button class="btn btn-sm" data-action="qrcode-imprimir" data-mesa="'+m.id+'">'+icon("edit",13)+' Imprimir</button>'+
            '<button class="btn btn-sm" data-action="qrcode-baixar" data-mesa="'+m.id+'">'+icon("image",13)+' Baixar PNG</button>'+
            (podeRotacionar ? '<button class="btn btn-sm" data-action="qrcode-rotacionar" data-mesa="'+m.id+'" title="Invalida o QR impresso hoje e gera um novo">'+icon("alert",13)+' Gerar novo QR</button>' : '')+
          '</div>'+
        '</div>';
      }).join("")+
    '</div>' : '<div class="empty-hint">Nenhuma mesa cadastrada ainda — cadastre mesas em Configurações.</div>');
}
// Desenha os QR Codes nos <canvas> já no DOM — chamado depois de render()
// trocar o innerHTML (0062), nunca durante a montagem da string de HTML.
function desenharQrCodes(){
  if(typeof QRCode==="undefined") return;
  state.mesas.forEach(function(m){
    var canvas = document.getElementById("qrCanvas-"+m.id);
    if(!canvas) return;
    QRCode.toCanvas(canvas, urlQrMesa(m), {width:160, margin:1, color:{dark:"#0b0f14", light:"#ffffff"}}, function(err){
      if(err) console.error("Falha ao desenhar QR Code", err);
    });
  });
}

// ---------- Marketing: cupons, clientes inativos, banner do cardápio ----------

function statusCupom(c){
  var hoje = diasA(0);
  if(!c.ativo) return {lbl:"Inativo", cls:"badge-inativo"};
  if(c.validoAte && c.validoAte<hoje) return {lbl:"Expirado", cls:"badge-esgotado"};
  if(c.validoDe && c.validoDe>hoje) return {lbl:"Agendado", cls:"badge-status-atencao"};
  if(c.usosMax && c.usosAtuais>=c.usosMax) return {lbl:"Esgotado", cls:"badge-esgotado"};
  return {lbl:"Ativo", cls:"badge-status-ok"};
}
function renderMarketingCupons(podeEditar){
  return (podeEditar ? '<div class="action-row" style="justify-content:flex-end; margin-bottom:12px;">'+
      '<button class="btn btn-primary" data-action="cupom-novo">'+icon("plus",15)+' Novo cupom</button></div>' : '')+
    '<div class="card">'+
    (state.cupons.length ? state.cupons.map(function(c){
      var st = statusCupom(c);
      var valorTxt = c.tipo==="PERCENTUAL" ? c.valor+"%" : brl(c.valor);
      var usosTxt = c.usosMax ? (c.usosAtuais+"/"+c.usosMax+" usos") : (c.usosAtuais+" usos");
      return '<div class="data-row">'+
        '<div class="main"><div class="nome">'+escapeHtml(c.codigo)+' <span class="badge '+st.cls+'">'+st.lbl+'</span></div>'+
        '<div class="sub">'+valorTxt+' de desconto'+(c.validoAte?' · até '+new Date(c.validoAte+"T00:00:00").toLocaleDateString("pt-BR"):'')+' · '+usosTxt+'</div></div>'+
        (podeEditar ? '<div class="acts">'+
          '<button class="btn btn-sm" data-action="cupom-alternar-ativo" data-cupom="'+c.id+'">'+(c.ativo?"Desativar":"Ativar")+'</button>'+
        '</div>' : '')+
      '</div>';
    }).join("") : '<div class="empty-hint">Nenhum cupom cadastrado ainda.</div>')+
    '</div>';
}
function renderMarketingInativos(){
  var r = state.clientesInativosResultado;
  return '<div class="action-row" style="align-items:flex-end; margin-bottom:12px;">'+
      '<div class="field" style="margin:0;"><label>Sem comprar há (dias)</label>'+
        '<input id="inativosDias" type="number" min="1" value="'+state.clientesInativosDias+'" style="width:110px;"></div>'+
      '<button class="btn btn-primary" data-action="clientes-inativos-buscar">'+icon("search",15)+' Buscar</button>'+
    '</div>'+
    (state.clientesInativosCarregando ? '<div class="empty-hint">Buscando...</div>' :
      !r ? '<div class="empty-hint">Escolha o período e clique em Buscar.</div>' :
      !r.length ? '<div class="empty-hint">Nenhum cliente inativo nesse período.</div>' :
      '<div class="card">'+r.map(function(c){
        return '<div class="data-row">'+
          '<div class="main"><div class="nome">'+escapeHtml(c.nome)+'</div>'+
          '<div class="sub">'+(c.telefone?escapeHtml(c.telefone)+' · ':'')+(c.ultima_compra ? (c.dias_sem_comprar+' dias sem comprar') : 'nunca comprou')+'</div></div>'+
          '<div class="num">'+(c.pontos_fidelidade||0)+' pts</div>'+
        (c.telefone ? '<a class="btn btn-sm" href="'+linkWhatsapp(c.telefone, "Olá "+c.nome+"! Faz tempo que você não vem aqui no "+(state.config.empresaNome||"nosso restaurante")+", sentimos sua falta! Esperamos te ver em breve.")+'" target="_blank" rel="noopener">'+icon("check",14)+' WhatsApp</a>' : '')+
        '</div>';
      }).join("")+'</div>');
}
// PRIORIDADE 9 — Campanhas: listas que o banco já filtra sozinho (quem
// faz aniversário hoje, quem tem reserva confirmada hoje) com um botão
// wa.me pronto pra cada um — nenhum envio automático de verdade, sempre
// um clique humano (mesma régua do wa.me de Reservas, 0073).
function renderMarketingCampanhas(){
  var c = state.campanhasHoje;
  if(state.campanhasCarregando) return '<div class="empty-hint">Carregando...</div>';
  if(!c) return '<div class="empty-hint">Carregando...</div>';
  var empresaNome = state.config.empresaNome || "nosso restaurante";
  var blocoAniversario = '<div class="section-label">Aniversariantes de hoje</div>'+
    '<div class="card" style="margin-bottom:14px;">'+
    (c.aniversariantes.length ? c.aniversariantes.map(function(a){
      var msg = "Olá "+a.nome+"! A equipe do "+empresaNome+" deseja um feliz aniversário! Venha comemorar com a gente.";
      return '<div class="data-row"><div class="main"><div class="nome">'+escapeHtml(a.nome)+'</div>'+
        '<div class="sub">'+(a.pontos_fidelidade?a.pontos_fidelidade+' ponto(s)':'')+'</div></div>'+
        '<a class="btn btn-sm" href="'+linkWhatsapp(a.telefone, msg)+'" target="_blank" rel="noopener">'+icon("check",14)+' WhatsApp</a>'+
      '</div>';
    }).join("") : '<div class="empty-hint">Ninguém faz aniversário hoje.</div>')+
    '</div>';
  var blocoReservas = '<div class="section-label">Reservas confirmadas de hoje</div>'+
    '<div class="card">'+
    (c.reservas_confirmadas.length ? c.reservas_confirmadas.map(function(r){
      var msg = "Olá "+r.nome+"! Só lembrando da sua reserva hoje às "+formatarHoraMin(new Date(r.data_hora))+" pra "+r.pessoas+" pessoa(s). Te esperamos!";
      return '<div class="data-row"><div class="main"><div class="nome">'+escapeHtml(r.nome)+' · '+r.pessoas+' pessoa(s)</div>'+
        '<div class="sub">'+formatarHoraMin(new Date(r.data_hora))+'</div></div>'+
        '<a class="btn btn-sm" href="'+linkWhatsapp(r.telefone, msg)+'" target="_blank" rel="noopener">'+icon("check",14)+' WhatsApp</a>'+
      '</div>';
    }).join("") : '<div class="empty-hint">Nenhuma reserva confirmada pra hoje.</div>')+
    '</div>';
  return blocoAniversario + blocoReservas;
}
function renderMarketingBanner(podeEditar){
  var mk = state.config.marketing || {bannerAtivo:false, bannerTexto:"", produtoDestaqueId:""};
  if(!podeEditar) return '<div class="empty-hint">Você não tem permissão pra editar o banner do cardápio.</div>';
  return '<div class="card" style="max-width:520px;">'+
    '<label style="display:flex; align-items:center; gap:8px; margin-bottom:14px;">'+
      '<input type="checkbox" id="mkBannerAtivo" '+(mk.bannerAtivo?"checked":"")+'>'+
      '<span>Mostrar banner no cardápio público</span>'+
    '</label>'+
    '<div class="field"><label>Texto do banner</label><textarea id="mkBannerTexto" placeholder="Ex: Happy Hour até 19h — chopp em dobro!">'+escapeHtml(mk.bannerTexto||"")+'</textarea></div>'+
    '<div class="field"><label>Produto em destaque (opcional)</label>'+
      '<select id="mkProdutoDestaque"><option value="">Nenhum</option>'+
      state.produtos.filter(function(p){ return p.ativo; }).map(function(p){
        return '<option value="'+p.id+'" '+(mk.produtoDestaqueId===p.id?"selected":"")+'>'+escapeHtml(p.nome)+'</option>';
      }).join("")+
      '</select></div>'+
    '<button class="btn btn-primary" data-action="marketing-banner-salvar">Salvar</button>'+
  '</div>';
}
// 0.11 — migrado pro componente genérico de sub-abas (renderSubAbas,
// render-shell.js). Nenhuma das três precisa de "carregar": cupons já
// vem em carregarTudo, inativos é busca manual (botão próprio), banner é
// config já carregada — "dado só busca ao abrir a aba" fica satisfeito
// trivialmente aqui.
SUB_ABAS.marketing = [
  {id:"campanhas", rotulo:"Campanhas", permissao:PERM.MARKETING, render:renderMarketingCampanhas,
    carregar:function(){ carregarCampanhasHoje(); },
    carregado:function(){ return !!state.campanhasHoje; }},
  {id:"cupons", rotulo:"Cupons", permissao:PERM.MARKETING, render:function(){ return renderMarketingCupons(can(PERM.MARKETING)); }},
  {id:"inativos", rotulo:"Clientes inativos", permissao:PERM.MARKETING, render:renderMarketingInativos},
  {id:"banner", rotulo:"Banner do cardápio", permissao:PERM.MARKETING, render:function(){ return renderMarketingBanner(can(PERM.MARKETING)); }}
];
function renderMarketing(){
  return renderPageHeader("megaphone", "Marketing", "Cupons, reativação de clientes e destaque no cardápio público")+
    renderSubAbas("marketing");
}

// 0.8 — [DECISÃO TOMADA] estoque pode ficar negativo (sem greatest(0,...)
// nas baixas) em vez de travar em zero — "Furo — investigar" é o selo
// visual que torna esse número negativo impossível de ignorar na tela,
// em vez de esconder a diferença como o travamento em zero fazia.
function estoqueStatus(i){
  if(i.estoqueAtual < 0) return {lbl:"Furo — investigar", cls:"badge-status-critico"};
  if(i.estoqueAtual < i.estoqueMinimo) return {lbl:"Crítico", cls:"badge-status-critico"};
  if(i.estoqueAtual <= i.estoqueMinimo*1.2) return {lbl:"Repor", cls:"badge-status-atencao"};
  return {lbl:"OK", cls:"badge-status-ok"};
}
// PRIORIDADE 3 — Estoque ganhou sub-abas (mesmo componente da 0.11):
// Estoque (de sempre) e Perdas (registro + relatório de desperdício).
function renderEstoque(){
  var podeEditar = can(PERM.ESTOQUE);
  var baixos = state.insumos.filter(function(i){ return i.estoqueAtual<i.estoqueMinimo; });
  return renderPageHeader("package", "Estoque", state.insumos.length+" insumos · "+baixos.length+" abaixo do mínimo",
      (podeEditar ? '<div class="action-row" style="flex:0 0 auto;">'+
        '<button class="btn" data-action="inventario-abrir">'+icon("edit",15)+' Fazer inventário</button>'+
        '<button class="btn btn-primary" data-action="insumo-mov-abrir" data-tipo="ENTRADA">'+icon("plus",15)+' Nova entrada</button>'+
      '</div>' : ''))+
    renderSubAbas("estoque");
}
function renderEstoqueConteudo(){
  var podeEditar = can(PERM.ESTOQUE);
  var baixos = state.insumos.filter(function(i){ return i.estoqueAtual<i.estoqueMinimo; });
  var furos = state.insumos.filter(function(i){ return i.estoqueAtual<0; });
  var valorEstoque = state.insumos.reduce(function(s,i){ return s + Math.round(i.estoqueAtual*i.custoMedioCentavos); },0);
  var hoje = diasA(0);
  var emSeteDias = diasA(7);
  var vencendo = state.insumos.filter(function(i){ return i.validade && i.validade<=emSeteDias; });
  return '<div class="metric-grid">'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("package",20)+'</div><div class="kpi-body"><div class="kpi-label">Insumos cadastrados</div><div class="kpi-value">'+state.insumos.length+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon" style="background:rgba(239,68,68,.14); color:var(--danger);">'+icon("alert",20)+'</div><div class="kpi-body"><div class="kpi-label">Abaixo do mínimo</div><div class="kpi-value">'+baixos.length+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("wallet",20)+'</div><div class="kpi-body"><div class="kpi-label">Valor em estoque</div><div class="kpi-value">'+brl(valorEstoque)+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("clock",20)+'</div><div class="kpi-body"><div class="kpi-label">Movimentos recentes</div><div class="kpi-value">'+state.estoqueMovimentos.length+'</div></div></div>'+
    '</div>'+
    (furos.length ? '<div class="alert-row danger">'+icon("alert",16)+'<div style="flex:1;"><span class="t">FURO NO ESTOQUE — INVESTIGAR</span><span class="d">'+
      furos.map(function(i){ return escapeHtml(i.nome)+' ('+i.estoqueAtual+' '+i.unidade+')'; }).join(" · ")+
      '</span></div></div>' : "")+
    (baixos.length ? '<div class="alert-row danger">'+icon("alert",16)+'<div style="flex:1;"><span class="t">ESTOQUE BAIXO</span><span class="d">'+
      baixos.map(function(i){ return escapeHtml(i.nome)+' ('+i.estoqueAtual+'/'+i.estoqueMinimo+' '+i.unidade+')'; }).join(" · ")+
      '</span></div>'+(podeEditar?'<button class="btn btn-sm" data-action="sugerir-pedido-compra">Sugerir pedido</button>':'')+'</div>' : "")+
    (vencendo.length ? vencendo.map(function(i){
      var venceu = i.validade<hoje;
      return '<div class="alert-row '+(venceu?"danger":"")+'">'+icon("alert",16)+'<div><span class="t">'+(venceu?"VENCIDO":"VENCE EM BREVE")+'</span><span class="d">'+escapeHtml(i.nome)+' — '+new Date(i.validade+"T00:00:00").toLocaleDateString("pt-BR")+'</span></div></div>';
    }).join("") : "")+
    '<div class="card"><div style="overflow-x:auto;"><table class="table-dark"><thead><tr><th>Produto</th><th>Quantidade</th><th>Unidade</th><th>Mínimo</th><th>Validade</th><th>Status</th>'+(podeEditar?'<th></th>':'')+'</tr></thead><tbody>'+
    state.insumos.map(function(i){
      var st = estoqueStatus(i);
      var rend = state.insumoRendimentos.find(function(r){ return r.insumoId===i.id; });
      return '<tr><td><div style="font-weight:700;">'+escapeHtml(i.nome)+(i.ehSubReceita?' <span class="badge badge-status-info">Sub-receita</span>':'')+'</div>'+
          '<div style="font-size:10.5px; color:var(--text-muted);">custo médio '+brl(i.custoMedioCentavos)+'/'+i.unidade+(rend ? ' · rendimento '+Math.round(rend.fator*100)+'%' : '')+'</div>'+
          (podeEditar ? '<label style="font-size:10.5px; color:var(--text-muted); display:flex; align-items:center; gap:5px; margin-top:4px; cursor:pointer;">'+
            '<input type="checkbox" data-action="insumo-sub-receita-toggle" data-insumo="'+i.id+'" '+(i.ehSubReceita?"checked":"")+'> produzida internamente (sub-receita)</label>' : '')+
          (podeEditar ? '<select style="font-size:10.5px; margin-top:4px; padding:2px 4px;" data-action="insumo-fornecedor-padrao" data-insumo="'+i.id+'">'+
            '<option value="">Sem fornecedor padrão</option>'+
            state.fornecedores.filter(function(f){ return f.ativo; }).map(function(f){ return '<option value="'+f.id+'" '+(i.fornecedorPadraoId===f.id?"selected":"")+'>'+escapeHtml(f.nome)+'</option>'; }).join("")+
          '</select>' : '')+
        '</td>'+
        '<td'+(i.estoqueAtual<0?' style="color:var(--danger); font-weight:800;"':'')+'>'+i.estoqueAtual+'</td><td>'+i.unidade+'</td><td>'+i.estoqueMinimo+'</td>'+
        '<td>'+(podeEditar ? '<input type="date" style="width:140px;" value="'+(i.validade||"")+'" data-action="insumo-validade" data-insumo="'+i.id+'">' : (i.validade?new Date(i.validade+"T00:00:00").toLocaleDateString("pt-BR"):"—"))+'</td>'+
        '<td><span class="badge '+st.cls+'">'+st.lbl+'</span></td>'+
        (podeEditar ? '<td><div class="acts">'+
          '<button class="btn btn-sm" data-action="insumo-mov-abrir" data-tipo="ENTRADA" data-insumo="'+i.id+'">Entrada</button>'+
          '<button class="btn btn-sm" data-action="insumo-mov-abrir" data-tipo="SAIDA" data-insumo="'+i.id+'">Saída</button>'+
          '<button class="btn btn-sm" data-action="rendimento-abrir" data-insumo="'+i.id+'">Rendimento</button>'+
          (i.ehSubReceita ? '<button class="btn btn-sm" data-action="receita-abrir" data-insumo="'+i.id+'">Receita</button>'+
            '<button class="btn btn-sm btn-primary" data-action="produzir-lote-abrir" data-insumo="'+i.id+'">Produzir lote</button>' : '')+
        '</div></td>' : '')+
      '</tr>';
    }).join("")+
    '</tbody></table></div></div>'+
    '<div class="section-label">Movimentações recentes</div>'+
    '<div class="card">'+(state.estoqueMovimentos.length ? state.estoqueMovimentos.slice().reverse().slice(0,20).map(function(m){
      var i = state.insumos.find(function(x){ return x.id===m.insumoId; });
      var cls = m.tipo==="ENTRADA" ? "ENTRADA" : "SAIDA";
      var sinal = (m.tipo==="ENTRADA" || (m.tipo==="AJUSTE" && m.motivo && m.motivo.indexOf("sobra")!==-1)) ? "+" : "-";
      return '<div class="mov-row"><span><span class="mov-tipo '+cls+'">'+(m.tipo==="VENDA"?"VENDA":m.tipo)+'</span>'+(i?escapeHtml(i.nome):"?")+(m.motivo?" — "+escapeHtml(m.motivo):"")+'<div class="tag">'+new Date(m.createdAt).toLocaleString("pt-BR")+'</div></span><span>'+sinal+m.quantidade+' '+(i?i.unidade:"")+'</span></div>';
    }).join("") : '<div class="empty-hint">Nenhuma movimentação ainda.</div>')+'</div>';
}

// PRIORIDADE 3 — Perdas e Desperdícios: registro manual (insumo ou prato,
// valor pelo custo médio/CMV calculado no servidor) + o que entra sozinho
// (cancelado após preparo, diferença de inventário) + relatório agregado
// no banco (relatorio_perdas) — nunca somado aqui no navegador.
var MOTIVO_PERDA_LABEL = {
  VENCEU:"Venceu", ESTRAGOU:"Estragou", QUEIMOU:"Queimou", CAIU:"Caiu", DEVOLVIDO:"Devolvido",
  ERRO_PEDIDO:"Erro de pedido", SOBRA:"Sobra",
  CANCELADO_APOS_PREPARO:"Cancelado após preparo", AJUSTE_INVENTARIO:"Perda não identificada (inventário)"
};
function renderPerdasConteudo(){
  var podeEditar = can(PERM.ESTOQUE);
  var periodo = state.perdasPeriodo || "HOJE";
  var periodos = [["HOJE","Hoje"],["7D","7 dias"],["30D","30 dias"],["MES","Escolher mês"]];
  var cabecalho = '<div class="tabs">'+periodos.map(function(p){ return '<div class="tab '+(periodo===p[0]?"active":"")+'" data-action="perdas-periodo" data-p="'+p[0]+'">'+p[1]+'</div>'; }).join("")+'</div>'+
    (periodo==="MES" ? '<div class="field" style="max-width:220px;"><input type="month" id="perdasMesInput" value="'+escapeHtml(state.perdasMes||"")+'" data-action="perdas-mes"></div>' : '')+
    (podeEditar ? '<div class="action-row"><button class="btn btn-primary" data-action="perda-abrir">'+icon("plus",15)+' Registrar perda</button></div>' : '');

  if(state.perdasCarregando || !state.perdasRelatorio){
    return cabecalho+'<div class="empty-hint">Carregando período...</div>';
  }
  var r = state.perdasRelatorio;
  var porMotivo = r.por_motivo||[];
  var porSemana = r.por_semana||[];
  var top5 = r.top5||[];
  var maxMotivo = porMotivo.length ? Math.max.apply(null, porMotivo.map(function(m){ return m.valor; })) : 0;
  var maxTop5 = top5.length ? top5[0].valor : 0;
  var maxSemana = porSemana.length ? Math.max.apply(null, porSemana.map(function(s){ return s.valor; })) : 1;

  return cabecalho+
    '<div class="metric-grid">'+
      '<div class="kpi-card"><div class="kpi-icon" style="background:rgba(239,68,68,.14); color:var(--danger);">'+icon("alert",20)+'</div><div class="kpi-body"><div class="kpi-label">Perdido no período</div><div class="kpi-value">'+brl(r.total_centavos)+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("chart",20)+'</div><div class="kpi-body"><div class="kpi-label">% do faturamento</div><div class="kpi-value">'+(r.pct_faturamento!=null?r.pct_faturamento+"%":"—")+'</div></div></div>'+
    '</div>'+
    '<div class="grid-2">'+
      '<div class="card"><div class="card-title">Top 5 — onde o dinheiro está sumindo</div>'+
        (top5.length ? top5.map(function(t){
          var pct = Math.max(4, Math.round(t.valor/maxTop5*100));
          return '<div class="ranking-row"><div class="main"><div class="nome">'+escapeHtml(t.nome)+'</div>'+
            '<div class="stock-bar" style="max-width:none;"><div class="stock-bar-fill" style="width:'+pct+'%; background:var(--danger);"></div></div></div>'+
            '<div class="num">'+brl(t.valor)+'</div></div>';
        }).join("") : '<div class="empty-hint">Nenhuma perda no período.</div>')+
      '</div>'+
      '<div class="card"><div class="card-title">Por motivo</div>'+
        (porMotivo.length ? porMotivo.map(function(m){
          var pct = Math.max(4, Math.round(m.valor/maxMotivo*100));
          return '<div class="ranking-row"><div class="main"><div class="nome">'+(MOTIVO_PERDA_LABEL[m.motivo]||m.motivo)+'</div><div class="sub">'+m.qtd+' registro(s)</div>'+
            '<div class="stock-bar" style="max-width:none;"><div class="stock-bar-fill" style="width:'+pct+'%; background:var(--warning);"></div></div></div>'+
            '<div class="num">'+brl(m.valor)+'</div></div>';
        }).join("") : '<div class="empty-hint">Nenhuma perda no período.</div>')+
      '</div>'+
    '</div>'+
    (porSemana.length ? '<div class="section-label">Por semana</div><div class="card">'+
      '<div class="chart-bars">'+porSemana.map(function(s){
        var pct = Math.max(2, Math.round(s.valor/maxSemana*100));
        return '<div class="chart-bar has" style="height:'+pct+'%" title="semana de '+new Date(s.semana+"T00:00:00").toLocaleDateString("pt-BR")+' · '+brl(s.valor)+'"></div>';
      }).join("")+'</div>'+
      '<div class="chart-labels">'+porSemana.map(function(s){ return '<span>'+new Date(s.semana+"T00:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})+'</span>'; }).join("")+'</div>'+
    '</div>' : '')+
    '<div class="section-label">Registros recentes</div>'+
    '<div class="card">'+(state.perdasLista.length ? state.perdasLista.map(function(p){
      var nome = p.tipo==="INSUMO" ? (state.insumos.find(function(i){ return i.id===p.insumoId; })||{}).nome : (state.produtos.find(function(x){ return x.id===p.produtoId; })||{}).nome;
      var responsavel = state.usuarios.find(function(u){ return u.id===p.usuarioId; });
      return '<div class="mov-row"><span><span class="mov-tipo SAIDA">'+(MOTIVO_PERDA_LABEL[p.motivo]||p.motivo)+'</span>'+escapeHtml(nome||"?")+
        '<div class="tag">'+p.quantidade+' · '+(responsavel?escapeHtml(responsavel.nome):"—")+' · '+new Date(p.createdAt).toLocaleString("pt-BR")+'</div></span>'+
        '<span>'+brl(p.valorCentavos)+'</span></div>';
    }).join("") : '<div class="empty-hint">Nenhuma perda registrada no período.</div>')+'</div>';
}
SUB_ABAS.estoque = [
  {id:"estoque", rotulo:"Estoque", permissao:PERM.ESTOQUE, render:renderEstoqueConteudo},
  {id:"perdas", rotulo:"Perdas", permissao:PERM.ESTOQUE, render:renderPerdasConteudo,
    carregar:function(){ carregarPerdas(state.perdasPeriodo||"HOJE"); },
    carregado:function(){ return !!state.perdasRelatorio; }}
];

// PRIORIDADE 4 — Compras ganhou 4 sub-abas (mesmo componente da 0.11):
// Lista de compras (sugestão automática), Pedidos (fornecedores + pedidos
// de compra, tela de sempre), Cotação (comparar até 3 fornecedores,
// preço digitado à mão) e Preços (histórico, alerta de aumento, pratos
// que perderam margem).
function renderCompras(){
  var podeEditar = can(PERM.ESTOQUE);
  return renderPageHeader("truck", "Compras", state.fornecedores.length+" fornecedores · "+state.pedidosCompra.length+" pedidos",
      (podeEditar ? '<div class="action-row" style="flex:0 0 auto;">'+
        '<button class="btn" data-action="fornecedor-novo">'+icon("plus",15)+' Fornecedor</button>'+
        (state.fornecedores.length ? '<button class="btn btn-primary" data-action="pedido-compra-novo">'+icon("plus",15)+' Pedido de compra</button>' : '')+
      '</div>' : ''))+
    renderSubAbas("compras");
}
var DIAS_SEMANA_ENTREGA = ["domingo","segunda","terça","quarta","quinta","sexta","sábado"];
function renderListaComprasConteudo(){
  if(state.listaComprasCarregando || !state.listaComprasSugerida) return '<div class="empty-hint">Carregando...</div>';
  var grupos = state.listaComprasSugerida;
  if(!grupos.length) return '<div class="empty-hint">Nenhum insumo precisando de compra agora, pelo consumo dos últimos 28 dias.</div>';
  return grupos.map(function(g, grupoIdx){
    var podeEditar = can(PERM.ESTOQUE);
    return '<div class="card" style="margin-bottom:14px;">'+
      '<div class="card-title">'+
        '<span>'+(g.fornecedor_nome ? escapeHtml(g.fornecedor_nome) : "Sem fornecedor definido")+
          (g.dia_entrega_semana!=null ? ' <span style="color:var(--text-muted); font-weight:400; text-transform:none;">· entrega '+DIAS_SEMANA_ENTREGA[g.dia_entrega_semana]+'</span>' : '')+
          (g.prazo_entrega_dias ? ' <span style="color:var(--text-muted); font-weight:400; text-transform:none;">· prazo '+g.prazo_entrega_dias+'d</span>' : '')+
        '</span>'+
        (podeEditar ? '<button class="btn btn-sm btn-primary" data-action="lista-compras-gerar-pedido" data-grupo-idx="'+grupoIdx+'">Criar pedido</button>' : '')+
      '</div>'+
      g.itens.map(function(it){
        return '<div class="data-row"><div class="main"><div class="nome">'+escapeHtml(it.nome)+'</div>'+
          '<div class="sub">estoque '+it.estoque_atual+' / mínimo '+it.estoque_minimo+' '+escapeHtml(it.unidade)+' · consumo previsto até a entrega: '+it.consumo_previsto+'</div></div>'+
          '<div class="num" style="font-weight:800;">'+it.quantidade_sugerida+' '+escapeHtml(it.unidade)+'</div></div>';
      }).join("")+
    '</div>';
  }).join("");
}
SUB_ABAS.compras = [
  {id:"lista", rotulo:"Lista de compras", permissao:PERM.ESTOQUE, render:renderListaComprasConteudo,
    carregar:function(){ carregarListaComprasSugerida(); },
    carregado:function(){ return !!state.listaComprasSugerida; }},
  {id:"pedidos", rotulo:"Pedidos", permissao:PERM.ESTOQUE, render:renderPedidosComprasConteudo},
  {id:"cotacao", rotulo:"Cotação", permissao:PERM.ESTOQUE, render:renderCotacaoConteudo},
  {id:"precos", rotulo:"Preços", permissao:PERM.ESTOQUE, render:renderPrecosConteudo,
    carregar:function(){ carregarRelatorioPrecos(); },
    carregado:function(){ return !!state.precosRelatorio; }}
];
function renderPedidosComprasConteudo(){
  var podeEditar = can(PERM.ESTOQUE);
  var statusLbl = {RASCUNHO:"Rascunho", PEDIDO_REALIZADO:"Pedido realizado", RECEBIDO:"Recebido"};
  var contagem = {RASCUNHO:0, PEDIDO_REALIZADO:0, RECEBIDO:0};
  state.pedidosCompra.forEach(function(p){ contagem[p.status] = (contagem[p.status]||0)+1; });
  return '<div class="metric-grid">'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("truck",20)+'</div><div class="kpi-body"><div class="kpi-label">Fornecedores</div><div class="kpi-value">'+state.fornecedores.length+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon" style="background:var(--surface-03); color:var(--text-muted);">'+icon("package",20)+'</div><div class="kpi-body"><div class="kpi-label">Em rascunho</div><div class="kpi-value">'+contagem.RASCUNHO+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon" style="background:rgba(245,176,20,.14); color:var(--warning);">'+icon("clock",20)+'</div><div class="kpi-body"><div class="kpi-label">Pedido realizado</div><div class="kpi-value">'+contagem.PEDIDO_REALIZADO+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon" style="background:rgba(34,197,94,.14); color:var(--success);">'+icon("check",20)+'</div><div class="kpi-body"><div class="kpi-label">Recebidos</div><div class="kpi-value">'+contagem.RECEBIDO+'</div></div></div>'+
    '</div>'+
    '<div class="section-label">Fornecedores</div>'+
    '<div class="card">'+
    (state.fornecedores.length ? state.fornecedores.map(function(f){
      return '<div class="data-row">'+
        '<div class="main"><div class="nome">'+escapeHtml(f.nome)+(!f.ativo?' <span class="badge badge-inativo">Inativo</span>':'')+'</div>'+
        '<div class="sub">'+(f.contato?escapeHtml(f.contato)+' · ':'')+escapeHtml(f.telefone||"")+
          (f.prazoEntregaDias?' · prazo '+f.prazoEntregaDias+'d':'')+(f.diaEntregaSemana!=null?' · entrega '+DIAS_SEMANA_ENTREGA[f.diaEntregaSemana]:'')+'</div></div>'+
        (podeEditar ? '<div class="acts">'+
          '<button class="btn btn-sm" data-action="fornecedor-editar" data-fornecedor="'+f.id+'">Editar</button>'+
          '<button class="btn btn-sm" data-action="fornecedor-toggle-ativo" data-fornecedor="'+f.id+'">'+(f.ativo?"Desativar":"Reativar")+'</button>'+
        '</div>' : '')+
      '</div>';
    }).join("") : '<div class="empty-hint">Nenhum fornecedor cadastrado.</div>')+
    '</div>'+
    '<div class="section-label">Pedidos de compra</div>'+
    '<div class="card">'+
    (state.pedidosCompra.length ? state.pedidosCompra.map(function(p){
      var forn = state.fornecedores.find(function(f){ return f.id===p.fornecedorId; });
      return '<div class="mov-row"><span><span class="mov-tipo '+p.status+'">'+statusLbl[p.status]+'</span>'+
          (forn?escapeHtml(forn.nome):"?")+' — '+p.itens.length+' item(ns)'+
          '<div class="tag">'+new Date(p.createdAt).toLocaleString("pt-BR")+'</div></span>'+
          (podeEditar ? '<span class="acts">'+
            (p.status==="RASCUNHO" ? '<button class="btn btn-sm" data-action="pedido-compra-marcar-realizado" data-pedido="'+p.id+'">Marcar realizado</button>' : '')+
            (p.status!=="RECEBIDO" ? '<button class="btn btn-sm btn-success" data-action="pedido-compra-receber" data-pedido="'+p.id+'">Receber</button>' : '')+
          '</span>' : '')+
        '</div>';
    }).join("") : '<div class="empty-hint">Nenhum pedido de compra ainda.</div>')+
    '</div>';
}

// PRIORIDADE 4 — Cotação: comparar até 3 fornecedores com preço digitado
// à mão (nenhum valor calculado aqui — é cotação manual de verdade),
// destaca o menor preço por linha, e "Gerar pedidos" cria um
// restaurante.criar_pedido_compra por fornecedor vencedor (0040, já
// existia) — sem tabela nem RPC novas só pra comparação.
function renderCotacaoConteudo(){
  var cot = state.cotacao;
  var fornecedoresAtivos = state.fornecedores.filter(function(f){ return f.ativo; });
  var selecionados = cot.fornecedorIds.map(function(id){ return state.fornecedores.find(function(f){ return f.id===id; }); }).filter(Boolean);

  var escolhaFornecedores = '<div class="card" style="margin-bottom:14px;">'+
    '<div class="card-title">Fornecedores a comparar (até 3)</div>'+
    (fornecedoresAtivos.length ? fornecedoresAtivos.map(function(f){
      var marcado = cot.fornecedorIds.indexOf(f.id)!==-1;
      return '<label style="display:flex; align-items:center; gap:8px; padding:6px 0; cursor:pointer;">'+
        '<input type="checkbox" data-action="cotacao-toggle-fornecedor" data-fornecedor="'+f.id+'" '+(marcado?"checked":"")+(!marcado&&cot.fornecedorIds.length>=3?"disabled":"")+'> '+escapeHtml(f.nome)+
      '</label>';
    }).join("") : '<div class="empty-hint">Cadastre fornecedores na aba Pedidos primeiro.</div>')+
  '</div>';

  if(!selecionados.length) return escolhaFornecedores+'<div class="empty-hint">Escolha pelo menos 1 fornecedor pra começar a cotação.</div>';

  var linhasHtml = cot.linhas.map(function(l, idx){
    var precosValidos = selecionados.map(function(f){ return l.precos[f.id]; }).filter(function(v){ return v>0; });
    var menor = precosValidos.length ? Math.min.apply(null, precosValidos) : null;
    return '<tr><td>'+
        '<select data-action="cotacao-linha-insumo" data-idx="'+idx+'">'+
          state.insumos.map(function(i){ return '<option value="'+i.id+'" '+(l.insumoId===i.id?"selected":"")+'>'+escapeHtml(i.nome)+' ('+i.unidade+')</option>'; }).join("")+
        '</select>'+
      '</td>'+
      '<td><input type="number" min="0" step="0.01" style="width:70px;" value="'+l.quantidade+'" data-action="cotacao-linha-qtd" data-idx="'+idx+'"></td>'+
      selecionados.map(function(f){
        var v = l.precos[f.id];
        var venceu = v>0 && v===menor;
        return '<td><input type="number" id="cotPreco-'+idx+'-'+f.id+'" min="0" step="0.01" style="'+(venceu?"border-color:var(--success); color:var(--success); font-weight:800;":"")+'" value="'+(v>0?(v/100).toFixed(2):"")+'" data-action="cotacao-linha-preco" data-idx="'+idx+'" data-fornecedor="'+f.id+'" placeholder="R$"></td>';
      }).join("")+
      '<td><button class="icon-btn" data-action="cotacao-linha-remover" data-idx="'+idx+'" style="color:var(--danger);">'+icon("x",14)+'</button></td>'+
    '</tr>';
  }).join("");

  return escolhaFornecedores+
    '<div class="action-row" style="margin-bottom:10px;">'+
      '<button class="btn btn-sm" data-action="cotacao-importar-lista">Importar da lista de compras</button>'+
    '</div>'+
    '<div class="card"><div style="overflow-x:auto;"><table class="table-dark"><thead><tr><th>Insumo</th><th>Qtd.</th>'+
      selecionados.map(function(f){ return '<th>'+escapeHtml(f.nome)+'</th>'; }).join("")+
      '<th></th></tr></thead><tbody>'+
      (linhasHtml || '<tr><td colspan="'+(selecionados.length+3)+'" class="empty-hint">Nenhum insumo adicionado ainda.</td></tr>')+
    '</tbody></table></div>'+
    '<button class="btn btn-sm" style="margin-top:10px;" data-action="cotacao-linha-adicionar">'+icon("plus",14)+' Adicionar insumo</button>'+
    '</div>'+
    (cot.linhas.length ? '<button class="btn btn-primary btn-lg" style="margin-top:14px;" data-action="cotacao-gerar-pedidos">Gerar pedidos com os preços vencedores</button>' : '');
}

function renderPrecosConteudo(){
  if(state.precosCarregando || !state.precosRelatorio) return '<div class="empty-hint">Carregando...</div>';
  var r = state.precosRelatorio;
  var insumos = r.insumos||[];
  if(!insumos.length) return '<div class="empty-hint">Ainda não há histórico de preço — recebimentos de pedido com preço informado alimentam este relatório.</div>';
  return '<p style="font-size:12px; color:var(--text-muted); margin:0 0 14px;">Alerta quando o preço sobe mais de '+r.limite_pct+'% do recebimento anterior pro mesmo recebimento seguinte (configurável em Configurações).</p>'+
    insumos.map(function(i){
      return '<div class="card" style="margin-bottom:10px;'+(i.alerta?' border-color:var(--danger);':'')+'">'+
        '<div class="data-row" style="padding:0;">'+
          '<div class="main"><div class="nome">'+escapeHtml(i.nome)+(i.alerta?' <span class="badge badge-status-critico">Subiu '+i.variacao_pct+'%</span>':'')+'</div>'+
            '<div class="sub">'+brl(i.preco_atual_centavos)+'/'+escapeHtml(i.unidade)+(i.preco_anterior_centavos!=null?' · era '+brl(i.preco_anterior_centavos):' · primeiro preço registrado')+' · '+new Date(i.data_atual).toLocaleDateString("pt-BR")+'</div></div>'+
        '</div>'+
        (i.alerta && (i.pratos_afetados||[]).length ? '<div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border);">'+
          '<div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:.5px; margin-bottom:6px;">Pratos que perderam margem</div>'+
          i.pratos_afetados.map(function(p){
            return '<div style="display:flex; justify-content:space-between; font-size:12px; padding:4px 0;">'+
              '<span>'+escapeHtml(p.nome)+'</span>'+
              '<span>margem agora '+brl(p.margem_atual_centavos)+' <span style="color:var(--danger);">(−'+brl(Math.abs(p.impacto_centavos))+'/unidade)</span></span>'+
            '</div>';
          }).join("")+
        '</div>' : '')+
      '</div>';
    }).join("");
}

function contaBucket(c, hoje, fimSemana){
  if(c.pagoEm) return "pago";
  if(c.vencimento<hoje) return "vencida";
  if(c.vencimento===hoje) return "hoje";
  if(c.vencimento<=fimSemana) return "semana";
  return "depois";
}
function renderResumoContas(titulo, iconName, cor, contasDoTipo, hoje, fimSemana){
  var buckets = {hoje:{n:0,v:0}, semana:{n:0,v:0}, depois:{n:0,v:0}, vencida:{n:0,v:0}};
  var totalAberto = 0;
  contasDoTipo.forEach(function(c){
    if(c.pagoEm) return;
    var b = contaBucket(c, hoje, fimSemana);
    if(buckets[b]){ buckets[b].n++; buckets[b].v += c.valorCentavos; }
    totalAberto += c.valorCentavos;
  });
  return '<div class="card">'+
    '<div class="card-title"><span style="display:flex; align-items:center; gap:8px;">'+icon(iconName,16)+titulo+'</span></div>'+
    '<div class="kpi-value" style="color:'+cor+'; margin-bottom:12px;">'+brl(totalAberto)+'</div>'+
    [["hoje","Vence hoje"],["semana","Esta semana"],["depois","Depois"],["vencida","Vencidas"]].map(function(b){
      var d = buckets[b[0]];
      return '<div style="display:flex; justify-content:space-between; font-size:12px; padding:6px 0; border-bottom:1px solid var(--border);">'+
        '<span style="color:'+(b[0]==="vencida"&&d.n?"var(--danger)":"var(--text-secondary)")+';">'+b[1]+'</span>'+
        '<span>'+d.n+' · '+brl(d.v)+'</span>'+
      '</div>';
    }).join("")+
  '</div>';
}
// PRIORIDADE 7 — Financeiro ganhou sub-abas (mesmo componente da 0.11):
// Resumo (nova, linguagem simples — "entrou/saiu/sobrou" do mês) e
// Contas (tela de sempre).
function renderFinanceiro(){
  var podeEditar = can(PERM.FINANCEIRO);
  return renderPageHeader("landmark", "Financeiro", "Resumo simples, contas a pagar e a receber",
      (podeEditar ? '<button class="btn btn-primary" data-action="conta-nova">'+icon("plus",15)+' Nova conta</button>' : ''))+
    renderSubAbas("financeiro");
}
function renderContasConteudo(){
  var podeEditar = can(PERM.FINANCEIRO);
  var filtro = state.financeiroFiltro || "TODAS";
  var tabs = [["TODAS","Todas"],["PAGAR","A pagar"],["RECEBER","A receber"]];
  var hoje = diasA(0);
  var fimSemana = diasA(7);
  var lista = state.contas.filter(function(c){ return filtro==="TODAS" || c.tipo===filtro; })
    .sort(function(a,b){ return a.vencimento<b.vencimento?-1:1; });
  var contasPagar = state.contas.filter(function(c){ return c.tipo==="PAGAR"; });
  var contasReceber = state.contas.filter(function(c){ return c.tipo==="RECEBER"; });

  return (can(PERM.FINANCEIRO) ? '<div class="card" style="margin-bottom:14px;"><div class="card-title">Exportar pro contador</div>'+
      '<div style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap;">'+
        '<div class="field" style="margin-bottom:0;"><label>Mês</label><input type="month" id="exportMesInput" value="'+hojeOperacionalStr().slice(0,7)+'"></div>'+
        '<button class="btn" data-action="exportar-contador">'+icon("book",15)+' Baixar CSVs</button>'+
      '</div></div>' : '')+
    '<div class="grid-2">'+
      renderResumoContas("Contas a pagar", "trendingUp", "var(--danger)", contasPagar, hoje, fimSemana)+
      renderResumoContas("Contas a receber", "trendingUp", "var(--success)", contasReceber, hoje, fimSemana)+
    '</div>'+
    '<div class="section-label">Todas as contas</div>'+
    '<div class="tabs">'+tabs.map(function(t){ return '<div class="tab '+(filtro===t[0]?"active":"")+'" data-action="financeiro-filtro" data-f="'+t[0]+'">'+t[1]+'</div>'; }).join("")+'</div>'+
    '<div class="card"><div style="overflow-x:auto;"><table class="table-dark"><thead><tr>'+
      '<th>Descrição</th><th>Categoria</th><th>Tipo</th><th>Vencimento</th><th style="text-align:right;">Valor</th><th>Status</th>'+(podeEditar?'<th></th>':'')+
    '</tr></thead><tbody>'+
    (lista.length ? lista.map(function(c){
      var status = c.pagoEm ? "pago" : (c.vencimento<hoje ? "vencido" : "pendente");
      var statusLbl = {pago:"Pago", vencido:"Vencido", pendente:"Pendente"}[status];
      return '<tr>'+
        '<td>'+escapeHtml(c.descricao)+'</td>'+
        '<td>'+escapeHtml(c.categoria)+'</td>'+
        '<td>'+(c.tipo==="PAGAR"?"A pagar":"A receber")+'</td>'+
        '<td>'+new Date(c.vencimento+"T00:00:00").toLocaleDateString("pt-BR")+'</td>'+
        '<td style="text-align:right; color:'+(c.tipo==="PAGAR"?"var(--danger)":"var(--success)")+'; font-weight:700;">'+brl(c.valorCentavos)+'</td>'+
        '<td><span class="badge badge-'+status+'">'+statusLbl+'</span></td>'+
        (podeEditar ? '<td>'+(!c.pagoEm ? '<button class="btn btn-sm btn-success" data-action="conta-pagar" data-conta="'+c.id+'">Marcar pago</button>' : '')+'</td>' : '')+
      '</tr>';
    }).join("") : '<tr><td colspan="7"><div class="empty-hint">Nenhuma conta neste filtro.</div></td></tr>')+
    '</tbody></table></div></div>';
}

// PRIORIDADE 7 — "sem saber contabilidade, consigo responder quanto
// sobrou este mês e por quê": entrou/saiu/sobrou + pra onde foi o
// dinheiro (5 linhas) + comparação com o mês anterior + fluxo projetado
// dos próximos 30 dias, tudo agregado no banco (relatorio_financeiro_resumo).
function renderResumoFinanceiroConteudo(){
  var podeEditar = can(PERM.FINANCEIRO_EDITAR);
  if(state.financeiroResumoCarregando || !state.financeiroResumoResultado){
    return '<div class="empty-hint">Carregando...</div>';
  }
  var r = state.financeiroResumoResultado;
  var ant = r.mes_anterior;
  function variacaoTxt(atual, anterior){
    if(!anterior) return "";
    var pct = Math.round((atual-anterior)/Math.abs(anterior)*100);
    var cor = pct>=0 ? "var(--success)" : "var(--danger)";
    return '<span style="color:'+cor+'; font-size:11px; font-weight:700;">'+(pct>=0?"▲":"▼")+' '+Math.abs(pct)+'% vs mês passado</span>';
  }
  var maxLinha = Math.max.apply(null, r.linhas.map(function(l){ return l.valor_centavos; }).concat([1]));
  var maxSaldoAbs = Math.max.apply(null, r.fluxo_30_dias.map(function(d){ return Math.abs(d.saldo_acumulado_centavos); }).concat([1]));
  var primeiroNegativo = r.fluxo_30_dias.find(function(d){ return d.saldo_acumulado_centavos<0; });

  return '<div class="metric-grid">'+
      '<div class="kpi-card"><div class="kpi-icon" style="background:rgba(34,197,94,.14); color:var(--success);">'+icon("trendingUp",20)+'</div><div class="kpi-body"><div class="kpi-label">Entrou</div><div class="kpi-value">'+brl(r.entrou_centavos)+'</div>'+variacaoTxt(r.entrou_centavos, ant.entrou_centavos)+'</div></div>'+
      '<div class="kpi-card"><div class="kpi-icon" style="background:rgba(239,68,68,.14); color:var(--danger);">'+icon("trendingUp",20)+'</div><div class="kpi-body"><div class="kpi-label">Saiu</div><div class="kpi-value">'+brl(r.saiu_centavos)+'</div>'+variacaoTxt(r.saiu_centavos, ant.saiu_centavos)+'</div></div>'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("wallet",20)+'</div><div class="kpi-body"><div class="kpi-label">Sobrou</div><div class="kpi-value" style="color:'+(r.sobrou_centavos>=0?"var(--success)":"var(--danger)")+';">'+brl(r.sobrou_centavos)+'</div>'+variacaoTxt(r.sobrou_centavos, ant.sobrou_centavos)+'</div></div>'+
    '</div>'+
    '<div class="card" style="margin-bottom:14px;"><div class="card-title">Para onde foi o dinheiro</div>'+
    r.linhas.map(function(l){
      var pct = Math.max(2, Math.round(l.valor_centavos/maxLinha*100));
      return '<div style="margin-bottom:10px;">'+
        '<div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;"><span>'+l.label+'</span><span style="font-weight:700;">'+brl(l.valor_centavos)+'</span></div>'+
        '<div class="stock-bar"><div class="stock-bar-fill" style="width:'+pct+'%; background:var(--danger);"></div></div>'+
      '</div>';
    }).join("")+
    '</div>'+
    '<div class="section-label">Despesas fixas (lançam a conta do mês sozinhas)</div>'+
    '<div class="card" style="margin-bottom:14px;">'+
      (state.despesasRecorrentes.length ? state.despesasRecorrentes.map(function(d){
        return '<div class="data-row"><div class="main"><div class="nome">'+escapeHtml(d.descricao)+(!d.ativo?' <span class="badge badge-inativo">Inativa</span>':'')+'</div>'+
          '<div class="sub">'+escapeHtml(d.categoria)+' · todo dia '+d.diaVencimento+' · '+brl(d.valorCentavos)+'</div></div>'+
          (podeEditar ? '<button class="btn btn-sm" data-action="despesa-recorrente-editar" data-despesa="'+d.id+'">Editar</button>' : '')+
        '</div>';
      }).join("") : '<div class="empty-hint">Nenhuma despesa fixa cadastrada.</div>')+
      (podeEditar ? '<button class="btn btn-sm" style="margin-top:8px;" data-action="despesa-recorrente-nova">'+icon("plus",14)+' Despesa fixa</button>' : '')+
    '</div>'+
    '<div class="section-label">Fluxo projetado — próximos 30 dias</div>'+
    (primeiroNegativo ? '<div class="alert-row danger">'+icon("alert",16)+'<div><span class="t">SALDO PROJETADO FICA NEGATIVO</span><span class="d">a partir de '+new Date(primeiroNegativo.data+"T00:00:00").toLocaleDateString("pt-BR")+'</span></div></div>' : '')+
    '<div class="card"><div class="chart-bars">'+r.fluxo_30_dias.map(function(d){
      var pct = Math.max(2, Math.round(Math.abs(d.saldo_acumulado_centavos)/maxSaldoAbs*100));
      var negativo = d.saldo_acumulado_centavos<0;
      return '<div class="chart-bar '+(pct>2?"has":"")+'" style="height:'+pct+'%; background:'+(negativo?"var(--danger)":"var(--success)")+';" title="'+new Date(d.data+"T00:00:00").toLocaleDateString("pt-BR")+' · '+brl(d.saldo_acumulado_centavos)+'"></div>';
    }).join("")+'</div></div>';
}
SUB_ABAS.financeiro = [
  {id:"resumo", rotulo:"Resumo", permissao:PERM.FINANCEIRO, render:renderResumoFinanceiroConteudo,
    carregar:function(){ carregarFinanceiroResumo(); },
    carregado:function(){ return !!state.financeiroResumoResultado; }},
  {id:"contas", rotulo:"Contas", permissao:PERM.FINANCEIRO, render:renderContasConteudo}
];

function renderClientes(){
  var podeEditar = can(PERM.CLIENTES);
  var busca = (state.clienteBusca||"").trim().toLowerCase();
  var lista = state.clientes.filter(function(c){ return !busca || c.nome.toLowerCase().indexOf(busca)!==-1; });
  return renderPageHeader("users", "Clientes", state.clientes.length+" cadastrados",
      (podeEditar ? '<button class="btn btn-primary" data-action="cliente-novo">'+icon("plus",15)+' Novo cliente</button>' : ''))+
    '<div class="search-box" style="max-width:360px; margin-bottom:12px;">'+icon("search",16)+
      '<input placeholder="Buscar por nome..." value="'+escapeHtml(state.clienteBusca||"")+'" data-action="cliente-busca">'+
    '</div>'+
    '<div class="card">'+
    (lista.length ? lista.map(function(c){
      return '<div class="data-row" data-action="cliente-abrir" data-cliente="'+c.id+'" style="cursor:pointer;">'+
        '<div class="main"><div class="nome">'+escapeHtml(c.nome)+'</div>'+
        '<div class="sub">'+(c.telefone?escapeHtml(c.telefone):"sem telefone")+(c.aniversario?' · aniversário '+new Date(c.aniversario+"T00:00:00").toLocaleDateString("pt-BR"):'')+(c.pontosFidelidade?' · '+c.pontosFidelidade+' ponto(s)':'')+'</div></div>'+
        (c.consentimentoLgpd ? '<span class="badge badge-status-ok">LGPD OK</span>' : '<span class="badge badge-status-atencao">SEM CONSENTIMENTO</span>')+
      '</div>';
    }).join("") : '<div class="empty-hint">Nenhum cliente cadastrado.</div>')+
    '</div>';
}

function renderClienteDetalhe(){
  var c = state.clientes.find(function(x){ return x.id===state.clienteDetalheId; });
  if(!c) return '<div class="empty-hint">Cliente não encontrado.</div>';
  var podeEditar = can(PERM.CLIENTES);
  var cabecalho = '<div class="comanda-head">'+
      '<div><div class="titulo">'+escapeHtml(c.nome).toUpperCase()+'</div>'+
      '<div class="sub">'+(c.telefone?escapeHtml(c.telefone):"sem telefone")+'</div></div>'+
      '<button class="btn btn-ghost" data-action="nav-goto" data-view="clientes">'+icon("arrowLeft",16)+' Clientes</button>'+
    '</div>';
  if(!state.clienteFicha) return cabecalho+'<div class="empty-hint">Carregando...</div>';
  var f = state.clienteFicha;
  return cabecalho+
    '<div class="metric-grid">'+
      '<div class="kpi-card"><div class="kpi-icon" style="background:rgba(239,68,68,.14); color:var(--danger);">'+icon("wallet",20)+'</div><div class="kpi-body"><div class="kpi-label">Fiado em aberto</div><div class="kpi-value">'+brl(f.saldo_devedor)+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon" style="background:rgba(34,197,94,.14); color:var(--success);">'+icon("target",20)+'</div><div class="kpi-body"><div class="kpi-label">Pontos de fidelidade</div><div class="kpi-value">'+c.pontosFidelidade+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("utensils",20)+'</div><div class="kpi-body"><div class="kpi-label">Últimas visitas</div><div class="kpi-value">'+f.ultimas_visitas.length+'</div></div></div>'+
    '</div>'+
    (c.endereco ? '<div class="card" style="margin-bottom:14px;"><div class="card-title">Endereço</div><p style="font-size:13px; color:var(--text-secondary); margin:0;">'+escapeHtml(c.endereco)+(c.bairro?' — '+escapeHtml(c.bairro):'')+'</p></div>' : '')+
    (c.observacoes ? '<div class="card" style="margin-bottom:14px;"><div class="card-title">Observações</div><p style="font-size:13px; color:var(--text-secondary); margin:0;">'+escapeHtml(c.observacoes)+'</p></div>' : '')+
    (podeEditar ? '<button class="btn" style="margin-bottom:14px;" data-action="cliente-editar" data-cliente="'+c.id+'">'+icon("edit",15)+' Editar cadastro</button>' : '')+
    '<div class="card"><div class="card-title">Histórico de visitas</div>'+
    (f.ultimas_visitas.length ? f.ultimas_visitas.map(function(v){
      return '<div class="data-row"><div class="main"><div class="nome">'+v.codigo+'</div><div class="sub">'+new Date(v.fechamento).toLocaleString("pt-BR")+'</div></div><div class="num">'+brl(v.total_centavos)+'</div></div>';
    }).join("") : '<div class="empty-hint">Nenhuma visita registrada ainda.</div>')+
    '</div>';
}

// 0.11 — migrado pro componente genérico de sub-abas. Cada aba busca seu
// próprio dado só quando é aberta pela primeira vez (carregado() evita
// rebuscar ao trocar de aba e voltar); trocar o período/mês dentro da
// aba Vendas/Gestão continua recarregando na hora, igual sempre foi.
SUB_ABAS.relatorios = [
  {id:"vendas", rotulo:"Vendas", permissao:PERM.RELATORIOS, render:renderRelatorioVendasConteudo,
    carregar:function(){ carregarRelatorio(state.relatorioPeriodo||"HOJE"); },
    carregado:function(){ return !!state.relatorioResultado; }},
  {id:"gestao", rotulo:"Gestão", permissao:PERM.RELATORIOS, render:renderRelatorioGestao,
    carregar:function(){ carregarRelatorioGestao(state.relatorioPeriodo||"HOJE"); },
    carregado:function(){ return !!state.relatorioGestaoResultado; }},
  {id:"dre", rotulo:"DRE mensal", permissao:PERM.RELATORIOS, render:renderDre,
    carregar:function(){ carregarRelatorioDre(state.relatorioDreMes||hojeOperacionalStr().slice(0,7)); },
    carregado:function(){ return !!state.relatorioDreResultado; }}
];
function renderRelatorios(){
  return renderPageHeader("chart", "Relatórios", "Desempenho de vendas, gestão e DRE")+renderSubAbas("relatorios");
}
function renderRelatorioVendasConteudo(){
  var periodo = state.relatorioPeriodo || "HOJE";
  var periodos = [["HOJE","Hoje"],["7D","7 dias"],["30D","30 dias"],["MES","Escolher mês"]];

  var cabecalho = '<div class="tabs">'+periodos.map(function(p){ return '<div class="tab '+(periodo===p[0]?"active":"")+'" data-action="relatorio-periodo" data-p="'+p[0]+'">'+p[1]+'</div>'; }).join("")+'</div>'+
    (periodo==="MES" ? '<div class="field" style="max-width:220px;"><input type="month" id="relatorioMesInput" value="'+escapeHtml(state.relatorioMes||"")+'" data-action="relatorio-mes"></div>' : '');

  if(state.relatorioCarregando || !state.relatorioResultado){
    return cabecalho+'<div class="empty-hint">Carregando período...</div>';
  }

  // Fase 0.5 — tudo agregado no banco (relatorio_vendas RPC); o client só
  // exibe, não recalcula mais nada a partir de comandas+itens completos.
  var r = state.relatorioResultado;
  var totalVendas = r.total_vendas||0;
  var contasFechadas = r.contas_fechadas||0;
  var ticketMedio = contasFechadas ? Math.round(totalVendas/contasFechadas) : 0;
  var ranking = r.ranking_produtos||[];
  var garcons = r.desempenho_garcons||[];
  var maxProduto = ranking.length ? ranking[0].total : 0;
  var maxGarcom = garcons.length ? garcons[0].vendas : 0;

  return cabecalho+
    '<div class="metric-grid">'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("trendingUp",20)+'</div><div class="kpi-body"><div class="kpi-label">Vendas no período</div><div class="kpi-value">'+brl(totalVendas)+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("utensils",20)+'</div><div class="kpi-body"><div class="kpi-label">Contas fechadas</div><div class="kpi-value">'+contasFechadas+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("target",20)+'</div><div class="kpi-body"><div class="kpi-label">Ticket médio</div><div class="kpi-value">'+brl(ticketMedio)+'</div></div></div>'+
    '</div>'+
    '<div class="grid-2">'+
      '<div class="card"><div class="card-title">Ranking de produtos</div>'+
        (ranking.length ? ranking.map(function(r,idx){
          var pct = Math.max(4, Math.round(r.total/maxProduto*100));
          return '<div class="ranking-row"><span class="pos">'+(idx+1)+'</span>'+
            '<div class="main"><div class="nome">'+escapeHtml(r.nome)+'</div><div class="sub">'+r.qtd+' unidades vendidas</div>'+
              '<div class="stock-bar" style="max-width:none;"><div class="stock-bar-fill" style="width:'+pct+'%; background:var(--primary);"></div></div>'+
            '</div>'+
            '<div class="num">'+brl(r.total)+'</div></div>';
        }).join("") : '<div class="empty-hint">Sem vendas no período.</div>')+
      '</div>'+
      '<div class="card"><div class="card-title">Desempenho por garçom</div><div class="modal-sub" style="margin:0 0 8px;">Por quem lançou cada item, não quem abriu a mesa.</div>'+
        (garcons.length ? garcons.map(function(g){
          var pct = Math.max(4, Math.round(g.vendas/maxGarcom*100));
          return '<div class="data-row"><div class="main"><div class="nome">'+escapeHtml(g.nome)+'</div><div class="sub">'+g.contas+' conta(s)</div>'+
              '<div class="stock-bar" style="max-width:none;"><div class="stock-bar-fill" style="width:'+pct+'%; background:var(--primary);"></div></div>'+
            '</div><div class="num">'+brl(g.vendas)+'</div></div>';
        }).join("") : '<div class="empty-hint">Sem vendas no período.</div>')+
      '</div>'+
    '</div>';
}

function renderRelatorioGestao(){
  var periodo = state.relatorioPeriodo || "HOJE";
  var periodos = [["HOJE","Hoje"],["7D","7 dias"],["30D","30 dias"],["MES","Escolher mês"]];
  var cabecalho = '<div class="tabs">'+periodos.map(function(p){ return '<div class="tab '+(periodo===p[0]?"active":"")+'" data-action="relatorio-periodo" data-p="'+p[0]+'">'+p[1]+'</div>'; }).join("")+'</div>'+
    (periodo==="MES" ? '<div class="field" style="max-width:220px;"><input type="month" id="relatorioMesInput" value="'+escapeHtml(state.relatorioMes||"")+'" data-action="relatorio-mes"></div>' : '');
  if(state.relatorioGestaoCarregando || !state.relatorioGestaoResultado){
    return cabecalho+'<div class="empty-hint">Carregando período...</div>';
  }
  var g = state.relatorioGestaoResultado;
  var cmv = g.cmv_por_produto||[];
  var antiFraude = g.anti_fraude||[];
  var taxaGarcom = g.taxa_por_garcom||[];
  var abc = g.curva_abc||[];
  var heatmap = g.heatmap||[];
  var diasSemana = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  var maxHeat = Math.max(1, Math.max.apply(null, heatmap.map(function(h){ return h.total; }).concat([0])));
  var heatPorDiaHora = {};
  heatmap.forEach(function(h){ heatPorDiaHora[h.dia_semana+"-"+h.hora] = h; });

  return cabecalho+
    '<div class="card" style="margin-bottom:14px;"><div class="card-title">CMV e margem por produto</div>'+
      '<div style="overflow-x:auto;"><table class="table-dark"><thead><tr><th>Produto</th><th>Categoria</th><th style="text-align:right;">Preço</th><th style="text-align:right;">Custo (CMV)</th><th style="text-align:right;">Margem</th><th style="text-align:right;">Vendido</th></tr></thead><tbody>'+
      (cmv.length ? cmv.map(function(c){
        var margemPct = c.preco_centavos>0 ? Math.round((1 - c.custo_centavos/c.preco_centavos)*100) : 0;
        var neg = c.custo_centavos >= c.preco_centavos;
        return '<tr'+(neg?' style="background:rgba(239,68,68,.1);"':'')+'><td>'+escapeHtml(c.nome)+'</td><td>'+escapeHtml(c.categoria)+'</td>'+
          '<td style="text-align:right;">'+brl(c.preco_centavos)+'</td><td style="text-align:right;">'+brl(c.custo_centavos)+'</td>'+
          '<td style="text-align:right; color:'+(neg?"var(--danger)":"var(--success)")+'; font-weight:700;">'+margemPct+'%</td>'+
          '<td style="text-align:right;">'+c.qtd_vendida+'</td></tr>';
      }).join("") : '<tr><td colspan="6"><div class="empty-hint">Sem vendas no período.</div></td></tr>')+
      '</tbody></table></div></div>'+
    '<div class="grid-2">'+
      '<div class="card"><div class="card-title">Anti-fraude · cancelamentos e descontos por funcionário</div>'+
        (antiFraude.length ? antiFraude.map(function(f){
          return '<div class="data-row"><div class="main"><div class="nome">'+escapeHtml(f.nome)+'</div>'+
            '<div class="sub">'+f.cancelamentos_qtd+' cancelamento(s) · '+f.descontos_qtd+' desconto(s)</div></div>'+
            '<div class="num">'+brl(f.valor_total)+'</div></div>';
        }).join("") : '<div class="empty-hint">Nenhum cancelamento/desconto no período.</div>')+
      '</div>'+
      '<div class="card"><div class="card-title">Taxa de serviço por garçom</div><div class="modal-sub" style="margin:0 0 8px;">Estimada proporcionalmente ao que cada um lançou.</div>'+
        (taxaGarcom.length ? taxaGarcom.map(function(t){
          return '<div class="data-row"><div class="main"><div class="nome">'+escapeHtml(t.nome)+'</div><div class="sub">Subtotal '+brl(t.subtotal)+'</div></div>'+
            '<div class="num">'+brl(t.taxa_estim)+'</div></div>';
        }).join("") : '<div class="empty-hint">Sem vendas no período.</div>')+
      '</div>'+
    '</div>'+
    '<div class="card" style="margin-top:14px;"><div class="card-title">Taxas pagas às maquininhas</div>'+
      ((state.relatorioTaxasResultado||[]).length ? state.relatorioTaxasResultado.map(function(t){
        return '<div class="data-row"><div class="main"><div class="nome">'+t.forma+'</div><div class="sub">Bruto '+brl(t.bruto)+' · '+t.taxa_pct+'%</div></div>'+
          '<div class="num" style="color:var(--danger);">-'+brl(t.taxa_paga)+'</div></div>';
      }).join("") : '<div class="empty-hint">Sem vendas em cartão/voucher no período.</div>')+
    '</div>'+
    '<div class="card" style="margin-top:14px;"><div class="card-title">Curva ABC de produtos</div>'+
      (abc.length ? abc.map(function(a){
        var cls = a.classe==="A"?"badge-status-ok":(a.classe==="B"?"badge-status-atencao":"badge-status-critico");
        return '<div class="data-row"><div class="main"><div class="nome">'+escapeHtml(a.nome)+'</div></div>'+
          '<span class="badge '+cls+'" style="margin-right:10px;">CLASSE '+a.classe+'</span>'+
          '<div class="num">'+brl(a.total)+'</div></div>';
      }).join("") : '<div class="empty-hint">Sem vendas no período.</div>')+
    '</div>'+
    '<div class="card" style="margin-top:14px;"><div class="card-title">Heatmap · vendas por dia da semana × hora</div>'+
      '<div style="overflow-x:auto;"><table class="table-dark"><thead><tr><th>Dia</th>'+
        Array.from({length:24}).map(function(_,h){ return '<th style="text-align:center; font-size:9px;">'+h+'</th>'; }).join("")+
      '</tr></thead><tbody>'+
      diasSemana.map(function(nomeDia, dow){
        return '<tr><td>'+nomeDia+'</td>'+
          Array.from({length:24}).map(function(_,h){
            var cel = heatPorDiaHora[dow+"-"+h];
            var intensidade = cel ? Math.round((cel.total/maxHeat)*100) : 0;
            return '<td style="text-align:center; padding:2px;"><div title="'+(cel?brl(cel.total):"")+'" style="width:100%; height:18px; border-radius:3px; background:rgba(30,139,255,'+(intensidade/100*0.85+(intensidade>0?0.1:0))+');"></div></td>';
          }).join("")+
        '</tr>';
      }).join("")+
      '</tbody></table></div>'+
    '</div>';
}

function renderDre(){
  var mes = state.relatorioDreMes || hojeOperacionalStr().slice(0,7);
  var cabecalho = '<div class="field" style="max-width:220px;"><input type="month" id="dreMesInput" value="'+escapeHtml(mes)+'" data-action="dre-mes"></div>';
  if(state.relatorioDreCarregando || !state.relatorioDreResultado){
    return cabecalho+'<div class="empty-hint">Carregando mês...</div>';
  }
  var d = state.relatorioDreResultado;
  return cabecalho+
    '<div class="card" style="max-width:480px;">'+
      '<div class="totais-linha"><span>Faturamento</span><span>'+brl(d.faturamento)+'</span></div>'+
      '<div class="totais-linha"><span>(-) CMV</span><span>-'+brl(d.cmv)+'</span></div>'+
      '<div class="totais-linha"><span>(-) Despesas (contas a pagar do mês)</span><span>-'+brl(d.despesas)+'</span></div>'+
      '<div class="totais-linha total" style="color:'+(d.resultado>=0?"var(--success)":"var(--danger)")+';"><span>Resultado</span><span>'+brl(d.resultado)+'</span></div>'+
    '</div>';
}

// PRIORIDADE 5 — Equipe ganhou 5 sub-abas (mesmo componente da 0.11):
// Funcionários (tela de sempre), Escala, Ponto, Desempenho e Custo
// (salário/diária/rateio/vales — só ADMIN, admin.equipe.custos.ver).
function renderEquipe(){
  var podeEditar = can(PERM.EQUIPE);
  return renderPageHeader("users", "Equipe", state.usuarios.length+" usuários cadastrados",
      (podeEditar ? '<button class="btn btn-primary" data-action="usuario-novo">'+icon("plus",15)+' Novo usuário</button>' : ''))+
    renderSubAbas("equipe");
}
function renderFuncionariosConteudo(){
  var podeEditar = can(PERM.EQUIPE);
  var ativos = state.usuarios.filter(function(u){ return u.ativo; }).length;
  var inativos = state.usuarios.length - ativos;
  var porPapel = {};
  state.usuarios.forEach(function(u){ porPapel[u.papel] = (porPapel[u.papel]||0)+1; });
  var papeis = Object.keys(porPapel).sort();

  return '<div class="metric-grid">'+
      '<div class="kpi-card"><div class="kpi-icon" style="background:rgba(34,197,94,.14); color:var(--success);">'+icon("check",20)+'</div><div class="kpi-body"><div class="kpi-label">Ativos</div><div class="kpi-value">'+ativos+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon" style="background:var(--surface-03); color:var(--text-muted);">'+icon("x",20)+'</div><div class="kpi-body"><div class="kpi-label">Inativos</div><div class="kpi-value">'+inativos+'</div></div></div>'+
    '</div>'+
    '<div class="card" style="margin-bottom:14px;"><div class="card-title">Por papel</div>'+
      '<div style="display:flex; gap:10px; flex-wrap:wrap;">'+
      papeis.map(function(p){
        return '<span class="badge" style="background:rgba(255,255,255,.08); color:'+(PAPEL_COR[p]||"var(--text-secondary)")+'; font-size:11px; padding:6px 12px;">'+p+' · '+porPapel[p]+'</span>';
      }).join("")+
      '</div>'+
    '</div>'+
    '<div class="card">'+
    state.usuarios.map(function(u){
      return '<div class="data-row">'+
        '<div class="avatar-sm">'+escapeHtml(u.nome.charAt(0))+'</div>'+
        '<div class="main"><div class="nome">'+escapeHtml(u.nome)+' '+(!u.ativo?'<span class="badge badge-inativo">Inativo</span>':'')+'</div>'+
        '<div class="sub"><span class="badge" style="background:rgba(255,255,255,.08); color:'+(PAPEL_COR[u.papel]||"var(--text-secondary)")+';">'+u.papel+'</span>'+
          (podeEditar ? ' · peso rateio <input type="number" min="0.1" step="0.1" style="width:56px; padding:2px 4px; font-size:11px;" value="'+u.pesoRateioTaxa+'" data-action="usuario-peso-rateio" data-usuario="'+u.id+'">' : '')+
        '</div></div>'+
        (podeEditar ? '<div class="acts">'+
          '<button class="btn btn-sm" data-action="usuario-trocar-pin" data-usuario="'+u.id+'">Credenciais</button>'+
          '<button class="btn btn-sm" data-action="usuario-toggle-ativo" data-usuario="'+u.id+'">'+(u.ativo?"Desativar":"Reativar")+'</button>'+
        '</div>' : '')+
      '</div>';
    }).join("")+
    '</div>';
}

var DIAS_SEMANA_ESCALA = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
function renderEscalaConteudo(){
  var podeEditar = can(PERM.EQUIPE);
  var ativos = state.usuarios.filter(function(u){ return u.ativo; });
  var hoje = state.escalaHoje||[];
  var naoBateram = hoje.filter(function(h){ return !h.bateu_ponto; });

  return (naoBateram.length ? '<div class="alert-row danger">'+icon("alert",16)+'<div style="flex:1;"><span class="t">ESCALADO(S) HOJE SEM BATER PONTO</span><span class="d">'+
      naoBateram.map(function(h){ return escapeHtml(h.nome); }).join(" · ")+
    '</span></div></div>' : '')+
    ativos.map(function(u){
      var escala = state.escalasPorUsuario[u.id]||[];
      return '<div class="card" style="margin-bottom:10px;">'+
        '<div class="card-title">'+escapeHtml(u.nome)+'</div>'+
        '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:8px;">'+
        DIAS_SEMANA_ESCALA.map(function(d, idx){
          var linha = escala.find(function(e){ return e.diaSemana===idx; });
          var folga = !linha || linha.tipo==="FOLGA";
          return '<div class="field" style="margin-bottom:0;"><label>'+d+'</label>'+
            '<select data-action="escala-tipo" data-usuario="'+u.id+'" data-dia="'+idx+'">'+
              '<option value="FOLGA" '+(folga?"selected":"")+'>Folga</option>'+
              '<option value="TRABALHO" '+(!folga?"selected":"")+'>Trabalho</option>'+
            '</select>'+
            (!folga ? '<div style="display:flex; gap:4px; margin-top:4px;">'+
              '<input type="time" style="flex:1;" value="'+(linha&&linha.turnoInicio?linha.turnoInicio.slice(0,5):"")+'" data-action="escala-turno-inicio" data-usuario="'+u.id+'" data-dia="'+idx+'">'+
              '<input type="time" style="flex:1;" value="'+(linha&&linha.turnoFim?linha.turnoFim.slice(0,5):"")+'" data-action="escala-turno-fim" data-usuario="'+u.id+'" data-dia="'+idx+'">'+
            '</div>' : '')+
          '</div>';
        }).join("")+
        '</div>'+
        (podeEditar ? '<button class="btn btn-sm btn-primary" style="margin-top:10px;" data-action="escala-salvar" data-usuario="'+u.id+'">Salvar escala</button>' : '')+
      '</div>';
    }).join("");
}

var PONTO_TIPO_LABEL = {ENTRADA:"Entrada", SAIDA:"Saída", INICIO_INTERVALO:"Início do intervalo", FIM_INTERVALO:"Fim do intervalo"};
function renderPontoConteudo(){
  var podeEditar = can(PERM.EQUIPE);
  var ativos = state.usuarios.filter(function(u){ return u.ativo; });
  return '<div class="card" style="max-width:420px; margin-bottom:14px;">'+
    '<div class="card-title">Bater ponto</div>'+
    '<div class="modal-sub" style="margin-bottom:10px;">Controle interno — não substitui o registro de ponto oficial exigido pela legislação.</div>'+
    '<div class="field"><label>Funcionário</label><select data-action="ponto-usuario">'+
      ativos.map(function(u){ return '<option value="'+u.id+'" '+(state.pontoUsuarioId===u.id?"selected":"")+'>'+escapeHtml(u.nome)+'</option>'; }).join("")+
    '</select></div>'+
    '<div class="field" style="margin-bottom:10px;"><label>PIN</label><input id="pontoPinInput" type="password" value="'+escapeHtml(state.pontoPin||"")+'" data-action="ponto-pin-input" placeholder="PIN"></div>'+
    (state.pontoErro ? '<div class="pin-error">'+escapeHtml(state.pontoErro)+'</div>' : '')+
    '<div class="action-row">'+
      Object.keys(PONTO_TIPO_LABEL).map(function(t){
        return '<button class="btn btn-sm" data-action="ponto-bater" data-tipo="'+t+'">'+PONTO_TIPO_LABEL[t]+'</button>';
      }).join("")+
    '</div>'+
  '</div>'+
  '<div class="section-label">Registros recentes</div>'+
  '<div class="card">'+(state.pontosRecentes&&state.pontosRecentes.length ? state.pontosRecentes.map(function(p){
    var u = state.usuarios.find(function(x){ return x.id===p.usuarioId; });
    return '<div class="mov-row"><span><span class="mov-tipo ENTRADA">'+(PONTO_TIPO_LABEL[p.tipo]||p.tipo)+'</span>'+(u?escapeHtml(u.nome):"?")+
      (p.corrigido?' <span class="badge badge-status-atencao">corrigido</span>':'')+
      '<div class="tag">'+new Date(p.registradoEm).toLocaleString("pt-BR")+'</div></span>'+
      (podeEditar ? '<button class="btn btn-sm" data-action="ponto-corrigir-abrir" data-ponto="'+p.id+'">Corrigir</button>' : '')+
    '</div>';
  }).join("") : '<div class="empty-hint">Nenhum registro ainda.</div>')+'</div>';
}

function renderDesempenhoConteudo(){
  var periodo = state.desempenhoPeriodo||"7D";
  var periodos = [["7D","7 dias"],["30D","30 dias"],["MES","Escolher mês"]];
  var cabecalho = '<div class="tabs">'+periodos.map(function(p){ return '<div class="tab '+(periodo===p[0]?"active":"")+'" data-action="desempenho-periodo" data-p="'+p[0]+'">'+p[1]+'</div>'; }).join("")+'</div>'+
    (periodo==="MES" ? '<div class="field" style="max-width:220px;"><input type="month" value="'+escapeHtml(state.desempenhoMes||"")+'" data-action="desempenho-mes"></div>' : '');
  if(state.desempenhoCarregando || !state.desempenhoResultado) return cabecalho+'<div class="empty-hint">Carregando...</div>';
  var r = state.desempenhoResultado;
  var porGarcom = r.por_garcom||[];
  var tempoPreparo = r.tempo_preparo_por_setor||[];
  var maxVendas = porGarcom.length ? Math.max.apply(null, porGarcom.map(function(g){ return g.vendas_centavos; })) : 0;
  return cabecalho+
    '<div class="card"><div class="card-title">Por garçom/funcionário</div>'+
    (porGarcom.length ? porGarcom.map(function(g){
      var pct = maxVendas>0 ? Math.max(4, Math.round(g.vendas_centavos/maxVendas*100)) : 4;
      return '<div class="ranking-row"><div class="main"><div class="nome">'+escapeHtml(g.nome)+'</div>'+
        '<div class="sub">'+g.contas+' conta(s) · ticket médio '+brl(g.ticket_medio_centavos)+' · '+g.horas_trabalhadas+'h trabalhadas'+
          (g.itens_por_hora!=null?' · '+g.itens_por_hora+' itens/h':'')+(g.cancelamentos?' · '+g.cancelamentos+' cancelamento(s)':'')+'</div>'+
        '<div class="stock-bar" style="max-width:none;"><div class="stock-bar-fill" style="width:'+pct+'%; background:var(--primary);"></div></div></div>'+
        '<div class="num">'+brl(g.vendas_centavos)+'</div></div>';
    }).join("") : '<div class="empty-hint">Nenhuma venda no período.</div>')+
    '</div>'+
    '<div class="section-label">Tempo médio de preparo (cozinha)</div>'+
    '<div class="metric-grid">'+
    (tempoPreparo.length ? tempoPreparo.map(function(t){
      return '<div class="metric-card"><div class="metric-label">'+t.setor_producao+'</div><div class="metric-value small">'+t.minutos_medio+' min</div></div>';
    }).join("") : '<div class="empty-hint">Sem itens com tempo de preparo registrado no período.</div>')+
    '</div>';
}

function renderCustoConteudo(){
  if(!can(PERM.EQUIPE_CUSTOS)) return '<div class="empty-hint">Disponível só para ADMIN.</div>';
  var ativos = state.usuarios.filter(function(u){ return u.ativo; });
  var f = state.fechamentoResultado;
  return '<div class="card" style="margin-bottom:14px;"><div class="card-title">Remuneração e vales por funcionário</div>'+
    ativos.map(function(u){
      var rem = state.remuneracoesPorUsuario[u.id];
      var vales = state.valesPorUsuario[u.id]||[];
      return '<div class="data-row" style="align-items:flex-start;">'+
        '<div class="main"><div class="nome">'+escapeHtml(u.nome)+'</div>'+
          '<div class="sub">'+(rem ? (rem.tipo==="MENSAL"?"Mensal: ":"Diária: ")+brl(rem.valorCentavos) : "Sem remuneração cadastrada")+
            (vales.length?' · '+vales.length+' vale(s) recente(s)':'')+'</div></div>'+
        '<div class="acts">'+
          '<button class="btn btn-sm" data-action="remuneracao-abrir" data-usuario="'+u.id+'">Remuneração</button>'+
          '<button class="btn btn-sm" data-action="vale-abrir" data-usuario="'+u.id+'">+ Vale</button>'+
        '</div>'+
      '</div>';
    }).join("")+
  '</div>'+
  '<div class="card">'+
    '<div class="card-title">Fechamento do período</div>'+
    '<div style="display:flex; gap:8px; align-items:flex-end; margin-bottom:12px;">'+
      '<div class="field" style="margin-bottom:0;"><label>De</label><input type="date" value="'+(state.fechamentoDesde||"")+'" data-action="fechamento-desde"></div>'+
      '<div class="field" style="margin-bottom:0;"><label>Até</label><input type="date" value="'+(state.fechamentoAte||"")+'" data-action="fechamento-ate"></div>'+
      '<button class="btn" data-action="fechamento-recalcular">Recalcular</button>'+
    '</div>'+
    (state.fechamentoCarregando || !f ? '<div class="empty-hint">Carregando...</div>' :
      '<p style="font-size:12px; color:var(--text-muted); margin:0 0 10px;">Taxa de serviço do período: '+brl(f.taxa_total_centavos)+' · rateio '+(f.metodo_rateio==="PESO"?"por peso de função":"igualitário")+'.</p>'+
      '<div style="overflow-x:auto;"><table class="table-dark"><thead><tr><th>Funcionário</th><th>Horas</th><th>Rateio (10%)</th><th>Vales</th>'+(f.pode_ver_remuneracao?'<th>Base</th><th>Líquido</th>':'')+'</tr></thead><tbody>'+
      (f.funcionarios||[]).map(function(x){
        return '<tr><td>'+escapeHtml(x.nome)+'</td><td>'+x.horas_trabalhadas+'h</td><td>'+brl(x.rateio_taxa_centavos)+'</td><td>'+brl(x.vales_centavos)+'</td>'+
          (f.pode_ver_remuneracao ? '<td>'+brl(x.remuneracao_base_centavos)+'</td><td style="font-weight:800;">'+brl(x.liquido_centavos)+'</td>' : '')+
        '</tr>';
      }).join("")+
      '</tbody></table></div>')+
  '</div>';
}
SUB_ABAS.equipe = [
  {id:"funcionarios", rotulo:"Funcionários", permissao:PERM.EQUIPE, render:renderFuncionariosConteudo},
  {id:"escala", rotulo:"Escala", permissao:PERM.EQUIPE, render:renderEscalaConteudo,
    carregar:function(){ carregarEscalas(); }, carregado:function(){ return !!state.escalaHoje; }},
  {id:"ponto", rotulo:"Ponto", permissao:PERM.EQUIPE, render:renderPontoConteudo,
    carregar:function(){ carregarPontosRecentes(); }, carregado:function(){ return !!state.pontosRecentes; }},
  {id:"desempenho", rotulo:"Desempenho", permissao:PERM.EQUIPE, render:renderDesempenhoConteudo,
    carregar:function(){ carregarDesempenhoEquipe(state.desempenhoPeriodo||"7D"); }, carregado:function(){ return !!state.desempenhoResultado; }},
  {id:"custo", rotulo:"Custo", permissao:PERM.EQUIPE_CUSTOS, render:renderCustoConteudo,
    carregar:function(){ carregarCustoEquipe(); }, carregado:function(){ return !!state.fechamentoResultado; }}
];

// 0.5 — conflitos de sincronização offline: pagamento feito sem internet
// numa comanda que mudou em outro terminal antes de sincronizar de
// verdade. GERENTE/ADMIN decide aplicar mesmo assim (processa o
// pagamento agora, do jeito que foi feito) ou descartar (a venda em
// dinheiro NÃO é registrada — ex: a comanda já foi fechada/paga por
// outro caminho nesse meio tempo).
function renderSyncConflitos(){
  if(!can(PERM.SYNC_CONFLITOS) || !state.syncConflitos.length) return "";
  return '<div class="card" style="margin-bottom:20px; border-left:4px solid var(--danger);">'+
    '<div class="card-title">Conflitos de sincronização offline ('+state.syncConflitos.length+')</div>'+
    state.syncConflitos.map(function(sc){
      var comanda = state.comandas.find(function(c){ return c.id===sc.comandaId; });
      var payload = sc.payload||{};
      var valorTotal = (payload.p_linhas||[]).reduce(function(s,l){ return s+(l.valor_centavos||0); },0);
      // VF-010 — recebimento em dinheiro offline que o servidor recusou: o
      // dinheiro já está na gaveta, não há o que "aplicar". O gerente só
      // registra que conferiu (fica na auditoria com quem e quando).
      if(sc.tipo==="pagamento_recusado"){
        var quando = payload.ocorrido_em ? " · recebido em "+new Date(payload.ocorrido_em).toLocaleString("pt-BR") : "";
        return '<div class="data-row">'+
          '<div class="main"><div class="nome">Recebimento offline recusado · '+brl(payload.valor_centavos||0)+(comanda?' · '+escapeHtml(comanda.codigo):'')+'</div>'+
          '<div class="sub">'+escapeHtml(payload.terminal_id||"")+quando+' · '+escapeHtml(payload.motivo_recusa||sc.motivo||"")+'</div></div>'+
          '<div class="acts">'+
            '<button class="btn btn-sm btn-primary" data-action="syncconflito-aplicar" data-conflito="'+sc.id+'">Marcar como conferido</button>'+
          '</div>'+
        '</div>';
      }
      return '<div class="data-row">'+
        '<div class="main"><div class="nome">'+(comanda?escapeHtml(comanda.codigo):"Comanda")+' · '+brl(valorTotal)+'</div>'+
        '<div class="sub">'+escapeHtml(sc.motivo||"")+' · '+new Date(sc.createdAt).toLocaleString("pt-BR")+'</div></div>'+
        '<div class="acts">'+
          '<button class="btn btn-sm" data-action="syncconflito-descartar" data-conflito="'+sc.id+'">Descartar</button>'+
          '<button class="btn btn-sm btn-primary" data-action="syncconflito-aplicar" data-conflito="'+sc.id+'">Aplicar mesmo assim</button>'+
        '</div>'+
      '</div>';
    }).join("")+
  '</div>';
}
// VF-002 — pendências de sincronização offline: pedido/pagamento/status
// que o SERVIDOR recusou de verdade (não erro de rede) quando a fila
// tentou mandar sozinha. Fica guardado neste aparelho (IndexedDB) até
// alguém decidir — nunca mais tenta sozinho depois de recusado uma vez.
var PENDENCIA_OFFLINE_TIPO_LABEL = {lancar_item:"Pedido lançado offline", kds_status:"Mudança de status (KDS)", pagamento_dinheiro:"Pagamento em dinheiro offline"};
function descricaoPendenciaOffline(p){
  if(p.tipo==="lancar_item"){
    var nomes = (p.payload||[]).map(function(it){ return it.quantidade+"x "+it.nome; });
    return nomes.join(", ");
  }
  if(p.tipo==="kds_status"){
    var itemAchado = null;
    state.comandas.forEach(function(c){
      var it = c.itens.find(function(x){ return x.id===p.itemId; });
      if(it) itemAchado = it;
    });
    return (itemAchado ? itemAchado.nome : "Item "+p.itemId) + " → "+p.status;
  }
  if(p.tipo==="pagamento_dinheiro"){
    var comanda = state.comandas.find(function(c){ return c.id===p.payload.p_comanda_id; });
    var total = (p.payload.p_linhas||[]).reduce(function(s,l){ return s+(l.valor_centavos||0); },0);
    return (comanda?comanda.codigo:"Comanda") + " · "+brl(total);
  }
  return "";
}
function renderPendenciasOfflineRecusadas(){
  if(!can(PERM.SYNC_CONFLITOS) || !state.pendenciasOfflineRecusadas.length) return "";
  return '<div class="card" style="margin-bottom:20px; border-left:4px solid var(--danger);">'+
    '<div class="card-title">Pendências de sincronização ('+state.pendenciasOfflineRecusadas.length+')</div>'+
    '<p style="font-size:12px; color:var(--text-muted); margin:0 0 12px;">Lançado neste aparelho enquanto offline — o servidor recusou ao tentar sincronizar (não é erro de rede, é mesmo uma regra de negócio). Revise e decida: tentar de novo ou descartar.</p>'+
    state.pendenciasOfflineRecusadas.map(function(p){
      return '<div class="data-row">'+
        '<div class="main"><div class="nome">'+escapeHtml(PENDENCIA_OFFLINE_TIPO_LABEL[p.tipo]||p.tipo)+'</div>'+
        '<div class="sub">'+escapeHtml(descricaoPendenciaOffline(p))+' · '+escapeHtml(p.erroRecusa||"")+' · recusado '+new Date(p.recusadoEm).toLocaleString("pt-BR")+
          (p.registradoNoServidor ? ' · já registrado no servidor para conferência do gerente' : '')+'</div></div>'+
        '<div class="acts">'+
          '<button class="btn btn-sm" data-action="pendencia-offline-descartar" data-pendencia="'+p.id+'">Descartar</button>'+
          '<button class="btn btn-sm btn-primary" data-action="pendencia-offline-tentar-de-novo" data-pendencia="'+p.id+'">Tentar de novo</button>'+
        '</div>'+
      '</div>';
    }).join("")+
  '</div>';
}
// ETAPA pós-10 — Configurações virou sub-abas (mesmo componente genérico
// de sempre, ETAPA 0.11): uma tela só com 13 cards empilhados exigia
// rolar demais pra achar qualquer coisa. Um único botão "Salvar
// configurações", fora das sub-abas (sempre visível, qualquer que seja a
// aba atual) — cada clique grava o form inteiro de novo, mas o handler
// (config-salvar, events.js) só lê do DOM os campos da aba ABERTA no
// momento; os campos das abas fechadas (fora do DOM) caem pro valor que
// já estava em state.config, então trocar de aba nunca apaga o que não
// está visível.
function renderConfigGeral(){
  var c = state.config;
  return '<div class="grid-2">'+
    '<div class="card">'+
      '<div class="card-title">Dados da empresa</div>'+
      '<div class="field"><label>Nome da empresa</label><input id="cfgNome" value="'+escapeHtml(c.empresaNome)+'"></div>'+
      '<div class="field"><label>CNPJ</label><input id="cfgCnpj" value="'+escapeHtml(c.empresaCnpj)+'"></div>'+
      '<div class="field" style="margin-bottom:0;"><label>Chave PIX (recebimento)</label><input id="cfgChavePix" value="'+escapeHtml(c.chavePix)+'"></div>'+
    '</div>'+
    '<div class="card">'+
      '<div class="card-title">Horário de funcionamento</div>'+
      '<div class="field" style="margin-bottom:0;"><label>Abertura e fechamento</label>'+
        '<div style="display:flex; gap:8px;">'+
          '<input id="cfgHorarioAbertura" type="time" value="'+c.horarioAbertura+'">'+
          '<input id="cfgHorarioFechamento" type="time" value="'+c.horarioFechamento+'">'+
        '</div>'+
      '</div>'+
    '</div>'+
  '</div>';
}
function renderConfigVendas(){
  var c = state.config;
  return '<div class="grid-2">'+
    '<div class="card">'+
      '<div class="card-title">Taxas e limites</div>'+
      '<div class="field"><label>Taxa de serviço padrão (%)</label><input id="cfgTaxa" type="number" min="0" max="30" step="1" value="'+c.taxaServicoPctPadrao+'"></div>'+
      '<div class="field"><label>Limite de desconto sem supervisor (%)</label><input id="cfgDesconto" type="number" min="0" max="100" step="1" value="'+c.limiteDescontoPct+'"></div>'+
      '<div class="field"><label>Limite de diferença de caixa tolerada</label><input id="cfgDiferenca" type="number" min="0" step="0.01" value="'+(c.limiteDiferencaCentavos/100).toFixed(2)+'"></div>'+
      '<div class="field" style="margin-bottom:0;"><label>Alertar sangria quando dinheiro em gaveta passar de</label><input id="cfgAlertaSangria" type="number" min="0" step="0.01" value="'+(c.limiteAlertaSangriaCentavos/100).toFixed(2)+'"></div>'+
    '</div>'+
    '<div class="card">'+
      '<div class="card-title">Taxas das maquininhas</div>'+
      '<p style="font-size:12px; color:var(--text-muted); margin:0 0 12px;">Desconta automaticamente da conta a receber gerada no pagamento, com o prazo configurado aqui.</p>'+
      ["DEBITO","CREDITO","VOUCHER"].map(function(f, i){
        var t = (c.taxasMaquininha&&c.taxasMaquininha[f])||{pct:0,prazoDias:0};
        return '<div class="field" '+(i===2?'style="margin-bottom:0;"':'')+'><label>'+f+'</label>'+
          '<div style="display:flex; gap:8px;">'+
            '<input id="cfgTaxaPct'+f+'" type="number" min="0" max="100" step="0.1" value="'+t.pct+'" placeholder="Taxa %" style="flex:1;">'+
            '<input id="cfgTaxaPrazo'+f+'" type="number" min="0" step="1" value="'+t.prazoDias+'" placeholder="Prazo (dias)" style="flex:1;">'+
          '</div></div>';
      }).join("")+
    '</div>'+
    '<div class="card">'+
      '<div class="card-title">Fidelidade por pontos</div>'+
      '<div class="field"><label>Pontos ganhos por R$1 pago</label><input id="cfgPontosPorReal" type="number" min="0" step="0.1" value="'+((c.fidelidade&&c.fidelidade.pontosPorReal)||0)+'"></div>'+
      '<div class="field" style="margin-bottom:0;"><label>Valor de 1 ponto no resgate (R$)</label><input id="cfgValorPonto" type="number" min="0" step="0.01" value="'+(((c.fidelidade&&c.fidelidade.valorPontoCentavos)||0)/100).toFixed(2)+'"></div>'+
    '</div>'+
  '</div>';
}
function renderConfigMetas(){
  var c = state.config;
  return '<div class="grid-2">'+
    '<div class="card">'+
      '<div class="card-title">Metas da Central do Dono</div>'+
      '<p style="font-size:12px; color:var(--text-muted); margin:0 0 12px;">Definem o verde/amarelo/vermelho dos semáforos na Central do Dono.</p>'+
      '<div class="field"><label>CMV alvo (%)</label><input id="cfgMetaCmv" type="number" min="0" max="100" step="0.5" value="'+((c.metasCentralDono&&c.metasCentralDono.cmvPct)||35)+'"></div>'+
      '<div class="field"><label>Perdas alvo (% do faturamento)</label><input id="cfgMetaPerdas" type="number" min="0" max="100" step="0.5" value="'+((c.metasCentralDono&&c.metasCentralDono.perdasPctFaturamento)||3)+'"></div>'+
      '<div class="field"><label>Custo de equipe alvo (%)</label><input id="cfgMetaCustoEquipe" type="number" min="0" max="100" step="0.5" value="'+((c.metasCentralDono&&c.metasCentralDono.custoEquipePct)||30)+'"></div>'+
      '<div class="field" style="margin-bottom:0;"><label>Diferença de caixa tolerada no mês (R$)</label><input id="cfgMetaDiferencaCaixaMes" type="number" min="0" step="0.01" value="'+(((c.metasCentralDono&&c.metasCentralDono.diferencaCaixaCentavosMes)||5000)/100).toFixed(2)+'"></div>'+
    '</div>'+
    '<div class="card">'+
      '<div class="card-title">Compras — alerta de preço</div>'+
      '<p style="font-size:12px; color:var(--text-muted); margin:0 0 12px;">Aumento acima deste percentual (frente ao recebimento anterior) acende o alerta na aba Preços.</p>'+
      '<div class="field" style="margin-bottom:0;"><label>Alerta de aumento de preço (%)</label><input id="cfgAlertaPrecoInsumo" type="number" min="0" step="0.5" value="'+(c.alertaAumentoPrecoInsumoPct||10)+'"></div>'+
    '</div>'+
    '<div class="card">'+
      '<div class="card-title">Cozinha (KDS) — atraso por setor</div>'+
      '<p style="font-size:12px; color:var(--text-muted); margin:0 0 12px;">Minutos até um item ser marcado como atrasado no KDS, por setor de produção.</p>'+
      SETORES_PRODUCAO.map(function(s, i){
        return '<div class="field" '+(i===SETORES_PRODUCAO.length-1?'style="margin-bottom:0;"':'')+'><label>'+s+'</label>'+
          '<input id="cfgAtraso'+s+'" type="number" min="1" step="1" value="'+((c.atrasoPorSetor&&c.atrasoPorSetor[s])||10)+'"></div>';
      }).join("")+
    '</div>'+
  '</div>';
}
function renderConfigAtendimento(){
  var c = state.config;
  return '<div class="grid-2">'+
    '<div class="card">'+
      '<div class="card-title">Bar — couvert e happy hour</div>'+
      '<div class="field"><label>Produto usado como couvert</label><select id="cfgProdutoCouvert">'+
        '<option value="">Nenhum</option>'+
        state.produtos.map(function(p){ return '<option value="'+p.id+'" '+(c.produtoCouvertId===p.id?"selected":"")+'>'+escapeHtml(p.nome)+'</option>'; }).join("")+
      '</select></div>'+
      '<div class="field" style="margin-bottom:0;"><label>Janela de happy hour</label>'+
        '<div style="display:flex; gap:8px;">'+
          '<input id="cfgHappyInicio" type="time" value="'+(c.happyHoraInicio||"")+'">'+
          '<input id="cfgHappyFim" type="time" value="'+(c.happyHoraFim||"")+'">'+
        '</div></div>'+
    '</div>'+
    '<div class="card">'+
      '<div class="card-title">Delivery — taxa por bairro</div>'+
      '<p style="font-size:12px; color:var(--text-muted); margin:0 0 12px;">Cadastro manual (sem cálculo automático de distância).</p>'+
      Object.keys(c.bairrosTaxaEntrega||{}).map(function(b){
        return '<div class="pagamento-linha"><span class="forma">'+escapeHtml(b)+'</span>'+
          '<input type="number" min="0" step="0.01" value="'+(c.bairrosTaxaEntrega[b]/100).toFixed(2)+'" data-action="bairro-taxa-editar" data-bairro="'+escapeHtml(b)+'">'+
          '<button class="icon-btn" data-action="bairro-taxa-remover" data-bairro="'+escapeHtml(b)+'" style="color:var(--danger);">'+icon("x",14)+'</button></div>';
      }).join("")+
      '<div style="display:flex; gap:8px; margin-top:8px;">'+
        '<input id="novoBairroNome" placeholder="Bairro" style="flex:2;">'+
        '<input id="novoBairroTaxa" type="number" min="0" step="0.01" placeholder="R$" style="flex:1;">'+
        '<button class="btn btn-sm" data-action="bairro-taxa-adicionar">'+icon("plus",14)+'</button>'+
      '</div>'+
    '</div>'+
    '<div class="card">'+
      '<div class="card-title">Cardápio público (QR)</div>'+
      '<p style="font-size:12px; color:var(--text-muted); margin:0 0 12px;">Link somente leitura, sem login — nome, preço, categoria e foto dos produtos ativos. Gere um QR code a partir dele em qualquer serviço gratuito e imprima pra colocar nas mesas.</p>'+
      (c.slug ? '<div class="field"><label>Link do cardápio</label>'+
        '<div style="display:flex; gap:8px;">'+
          '<input id="cfgLinkCardapio" readonly value="'+escapeHtml(window.location.origin+"/cardapio/"+c.slug)+'" style="flex:1;">'+
          '<button type="button" class="btn" data-action="cardapio-link-copiar">Copiar</button>'+
        '</div></div>' : '<div class="empty-hint">Cardápio público ainda não configurado (slug ausente).</div>')+
      '<div class="field" style="margin-bottom:0;"><label>Aceitar QR Code antigo (sem token) até</label>'+
        '<input id="cfgAceitarQrSemTokenAte" type="date" value="'+escapeHtml(c.aceitarQrSemTokenAte||"")+'">'+
        '<p style="font-size:11px; color:var(--text-muted); margin:6px 0 0;">Mesas → QR Codes gera link com token novo; isto aqui é só a carência pra link impresso antes (0.6). Apague a data pra desligar agora — QR sem token para de funcionar na hora.</p></div>'+
    '</div>'+
  '</div>';
}
function renderConfigImpressao(){
  var c = state.config;
  return '<div class="grid-2">'+
    '<div class="card">'+
      '<div class="card-title">Impressão</div>'+
      '<div class="field"><label>Largura da impressora</label><select id="cfgImpressora">'+
        '<option value="80mm" '+(c.impressoraLargura==="80mm"?"selected":"")+'>80mm</option>'+
        '<option value="58mm" '+(c.impressoraLargura==="58mm"?"selected":"")+'>58mm</option>'+
      '</select></div>'+
      '<div class="field" style="margin-bottom:0;"><label>Mensagem de rodapé do recibo</label><input id="cfgRodape" value="'+escapeHtml(c.reciboRodape)+'"></div>'+
    '</div>'+
  '</div>';
}
function renderConfigSeguranca(){
  return '<div class="grid-2">'+
    '<div class="card">'+
      '<div class="card-title">Verificação em duas etapas (sua conta)</div>'+
      '<p style="font-size:12px; color:var(--text-muted); margin:0 0 12px;">Código de um app autenticador (Google Authenticator, Authy etc.) além do PIN, só pra esta conta ADMIN.</p>'+
      (state.mfaFactors.length ? state.mfaFactors.map(function(f){
        return '<div class="data-row"><div class="main"><div class="nome">Ativada</div><div class="sub">desde '+new Date(f.created_at).toLocaleDateString("pt-BR")+'</div></div>'+
          '<button class="btn btn-sm" data-action="mfa-desativar" data-fator="'+f.id+'" style="color:var(--danger);">Desativar</button></div>';
      }).join("") : '<button class="btn" data-action="mfa-ativar-abrir">Ativar</button>')+
    '</div>'+
  '</div>';
}
SUB_ABAS.configuracoes = [
  {id:"geral", rotulo:"Geral", render:renderConfigGeral},
  {id:"vendas", rotulo:"Vendas e pagamento", render:renderConfigVendas},
  {id:"metas", rotulo:"Metas e alertas", render:renderConfigMetas},
  {id:"atendimento", rotulo:"Atendimento", render:renderConfigAtendimento},
  {id:"impressao", rotulo:"Impressão", render:renderConfigImpressao},
  {id:"seguranca", rotulo:"Segurança", render:renderConfigSeguranca}
];
function renderConfiguracoes(){
  return renderPageHeader("settings", "Configurações", "Dados fiscais, limites, impressão e funcionamento")+
    renderSyncConflitos()+
    renderPendenciasOfflineRecusadas()+
    renderSubAbas("configuracoes")+
    '<button class="btn btn-primary btn-lg" style="margin-top:16px;" data-action="config-salvar">Salvar configurações</button>';
}

