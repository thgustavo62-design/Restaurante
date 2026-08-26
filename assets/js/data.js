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
async function carregarVendasPeriodo(periodo){
  var dias = periodo==="7D" ? 7 : periodo==="30D" ? 30 : 3650;
  var desde = new Date(Date.now() - dias*86400000).toISOString();
  state.vendasPeriodoCarregando = true; render();
  state.vendasPeriodo = await carregarComandasPagas(desde);
  state.vendasPeriodoCarregando = false;
  render();
}

async function carregarUsuariosLogin(){
  try{
    var res = await sb.from("usuarios_login").select("id,nome").order("nome");
    state.usuariosLogin = res.data || [];
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
    state.config = Object.assign({}, state.config, emp.config||{}, {empresaNome:emp.nome, empresaCnpj:emp.cnpj||""});
  }

  var comRes = await sb.from("comandas").select("*, comanda_itens(*)").in("status",["ABERTA","FECHANDO"]);
  state.comandas = (checar(comRes,"comandas")||[]).map(function(c){
    var m = mapComanda(c);
    m.itens = (c.comanda_itens||[]).map(mapItem);
    return m;
  });

  state.vendasHoje = await carregarComandasPagas(inicioDiaOperacionalIso());

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
function agendarRefresh(){
  if(refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(function(){ carregarTudo(); }, 400);
}
function configurarRealtime(){
  try{
    desligarRealtime();
    if(!state.empresaId) return;
    if(typeof window.WebSocket === "undefined"){ console.error("WebSocket indisponível — realtime desativado."); return; }
    var eq = "empresa_id=eq."+state.empresaId;
    realtimeChannel = sb.channel("empresa-"+state.empresaId)
      .on("postgres_changes", {event:"*", schema:"public", table:"comandas", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"public", table:"comanda_itens"}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"public", table:"caixa_sessoes", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"public", table:"caixa_movimentos"}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"public", table:"produtos", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"public", table:"insumos", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"public", table:"contas", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"public", table:"usuarios", filter:eq}, agendarRefresh)
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
async function verificarSupervisor(pin, permissaoNecessaria){
  var candidatos = state.usuarios.filter(function(u){
    return u.ativo && (MATRIZ[u.papel]||[]).indexOf(permissaoNecessaria)!==-1;
  });
  var temp = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {auth:{persistSession:false}});
  for(var i=0;i<candidatos.length;i++){
    try{
      var res = await temp.auth.signInWithPassword({email:emailInterno(candidatos[i].nome), password:pin});
      if(!res.error){
        await temp.auth.signOut();
        return candidatos[i];
      }
    }catch(e){}
  }
  return null;
}
function registrarAuditoria(entidade, entidadeId, acao, usuarioId, motivo){
  state.auditoria.unshift({
    id:uid("aud"), entidade:entidade, entidadeId:entidadeId, acao:acao,
    usuarioId:usuarioId, motivo:motivo||null, createdAt:new Date().toISOString()
  });
  sb.from("auditoria").insert({
    empresa_id: state.empresaId, entidade: entidade, entidade_id: entidadeId,
    acao: acao, usuario_id: usuarioId, motivo: motivo||null
  }).then(function(res){ if(res.error) console.error("auditoria:", res.error.message); });
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
  return {subtotal:subtotal, desconto:desconto, taxaPct:taxaPct, taxa:taxa, total:Math.max(0,total)};
}

