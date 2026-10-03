"use strict";

// ---------- gestão: cardápio, estoque, financeiro, equipe, configurações ----------

var SETORES_PRODUCAO = ["BAR","COZINHA","BRASA","SOBREMESA"];

function abrirProdutoForm(produtoId){
  var p = produtoId ? state.produtos.find(function(x){ return x.id===produtoId; }) : null;
  state.modal = {type:"produtoForm", produtoId:produtoId||null,
    nome: p?p.nome:"", categoria: p?p.categoria:state.categorias[0], precoCentavos: p?p.precoCentavos:0,
    setorProducao: p?p.setorProducao:"COZINHA", fotoUrl: p?p.fotoUrl:""};
  render();
}
async function salvarProduto(produtoId, nome, categoria, precoCentavos, setorProducao, fotoUrl){
  if(!nome.trim() || !categoria.trim() || !(precoCentavos>0)) return;
  setorProducao = SETORES_PRODUCAO.indexOf(setorProducao)!==-1 ? setorProducao : "COZINHA";
  fotoUrl = (fotoUrl||"").trim();
  var categoriaId = state.categoriaIdPorNome[categoria];
  if(!categoriaId){
    var catRes = await sb.from("categorias").insert({empresa_id:state.empresaId, nome:categoria.trim(), ordem:state.categorias.length}).select().single();
    if(catRes.error){ toast("err","ERRO AO CRIAR CATEGORIA", catRes.error.message); return; }
    categoriaId = catRes.data.id;
    state.categorias.push(catRes.data.nome);
    state.categoriaIdPorNome[catRes.data.nome] = categoriaId;
  }
  if(produtoId){
    var upd = await sb.from("produtos").update({nome:nome.trim(), categoria_id:categoriaId, preco_centavos:precoCentavos, setor_producao:setorProducao, foto_url:fotoUrl||null}).eq("id", produtoId);
    if(upd.error){ toast("err","ERRO", upd.error.message); return; }
    var p = state.produtos.find(function(x){ return x.id===produtoId; });
    var precoAntes = p.precoCentavos;
    p.nome = nome.trim(); p.categoria = categoria.trim(); p.categoriaId = categoriaId; p.precoCentavos = precoCentavos;
    p.setorProducao = setorProducao; p.fotoUrl = fotoUrl;
    if(precoAntes!==precoCentavos){
      registrarAuditoria("produtos", produtoId, "PRECO_ALTERADO", state.usuarioAtualId, nome.trim()+": "+brl(precoAntes)+" -> "+brl(precoCentavos));
    }
  } else {
    var insRes = await sb.from("produtos").insert({empresa_id:state.empresaId, categoria_id:categoriaId, nome:nome.trim(), preco_centavos:precoCentavos, setor_producao:setorProducao, foto_url:fotoUrl||null}).select().single();
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
function abrirRendimento(insumoId){
  var atual = state.insumoRendimentos.find(function(r){ return r.insumoId===insumoId; });
  state.modal = {type:"rendimento", insumoId:insumoId, fatorAtual: atual?atual.fator:null, observacaoAtual: atual?atual.observacao:"", erro:""};
  render();
}
async function salvarRendimento(insumoId, fatorPct, observacao){
  var m = state.modal;
  if(!(fatorPct>0) || fatorPct>100){ m.erro = "Informe um rendimento entre 1% e 100%."; render(); return; }
  var fator = Math.round(fatorPct)/100;
  var res = await sb.from("insumo_rendimentos").upsert({
    empresa_id: state.empresaId, insumo_id: insumoId, fator: fator,
    observacao: (observacao||"").trim() || null, medido_em: diasA(0), usuario_id: state.usuarioAtualId
  }, {onConflict:"empresa_id,insumo_id"}).select().single();
  if(res.error){ m.erro = res.error.message; render(); return; }
  var idx = state.insumoRendimentos.findIndex(function(r){ return r.insumoId===insumoId; });
  var mapeado = mapRendimento(res.data);
  if(idx===-1) state.insumoRendimentos.push(mapeado); else state.insumoRendimentos[idx] = mapeado;
  state.modal = null;
  render();
  var insumo = state.insumos.find(function(i){ return i.id===insumoId; });
  toast("ok","RENDIMENTO REGISTRADO", (insumo?insumo.nome+" — ":"")+Math.round(fator*100)+"%");
}
async function confirmarInsumoMov(tipo, insumoId, quantidade, motivo){
  if(!(quantidade>0) || !motivo.trim()) return;
  var insumo = state.insumos.find(function(i){ return i.id===insumoId; });
  // decremento/incremento atômico no servidor (evita corrida entre dois
  // terminais mexendo no mesmo insumo ao mesmo tempo)
  var res = await sb.rpc("registrar_movimento_estoque", {
    p_insumo_id: insumoId, p_tipo: tipo, p_quantidade: quantidade, p_motivo: motivo.trim()
  });
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  var out = res.data;
  insumo.estoqueAtual = Number(out.insumo.estoque_atual);
  state.estoqueMovimentos.unshift(mapEstoqueMov(out.movimento));
  state.modal = null;
  render();
  toast("ok", tipo==="ENTRADA"?"ENTRADA REGISTRADA":"SAÍDA REGISTRADA", insumo.nome+" — "+quantidade+" "+insumo.unidade);
}

