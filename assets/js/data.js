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

  var fornRes = await sb.from("fornecedores").select("*").order("nome");
  state.fornecedores = (checar(fornRes,"fornecedores")||[]).map(mapFornecedor);

  var pedRes = await sb.from("pedidos_compra").select("*, pedidos_compra_itens(*)").order("created_at",{ascending:false}).limit(50);
  state.pedidosCompra = (checar(pedRes,"pedidos_compra")||[]).map(function(p){
    var m = mapPedidoCompra(p);
    m.itens = (p.pedidos_compra_itens||[]).map(mapPedidoCompraItem);
    return m;
  });

  var comRes = await sb.from("comandas").select("*, comanda_itens(*)").in("status",["ABERTA","FECHANDO"]);
  state.comandas = (checar(comRes,"comandas")||[]).map(function(c){
    var m = mapComanda(c);
    m.itens = (c.comanda_itens||[]).map(mapItem);
    return m;
  });

  state.vendasHoje = await carregarComandasPagas(inicioDiaOperacionalIso());
  await carregarKdsItensHoje();

  var sessRes = await sb.from("caixa_sessoes").select("*").eq("status","ABERTA").order("abertura_em",{ascending:false}).limit(1);
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
function configurarRealtime(){
  try{
    desligarRealtime();
    if(!state.empresaId) return;
    if(typeof window.WebSocket === "undefined"){ console.error("WebSocket indisponível — realtime desativado."); return; }
    var eq = "empresa_id=eq."+state.empresaId;
    realtimeChannel = sb.channel("empresa-"+state.empresaId)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"comandas", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"comanda_itens"}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"caixa_sessoes", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"caixa_movimentos"}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"produtos", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"insumos", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"contas", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"usuarios", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"insumo_rendimentos", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"fornecedores", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"pedidos_compra", filter:eq}, agendarRefresh)
      .subscribe();
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
function mesaMinutos(mesaId){
  var abertas = comandasAbertasDaMesa(mesaId);
  if(!abertas.length) return 0;
  var min = abertas.map(function(c){ return minutosDesde(c.abertura); });
  return Math.max.apply(null, min);
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
  var total = subtotal - desconto + taxa;
  // Fase 0.5 — comanda paga já tem o total real travado no momento do
  // pagamento (comandas.total_centavos, gravado por confirmar_pagamento).
  // Usa ele em vez de recalcular com a taxa ATUAL, que reescreveria o
  // histórico de vendas toda vez que a taxa de serviço mudasse.
  if(comanda.totalCentavos!=null) total = comanda.totalCentavos;
  return {subtotal:subtotal, desconto:desconto, taxaPct:taxaPct, taxa:taxa, total:Math.max(0,total)};
}

