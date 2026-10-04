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
    state.view = (claims.papel==="COZINHA") ? "kds" : (claims.papel==="GARCOM"||claims.papel==="CAIXA") ? "salao" : "dashboard";
    configurarRealtime();
  } catch(e){
    state.loginSenhaInput = "";
    var bloqueado = registrarFalhaPin();
    state.loginErro = bloqueado ? "Muitas tentativas. Aguarde 30s." : "Usuário ou senha incorretos.";
  }
  state.loginVerificando = false;
  render();
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
  state.view = (m.claims.papel==="COZINHA") ? "kds" : (m.claims.papel==="GARCOM"||m.claims.papel==="CAIXA") ? "salao" : "dashboard";
  configurarRealtime();
  state.loginVerificando = false;
  render();
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

async function cancelarComanda(comandaId){
  var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
  if(!comanda || comanda.itens.length>0) return;
  var res = await sb.from("comandas").update({status:"CANCELADA", fechamento:new Date().toISOString()}).eq("id", comandaId);
  if(res.error){ toast("err","ERRO AO CANCELAR COMANDA", res.error.message); return; }
  comanda.status = "CANCELADA";
  registrarAuditoriaLocal("comanda", comandaId, "CANCELAR_COMANDA_VAZIA", state.usuarioAtualId, comanda.codigo);
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
async function supervisorRpcDigit(d){
  var m = state.modal;
  if(pinLockoutAtivo()){ m.error = "Muitas tentativas. Aguarde "+pinLockoutSegundosRestantes()+"s."; render(); return; }
  if(m.buffer.length>=PIN_LEN) return;
  if(!m.supervisorId){ m.error = "Nenhum supervisor disponível com essa permissão."; render(); return; }
  m.buffer += d;
  if(m.buffer.length===PIN_LEN){
    m.verificando = true; render();
    var sucesso = await m.onConfirm(m.supervisorId, m.buffer);
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
async function cancelarItemDigit(d){
  var m = state.modal;
  if(!m.motivo.trim()){ m.error = "Informe o motivo antes do PIN."; render(); return; }
  if(pinLockoutAtivo()){ m.error = "Muitas tentativas. Aguarde "+pinLockoutSegundosRestantes()+"s."; render(); return; }
  if(m.buffer.length>=PIN_LEN) return;
  if(!m.supervisorId){ m.error = "Nenhum supervisor disponível com essa permissão."; render(); return; }
  m.error = "";
  m.buffer += d;
  if(m.buffer.length===PIN_LEN){
    m.verificando = true; render();
    var motivo = m.motivo.trim();
    var res = await sb.rpc("cancelar_item", {p_item_id: m.itemId, p_motivo: motivo, p_supervisor_id: m.supervisorId, p_supervisor_pin: m.buffer});
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
  } else render();
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
    pedirSupervisorRpc(PERM.DESCONTO_APLICAR, "Desconto de "+percentInformado+"% acima do limite de "+limiteDescontoPct()+"%", async function(supervisorId, pin){
      var res = await sb.rpc("aplicar_desconto", {p_comanda_id: comandaId, p_percentual: percentInformado, p_supervisor_id: supervisorId, p_supervisor_pin: pin});
      if(res.error){ return false; }
      var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
      if(comanda) comanda.descontoCentavos = res.data.desconto_centavos;
      return true;
    });
  } else {
    aplicarDescontoDireto(comandaId, percentInformado);
  }
}

