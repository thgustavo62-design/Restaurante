"use strict";

// ---------- eventos ----------

function bindEvents(){
  app.onclick = function(e){
   try{
    var el = e.target.closest("[data-action]");
    if(!el) return;
    var action = el.dataset.action;

    if(action==="login-select"){ state.loginSelectedUserId = el.dataset.uid; state.pinError=""; render(); return; }
    if(action==="login-cancel"){ state.loginSelectedUserId = null; state.pinBuffer=""; render(); return; }
    if(action==="login-pin-digit"){
      if(state.pinBuffer.length<PIN_LEN) state.pinBuffer += el.dataset.d;
      if(state.pinBuffer.length===PIN_LEN) login(state.loginSelectedUserId, state.pinBuffer);
      else render();
      return;
    }
    if(action==="login-pin-back"){ state.pinBuffer = state.pinBuffer.slice(0,-1); render(); return; }
    if(action==="logout"){ logout(); return; }
    if(action==="toggle-sidebar"){
      if(window.matchMedia && window.matchMedia("(max-width:759px)").matches){
        state.sidebarMobileAberto = !state.sidebarMobileAberto;
      } else {
        state.sidebarCollapsed = !state.sidebarCollapsed;
      }
      render(); return;
    }
    if(action==="sidebar-abrir"){ state.sidebarMobileAberto = true; render(); return; }
    if(action==="sidebar-fechar"){ state.sidebarMobileAberto = false; render(); return; }
    if(action==="nav-goto"){ state.view = el.dataset.view; state.viewParams={}; state.sidebarMobileAberto = false; render(); return; }
    if(action==="salao-filtro"){ state.salaoFiltro = el.dataset.f; render(); return; }

    if(action==="mesa-open"){
      var mesaId = el.dataset.mesa;
      var abertas = comandasAbertasDaMesa(mesaId);
      if(abertas.length===0){
        if(can(PERM.COMANDA_ABRIR)) abrirComanda(mesaId);
      } else {
        irParaComanda(abertas[0].id); render();
      }
      return;
    }
    if(action==="comanda-open"){ irParaComanda(el.dataset.comanda); render(); return; }

    if(action==="toggle-mobile-catalog"){ state.draft.mobileCatalog = !state.draft.mobileCatalog; render(); return; }
    if(action==="picker-cat"){ state.draft.categoria = el.dataset.cat; render(); return; }
    if(action==="draft-mais"){ draftAlterar(el.dataset.produto, 1); return; }
    if(action==="draft-ingrediente-toggle"){ draftToggleIngrediente(el.dataset.produto, el.dataset.nome); return; }
    if(action==="draft-menos"){ draftAlterar(el.dataset.produto, -1); return; }
    if(action==="pedido-revisar-abrir"){ state.modal={type:"revisarPedido", comandaId:state.draft.comandaId}; render(); return; }
    if(action==="pedido-revisar-voltar"){ state.modal=null; render(); return; }
    if(action==="pedido-revisar-confirmar"){ enviarPedido(); return; }

    if(action==="item-cancelar"){ abrirCancelarItem(state.viewParams.comandaId, el.dataset.item); return; }
    if(action==="cancelaritem-digit"){ cancelarItemDigit(el.dataset.d); return; }
    if(action==="cancelaritem-back"){ state.modal.buffer = state.modal.buffer.slice(0,-1); render(); return; }
    if(action==="cancelaritem-voltar"){ state.modal = null; render(); return; }

    if(action==="desconto-abrir"){ state.modal={type:"desconto", comandaId:state.viewParams.comandaId}; render(); return; }
    if(action==="desconto-cancelar"){ state.modal=null; render(); return; }
    if(action==="desconto-confirmar"){
      var pct = parseFloat(document.getElementById("descontoInput").value||"0");
      if(pct>0) aplicarDesconto(el.dataset.comanda, pct); else { state.modal=null; render(); }
      return;
    }

    if(action==="supervisor-digit"){ supervisorDigit(el.dataset.d); return; }
    if(action==="supervisor-back"){ state.modal.buffer = state.modal.buffer.slice(0,-1); render(); return; }
    if(action==="supervisor-cancel"){ state.modal=null; render(); return; }

    if(action==="fechar-conta-abrir"){ abrirFecharConta(state.viewParams.comandaId); return; }
    if(action==="pagamento-cancelar"){
      var comanda = state.comandas.find(function(c){ return c.id===state.modal.comandaId; });
      comanda.status = "ABERTA";
      state.modal=null; render();
      sb.from("comandas").update({status:"ABERTA"}).eq("id", comanda.id);
      return;
    }
    if(action==="pagamento-metodo"){ pagamentoAddMetodo(el.dataset.forma); return; }
    if(action==="pagamento-remover"){ pagamentoRemoveLinha(parseInt(el.dataset.idx,10)); return; }
    if(action==="pagamento-confirmar"){ confirmarPagamento(); return; }
    if(action==="pagamento-dividir-mais"){ state.modal.dividirPessoas = (state.modal.dividirPessoas||1)+1; render(); return; }
    if(action==="pagamento-dividir-menos"){ state.modal.dividirPessoas = Math.max(1,(state.modal.dividirPessoas||1)-1); render(); return; }
    if(action==="recibo-imprimir"){
      if(state.modal && state.modal.comanda) imprimir(buildReciboHtml(state.modal.comanda));
      return;
    }
    if(action==="recibo-fechar"){ state.modal = null; render(); return; }

    if(action==="kds-set"){ kdsSetStatus(el.dataset.comanda, el.dataset.item, el.dataset.status); return; }

    if(action==="caixa-abrir-confirmar"){
      var v = document.getElementById("saldoInicialInput").value;
      abrirCaixa(Math.round(parseFloat(v||"0")*100));
      return;
    }
    if(action==="caixa-mov-abrir"){ state.modal={type:"caixaMov", tipo:el.dataset.tipo}; render(); return; }
    if(action==="caixa-mov-cancelar"){ state.modal=null; render(); return; }
    if(action==="caixa-mov-confirmar"){
      var valor = Math.round(parseFloat(document.getElementById("movValorInput").value||"0")*100);
      var motivo = document.getElementById("movMotivoInput").value.trim();
      if(valor>0 && motivo) registrarMovimento(el.dataset.tipo, valor, motivo);
      return;
    }
    if(action==="caixa-fechar-abrir"){ state.modal={type:"caixaFechar", stage:"contar", informados:{}}; render(); return; }
    if(action==="caixa-fechar-cancelar"){ state.modal=null; render(); return; }
    if(action==="caixa-fechar-informar"){
      var inputs = document.querySelectorAll('[data-action="fechar-informado"]');
      var informados = {};
      inputs.forEach(function(inp){ informados[inp.dataset.forma] = Math.round(parseFloat(inp.value||"0")*100); });
      state.modal.informados = informados;
      state.modal.stage = "resultado";
      render(); return;
    }
    if(action==="caixa-fechar-justificar-confirmar"){
      var just = document.getElementById("justificativaInput").value.trim();
      if(just) confirmarFechamento(just);
      return;
    }
    if(action==="caixa-fechar-confirmar-final"){ confirmarFechamento(null); return; }
    if(action==="fechamento-imprimir"){
      var sessaoImp = state.caixaSessoesHistorico.find(function(s){ return s.id===el.dataset.sessao; });
      if(sessaoImp) imprimir(buildFechamentoHtml(sessaoImp));
      return;
    }
    if(action==="caixa-fechar-ok"){ state.modal = null; render(); return; }

    if(action==="cardapio-filtro"){ state.cardapioFiltro = el.dataset.f; render(); return; }
    if(action==="produto-novo"){ abrirProdutoForm(null); return; }
    if(action==="produto-editar"){ abrirProdutoForm(el.dataset.produto); return; }
    if(action==="produto-esgotar"){ toggleEsgotado(el.dataset.produto); return; }
    if(action==="produto-form-cancelar"){ state.modal=null; render(); return; }
    if(action==="produto-form-salvar"){
      var novaCat = document.getElementById("pfNovaCategoria").value.trim();
      var categoria = novaCat || document.getElementById("pfCategoria").value;
      var nome = document.getElementById("pfNome").value;
      var preco = Math.round(parseFloat(document.getElementById("pfPreco").value||"0")*100);
      salvarProduto(el.dataset.produto||null, nome, categoria, preco);
      return;
    }

    if(action==="insumo-mov-abrir"){ abrirInsumoMov(el.dataset.tipo, el.dataset.insumo); return; }
    if(action==="insumo-mov-cancelar"){ state.modal=null; render(); return; }
    if(action==="insumo-mov-confirmar"){
      var insumoId = document.getElementById("imInsumo").value;
      var qtd = parseFloat(document.getElementById("imQuantidade").value||"0");
      var motivo = document.getElementById("imMotivo").value;
      confirmarInsumoMov(el.dataset.tipo, insumoId, qtd, motivo);
      return;
    }

    if(action==="financeiro-filtro"){ state.financeiroFiltro = el.dataset.f; render(); return; }
    if(action==="conta-nova"){ abrirContaForm(); return; }
    if(action==="conta-form-cancelar"){ state.modal=null; render(); return; }
    if(action==="conta-form-salvar"){
      var tipo = document.getElementById("cfTipo").value;
      var descricao = document.getElementById("cfDescricao").value;
      var categoria2 = document.getElementById("cfCategoria").value;
      var valor = Math.round(parseFloat(document.getElementById("cfValor").value||"0")*100);
      var vencimento = document.getElementById("cfVencimento").value;
      salvarConta(tipo, descricao, categoria2, valor, vencimento);
      return;
    }
    if(action==="conta-pagar"){ marcarContaPaga(el.dataset.conta); return; }

    if(action==="relatorio-periodo"){ state.relatorioPeriodo = el.dataset.p; render(); return; }

    if(action==="usuario-novo"){ abrirUsuarioForm(); return; }
    if(action==="usuario-form-cancelar"){ state.modal=null; render(); return; }
    if(action==="usuario-form-salvar"){
      var uNome = document.getElementById("ufNome").value;
      var uPapel = document.getElementById("ufPapel").value;
      var uPin = document.getElementById("ufPin").value;
      salvarUsuario(uNome, uPapel, uPin);
      return;
    }
    if(action==="usuario-toggle-ativo"){ toggleUsuarioAtivo(el.dataset.usuario); return; }

    if(action==="config-salvar"){
      salvarConfig({
        nome: document.getElementById("cfgNome").value,
        cnpj: document.getElementById("cfgCnpj").value,
        taxaPct: parseFloat(document.getElementById("cfgTaxa").value||"0"),
        descontoPct: parseFloat(document.getElementById("cfgDesconto").value||"0"),
        diferencaCentavos: Math.round(parseFloat(document.getElementById("cfgDiferenca").value||"0")*100),
        impressoraLargura: document.getElementById("cfgImpressora").value,
        reciboRodape: document.getElementById("cfgRodape").value,
        horarioAbertura: document.getElementById("cfgHorarioAbertura").value,
        horarioFechamento: document.getElementById("cfgHorarioFechamento").value,
        chavePix: document.getElementById("cfgChavePix").value
      });
      return;
    }
   } catch(err){
     console.error("erro no clique:", err.message, err.stack);
     toast("err","ERRO INESPERADO", err.message);
   }
  };

  app.onchange = function(e){
    if(e.target.dataset.action==="toggle-taxa"){
      var comanda = state.comandas.find(function(c){ return c.id===state.viewParams.comandaId; });
      var ativa = e.target.checked;
      comanda.taxaServicoAtiva = ativa;
      render();
      sb.from("comandas").update({taxa_servico_ativa:ativa}).eq("id", comanda.id).then(function(res){
        if(res.error){ comanda.taxaServicoAtiva = !ativa; toast("err","ERRO", res.error.message); render(); }
      });
    }
  };

  app.oninput = function(e){
    var action = e.target.dataset.action;
    if(action==="draft-busca"){ state.draft.busca = e.target.value; render(); return; }
    if(action==="draft-obs"){ draftObs(e.target.dataset.produto, e.target.value); return; }
    if(action==="cancelar-motivo"){ state.modal.motivo = e.target.value; return; }
    if(action==="pagamento-valor"){
      var idx = parseInt(e.target.dataset.idx,10);
      pagamentoEditarLinha(idx, Math.round(parseFloat(e.target.value||"0")*100));
      render();
      return;
    }
  };

  app.ondragstart = function(e){
    var card = e.target.closest(".kanban-card");
    if(!card) return;
    card.classList.add("dragging");
    e.dataTransfer.setData("text/plain", JSON.stringify({comandaId:card.dataset.comanda, itemId:card.dataset.item}));
    e.dataTransfer.effectAllowed = "move";
  };
  app.ondragend = function(e){
    var card = e.target.closest(".kanban-card");
    if(card) card.classList.remove("dragging");
  };
  app.ondragover = function(e){
    var col = e.target.closest(".kanban-col");
    if(!col) return;
    e.preventDefault();
    col.classList.add("drag-over");
  };
  app.ondragleave = function(e){
    var col = e.target.closest(".kanban-col");
    if(col) col.classList.remove("drag-over");
  };
  app.ondrop = function(e){
    var col = e.target.closest(".kanban-col");
    if(!col) return;
    e.preventDefault();
    col.classList.remove("drag-over");
    try{
      var data = JSON.parse(e.dataTransfer.getData("text/plain"));
      if(can(PERM.ITEM_STATUS)) kdsSetStatus(data.comandaId, data.itemId, col.dataset.status);
    }catch(err){}
  };
}

document.addEventListener("keydown", function(e){
  if(!state || !state.usuarioAtualId) return;
  if(e.key==="Escape" && state.modal){ state.modal=null; render(); return; }
  if(e.key==="F8" && state.view==="caixa" && can(PERM.SANGRIA) && state.caixaSessao && state.caixaSessao.status==="ABERTA" && !state.modal){
    e.preventDefault(); state.modal={type:"caixaMov", tipo:"SANGRIA"}; render();
  }
});

window.addEventListener("online", function(){
  render();
  if(state.usuarioAtualId) carregarTudo();
});
window.addEventListener("offline", render);
