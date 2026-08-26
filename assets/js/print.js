"use strict";

// ---------- impressão (comprovante não fiscal / fechamento de caixa) ----------

function imprimir(html){
  state.printHtml = html;
  render();
  setTimeout(function(){
    window.print();
  }, 50);
}

function buildReciboHtml(comanda){
  var mesa = state.mesas.find(function(m){ return m.id===comanda.mesaId; });
  var t = totaisComanda(comanda);
  var atendente = state.usuarios.find(function(u){ return u.id===comanda.usuarioAbertura; });
  var largura = state.config.impressoraLargura==="58mm" ? "58mm" : "80mm";
  var itensHtml = comanda.itens.filter(function(it){ return it.status!=="CANCELADO"; }).map(function(it){
    return '<div class="line"><span>'+it.quantidade+'x '+escapeHtml(it.nome)+'</span><span>'+brl(it.precoUnitCentavos*it.quantidade)+'</span></div>';
  }).join("");
  var pagamentosHtml = (comanda.pagamentos||[]).map(function(p){
    return '<div class="line"><span>'+p.forma+'</span><span>'+brl(p.valorCentavos)+'</span></div>';
  }).join("");
  return '<div class="receipt-preview" style="width:'+largura+'; max-width:'+largura+';">'+
    '<img class="receipt-logo" src="assets/logo/rancho-netto-dark.png" alt="">'+
    '<div class="center bold">'+escapeHtml(state.config.empresaNome)+'</div>'+
    '<div class="center">'+escapeHtml(state.config.empresaCnpj)+'</div>'+
    '<hr>'+
    '<div class="center bold">COMPROVANTE DE PAGAMENTO</div>'+
    '<div class="center">NÃO É DOCUMENTO FISCAL</div>'+
    '<hr>'+
    '<div class="line"><span>Comanda</span><span>'+comanda.codigo+'</span></div>'+
    '<div class="line"><span>Mesa</span><span>'+(mesa?mesa.numero:"-")+'</span></div>'+
    '<div class="line"><span>Data</span><span>'+new Date(comanda.fechamento).toLocaleString("pt-BR")+'</span></div>'+
    '<div class="line"><span>Atendente</span><span>'+(atendente?escapeHtml(atendente.nome):"-")+'</span></div>'+
    '<hr>'+
    itensHtml+
    '<hr>'+
    '<div class="line"><span>Subtotal</span><span>'+brl(t.subtotal)+'</span></div>'+
    (t.desconto>0 ? '<div class="line"><span>Desconto</span><span>-'+brl(t.desconto)+'</span></div>' : '')+
    '<div class="line"><span>Taxa de serviço ('+t.taxaPct+'%)</span><span>'+brl(t.taxa)+'</span></div>'+
    '<div class="line bold"><span>TOTAL</span><span>'+brl(t.total)+'</span></div>'+
    '<hr>'+
    pagamentosHtml+
    (comanda.trocoCentavos>0 ? '<div class="line"><span>Troco</span><span>'+brl(comanda.trocoCentavos)+'</span></div>' : '')+
    '<hr>'+
    '<div class="center">'+escapeHtml(state.config.reciboRodape)+'</div>'+
  '</div>';
}

function buildFechamentoHtml(sessao){
  var abertura = state.usuarios.find(function(u){ return u.id===sessao.usuarioAbertura; });
  var fechador = state.usuarios.find(function(u){ return u.id===sessao.usuarioFechamento; });
  var movs = state.caixaMovimentos.filter(function(m){ return m.sessaoId===sessao.id; });
  var det = sessao.fechamentoDetalhe || {esperados:{}, informados:{}, diffs:{}};
  var formas = Object.keys(det.esperados);
  var sangrias = movs.filter(function(m){ return m.tipo==="SANGRIA"; });
  var suprimentos = movs.filter(function(m){ return m.tipo==="SUPRIMENTO"; });
  var largura = state.config.impressoraLargura==="58mm" ? "58mm" : "80mm";
  return '<div class="receipt-preview" style="width:'+largura+'; max-width:'+largura+';">'+
    '<img class="receipt-logo" src="assets/logo/rancho-netto-dark.png" alt="">'+
    '<div class="center bold">'+escapeHtml(state.config.empresaNome)+'</div>'+
    '<div class="center bold">FECHAMENTO DE CAIXA</div>'+
    '<hr>'+
    '<div class="line"><span>Terminal</span><span>'+escapeHtml(sessao.terminal)+'</span></div>'+
    '<div class="line"><span>Abertura</span><span>'+new Date(sessao.aberturaEm).toLocaleString("pt-BR")+'</span></div>'+
    '<div class="line"><span>Fechamento</span><span>'+new Date(sessao.fechamentoEm).toLocaleString("pt-BR")+'</span></div>'+
    '<div class="line"><span>Aberto por</span><span>'+(abertura?escapeHtml(abertura.nome):"-")+'</span></div>'+
    '<div class="line"><span>Fechado por</span><span>'+(fechador?escapeHtml(fechador.nome):"-")+'</span></div>'+
    '<hr><div class="bold">VENDAS POR FORMA</div>'+
    formas.map(function(f){ return '<div class="line"><span>'+f+'</span><span>'+brl(det.esperados[f])+'</span></div>'; }).join("")+
    '<hr>'+
    '<div class="line"><span>Saldo inicial</span><span>'+brl(sessao.saldoInicialCentavos)+'</span></div>'+
    (sangrias.length ? '<div class="line"><span>Sangrias ('+sangrias.length+')</span><span>-'+brl(sangrias.reduce(function(s,m){return s+m.valorCentavos;},0))+'</span></div>' : '')+
    (suprimentos.length ? '<div class="line"><span>Suprimentos ('+suprimentos.length+')</span><span>+'+brl(suprimentos.reduce(function(s,m){return s+m.valorCentavos;},0))+'</span></div>' : '')+
    '<hr>'+
    '<div class="line"><span>Esperado (dinheiro)</span><span>'+brl(det.esperados.DINHEIRO||0)+'</span></div>'+
    '<div class="line"><span>Informado (dinheiro)</span><span>'+brl(det.informados.DINHEIRO||0)+'</span></div>'+
    '<div class="line bold"><span>Diferença</span><span>'+brl(sessao.diferencaCentavos||0)+'</span></div>'+
    '<hr>'+
    '<div class="center">Relatório gerado localmente — conferência interna</div>'+
  '</div>';
}

