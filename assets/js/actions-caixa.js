"use strict";

async function abrirFecharConta(comandaId){
  var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
  var res = await sb.from("comandas").update({status:"FECHANDO"}).eq("id", comandaId);
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  comanda.status = "FECHANDO";
  state.modal = {type:"pagamento", comandaId:comandaId, linhas:[], dividirPessoas:1, modo:"pessoas", itensSelecionados:{}, fiadoClienteId:null, escolhendoCliente:false, buscaCliente:"", pontosResgatados:0};
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
  var m = state.modal;
  var t = m.modo==="itens" ? totaisNaoPagos(comanda, m.itensSelecionados) : totaisNaoPagos(comanda);
  var cliente = m.fiadoClienteId ? state.clientes.find(function(c){ return c.id===m.fiadoClienteId; }) : null;
  var valorPonto = (state.config.fidelidade&&state.config.fidelidade.valorPontoCentavos)||0;
  var maxPontos = (m.modo==="pessoas" && cliente && valorPonto>0) ? Math.min(cliente.pontosFidelidade, Math.ceil(t.total/valorPonto)) : 0;
  var pontos = Math.min(m.pontosResgatados||0, maxPontos);
  var totalFinal = Math.max(0, t.total - pontos*valorPonto);
  var soma = state.modal.linhas.reduce(function(s,l){ return s+l.valorCentavos; },0);
  var restante = Math.max(0, totalFinal - soma);
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
  var modo = state.modal.modo||"pessoas";
  var itemIds = modo==="itens" ? Object.keys(state.modal.itensSelecionados).filter(function(id){ return state.modal.itensSelecionados[id]; }) : null;
  var t = modo==="itens" ? totaisNaoPagos(comanda, state.modal.itensSelecionados) : totaisNaoPagos(comanda);
  var cliente = state.modal.fiadoClienteId ? state.clientes.find(function(c){ return c.id===state.modal.fiadoClienteId; }) : null;
  var valorPonto = (state.config.fidelidade&&state.config.fidelidade.valorPontoCentavos)||0;
  var maxPontos = (modo==="pessoas" && cliente && valorPonto>0) ? Math.min(cliente.pontosFidelidade, Math.ceil(t.total/valorPonto)) : 0;
  var pontosResgatados = Math.min(state.modal.pontosResgatados||0, maxPontos);
  var totalFinal = Math.max(0, t.total - pontosResgatados*valorPonto);
  var soma = state.modal.linhas.reduce(function(s,l){ return s+l.valorCentavos; },0);
  if(t.total===0){
    state.modal.erro = "Selecione ao menos um item."; render(); return;
  }
  if(soma < totalFinal){
    state.modal.erro = "Faltam "+brl(totalFinal-soma)+" para cobrir o total.";
    render(); return;
  }
  var temFiado = state.modal.linhas.some(function(l){ return l.forma==="FIADO"; });
  if(temFiado && !state.modal.fiadoClienteId){
    state.modal.erro = "Escolha um cliente cadastrado para gerar a conta a receber do fiado.";
    render(); return;
  }

  // Fase 3.5 — escopo mínimo offline: só dinheiro, sem fiado/pontos/cartão
  // (não dá pra validar saldo de pontos ou gerar conta a receber líquida
  // sem o banco). Fecha a comanda localmente como "sincronizando" e manda
  // de verdade quando a conexão voltar.
  var soDinheiro = state.modal.linhas.length===1 && state.modal.linhas[0].forma==="DINHEIRO";
  if(!navigator.onLine){
    if(!soDinheiro || temFiado || pontosResgatados>0){
      state.modal.erro = "Sem internet: só dá pra fechar em dinheiro, sem fiado nem pontos.";
      render(); return;
    }
    await confirmarPagamentoOffline(comanda, itemIds, totalFinal);
    return;
  }

  state.modal.confirmando = true; render();

  // toda a gravação (comanda, pagamentos, movimentos de caixa, contas a
  // receber de fiado, pontos de fidelidade e baixa de estoque) acontece
  // atomicamente dentro do RPC confirmar_pagamento — se qualquer passo
  // falhar, nada é gravado. p_item_ids só vai preenchido no modo "dividir
  // por item"; cliente/pontos só valem no modo "pessoas" (fechar tudo).
  var res = await sb.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id,
    p_linhas: state.modal.linhas.map(function(l){ return {forma:l.forma, valor_centavos:l.valorCentavos}; }),
    p_cliente_id: state.modal.fiadoClienteId || null,
    p_item_ids: itemIds,
    p_sessao_id: state.caixaSessao.id,
    p_pontos_resgatados: pontosResgatados
  });
  if(res.error){
    if(soDinheiro && !temFiado && pontosResgatados===0 && typeof erroDeRede==="function" && erroDeRede(res)){
      await confirmarPagamentoOffline(comanda, itemIds, totalFinal);
      return;
    }
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

  comanda.totalCentavos = out.comanda.total_centavos;
  // marca como pago exatamente o que esta chamada liquidou: o subconjunto
  // escolhido (modo por item) ou tudo que ainda faltava (modo pessoas).
  var idsLiquidados = itemIds || itensNaoPagos(comanda).map(function(it){ return it.id; });
  var agora = new Date().toISOString();
  comanda.itens.forEach(function(it){
    if(idsLiquidados.indexOf(it.id)!==-1) it.pagoEm = agora;
  });
  // acumula as linhas de TODAS as rodadas (parciais + a que fecha) pro
  // recibo final mostrar o histórico completo de formas de pagamento.
  comanda.pagamentos = (comanda.pagamentos||[]).concat(state.modal.linhas.map(function(l){ return {forma:l.forma, valorCentavos:l.valorCentavos}; }));

  if(out.fechou){
    comanda.trocoCentavos = out.comanda.troco_centavos;
    comanda.status = "PAGA";
    comanda.fechamento = out.comanda.fechamento;
    state.view = "salao"; state.viewParams = {};
    state.modal = {type:"recibo", comanda: JSON.parse(JSON.stringify(comanda))};
    render();
    toast("ok","PAGAMENTO CONFIRMADO", comanda.codigo+" · "+brl(totalFinal));
  } else {
    comanda.status = "ABERTA";
    sb.from("comandas").update({status:"ABERTA"}).eq("id", comanda.id);
    state.modal = null;
    render();
    toast("ok","PAGAMENTO PARCIAL REGISTRADO", comanda.codigo+" · "+brl(t.total)+" · falta "+brl(totaisNaoPagos(comanda).total));
  }
}

// Fase 3.5 — fecha a comanda localmente (dinheiro, sem fiado/pontos/
// cartão) e guarda a chamada de verdade do confirmar_pagamento na fila
// offline. Estoque e caixa_movimentos só refletem depois de sincronizar
// — a comanda fica marcada _pendingSync até lá.
async function confirmarPagamentoOffline(comanda, itemIds, totalFinal){
  var agora = new Date().toISOString();
  var idsLiquidados = itemIds || itensNaoPagos(comanda).map(function(it){ return it.id; });
  comanda.itens.forEach(function(it){ if(idsLiquidados.indexOf(it.id)!==-1) it.pagoEm = agora; });
  comanda.pagamentos = (comanda.pagamentos||[]).concat([{forma:"DINHEIRO", valorCentavos:totalFinal}]);
  var fechouTudo = itensNaoPagos(comanda).length===0;
  if(fechouTudo){
    comanda.status = "PAGA"; comanda.fechamento = agora; comanda._pendingSync = true;
  }
  comanda.totalCentavos = (comanda.totalCentavos||0) + totalFinal;

  await offlineEnfileirar({
    id: uid("fila"), tipo:"pagamento_dinheiro", criadoEm: Date.now(),
    payload: {
      p_comanda_id: comanda.id,
      p_linhas: [{forma:"DINHEIRO", valor_centavos: totalFinal}],
      p_cliente_id: null, p_item_ids: itemIds, p_sessao_id: state.caixaSessao.id, p_pontos_resgatados: 0
    }
  });

  if(fechouTudo){ state.view = "salao"; state.viewParams = {}; }
  state.modal = null;
  render();
  toast("err","SEM INTERNET", "Pagamento em dinheiro guardado — sincroniza sozinho quando a conexão voltar");
}

async function kdsSetStatus(comandaId, itemId, novoStatus){
  var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
  var item = comanda ? comanda.itens.find(function(i){ return i.id===itemId; }) : null;
  if(!item) item = (state.kdsItensAvulsos||[]).find(function(i){ return i.id===itemId; });
  if(!item) return;
  var anterior = item.status;
  item.status = novoStatus;
  render();
  // Fase 3.5 — item que ainda nem foi sincronizado (criado offline):
  // muda o status direto na fila, sem RPC nenhuma (ainda não existe no
  // servidor pra dar update).
  if(item._pendingSync){
    await offlineAtualizarStatusNaFila(itemId, novoStatus);
    return;
  }
  if(!navigator.onLine){
    await offlineEnfileirar({id: uid("fila"), tipo:"kds_status", itemId:itemId, status:novoStatus, criadoEm: Date.now()});
    return;
  }
  var res = await sb.from("comanda_itens").update({status:novoStatus}).eq("id", itemId);
  if(res.error){
    if(typeof erroDeRede==="function" && erroDeRede(res)){
      await offlineEnfileirar({id: uid("fila"), tipo:"kds_status", itemId:itemId, status:novoStatus, criadoEm: Date.now()});
      return;
    }
    item.status = anterior; toast("err","ERRO", res.error.message); render();
  }
}

// Fase 1.4 — avança todos os itens de um ticket (mesma comanda, mesma
// coluna) de uma vez, em vez de clicar item por item.
async function kdsAvancarTicket(comandaId, itemIds, novoStatus){
  var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
  var itens = itemIds.map(function(id){
    var it = comanda ? comanda.itens.find(function(i){ return i.id===id; }) : null;
    if(!it) it = (state.kdsItensAvulsos||[]).find(function(i){ return i.id===id; });
    return it;
  }).filter(Boolean);
  var anteriores = itens.map(function(it){ return it.status; });
  itens.forEach(function(it){ it.status = novoStatus; });
  render();
  var res = await sb.from("comanda_itens").update({status:novoStatus}).in("id", itemIds);
  if(res.error){
    itens.forEach(function(it, i){ it.status = anteriores[i]; });
    toast("err","ERRO", res.error.message); render();
  }
}
async function abrirCaixa(saldoInicialCentavos, terminalNome){
  var terminal = (terminalNome||"").trim() || "Terminal 1";
  state.caixaTerminalNome = terminal;
  try{ localStorage.setItem("caixaTerminalNome", terminal); }catch(e){}
  var res = await sb.from("caixa_sessoes").insert({
    empresa_id: state.empresaId, terminal:terminal, usuario_abertura: state.usuarioAtualId,
    saldo_inicial_centavos: saldoInicialCentavos, status:"ABERTA"
  }).select().single();
  if(res.error){ toast("err","ERRO AO ABRIR CAIXA", res.error.message); return; }
  state.caixaSessao = mapCaixaSessao(res.data);
  state.caixaMovimentos = [];
  render();
  toast("ok","CAIXA ABERTO", terminal+" · Saldo inicial "+brl(saldoInicialCentavos));
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

