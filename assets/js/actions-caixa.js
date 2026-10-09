"use strict";

async function abrirFecharConta(comandaId){
  var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
  var res = await sb.from("comandas").update({status:"FECHANDO"}).eq("id", comandaId);
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  comanda.status = "FECHANDO";
  state.modal = {type:"pagamento", comandaId:comandaId, linhas:[], dividirPessoas:1, modo:"pessoas", itensSelecionados:{}, fiadoClienteId:null, escolhendoCliente:false, buscaCliente:"", pontosResgatados:0, cupomCodigo:"", totaisServidor:null, totaisCarregando:false};
  render();
  atualizarTotaisPagamento();
}

// 0.1 — o total que vale é sempre o que o SERVIDOR calcula (mesma função
// usada por confirmar_pagamento, calcular_totais_pagamento) — o modal
// reconsulta a cada mudança relevante (cliente/pontos/cupom/modo/itens
// selecionados) em vez de recalcular com fórmula própria no navegador,
// que foi exatamente a causa da cobrança a mais no cartão quando tinha
// cupom/pontos (a taxa de serviço é calculada pelo servidor em cima da
// base JÁ descontada, o client calculava "valor cheio − desconto").
var totaisPagamentoDebounce = null;
function atualizarTotaisPagamento(){
  if(totaisPagamentoDebounce) clearTimeout(totaisPagamentoDebounce);
  totaisPagamentoDebounce = setTimeout(executarAtualizarTotaisPagamento, 280);
}
async function executarAtualizarTotaisPagamento(){
  var m = state.modal;
  if(!m || m.type!=="pagamento") return;
  var modo = m.modo||"pessoas";
  var itemIds = modo==="itens" ? Object.keys(m.itensSelecionados).filter(function(id){ return m.itensSelecionados[id]; }) : null;
  if(modo==="itens" && !itemIds.length){ m.totaisServidor = null; render(); return; }
  m.totaisCarregando = true; render();
  var res = await sb.rpc("calcular_total_pagamento", {
    p_comanda_id: m.comandaId, p_item_ids: itemIds,
    p_pontos_resgatados: modo==="pessoas" ? (m.pontosResgatados||0) : 0,
    p_cupom_codigo: modo==="pessoas" && m.cupomCodigo && m.cupomCodigo.trim() ? m.cupomCodigo.trim() : null,
    p_cliente_id: modo==="pessoas" ? (m.fiadoClienteId||null) : null
  });
  if(state.modal!==m) return; // modal trocou enquanto a consulta estava no ar
  m.totaisCarregando = false;
  if(res.error){ m.totaisServidor = null; m.erro = res.error.message; render(); return; }
  m.totaisServidor = res.data;
  m.erro = "";
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
  var m = state.modal;
  // enquanto o total do servidor ainda não voltou, usa uma estimativa só
  // pra pré-preencher o valor da linha (conveniência); a confirmação em
  // si sempre reexige o total do servidor carregado — nunca fecha com
  // base nesta estimativa.
  var comanda = state.comandas.find(function(c){ return c.id===m.comandaId; });
  var totalEstimado = m.totaisServidor ? m.totaisServidor.total
    : (m.modo==="itens" ? totaisNaoPagos(comanda, m.itensSelecionados) : totaisNaoPagos(comanda)).total;
  var soma = m.linhas.reduce(function(s,l){ return s+l.valorCentavos; },0);
  var restante = Math.max(0, totalEstimado - soma);
  m.linhas.push({forma:forma, valorCentavos: restante>0?restante:0});
  m.erro = "";
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
  var m = state.modal;
  if(m.totaisCarregando || !m.totaisServidor){
    m.erro = "Aguarde o cálculo do total."; render(); return;
  }
  var totais = m.totaisServidor;
  var totalFinal = totais.total;
  var soma = m.linhas.reduce(function(s,l){ return s+l.valorCentavos; },0);
  if(totais.subtotal===0){
    m.erro = "Selecione ao menos um item."; render(); return;
  }
  if(soma < totalFinal){
    m.erro = "Faltam "+brl(totalFinal-soma)+" para cobrir o total.";
    render(); return;
  }
  var temDinheiro = m.linhas.some(function(l){ return l.forma==="DINHEIRO"; });
  if(soma > totalFinal && !temDinheiro){
    m.erro = "Pagando a mais sem nenhuma linha em dinheiro não tem como dar troco — ajuste os valores.";
    render(); return;
  }
  var temFiado = m.linhas.some(function(l){ return l.forma==="FIADO"; });
  if(temFiado && !m.fiadoClienteId){
    m.erro = "Escolha um cliente cadastrado para gerar a conta a receber do fiado.";
    render(); return;
  }
  if(m.cupomCodigo && m.cupomCodigo.trim() && !totais.cupom_codigo){
    m.erro = "Cupom inválido, inativo, expirado ou esgotado — apague o código ou corrija antes de confirmar.";
    render(); return;
  }

  // 0.2 — desconto empilhado (manual + pontos + cupom) acima do limite
  // configurado exige PIN de supervisor, mesma trava de aplicar_desconto
  // — validado de novo no servidor dentro de confirmar_pagamento, isto
  // aqui só evita abrir o teclado de PIN à toa quando não precisa.
  if(totais.pct_desconto_total > limiteDescontoPct()){
    pedirSupervisorRpc(PERM.DESCONTO_APLICAR,
      "Desconto total de "+Math.round(totais.pct_desconto_total)+"% (manual + pontos + cupom) acima do limite de "+limiteDescontoPct()+"%",
      function(supervisorId, pin, tentativaId){ return executarConfirmarPagamento(supervisorId, pin, tentativaId); });
  } else {
    await executarConfirmarPagamento(null, null, null);
  }
}

async function executarConfirmarPagamento(supervisorId, pin, tentativaId){
  var m = state.modal;
  if(!m || m.type!=="pagamento") return false;
  var comanda = state.comandas.find(function(c){ return c.id===m.comandaId; });
  var modo = m.modo||"pessoas";
  var itemIds = modo==="itens" ? Object.keys(m.itensSelecionados).filter(function(id){ return m.itensSelecionados[id]; }) : null;
  var totais = m.totaisServidor;
  var totalFinal = totais.total;
  var temFiado = m.linhas.some(function(l){ return l.forma==="FIADO"; });
  var pontosResgatados = modo==="pessoas" ? (m.pontosResgatados||0) : 0;
  var cupomCodigo = modo==="pessoas" && m.cupomCodigo && m.cupomCodigo.trim() ? m.cupomCodigo.trim() : null;

  // Fase 3.5 — escopo mínimo offline: só dinheiro, sem fiado/pontos/cupom/
  // cartão/supervisor (nada disso dá pra validar sem o banco). Fecha a
  // comanda localmente como "sincronizando" e manda de verdade quando a
  // conexão voltar.
  var soDinheiro = m.linhas.length===1 && m.linhas[0].forma==="DINHEIRO";
  if(!navigator.onLine){
    if(!soDinheiro || temFiado || pontosResgatados>0 || cupomCodigo || supervisorId){
      m.erro = "Sem internet: só dá pra fechar em dinheiro, sem fiado, pontos, cupom ou desconto acima do limite.";
      render(); return false;
    }
    await confirmarPagamentoOffline(comanda, itemIds, totalFinal);
    return true;
  }

  m.confirmando = true; render();

  // toda a gravação (comanda, pagamentos, movimentos de caixa, contas a
  // receber de fiado, pontos de fidelidade e baixa de estoque) acontece
  // atomicamente dentro do RPC confirmar_pagamento — se qualquer passo
  // falhar, nada é gravado. p_item_ids só vai preenchido no modo "dividir
  // por item"; cliente/pontos/cupom só valem no modo "pessoas".
  var res = await sb.rpc("confirmar_pagamento", {
    p_comanda_id: comanda.id,
    p_linhas: m.linhas.map(function(l){ return {forma:l.forma, valor_centavos:l.valorCentavos}; }),
    p_cliente_id: m.fiadoClienteId || null,
    p_item_ids: itemIds,
    p_sessao_id: state.caixaSessao.id,
    p_pontos_resgatados: pontosResgatados,
    p_cupom_codigo: cupomCodigo,
    p_supervisor_id: supervisorId || null,
    p_supervisor_pin: pin || null,
    p_tentativa_id: tentativaId || null
  });
  if(res.error){
    if(soDinheiro && !temFiado && pontosResgatados===0 && !cupomCodigo && !supervisorId && typeof erroDeRede==="function" && erroDeRede(res)){
      await confirmarPagamentoOffline(comanda, itemIds, totalFinal);
      return true;
    }
    m.erro = res.error.message; m.confirmando = false; render(); return false;
  }
  var out = res.data;

  (out.caixa_movimentos||[]).forEach(function(mv){ state.caixaMovimentos.push(mapMovimento(mv)); });
  (out.contas||[]).forEach(function(c){ state.contas.push(mapConta(c)); });
  (out.estoque_movimentos||[]).forEach(function(mv){
    state.estoqueMovimentos.unshift(mapEstoqueMov(mv));
    var insumo = state.insumos.find(function(i){ return i.id===mv.insumo_id; });
    if(insumo) insumo.estoqueAtual = insumo.estoqueAtual - Number(mv.quantidade);
  });
  if(out.cupom_codigo){
    var cupomUsado = state.cupons.find(function(c){ return c.codigo===out.cupom_codigo; });
    if(cupomUsado) cupomUsado.usosAtuais = (cupomUsado.usosAtuais||0) + 1;
  }

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
  comanda.pagamentos = (comanda.pagamentos||[]).concat(m.linhas.map(function(l){ return {forma:l.forma, valorCentavos:l.valorCentavos}; }));

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
    toast("ok","PAGAMENTO PARCIAL REGISTRADO", comanda.codigo+" · "+brl(totalFinal)+" · falta "+brl(totaisNaoPagos(comanda).total));
  }
  return true;
}

// Fase 3.5 — fecha a comanda localmente (dinheiro, sem fiado/pontos/
// cartão) e guarda a chamada de verdade do confirmar_pagamento na fila
// offline. Estoque e caixa_movimentos só refletem depois de sincronizar
// — a comanda fica marcada _pendingSync até lá. 0.5 — grava o updated_at
// que a comanda tinha NESTE momento; se outro terminal mexer nela antes
// da sincronização de verdade, o servidor detecta a divergência e vira
// conflito (sync_conflitos) em vez de aplicar por cima de estado velho.
//
// VF-002 — é dinheiro de verdade: enfileira ANTES de tocar no state. Se
// o IndexedDB falhar, a comanda não pode ser marcada como paga/com troco
// dado sem NENHUM registro de que isso aconteceu — essa é exatamente a
// falha que some com um pagamento em dinheiro sem deixar rastro.
async function confirmarPagamentoOffline(comanda, itemIds, totalFinal){
  var agora = new Date().toISOString();
  var updatedAtNoEnfileiramento = comanda.updatedAt;
  var guardou = await offlineEnfileirar({
    id: uid("fila"), tipo:"pagamento_dinheiro", criadoEm: Date.now(),
    payload: {
      p_comanda_id: comanda.id,
      p_linhas: [{forma:"DINHEIRO", valor_centavos: totalFinal}],
      p_comanda_updated_at: updatedAtNoEnfileiramento,
      p_cliente_id: null, p_item_ids: itemIds, p_sessao_id: state.caixaSessao.id, p_pontos_resgatados: 0
    }
  });
  if(!guardou){
    toast("err","NÃO DEU PRA GUARDAR OFFLINE", "Sem internet e não consegui guardar no aparelho (armazenamento cheio/bloqueado?) — o pagamento NÃO foi registrado. Anota o valor recebido na mão.");
    return;
  }

  var idsLiquidados = itemIds || itensNaoPagos(comanda).map(function(it){ return it.id; });
  comanda.itens.forEach(function(it){ if(idsLiquidados.indexOf(it.id)!==-1) it.pagoEm = agora; });
  comanda.pagamentos = (comanda.pagamentos||[]).concat([{forma:"DINHEIRO", valorCentavos:totalFinal}]);
  var fechouTudo = itensNaoPagos(comanda).length===0;
  if(fechouTudo){
    comanda.status = "PAGA"; comanda.fechamento = agora; comanda._pendingSync = true;
  }
  comanda.totalCentavos = (comanda.totalCentavos||0) + totalFinal;

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
  // VF-002 — se não conseguir nem guardar offline, desfaz o status
  // otimista: sem fila e sem servidor, a mudança não ia pra lugar
  // nenhum, só ficaria mentindo na tela até o próximo recarregamento.
  if(!navigator.onLine){
    var guardouOffline = await offlineEnfileirar({id: uid("fila"), tipo:"kds_status", itemId:itemId, status:novoStatus, criadoEm: Date.now()});
    if(!guardouOffline){ item.status = anterior; toast("err","NÃO DEU PRA GUARDAR OFFLINE", "Sem internet e não consegui guardar no aparelho — tenta de novo."); render(); }
    return;
  }
  var res = await sb.from("comanda_itens").update({status:novoStatus}).eq("id", itemId);
  if(res.error){
    if(typeof erroDeRede==="function" && erroDeRede(res)){
      var guardouOffline2 = await offlineEnfileirar({id: uid("fila"), tipo:"kds_status", itemId:itemId, status:novoStatus, criadoEm: Date.now()});
      if(!guardouOffline2){ item.status = anterior; toast("err","NÃO DEU PRA GUARDAR OFFLINE", "Sem internet e não consegui guardar no aparelho — tenta de novo."); render(); }
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

