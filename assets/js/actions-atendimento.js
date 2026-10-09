"use strict";

// ---------- ações ----------

// Fase 0.4 — slug do restaurante é resolvido uma vez (URL ?r=slug ou
// localStorage) e guardado pra não pedir de novo a cada visita; "Trocar
// restaurante" limpa e volta pra tela de código.
function confirmarRestauranteSlug(){
  var slug = (state.restauranteSlugInput||"").trim().toLowerCase().replace(/\s+/g,"-");
  if(!slug){ state.restauranteSlugErro = "Informe o código do restaurante."; render(); return; }
  state.restauranteSlugErro = "";
  state.restauranteSlug = slug;
  try{ localStorage.setItem("restauranteSlug", slug); }catch(e){}
  carregarUsuariosLogin();
}
function trocarRestaurante(){
  state.restauranteSlug = null;
  state.usuariosLogin = [];
  state.loginUsuarioInput = "";
  state.loginSenhaInput = "";
  state.loginErro = "";
  state.restauranteSlugInput = "";
  state.restauranteSlugErro = "";
  try{ localStorage.removeItem("restauranteSlug"); }catch(e){}
  render();
}

// Fase 0.4 (ajuste): tela de login deixa de ser "clica no seu nome +
// PIN no teclado numérico" e passa a ser usuário digitado + senha normal.
// candidato é resolvido por nome dentro da lista já carregada pro
// restaurante (usuariosLogin, via usuarios_login_por_empresa) — o backend
// continua o mesmo: email_interno é só o "nome de usuário" do GoTrue por
// baixo, nunca exposto na tela.
async function tentarLogin(nomeDigitado, senha){
  var nome = (nomeDigitado||"").trim();
  if(!nome || !senha){ state.loginErro = "Informe usuário e senha."; render(); return; }
  if(pinLockoutAtivo()){
    state.loginErro = "Muitas tentativas. Aguarde "+pinLockoutSegundosRestantes()+"s.";
    render(); return;
  }
  var candidato = state.usuariosLogin.find(function(x){ return x.nome.trim().toLowerCase()===nome.toLowerCase(); });
  if(!candidato){ state.loginErro = "Usuário ou senha incorretos."; render(); return; }
  state.loginVerificando = true; state.loginErro = "";
  render();
  try{
    var res = await sb.auth.signInWithPassword({email:candidato.email, password:senha});
    if(res.error) throw res.error;
    var claims = decodeJwt(res.data.session.access_token);
    if(!claims.empresa_id){ throw new Error("Usuário sem empresa vinculada."); }

    // Fase 4.3 — ADMIN com verificação em duas etapas configurada: PIN
    // sozinho só chega a aal1, falta o código do app autenticador antes
    // de soltar qualquer dado da empresa pro navegador.
    var aal = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if(aal.data && aal.data.nextLevel==="aal2" && aal.data.currentLevel!=="aal2"){
      var factors = await sb.auth.mfa.listFactors();
      var totpFactor = (factors.data&&factors.data.totp||[]).find(function(f){ return f.status==="verified"; });
      if(totpFactor){
        var challenge = await sb.auth.mfa.challenge({factorId: totpFactor.id});
        if(challenge.error) throw challenge.error;
        state.loginMfaPendente = {factorId: totpFactor.id, challengeId: challenge.data.id, claims: claims, userId: res.data.user.id};
        state.loginSenhaInput = ""; state.loginErro = ""; state.loginMfaCodigo = "";
        state.loginVerificando = false;
        render();
        return;
      }
    }

    limparFalhasPin();
    state.usuarioAtualId = res.data.user.id;
    state.empresaId = claims.empresa_id;
    state.loginUsuarioInput = ""; state.loginSenhaInput = ""; state.loginErro = "";
    await carregarTudo();
    // 0.11 — #tela/aba na URL (ex: link compartilhado, favorito do
    // navegador) manda em cima do padrão por papel, só se o papel logado
    // realmente tiver acesso àquela tela.
    if(!aplicarHashInicial()){
      state.view = (claims.papel==="COZINHA") ? "kds" : (claims.papel==="GARCOM"||claims.papel==="CAIXA") ? "salao" : "central";
    }
    configurarRealtime();
  } catch(e){
    state.loginSenhaInput = "";
    var bloqueado = registrarFalhaPin();
    state.loginErro = bloqueado ? "Muitas tentativas. Aguarde 30s." : "Usuário ou senha incorretos.";
  }
  state.loginVerificando = false;
  render();
  if(state.view==="central") carregarCentralDono();
}
async function confirmarMfaLogin(codigo){
  var m = state.loginMfaPendente;
  if(!m || !codigo) return;
  state.loginVerificando = true; state.loginErro = ""; render();
  var res = await sb.auth.mfa.verify({factorId:m.factorId, challengeId:m.challengeId, code:codigo});
  if(res.error){
    state.loginErro = "Código inválido.";
    state.loginMfaCodigo = "";
    state.loginVerificando = false; render(); return;
  }
  limparFalhasPin();
  state.usuarioAtualId = m.userId;
  state.empresaId = m.claims.empresa_id;
  state.loginMfaPendente = null; state.loginMfaCodigo = "";
  await carregarTudo();
  if(!aplicarHashInicial()){
    state.view = (m.claims.papel==="COZINHA") ? "kds" : (m.claims.papel==="GARCOM"||m.claims.papel==="CAIXA") ? "salao" : "central";
  }
  configurarRealtime();
  state.loginVerificando = false;
  render();
  if(state.view==="central") carregarCentralDono();
}
function cancelarMfaLogin(){
  state.loginMfaPendente = null; state.loginMfaCodigo = ""; state.loginErro = "";
  sb.auth.signOut();
  render();
}

// Fase 4.3 — configurar/desativar verificação em duas etapas (ADMIN,
// conta própria — fator MFA é por usuário do Supabase Auth, não por
// empresa). Sem servidor próprio: tudo via supabase.auth.mfa, nativo do
// Supabase, sem provedor externo.
async function carregarMfaFactors(){
  var res = await sb.auth.mfa.listFactors();
  state.mfaFactors = (res.data&&res.data.totp)||[];
  render();
}
async function iniciarConfigMfa(){
  var res = await sb.auth.mfa.enroll({factorType:"totp"});
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  state.modal = {type:"mfaSetup", factorId: res.data.id, qrCode: res.data.totp.qr_code, secret: res.data.totp.secret, codigo:"", erro:""};
  render();
}
async function confirmarConfigMfa(codigo){
  var m = state.modal;
  if(!codigo){ m.erro = "Digite o código de 6 dígitos do app autenticador."; render(); return; }
  var challenge = await sb.auth.mfa.challenge({factorId: m.factorId});
  if(challenge.error){ m.erro = challenge.error.message; render(); return; }
  var res = await sb.auth.mfa.verify({factorId:m.factorId, challengeId:challenge.data.id, code:codigo});
  if(res.error){ m.erro = "Código inválido."; render(); return; }
  state.modal = null;
  await carregarMfaFactors();
  render();
  toast("ok","VERIFICAÇÃO EM DUAS ETAPAS ATIVADA", "");
}
async function desativarMfa(factorId){
  var res = await sb.auth.mfa.unenroll({factorId:factorId});
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  await carregarMfaFactors();
  toast("ok","VERIFICAÇÃO EM DUAS ETAPAS DESATIVADA", "");
}
async function logout(){
  desligarRealtime();
  try{ await sb.auth.signOut(); }catch(e){}
  state = estadoVazio();
  render();
  carregarUsuariosLogin();
}

async function abrirComanda(mesaId){
  var payload = {
    empresa_id: state.empresaId, codigo: "C"+Date.now().toString(36).toUpperCase(),
    mesa_id: mesaId, tipo: "MESA", status: "ABERTA",
    usuario_abertura: state.usuarioAtualId, taxa_servico_ativa: true, desconto_centavos: 0
  };
  var res = await sb.from("comandas").insert(payload).select().single();
  if(res.error){ toast("err","ERRO AO ABRIR COMANDA", res.error.message); return; }
  var comanda = mapComanda(res.data);
  state.comandas.push(comanda);
  irParaComanda(comanda.id);
  render();
}
async function abrirComandaBalcao(){
  var payload = {
    empresa_id: state.empresaId, codigo: "C"+Date.now().toString(36).toUpperCase(),
    mesa_id: null, tipo: "BALCAO", status: "ABERTA",
    usuario_abertura: state.usuarioAtualId, taxa_servico_ativa: true, desconto_centavos: 0,
    dia_operacional: hojeOperacionalStr()
  };
  var res = await sb.from("comandas").insert(payload).select().single();
  if(res.error){ toast("err","ERRO AO ABRIR BALCÃO", res.error.message); return; }
  var comanda = mapComanda(res.data);
  state.comandas.push(comanda);
  irParaComanda(comanda.id);
  render();
}

// PRIORIDADE 8 — Reservas / Fila de espera.
function abrirReservaForm(){
  var agora = new Date(Date.now()+2*3600000);
  var local = new Date(agora.getTime()-agora.getTimezoneOffset()*60000).toISOString().slice(0,16);
  state.modal = {type:"reservaForm", nome:"", telefone:"", pessoas:2, dataHoraInput:local, observacao:"", mesaSugeridaId:"", erro:""};
  render();
}
async function salvarReserva(nome, telefone, pessoas, dataHoraInput, observacao, mesaSugeridaId){
  var m = state.modal;
  if(!nome.trim()){ m.erro = "Informe o nome."; render(); return; }
  if(!(pessoas>0)){ m.erro = "Informe quantas pessoas."; render(); return; }
  if(!dataHoraInput){ m.erro = "Informe data e hora."; render(); return; }
  var res = await sb.rpc("criar_reserva", {
    p_nome: nome.trim(), p_telefone: telefone.trim()||null, p_pessoas: pessoas,
    p_data_hora: new Date(dataHoraInput).toISOString(), p_observacao: observacao.trim()||null, p_mesa_sugerida_id: mesaSugeridaId||null
  });
  if(res.error){ m.erro = res.error.message; render(); return; }
  state.reservas.push(mapReserva(res.data));
  state.modal = null;
  render();
  toast("ok","RESERVA CRIADA", nome.trim());
}
async function confirmarReserva(reservaId){
  var res = await sb.rpc("atualizar_status_reserva", {p_reserva_id: reservaId, p_status: "CONFIRMADA"});
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  var r = state.reservas.find(function(x){ return x.id===reservaId; });
  if(r) r.status = "CONFIRMADA";
  render();
  toast("ok","RESERVA CONFIRMADA", "");
}
async function reservaNaoVeio(reservaId){
  var res = await sb.rpc("atualizar_status_reserva", {p_reserva_id: reservaId, p_status: "NAO_VEIO"});
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  state.reservas = state.reservas.filter(function(x){ return x.id!==reservaId; });
  render();
  toast("ok","RESERVA MARCADA COMO NÃO VEIO", "");
}

function abrirFilaForm(){
  state.modal = {type:"filaForm", nome:"", telefone:"", pessoas:2, erro:""};
  render();
}
async function salvarEntrarFila(nome, telefone, pessoas){
  var m = state.modal;
  if(!nome.trim()){ m.erro = "Informe o nome."; render(); return; }
  if(!(pessoas>0)){ m.erro = "Informe quantas pessoas."; render(); return; }
  var res = await sb.rpc("entrar_fila", {p_nome: nome.trim(), p_telefone: telefone.trim()||null, p_pessoas: pessoas});
  if(res.error){ m.erro = res.error.message; render(); return; }
  state.modal = null;
  render();
  toast("ok","ENTROU NA FILA", nome.trim());
  carregarFilaEspera();
}
async function filaChamar(filaId){
  var res = await sb.rpc("atualizar_status_fila", {p_fila_id: filaId, p_status: "CHAMADO"});
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  var f = state.filaEspera.find(function(x){ return x.id===filaId; });
  if(f) f.status = "CHAMADO";
  render();
}
async function filaDesistiu(filaId){
  var res = await sb.rpc("atualizar_status_fila", {p_fila_id: filaId, p_status: "DESISTIU"});
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  carregarFilaEspera();
}

// "Sentar" (reserva ou fila) sempre cria a comanda — mesmo form, só o
// tipo/id mudam qual RPC chamar no confirmar.
function abrirSentarForm(tipo, id, mesaSugeridaId){
  state.modal = {type:"sentarForm", tipo:tipo, id:id, mesaId: mesaSugeridaId||"", erro:""};
  render();
}
async function confirmarSentar(mesaId){
  var m = state.modal;
  if(!mesaId){ m.erro = "Escolha a mesa."; render(); return; }
  var rpc = m.tipo==="reserva" ? "sentar_reserva" : "sentar_fila";
  var params = m.tipo==="reserva" ? {p_reserva_id: m.id, p_mesa_id: mesaId, p_cliente_id: null} : {p_fila_id: m.id, p_mesa_id: mesaId, p_cliente_id: null};
  var res = await sb.rpc(rpc, params);
  if(res.error){ m.erro = res.error.message; render(); return; }
  if(m.tipo==="reserva") state.reservas = state.reservas.filter(function(x){ return x.id!==m.id; });
  else if(state.filaEspera) state.filaEspera = state.filaEspera.filter(function(x){ return x.id!==m.id; });
  state.comandas.push(mapComanda(res.data.comanda));
  state.modal = null;
  render();
  toast("ok","SENTOU NA MESA", "");
  irParaComanda(res.data.comanda.id);
}

async function abrirComandaFicha(){
  var totalFichas = state.config.totalFichas || 50;
  var emUso = {};
  state.comandas.forEach(function(c){
    if(c.tipo==="FICHA" && (c.status==="ABERTA"||c.status==="FECHANDO") && c.fichaNumero) emUso[c.fichaNumero] = true;
  });
  var numero = null;
  for(var n=1; n<=totalFichas; n++){ if(!emUso[n]){ numero = n; break; } }
  if(!numero){ toast("err","SEM FICHAS LIVRES", "Todas as "+totalFichas+" fichas estão em uso."); return; }
  var payload = {
    empresa_id: state.empresaId, codigo: "C"+Date.now().toString(36).toUpperCase(),
    mesa_id: null, tipo: "FICHA", ficha_numero: numero, status: "ABERTA",
    usuario_abertura: state.usuarioAtualId, taxa_servico_ativa: true, desconto_centavos: 0,
    dia_operacional: hojeOperacionalStr()
  };
  var res = await sb.from("comandas").insert(payload).select().single();
  if(res.error){ toast("err","ERRO AO ABRIR FICHA", res.error.message); return; }
  var comanda = mapComanda(res.data);
  state.comandas.push(comanda);
  irParaComanda(comanda.id);
  render();
}
// Fase 3.7 — delivery próprio: endereço/bairro vêm do cliente escolhido
// (editável só pra esta entrega), taxa sugerida pelo bairro configurado.
function abrirNovoDelivery(){
  state.modal = {type:"novoDelivery", clienteId:null, escolhendoCliente:false, buscaCliente:"",
    endereco:"", bairro:"", taxaEntregaCentavos:0, agendadoPara:"", erro:""};
  render();
}
async function criarDelivery(endereco, bairro, taxaEntregaCentavos, agendadoPara){
  var m = state.modal;
  if(!m.clienteId){ m.erro = "Escolha um cliente."; render(); return; }
  var payload = {
    empresa_id: state.empresaId, codigo: "C"+Date.now().toString(36).toUpperCase(),
    mesa_id: null, tipo: "DELIVERY", status: "ABERTA",
    usuario_abertura: state.usuarioAtualId, taxa_servico_ativa: false, desconto_centavos: 0,
    dia_operacional: hojeOperacionalStr(), cliente_id: m.clienteId,
    endereco_entrega: endereco.trim(), status_entregador: "PENDENTE",
    taxa_entrega_centavos: taxaEntregaCentavos||0,
    agendado_para: agendadoPara ? new Date(agendadoPara).toISOString() : null
  };
  var res = await sb.from("comandas").insert(payload).select().single();
  if(res.error){ m.erro = res.error.message; render(); return; }
  var comanda = mapComanda(res.data);
  state.comandas.push(comanda);
  state.modal = null;
  irParaComanda(comanda.id);
  render();
  toast("ok","DELIVERY ABERTO", (state.clientes.find(function(c){return c.id===m.clienteId;})||{}).nome||"");
}

// Fase 3.7 — status do entregador: ciclo simples PENDENTE -> SAIU_PARA_ENTREGA -> ENTREGUE.
var PROXIMO_STATUS_ENTREGADOR = {PENDENTE:"SAIU_PARA_ENTREGA", SAIU_PARA_ENTREGA:"ENTREGUE"};
async function avancarStatusEntregador(comandaId){
  var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
  var novo = PROXIMO_STATUS_ENTREGADOR[comanda.statusEntregador];
  if(!novo) return;
  var anterior = comanda.statusEntregador;
  comanda.statusEntregador = novo;
  render();
  var res = await sb.from("comandas").update({status_entregador:novo}).eq("id", comandaId);
  if(res.error){ comanda.statusEntregador = anterior; toast("err","ERRO", res.error.message); render(); }
}

// Fase 3.3 — confirmar/rejeitar pedido feito pelo QR da mesa.
async function confirmarPedidoQr(pedidoId){
  var res = await sb.rpc("confirmar_pedido_qr", {p_pedido_id: pedidoId});
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  var out = res.data;
  state.pedidosQr = state.pedidosQr.filter(function(p){ return p.id!==pedidoId; });
  var comanda = state.comandas.find(function(c){ return c.id===out.comanda.id; });
  if(!comanda){ comanda = mapComanda(out.comanda); state.comandas.push(comanda); }
  (out.itens||[]).forEach(function(it){ comanda.itens.push(mapItem(it)); });
  render();
  toast("ok","PEDIDO CONFIRMADO", (out.itens||[]).length+" item(ns) na cozinha");
}
async function rejeitarPedidoQr(pedidoId, motivo){
  var res = await sb.rpc("rejeitar_pedido_qr", {p_pedido_id: pedidoId, p_motivo: motivo||null});
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  state.pedidosQr = state.pedidosQr.filter(function(p){ return p.id!==pedidoId; });
  render();
  toast("ok","PEDIDO REJEITADO", "");
}

// VF-001 — status/fechamento da comanda são somente leitura pra UPDATE
// direto desde a 0076 (trigger trg_comandas_protege_colunas); cancelar
// uma comanda vazia agora passa pela RPC, que repete a checagem "zero
// item" no servidor em vez de confiar só no client.
async function cancelarComanda(comandaId){
  var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
  if(!comanda || comanda.itens.length>0) return;
  var res = await sb.rpc("cancelar_comanda_vazia", {p_comanda_id: comandaId});
  if(res.error){ toast("err","ERRO AO CANCELAR COMANDA", res.error.message); return; }
  comanda.status = "CANCELADA";
  state.view = "salao"; state.viewParams = {};
  render();
  toast("ok","COMANDA CANCELADA", "Mesa liberada.");
}
// Fase 0.6 — comanda travada em FECHANDO (aba fechou no meio do
// pagamento); reabertura manual via RPC (permissão atendimento.comanda.reabrir).
async function reabrirComandaTravada(comandaId){
  var res = await sb.rpc("reabrir_comanda", {p_comanda_id: comandaId});
  if(res.error){ toast("err","ERRO AO REABRIR", res.error.message); return; }
  var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
  if(comanda){ comanda.status = "ABERTA"; comanda.updatedAt = res.data.updated_at; }
  render();
  toast("ok","COMANDA REABERTA", comanda?comanda.codigo:"");
}
function irParaComanda(comandaId){
  state.view = "comanda"; state.viewParams = {comandaId:comandaId};
  if(!state.draft || state.draft.comandaId!==comandaId){
    state.draft = {comandaId:comandaId, categoria:state.categorias[0], busca:"", mobileCatalog:false, itens:{}, itensComOpcoes:[]};
  }
}
function draftAlterar(produtoId, delta){
  var d = state.draft.itens;
  var atual = d[produtoId] ? d[produtoId].qtd : 0;
  var novo = Math.max(0, atual + delta);
  if(novo===0) delete d[produtoId];
  else d[produtoId] = {qtd:novo, obs:(d[produtoId]&&d[produtoId].obs)||"", semItens:(d[produtoId]&&d[produtoId].semItens)||[]};
  render();
}
function draftObs(produtoId, texto){
  if(state.draft.itens[produtoId]) state.draft.itens[produtoId].obs = texto;
}
function draftToggleIngrediente(produtoId, nome){
  var d = state.draft.itens[produtoId];
  if(!d) return;
  if(!d.semItens) d.semItens = [];
  var idx = d.semItens.indexOf(nome);
  if(idx===-1) d.semItens.push(nome); else d.semItens.splice(idx,1);
  render();
}
function draftObsFinal(produtoId, d){
  var partes = [];
  if((d.semItens||[]).length) partes.push("SEM "+d.semItens.join(", ").toUpperCase());
  if((d.obs||"").trim()) partes.push(d.obs.trim());
  return partes.join(" · ");
}
async function enviarPedido(){
  var comanda = state.comandas.find(function(c){ return c.id===state.draft.comandaId; });
  var itens = state.draft.itens;
  var displayExtra = {}; // client_uuid -> {opcoesSelecionadas} só pra render otimista offline
  var payload = Object.keys(itens).map(function(produtoId){
    var produto = state.produtos.find(function(p){ return p.id===produtoId; });
    var cuid = uid("item");
    return {
      client_uuid: cuid, comanda_id: comanda.id, produto_id: produtoId, nome: produto.nome,
      observacao: draftObsFinal(produtoId, itens[produtoId]), quantidade: itens[produtoId].qtd,
      preco_unit_centavos: produto.precoCentavos, status:"PENDENTE", usuario_id: state.usuarioAtualId,
      setor_producao: produto.setorProducao||"COZINHA"
    };
  });
  // Fase 1.3 — itens com perguntas/adicionais: manda só os opcao_id
  // escolhidos em opcoes_selecionadas; o trigger no banco (0051) relê
  // nome/preço de cada opção e recalcula preco_unit_centavos — o valor
  // mandado aqui é só placeholder (coluna not null), nunca o que vale.
  (state.draft.itensComOpcoes||[]).forEach(function(l){
    var produto = state.produtos.find(function(p){ return p.id===l.produtoId; });
    var cuid = uid("item");
    displayExtra[cuid] = l.opcoesSelecionadas;
    payload.push({
      client_uuid: cuid, comanda_id: comanda.id, produto_id: l.produtoId, nome: produto.nome,
      observacao: l.obs||"", quantidade: l.qtd,
      preco_unit_centavos: produto.precoCentavos, status:"PENDENTE", usuario_id: state.usuarioAtualId,
      setor_producao: produto.setorProducao||"COZINHA",
      opcoes_selecionadas: l.opcoesSelecionadas.map(function(o){ return {opcao_id:o.opcaoId}; })
    });
  });
  if(!payload.length) return;

  // Fase 3.5 — sem internet: guarda o pedido na fila local (IndexedDB) e
  // mostra os itens otimisticamente (marcados "sincronizando") em vez de
  // só mostrar erro — sincroniza sozinho quando a conexão voltar.
  if(!navigator.onLine){
    await enviarPedidoOffline(comanda, payload, displayExtra);
    return;
  }
  var res = await sb.from("comanda_itens").insert(payload).select();
  if(res.error){
    if(typeof erroDeRede==="function" && erroDeRede(res)){ await enviarPedidoOffline(comanda, payload, displayExtra); return; }
    toast("err","ERRO AO ENVIAR PEDIDO", res.error.message); return;
  }
  var novos = res.data.map(mapItem);
  comanda.itens = comanda.itens.concat(novos);
  state.draft.itens = {};
  state.draft.itensComOpcoes = [];
  state.draft.mobileCatalog = false;
  state.modal = null;
  render();
  toast("ok","PEDIDO ENVIADO", novos.length+" ite"+(novos.length===1?"m":"ns")+" para a cozinha");
}

// Fase 3.5 — aplica os itens do pedido no state igual se tivessem vindo
// do servidor (marcados _pendingSync) e guarda na fila offline pra
// mandar de verdade quando a conexão voltar.
async function enviarPedidoOffline(comanda, payload, displayExtra){
  var agora = new Date().toISOString();
  var novos = payload.map(function(p){
    return {
      id: p.client_uuid, comandaId: p.comanda_id, produtoId: p.produto_id, nome: p.nome,
      observacao: p.observacao||"", quantidade: p.quantidade, precoUnitCentavos: p.preco_unit_centavos,
      status: p.status, usuarioId: p.usuario_id, enviadoEm: agora, canceladoAposPreparo:false,
      motivoCancelamento:"", setorProducao: p.setor_producao, pagoEm:null,
      opcoesSelecionadas: displayExtra[p.client_uuid]||[], _pendingSync:true
    };
  });
  comanda.itens = comanda.itens.concat(novos);
  state.draft.itens = {};
  state.draft.itensComOpcoes = [];
  state.draft.mobileCatalog = false;
  state.modal = null;
  render();
  await offlineEnfileirar({id: uid("fila"), tipo:"lancar_item", payload: payload, criadoEm: Date.now()});
  toast("err","SEM INTERNET", payload.length+" ite"+(payload.length===1?"m":"ns")+" guardado(s) — envia sozinho quando a conexão voltar");
}

// Fase 1.3 — escolher perguntas/adicionais de um produto antes de
// adicionar ao pedido. Cada confirmação vira uma linha própria em
// draft.itensComOpcoes (não dá pra "somar quantidade" com outra igual
// como os produtos simples fazem, porque duas escolhas podem ter opções
// diferentes — ex: uma picanha ao ponto, outra bem passada).
function abrirOpcoesPedido(produtoId){
  state.modal = {type:"opcoesPedido", produtoId:produtoId, qtd:1, selecionadas:{}, obs:"", erro:""};
  render();
}
function confirmarOpcoesPedido(){
  var m = state.modal;
  var grupos = gruposDoProduto(m.produtoId);
  for(var i=0;i<grupos.length;i++){
    var g = grupos[i].grupo;
    var sel = m.selecionadas[g.id]||[];
    if(g.obrigatorio && sel.length<g.minimo){
      m.erro = 'Escolha pelo menos '+g.minimo+' opção(ões) em "'+g.nome+'"';
      render(); return;
    }
  }
  var opcoesSelecionadas = [];
  grupos.forEach(function(g){
    (m.selecionadas[g.grupo.id]||[]).forEach(function(oid){
      var o = g.opcoes.find(function(x){ return x.id===oid; });
      if(o) opcoesSelecionadas.push({opcaoId:o.id, nome:o.nome, precoAdicionalCentavos:o.precoAdicionalCentavos});
    });
  });
  if(!state.draft.itensComOpcoes) state.draft.itensComOpcoes = [];
  state.draft.itensComOpcoes.push({
    id: uid("draftopt"), produtoId:m.produtoId, qtd:m.qtd,
    opcoesSelecionadas:opcoesSelecionadas, obs:(m.obs||"").trim()
  });
  state.modal = null;
  render();
}
function draftOpcoesAlterarQtd(linhaId, delta){
  var l = (state.draft.itensComOpcoes||[]).find(function(x){ return x.id===linhaId; });
  if(!l) return;
  l.qtd = Math.max(1, l.qtd+delta);
  render();
}
function draftOpcoesRemover(linhaId){
  state.draft.itensComOpcoes = (state.draft.itensComOpcoes||[]).filter(function(x){ return x.id!==linhaId; });
  render();
}

// Fase 0.3 — autorização de supervisor agora é validada e gravada no
// servidor (RPCs cancelar_item / aplicar_desconto, 0043). O client só
// escolhe QUAL supervisor (um só, não testa vários) e manda o PIN dele
// pra RPC verificar — nunca mais testa senha contra várias contas daqui.
//
// pedirSupervisorRpc() é genérico: quem chama passa um onConfirm(supervisorId,
// pin) assíncrono que faz a chamada RPC específica e devolve true/false.
function candidatosSupervisor(permissaoNecessaria){
  return state.usuarios.filter(function(u){
    return u.ativo && (MATRIZ[u.papel]||[]).indexOf(permissaoNecessaria)!==-1;
  });
}
function pedirSupervisorRpc(permissaoNecessaria, motivo, onConfirm){
  var candidatos = candidatosSupervisor(permissaoNecessaria);
  state.modal = {
    type:"supervisorRpc", permissao:permissaoNecessaria, motivo:motivo,
    supervisorId: candidatos.length?candidatos[0].id:"",
    buffer:"", error:"", onConfirm:onConfirm
  };
  render();
}
// PIN agora é alfanumérico (letras e números) — entra por um campo de
// texto normal (igual a senha do login), não mais por um teclado
// numérico de 0-9. O teclado antigo não deixava digitar letra nenhuma.
function supervisorRpcPinInput(valor){
  state.modal.buffer = valor;
  state.modal.error = "";
}
// VF-004 — registra a tentativa numa chamada própria ANTES de verificar o
// PIN de verdade: essa chamada é sua própria transação e sempre commita,
// então sobrevive mesmo que o PIN esteja errado e a verificação (que vem
// depois, numa transação à parte) dê raise exception. Sem isso, o INSERT
// de tentativas_autorizacao desfazia junto com a transação que falhava —
// o contador de "5 tentativas/5 min" nunca acumulava de verdade.
async function confirmarSupervisorRpc(){
  var m = state.modal;
  if(pinLockoutAtivo()){ m.error = "Muitas tentativas. Aguarde "+pinLockoutSegundosRestantes()+"s."; render(); return; }
  if(!m.supervisorId){ m.error = "Nenhum supervisor disponível com essa permissão."; render(); return; }
  if(!m.buffer){ m.error = "Informe o PIN."; render(); return; }
  m.verificando = true; render();
  var tent = await sb.rpc("registrar_tentativa_pin", {p_usuario_id: m.supervisorId});
  if(state.modal!==m) return;
  if(tent.error){
    m.buffer = ""; m.error = tent.error.message; m.verificando = false; render(); return;
  }
  var sucesso = await m.onConfirm(m.supervisorId, m.buffer, tent.data);
  if(state.modal!==m) return;
  if(sucesso){
    limparFalhasPin();
    state.modal = null;
  } else {
    m.buffer = "";
    var bloqueado = registrarFalhaPin();
    if(!m.error) m.error = bloqueado ? "Muitas tentativas. Aguarde 30s." : "PIN inválido ou sem permissão.";
    m.verificando = false;
  }
  render();
}

// Fase 1.1 — transferir item, transferir comanda de mesa, juntar mesas.
// As RPCs (0048) validam permissão/estado e gravam venda_movimentacoes +
// auditoria atomicamente; o client só escolhe o destino e recarrega.
function abrirTransferirItem(itemId){
  var comanda = state.comandas.find(function(c){ return c.id===state.viewParams.comandaId; });
  var item = comanda ? comanda.itens.find(function(i){ return i.id===itemId; }) : null;
  if(!item) return;
  state.modal = {type:"transferirItem", itemId:itemId, comandaOrigemId:comanda.id, item:item, erro:""};
  render();
}
async function confirmarTransferirItem(){
  var m = state.modal;
  var destinoId = document.getElementById("transferirItemDestino").value;
  if(!destinoId) return;
  var res = await sb.rpc("transferir_item", {p_item_id: m.itemId, p_comanda_destino_id: destinoId});
  if(res.error){ m.erro = res.error.message; render(); return; }
  await carregarTudo();
  state.modal = null;
  render();
  toast("ok","ITEM TRANSFERIDO", m.item.nome);
}
function abrirTransferirMesa(comandaId){
  var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
  if(!comanda) return;
  state.modal = {type:"transferirMesa", comandaId:comandaId, mesaOrigemId:comanda.mesaId, erro:""};
  render();
}
async function confirmarTransferirMesa(){
  var m = state.modal;
  var mesaDestinoId = document.getElementById("transferirMesaDestino").value;
  if(!mesaDestinoId) return;
  var res = await sb.rpc("transferir_comanda", {p_comanda_id: m.comandaId, p_mesa_destino_id: mesaDestinoId});
  if(res.error){ m.erro = res.error.message; render(); return; }
  await carregarTudo();
  state.modal = null;
  render();
  toast("ok","MESA TRANSFERIDA", "");
}
function abrirJuntarMesas(comandaId){
  state.modal = {type:"juntarMesas", comandaOrigemId:comandaId, erro:""};
  render();
}
async function confirmarJuntarMesas(){
  var m = state.modal;
  var destinoId = document.getElementById("juntarMesasDestino").value;
  if(!destinoId) return;
  var res = await sb.rpc("juntar_comandas", {p_origem_id: m.comandaOrigemId, p_destino_id: destinoId});
  if(res.error){ m.erro = res.error.message; render(); return; }
  await carregarTudo();
  state.modal = null;
  state.view = "salao"; state.viewParams = {};
  render();
  toast("ok","MESAS JUNTADAS", "");
}

// Fase 2.8 — número de pessoas na mesa (pra sugerir a quantidade de
// couvert com 1 clique) e atalho que joga o couvert configurado pro
// draft — o couvert em si é um produto comum, só a quantidade vem pronta.
async function atualizarPessoasComanda(comandaId, pessoas){
  var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
  if(!comanda) return;
  var valor = pessoas>0 ? Math.round(pessoas) : null;
  comanda.pessoas = valor;
  render();
  var res = await sb.from("comandas").update({pessoas:valor}).eq("id", comandaId);
  if(res.error) toast("err","ERRO", res.error.message);
}
function adicionarCouvert(comandaId){
  var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
  var produtoId = state.config.produtoCouvertId;
  if(!comanda || !produtoId || !comanda.pessoas) return;
  if(!state.draft || state.draft.comandaId!==comandaId) irParaComanda(comandaId);
  state.draft.itens[produtoId] = {qtd: comanda.pessoas, obs:"", semItens:[]};
  render();
  toast("ok","COUVERT ADICIONADO AO PEDIDO", comanda.pessoas+" pessoa(s)");
}

function abrirCancelarItem(comandaId, itemId){
  var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
  var item = comanda.itens.find(function(i){ return i.id===itemId; });
  var mesa = state.mesas.find(function(m){ return m.id===comanda.mesaId; });
  var candidatos = candidatosSupervisor(PERM.ITEM_CANCELAR);
  state.modal = {type:"cancelarItem", comandaId:comandaId, itemId:itemId, item:item, mesaNum:mesa?mesa.numero:"?",
    motivo:"", buffer:"", error:"", supervisorId: candidatos.length?candidatos[0].id:""};
  render();
}
function cancelarItemPinInput(valor){
  state.modal.buffer = valor;
  state.modal.error = "";
}
async function confirmarCancelarItem(){
  var m = state.modal;
  if(!m.motivo.trim()){ m.error = "Informe o motivo antes do PIN."; render(); return; }
  if(pinLockoutAtivo()){ m.error = "Muitas tentativas. Aguarde "+pinLockoutSegundosRestantes()+"s."; render(); return; }
  if(!m.supervisorId){ m.error = "Nenhum supervisor disponível com essa permissão."; render(); return; }
  if(!m.buffer){ m.error = "Informe o PIN."; render(); return; }
  m.error = "";
  m.verificando = true; render();
  var motivo = m.motivo.trim();
  // VF-004 — mesma régua de confirmarSupervisorRpc: registra a tentativa
  // numa chamada própria antes, pra sobreviver ao rollback se o PIN
  // estiver errado.
  var tent = await sb.rpc("registrar_tentativa_pin", {p_usuario_id: m.supervisorId});
  if(state.modal!==m) return;
  if(tent.error){
    m.buffer = ""; m.error = tent.error.message; m.verificando = false; render(); return;
  }
  var res = await sb.rpc("cancelar_item", {p_item_id: m.itemId, p_motivo: motivo, p_supervisor_id: m.supervisorId, p_supervisor_pin: m.buffer, p_tentativa_id: tent.data});
  if(state.modal!==m) return;
  if(!res.error){
    limparFalhasPin();
    var comanda = state.comandas.find(function(c){ return c.id===m.comandaId; });
    var item = comanda ? comanda.itens.find(function(i){ return i.id===m.itemId; }) : null;
    if(item){
      item.status = "CANCELADO";
      item.canceladoAposPreparo = !!res.data.cancelado_apos_preparo;
      item.motivoCancelamento = res.data.motivo_cancelamento||motivo;
    }
    state.modal = null;
    render();
    toast("err","ITEM CANCELADO", item?item.nome:"");
  } else {
    m.buffer="";
    var bloqueado = registrarFalhaPin();
    m.error = bloqueado ? "Muitas tentativas. Aguarde 30s." : res.error.message;
    m.verificando = false;
    render();
  }
}

async function aplicarDescontoDireto(comandaId, percentInformado){
  var res = await sb.rpc("aplicar_desconto", {p_comanda_id: comandaId, p_percentual: percentInformado});
  if(res.error){ toast("err","ERRO AO APLICAR DESCONTO", res.error.message); return; }
  var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
  if(comanda) comanda.descontoCentavos = res.data.desconto_centavos;
  state.modal = null;
  render();
}
function aplicarDesconto(comandaId, percentInformado){
  if(percentInformado > limiteDescontoPct() || !can(PERM.DESCONTO_APLICAR)){
    pedirSupervisorRpc(PERM.DESCONTO_APLICAR, "Desconto de "+percentInformado+"% acima do limite de "+limiteDescontoPct()+"%", async function(supervisorId, pin, tentativaId){
      var res = await sb.rpc("aplicar_desconto", {p_comanda_id: comandaId, p_percentual: percentInformado, p_supervisor_id: supervisorId, p_supervisor_pin: pin, p_tentativa_id: tentativaId});
      if(res.error){ return false; }
      var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
      if(comanda) comanda.descontoCentavos = res.data.desconto_centavos;
      return true;
    });
  } else {
    aplicarDescontoDireto(comandaId, percentInformado);
  }
}

// ---------- QR Codes das mesas: impressão e download ----------

function buildQrPrintHtml(itens){
  return '<div class="qr-print-grid">'+itens.map(function(it){
    return '<div class="qr-print-card">'+
      '<div class="qr-print-nome">'+escapeHtml(state.config.empresaNome||"")+'</div>'+
      '<div class="qr-print-mesa">Mesa '+it.mesa.numero+'</div>'+
      '<img src="'+it.dataUrl+'" width="200" height="200" alt="QR Code mesa '+it.mesa.numero+'">'+
      '<div class="qr-print-rodape">Aponte a câmera e peça direto pelo celular</div>'+
    '</div>';
  }).join("")+'</div>';
}
async function imprimirQrCodeMesa(mesaId){
  var mesa = state.mesas.find(function(m){ return m.id===mesaId; });
  if(!mesa) return;
  try{
    var dataUrl = await QRCode.toDataURL(urlQrMesa(mesa), {width:260, margin:1, color:{dark:"#0b0f14", light:"#ffffff"}});
    imprimir(buildQrPrintHtml([{mesa:mesa, dataUrl:dataUrl}]));
  }catch(e){ toast("err","NÃO FOI POSSÍVEL GERAR O QR CODE", e.message); }
}
async function imprimirTodasQrCodes(){
  var mesas = state.mesas.slice().sort(function(a,b){ return a.numero-b.numero; });
  if(!mesas.length) return;
  try{
    var itens = [];
    for(var i=0;i<mesas.length;i++){
      var dataUrl = await QRCode.toDataURL(urlQrMesa(mesas[i]), {width:220, margin:1, color:{dark:"#0b0f14", light:"#ffffff"}});
      itens.push({mesa:mesas[i], dataUrl:dataUrl});
    }
    imprimir(buildQrPrintHtml(itens));
  }catch(e){ toast("err","NÃO FOI POSSÍVEL GERAR OS QR CODES", e.message); }
}
// 0.6 — invalida o QR impresso hoje pra essa mesa (ex: foi parar em rede
// social, ou a mesa física mudou de lugar/número) — gera um token novo,
// o link antigo (mesmo com ?mesa=N certo) para de funcionar na hora,
// porque o token não bate mais.
async function rotacionarQrCodeMesa(mesaId){
  var res = await sb.rpc("rotacionar_qr_mesa", {p_mesa_id: mesaId});
  if(res.error){ toast("err","ERRO AO GERAR NOVO QR", res.error.message); return; }
  var mesa = state.mesas.find(function(m){ return m.id===mesaId; });
  if(mesa) mesa.qrToken = res.data.qr_token;
  render();
  toast("ok","NOVO QR GERADO", "O QR impresso antes agora é inválido — imprima o novo.");
}
async function baixarQrCodeMesa(mesaId){
  var mesa = state.mesas.find(function(m){ return m.id===mesaId; });
  if(!mesa) return;
  try{
    var dataUrl = await QRCode.toDataURL(urlQrMesa(mesa), {width:512, margin:1, color:{dark:"#0b0f14", light:"#ffffff"}});
    var a = document.createElement("a");
    a.href = dataUrl;
    a.download = "qr-mesa-"+mesa.numero+".png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }catch(e){ toast("err","NÃO FOI POSSÍVEL GERAR O QR CODE", e.message); }
}

