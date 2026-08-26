"use strict";

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
  var horas = []; for(var h=11; h<=23; h++) horas.push(h);
  var maxHora = Math.max(1, Math.max.apply(null, horas.map(function(h){ return porHora[h]||0; })));

  var livres = state.mesas.filter(function(m){ return mesaStatus(m.id)==="livre"; }).length;
  var ocup = state.mesas.filter(function(m){ return mesaStatus(m.id)==="ocupada"; }).length;
  var aguardando = state.mesas.filter(function(m){ return mesaStatus(m.id)==="pagamento"; }).length;

  var kds = itensKdsAtivos();

  var alerts = [];
  state.mesas.forEach(function(m){
    var min = mesaMinutos(m.id);
    if(mesaStatus(m.id)!=="livre" && min>=60) alerts.push({t:"MESA ATRASADA", d:"Mesa "+m.numero+" · "+fmtMin(min), danger:true});
  });
  if(!state.caixaSessao || state.caixaSessao.status!=="ABERTA"){
    alerts.push({t:"CAIXA FECHADO", d:"Abra o caixa para registrar pagamentos"});
  }
  var ultimaFechada = state.caixaSessao && state.caixaSessao.status==="FECHADA" ? state.caixaSessao : null;
  if(ultimaFechada && ultimaFechada.diferencaCentavos){
    alerts.push({t:"DIFERENÇA NO ÚLTIMO CAIXA", d:brl(ultimaFechada.diferencaCentavos), danger:Math.abs(ultimaFechada.diferencaCentavos)>limiteDiferencaCentavos()});
  }
  if(["ADMIN","GERENTE"].indexOf(u.papel)!==-1 && state.caixaSessao && state.caixaSessao.status==="ABERTA" && saldoDinheiroEsperado()>state.config.limiteAlertaSangriaCentavos){
    alerts.push({t:"FAÇA UMA SANGRIA", d:"Dinheiro em gaveta acima do limite configurado", danger:true});
  }

  return '<div class="page-header"><div><div class="page-title">Bom dia, '+escapeHtml(u.nome).toUpperCase()+'</div>'+
      '<div class="page-sub">Operação de hoje · '+new Date().toLocaleDateString("pt-BR",{day:"2-digit",month:"short",year:"numeric"}).toUpperCase()+'</div></div>'+
    '</div>'+
    '<div class="metric-grid">'+
      '<div class="metric-card"><div class="metric-label">Vendas hoje</div><div class="metric-value">'+brl(vendasHoje)+'</div></div>'+
      '<div class="metric-card"><div class="metric-label">Pedidos</div><div class="metric-value">'+nPedidos+'</div></div>'+
      '<div class="metric-card"><div class="metric-label">Ticket médio</div><div class="metric-value">'+brl(ticketMedio)+'</div></div>'+
      '<div class="metric-card"><div class="metric-label">Mesas ocupadas</div><div class="metric-value">'+ocupadas+' / '+state.mesas.length+'</div></div>'+
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
      return '<div class="alert-row '+(a.danger?"danger":"")+'">'+icon("alert",16)+'<div><span class="t">'+a.t+'</span><span class="d">'+a.d+'</span></div></div>';
    }).join("") : '<div class="empty-hint">Nenhum alerta no momento.</div>');
}

function renderSalao(){
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
    return '<div class="mesa-block '+st+'" data-action="mesa-open" data-mesa="'+m.id+'">'+
      '<div class="mesa-top"><div class="num">'+String(m.numero).padStart(2,"0")+'</div><div class="label">Mesa</div></div>'+
      (st==="livre" ?
        '<div><div class="mesa-mid">'+m.capacidade+' lugares</div><div class="mesa-status-txt" style="margin-top:8px;">Livre</div></div>'
        :
        '<div><div class="mesa-mid">'+m.capacidade+' lugares</div>'+
        '<div class="mesa-bottom"><span class="mesa-valor">'+brl(soma)+'</span>'+
        '<span class="mesa-time '+timeCls+'">'+icon("clock",11)+' '+fmtMin(min)+'</span></div></div>'
      )+
    '</div>';
  }).join("");
  var comandasAbertas = state.comandas.filter(function(c){ return c.status==="ABERTA" || c.status==="FECHANDO"; });

  return '<div class="page-header"><div><div class="page-title">Atendimento</div><div class="page-sub">Mapa de salão em tempo real</div></div></div>'+
    '<div class="tabs">'+tabs.map(function(t){ return '<div class="tab '+(filtro===t[0]?"active":"")+'" data-action="salao-filtro" data-f="'+t[0]+'">'+t[1]+'</div>'; }).join("")+'</div>'+
    '<div class="grid-2">'+
      '<div class="mesas-grid">'+(cards||'<div class="empty-hint">Nenhuma mesa neste filtro.</div>')+'</div>'+
      '<div class="card comandas-side">'+
        '<div class="card-title">Comandas abertas</div>'+
        (comandasAbertas.length ? comandasAbertas.map(function(c){
          var mesa = state.mesas.find(function(m){ return m.id===c.mesaId; });
          var t = totaisComanda(c);
          return '<div class="item" data-action="comanda-open" data-comanda="'+c.id+'">'+
            '<div>Mesa '+(mesa?mesa.numero:"?")+'<div class="t">'+fmtMin(minutosDesde(c.abertura))+'</div></div>'+
            '<div>'+brl(t.total)+'</div>'+
          '</div>';
        }).join("") : '<div class="empty-hint">Salão livre no momento.</div>')+
      '</div>'+
    '</div>';
}

function renderComanda(){
  var comanda = state.comandas.find(function(c){ return c.id===state.viewParams.comandaId; });
  if(!comanda) return '<div class="empty-hint">Comanda não encontrada.</div>';
  if(!state.draft || state.draft.comandaId!==comanda.id) irParaComanda(comanda.id);
  var mesa = state.mesas.find(function(m){ return m.id===comanda.mesaId; });
  var t = totaisComanda(comanda);
  var podeFechar = can(PERM.COMANDA_FECHAR) && comanda.status==="ABERTA" && comanda.itens.length>0;
  var podeCancelarComanda = can(PERM.COMANDA_ABRIR) && comanda.status==="ABERTA" && comanda.itens.length===0;
  var podeLancar = can(PERM.ITEM_LANCAR) && comanda.status==="ABERTA";
  var draftCount = Object.keys(state.draft.itens).reduce(function(s,k){ return s+state.draft.itens[k].qtd; },0);

  var sentItemsHtml = comanda.itens.length ? comanda.itens.map(function(it){
    var podeCancel = it.status!=="CANCELADO" && it.status!=="ENTREGUE" && can(PERM.ITEM_CANCELAR);
    return '<div class="item-row">'+
      '<div class="info"><div class="nome">'+it.quantidade+'x '+escapeHtml(it.nome)+'</div>'+
      (it.observacao?'<div class="obs">'+escapeHtml(it.observacao)+'</div>':'')+
      '<div class="meta"><span class="status-badge status-'+it.status+'">'+it.status+'</span></div></div>'+
      '<div class="preco">'+brl(it.precoUnitCentavos*it.quantidade)+'</div>'+
      (podeCancel ? '<button class="icon-btn" data-action="item-cancelar" data-item="'+it.id+'" style="color:var(--danger);">'+icon("x",14)+'</button>' : '')+
    '</div>';
  }).join("") : '<div class="empty-hint">Nenhum item enviado ainda.</div>';

  var draftHtml = draftCount>0 ? Object.keys(state.draft.itens).map(function(pid){
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
  }).join("") : '<div class="empty-hint" style="padding:16px;">Toque num produto para adicionar.</div>';

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
      return '<div class="cat-tab '+(c===state.draft.categoria?"active":"")+'" data-action="picker-cat" data-cat="'+c+'">'+c+'</div>';
    }).join("")+'</div>'+
    '<div class="product-grid">'+produtosFiltrados.map(function(p){
      if(p.esgotado){
        return '<div class="product-card" style="opacity:.4; cursor:not-allowed;">'+
          '<div class="nome">'+escapeHtml(p.nome)+'</div><div class="preco" style="color:var(--text-muted);">ESGOTADO</div></div>';
      }
      return '<div class="product-card" data-action="draft-mais" data-produto="'+p.id+'">'+
        '<div class="nome">'+escapeHtml(p.nome)+'</div><div class="preco">'+brl(p.precoCentavos)+'</div></div>';
    }).join("")+'</div>';

  var orderPanel = '<div class="order-panel">'+
      '<div><div class="order-panel-title">Novo pedido — Mesa '+(mesa?mesa.numero:"?")+'</div>'+
      (podeLancar ? '<div style="margin-top:10px;">'+draftHtml+'</div>' : '')+
      (podeLancar && draftCount>0 ? '<button class="btn btn-primary btn-lg btn-block" style="margin-top:8px;" data-action="pedido-revisar-abrir">'+icon("check",16)+' Revisar e enviar ('+draftCount+')</button>' : '')+
      '</div>'+
      '<div><div class="order-panel-title" style="margin-bottom:8px;">Itens da comanda</div>'+sentItemsHtml+'</div>'+
      '<div class="totais-box">'+
        '<div class="totais-linha"><span>Subtotal</span><span>'+brl(t.subtotal)+'</span></div>'+
        (t.desconto>0 ? '<div class="totais-linha"><span>Desconto</span><span>-'+brl(t.desconto)+'</span></div>' : '')+
        '<div class="totais-linha"><span>Taxa de serviço ('+t.taxaPct+'%)</span><span>'+brl(t.taxa)+'</span></div>'+
        '<div class="totais-linha total"><span>Total</span><span>'+brl(t.total)+'</span></div>'+
      '</div>'+
      '<div class="action-row">'+
        (can(PERM.DESCONTO_APLICAR) && comanda.status==="ABERTA" ? '<button class="btn" data-action="desconto-abrir">Desconto</button>' : '')+
        '<label class="btn" style="cursor:pointer;"><input type="checkbox" data-action="toggle-taxa" '+(comanda.taxaServicoAtiva?"checked":"")+' style="margin-right:6px;">Taxa</label>'+
      '</div>'+
      (podeFechar ? '<button class="btn btn-danger btn-lg btn-block" data-action="fechar-conta-abrir">Fechar conta · '+brl(t.total)+'</button>' : '')+
      (podeCancelarComanda ? '<button class="btn btn-ghost btn-block" data-action="comanda-cancelar-confirmar" data-comanda="'+comanda.id+'" style="margin-top:8px; color:var(--danger); border-color:var(--danger);">'+icon("x",15)+' Cancelar comanda (mesa aberta por engano)</button>' : '')+
    '</div>';

  return '<div class="comanda-head">'+
      '<div><div class="titulo">MESA '+(mesa?mesa.numero:"?")+' <span style="color:var(--text-muted); font-size:14px;">· '+comanda.codigo+'</span></div>'+
      '<div class="sub">Aberta há '+fmtMin(minutosDesde(comanda.abertura))+' · '+comanda.status+'</div></div>'+
      '<button class="btn btn-ghost" data-action="nav-goto" data-view="salao">'+icon("arrowLeft",16)+' Salão</button>'+
    '</div>'+
    '<div class="split '+(state.draft.mobileCatalog?"mobile-catalog":"")+'">'+
      '<div class="split-main">'+catalogHtml+'</div>'+
      '<div class="split-side">'+orderPanel+'</div>'+
    '</div>'+
    (podeLancar ? '<button class="fab" data-action="toggle-mobile-catalog">'+icon(state.draft.mobileCatalog?"check":"plus",24)+'</button>' : '');
}

function renderKds(){
  var cols = [["PENDENTE","Pendente","INICIAR PREPARO"],["PREPARANDO","Preparando","MARCAR PRONTO"],["PRONTO","Pronto","ENTREGUE"]];
  var nextStatus = {PENDENTE:"PREPARANDO", PREPARANDO:"PRONTO", PRONTO:"ENTREGUE"};
  var abertas = state.comandas.filter(function(c){ return c.status==="ABERTA" || c.status==="FECHANDO"; });
  var cards = {PENDENTE:[], PREPARANDO:[], PRONTO:[]};
  var cancelados = [];
  abertas.forEach(function(c){
    var mesa = state.mesas.find(function(m){ return m.id===c.mesaId; });
    c.itens.forEach(function(it){
      if(cards[it.status]) cards[it.status].push({comandaId:c.id, codigo:c.codigo, item:it, mesaNum:mesa?mesa.numero:"?"});
      if(it.status==="CANCELADO" && it.canceladoAposPreparo) cancelados.push({comandaId:c.id, codigo:c.codigo, item:it, mesaNum:mesa?mesa.numero:"?"});
    });
  });
  var total = cards.PENDENTE.length+cards.PREPARANDO.length+cards.PRONTO.length;

  return '<div class="page-header"><div><div class="page-title">Cozinha</div><div class="page-sub">'+total+' pedidos ativos</div></div></div>'+
    (cancelados.length ? '<div class="alert-row danger">'+icon("alert",16)+'<div><span class="t">CANCELADO DEPOIS DE PRONTO/EM PREPARO — PARE</span><span class="d">'+
      cancelados.map(function(c){ return 'Mesa '+c.mesaNum+' · '+c.item.quantidade+'x '+escapeHtml(c.item.nome); }).join(" · ")+
      '</span></div></div>' : '')+
    '<div class="kanban">'+
    cols.map(function(col){
      var status = col[0], lista = cards[status];
      return '<div class="kanban-col" data-status="'+status+'">'+
        '<div class="kanban-col-head"><span class="t">'+col[1]+'</span><span class="n">'+lista.length+'</span></div>'+
        (lista.length ? lista.map(function(c){
          var min = minutosDesde(c.item.enviadoEm);
          var atraso = min>10;
          var user = state.usuarios.find(function(u){ return u.id===c.item.usuarioId; });
          return '<div class="kanban-card col-'+status+'" draggable="true" data-comanda="'+c.comandaId+'" data-item="'+c.item.id+'">'+
            '<div class="kanban-card-top"><span class="codigo">'+c.codigo+'</span><span class="tempo '+(atraso?"atraso":"")+'">'+icon("clock",11)+' '+fmtMin(min)+'</span></div>'+
            '<div class="mesa">MESA '+c.mesaNum+'</div>'+
            '<div class="produto">'+c.item.quantidade+'x '+escapeHtml(c.item.nome).toUpperCase()+'</div>'+
            (c.item.observacao?'<div class="obs">'+escapeHtml(c.item.observacao)+'</div>':'')+
            (user?'<div class="garcom">Garçom: '+escapeHtml(user.nome)+'</div>':'')+
            (can(PERM.ITEM_STATUS) ? '<button class="btn '+(status==="PRONTO"?"btn-success":"btn-primary")+' btn-block btn-sm" style="margin-top:10px;" data-action="kds-set" data-comanda="'+c.comandaId+'" data-item="'+c.item.id+'" data-status="'+nextStatus[status]+'">'+col[2]+'</button>' : '')+
          '</div>';
        }).join("") : '<div class="empty-hint">Vazio</div>')+
      '</div>';
    }).join("")+
  '</div>';
}

function renderCaixa(){
  if(!state.caixaSessao || state.caixaSessao.status==="FECHADA"){
    var ultima = state.caixaSessao;
    return '<div class="page-header"><div><div class="page-title">Caixa</div><div class="page-sub">Nenhuma sessão aberta</div></div></div>'+
      '<div class="card" style="max-width:420px;">'+
      (ultima ? '<div class="alert-row '+(ultima.diferencaCentavos?"danger":"")+'">'+icon("alert",16)+'<div><span class="t">ÚLTIMO FECHAMENTO</span><span class="d">Diferença de '+brl(ultima.diferencaCentavos||0)+'</span></div></div>' : '')+
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
  return '<div class="page-header"><div><div class="page-title">Caixa</div><div class="page-sub">'+s.terminal+'</div></div></div>'+
    '<div class="card caixa-status-card">'+
      '<div class="left"><div class="t"><span class="status-dot" style="display:inline-block; margin-right:6px;"></span>ABERTO</div>'+
      '<div class="d">Desde '+new Date(s.aberturaEm).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})+' · '+escapeHtml(usuarioAtual().nome)+'</div></div>'+
    '</div>'+
    (precisaSangria ? '<div class="alert-row danger">'+icon("alert",16)+'<div><span class="t">FAÇA UMA SANGRIA</span><span class="d">Dinheiro em gaveta passou de '+brl(state.config.limiteAlertaSangriaCentavos)+'</span></div></div>' : '')+
    '<div class="metric-grid">'+
      '<div class="metric-card"><div class="metric-label">Dinheiro em gaveta</div><div class="metric-value">'+(podeVerSaldoEsperado ? brl(esperadoDinheiro) : '••••••')+'</div>'+
      (podeVerSaldoEsperado ? '' : '<div style="font-size:10px; color:var(--text-muted); margin-top:4px; text-transform:uppercase; letter-spacing:.5px;">Oculto · conferência cega</div>')+
      '</div>'+
      Object.keys(porForma).map(function(f){
        return '<div class="metric-card"><div class="metric-label">'+f+'</div><div class="metric-value small">'+brl(porForma[f])+'</div></div>';
      }).join("")+
    '</div>'+
    '<div class="action-row">'+
      (can(PERM.SANGRIA) ? '<button class="btn" data-action="caixa-mov-abrir" data-tipo="SANGRIA">'+icon("minus",15)+' Sangria</button>' : '')+
      (can(PERM.SUPRIMENTO) ? '<button class="btn" data-action="caixa-mov-abrir" data-tipo="SUPRIMENTO">'+icon("plus",15)+' Suprimento</button>' : '')+
      (can(PERM.CAIXA_FECHAR) ? '<button class="btn btn-danger" data-action="caixa-fechar-abrir">Conferência cega</button>' : '')+
    '</div>'+
    '<div class="shortcut-hint"><span><kbd>F8</kbd> Sangria</span><span><kbd>ESC</kbd> Fechar popup</span><span><kbd>ENTER</kbd> Confirmar</span></div>'+
    '<div class="section-label">Movimentos da sessão</div>'+
    '<div class="card">'+(movs.length ? movs.slice().reverse().map(function(m){
      return '<div class="mov-row"><span><span class="mov-tipo '+m.tipo+'">'+m.tipo+'</span>'+(m.motivo?escapeHtml(m.motivo):escapeHtml(m.formaPagamento))+'<div class="tag">'+new Date(m.createdAt).toLocaleTimeString("pt-BR")+'</div></span><span>'+brl(m.valorCentavos)+'</span></div>';
    }).join("") : '<div class="empty-hint">Nenhum movimento ainda.</div>')+'</div>';
}

function renderAuditoria(){
  return '<div class="page-header"><div><div class="page-title">Auditoria</div><div class="page-sub">Trilha de ações sensíveis</div></div></div>'+
    '<div class="card">'+
    (state.auditoria.length ? state.auditoria.map(function(a){
      var u = state.usuarios.find(function(x){ return x.id===a.usuarioId; });
      return '<div class="mov-row"><span>'+a.acao+' — '+a.entidade+(a.motivo?' — '+escapeHtml(a.motivo):'')+'<div class="tag">'+(u?u.nome:"?")+' · '+new Date(a.createdAt).toLocaleString("pt-BR")+'</div></span></div>';
    }).join("") : '<div class="empty-hint">Nenhum evento sensível registrado ainda.</div>')+
    '</div>';
}

function renderCardapio(){
  var podeEditar = can(PERM.CARDAPIO);
  var filtro = state.cardapioFiltro || "Todos";
  var tabs = ["Todos"].concat(state.categorias);
  var lista = state.produtos.filter(function(p){ return filtro==="Todos" || p.categoria===filtro; });
  return '<div class="page-header"><div><div class="page-title">Cardápio</div><div class="page-sub">'+state.produtos.length+' produtos · '+state.categorias.length+' categorias</div></div>'+
      (podeEditar ? '<button class="btn btn-primary" data-action="produto-novo">'+icon("plus",15)+' Novo produto</button>' : '')+
    '</div>'+
    '<div class="tabs">'+tabs.map(function(c){ return '<div class="tab '+(filtro===c?"active":"")+'" data-action="cardapio-filtro" data-f="'+c+'">'+c+'</div>'; }).join("")+'</div>'+
    '<div class="card">'+
    (lista.length ? lista.map(function(p){
      return '<div class="data-row">'+
        '<div class="main"><div class="nome">'+escapeHtml(p.nome)+(p.esgotado?' <span class="badge badge-esgotado">Esgotado</span>':'')+(!p.ativo?' <span class="badge badge-inativo">Inativo</span>':'')+'</div>'+
        '<div class="sub">'+escapeHtml(p.categoria)+'</div></div>'+
        '<div class="num">'+brl(p.precoCentavos)+'</div>'+
        (podeEditar ? '<div class="acts">'+
          '<button class="btn btn-sm" data-action="produto-esgotar" data-produto="'+p.id+'">'+(p.esgotado?"Reativar":"Esgotar")+'</button>'+
          '<button class="icon-btn" data-action="produto-editar" data-produto="'+p.id+'">'+icon("edit",15)+'</button>'+
        '</div>' : '')+
      '</div>';
    }).join("") : '<div class="empty-hint">Nenhum produto nesta categoria.</div>')+
    '</div>';
}

function renderEstoque(){
  var podeEditar = can(PERM.ESTOQUE);
  var baixos = state.insumos.filter(function(i){ return i.estoqueAtual<=i.estoqueMinimo; });
  return '<div class="page-header"><div><div class="page-title">Estoque</div><div class="page-sub">'+state.insumos.length+' insumos · '+baixos.length+' abaixo do mínimo</div></div>'+
      (podeEditar ? '<button class="btn btn-primary" data-action="insumo-mov-abrir" data-tipo="ENTRADA">'+icon("plus",15)+' Nova entrada</button>' : '')+
    '</div>'+
    (baixos.length ? baixos.map(function(i){
      return '<div class="alert-row danger">'+icon("alert",16)+'<div><span class="t">ESTOQUE BAIXO</span><span class="d">'+escapeHtml(i.nome)+' — '+i.estoqueAtual+' '+i.unidade+' (mín. '+i.estoqueMinimo+')</span></div></div>';
    }).join("") : "")+
    '<div class="card">'+
    state.insumos.map(function(i){
      var pct = Math.max(4, Math.min(100, Math.round(i.estoqueAtual/(i.estoqueMinimo*2||1)*100)));
      var baixo = i.estoqueAtual<=i.estoqueMinimo;
      return '<div class="data-row">'+
        '<div class="main"><div class="nome">'+escapeHtml(i.nome)+' '+(baixo?'<span class="badge badge-baixo">Baixo</span>':'<span class="badge badge-ok">OK</span>')+'</div>'+
        '<div class="sub">'+i.estoqueAtual+' '+i.unidade+' em estoque · mínimo '+i.estoqueMinimo+' '+i.unidade+' · custo médio '+brl(i.custoMedioCentavos)+'/'+i.unidade+'</div>'+
        '<div class="stock-bar"><div class="stock-bar-fill '+(baixo?"low":"")+'" style="width:'+pct+'%"></div></div></div>'+
        (podeEditar ? '<div class="acts">'+
          '<button class="btn btn-sm" data-action="insumo-mov-abrir" data-tipo="ENTRADA" data-insumo="'+i.id+'">Entrada</button>'+
          '<button class="btn btn-sm" data-action="insumo-mov-abrir" data-tipo="SAIDA" data-insumo="'+i.id+'">Saída</button>'+
        '</div>' : '')+
      '</div>';
    }).join("")+
    '</div>'+
    '<div class="section-label">Movimentações recentes</div>'+
    '<div class="card">'+(state.estoqueMovimentos.length ? state.estoqueMovimentos.slice().reverse().slice(0,20).map(function(m){
      var i = state.insumos.find(function(x){ return x.id===m.insumoId; });
      var cls = m.tipo==="ENTRADA" ? "ENTRADA" : "SAIDA";
      var sinal = m.tipo==="ENTRADA" ? "+" : "-";
      return '<div class="mov-row"><span><span class="mov-tipo '+cls+'">'+(m.tipo==="VENDA"?"VENDA":m.tipo)+'</span>'+(i?escapeHtml(i.nome):"?")+(m.motivo?" — "+escapeHtml(m.motivo):"")+'<div class="tag">'+new Date(m.createdAt).toLocaleString("pt-BR")+'</div></span><span>'+sinal+m.quantidade+' '+(i?i.unidade:"")+'</span></div>';
    }).join("") : '<div class="empty-hint">Nenhuma movimentação ainda.</div>')+'</div>';
}

function renderFinanceiro(){
  var podeEditar = can(PERM.FINANCEIRO);
  var filtro = state.financeiroFiltro || "TODAS";
  var tabs = [["TODAS","Todas"],["PAGAR","A pagar"],["RECEBER","A receber"]];
  var hoje = diasA(0);
  var lista = state.contas.filter(function(c){ return filtro==="TODAS" || c.tipo===filtro; })
    .sort(function(a,b){ return a.vencimento<b.vencimento?-1:1; });
  var totalPagar = state.contas.filter(function(c){ return c.tipo==="PAGAR" && !c.pagoEm; }).reduce(function(s,c){ return s+c.valorCentavos; },0);
  var totalReceber = state.contas.filter(function(c){ return c.tipo==="RECEBER" && !c.pagoEm; }).reduce(function(s,c){ return s+c.valorCentavos; },0);
  var vencidas = state.contas.filter(function(c){ return !c.pagoEm && c.vencimento<hoje; }).length;
  return '<div class="page-header"><div><div class="page-title">Financeiro</div><div class="page-sub">Contas a pagar e a receber</div></div>'+
      (podeEditar ? '<button class="btn btn-primary" data-action="conta-nova">'+icon("plus",15)+' Nova conta</button>' : '')+
    '</div>'+
    '<div class="metric-grid">'+
      '<div class="metric-card"><div class="metric-label">A pagar (em aberto)</div><div class="metric-value" style="color:var(--danger);">'+brl(totalPagar)+'</div></div>'+
      '<div class="metric-card"><div class="metric-label">A receber (em aberto)</div><div class="metric-value" style="color:var(--success);">'+brl(totalReceber)+'</div></div>'+
      '<div class="metric-card"><div class="metric-label">Contas vencidas</div><div class="metric-value" style="color:var(--warning);">'+vencidas+'</div></div>'+
    '</div>'+
    '<div class="tabs">'+tabs.map(function(t){ return '<div class="tab '+(filtro===t[0]?"active":"")+'" data-action="financeiro-filtro" data-f="'+t[0]+'">'+t[1]+'</div>'; }).join("")+'</div>'+
    '<div class="card">'+
    (lista.length ? lista.map(function(c){
      var status = c.pagoEm ? "pago" : (c.vencimento<hoje ? "vencido" : "pendente");
      var statusLbl = {pago:"Pago", vencido:"Vencido", pendente:"Pendente"}[status];
      return '<div class="data-row">'+
        '<div class="main"><div class="nome">'+escapeHtml(c.descricao)+' <span class="badge badge-'+status+'">'+statusLbl+'</span></div>'+
        '<div class="sub">'+escapeHtml(c.categoria)+' · '+(c.tipo==="PAGAR"?"A pagar":"A receber")+' · vence '+new Date(c.vencimento+"T00:00:00").toLocaleDateString("pt-BR")+'</div></div>'+
        '<div class="num" style="color:'+(c.tipo==="PAGAR"?"var(--danger)":"var(--success)")+';">'+brl(c.valorCentavos)+'</div>'+
        (podeEditar && !c.pagoEm ? '<div class="acts"><button class="btn btn-sm btn-success" data-action="conta-pagar" data-conta="'+c.id+'">Marcar pago</button></div>' : '')+
      '</div>';
    }).join("") : '<div class="empty-hint">Nenhuma conta neste filtro.</div>')+
    '</div>';
}

function renderRelatorios(){
  var periodo = state.relatorioPeriodo || "HOJE";
  var dias = periodo==="HOJE" ? 0 : periodo==="7D" ? 7 : periodo==="30D" ? 30 : 99999;
  var limite = Date.now() - dias*86400000;
  var pagas = state.comandas.filter(function(c){
    if(c.status!=="PAGA" || !c.fechamento) return false;
    if(periodo==="HOJE") return new Date(c.fechamento).toDateString()===hojeStr();
    return new Date(c.fechamento).getTime()>=limite;
  });
  var totalVendas = pagas.reduce(function(s,c){ return s+totaisComanda(c).total; },0);
  var ticketMedio = pagas.length ? Math.round(totalVendas/pagas.length) : 0;

  var porProduto = {};
  pagas.forEach(function(c){
    c.itens.forEach(function(it){
      if(it.status==="CANCELADO") return;
      if(!porProduto[it.produtoId]) porProduto[it.produtoId] = {nome:it.nome, qtd:0, total:0};
      porProduto[it.produtoId].qtd += it.quantidade;
      porProduto[it.produtoId].total += it.precoUnitCentavos*it.quantidade;
    });
  });
  var ranking = Object.keys(porProduto).map(function(k){ return porProduto[k]; }).sort(function(a,b){ return b.total-a.total; }).slice(0,10);

  var porGarcom = {};
  pagas.forEach(function(c){
    var u = state.usuarios.find(function(x){ return x.id===c.usuarioAbertura; });
    var nome = u ? u.nome : "?";
    if(!porGarcom[nome]) porGarcom[nome] = {nome:nome, vendas:0, contas:0};
    porGarcom[nome].vendas += totaisComanda(c).total;
    porGarcom[nome].contas += 1;
  });
  var garcons = Object.keys(porGarcom).map(function(k){ return porGarcom[k]; }).sort(function(a,b){ return b.vendas-a.vendas; });

  var periodos = [["HOJE","Hoje"],["7D","7 dias"],["30D","30 dias"],["TUDO","Tudo"]];

  return '<div class="page-header"><div><div class="page-title">Relatórios</div><div class="page-sub">Desempenho de vendas</div></div></div>'+
    '<div class="tabs">'+periodos.map(function(p){ return '<div class="tab '+(periodo===p[0]?"active":"")+'" data-action="relatorio-periodo" data-p="'+p[0]+'">'+p[1]+'</div>'; }).join("")+'</div>'+
    '<div class="metric-grid">'+
      '<div class="metric-card"><div class="metric-label">Vendas no período</div><div class="metric-value">'+brl(totalVendas)+'</div></div>'+
      '<div class="metric-card"><div class="metric-label">Contas fechadas</div><div class="metric-value">'+pagas.length+'</div></div>'+
      '<div class="metric-card"><div class="metric-label">Ticket médio</div><div class="metric-value">'+brl(ticketMedio)+'</div></div>'+
    '</div>'+
    '<div class="grid-2">'+
      '<div class="card"><div class="card-title">Ranking de produtos</div>'+
        (ranking.length ? ranking.map(function(r,idx){
          return '<div class="ranking-row"><span class="pos">'+(idx+1)+'</span><div class="main"><div class="nome">'+escapeHtml(r.nome)+'</div><div class="sub">'+r.qtd+' unidades vendidas</div></div><div class="num">'+brl(r.total)+'</div></div>';
        }).join("") : '<div class="empty-hint">Sem vendas no período.</div>')+
      '</div>'+
      '<div class="card"><div class="card-title">Desempenho por garçom</div>'+
        (garcons.length ? garcons.map(function(g){
          return '<div class="data-row"><div class="main"><div class="nome">'+escapeHtml(g.nome)+'</div><div class="sub">'+g.contas+' conta(s) fechada(s)</div></div><div class="num">'+brl(g.vendas)+'</div></div>';
        }).join("") : '<div class="empty-hint">Sem vendas no período.</div>')+
      '</div>'+
    '</div>';
}

function renderEquipe(){
  var podeEditar = can(PERM.EQUIPE);
  return '<div class="page-header"><div><div class="page-title">Equipe</div><div class="page-sub">'+state.usuarios.length+' usuários cadastrados</div></div>'+
      (podeEditar ? '<button class="btn btn-primary" data-action="usuario-novo">'+icon("plus",15)+' Novo usuário</button>' : '')+
    '</div>'+
    '<div class="card">'+
    state.usuarios.map(function(u){
      return '<div class="data-row">'+
        '<div class="main"><div class="nome">'+escapeHtml(u.nome)+' '+(!u.ativo?'<span class="badge badge-inativo">Inativo</span>':'')+'</div>'+
        '<div class="sub">'+u.papel+'</div></div>'+
        (podeEditar ? '<div class="acts">'+
          '<button class="btn btn-sm" data-action="usuario-toggle-ativo" data-usuario="'+u.id+'">'+(u.ativo?"Desativar":"Reativar")+'</button>'+
        '</div>' : '')+
      '</div>';
    }).join("")+
    '</div>';
}

function renderConfiguracoes(){
  var c = state.config;
  return '<div class="page-header"><div><div class="page-title">Configurações</div><div class="page-sub">Dados fiscais, limites, impressão e funcionamento</div></div></div>'+
    '<div class="grid-2">'+
    '<div class="card">'+
      '<div class="card-title">Empresa</div>'+
      '<div class="field"><label>Nome da empresa</label><input id="cfgNome" value="'+escapeHtml(c.empresaNome)+'"></div>'+
      '<div class="field"><label>CNPJ</label><input id="cfgCnpj" value="'+escapeHtml(c.empresaCnpj)+'"></div>'+
      '<div class="field"><label>Chave PIX (recebimento)</label><input id="cfgChavePix" value="'+escapeHtml(c.chavePix)+'"></div>'+
      '<div class="field" style="margin-bottom:0;"><label>Horário de funcionamento</label>'+
        '<div style="display:flex; gap:8px;">'+
          '<input id="cfgHorarioAbertura" type="time" value="'+c.horarioAbertura+'">'+
          '<input id="cfgHorarioFechamento" type="time" value="'+c.horarioFechamento+'">'+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div class="card">'+
      '<div class="card-title">Limites e operação</div>'+
      '<div class="field"><label>Taxa de serviço padrão (%)</label><input id="cfgTaxa" type="number" min="0" max="30" step="1" value="'+c.taxaServicoPctPadrao+'"></div>'+
      '<div class="field"><label>Limite de desconto sem supervisor (%)</label><input id="cfgDesconto" type="number" min="0" max="100" step="1" value="'+c.limiteDescontoPct+'"></div>'+
      '<div class="field"><label>Limite de diferença de caixa tolerada</label><input id="cfgDiferenca" type="number" min="0" step="0.01" value="'+(c.limiteDiferencaCentavos/100).toFixed(2)+'"></div>'+
      '<div class="field" style="margin-bottom:0;"><label>Alertar sangria quando dinheiro em gaveta passar de</label><input id="cfgAlertaSangria" type="number" min="0" step="0.01" value="'+(c.limiteAlertaSangriaCentavos/100).toFixed(2)+'"></div>'+
    '</div>'+
    '<div class="card">'+
      '<div class="card-title">Impressão de comprovantes</div>'+
      '<div class="field"><label>Largura da impressora</label><select id="cfgImpressora">'+
        '<option value="80mm" '+(c.impressoraLargura==="80mm"?"selected":"")+'>80mm</option>'+
        '<option value="58mm" '+(c.impressoraLargura==="58mm"?"selected":"")+'>58mm</option>'+
      '</select></div>'+
      '<div class="field" style="margin-bottom:0;"><label>Mensagem de rodapé do recibo</label><input id="cfgRodape" value="'+escapeHtml(c.reciboRodape)+'"></div>'+
    '</div>'+
    '</div>'+
    '<button class="btn btn-primary btn-lg" style="margin-top:16px;" data-action="config-salvar">Salvar configurações</button>';
}

