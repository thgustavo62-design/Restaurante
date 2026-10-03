"use strict";

// ---------- dashboard helpers ----------
function comandasPagasHoje(){
  return state.vendasHoje;
}
function itensKdsAtivos(){
  var out = {PENDENTE:0, PREPARANDO:0, PRONTO:0};
  state.comandas.filter(function(c){ return c.status==="ABERTA" || c.status==="FECHANDO"; }).forEach(function(c){
    c.itens.forEach(function(it){ if(out[it.status]!==undefined) out[it.status]++; });
  });
  return out;
}

// Compartilhado pelo Dashboard (lista completa) e pelo sino de notificações
// do topbar (só a contagem) — um cálculo só, pra não duplicar a lógica.
function alertasOperacionais(){
  var u = usuarioAtual();
  var alerts = [];
  state.mesas.forEach(function(m){
    var min = mesaMinutos(m.id);
    if(mesaStatus(m.id)!=="livre" && min>=60) alerts.push({t:"MESA ATRASADA", d:"Mesa "+m.numero+" · "+fmtMin(min), danger:true, view:"salao"});
  });
  if(!state.caixaSessao || state.caixaSessao.status!=="ABERTA"){
    alerts.push({t:"CAIXA FECHADO", d:"Abra o caixa para registrar pagamentos", view:"caixa"});
  }
  var ultimaFechada = state.caixaSessao && state.caixaSessao.status==="FECHADA" ? state.caixaSessao : null;
  if(ultimaFechada && ultimaFechada.diferencaCentavos){
    alerts.push({t:"DIFERENÇA NO ÚLTIMO CAIXA", d:brl(ultimaFechada.diferencaCentavos), danger:Math.abs(ultimaFechada.diferencaCentavos)>limiteDiferencaCentavos(), view:"caixa"});
  }
  if(u && ["ADMIN","GERENTE"].indexOf(u.papel)!==-1 && state.caixaSessao && state.caixaSessao.status==="ABERTA" && saldoDinheiroEsperado()>state.config.limiteAlertaSangriaCentavos){
    alerts.push({t:"FAÇA UMA SANGRIA", d:"Dinheiro em gaveta acima do limite configurado", danger:true, view:"caixa"});
  }
  return alerts;
}

