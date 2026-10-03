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

  return renderPageHeader("utensils", "Atendimento", "Mapa de salão em tempo real",
      (can(PERM.COMANDA_ABRIR) ? '<div class="action-row" style="flex:0 0 auto;">'+
        '<button class="btn btn-primary" data-action="balcao-abrir">'+icon("plus",15)+' Balcão</button>'+
        '<button class="btn btn-primary" data-action="ficha-abrir">'+icon("plus",15)+' Ficha</button>'+
      '</div>' : ''))+
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

function renderComanda(){
  var comanda = state.comandas.find(function(c){ return c.id===state.viewParams.comandaId; });
  if(!comanda) return '<div class="empty-hint">Comanda não encontrada.</div>';
  if(!state.draft || state.draft.comandaId!==comanda.id) irParaComanda(comanda.id);
  var mesa = state.mesas.find(function(m){ return m.id===comanda.mesaId; });
  var t = totaisComanda(comanda);
  var podeFechar = can(PERM.COMANDA_FECHAR) && comanda.status==="ABERTA" && comanda.itens.length>0;
  var podeCancelarComanda = can(PERM.COMANDA_ABRIR) && comanda.status==="ABERTA" && comanda.itens.length===0;
  var podeLancar = can(PERM.ITEM_LANCAR) && comanda.status==="ABERTA";
  // Fase 0.6 — se o pagamento travou (aba fechou no meio), libera reabrir
  // manualmente depois de 10 minutos em FECHANDO; nunca reabre sozinho.
  var podeReabrir = can(PERM.COMANDA_REABRIR) && comanda.status==="FECHANDO" && comanda.updatedAt && minutosDesde(comanda.updatedAt)>10;
  var draftCount = Object.keys(state.draft.itens).reduce(function(s,k){ return s+state.draft.itens[k].qtd; },0);

  var sentItemsHtml = comanda.itens.length ? comanda.itens.map(function(it){
    // Fase 0.3: cancelar item agora exige PIN de supervisor validado no
    // servidor (RPC cancelar_item) sempre — a trava real não é mais essa
    // checagem de permissão do próprio usuário, só decide se o botão
    // aparece. Qualquer um que lança item também pode pedir cancelamento.
    var podeCancel = it.status!=="CANCELADO" && it.status!=="ENTREGUE" && can(PERM.ITEM_LANCAR);
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
      return '<div class="cat-tab '+(c===state.draft.categoria?"active":"")+'" data-action="picker-cat" data-cat="'+escapeHtml(c)+'">'+escapeHtml(c)+'</div>';
    }).join("")+'</div>'+
    '<div class="product-grid">'+produtosFiltrados.map(function(p){
      if(p.esgotado){
        return '<div class="product-card" style="opacity:.4; cursor:not-allowed;">'+
          '<div class="nome">'+escapeHtml(p.nome)+'</div><div class="preco" style="color:var(--text-muted);">ESGOTADO</div></div>';
      }
      return '<div class="product-card" data-action="draft-mais" data-produto="'+p.id+'">'+
        (p.fotoUrl ? '<img class="thumb" src="'+escapeHtml(p.fotoUrl)+'" onerror="this.style.display=\'none\'">' : '')+
        '<div class="nome">'+escapeHtml(p.nome)+'</div><div class="preco">'+brl(p.precoCentavos)+'</div></div>';
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
        '<div class="totais-linha total"><span>Total</span><span>'+brl(t.total)+'</span></div>'+
      '</div>'+
      '<div class="action-row">'+
        // idem: desconto acima do limite (ou sem a permissão) pede PIN de
        // supervisor pelo RPC aplicar_desconto; dentro do limite e com a
        // permissão, aplica direto — mesma regra de negócio de antes.
        (can(PERM.COMANDA_ABRIR) && comanda.status==="ABERTA" ? '<button class="btn" data-action="desconto-abrir">Desconto</button>' : '')+
        '<label class="btn" style="cursor:pointer;"><input type="checkbox" data-action="toggle-taxa" '+(comanda.taxaServicoAtiva?"checked":"")+' style="margin-right:6px;">Taxa</label>'+
      '</div>'+
      (podeFechar ? '<button class="btn btn-danger btn-lg btn-block" data-action="fechar-conta-abrir">Fechar conta · '+brl(t.total)+'</button>' : '')+
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
    '<div class="split '+(state.draft.mobileCatalog?"mobile-catalog":"")+'">'+
      '<div class="split-main">'+catalogHtml+'</div>'+
      '<div class="split-side">'+orderPanel+'</div>'+
    '</div>'+
    (podeLancar ? '<button class="fab" data-action="toggle-mobile-catalog">'+icon(state.draft.mobileCatalog?"check":"plus",24)+'</button>' : '');
}

function renderKds(){
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
      return '<div class="kanban-col" data-status="'+status+'">'+
        '<div class="kanban-col-head"><span class="t">'+col[1]+'</span><span class="n">'+lista.length+'</span></div>'+
        (ordem.length ? ordem.map(function(comandaId){
          var ticket = porComanda[comandaId];
          var minTicket = Math.max.apply(null, ticket.itens.map(function(it){ return minutosDesde(it.enviadoEm); }));
          var atrasoTicket = minTicket>10;
          return '<div class="kanban-card col-'+status+'">'+
            '<div class="kanban-card-top"><span class="codigo">'+ticket.codigo+'</span><span class="tempo '+(atrasoTicket?"atraso":"")+'">'+icon("clock",11)+' '+fmtMin(minTicket)+'</span></div>'+
            '<div class="mesa">'+ticket.rotulo.toUpperCase()+'</div>'+
            ticket.itens.map(function(item){
              var min = minutosDesde(item.enviadoEm);
              var atraso = min>10;
              var user = state.usuarios.find(function(u){ return u.id===item.usuarioId; });
              var setorItem = item.setorProducao||"COZINHA";
              return '<div class="kanban-item" draggable="true" data-comanda="'+comandaId+'" data-item="'+item.id+'">'+
                '<div class="produto">'+item.quantidade+'x '+escapeHtml(item.nome).toUpperCase()+' <span class="tempo '+(atraso?"atraso":"")+'" style="float:right;">'+fmtMin(min)+'</span></div>'+
                '<span class="badge" style="background:rgba(255,255,255,.08); color:'+SETOR_COR[setorItem]+'; margin-top:4px;">'+setorItem+'</span>'+
                (item.observacao?'<div class="obs">'+escapeHtml(item.observacao)+'</div>':'')+
                (user?'<div class="garcom">Garçom: '+escapeHtml(user.nome)+'</div>':'')+
                (can(PERM.ITEM_STATUS) ? '<button class="btn '+(status==="PRONTO"?"btn-success":"btn-primary")+' btn-block btn-sm" style="margin-top:8px;" data-action="kds-set" data-comanda="'+comandaId+'" data-item="'+item.id+'" data-status="'+nextStatus[status]+'">'+col[2]+'</button>' : '')+
              '</div>';
            }).join("")+
          '</div>';
        }).join("") : '<div class="empty-hint">Vazio</div>')+
      '</div>';
    }).join("")+
  '</div>';

  return '<div class="kds-grande">'+
    renderPageHeader("chef", "Cozinha", total+" pedidos ativos")+
    kpisHtml+
    '<div class="tabs">'+setorTabs.map(function(s){ return '<div class="chip '+(setorFiltro===s?"chip-active":"")+'" data-action="kds-filtro" data-f="'+s+'">'+(s==="TODOS"?"Todos":s)+'</div>'; }).join("")+'</div>'+
    (cancelados.length ? '<div class="alert-row danger">'+icon("alert",16)+'<div><span class="t">CANCELADO DEPOIS DE PRONTO/EM PREPARO — PARE</span><span class="d">'+
      cancelados.map(function(c){ return c.rotulo+' · '+c.item.quantidade+'x '+escapeHtml(c.item.nome); }).join(" · ")+
      '</span></div></div>' : '')+
    '<div style="margin-bottom:14px;">'+cargaHtml+'</div>'+
    kanbanHtml+
  '</div>';
}

function renderCaixa(){
  if(!state.caixaSessao || state.caixaSessao.status==="FECHADA"){
    var ultima = state.caixaSessao;
    return renderPageHeader("wallet", "Caixa", "Nenhuma sessão aberta")+
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
          '<button class="icon-btn" data-action="produto-editar" data-produto="'+p.id+'">'+icon("edit",15)+'</button>'+
        '</div>' : '')+
      '</div>';
    }).join("") : '<div class="empty-hint">Nenhum produto nesta categoria.</div>')+
    '</div>';
}

function estoqueStatus(i){
  if(i.estoqueAtual < i.estoqueMinimo) return {lbl:"Crítico", cls:"badge-status-critico"};
  if(i.estoqueAtual <= i.estoqueMinimo*1.2) return {lbl:"Repor", cls:"badge-status-atencao"};
  return {lbl:"OK", cls:"badge-status-ok"};
}
function renderEstoque(){
  var podeEditar = can(PERM.ESTOQUE);
  var baixos = state.insumos.filter(function(i){ return i.estoqueAtual<i.estoqueMinimo; });
  var valorEstoque = state.insumos.reduce(function(s,i){ return s + Math.round(i.estoqueAtual*i.custoMedioCentavos); },0);
  return renderPageHeader("package", "Estoque", state.insumos.length+" insumos · "+baixos.length+" abaixo do mínimo",
      (podeEditar ? '<button class="btn btn-primary" data-action="insumo-mov-abrir" data-tipo="ENTRADA">'+icon("plus",15)+' Nova entrada</button>' : ''))+
    '<div class="metric-grid">'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("package",20)+'</div><div class="kpi-body"><div class="kpi-label">Insumos cadastrados</div><div class="kpi-value">'+state.insumos.length+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon" style="background:rgba(239,68,68,.14); color:var(--danger);">'+icon("alert",20)+'</div><div class="kpi-body"><div class="kpi-label">Abaixo do mínimo</div><div class="kpi-value">'+baixos.length+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("wallet",20)+'</div><div class="kpi-body"><div class="kpi-label">Valor em estoque</div><div class="kpi-value">'+brl(valorEstoque)+'</div></div></div>'+
      '<div class="kpi-card"><div class="kpi-icon">'+icon("clock",20)+'</div><div class="kpi-body"><div class="kpi-label">Movimentos recentes</div><div class="kpi-value">'+state.estoqueMovimentos.length+'</div></div></div>'+
    '</div>'+
    (baixos.length ? baixos.map(function(i){
      return '<div class="alert-row danger">'+icon("alert",16)+'<div><span class="t">ESTOQUE BAIXO</span><span class="d">'+escapeHtml(i.nome)+' — '+i.estoqueAtual+' '+i.unidade+' (mín. '+i.estoqueMinimo+')</span></div></div>';
    }).join("") : "")+
    '<div class="card"><div style="overflow-x:auto;"><table class="table-dark"><thead><tr><th>Produto</th><th>Quantidade</th><th>Unidade</th><th>Mínimo</th><th>Status</th>'+(podeEditar?'<th></th>':'')+'</tr></thead><tbody>'+
    state.insumos.map(function(i){
      var st = estoqueStatus(i);
      var rend = state.insumoRendimentos.find(function(r){ return r.insumoId===i.id; });
      return '<tr><td><div style="font-weight:700;">'+escapeHtml(i.nome)+'</div>'+
          '<div style="font-size:10.5px; color:var(--text-muted);">custo médio '+brl(i.custoMedioCentavos)+'/'+i.unidade+(rend ? ' · rendimento '+Math.round(rend.fator*100)+'%' : '')+'</div></td>'+
        '<td>'+i.estoqueAtual+'</td><td>'+i.unidade+'</td><td>'+i.estoqueMinimo+'</td>'+
        '<td><span class="badge '+st.cls+'">'+st.lbl+'</span></td>'+
        (podeEditar ? '<td><div class="acts">'+
          '<button class="btn btn-sm" data-action="insumo-mov-abrir" data-tipo="ENTRADA" data-insumo="'+i.id+'">Entrada</button>'+
          '<button class="btn btn-sm" data-action="insumo-mov-abrir" data-tipo="SAIDA" data-insumo="'+i.id+'">Saída</button>'+
          '<button class="btn btn-sm" data-action="rendimento-abrir" data-insumo="'+i.id+'">Rendimento</button>'+
        '</div></td>' : '')+
      '</tr>';
    }).join("")+
    '</tbody></table></div></div>'+
    '<div class="section-label">Movimentações recentes</div>'+
    '<div class="card">'+(state.estoqueMovimentos.length ? state.estoqueMovimentos.slice().reverse().slice(0,20).map(function(m){
      var i = state.insumos.find(function(x){ return x.id===m.insumoId; });
      var cls = m.tipo==="ENTRADA" ? "ENTRADA" : "SAIDA";
      var sinal = m.tipo==="ENTRADA" ? "+" : "-";
      return '<div class="mov-row"><span><span class="mov-tipo '+cls+'">'+(m.tipo==="VENDA"?"VENDA":m.tipo)+'</span>'+(i?escapeHtml(i.nome):"?")+(m.motivo?" — "+escapeHtml(m.motivo):"")+'<div class="tag">'+new Date(m.createdAt).toLocaleString("pt-BR")+'</div></span><span>'+sinal+m.quantidade+' '+(i?i.unidade:"")+'</span></div>';
    }).join("") : '<div class="empty-hint">Nenhuma movimentação ainda.</div>')+'</div>';
}

function renderCompras(){
  var podeEditar = can(PERM.ESTOQUE);
  var statusLbl = {RASCUNHO:"Rascunho", PEDIDO_REALIZADO:"Pedido realizado", RECEBIDO:"Recebido"};
  var contagem = {RASCUNHO:0, PEDIDO_REALIZADO:0, RECEBIDO:0};
  state.pedidosCompra.forEach(function(p){ contagem[p.status] = (contagem[p.status]||0)+1; });
  return renderPageHeader("truck", "Compras", state.fornecedores.length+" fornecedores · "+state.pedidosCompra.length+" pedidos",
      (podeEditar ? '<div class="action-row" style="flex:0 0 auto;">'+
        '<button class="btn" data-action="fornecedor-novo">'+icon("plus",15)+' Fornecedor</button>'+
        (state.fornecedores.length ? '<button class="btn btn-primary" data-action="pedido-compra-novo">'+icon("plus",15)+' Pedido de compra</button>' : '')+
      '</div>' : ''))+
    '<div class="metric-grid">'+
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
        '<div class="sub">'+(f.contato?escapeHtml(f.contato)+' · ':'')+escapeHtml(f.telefone||"")+'</div></div>'+
        (podeEditar ? '<div class="acts"><button class="btn btn-sm" data-action="fornecedor-toggle-ativo" data-fornecedor="'+f.id+'">'+(f.ativo?"Desativar":"Reativar")+'</button></div>' : '')+
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
function renderFinanceiro(){
  var podeEditar = can(PERM.FINANCEIRO);
  var filtro = state.financeiroFiltro || "TODAS";
  var tabs = [["TODAS","Todas"],["PAGAR","A pagar"],["RECEBER","A receber"]];
  var hoje = diasA(0);
  var fimSemana = diasA(7);
  var lista = state.contas.filter(function(c){ return filtro==="TODAS" || c.tipo===filtro; })
    .sort(function(a,b){ return a.vencimento<b.vencimento?-1:1; });
  var contasPagar = state.contas.filter(function(c){ return c.tipo==="PAGAR"; });
  var contasReceber = state.contas.filter(function(c){ return c.tipo==="RECEBER"; });

  return renderPageHeader("landmark", "Financeiro", "Contas a pagar e a receber",
      (podeEditar ? '<button class="btn btn-primary" data-action="conta-nova">'+icon("plus",15)+' Nova conta</button>' : ''))+
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

function renderRelatorios(){
  var periodo = state.relatorioPeriodo || "HOJE";
  var periodos = [["HOJE","Hoje"],["7D","7 dias"],["30D","30 dias"],["MES","Escolher mês"]];

  var cabecalho = renderPageHeader("chart", "Relatórios", "Desempenho de vendas")+
    '<div class="tabs">'+periodos.map(function(p){ return '<div class="tab '+(periodo===p[0]?"active":"")+'" data-action="relatorio-periodo" data-p="'+p[0]+'">'+p[1]+'</div>'; }).join("")+'</div>'+
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

function renderEquipe(){
  var podeEditar = can(PERM.EQUIPE);
  var ativos = state.usuarios.filter(function(u){ return u.ativo; }).length;
  var inativos = state.usuarios.length - ativos;
  var porPapel = {};
  state.usuarios.forEach(function(u){ porPapel[u.papel] = (porPapel[u.papel]||0)+1; });
  var papeis = Object.keys(porPapel).sort();

  return renderPageHeader("users", "Equipe", state.usuarios.length+" usuários cadastrados",
      (podeEditar ? '<button class="btn btn-primary" data-action="usuario-novo">'+icon("plus",15)+' Novo usuário</button>' : ''))+
    '<div class="metric-grid">'+
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
        '<div class="sub"><span class="badge" style="background:rgba(255,255,255,.08); color:'+(PAPEL_COR[u.papel]||"var(--text-secondary)")+';">'+u.papel+'</span></div></div>'+
        (podeEditar ? '<div class="acts">'+
          '<button class="btn btn-sm" data-action="usuario-trocar-pin" data-usuario="'+u.id+'">Trocar PIN</button>'+
          '<button class="btn btn-sm" data-action="usuario-toggle-ativo" data-usuario="'+u.id+'">'+(u.ativo?"Desativar":"Reativar")+'</button>'+
        '</div>' : '')+
      '</div>';
    }).join("")+
    '</div>';
}

function renderConfiguracoes(){
  var c = state.config;
  return renderPageHeader("settings", "Configurações", "Dados fiscais, limites, impressão e funcionamento")+
    '<div class="grid-2">'+
    '<div class="card">'+
      '<div class="card-title">Geral</div>'+
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
    '<div class="card">'+
      '<div class="card-title">Taxas e limites</div>'+
      '<div class="field"><label>Taxa de serviço padrão (%)</label><input id="cfgTaxa" type="number" min="0" max="30" step="1" value="'+c.taxaServicoPctPadrao+'"></div>'+
      '<div class="field"><label>Limite de desconto sem supervisor (%)</label><input id="cfgDesconto" type="number" min="0" max="100" step="1" value="'+c.limiteDescontoPct+'"></div>'+
      '<div class="field"><label>Limite de diferença de caixa tolerada</label><input id="cfgDiferenca" type="number" min="0" step="0.01" value="'+(c.limiteDiferencaCentavos/100).toFixed(2)+'"></div>'+
      '<div class="field" style="margin-bottom:0;"><label>Alertar sangria quando dinheiro em gaveta passar de</label><input id="cfgAlertaSangria" type="number" min="0" step="0.01" value="'+(c.limiteAlertaSangriaCentavos/100).toFixed(2)+'"></div>'+
    '</div>'+
    '<div class="card">'+
      '<div class="card-title">Impressão</div>'+
      '<div class="field"><label>Largura da impressora</label><select id="cfgImpressora">'+
        '<option value="80mm" '+(c.impressoraLargura==="80mm"?"selected":"")+'>80mm</option>'+
        '<option value="58mm" '+(c.impressoraLargura==="58mm"?"selected":"")+'>58mm</option>'+
      '</select></div>'+
      '<div class="field" style="margin-bottom:0;"><label>Mensagem de rodapé do recibo</label><input id="cfgRodape" value="'+escapeHtml(c.reciboRodape)+'"></div>'+
    '</div>'+
    '<div class="card">'+
      '<div class="card-title">Cardápio público (QR)</div>'+
      '<p style="font-size:12px; color:var(--text-muted); margin:0 0 12px;">Link somente leitura, sem login — nome, preço, categoria e foto dos produtos ativos. Gere um QR code a partir dele em qualquer serviço gratuito e imprima pra colocar nas mesas.</p>'+
      (c.slug ? '<div class="field" style="margin-bottom:0;"><label>Link do cardápio</label>'+
        '<div style="display:flex; gap:8px;">'+
          '<input id="cfgLinkCardapio" readonly value="'+escapeHtml(window.location.origin+"/cardapio/"+c.slug)+'" style="flex:1;">'+
          '<button type="button" class="btn" data-action="cardapio-link-copiar">Copiar</button>'+
        '</div></div>' : '<div class="empty-hint">Cardápio público ainda não configurado (slug ausente).</div>')+
    '</div>'+
    '</div>'+
    '<button class="btn btn-primary btn-lg" style="margin-top:16px;" data-action="config-salvar">Salvar configurações</button>';
}

