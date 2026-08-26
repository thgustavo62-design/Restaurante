"use strict";

async function abrirFecharConta(comandaId){
  var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
  var res = await sb.from("comandas").update({status:"FECHANDO"}).eq("id", comandaId);
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  comanda.status = "FECHANDO";
  state.modal = {type:"pagamento", comandaId:comandaId, linhas:[], dividirPessoas:1};
  render();
}
function pixCodigoSimulado(comanda, valorCentavos){
  var base = comanda.codigo + "-" + valorCentavos;
  var hash = 0;
  for(var i=0;i<base.length;i++){ hash = ((hash<<5)-hash+base.charCodeAt(i))|0; }
  return "PIX-SIMULADO-"+comanda.codigo+"-"+Math.abs(hash).toString(36).toUpperCase();
}
function pixQrGridHtml(seedStr){
  var hash = 0;
  for(var i=0;i<seedStr.length;i++){ hash = ((hash*31)+seedStr.charCodeAt(i))>>>0; }
  var cells = "";
  var n = 9;
  for(var r=0;r<n;r++){
    for(var c=0;c<n;c++){
      var bit = (hash >> ((r*n+c)%24)) & 1;
      var onEdge = (r===0||c===0||r===n-1||c===n-1);
      var on = onEdge || bit;
      cells += '<div style="width:9px; height:9px; background:'+(on?'#111':'#fff')+';"></div>';
      hash = (hash*1103515245+12345)>>>0;
    }
  }
  return '<div style="display:grid; grid-template-columns:repeat('+n+',9px); gap:1px; background:#fff; padding:8px; margin:8px auto; width:fit-content;">'+cells+'</div>';
}
function pagamentoAddMetodo(forma){
  var comanda = state.comandas.find(function(c){ return c.id===state.modal.comandaId; });
  var t = totaisComanda(comanda);
  var soma = state.modal.linhas.reduce(function(s,l){ return s+l.valorCentavos; },0);
  var restante = Math.max(0, t.total - soma);
  state.modal.linhas.push({forma:forma, valorCentavos: restante>0?restante:0});
  state.modal.erro = "";
  render();
}
function pagamentoEditarLinha(idx, valorCentavos){
  state.modal.linhas[idx].valorCentavos = Math.max(0, valorCentavos||0);
}
function pagamentoRemoveLinha(idx){
  state.modal.linhas.splice(idx,1);
  render();
}
async function confirmarPagamento(){
  if(!state.caixaSessao || state.caixaSessao.status!=="ABERTA"){
    state.modal.erro = "Abra o caixa antes de registrar pagamentos.";
    render(); return;
  }
  var comanda = state.comandas.find(function(c){ return c.id===state.modal.comandaId; });
  var t = totaisComanda(comanda);
  var soma = state.modal.linhas.reduce(function(s,l){ return s+l.valorCentavos; },0);
  if(soma < t.total){
    state.modal.erro = "Faltam "+brl(t.total-soma)+" para cobrir o total.";
    render(); return;
  }
  state.modal.confirmando = true; render();
  var troco = soma - t.total;
  var fechamento = new Date().toISOString();

  var upd = await sb.from("comandas").update({
    status:"PAGA", fechamento:fechamento, troco_centavos:troco
  }).eq("id", comanda.id);
  if(upd.error){ state.modal.erro = upd.error.message; state.modal.confirmando=false; render(); return; }

  var pagamentosPayload = state.modal.linhas.map(function(l){
    return {comanda_id:comanda.id, sessao_id:state.caixaSessao.id, forma:l.forma, valor_centavos:l.valorCentavos};
  });
  await sb.from("pagamentos").insert(pagamentosPayload);

  var movimentosPayload = [];
  var trocoRestante = troco;
  state.modal.linhas.forEach(function(l){
    var valor = l.valorCentavos;
    if(l.forma==="DINHEIRO" && trocoRestante>0){ valor = Math.max(0, valor - trocoRestante); trocoRestante = 0; }
    if(valor<=0) return;
    movimentosPayload.push({
      sessao_id:state.caixaSessao.id, tipo:"VENDA", valor_centavos:valor,
      forma_pagamento:l.forma, comanda_id:comanda.id, usuario_id:state.usuarioAtualId
    });
  });
  var movRes = await sb.from("caixa_movimentos").insert(movimentosPayload).select();
  if(!movRes.error) state.caixaMovimentos = state.caixaMovimentos.concat(movRes.data.map(mapMovimento));

  comanda.pagamentos = state.modal.linhas.map(function(l){ return {forma:l.forma, valorCentavos:l.valorCentavos}; });
  comanda.trocoCentavos = troco;
  comanda.status = "PAGA";
  comanda.fechamento = fechamento;

  await baixarEstoqueDaVenda(comanda);

  state.view = "salao"; state.viewParams = {};
  state.modal = {type:"recibo", comanda: JSON.parse(JSON.stringify(comanda))};
  render();
  toast("ok","PAGAMENTO CONFIRMADO", comanda.codigo+" · "+brl(t.total));
}

async function kdsSetStatus(comandaId, itemId, novoStatus){
  var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
  var item = comanda ? comanda.itens.find(function(i){ return i.id===itemId; }) : null;
  if(!item) return;
  var anterior = item.status;
  item.status = novoStatus;
  render();
  var res = await sb.from("comanda_itens").update({status:novoStatus}).eq("id", itemId);
  if(res.error){ item.status = anterior; toast("err","ERRO", res.error.message); render(); }
}

async function abrirCaixa(saldoInicialCentavos){
  var res = await sb.from("caixa_sessoes").insert({
    empresa_id: state.empresaId, terminal:"Terminal 1", usuario_abertura: state.usuarioAtualId,
    saldo_inicial_centavos: saldoInicialCentavos, status:"ABERTA"
  }).select().single();
  if(res.error){ toast("err","ERRO AO ABRIR CAIXA", res.error.message); return; }
  state.caixaSessao = mapCaixaSessao(res.data);
  state.caixaMovimentos = [];
  render();
  toast("ok","CAIXA ABERTO", "Saldo inicial "+brl(saldoInicialCentavos));
}
async function registrarMovimento(tipo, valorCentavos, motivo){
  var res = await sb.from("caixa_movimentos").insert({
    sessao_id: state.caixaSessao.id, tipo:tipo, valor_centavos:valorCentavos,
    forma_pagamento:"DINHEIRO", usuario_id: state.usuarioAtualId, motivo:motivo
  }).select().single();
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  state.caixaMovimentos.push(mapMovimento(res.data));
  state.modal = null;
  render();
  toast("ok", tipo, brl(valorCentavos)+" · "+motivo);
}
function movimentosDaSessao(){
  if(!state.caixaSessao) return [];
  return state.caixaMovimentos.filter(function(m){ return m.sessaoId===state.caixaSessao.id; });
}
function totaisPorForma(){
  var mapa = {};
  movimentosDaSessao().forEach(function(m){
    if(m.tipo!=="VENDA") return;
    mapa[m.formaPagamento] = (mapa[m.formaPagamento]||0) + m.valorCentavos;
  });
  return mapa;
}
function saldoDinheiroEsperado(){
  var s = state.caixaSessao.saldoInicialCentavos;
  movimentosDaSessao().forEach(function(m){
    if(m.tipo==="VENDA" && m.formaPagamento==="DINHEIRO") s += m.valorCentavos;
    if(m.tipo==="SUPRIMENTO") s += m.valorCentavos;
    if(m.tipo==="SANGRIA") s -= m.valorCentavos;
  });
  return s;
}
function formasDaSessao(){
  var formas = Object.keys(totaisPorForma());
  if(formas.indexOf("DINHEIRO")===-1) formas.unshift("DINHEIRO");
  else { formas = formas.filter(function(f){ return f!=="DINHEIRO"; }); formas.unshift("DINHEIRO"); }
  return formas;
}
function esperadoPorForma(forma){
  if(forma==="DINHEIRO") return saldoDinheiroEsperado();
  return totaisPorForma()[forma] || 0;
}
async function confirmarFechamento(justificativa){
  var informados = state.modal.informados;
  var esperados = {}; var diffs = {};
  formasDaSessao().forEach(function(f){
    esperados[f] = esperadoPorForma(f);
    diffs[f] = (informados[f]||0) - esperados[f];
  });
  var diferencaDinheiro = diffs.DINHEIRO||0;
  if(Math.abs(diferencaDinheiro) > limiteDiferencaCentavos() && !justificativa){
    render(); return;
  }
  var fechamentoEm = new Date().toISOString();
  var res = await sb.from("caixa_sessoes").update({
    status:"FECHADA", fechamento_em:fechamentoEm, usuario_fechamento:state.usuarioAtualId,
    saldo_calculado_centavos:esperados.DINHEIRO, saldo_informado_centavos:informados.DINHEIRO||0,
    diferenca_centavos:diferencaDinheiro, fechamento_detalhe:{esperados:esperados, informados:informados, diffs:diffs}
  }).eq("id", state.caixaSessao.id);
  if(res.error){ toast("err","ERRO AO FECHAR CAIXA", res.error.message); return; }

  state.caixaSessao.status = "FECHADA";
  state.caixaSessao.fechamentoEm = fechamentoEm;
  state.caixaSessao.usuarioFechamento = state.usuarioAtualId;
  state.caixaSessao.saldoCalculadoCentavos = esperados.DINHEIRO;
  state.caixaSessao.saldoInformadoCentavos = informados.DINHEIRO||0;
  state.caixaSessao.diferencaCentavos = diferencaDinheiro;
  state.caixaSessao.fechamentoDetalhe = {esperados:esperados, informados:informados, diffs:diffs};
  if(justificativa){
    registrarAuditoria("caixa_sessoes", state.caixaSessao.id, "DIFERENCA_JUSTIFICADA", state.usuarioAtualId, justificativa);
  }
  state.caixaSessoesHistorico.push(state.caixaSessao);
  state.modal.stage = "concluido";
  render();
  toast(diferencaDinheiro===0?"ok":"err","CAIXA FECHADO", "Diferença "+brl(diferencaDinheiro));
}

