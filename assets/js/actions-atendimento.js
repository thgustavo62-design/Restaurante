"use strict";

// ---------- ações ----------

async function login(userId, pin){
  var candidato = state.usuariosLogin.find(function(x){ return x.id===userId; });
  if(!candidato) return;
  state.carregando = true;
  render();
  try{
    var res = await sb.auth.signInWithPassword({email:emailInterno(candidato.nome), password:pin});
    if(res.error) throw res.error;
    var claims = decodeJwt(res.data.session.access_token);
    if(!claims.empresa_id){ throw new Error("Usuário sem empresa vinculada."); }
    state.usuarioAtualId = res.data.user.id;
    state.empresaId = claims.empresa_id;
    state.loginSelectedUserId = null;
    state.pinBuffer = ""; state.pinError = "";
    await carregarTudo();
    state.view = (claims.papel==="COZINHA") ? "kds" : (claims.papel==="GARCOM"||claims.papel==="CAIXA") ? "salao" : "dashboard";
    configurarRealtime();
  } catch(e){
    state.pinBuffer = "";
    state.pinError = "PIN incorreto.";
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
      preco_unit_centavos: produto.precoCentavos, status:"PENDENTE", usuario_id: state.usuarioAtualId
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

function pedirSupervisor(permissaoNecessaria, motivo, onConfirm){
  state.modal = {
    type:"supervisor", permissao:permissaoNecessaria, motivo:motivo,
    buffer:"", error:"", onConfirm:onConfirm
  };
  render();
}
async function supervisorDigit(d){
  var m = state.modal;
  if(m.buffer.length>=PIN_LEN) return;
  m.buffer += d;
  if(m.buffer.length===PIN_LEN){
    m.verificando = true; render();
    var sup = await verificarSupervisor(m.buffer, m.permissao);
    if(state.modal!==m) return;
    if(sup){
      var cb = m.onConfirm;
      state.modal = null;
      cb(sup);
    } else {
      m.buffer = ""; m.error = "PIN inválido ou sem permissão."; m.verificando = false;
    }
  }
  render();
}

function abrirCancelarItem(comandaId, itemId){
  var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
  var item = comanda.itens.find(function(i){ return i.id===itemId; });
  var mesa = state.mesas.find(function(m){ return m.id===comanda.mesaId; });
  state.modal = {type:"cancelarItem", comandaId:comandaId, itemId:itemId, item:item, mesaNum:mesa?mesa.numero:"?", motivo:"", buffer:"", error:""};
  render();
}
async function cancelarItemDigit(d){
  var m = state.modal;
  if(!m.motivo.trim()){ m.error = "Informe o motivo antes do PIN."; render(); return; }
  if(m.buffer.length>=PIN_LEN) return;
  m.error = "";
  m.buffer += d;
  if(m.buffer.length===PIN_LEN){
    m.verificando = true; render();
    var sup = await verificarSupervisor(m.buffer, PERM.ITEM_CANCELAR);
    if(state.modal!==m) return;
    if(sup){
      var comanda = state.comandas.find(function(c){ return c.id===m.comandaId; });
      var item = comanda.itens.find(function(i){ return i.id===m.itemId; });
      var res = await sb.from("comanda_itens").update({status:"CANCELADO"}).eq("id", m.itemId);
      if(res.error){ toast("err","ERRO AO CANCELAR", res.error.message); render(); return; }
      item.status = "CANCELADO";
      registrarAuditoria("comanda_itens", m.itemId, "CANCELAR_ITEM", sup.id, m.motivo.trim()+" (aprovado por "+sup.nome+")");
      state.modal = null;
      render();
      toast("err","ITEM CANCELADO", item.nome);
    } else {
      m.buffer=""; m.error = "PIN inválido ou sem permissão."; m.verificando = false;
      render();
    }
  } else render();
}

function aplicarDesconto(comandaId, percentInformado){
  var comanda = state.comandas.find(function(c){ return c.id===comandaId; });
  var t = totaisComanda(comanda);
  var descontoCentavos = Math.round((t.subtotal) * percentInformado / 100);
  async function aplicar(){
    var res = await sb.from("comandas").update({desconto_centavos:descontoCentavos}).eq("id", comandaId);
    if(res.error){ toast("err","ERRO AO APLICAR DESCONTO", res.error.message); return; }
    comanda.descontoCentavos = descontoCentavos;
    state.modal = null;
    render();
  }
  if(percentInformado > limiteDescontoPct()){
    pedirSupervisor(PERM.DESCONTO_APLICAR, "Desconto de "+percentInformado+"% acima do limite de "+limiteDescontoPct()+"%", function(supervisor){
      registrarAuditoria("comandas", comandaId, "DESCONTO_ACIMA_LIMITE", supervisor.id, percentInformado+"% aprovado por "+supervisor.nome);
      aplicar();
    });
  } else {
    aplicar();
  }
}

