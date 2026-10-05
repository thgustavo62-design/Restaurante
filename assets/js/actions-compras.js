"use strict";

// ---------- compras e fornecedores ----------

function abrirFornecedorForm(fornecedorId){
  var f = fornecedorId ? state.fornecedores.find(function(x){ return x.id===fornecedorId; }) : null;
  state.modal = {type:"fornecedorForm", fornecedorId: fornecedorId||null,
    nome: f?f.nome:"", contato: f?f.contato:"", telefone: f?f.telefone:"",
    prazoEntregaDias: f?f.prazoEntregaDias:null, diaEntregaSemana: f?f.diaEntregaSemana:null, erro:""};
  render();
}
// PRIORIDADE 4 — prazoEntregaDias/diaEntregaSemana entram aqui (campos
// novos em fornecedores) pra "lista de compras sugerida" saber até
// quando precisa cobrir o consumo de cada insumo.
async function salvarFornecedor(nome, contato, telefone, prazoEntregaDias, diaEntregaSemana){
  var m = state.modal;
  if(!nome.trim()){ m.erro = "Informe o nome do fornecedor."; render(); return; }
  var dados = {
    nome: nome.trim(), contato: (contato||"").trim()||null, telefone: (telefone||"").trim()||null,
    prazo_entrega_dias: prazoEntregaDias>0 ? Math.round(prazoEntregaDias) : null,
    dia_entrega_semana: (diaEntregaSemana!==null && diaEntregaSemana!=="") ? parseInt(diaEntregaSemana,10) : null
  };
  if(m.fornecedorId){
    var res = await sb.from("fornecedores").update(dados).eq("id", m.fornecedorId).select().single();
    if(res.error){ m.erro = res.error.message; render(); return; }
    var idx = state.fornecedores.findIndex(function(f){ return f.id===m.fornecedorId; });
    state.fornecedores[idx] = mapFornecedor(res.data);
    state.modal = null;
    render();
    toast("ok","FORNECEDOR ATUALIZADO", nome.trim());
    return;
  }
  var resNovo = await sb.from("fornecedores").insert(Object.assign({empresa_id: state.empresaId}, dados)).select().single();
  if(resNovo.error){ m.erro = resNovo.error.message; render(); return; }
  state.fornecedores.push(mapFornecedor(resNovo.data));
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
// PRIORIDADE 4 — conferência no recebimento: quantidade/preço recebido
// pré-preenchidos com o que foi pedido, mas editáveis — a baixa de
// estoque e o histórico de preço usam o que foi de fato RECEBIDO, e
// a diferença vs o pedido fica registrada na auditoria (feito no RPC).
function abrirReceberPedido(pedidoId){
  var p = state.pedidosCompra.find(function(x){ return x.id===pedidoId; });
  if(!p) return;
  state.modal = {type:"receberPedidoForm", pedidoId:pedidoId, salvando:false, erro:"",
    itens: p.itens.map(function(it){
      var insumo = state.insumos.find(function(i){ return i.id===it.insumoId; });
      return {itemId:it.id, nome:insumo?insumo.nome:"?", unidade:insumo?insumo.unidade:"",
        quantidadePedida:it.quantidade, precoUnitPedidoCentavos:it.custoUnitCentavos,
        quantidadeRecebida:it.quantidade, precoUnitRecebidoCentavos:it.custoUnitCentavos};
    })};
  render();
}
async function confirmarReceberPedido(){
  var m = state.modal;
  m.salvando = true; render();
  var itensRecebidos = m.itens.map(function(it){
    return {item_id: it.itemId, quantidade_recebida: it.quantidadeRecebida, preco_unit_recebido_centavos: it.precoUnitRecebidoCentavos};
  });
  var res = await sb.rpc("receber_pedido_compra", {p_pedido_id: m.pedidoId, p_itens_recebidos: itensRecebidos});
  if(res.error){ m.erro = res.error.message; m.salvando = false; render(); return; }
  var out = res.data;
  var p = state.pedidosCompra.find(function(x){ return x.id===m.pedidoId; });
  if(p){ p.status = "RECEBIDO"; p.recebidoEm = out.pedido.recebido_em; }
  (out.estoque_movimentos||[]).forEach(function(mv){
    state.estoqueMovimentos.unshift(mapEstoqueMov(mv));
    var insumo = state.insumos.find(function(i){ return i.id===mv.insumo_id; });
    if(insumo) insumo.estoqueAtual = insumo.estoqueAtual + Number(mv.quantidade);
  });
  state.modal = null;
  render();
  toast("ok","PEDIDO RECEBIDO", "Estoque atualizado.");
}

// PRIORIDADE 4 — gera o pedido de compra a partir de um grupo da lista de
// compras sugerida: só pré-preenche o form de sempre (fornecedor + itens
// com a quantidade sugerida), nenhuma RPC nova.
function abrirPedidoCompraDaSugestao(fornecedorId, itensSugeridos){
  state.modal = {
    type:"pedidoCompraForm",
    fornecedorId: fornecedorId || (state.fornecedores.find(function(f){ return f.ativo; })||{}).id || "",
    itens: itensSugeridos.map(function(it){ return {insumoId: it.insumo_id, quantidade: it.quantidade_sugerida, custoUnitCentavos: null}; }),
    erro:"", salvando:false
  };
  render();
}

// PRIORIDADE 4 — Cotação: comparação 100% local (preço digitado à mão,
// nenhum cálculo de valor pra proteger aqui). "Gerar pedidos" só decide,
// linha a linha, qual fornecedor teve o menor preço digitado e chama
// criar_pedido_compra (0040) uma vez por fornecedor vencedor.
function cotacaoToggleFornecedor(fornecedorId){
  var cot = state.cotacao;
  var idx = cot.fornecedorIds.indexOf(fornecedorId);
  if(idx!==-1){ cot.fornecedorIds.splice(idx,1); }
  else if(cot.fornecedorIds.length<3){ cot.fornecedorIds.push(fornecedorId); }
  render();
}
function cotacaoLinhaAdicionar(){
  var primeiro = state.insumos[0];
  state.cotacao.linhas.push({insumoId: primeiro?primeiro.id:null, quantidade:1, precos:{}});
  render();
}
function cotacaoLinhaRemover(idx){
  state.cotacao.linhas.splice(idx,1);
  render();
}
// "mesma lista" do roteiro — importa os itens já sugeridos (com a
// quantidade sugerida) em vez de montar a cotação do zero.
function cotacaoImportarListaCompras(){
  var grupos = state.listaComprasSugerida || [];
  var linhas = [];
  grupos.forEach(function(g){
    (g.itens||[]).forEach(function(it){ linhas.push({insumoId: it.insumo_id, quantidade: it.quantidade_sugerida, precos:{}}); });
  });
  if(!linhas.length){ toast("err","NADA PRA IMPORTAR", "Abra a aba Lista de compras primeiro."); return; }
  state.cotacao.linhas = linhas;
  render();
}
async function gerarPedidosDaCotacao(){
  var cot = state.cotacao;
  var porFornecedor = {};
  cot.linhas.forEach(function(l){
    var precosValidos = cot.fornecedorIds.map(function(fid){ return {fid:fid, v:l.precos[fid]}; }).filter(function(p){ return p.v>0; });
    if(!precosValidos.length || !l.insumoId) return;
    var vencedor = precosValidos.reduce(function(a,b){ return b.v<a.v?b:a; });
    if(!porFornecedor[vencedor.fid]) porFornecedor[vencedor.fid] = [];
    porFornecedor[vencedor.fid].push({insumo_id: l.insumoId, quantidade: l.quantidade>0?l.quantidade:1, custo_unit_centavos: vencedor.v});
  });
  var fornecedoresVencedores = Object.keys(porFornecedor);
  if(!fornecedoresVencedores.length){ toast("err","NADA PRA GERAR", "Digite ao menos um preço."); return; }
  for(var i=0;i<fornecedoresVencedores.length;i++){
    var fid = fornecedoresVencedores[i];
    var res = await sb.rpc("criar_pedido_compra", {p_fornecedor_id: fid, p_itens: porFornecedor[fid]});
    if(res.error){ toast("err","ERRO AO GERAR PEDIDO", res.error.message); continue; }
    var pedido = mapPedidoCompra(res.data.pedido);
    pedido.itens = (res.data.itens||[]).map(mapPedidoCompraItem);
    state.pedidosCompra.unshift(pedido);
  }
  state.cotacao = {fornecedorIds:[], linhas:[]};
  render();
  toast("ok","PEDIDOS GERADOS A PARTIR DA COTAÇÃO", fornecedoresVencedores.length+" fornecedor(es)");
}
