"use strict";

function inicioDiaOperacionalIso(){
  var chave = hojeOperacionalStr();
  var partes = chave.split("-").map(Number);
  var inicio = new Date(partes[0], partes[1]-1, partes[2], VIRADA_DIA_OPERACIONAL_HORA, 0, 0, 0);
  return inicio.toISOString();
}
async function carregarComandasPagas(desdeIso){
  var res = await sb.from("comandas").select("*, comanda_itens(*)").eq("status","PAGA").gte("fechamento", desdeIso);
  if(res.error) return [];
  return res.data.map(function(c){
    var m = mapComanda(c);
    m.itens = (c.comanda_itens||[]).map(mapItem);
    return m;
  });
}
// Fase 0.5 — Relatórios não carrega mais comandas+itens completos pro
// navegador (chegava a puxar 10 anos de histórico em "Tudo"); agrega tudo
// no banco via relatorio_vendas (0045), período máximo de 1 ano, "Tudo"
// virou seleção de mês.
async function carregarRelatorio(periodo){
  var hoje = hojeOperacionalStr();
  var desde, ate;
  if(periodo==="7D"){ desde = diasA(-6); ate = hoje; }
  else if(periodo==="30D"){ desde = diasA(-29); ate = hoje; }
  else if(periodo==="MES"){
    var mes = state.relatorioMes || hoje.slice(0,7);
    state.relatorioMes = mes;
    var partes = mes.split("-").map(Number);
    var ultimoDia = new Date(partes[0], partes[1], 0).getDate();
    desde = mes+"-01";
    ate = mes+"-"+String(ultimoDia).padStart(2,"0");
  } else {
    desde = hoje; ate = hoje;
  }
  state.relatorioCarregando = true; render();
  var res = await sb.rpc("relatorio_vendas", {p_desde: desde, p_ate: ate});
  state.relatorioCarregando = false;
  if(res.error){
    toast("err","ERRO AO CARREGAR RELATÓRIO", res.error.message);
    state.relatorioResultado = null;
    render(); return;
  }
  state.relatorioResultado = res.data;
  render();
}
// Fase 2.1-2.4 — CMV/margem, anti-fraude, taxa por garçom, curva ABC e
// heatmap, tudo agregado no banco (relatorio_gestao, 0052). Mesma lógica
// de período da aba Vendas, mas numa consulta separada (só carrega
// quando a aba Gestão é aberta, não em toda troca de período).
async function carregarRelatorioGestao(periodo){
  var hoje = hojeOperacionalStr();
  var desde, ate;
  if(periodo==="7D"){ desde = diasA(-6); ate = hoje; }
  else if(periodo==="30D"){ desde = diasA(-29); ate = hoje; }
  else if(periodo==="MES"){
    var mes = state.relatorioMes || hoje.slice(0,7);
    var partes = mes.split("-").map(Number);
    var ultimoDia = new Date(partes[0], partes[1], 0).getDate();
    desde = mes+"-01"; ate = mes+"-"+String(ultimoDia).padStart(2,"0");
  } else { desde = hoje; ate = hoje; }
  state.relatorioGestaoCarregando = true; render();
  var res = await sb.rpc("relatorio_gestao", {p_desde: desde, p_ate: ate});
  var resTaxas = await sb.rpc("relatorio_taxas_maquininha", {p_desde: desde, p_ate: ate});
  state.relatorioGestaoCarregando = false;
  if(res.error){
    toast("err","ERRO AO CARREGAR RELATÓRIO", res.error.message);
    state.relatorioGestaoResultado = null; render(); return;
  }
  state.relatorioGestaoResultado = res.data;
  state.relatorioTaxasResultado = resTaxas.error ? [] : resTaxas.data;
  render();
}
// Fase 2.7 — saldo devedor (fiado em aberto) e últimas visitas de um
// cliente, agregado no banco (ficha_cliente, 0055).
async function carregarFichaCliente(clienteId){
  state.clienteDetalheId = clienteId;
  state.clienteFicha = null;
  state.view = "clienteDetalhe";
  render();
  var res = await sb.rpc("ficha_cliente", {p_cliente_id: clienteId});
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  state.clienteFicha = res.data;
  render();
}
async function carregarRelatorioDre(mes){
  state.relatorioDreMes = mes;
  state.relatorioDreCarregando = true; render();
  var res = await sb.rpc("relatorio_dre", {p_mes: mes+"-01"});
  state.relatorioDreCarregando = false;
  if(res.error){
    toast("err","ERRO AO CARREGAR DRE", res.error.message);
    state.relatorioDreResultado = null; render(); return;
  }
  state.relatorioDreResultado = res.data;
  render();
}

// Itens ativos (PENDENTE/PREPARANDO/PRONTO) de comandas do dia operacional
// de hoje, independente do status da comanda — inclui comandas já PAGA
// (balcão/ficha paga na hora). Sem isso o KDS perdia o pedido assim que a
// comanda era paga, mesmo com item ainda não entregue. Consulta leve
// (só os itens ativos de hoje), não recarrega histórico.
async function carregarKdsItensHoje(){
  var hoje = hojeOperacionalStr();
  var res = await sb.from("comanda_itens")
    .select("*, comandas!inner(id,codigo,mesa_id,tipo,ficha_numero,status,dia_operacional)")
    .in("status", ["PENDENTE","PREPARANDO","PRONTO"])
    .eq("comandas.dia_operacional", hoje);
  if(res.error){ state.kdsItensAvulsos = []; return; }
  state.kdsItensAvulsos = res.data
    .filter(function(row){ return row.comandas.status!=="ABERTA" && row.comandas.status!=="FECHANDO"; })
    .map(function(row){
      var item = mapItem(row);
      item._comanda = {id:row.comandas.id, codigo:row.comandas.codigo, mesaId:row.comandas.mesa_id, tipo:row.comandas.tipo, fichaNumero:row.comandas.ficha_numero};
      return item;
    });
}

// Fase 0.4 — a view antiga (usuarios_login) era aberta pra anon sem filtro
// de empresa, listando funcionário de qualquer empresa do projeto
// compartilhado. Agora exige o slug do restaurante (mesmo conceito do
// cardápio público) e devolve o e-mail de login pronto (nunca mais
// derivado do nome no client).
async function carregarUsuariosLogin(){
  if(!state.restauranteSlug){ render(); return; }
  try{
    var res = await sb.rpc("usuarios_login_por_empresa", {p_slug: state.restauranteSlug});
    if(res.error){
      state.usuariosLogin = [];
      state.restauranteSlugErro = "Restaurante não encontrado.";
    } else {
      state.usuariosLogin = res.data || [];
    }
  }catch(e){ state.usuariosLogin = []; }
  render();
}

async function carregarTudo(){
  var erros = [];
  function checar(res, nome){ if(res && res.error){ erros.push(nome+": "+res.error.message); return null; } return res ? res.data : null; }

  var catRes = await sb.from("categorias").select("*").order("ordem");
  var prodRes = await sb.from("produtos").select("*");
  var mesasRes = await sb.from("mesas").select("*").order("numero");
  var insRes = await sb.from("insumos").select("*").order("nome");
  var fichaRes = await sb.from("ficha_tecnica").select("*");
  var usrRes = await sb.from("usuarios").select("*").order("nome");
  var empRes = await sb.from("empresas").select("*").eq("id", state.empresaId).single();

  var catData = checar(catRes,"categorias") || [];
  var catPorId = {};
  state.categorias = catData.map(function(c){ catPorId[c.id]=c.nome; return c.nome; });
  state.categoriaIdPorNome = {};
  catData.forEach(function(c){ state.categoriaIdPorNome[c.nome]=c.id; });
  state.produtos = (checar(prodRes,"produtos")||[]).map(function(p){ return mapProduto(p, catPorId); });
  var grupRes = await sb.from("grupos_opcoes").select("*").order("ordem");
  state.gruposOpcoes = (checar(grupRes,"grupos_opcoes")||[]).map(mapGrupoOpcoes);
  var opcRes = await sb.from("opcoes").select("*").order("ordem");
  state.opcoes = (checar(opcRes,"opcoes")||[]).map(mapOpcao);
  state.mesas = (checar(mesasRes,"mesas")||[]).map(mapMesa);
  state.insumos = (checar(insRes,"insumos")||[]).map(mapInsumo);
  state.fichaTecnica = (checar(fichaRes,"ficha_tecnica")||[]).map(function(f){ return {produtoId:f.produto_id, insumoId:f.insumo_id, quantidade:Number(f.quantidade)}; });
  state.usuarios = (checar(usrRes,"usuarios")||[]).map(mapUsuario);
  var emp = checar(empRes,"empresas");
  if(emp){
    state.config = Object.assign({}, state.config, emp.config||{}, {empresaNome:emp.nome, empresaCnpj:emp.cnpj||"", totalFichas:emp.total_fichas||50, slug:emp.slug||""});
  }

  var rendRes = await sb.from("insumo_rendimentos").select("*");
  state.insumoRendimentos = (checar(rendRes,"insumo_rendimentos")||[]).map(mapRendimento);

  var cliRes = await sb.from("clientes").select("*").order("nome");
  state.clientes = (checar(cliRes,"clientes")||[]).map(mapCliente);

  var fornRes = await sb.from("fornecedores").select("*").order("nome");
  state.fornecedores = (checar(fornRes,"fornecedores")||[]).map(mapFornecedor);

  var pedRes = await sb.from("pedidos_compra").select("*, pedidos_compra_itens(*)").order("created_at",{ascending:false}).limit(50);
  state.pedidosCompra = (checar(pedRes,"pedidos_compra")||[]).map(function(p){
    var m = mapPedidoCompra(p);
    m.itens = (p.pedidos_compra_itens||[]).map(mapPedidoCompraItem);
    return m;
  });

  var pqrRes = await sb.from("pedidos_qr").select("*").eq("status","PENDENTE").order("created_at");
  state.pedidosQr = (checar(pqrRes,"pedidos_qr")||[]).map(mapPedidoQr);

  var comRes = await sb.from("comandas").select("*, comanda_itens(*)").in("status",["ABERTA","FECHANDO"]);
  state.comandas = (checar(comRes,"comandas")||[]).map(function(c){
    var m = mapComanda(c);
    m.itens = (c.comanda_itens||[]).map(mapItem);
    return m;
  });

  state.vendasHoje = await carregarComandasPagas(inicioDiaOperacionalIso());
  await carregarKdsItensHoje();
  verificarNovosPedidosKds();

  // Fase 1.6 — cada terminal só enxerga (e só pode fechar) a sessão de
  // caixa aberta com o nome de terminal salvo NESTE dispositivo; antes
  // pegava sempre a sessão aberta mais recente de qualquer terminal, então
  // dois caixas abertos ao mesmo tempo colidiam.
  var sessRes = await sb.from("caixa_sessoes").select("*").eq("status","ABERTA").eq("terminal", state.caixaTerminalNome).order("abertura_em",{ascending:false}).limit(1);
  var sessData = checar(sessRes,"caixa_sessoes");
  state.caixaSessao = (sessData && sessData[0]) ? mapCaixaSessao(sessData[0]) : null;

  if(state.caixaSessao){
    var movRes = await sb.from("caixa_movimentos").select("*").eq("sessao_id", state.caixaSessao.id);
    state.caixaMovimentos = (checar(movRes,"caixa_movimentos")||[]).map(mapMovimento);
  } else {
    state.caixaMovimentos = [];
  }

  var histRes = await sb.from("caixa_sessoes").select("*").eq("status","FECHADA").order("fechamento_em",{ascending:false}).limit(10);
  state.caixaSessoesHistorico = (checar(histRes,"historico")||[]).slice().reverse().map(mapCaixaSessao);

  var contasRes = await sb.from("contas").select("*").order("vencimento");
  state.contas = (checar(contasRes,"contas")||[]).map(mapConta);

  var estMovRes = await sb.from("estoque_movimentos").select("*").order("created_at",{ascending:false}).limit(50);
  state.estoqueMovimentos = (checar(estMovRes,"estoque_movimentos")||[]).map(mapEstoqueMov).reverse();

  var audRes = await sb.from("auditoria").select("*").order("created_at",{ascending:false}).limit(50);
  state.auditoria = (checar(audRes,"auditoria")||[]).map(mapAuditoria);

  if(erros.length) toast("err","ERRO AO CARREGAR DADOS", erros.join(" · "));
  render();
}

var realtimeChannel = null;
var refreshTimer = null;
var refreshPendenteOculto = false;
function agendarRefresh(){
  if(refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(function(){
    // aba em segundo plano: adia o reload completo em vez de gastar
    // banda/CPU num terminal que ninguém está olhando; recupera quando
    // a aba volta a ficar visível.
    if(document.visibilityState === "hidden"){ refreshPendenteOculto = true; return; }
    carregarTudo();
  }, 600);
}
document.addEventListener("visibilitychange", function(){
  if(document.visibilityState === "visible" && refreshPendenteOculto && state && state.usuarioAtualId){
    refreshPendenteOculto = false;
    carregarTudo();
  }
});
// Fase 1.7 — Realtime incremental: comandas/comanda_itens (o par que muda
// a cada pedido lançado/status de KDS/transferência) aplica o payload
// direto no state, sem request nenhum na maioria dos casos — só cai pra
// uma consulta leve (carregarKdsItensHoje) no caso raro de item numa
// comanda que não está em state.comandas (ex: venda avulsa já paga). As
// tabelas de baixo volume (cardápio, estoque, financeiro, equipe, compras)
// continuam no agendarRefresh (recarrega tudo) — não é o caminho medido
// pelo "pronto quando" desta fase, e são mudanças raras o bastante pra não
// valer a complexidade de aplicar incremental em cada uma.
function aplicarComandaRealtime(payload){
  try{
    if(payload.eventType==="DELETE"){
      state.comandas = state.comandas.filter(function(c){ return c.id!==payload.old.id; });
      render(); return;
    }
    var row = payload.new;
    var aberta = row.status==="ABERTA" || row.status==="FECHANDO";
    var idx = state.comandas.findIndex(function(c){ return c.id===row.id; });
    if(!aberta){
      if(idx!==-1){ state.comandas.splice(idx,1); render(); }
      return;
    }
    if(idx===-1){
      state.comandas.push(mapComanda(row));
    } else {
      var itensAtuais = state.comandas[idx].itens;
      var pagamentosAtuais = state.comandas[idx].pagamentos;
      state.comandas[idx] = mapComanda(row);
      state.comandas[idx].itens = itensAtuais;
      state.comandas[idx].pagamentos = pagamentosAtuais;
    }
    render();
  }catch(e){ agendarRefresh(); }
}
function aplicarComandaItemRealtime(payload){
  try{
    if(payload.eventType==="DELETE"){
      state.comandas.forEach(function(c){ c.itens = c.itens.filter(function(it){ return it.id!==payload.old.id; }); });
      state.kdsItensAvulsos = (state.kdsItensAvulsos||[]).filter(function(it){ return it.id!==payload.old.id; });
      render(); return;
    }
    var row = payload.new;
    // remove de onde estiver localmente antes de recolocar — cobre
    // transferir_item (1.1), que muda comanda_id de um UPDATE.
    state.comandas.forEach(function(c){ c.itens = c.itens.filter(function(it){ return it.id!==row.id; }); });
    state.kdsItensAvulsos = (state.kdsItensAvulsos||[]).filter(function(it){ return it.id!==row.id; });

    var comanda = state.comandas.find(function(c){ return c.id===row.comanda_id; });
    if(comanda){
      comanda.itens.push(mapItem(row));
      verificarNovosPedidosKds();
      render();
      return;
    }
    carregarKdsItensHoje().then(function(){ verificarNovosPedidosKds(); render(); });
  }catch(e){ agendarRefresh(); }
}
function configurarRealtime(){
  try{
    desligarRealtime();
    if(!state.empresaId) return;
    if(typeof window.WebSocket === "undefined"){ console.error("WebSocket indisponível — realtime desativado."); return; }
    var eq = "empresa_id=eq."+state.empresaId;
    realtimeChannel = sb.channel("empresa-"+state.empresaId)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"comandas", filter:eq}, aplicarComandaRealtime)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"comanda_itens"}, aplicarComandaItemRealtime)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"caixa_sessoes", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"caixa_movimentos"}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"produtos", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"insumos", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"contas", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"usuarios", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"insumo_rendimentos", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"fornecedores", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"pedidos_compra", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"grupos_opcoes", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"opcoes", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"pedidos_qr", filter:eq}, agendarRefresh)
      .subscribe(function(status){
        // reconexão depois de queda pode ter perdido eventos no meio —
        // única situação em que ainda vale recarregar tudo (fallback).
        if((status==="CHANNEL_ERROR" || status==="TIMED_OUT") && state.usuarioAtualId) agendarRefresh();
      });
  }catch(e){ console.error("realtime indisponível:", e.message); }
}
function desligarRealtime(){
  if(realtimeChannel){ sb.removeChannel(realtimeChannel); realtimeChannel = null; }
  if(refreshTimer){ clearTimeout(refreshTimer); refreshTimer = null; }
}

function usuarioAtual(){
  return state.usuarios.find(function(u){ return u.id===state.usuarioAtualId; });
}
function can(permissao){
  var u = usuarioAtual();
  if(!u) return false;
  var lista = MATRIZ[u.papel] || [];
  return lista.indexOf(permissao) !== -1;
}
// Fase 0.7 — auditoria só pelo servidor: comandas/usuarios/produtos já têm
// trigger genérico (fn_audit_trigger, 0021) que grava sozinho em qualquer
// INSERT/UPDATE, inclusive os feitos por RPC SECURITY DEFINER. A policy
// auditoria_insert (0047) passa a recusar insert direto do client — então
// isso aqui é só otimismo visual (a tela de Auditoria já reflete o evento
// antes do próximo refresh buscar a linha real gravada pelo trigger/RPC).
function registrarAuditoriaLocal(entidade, entidadeId, acao, usuarioId, motivo){
  state.auditoria.unshift({
    id:uid("aud"), entidade:entidade, entidadeId:entidadeId, acao:acao,
    usuarioId:usuarioId, motivo:motivo||null, createdAt:new Date().toISOString()
  });
}
function toast(tipo, titulo, desc){
  var id = uid("toast");
  state.toasts.push({id:id, tipo:tipo, titulo:titulo, desc:desc});
  render();
  setTimeout(function(){
    state.toasts = state.toasts.filter(function(t){ return t.id!==id; });
    render();
  }, 3200);
}

function comandasAbertasDaMesa(mesaId){
  return state.comandas.filter(function(c){ return c.mesaId===mesaId && (c.status==="ABERTA" || c.status==="FECHANDO"); });
}
function mesaStatus(mesaId){
  var abertas = comandasAbertasDaMesa(mesaId);
  if(abertas.length===0) return "livre";
  if(abertas.some(function(c){ return c.status==="FECHANDO"; })) return "pagamento";
  return "ocupada";
}
// Fase 1.5 — aviso "pronto para servir": a cozinha já atualiza o status do
// item via RPC/update, e o Realtime (configurarRealtime) já recarrega todo
// terminal em ~600ms quando comanda_itens muda — só falta o garçom
// enxergar isso na mesa/comanda sem precisar entrar em cada uma.
function mesaTemItemPronto(mesaId){
  return comandasAbertasDaMesa(mesaId).some(function(c){
    return c.itens.some(function(it){ return it.status==="PRONTO"; });
  });
}
function mesaMinutos(mesaId){
  var abertas = comandasAbertasDaMesa(mesaId);
  if(!abertas.length) return 0;
  var min = abertas.map(function(c){ return minutosDesde(c.abertura); });
  return Math.max.apply(null, min);
}
// Fase 1.3 — grupos de opções (perguntas/adicionais) de um produto, cada
// um já com suas opções ativas juntas, na ordem cadastrada.
function gruposDoProduto(produtoId){
  return state.gruposOpcoes
    .filter(function(g){ return g.produtoId===produtoId; })
    .map(function(g){
      return {grupo:g, opcoes: state.opcoes.filter(function(o){ return o.grupoId===g.id && o.ativo; })};
    });
}
// variante pra tela de gestão: mostra opção desativada também (pra poder reativar)
function gruposComInativasDoProduto(produtoId){
  return state.gruposOpcoes
    .filter(function(g){ return g.produtoId===produtoId; })
    .map(function(g){
      return {grupo:g, opcoes: state.opcoes.filter(function(o){ return o.grupoId===g.id; })};
    });
}
function totaisComanda(comanda){
  var subtotal = 0;
  comanda.itens.forEach(function(it){
    if(it.status==="CANCELADO") return;
    subtotal += it.precoUnitCentavos * it.quantidade;
  });
  var desconto = comanda.descontoCentavos || 0;
  var taxaPct = comanda.taxaServicoAtiva ? state.config.taxaServicoPctPadrao : 0;
  var taxa = Math.round((subtotal - desconto) * taxaPct / 100);
  var taxaEntrega = comanda.taxaEntregaCentavos || 0;
  var total = subtotal - desconto + taxa + taxaEntrega;
  // Fase 0.5 — comanda paga já tem o total real travado no momento do
  // pagamento (comandas.total_centavos, gravado por confirmar_pagamento).
  // Usa ele em vez de recalcular com a taxa ATUAL, que reescreveria o
  // histórico de vendas toda vez que a taxa de serviço mudasse.
  if(comanda.totalCentavos!=null) total = comanda.totalCentavos;
  return {subtotal:subtotal, desconto:desconto, taxaPct:taxaPct, taxa:taxa, taxaEntrega:taxaEntrega, total:Math.max(0,total)};
}
// Fase 1.2 — dividir conta por item: itens ainda não cobertos por nenhum
// pagamento (pagoEm nulo), e o total que falta pagar deles — diferente de
// totaisComanda() (que segue mostrando o valor da comanda inteira, usado
// no mapa de mesas/dashboard). Desconto da comanda só entra quando fecha
// tudo de uma vez (mesma suposição da RPC confirmar_pagamento, 0049).
function itensNaoPagos(comanda){
  return comanda.itens.filter(function(it){ return it.status!=="CANCELADO" && !it.pagoEm; });
}
// Fase 1.4 — detecta item novo em PENDENTE pra tocar o bipe do KDS. Roda a
// cada carregarTudo() (inclusive os disparados pelo Realtime), então pega
// pedido novo de qualquer terminal em até ~1s, sem recarregar a página. A
// primeira chamada só grava a base (não bipa o que já estava pendente
// antes do usuário abrir a tela).
function verificarNovosPedidosKds(){
  var idsPendentes = {};
  state.comandas.forEach(function(c){
    if(c.status!=="ABERTA" && c.status!=="FECHANDO") return;
    c.itens.forEach(function(it){ if(it.status==="PENDENTE") idsPendentes[it.id]=true; });
  });
  (state.kdsItensAvulsos||[]).forEach(function(it){ if(it.status==="PENDENTE") idsPendentes[it.id]=true; });

  if(!state.kdsBaselineFeito){
    state.kdsSomVistos = idsPendentes;
    state.kdsBaselineFeito = true;
    return;
  }
  var novo = Object.keys(idsPendentes).some(function(id){ return !state.kdsSomVistos[id]; });
  state.kdsSomVistos = idsPendentes;
  if(novo && state.kdsSomAtivo) tocarBipKds();
}
function totaisNaoPagos(comanda, apenasIds){
  var itens = itensNaoPagos(comanda);
  if(apenasIds) itens = itens.filter(function(it){ return apenasIds[it.id]; });
  var subtotal = itens.reduce(function(s,it){ return s+it.precoUnitCentavos*it.quantidade; },0);
  // sem apenasIds = "pagar tudo que falta" (modo pessoas), desconto da
  // comanda entra — igual a RPC confirmar_pagamento (0049). Com apenasIds
  // (modo por item, subconjunto escolhido), sem desconto.
  var desconto = apenasIds ? 0 : (comanda.descontoCentavos||0);
  var taxaEntrega = apenasIds ? 0 : (comanda.taxaEntregaCentavos||0);
  var taxaPct = comanda.taxaServicoAtiva ? state.config.taxaServicoPctPadrao : 0;
  var taxa = Math.round((subtotal-desconto) * taxaPct / 100);
  var total = Math.max(0, subtotal - desconto + taxa + taxaEntrega);
  return {subtotal:subtotal, desconto:desconto, taxaPct:taxaPct, taxa:taxa, taxaEntrega:taxaEntrega, total:total};
}

