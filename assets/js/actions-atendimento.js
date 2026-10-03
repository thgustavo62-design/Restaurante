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
  state.loginSelectedUserId = null;
  state.restauranteSlugInput = "";
  state.restauranteSlugErro = "";
  try{ localStorage.removeItem("restauranteSlug"); }catch(e){}
  render();
}

async function login(userId, pin){
  var candidato = state.usuariosLogin.find(function(x){ return x.id===userId; });
  if(!candidato) return;
  if(pinLockoutAtivo()){
    state.pinBuffer = "";
    state.pinError = "Muitas tentativas. Aguarde "+pinLockoutSegundosRestantes()+"s.";
    render(); return;
  }
  state.carregando = true;
  render();
  try{
    var res = await sb.auth.signInWithPassword({email:candidato.email, password:pin});
    if(res.error) throw res.error;
    var claims = decodeJwt(res.data.session.access_token);
    if(!claims.empresa_id){ throw new Error("Usuário sem empresa vinculada."); }
    limparFalhasPin();
    state.usuarioAtualId = res.data.user.id;
    state.empresaId = claims.empresa_id;
    state.loginSelectedUserId = null;
    state.pinBuffer = ""; state.pinError = "";
    await carregarTudo();
    state.view = (claims.papel==="COZINHA") ? "kds" : (claims.papel==="GARCOM"||claims.papel==="CAIXA") ? "salao" : "dashboard";
    configurarRealtime();
  } catch(e){
    state.pinBuffer = "";
    var bloqueado = registrarFalhaPin();
    state.pinError = bloqueado ? "Muitas tentativas. Aguarde 30s." : "PIN incorreto.";
  }
  state.carregando = false;
  render();
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
    state.draft = {comandaId:comandaId, categoria:state.categorias[0], busca:"", mobileCatalog:false, itens:{}};
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
  var payload = Object.keys(itens).map(function(produtoId){
    var produto = state.produtos.find(function(p){ return p.id===produtoId; });
    return {
      comanda_id: comanda.id, produto_id: produtoId, nome: produto.nome,
      observacao: draftObsFinal(produtoId, itens[produtoId]), quantidade: itens[produtoId].qtd,
      preco_unit_centavos: produto.precoCentavos, status:"PENDENTE", usuario_id: state.usuarioAtualId,
      setor_producao: produto.setorProducao||"COZINHA"
    };
  });
  if(!payload.length) return;
  var res = await sb.from("comanda_itens").insert(payload).select();
  if(res.error){ toast("err","ERRO AO ENVIAR PEDIDO", res.error.message); return; }
  var novos = res.data.map(mapItem);
  comanda.itens = comanda.itens.concat(novos);
  state.draft.itens = {};
  state.draft.mobileCatalog = false;
  state.modal = null;
  render();
  toast("ok","PEDIDO ENVIADO", novos.length+" ite"+(novos.length===1?"m":"ns")+" para a cozinha");
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

