"use strict";

// ---------- gestão: cardápio, estoque, financeiro, equipe, configurações ----------

function abrirProdutoForm(produtoId){
  var p = produtoId ? state.produtos.find(function(x){ return x.id===produtoId; }) : null;
  state.modal = {type:"produtoForm", produtoId:produtoId||null,
    nome: p?p.nome:"", categoria: p?p.categoria:state.categorias[0], precoCentavos: p?p.precoCentavos:0};
  render();
}
async function salvarProduto(produtoId, nome, categoria, precoCentavos){
  if(!nome.trim() || !categoria.trim() || !(precoCentavos>0)) return;
  var categoriaId = state.categoriaIdPorNome[categoria];
  if(!categoriaId){
    var catRes = await sb.from("categorias").insert({empresa_id:state.empresaId, nome:categoria.trim(), ordem:state.categorias.length}).select().single();
    if(catRes.error){ toast("err","ERRO AO CRIAR CATEGORIA", catRes.error.message); return; }
    categoriaId = catRes.data.id;
    state.categorias.push(catRes.data.nome);
    state.categoriaIdPorNome[catRes.data.nome] = categoriaId;
  }
  if(produtoId){
    var upd = await sb.from("produtos").update({nome:nome.trim(), categoria_id:categoriaId, preco_centavos:precoCentavos}).eq("id", produtoId);
    if(upd.error){ toast("err","ERRO", upd.error.message); return; }
    var p = state.produtos.find(function(x){ return x.id===produtoId; });
    var precoAntes = p.precoCentavos;
    p.nome = nome.trim(); p.categoria = categoria.trim(); p.categoriaId = categoriaId; p.precoCentavos = precoCentavos;
    if(precoAntes!==precoCentavos){
      registrarAuditoria("produtos", produtoId, "PRECO_ALTERADO", state.usuarioAtualId, nome.trim()+": "+brl(precoAntes)+" -> "+brl(precoCentavos));
    }
  } else {
    var insRes = await sb.from("produtos").insert({empresa_id:state.empresaId, categoria_id:categoriaId, nome:nome.trim(), preco_centavos:precoCentavos}).select().single();
    if(insRes.error){ toast("err","ERRO", insRes.error.message); return; }
    var catPorId = {}; catPorId[categoriaId] = categoria.trim();
    state.produtos.push(mapProduto(insRes.data, catPorId));
    registrarAuditoria("produtos", insRes.data.id, "PRODUTO_CRIADO", state.usuarioAtualId, nome.trim()+" · "+brl(precoCentavos));
  }
  state.modal = null;
  render();
  toast("ok", produtoId?"PRODUTO ATUALIZADO":"PRODUTO CRIADO", nome.trim());
}
async function toggleEsgotado(produtoId){
  var p = state.produtos.find(function(x){ return x.id===produtoId; });
  var novo = !p.esgotado;
  p.esgotado = novo;
  render();
  var res = await sb.from("produtos").update({esgotado:novo}).eq("id", produtoId);
  if(res.error){ p.esgotado = !novo; toast("err","ERRO", res.error.message); render(); }
}

function abrirInsumoMov(tipo, insumoId){
  state.modal = {type:"insumoMov", tipo:tipo, insumoId:insumoId||state.insumos[0].id};
  render();
}
async function confirmarInsumoMov(tipo, insumoId, quantidade, motivo){
  if(!(quantidade>0) || !motivo.trim()) return;
  var insumo = state.insumos.find(function(i){ return i.id===insumoId; });
  var novoEstoque = tipo==="ENTRADA" ? insumo.estoqueAtual+quantidade : Math.max(0, insumo.estoqueAtual-quantidade);
  var upd = await sb.from("insumos").update({estoque_atual:novoEstoque}).eq("id", insumoId);
  if(upd.error){ toast("err","ERRO", upd.error.message); return; }
  insumo.estoqueAtual = novoEstoque;
  var movRes = await sb.from("estoque_movimentos").insert({
    empresa_id: state.empresaId, insumo_id:insumoId, tipo:tipo, quantidade:quantidade,
    motivo:motivo.trim(), origem:"MANUAL", usuario_id: state.usuarioAtualId
  }).select().single();
  if(!movRes.error) state.estoqueMovimentos.unshift(mapEstoqueMov(movRes.data));
  state.modal = null;
  render();
  toast("ok", tipo==="ENTRADA"?"ENTRADA REGISTRADA":"SAÍDA REGISTRADA", insumo.nome+" — "+quantidade+" "+insumo.unidade);
}
async function baixarEstoqueDaVenda(comanda){
  for(var i=0;i<comanda.itens.length;i++){
    var it = comanda.itens[i];
    if(it.status==="CANCELADO" && !it.canceladoAposPreparo) continue;
    var fichas = state.fichaTecnica.filter(function(f){ return f.produtoId===it.produtoId; });
    for(var j=0;j<fichas.length;j++){
      var f = fichas[j];
      var insumo = state.insumos.find(function(i2){ return i2.id===f.insumoId; });
      if(!insumo) continue;
      var qtd = f.quantidade * it.quantidade;
      var novoEstoque = Math.max(0, insumo.estoqueAtual - qtd);
      await sb.from("insumos").update({estoque_atual:novoEstoque}).eq("id", insumo.id);
      insumo.estoqueAtual = novoEstoque;
      var movRes = await sb.from("estoque_movimentos").insert({
        empresa_id: state.empresaId, insumo_id: insumo.id, tipo:"VENDA", quantidade: qtd,
        motivo:null, origem:"comanda", origem_id: comanda.id, usuario_id: state.usuarioAtualId
      }).select().single();
      if(!movRes.error) state.estoqueMovimentos.unshift(mapEstoqueMov(movRes.data));
    }
  }
}

