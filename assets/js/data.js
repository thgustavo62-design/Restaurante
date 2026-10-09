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
// PRIORIDADE 1 — Central do Dono: uma RPC só, agregada no banco. Chamada
// ao entrar na tela, a cada 60s enquanto ela estiver aberta (main.js) e
// de novo quando o Realtime avisa de uma venda nova (data.js,
// aplicarComandaRealtime) — nunca baixa comandas/itens pra somar aqui.
async function carregarCentralDono(){
  var res = await sb.rpc("central_do_dono");
  if(res.error){
    if(!state.centralDono) toast("err","ERRO AO CARREGAR A CENTRAL DO DONO", res.error.message);
    return;
  }
  state.centralDono = mapCentralDono(res.data);
  render();
}
// PRIORIDADE 3 — Perdas e Desperdícios (Estoque → Produção... Perdas).
// Lista recente (direto da tabela, só pra exibir — nunca somada aqui) +
// relatorio_perdas (agregado no banco: total, % do faturamento, por
// motivo, por semana, top5), mesmo período das abas de Relatórios.
async function carregarPerdas(periodo){
  var hoje = hojeOperacionalStr();
  var desde, ate;
  if(periodo==="7D"){ desde = diasA(-6); ate = hoje; }
  else if(periodo==="30D"){ desde = diasA(-29); ate = hoje; }
  else if(periodo==="MES"){
    var mes = state.perdasMes || hoje.slice(0,7);
    state.perdasMes = mes;
    var partes = mes.split("-").map(Number);
    var ultimoDia = new Date(partes[0], partes[1], 0).getDate();
    desde = mes+"-01"; ate = mes+"-"+String(ultimoDia).padStart(2,"0");
  } else { desde = hoje; ate = hoje; }
  state.perdasCarregando = true; render();
  var listaRes = await sb.from("perdas").select("*").gte("dia_operacional", desde).lte("dia_operacional", ate).order("created_at", {ascending:false}).limit(50);
  var relRes = await sb.rpc("relatorio_perdas", {p_desde: desde, p_ate: ate});
  state.perdasCarregando = false;
  if(relRes.error){
    toast("err","ERRO AO CARREGAR PERDAS", relRes.error.message);
    state.perdasRelatorio = null; render(); return;
  }
  state.perdasLista = listaRes.error ? [] : listaRes.data.map(mapPerda);
  state.perdasRelatorio = relRes.data;
  render();
}
// PRIORIDADE 4 — lista de compras sugerida (agregada no banco: consumo
// dos últimos 28 dias × ficha técnica, prazo de entrega do fornecedor
// padrão de cada insumo) e relatório de preços (histórico, alerta de
// aumento, pratos que perderam margem) — nenhuma soma feita aqui.
async function carregarListaComprasSugerida(){
  state.listaComprasCarregando = true; render();
  var res = await sb.rpc("lista_compras_sugerida");
  state.listaComprasCarregando = false;
  if(res.error){ toast("err","ERRO AO CARREGAR A LISTA DE COMPRAS", res.error.message); state.listaComprasSugerida = null; render(); return; }
  state.listaComprasSugerida = res.data;
  render();
}
async function carregarRelatorioPrecos(){
  state.precosCarregando = true; render();
  var res = await sb.rpc("relatorio_precos_insumo");
  state.precosCarregando = false;
  if(res.error){ toast("err","ERRO AO CARREGAR PREÇOS", res.error.message); state.precosRelatorio = null; render(); return; }
  state.precosRelatorio = res.data;
  render();
}
// PRIORIDADE 5 — Controle de Equipe. Cada sub-aba carrega só o que
// precisa, na hora que abre (0.11) — nada disto entra em carregarTudo().
async function carregarEscalas(){
  var res = await sb.from("escalas").select("*");
  if(res.error){ toast("err","ERRO AO CARREGAR ESCALA", res.error.message); return; }
  var porUsuario = {};
  res.data.map(mapEscala).forEach(function(e){
    if(!porUsuario[e.usuarioId]) porUsuario[e.usuarioId] = [];
    porUsuario[e.usuarioId].push(e);
  });
  state.escalasPorUsuario = porUsuario;
  var resHoje = await sb.rpc("escala_hoje");
  state.escalaHoje = resHoje.error ? [] : resHoje.data;
  render();
}
async function carregarPontosRecentes(){
  var res = await sb.from("pontos").select("*").order("registrado_em", {ascending:false}).limit(50);
  state.pontosRecentes = res.error ? [] : res.data.map(mapPonto);
  render();
}
async function carregarDesempenhoEquipe(periodo){
  var hoje = hojeOperacionalStr();
  var desde, ate;
  if(periodo==="30D"){ desde = diasA(-29); ate = hoje; }
  else if(periodo==="MES"){
    var mes = state.desempenhoMes || hoje.slice(0,7);
    state.desempenhoMes = mes;
    var partes = mes.split("-").map(Number);
    var ultimoDia = new Date(partes[0], partes[1], 0).getDate();
    desde = mes+"-01"; ate = mes+"-"+String(ultimoDia).padStart(2,"0");
  } else { desde = diasA(-6); ate = hoje; }
  state.desempenhoCarregando = true; render();
  var res = await sb.rpc("relatorio_desempenho_equipe", {p_desde: desde, p_ate: ate});
  state.desempenhoCarregando = false;
  if(res.error){ toast("err","ERRO AO CARREGAR DESEMPENHO", res.error.message); state.desempenhoResultado = null; render(); return; }
  state.desempenhoResultado = res.data;
  render();
}
async function carregarCustoEquipe(){
  var remRes = await sb.from("funcionarios_remuneracao").select("*");
  var valesRes = await sb.from("vales_adiantamentos").select("*").order("data", {ascending:false}).limit(100);
  if(remRes.error){ toast("err","ERRO", remRes.error.message); }
  var porUsuarioRem = {};
  (remRes.data||[]).map(mapRemuneracao).forEach(function(r){ porUsuarioRem[r.usuarioId] = r; });
  state.remuneracoesPorUsuario = porUsuarioRem;
  var porUsuarioVales = {};
  (valesRes.data||[]).map(mapVale).forEach(function(v){
    if(!porUsuarioVales[v.usuarioId]) porUsuarioVales[v.usuarioId] = [];
    porUsuarioVales[v.usuarioId].push(v);
  });
  state.valesPorUsuario = porUsuarioVales;
  if(!state.fechamentoDesde){ state.fechamentoDesde = diasA(-14); state.fechamentoAte = hojeOperacionalStr(); }
  render();
  carregarFechamentoEquipe();
}
// PRIORIDADE 7 — Financeiro simples: gera as despesas fixas do mês antes
// de ler o resumo (idempotente — a RPC só lança se ainda não lançou pra
// este mês), depois agrega tudo no banco (relatorio_financeiro_resumo).
// PRIORIDADE 8 — fila de espera: posição e tempo estimado vêm prontos
// do banco (listar_fila_espera, pelo tempo médio de ocupação das mesas)
// — carregada só quando a sub-aba Reservas e fila abre (0.11).
async function carregarFilaEspera(){
  var res = await sb.rpc("listar_fila_espera");
  if(res.error){ toast("err","ERRO AO CARREGAR A FILA", res.error.message); state.filaEspera = []; render(); return; }
  state.filaEspera = res.data.map(mapFilaEntrada);
  render();
}
async function carregarFinanceiroResumo(){
  var gerou = await sb.rpc("gerar_despesas_recorrentes_do_mes");
  if(gerou.error){ toast("err","ERRO", gerou.error.message); }
  else if(gerou.data && gerou.data.length){
    gerou.data.forEach(function(c){ state.contas.push(mapConta(c)); });
  }
  var despRes = await sb.from("despesas_recorrentes").select("*").order("descricao");
  state.despesasRecorrentes = despRes.error ? [] : despRes.data.map(mapDespesaRecorrente);

  var mes = state.financeiroResumoMes || hojeOperacionalStr().slice(0,7);
  state.financeiroResumoMes = mes;
  state.financeiroResumoCarregando = true; render();
  var res = await sb.rpc("relatorio_financeiro_resumo", {p_mes: mes+"-01"});
  state.financeiroResumoCarregando = false;
  if(res.error){ toast("err","ERRO AO CARREGAR O RESUMO", res.error.message); state.financeiroResumoResultado = null; render(); return; }
  state.financeiroResumoResultado = res.data;
  render();
}
async function carregarFechamentoEquipe(){
  state.fechamentoCarregando = true; render();
  var res = await sb.rpc("relatorio_fechamento_equipe", {p_desde: state.fechamentoDesde, p_ate: state.fechamentoAte});
  state.fechamentoCarregando = false;
  if(res.error){ toast("err","ERRO AO CARREGAR FECHAMENTO", res.error.message); state.fechamentoResultado = null; render(); return; }
  state.fechamentoResultado = res.data;
  render();
}
// PRIORIDADE 2 — checklist de pré-preparo do dia (Cozinha → Produção).
// abrir_checklist_pre_preparo gera (na primeira vez do dia) ou só lê as
// linhas de hoje, já com a sugestão calculada no banco a partir das
// últimas 4 semanas — nada é somado aqui no navegador.
async function carregarChecklistPreProducao(ajustePct){
  var res = await sb.rpc("abrir_checklist_pre_preparo", {p_ajuste_pct: ajustePct||0});
  if(res.error){ toast("err","ERRO AO CARREGAR A PRODUÇÃO", res.error.message); return; }
  state.preProducaoChecklist = {diaOperacional: res.data.dia_operacional, itens: (res.data.itens||[]).map(mapPrePreparoItem)};
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
  var fichaInsumoRes = await sb.from("ficha_tecnica_insumo").select("*");
  // VF-005 — email_interno nunca foi usado no client (mapUsuario nem lê
  // esse campo) e é a credencial de login (0076/CLAUDE.md); deixou de
  // vir pro navegador. Coluna revogada de verdade pra authenticated/anon
  // (0077), select(*) quebraria — por isso a lista explícita aqui.
  var usrRes = await sb.from("usuarios").select("id, empresa_id, nome, papel, ativo, peso_rateio_taxa, created_at, updated_at").order("nome");
  var empRes = await sb.from("empresas").select("*").eq("id", state.empresaId).single();
  // PRIORIDADE 8 — só reservas em aberto (lista pequena, pro Mapa saber
  // quem está reservado pras próximas 2h sem depender da sub-aba
  // Reservas e fila ter sido aberta) — fila de espera é lazy (0.11).
  var reservasRes = await sb.from("reservas").select("*").in("status",["AGUARDANDO","CONFIRMADA"]).order("data_hora");

  var catData = checar(catRes,"categorias") || [];
  var catPorId = {};
  var catTempoPorId = {};
  state.categorias = catData.map(function(c){ catPorId[c.id]=c.nome; catTempoPorId[c.id]=c.tempo||"PRINCIPAL"; return c.nome; });
  state.categoriaIdPorNome = {};
  catData.forEach(function(c){ state.categoriaIdPorNome[c.nome]=c.id; });
  state.produtos = (checar(prodRes,"produtos")||[]).map(function(p){ return mapProduto(p, catPorId, catTempoPorId); });
  var grupRes = await sb.from("grupos_opcoes").select("*").order("ordem");
  state.gruposOpcoes = (checar(grupRes,"grupos_opcoes")||[]).map(mapGrupoOpcoes);
  var opcRes = await sb.from("opcoes").select("*").order("ordem");
  state.opcoes = (checar(opcRes,"opcoes")||[]).map(mapOpcao);
  state.mesas = (checar(mesasRes,"mesas")||[]).map(mapMesa);
  state.insumos = (checar(insRes,"insumos")||[]).map(mapInsumo);
  state.fichaTecnica = (checar(fichaRes,"ficha_tecnica")||[]).map(function(f){ return {produtoId:f.produto_id, insumoId:f.insumo_id, quantidade:Number(f.quantidade)}; });
  state.fichaTecnicaInsumo = (checar(fichaInsumoRes,"ficha_tecnica_insumo")||[]).map(mapFichaTecnicaInsumo);
  state.usuarios = (checar(usrRes,"usuarios")||[]).map(mapUsuario);
  state.reservas = (checar(reservasRes,"reservas")||[]).map(mapReserva);
  var emp = checar(empRes,"empresas");
  if(emp){
    state.config = Object.assign({}, state.config, emp.config||{}, {empresaNome:emp.nome, empresaCnpj:emp.cnpj||"", totalFichas:emp.total_fichas||50, slug:emp.slug||""});
  }

  var rendRes = await sb.from("insumo_rendimentos").select("*");
  state.insumoRendimentos = (checar(rendRes,"insumo_rendimentos")||[]).map(mapRendimento);

  var cliRes = await sb.from("clientes").select("*").order("nome");
  state.clientes = (checar(cliRes,"clientes")||[]).map(mapCliente);

  var cupRes = await sb.from("cupons").select("*").order("created_at",{ascending:false});
  state.cupons = (checar(cupRes,"cupons")||[]).map(mapCupom);

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

  // 0.5 — conflitos de sincronização offline pendentes de decisão
  // (GERENTE/ADMIN); RLS já restringe pra quem tem a permissão, então
  // pedir pra todo mundo só devolve vazio pra quem não pode ver.
  var syncRes = await sb.from("sync_conflitos").select("*").eq("status","PENDENTE").order("created_at");
  state.syncConflitos = (checar(syncRes,"sync_conflitos")||[]).map(mapSyncConflito);

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
    // PRIORIDADE 1 — "atualizada por Realtime em vendas": uma comanda que
    // acabou de virar PAGA é exatamente isso; só refaz a RPC se a tela
    // estiver aberta, pra não gastar à toa em terminais olhando outra coisa.
    if(row.status==="PAGA" && state.view==="central") carregarCentralDono();
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
// PRIORIDADE 10 — notificação (app aberto, mesmo em segundo plano) pros
// dois eventos que exigem um humano decidir algo e podem passar batido
// se ninguém estiver olhando pra tela Salão/Financeiro na hora: pedido
// pelo QR esperando aprovação e pagamento offline em conflito. Dispara na
// hora, direto do payload do INSERT — não espera o agendarRefresh
// (debounced e pausado com a aba em segundo plano, exatamente quando a
// notificação mais importa).
function aplicarPedidoQrRealtime(payload){
  agendarRefresh();
  if(payload.eventType==="INSERT" && payload.new.status==="PENDENTE"){
    notificarSeAtivo("Pedido pelo QR aguardando aprovação", "Peça feita pelo celular do cliente — revise e aprove pra ir pra cozinha.", "pedido-qr-"+payload.new.id);
  }
}
function aplicarSyncConflitoRealtime(payload){
  agendarRefresh();
  if(payload.eventType==="INSERT" && payload.new.status==="PENDENTE"){
    notificarSeAtivo("Pagamento offline pra revisar", "Um pagamento feito sem internet está aguardando sua decisão.", "sync-conflito-"+payload.new.id);
  }
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
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"ficha_tecnica_insumo"}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"contas", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"usuarios", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"insumo_rendimentos", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"fornecedores", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"pedidos_compra", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"grupos_opcoes", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"opcoes", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"pedidos_qr", filter:eq}, aplicarPedidoQrRealtime)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"reservas", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"fila_espera", filter:eq}, agendarRefresh)
      .on("postgres_changes", {event:"*", schema:"restaurante", table:"sync_conflitos", filter:eq}, aplicarSyncConflitoRealtime)
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

