"use strict";

async function abrirFecharConta(comandaId){
  var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
  var res = await sb.from("comandas").update({status:"FECHANDO"}).eq("id", comandaId);
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  comanda.status = "FECHANDO";
  state.modal = {type:"pagamento", comandaId:comandaId, linhas:[], dividirPessoas:1};
  render();
}
function fecharModalAtual(){
  if(state.modal && state.modal.type==="pagamento"){
    var comanda = state.comandas.find(function(c){ return c.id===state.modal.comandaId; });
    if(comanda && comanda.status==="FECHANDO"){
      comanda.status = "ABERTA";
      sb.from("comandas").update({status:"ABERTA"}).eq("id", comanda.id);
    }
  }
  state.modal = null;
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
  var temFiado = state.modal.linhas.some(function(l){ return l.forma==="FIADO"; });
  if(temFiado && !(state.modal.fiadoCliente||"").trim()){
    state.modal.erro = "Informe o nome do cliente para gerar a conta a receber do fiado.";
    render(); return;
  }
  state.modal.confirmando = true; render();

  // toda a gravação (comanda, pagamentos, movimentos de caixa, contas a
  // receber de fiado e baixa de estoque) acontece atomicamente dentro do
  // RPC confirmar_pagamento — se qualquer passo falhar, nada é gravado.
  var res = await sb.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id,
    p_linhas: state.modal.linhas.map(function(l){ return {forma:l.forma, valor_centavos:l.valorCentavos}; }),
    p_fiado_cliente: temFiado ? state.modal.fiadoCliente.trim() : null
  });
  if(res.error){
    state.modal.erro = res.error.message; state.modal.confirmando = false; render(); return;
  }
  var out = res.data;

  (out.caixa_movimentos||[]).forEach(function(m){ state.caixaMovimentos.push(mapMovimento(m)); });
  (out.contas||[]).forEach(function(c){ state.contas.push(mapConta(c)); });
  (out.estoque_movimentos||[]).forEach(function(m){
    state.estoqueMovimentos.unshift(mapEstoqueMov(m));
    var insumo = state.insumos.find(function(i){ return i.id===m.insumo_id; });
    if(insumo) insumo.estoqueAtual = Math.max(0, insumo.estoqueAtual - Number(m.quantidade));
  });

  comanda.pagamentos = state.modal.linhas.map(function(l){ return {forma:l.forma, valorCentavos:l.valorCentavos}; });
  comanda.trocoCentavos = out.comanda.troco_centavos;
  comanda.status = "PAGA";
  comanda.fechamento = out.comanda.fechamento;

  state.view = "salao"; state.viewParams = {};
  state.modal = {type:"recibo", comanda: JSON.parse(JSON.stringify(comanda))};
  render();
  toast("ok","PAGAMENTO CONFIRMADO", comanda.codigo+" · "+brl(t.total));
}

async function kdsSetStatus(comandaId, itemId, novoStatus){
  var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
  var item = comanda ? comanda.itens.find(function(i){ return i.id===itemId; }) : null;
  if(!item) item = (state.kdsItensAvulsos||[]).find(function(i){ return i.id===itemId; });
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
  var formas = Object.keys(totaisPorForma()).filter(function(f){ return FORMAS_RECEBIVEL.indexOf(f)===-1; });
  if(formas.indexOf("DINHEIRO")===-1) formas.unshift("DINHEIRO");
  else { formas = formas.filter(function(f){ return f!=="DINHEIRO"; }); formas.unshift("DINHEIRO"); }
  return formas;
}
// Fase 0.2 — o esperado é calculado e conferido no servidor (RPCs
// conferir_fechamento_caixa / fechar_caixa, 0042), nunca no client. O
// client só manda o que o operador contou; recebe de volta o resultado já
// pronto. "Conferência cega" de verdade: o esperado não existe no browser
// antes do operador informar o contado.
async function conferirFechamento(informados){
  var m = state.modal;
  m.informados = informados;
  m.erro = ""; m.conferindo = true; render();
  var res = await sb.rpc("conferir_fechamento_caixa", {
    p_sessao_id: state.caixaSessao.id,
    p_informados: informados
  });
  m.conferindo = false;
  if(res.error){ m.erro = res.error.message; render(); return; }
  m.resultado = res.data;
  m.stage = "resultado";
  render();
}

async function confirmarFechamento(justificativa){
  var m = state.modal;
  m.erro = ""; m.fechando = true; render();
  var res = await sb.rpc("fechar_caixa", {
    p_sessao_id: state.caixaSessao.id,
    p_informados: m.informados,
    p_justificativa: justificativa
  });
  m.fechando = false;
  if(res.error){ m.erro = res.error.message; render(); return; }
  var r = res.data;
  var diferencaDinheiro = r.diferenca_dinheiro;

  state.caixaSessao.status = "FECHADA";
  state.caixaSessao.fechamentoEm = new Date().toISOString();
  state.caixaSessao.usuarioFechamento = state.usuarioAtualId;
  state.caixaSessao.saldoCalculadoCentavos = r.esperados.DINHEIRO||0;
  state.caixaSessao.saldoInformadoCentavos = r.informados.DINHEIRO||0;
  state.caixaSessao.diferencaCentavos = diferencaDinheiro;
  state.caixaSessao.fechamentoDetalhe = r;
  state.caixaSessoesHistorico.push(state.caixaSessao);
  m.stage = "concluido";
  render();
  toast(diferencaDinheiro===0?"ok":"err","CAIXA FECHADO", "Diferença "+brl(diferencaDinheiro));
}

