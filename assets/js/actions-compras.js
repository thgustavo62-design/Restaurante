"use strict";

// ---------- compras e fornecedores ----------

async function salvarFornecedor(nome, contato, telefone){
  var m = state.modal;
  if(!nome.trim()){ m.erro = "Informe o nome do fornecedor."; render(); return; }
  var res = await sb.from("fornecedores").insert({
    empresa_id: state.empresaId, nome: nome.trim(), contato: (contato||"").trim()||null, telefone: (telefone||"").trim()||null
  }).select().single();
  if(res.error){ m.erro = res.error.message; render(); return; }
  state.fornecedores.push(mapFornecedor(res.data));
  state.modal = null;
  render();
  toast("ok","FORNECEDOR CRIADO", nome.trim());
}
async function toggleFornecedorAtivo(fornecedorId){
  var f = state.fornecedores.find(function(x){ return x.id===fornecedorId; });
  var novo = !f.ativo;
  f.ativo = novo;
  render();
  var res = await sb.from("fornecedores").update({ativo:novo}).eq("id", fornecedorId);
  if(res.error){ f.ativo = !novo; toast("err","ERRO", res.error.message); render(); }
}

function abrirPedidoCompraForm(){
  var primeiro = state.fornecedores.find(function(f){ return f.ativo; });
  state.modal = {type:"pedidoCompraForm", fornecedorId: primeiro?primeiro.id:"", itens:[], erro:"", salvando:false};
  render();
}
function pedidoCompraAdicionarItem(insumoId, quantidade, custoUnitCentavos){
  var m = state.modal;
  if(!insumoId || !(quantidade>0)){ m.erro = "Escolha um insumo e uma quantidade válida."; render(); return; }
  m.erro = "";
  m.itens.push({insumoId:insumoId, quantidade:quantidade, custoUnitCentavos: custoUnitCentavos>0?custoUnitCentavos:null});
  render();
}
function pedidoCompraRemoverItem(idx){
  state.modal.itens.splice(idx,1);
  render();
}
async function criarPedidoCompra(){
  var m = state.modal;
  if(!m.fornecedorId){ m.erro = "Escolha um fornecedor."; render(); return; }
  if(!m.itens.length){ m.erro = "Adicione ao menos um item."; render(); return; }
  m.salvando = true; render();
  var res = await sb.rpc("criar_pedido_compra", {
    p_fornecedor_id: m.fornecedorId,
    p_itens: m.itens.map(function(it){ return {insumo_id:it.insumoId, quantidade:it.quantidade, custo_unit_centavos:it.custoUnitCentavos}; })
  });
  if(res.error){ m.erro = res.error.message; m.salvando = false; render(); return; }
  var out = res.data;
  var pedido = mapPedidoCompra(out.pedido);
  pedido.itens = (out.itens||[]).map(mapPedidoCompraItem);
  state.pedidosCompra.unshift(pedido);
  state.modal = null;
  render();
  toast("ok","PEDIDO DE COMPRA CRIADO", pedido.itens.length+" item(ns)");
}
async function marcarPedidoCompraRealizado(pedidoId){
  var res = await sb.rpc("marcar_pedido_compra_realizado", {p_pedido_id: pedidoId});
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  var p = state.pedidosCompra.find(function(x){ return x.id===pedidoId; });
  if(p) p.status = "PEDIDO_REALIZADO";
  render();
  toast("ok","PEDIDO MARCADO COMO REALIZADO", "");
}
async function receberPedidoCompra(pedidoId){
  var res = await sb.rpc("receber_pedido_compra", {p_pedido_id: pedidoId});
  if(res.error){ toast("err","ERRO AO RECEBER PEDIDO", res.error.message); return; }
  var out = res.data;
  var p = state.pedidosCompra.find(function(x){ return x.id===pedidoId; });
  if(p){ p.status = "RECEBIDO"; p.recebidoEm = out.pedido.recebido_em; }
  (out.estoque_movimentos||[]).forEach(function(mv){
    state.estoqueMovimentos.unshift(mapEstoqueMov(mv));
    var insumo = state.insumos.find(function(i){ return i.id===mv.insumo_id; });
    if(insumo) insumo.estoqueAtual = insumo.estoqueAtual + Number(mv.quantidade);
  });
  render();
  toast("ok","PEDIDO RECEBIDO", "Estoque atualizado.");
}
