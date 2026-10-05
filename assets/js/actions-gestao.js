"use strict";

// ---------- gestão: cardápio, estoque, financeiro, equipe, configurações ----------

var SETORES_PRODUCAO = ["BAR","COZINHA","BRASA","SOBREMESA"];

var TEMPOS_SERVICO = ["ENTRADA","PRINCIPAL","SOBREMESA"];
function abrirProdutoForm(produtoId){
  var p = produtoId ? state.produtos.find(function(x){ return x.id===produtoId; }) : null;
  state.modal = {type:"produtoForm", produtoId:produtoId||null,
    nome: p?p.nome:"", categoria: p?p.categoria:state.categorias[0], precoCentavos: p?p.precoCentavos:0,
    setorProducao: p?p.setorProducao:"COZINHA", fotoUrl: p?p.fotoUrl:"",
    precoHappyHourCentavos: p?p.precoHappyHourCentavos:null, tempo: p?p.tempo:"PRINCIPAL"};
  render();
}
// PRIORIDADE 6 — "tempo" (entrada/principal/sobremesa, pra Expedição
// saber o que precisa sair junto) é campo de CATEGORIA, não de produto —
// como categoria é criada/editada aqui mesmo (on-the-fly, sem tela
// própria), salvar qualquer produto também atualiza o tempo da categoria
// escolhida.
async function salvarProduto(produtoId, nome, categoria, precoCentavos, setorProducao, fotoUrl, precoHappyHourCentavos, tempo){
  if(!nome.trim() || !categoria.trim() || !(precoCentavos>0)) return;
  setorProducao = SETORES_PRODUCAO.indexOf(setorProducao)!==-1 ? setorProducao : "COZINHA";
  tempo = TEMPOS_SERVICO.indexOf(tempo)!==-1 ? tempo : "PRINCIPAL";
  fotoUrl = (fotoUrl||"").trim();
  var categoriaId = state.categoriaIdPorNome[categoria];
  if(!categoriaId){
    var catRes = await sb.from("categorias").insert({empresa_id:state.empresaId, nome:categoria.trim(), ordem:state.categorias.length, tempo:tempo}).select().single();
    if(catRes.error){ toast("err","ERRO AO CRIAR CATEGORIA", catRes.error.message); return; }
    categoriaId = catRes.data.id;
    state.categorias.push(catRes.data.nome);
    state.categoriaIdPorNome[catRes.data.nome] = categoriaId;
  } else {
    await sb.from("categorias").update({tempo:tempo}).eq("id", categoriaId);
  }
  state.produtos.forEach(function(p){ if(p.categoriaId===categoriaId) p.tempo = tempo; });
  if(produtoId){
    var upd = await sb.from("produtos").update({nome:nome.trim(), categoria_id:categoriaId, preco_centavos:precoCentavos, setor_producao:setorProducao, foto_url:fotoUrl||null, preco_happy_hour_centavos:precoHappyHourCentavos||null}).eq("id", produtoId);
    if(upd.error){ toast("err","ERRO", upd.error.message); return; }
    var p = state.produtos.find(function(x){ return x.id===produtoId; });
    var precoAntes = p.precoCentavos;
    p.nome = nome.trim(); p.categoria = categoria.trim(); p.categoriaId = categoriaId; p.precoCentavos = precoCentavos;
    p.setorProducao = setorProducao; p.fotoUrl = fotoUrl; p.precoHappyHourCentavos = precoHappyHourCentavos||null; p.tempo = tempo;
    if(precoAntes!==precoCentavos){
      registrarAuditoriaLocal("produtos", produtoId, "PRECO_ALTERADO", state.usuarioAtualId, nome.trim()+": "+brl(precoAntes)+" -> "+brl(precoCentavos));
    }
  } else {
    var insRes = await sb.from("produtos").insert({empresa_id:state.empresaId, categoria_id:categoriaId, nome:nome.trim(), preco_centavos:precoCentavos, setor_producao:setorProducao, foto_url:fotoUrl||null, preco_happy_hour_centavos:precoHappyHourCentavos||null}).select().single();
    if(insRes.error){ toast("err","ERRO", insRes.error.message); return; }
    var catPorId = {}; catPorId[categoriaId] = categoria.trim();
    var catTempoPorId = {}; catTempoPorId[categoriaId] = tempo;
    state.produtos.push(mapProduto(insRes.data, catPorId, catTempoPorId));
    registrarAuditoriaLocal("produtos", insRes.data.id, "PRODUTO_CRIADO", state.usuarioAtualId, nome.trim()+" · "+brl(precoCentavos));
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

// Fase 1.3 — grupos/opções (perguntas e adicionais) do produto.
function abrirOpcoesProduto(produtoId){
  state.modal = {type:"opcoesProduto", produtoId:produtoId, erro:""};
  render();
}
async function criarGrupoOpcoes(produtoId, nome, obrigatorio, minimo, maximo){
  var m = state.modal;
  if(!nome.trim()){ m.erro = "Informe o nome do grupo."; render(); return; }
  if(maximo<1 || minimo<0 || minimo>maximo){ m.erro = "Mínimo/máximo inválidos."; render(); return; }
  var res = await sb.from("grupos_opcoes").insert({
    empresa_id: state.empresaId, produto_id: produtoId, nome: nome.trim(),
    obrigatorio: obrigatorio, minimo: minimo, maximo: maximo, ordem: state.gruposOpcoes.length
  }).select().single();
  if(res.error){ m.erro = res.error.message; render(); return; }
  state.gruposOpcoes.push(mapGrupoOpcoes(res.data));
  m.erro = "";
  render();
}
async function removerGrupoOpcoes(grupoId){
  var res = await sb.from("grupos_opcoes").delete().eq("id", grupoId);
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  state.gruposOpcoes = state.gruposOpcoes.filter(function(g){ return g.id!==grupoId; });
  state.opcoes = state.opcoes.filter(function(o){ return o.grupoId!==grupoId; });
  render();
}
async function criarOpcao(grupoId, nome, precoCentavos){
  var m = state.modal;
  if(!nome.trim()){ m.erro = "Informe o nome da opção."; render(); return; }
  var res = await sb.from("opcoes").insert({
    empresa_id: state.empresaId, grupo_id: grupoId, nome: nome.trim(),
    preco_adicional_centavos: precoCentavos||0, ordem: state.opcoes.length, ativo: true
  }).select().single();
  if(res.error){ m.erro = res.error.message; render(); return; }
  state.opcoes.push(mapOpcao(res.data));
  m.erro = "";
  render();
}
async function toggleOpcaoAtiva(opcaoId){
  var o = state.opcoes.find(function(x){ return x.id===opcaoId; });
  if(!o) return;
  var novo = !o.ativo;
  o.ativo = novo;
  render();
  var res = await sb.from("opcoes").update({ativo:novo}).eq("id", opcaoId);
  if(res.error){ o.ativo = !novo; toast("err","ERRO", res.error.message); render(); }
}
async function removerOpcao(opcaoId){
  var res = await sb.from("opcoes").delete().eq("id", opcaoId);
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  state.opcoes = state.opcoes.filter(function(o){ return o.id!==opcaoId; });
  render();
}

// Fase 2.6 — inventário (contagem física com ajuste/perda calculada).
function abrirInventario(){
  state.modal = {type:"inventario", erro:"", salvando:false};
  render();
}
async function confirmarInventario(){
  var m = state.modal;
  var itens = state.insumos.map(function(i){
    var v = document.getElementById("invContado-"+i.id).value;
    return {insumo_id:i.id, contado: parseFloat(v||i.estoqueAtual)};
  });
  m.salvando = true; render();
  var res = await sb.rpc("registrar_inventario", {p_itens: itens});
  m.salvando = false;
  if(res.error){ m.erro = res.error.message; render(); return; }
  (res.data||[]).forEach(function(r){
    var insumo = state.insumos.find(function(i){ return i.id===r.insumo.id; });
    if(insumo) insumo.estoqueAtual = Number(r.insumo.estoque_atual);
    state.estoqueMovimentos.unshift(mapEstoqueMov(r.movimento));
  });
  state.modal = null;
  render();
  toast("ok","INVENTÁRIO REGISTRADO", (res.data||[]).length+" insumo(s) ajustado(s)");
}
async function salvarValidadeInsumo(insumoId, validade){
  var i = state.insumos.find(function(x){ return x.id===insumoId; });
  if(!i) return;
  var anterior = i.validade;
  i.validade = validade||null;
  var res = await sb.from("insumos").update({validade: validade||null}).eq("id", insumoId);
  if(res.error){ i.validade = anterior; toast("err","ERRO", res.error.message); render(); }
}
// PRIORIDADE 4 — fornecedor padrão do insumo: só usado pra agrupar a
// lista de compras sugerida por fornecedor (sem isso, insumo cai no
// grupo "sem fornecedor definido").
async function salvarFornecedorPadraoInsumo(insumoId, fornecedorId){
  var i = state.insumos.find(function(x){ return x.id===insumoId; });
  if(!i) return;
  var anterior = i.fornecedorPadraoId;
  i.fornecedorPadraoId = fornecedorId||null;
  var res = await sb.from("insumos").update({fornecedor_padrao_id: fornecedorId||null}).eq("id", insumoId);
  if(res.error){ i.fornecedorPadraoId = anterior; toast("err","ERRO", res.error.message); render(); }
}
// Fase 2.6 — sugestão de pedido de compra pros insumos abaixo do mínimo:
// repõe até 2x o mínimo configurado (prática comum de estoque de
// segurança) — só uma sugestão, o usuário ainda escolhe fornecedor e
// pode ajustar quantidade/custo antes de criar o pedido de verdade.
function sugerirPedidoCompra(){
  var baixos = state.insumos.filter(function(i){ return i.estoqueAtual<i.estoqueMinimo; });
  var primeiro = state.fornecedores.find(function(f){ return f.ativo; });
  state.modal = {type:"pedidoCompraForm", fornecedorId: primeiro?primeiro.id:"", erro:"", salvando:false,
    itens: baixos.map(function(i){
      return {insumoId:i.id, quantidade: Math.max(1, Math.ceil(i.estoqueMinimo*2 - i.estoqueAtual)), custoUnitCentavos:null};
    })
  };
  render();
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

// PRIORIDADE 2 — sub-receita: insumo normal + flag (decisão tomada na
// conversa) + ficha técnica própria insumo→insumo.
async function toggleSubReceita(insumoId, marcado){
  var insumo = state.insumos.find(function(i){ return i.id===insumoId; });
  var res = await sb.from("insumos").update({eh_sub_receita: marcado}).eq("id", insumoId);
  if(res.error){ toast("err","ERRO", res.error.message); render(); return; }
  insumo.ehSubReceita = marcado;
  render();
}
function abrirReceitaSubReceita(insumoId){
  var linhas = state.fichaTecnicaInsumo.filter(function(f){ return f.insumoProduzidoId===insumoId; })
    .map(function(f){ return {insumoIngredienteId:f.insumoIngredienteId, quantidade:f.quantidade}; });
  state.modal = {type:"receitaSubReceita", insumoId:insumoId, linhas: linhas, erro:""};
  render();
}
function receitaLinhaAdicionar(){
  var m = state.modal;
  var jaUsados = m.linhas.map(function(l){ return l.insumoIngredienteId; });
  var proximo = state.insumos.find(function(i){ return i.id!==m.insumoId && jaUsados.indexOf(i.id)===-1; });
  m.linhas.push({insumoIngredienteId: proximo?proximo.id:null, quantidade:null});
  render();
}
function receitaLinhaRemover(idx){
  state.modal.linhas.splice(idx,1);
  render();
}
async function salvarReceitaSubReceita(){
  var m = state.modal;
  var linhasValidas = m.linhas.filter(function(l){ return l.insumoIngredienteId && l.quantidade>0; });
  if(!linhasValidas.length){ m.erro = "Adicione pelo menos um ingrediente com quantidade maior que zero."; render(); return; }
  var del = await sb.from("ficha_tecnica_insumo").delete().eq("insumo_produzido_id", m.insumoId);
  if(del.error){ m.erro = del.error.message; render(); return; }
  var ins = await sb.from("ficha_tecnica_insumo").insert(linhasValidas.map(function(l){
    return {insumo_produzido_id: m.insumoId, insumo_ingrediente_id: l.insumoIngredienteId, quantidade: l.quantidade};
  }));
  if(ins.error){ m.erro = ins.error.message; render(); return; }
  state.fichaTecnicaInsumo = state.fichaTecnicaInsumo.filter(function(f){ return f.insumoProduzidoId!==m.insumoId; })
    .concat(linhasValidas.map(function(l){ return {insumoProduzidoId:m.insumoId, insumoIngredienteId:l.insumoIngredienteId, quantidade:l.quantidade}; }));
  state.modal = null;
  render();
  toast("ok","RECEITA SALVA","");
}

function abrirProduzirLote(insumoId, quantidadeSugerida){
  state.modal = {type:"produzirLote", insumoId:insumoId, quantidade: quantidadeSugerida||null, validade:"", erro:""};
  render();
}
async function confirmarProduzirLote(insumoId, quantidade, validade){
  var m = state.modal;
  if(!(quantidade>0)){ m.erro = "Informe uma quantidade maior que zero."; render(); return; }
  var res = await sb.rpc("produzir_lote_sub_receita", {p_insumo_id: insumoId, p_quantidade: quantidade, p_validade: validade||null});
  if(res.error){ m.erro = res.error.message; render(); return; }
  var insumo = state.insumos.find(function(i){ return i.id===insumoId; });
  if(insumo){
    insumo.estoqueAtual = Number(res.data.insumo.estoque_atual);
    insumo.custoMedioCentavos = res.data.insumo.custo_medio_centavos;
    insumo.validade = res.data.insumo.validade||null;
  }
  state.modal = null;
  render();
  toast("ok","LOTE PRODUZIDO", (insumo?insumo.nome+" — ":"")+quantidade+" "+(insumo?insumo.unidade:""));
  imprimir(buildEtiquetaProducaoHtml(res.data.etiqueta));
}

async function marcarPrePreparoFeito(checklistId, feito){
  var c = state.preProducaoChecklist;
  if(!c) return;
  var item = c.itens.find(function(it){ return it.id===checklistId; });
  if(!item) return;
  var res = await sb.rpc("marcar_pre_preparo_feito", {p_checklist_id: checklistId, p_feito: feito});
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  item.feitoEm = feito ? new Date().toISOString() : null;
  item.feitoPorNome = feito ? usuarioAtual().nome : null;
  render();
}
function recalcularChecklistPreProducao(ajustePct){
  state.preProducaoAjustePct = ajustePct||0;
  carregarChecklistPreProducao(state.preProducaoAjustePct);
}

// PRIORIDADE 3 — registrar perda manual (insumo ou prato); o valor em R$
// e, se for insumo, a baixa de estoque, são sempre calculados/aplicados
// no servidor (registrar_perda) — nunca aqui.
function abrirPerdaForm(){
  state.modal = {type:"perdaForm", tipo:"INSUMO", insumoId: state.insumos[0]?state.insumos[0].id:null,
    produtoId: state.produtos[0]?state.produtos[0].id:null, quantidade:null, motivo:"VENCEU", erro:""};
  render();
}
async function confirmarPerda(quantidade){
  var m = state.modal;
  if(!(quantidade>0)){ m.erro = "Informe uma quantidade maior que zero."; render(); return; }
  if(m.tipo==="INSUMO" && !m.insumoId){ m.erro = "Escolha o insumo."; render(); return; }
  if(m.tipo==="PRATO" && !m.produtoId){ m.erro = "Escolha o produto."; render(); return; }
  var res = await sb.rpc("registrar_perda", {
    p_tipo: m.tipo, p_insumo_id: m.tipo==="INSUMO"?m.insumoId:null, p_produto_id: m.tipo==="PRATO"?m.produtoId:null,
    p_quantidade: quantidade, p_motivo: m.motivo
  });
  if(res.error){ m.erro = res.error.message; render(); return; }
  if(m.tipo==="INSUMO" && res.data.insumo){
    var insumo = state.insumos.find(function(i){ return i.id===m.insumoId; });
    if(insumo) insumo.estoqueAtual = Number(res.data.insumo.estoque_atual);
  }
  if(state.perdasRelatorio) carregarPerdas(state.perdasPeriodo||"HOJE");
  state.modal = null;
  render();
  toast("ok","PERDA REGISTRADA", brl(res.data.perda.valor_centavos));
}

