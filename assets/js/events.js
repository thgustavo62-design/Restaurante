"use strict";

// ---------- eventos ----------

function bindEvents(){
  app.onclick = function(e){
   try{
    var el = e.target.closest("[data-action]");
    if(!el) return;
    var action = el.dataset.action;

    if(action==="restaurante-slug-confirmar"){ confirmarRestauranteSlug(); return; }
    if(action==="restaurante-trocar"){ trocarRestaurante(); return; }
    if(action==="login-mfa-confirmar"){ confirmarMfaLogin(document.getElementById("loginMfaCodigoInput").value); return; }
    if(action==="login-mfa-cancelar"){ cancelarMfaLogin(); return; }
    if(action==="login-confirmar"){
      var loginUsuario = document.getElementById("loginUsuarioInput").value;
      var loginSenha = document.getElementById("loginSenhaInput").value;
      tentarLogin(loginUsuario, loginSenha);
      return;
    }
    if(action==="logout"){
      var temDraft = state.draft && Object.keys(state.draft.itens||{}).length>0;
      state.modal = {type:"confirmarLogout", temDraft:temDraft};
      render(); return;
    }
    if(action==="logout-cancelar"){ state.modal=null; render(); return; }
    if(action==="logout-confirmar"){ logout(); return; }
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
    if(action==="nav-grupo-toggle"){
      var grupo = el.dataset.grupo;
      var chevron = el.querySelector(".nav-group-chevron");
      var estavaAberto = chevron && chevron.classList.contains("open");
      state.sidebarGruposAbertos[grupo] = !estavaAberto;
      render(); return;
    }
    if(action==="subaba-ir"){ subAbaIr(el.dataset.tela, el.dataset.aba); return; }
    if(action==="nav-goto"){
      state.view = el.dataset.view; state.viewParams={}; state.sidebarMobileAberto = false;
      render();
      garantirSubAbaCarregada(el.dataset.view);
      if(el.dataset.view==="configuracoes") carregarMfaFactors();
      if(el.dataset.view==="central") carregarCentralDono();
      return;
    }
    if(action==="qrcode-imprimir"){ imprimirQrCodeMesa(el.dataset.mesa); return; }
    if(action==="qrcode-baixar"){ baixarQrCodeMesa(el.dataset.mesa); return; }
    if(action==="qrcode-rotacionar"){ rotacionarQrCodeMesa(el.dataset.mesa); return; }
    if(action==="qrcodes-imprimir-todas"){ imprimirTodasQrCodes(); return; }
    if(action==="salao-filtro"){ state.salaoFiltro = el.dataset.f; render(); return; }

    if(action==="balcao-abrir"){ abrirComandaBalcao(); return; }
    if(action==="ficha-abrir"){ abrirComandaFicha(); return; }
    if(action==="delivery-abrir"){ abrirNovoDelivery(); return; }
    if(action==="delivery-cancelar"){ state.modal=null; render(); return; }
    if(action==="delivery-cliente-trocar"){ state.modal.escolhendoCliente=true; state.modal.buscaCliente=""; render(); return; }
    if(action==="delivery-cliente-voltar"){ state.modal.escolhendoCliente=false; render(); return; }
    if(action==="delivery-cliente-escolher"){
      var dc = state.clientes.find(function(c){ return c.id===el.dataset.cliente; });
      state.modal.clienteId = el.dataset.cliente;
      state.modal.escolhendoCliente = false;
      if(dc){
        state.modal.endereco = dc.endereco||"";
        state.modal.bairro = dc.bairro||"";
        state.modal.taxaEntregaCentavos = (state.config.bairrosTaxaEntrega&&state.config.bairrosTaxaEntrega[dc.bairro])||0;
      }
      render(); return;
    }
    if(action==="delivery-confirmar"){
      criarDelivery(
        document.getElementById("dlvEndereco").value,
        document.getElementById("dlvBairro").value,
        Math.round(parseFloat(document.getElementById("dlvTaxa").value||"0")*100),
        document.getElementById("dlvAgendado").value
      );
      return;
    }
    if(action==="comanda-entregador-avancar"){ avancarStatusEntregador(el.dataset.comanda); return; }
    if(action==="pedidoqr-confirmar"){ confirmarPedidoQr(el.dataset.pedido); return; }
    if(action==="pedidoqr-rejeitar"){ rejeitarPedidoQr(el.dataset.pedido, "Rejeitado pelo garçom"); return; }
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

    if(action==="comanda-couvert-adicionar"){ adicionarCouvert(el.dataset.comanda); return; }
    if(action==="toggle-mobile-catalog"){ state.draft.mobileCatalog = !state.draft.mobileCatalog; render(); return; }
    if(action==="picker-cat"){ state.draft.categoria = el.dataset.cat; render(); return; }
    if(action==="produto-clicar"){
      var pidClicado = el.dataset.produto;
      if(gruposDoProduto(pidClicado).length) abrirOpcoesPedido(pidClicado);
      else draftAlterar(pidClicado, 1);
      return;
    }
    if(action==="draft-mais"){ draftAlterar(el.dataset.produto, 1); return; }
    if(action==="draft-ingrediente-toggle"){ draftToggleIngrediente(el.dataset.produto, el.dataset.nome); return; }
    if(action==="draft-menos"){ draftAlterar(el.dataset.produto, -1); return; }
    if(action==="draftopt-mais"){ draftOpcoesAlterarQtd(el.dataset.linha, 1); return; }
    if(action==="draftopt-menos"){ draftOpcoesAlterarQtd(el.dataset.linha, -1); return; }
    if(action==="draftopt-remover"){ draftOpcoesRemover(el.dataset.linha); return; }
    if(action==="opcoespedido-toggle"){
      var mOp = state.modal;
      var gid = el.dataset.grupo, oidSel = el.dataset.opcao, maxSel = parseInt(el.dataset.max,10);
      var sel = mOp.selecionadas[gid] || (mOp.selecionadas[gid]=[]);
      var idxSel = sel.indexOf(oidSel);
      if(idxSel!==-1){ sel.splice(idxSel,1); }
      else {
        if(maxSel===1) sel.length = 0;
        if(sel.length<maxSel) sel.push(oidSel);
      }
      mOp.erro = "";
      render(); return;
    }
    if(action==="opcoespedido-qtd-mais"){ state.modal.qtd++; render(); return; }
    if(action==="opcoespedido-qtd-menos"){ state.modal.qtd = Math.max(1, state.modal.qtd-1); render(); return; }
    if(action==="opcoespedido-cancelar"){ state.modal=null; render(); return; }
    if(action==="opcoespedido-confirmar"){ confirmarOpcoesPedido(); return; }
    if(action==="pedido-revisar-abrir"){ state.modal={type:"revisarPedido", comandaId:state.draft.comandaId}; render(); return; }
    if(action==="pedido-revisar-voltar"){ state.modal=null; render(); return; }
    if(action==="pedido-revisar-confirmar"){ enviarPedido(); return; }

    if(action==="item-cancelar"){ abrirCancelarItem(state.viewParams.comandaId, el.dataset.item); return; }
    if(action==="item-transferir"){ abrirTransferirItem(el.dataset.item); return; }
    if(action==="transferiritem-cancelar"){ state.modal=null; render(); return; }
    if(action==="transferiritem-confirmar"){ confirmarTransferirItem(); return; }
    if(action==="comanda-transferir-mesa-abrir"){ abrirTransferirMesa(el.dataset.comanda); return; }
    if(action==="transferirmesa-cancelar"){ state.modal=null; render(); return; }
    if(action==="transferirmesa-confirmar"){ confirmarTransferirMesa(); return; }
    if(action==="comanda-juntar-abrir"){ abrirJuntarMesas(el.dataset.comanda); return; }
    if(action==="juntarmesas-cancelar"){ state.modal=null; render(); return; }
    if(action==="juntarmesas-confirmar"){ confirmarJuntarMesas(); return; }
    if(action==="cancelaritem-confirmar"){ confirmarCancelarItem(); return; }
    if(action==="cancelaritem-voltar"){ state.modal = null; render(); return; }

    if(action==="desconto-abrir"){ state.modal={type:"desconto", comandaId:state.viewParams.comandaId}; render(); return; }
    if(action==="desconto-cancelar"){ state.modal=null; render(); return; }
    if(action==="desconto-confirmar"){
      var pct = parseFloat(document.getElementById("descontoInput").value||"0");
      if(pct>0) aplicarDesconto(el.dataset.comanda, pct); else { state.modal=null; render(); }
      return;
    }

    if(action==="supervisor-rpc-confirmar"){ confirmarSupervisorRpc(); return; }
    if(action==="supervisor-rpc-cancel"){ state.modal=null; render(); return; }

    if(action==="fechar-conta-abrir"){ abrirFecharConta(state.viewParams.comandaId); return; }
    if(action==="comanda-cancelar-confirmar"){ cancelarComanda(el.dataset.comanda); return; }
    if(action==="comanda-reabrir-travada"){ reabrirComandaTravada(el.dataset.comanda); return; }
    if(action==="pagamento-cancelar"){ fecharModalAtual(); return; }
    if(action==="pagamento-cliente-trocar"){ state.modal.escolhendoCliente = true; state.modal.buscaCliente=""; render(); return; }
    if(action==="pagamento-cliente-voltar"){ state.modal.escolhendoCliente = false; render(); return; }
    if(action==="pagamento-cliente-escolher"){ state.modal.fiadoClienteId = el.dataset.cliente; state.modal.escolhendoCliente = false; state.modal.pontosResgatados = 0; render(); atualizarTotaisPagamento(); return; }
    if(action==="pagamento-modo"){ state.modal.modo = el.dataset.modo; state.modal.linhas = []; state.modal.pontosResgatados = 0; state.modal.cupomCodigo=""; state.modal.erro=""; render(); atualizarTotaisPagamento(); return; }
    if(action==="pagamento-item-toggle"){
      var iid = el.dataset.item;
      if(state.modal.itensSelecionados[iid]) delete state.modal.itensSelecionados[iid];
      else state.modal.itensSelecionados[iid] = true;
      state.modal.linhas = []; state.modal.erro="";
      render(); atualizarTotaisPagamento(); return;
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
    if(action==="kds-avancar-ticket"){ kdsAvancarTicket(el.dataset.comanda, el.dataset.itens.split(","), el.dataset.status); return; }
    if(action==="expedicao-liberar"){ kdsAvancarTicket(el.dataset.comanda, el.dataset.itens.split(","), "ENTREGUE"); return; }
    if(action==="kds-filtro"){ state.kdsSetorFiltro = el.dataset.f; render(); return; }
    if(action==="kds-som-toggle"){
      state.kdsSomAtivo = !state.kdsSomAtivo;
      if(state.kdsSomAtivo) tocarBipKds();
      render(); return;
    }
    if(action==="notificacoes-toggle"){ alternarNotificacoes(); return; }

    if(action==="caixa-abrir-confirmar"){
      var v = document.getElementById("saldoInicialInput").value;
      var terminalNome = document.getElementById("terminalNomeInput").value;
      abrirCaixa(Math.round(parseFloat(v||"0")*100), terminalNome);
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
      conferirFechamento(informados);
      return;
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
    if(action==="opcoesproduto-abrir"){ abrirOpcoesProduto(el.dataset.produto); return; }
    if(action==="opcoesproduto-fechar"){ state.modal=null; render(); return; }
    if(action==="grupo-opcoes-remover"){ removerGrupoOpcoes(el.dataset.grupo); return; }
    if(action==="opcao-toggle-ativa"){ toggleOpcaoAtiva(el.dataset.opcao); return; }
    if(action==="opcao-remover"){ removerOpcao(el.dataset.opcao); return; }
    if(action==="opcao-criar"){
      var gid2 = el.dataset.grupo;
      var nomeOpcao = document.getElementById("novaOpcaoNome-"+gid2).value;
      var precoOpcao = Math.round(parseFloat(document.getElementById("novaOpcaoPreco-"+gid2).value||"0")*100);
      criarOpcao(gid2, nomeOpcao, precoOpcao);
      return;
    }
    if(action==="grupo-opcoes-criar"){
      var nomeGrupo = document.getElementById("novoGrupoNome").value;
      var obrigatorioGrupo = document.getElementById("novoGrupoObrigatorio").checked;
      var minimoGrupo = parseInt(document.getElementById("novoGrupoMinimo").value||"0",10);
      var maximoGrupo = parseInt(document.getElementById("novoGrupoMaximo").value||"1",10);
      criarGrupoOpcoes(el.dataset.produto, nomeGrupo, obrigatorioGrupo, minimoGrupo, maximoGrupo);
      return;
    }
    if(action==="produto-form-cancelar"){ state.modal=null; render(); return; }
    if(action==="produto-form-salvar"){
      var novaCat = document.getElementById("pfNovaCategoria").value.trim();
      var categoria = novaCat || document.getElementById("pfCategoria").value;
      var nome = document.getElementById("pfNome").value;
      var preco = Math.round(parseFloat(document.getElementById("pfPreco").value||"0")*100);
      var setorProducao = document.getElementById("pfSetorProducao").value;
      var fotoUrl = document.getElementById("pfFotoUrl").value;
      var happyVal = document.getElementById("pfPrecoHappyHour").value;
      var precoHappyHour = happyVal.trim()==="" ? null : Math.round(parseFloat(happyVal)*100);
      var tempo = document.getElementById("pfTempo").value;
      salvarProduto(el.dataset.produto||null, nome, categoria, preco, setorProducao, fotoUrl, precoHappyHour, tempo);
      return;
    }

    if(action==="inventario-abrir"){ abrirInventario(); return; }
    if(action==="inventario-cancelar"){ state.modal=null; render(); return; }
    if(action==="inventario-confirmar"){ confirmarInventario(); return; }
    if(action==="sugerir-pedido-compra"){ sugerirPedidoCompra(); return; }
    if(action==="insumo-mov-abrir"){ abrirInsumoMov(el.dataset.tipo, el.dataset.insumo); return; }
    if(action==="insumo-mov-cancelar"){ state.modal=null; render(); return; }
    if(action==="insumo-mov-confirmar"){
      var insumoId = document.getElementById("imInsumo").value;
      var qtd = parseFloat(document.getElementById("imQuantidade").value||"0");
      var motivo = document.getElementById("imMotivo").value;
      confirmarInsumoMov(el.dataset.tipo, insumoId, qtd, motivo);
      return;
    }
    if(action==="fornecedor-novo"){ abrirFornecedorForm(null); return; }
    if(action==="fornecedor-editar"){ abrirFornecedorForm(el.dataset.fornecedor); return; }
    if(action==="fornecedor-form-cancelar"){ state.modal=null; render(); return; }
    if(action==="fornecedor-form-salvar"){
      var fnNome = document.getElementById("fnNome").value;
      var fnContato = document.getElementById("fnContato").value;
      var fnTelefone = document.getElementById("fnTelefone").value;
      var fnPrazo = parseFloat(document.getElementById("fnPrazoEntrega").value||"0");
      var fnDia = document.getElementById("fnDiaEntrega").value;
      salvarFornecedor(fnNome, fnContato, fnTelefone, fnPrazo, fnDia);
      return;
    }
    if(action==="fornecedor-toggle-ativo"){ toggleFornecedorAtivo(el.dataset.fornecedor); return; }

    if(action==="pedido-compra-novo"){ abrirPedidoCompraForm(); return; }
    if(action==="pedido-compra-form-cancelar"){ state.modal=null; render(); return; }
    if(action==="pedido-compra-item-add"){
      var pcInsumo = document.getElementById("pcInsumo").value;
      var pcQtd = parseFloat(document.getElementById("pcQuantidade").value||"0");
      var pcCusto = document.getElementById("pcCustoUnit").value;
      pedidoCompraAdicionarItem(pcInsumo, pcQtd, pcCusto===""?null:Math.round(parseFloat(pcCusto)*100));
      return;
    }
    if(action==="pedido-compra-item-remover"){ pedidoCompraRemoverItem(parseInt(el.dataset.idx,10)); return; }
    if(action==="pedido-compra-criar"){ criarPedidoCompra(); return; }
    if(action==="pedido-compra-marcar-realizado"){ marcarPedidoCompraRealizado(el.dataset.pedido); return; }
    if(action==="pedido-compra-receber"){ abrirReceberPedido(el.dataset.pedido); return; }
    if(action==="receberpedido-cancelar"){ state.modal=null; render(); return; }
    if(action==="receberpedido-confirmar"){ confirmarReceberPedido(); return; }

    if(action==="lista-compras-gerar-pedido"){
      var grupo = state.listaComprasSugerida[parseInt(el.dataset.grupoIdx,10)];
      abrirPedidoCompraDaSugestao(grupo.fornecedor_id||null, grupo.itens);
      return;
    }
    if(action==="cotacao-toggle-fornecedor"){ cotacaoToggleFornecedor(el.dataset.fornecedor); return; }
    if(action==="cotacao-linha-adicionar"){ cotacaoLinhaAdicionar(); return; }
    if(action==="cotacao-linha-remover"){ cotacaoLinhaRemover(parseInt(el.dataset.idx,10)); return; }
    if(action==="cotacao-importar-lista"){ cotacaoImportarListaCompras(); return; }
    if(action==="cotacao-gerar-pedidos"){ gerarPedidosDaCotacao(); return; }

    if(action==="rendimento-abrir"){ abrirRendimento(el.dataset.insumo); return; }
    if(action==="rendimento-cancelar"){ state.modal=null; render(); return; }
    if(action==="rendimento-confirmar"){
      var rdFator = parseFloat(document.getElementById("rdFator").value||"0");
      var rdObs = document.getElementById("rdObservacao").value;
      salvarRendimento(el.dataset.insumo, rdFator, rdObs);
      return;
    }

    // PRIORIDADE 2 — sub-receita (ficha própria) e produção de lote.
    if(action==="receita-abrir"){ abrirReceitaSubReceita(el.dataset.insumo); return; }
    if(action==="receita-cancelar"){ state.modal=null; render(); return; }
    if(action==="receita-linha-adicionar"){ receitaLinhaAdicionar(); return; }
    if(action==="receita-linha-remover"){ receitaLinhaRemover(parseInt(el.dataset.idx,10)); return; }
    if(action==="receita-salvar"){ salvarReceitaSubReceita(); return; }

    if(action==="produzir-lote-abrir"){
      abrirProduzirLote(el.dataset.insumo, el.dataset.sugerido ? parseFloat(el.dataset.sugerido) : null);
      return;
    }
    if(action==="produzir-lote-cancelar"){ state.modal=null; render(); return; }
    if(action==="produzir-lote-confirmar"){
      var plQuantidade = parseFloat(document.getElementById("plQuantidade").value||"0");
      var plValidade = document.getElementById("plValidade").value;
      confirmarProduzirLote(el.dataset.insumo, plQuantidade, plValidade);
      return;
    }

    if(action==="pre-preparo-marcar"){ marcarPrePreparoFeito(el.dataset.checklist, el.dataset.feito==="true"); return; }
    if(action==="producao-recalcular"){
      var ajuste = parseFloat(document.getElementById("producaoAjustePct").value||"0");
      recalcularChecklistPreProducao(ajuste);
      return;
    }

    // PRIORIDADE 3 — Perdas e Desperdícios.
    if(action==="perdas-periodo"){
      state.perdasPeriodo = el.dataset.p;
      render();
      carregarPerdas(el.dataset.p);
      return;
    }
    if(action==="perda-abrir"){ abrirPerdaForm(); return; }
    if(action==="perda-cancelar"){ state.modal=null; render(); return; }
    if(action==="perda-confirmar"){
      var perdaQuantidade = parseFloat(document.getElementById("perdaQuantidade").value||"0");
      confirmarPerda(perdaQuantidade);
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
    if(action==="exportar-contador"){ exportarParaContador(document.getElementById("exportMesInput").value); return; }

    if(action==="relatorio-periodo"){
      state.relatorioPeriodo = el.dataset.p;
      render();
      if(state.subAba.relatorios==="gestao") carregarRelatorioGestao(el.dataset.p);
      else carregarRelatorio(el.dataset.p);
      return;
    }
    if(action==="cliente-novo"){ abrirClienteForm(null); return; }
    if(action==="cliente-editar"){ abrirClienteForm(el.dataset.cliente); return; }
    if(action==="cliente-abrir"){ carregarFichaCliente(el.dataset.cliente); return; }
    if(action==="cliente-form-cancelar"){ state.modal=null; render(); return; }
    if(action==="cliente-form-salvar"){
      salvarCliente(
        document.getElementById("clNome").value,
        document.getElementById("clTelefone").value,
        document.getElementById("clAniversario").value,
        document.getElementById("clObservacoes").value,
        document.getElementById("clConsentimento").checked,
        document.getElementById("clEndereco").value,
        document.getElementById("clBairro").value
      );
      return;
    }
    if(action==="cupom-novo"){ abrirCupomForm(); return; }
    if(action==="cupom-form-cancelar"){ state.modal=null; render(); return; }
    if(action==="cupom-form-salvar"){
      salvarCupom(
        document.getElementById("cupCodigo").value,
        document.getElementById("cupTipo").value,
        document.getElementById("cupValor").value,
        document.getElementById("cupValidoDe").value,
        document.getElementById("cupValidoAte").value,
        document.getElementById("cupUsosMax").value
      );
      return;
    }
    if(action==="cupom-alternar-ativo"){ alternarAtivoCupom(el.dataset.cupom); return; }
    if(action==="clientes-inativos-buscar"){ buscarClientesInativos(document.getElementById("inativosDias").value); return; }
    if(action==="marketing-banner-salvar"){
      salvarMarketingBanner(
        document.getElementById("mkBannerAtivo").checked,
        document.getElementById("mkBannerTexto").value,
        document.getElementById("mkProdutoDestaque").value
      );
      return;
    }

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
    if(action==="usuario-trocar-pin"){ abrirTrocarPin(el.dataset.usuario); return; }
    if(action==="trocarpin-cancelar"){ state.modal=null; render(); return; }
    if(action==="trocarpin-confirmar"){
      var tpNovo = document.getElementById("tpNovoPin").value;
      var tpConfirmar = document.getElementById("tpConfirmarPin").value;
      confirmarTrocarPin(el.dataset.usuario, tpNovo, tpConfirmar);
      return;
    }

    // PRIORIDADE 5 — Controle de Equipe.
    if(action==="escala-salvar"){ salvarEscalaUsuario(el.dataset.usuario); return; }
    if(action==="ponto-bater"){ baterPonto(el.dataset.tipo); return; }
    if(action==="ponto-corrigir-abrir"){ abrirCorrigirPonto(el.dataset.ponto); return; }
    if(action==="corrigirponto-cancelar"){ state.modal=null; render(); return; }
    if(action==="corrigirponto-confirmar"){ confirmarCorrigirPonto(); return; }
    if(action==="desempenho-periodo"){ state.desempenhoPeriodo = el.dataset.p; render(); carregarDesempenhoEquipe(el.dataset.p); return; }
    if(action==="remuneracao-abrir"){ abrirRemuneracaoForm(el.dataset.usuario); return; }
    if(action==="remuneracao-cancelar"){ state.modal=null; render(); return; }
    if(action==="remuneracao-salvar"){
      var remTipo = document.getElementById("remTipo").value;
      var remValor = document.getElementById("remValor").value;
      salvarRemuneracao(state.modal.usuarioId, remTipo, remValor);
      return;
    }
    if(action==="vale-abrir"){ abrirValeForm(el.dataset.usuario); return; }
    if(action==="vale-cancelar"){ state.modal=null; render(); return; }
    if(action==="vale-confirmar"){
      var valeValor = document.getElementById("valeValor").value;
      var valeMotivo = document.getElementById("valeMotivo").value;
      var valeData = document.getElementById("valeData").value;
      confirmarVale(state.modal.usuarioId, valeValor, valeMotivo, valeData);
      return;
    }
    if(action==="fechamento-recalcular"){ carregarFechamentoEquipe(); return; }

    // PRIORIDADE 7 — Financeiro simples.
    if(action==="despesa-recorrente-nova"){ abrirDespesaRecorrenteForm(null); return; }
    if(action==="despesa-recorrente-editar"){ abrirDespesaRecorrenteForm(el.dataset.despesa); return; }
    if(action==="despesa-recorrente-cancelar"){ state.modal=null; render(); return; }
    if(action==="despesa-recorrente-salvar"){
      var drDescricao = document.getElementById("drDescricao").value;
      var drCategoria = document.getElementById("drCategoria").value;
      var drValor = document.getElementById("drValor").value;
      var drDia = document.getElementById("drDiaVencimento").value;
      var drAtivoEl = document.getElementById("drAtivo");
      var drAtivo = drAtivoEl ? drAtivoEl.checked : true;
      salvarDespesaRecorrente(state.modal.despesaId, drDescricao, drCategoria, drValor, drDia, drAtivo);
      return;
    }

    // PRIORIDADE 8 — Reservas / Fila de espera.
    if(action==="reserva-nova"){ abrirReservaForm(); return; }
    if(action==="reserva-confirmar"){ confirmarReserva(el.dataset.reserva); return; }
    if(action==="reserva-nao-veio"){ reservaNaoVeio(el.dataset.reserva); return; }
    if(action==="reserva-form-cancelar"){ state.modal=null; render(); return; }
    if(action==="reserva-form-salvar"){
      var rsNome = document.getElementById("rsNome").value;
      var rsTelefone = document.getElementById("rsTelefone").value;
      var rsPessoas = parseInt(document.getElementById("rsPessoas").value, 10);
      var rsDataHora = document.getElementById("rsDataHora").value;
      var rsMesaSugerida = document.getElementById("rsMesaSugerida").value;
      var rsObservacao = document.getElementById("rsObservacao").value;
      salvarReserva(rsNome, rsTelefone, rsPessoas, rsDataHora, rsObservacao, rsMesaSugerida);
      return;
    }
    if(action==="fila-nova"){ abrirFilaForm(); return; }
    if(action==="fila-chamar"){ filaChamar(el.dataset.fila); return; }
    if(action==="fila-desistiu"){ filaDesistiu(el.dataset.fila); return; }
    if(action==="fila-form-cancelar"){ state.modal=null; render(); return; }
    if(action==="fila-form-salvar"){
      var flNome = document.getElementById("flNome").value;
      var flTelefone = document.getElementById("flTelefone").value;
      var flPessoas = parseInt(document.getElementById("flPessoas").value, 10);
      salvarEntrarFila(flNome, flTelefone, flPessoas);
      return;
    }
    if(action==="sentar-abrir"){ abrirSentarForm(el.dataset.tipo, el.dataset.id, el.dataset.mesaSugerida); return; }
    if(action==="sentar-mesa-escolher"){ state.modal.mesaId = el.dataset.mesa; state.modal.erro=""; render(); return; }
    if(action==="sentar-form-cancelar"){ state.modal=null; render(); return; }
    if(action==="sentar-form-confirmar"){ confirmarSentar(state.modal.mesaId); return; }

    if(action==="cardapio-link-copiar"){
      var linkInput = document.getElementById("cfgLinkCardapio");
      if(linkInput && navigator.clipboard){
        navigator.clipboard.writeText(linkInput.value).then(function(){ toast("ok","LINK COPIADO",""); });
      }
      return;
    }
    if(action==="bairro-taxa-remover"){ delete state.config.bairrosTaxaEntrega[el.dataset.bairro]; render(); return; }
    if(action==="bairro-taxa-adicionar"){
      var nomeBairro = document.getElementById("novoBairroNome").value.trim();
      var taxaBairro = Math.round(parseFloat(document.getElementById("novoBairroTaxa").value||"0")*100);
      if(nomeBairro){ state.config.bairrosTaxaEntrega[nomeBairro] = taxaBairro; render(); }
      return;
    }
    if(action==="syncconflito-aplicar"){ resolverSyncConflito(el.dataset.conflito, true); return; }
    if(action==="syncconflito-descartar"){ resolverSyncConflito(el.dataset.conflito, false); return; }
    if(action==="mfa-ativar-abrir"){ iniciarConfigMfa(); return; }
    if(action==="mfa-setup-cancelar"){ state.modal=null; render(); return; }
    if(action==="mfa-setup-confirmar"){ confirmarConfigMfa(document.getElementById("mfaCodigoInput").value); return; }
    if(action==="mfa-desativar"){ desativarMfa(el.dataset.fator); return; }
    if(action==="config-salvar"){
      var atrasoPorSetor = {};
      SETORES_PRODUCAO.forEach(function(s){
        atrasoPorSetor[s] = Math.max(1, parseInt(document.getElementById("cfgAtraso"+s).value||"10",10));
      });
      var taxasMaquininha = {};
      ["DEBITO","CREDITO","VOUCHER"].forEach(function(f){
        taxasMaquininha[f] = {
          pct: Math.max(0, parseFloat(document.getElementById("cfgTaxaPct"+f).value||"0")),
          prazoDias: Math.max(0, parseInt(document.getElementById("cfgTaxaPrazo"+f).value||"0",10))
        };
      });
      salvarConfig({
        nome: document.getElementById("cfgNome").value,
        cnpj: document.getElementById("cfgCnpj").value,
        taxaPct: parseFloat(document.getElementById("cfgTaxa").value||"0"),
        descontoPct: parseFloat(document.getElementById("cfgDesconto").value||"0"),
        diferencaCentavos: Math.round(parseFloat(document.getElementById("cfgDiferenca").value||"0")*100),
        alertaSangriaCentavos: Math.round(parseFloat(document.getElementById("cfgAlertaSangria").value||"0")*100),
        impressoraLargura: document.getElementById("cfgImpressora").value,
        reciboRodape: document.getElementById("cfgRodape").value,
        horarioAbertura: document.getElementById("cfgHorarioAbertura").value,
        horarioFechamento: document.getElementById("cfgHorarioFechamento").value,
        chavePix: document.getElementById("cfgChavePix").value,
        atrasoPorSetor: atrasoPorSetor,
        taxasMaquininha: taxasMaquininha,
        produtoCouvertId: document.getElementById("cfgProdutoCouvert").value,
        happyHoraInicio: document.getElementById("cfgHappyInicio").value,
        happyHoraFim: document.getElementById("cfgHappyFim").value,
        fidelidade: {
          pontosPorReal: Math.max(0, parseFloat(document.getElementById("cfgPontosPorReal").value||"0")),
          valorPontoCentavos: Math.max(0, Math.round(parseFloat(document.getElementById("cfgValorPonto").value||"0")*100))
        },
        bairrosTaxaEntrega: state.config.bairrosTaxaEntrega,
        aceitarQrSemTokenAte: document.getElementById("cfgAceitarQrSemTokenAte").value || null,
        metasCentralDono: {
          cmvPct: Math.max(0, parseFloat(document.getElementById("cfgMetaCmv").value||"0")),
          perdasPctFaturamento: Math.max(0, parseFloat(document.getElementById("cfgMetaPerdas").value||"0")),
          custoEquipePct: Math.max(0, parseFloat(document.getElementById("cfgMetaCustoEquipe").value||"0")),
          diferencaCaixaCentavosMes: Math.max(0, Math.round(parseFloat(document.getElementById("cfgMetaDiferencaCaixaMes").value||"0")*100))
        },
        alertaAumentoPrecoInsumoPct: Math.max(0, parseFloat(document.getElementById("cfgAlertaPrecoInsumo").value||"0"))
      });
      return;
    }
   } catch(err){
     console.error("erro no clique:", err.message, err.stack);
     toast("err","ERRO INESPERADO", err.message);
   }
  };

  app.onchange = function(e){
    if(e.target.dataset.action==="pedido-compra-fornecedor"){
      state.modal.fornecedorId = e.target.value;
      return;
    }
    if(e.target.dataset.action==="comanda-pessoas"){ atualizarPessoasComanda(e.target.dataset.comanda, parseInt(e.target.value||"0",10)); return; }
    if(e.target.dataset.action==="toggle-taxa"){
      var comanda = state.comandas.find(function(c){ return c.id===state.viewParams.comandaId; });
      var ativa = e.target.checked;
      comanda.taxaServicoAtiva = ativa;
      render();
      sb.from("comandas").update({taxa_servico_ativa:ativa}).eq("id", comanda.id).then(function(res){
        if(res.error){ comanda.taxaServicoAtiva = !ativa; toast("err","ERRO", res.error.message); render(); }
      });
      return;
    }
    if(e.target.dataset.action==="delivery-cliente-busca"){ state.modal.buscaCliente = e.target.value; render(); return; }
    if(e.target.dataset.action==="delivery-bairro"){
      state.modal.bairro = e.target.value;
      var taxaSugerida = (state.config.bairrosTaxaEntrega||{})[e.target.value];
      if(taxaSugerida!=null){ state.modal.taxaEntregaCentavos = taxaSugerida; render(); }
      return;
    }
    if(e.target.dataset.action==="bairro-taxa-editar"){ state.config.bairrosTaxaEntrega[e.target.dataset.bairro] = Math.round(parseFloat(e.target.value||"0")*100); return; }
    if(e.target.dataset.action==="insumo-validade"){ salvarValidadeInsumo(e.target.dataset.insumo, e.target.value); return; }
    if(e.target.dataset.action==="insumo-sub-receita-toggle"){ toggleSubReceita(e.target.dataset.insumo, e.target.checked); return; }
    if(e.target.dataset.action==="insumo-fornecedor-padrao"){ salvarFornecedorPadraoInsumo(e.target.dataset.insumo, e.target.value); return; }
    if(e.target.dataset.action==="receberpedido-qtd"){ state.modal.itens[parseInt(e.target.dataset.idx,10)].quantidadeRecebida = parseFloat(e.target.value||"0"); return; }
    if(e.target.dataset.action==="receberpedido-preco"){ state.modal.itens[parseInt(e.target.dataset.idx,10)].precoUnitRecebidoCentavos = e.target.value===""?null:Math.round(parseFloat(e.target.value)*100); return; }
    if(e.target.dataset.action==="cotacao-linha-insumo"){ state.cotacao.linhas[parseInt(e.target.dataset.idx,10)].insumoId = e.target.value; return; }
    if(e.target.dataset.action==="cotacao-linha-qtd"){ state.cotacao.linhas[parseInt(e.target.dataset.idx,10)].quantidade = parseFloat(e.target.value||"0"); return; }
    if(e.target.dataset.action==="cotacao-linha-preco"){
      var cl = state.cotacao.linhas[parseInt(e.target.dataset.idx,10)];
      cl.precos[e.target.dataset.fornecedor] = e.target.value===""?null:Math.round(parseFloat(e.target.value)*100);
      render();
      return;
    }
    if(e.target.dataset.action==="usuario-peso-rateio"){ salvarPesoRateioUsuario(e.target.dataset.usuario, parseFloat(e.target.value||"1")); return; }
    if(e.target.dataset.action==="escala-tipo"){ escalaSetTipo(e.target.dataset.usuario, parseInt(e.target.dataset.dia,10), e.target.value); return; }
    if(e.target.dataset.action==="escala-turno-inicio"){ escalaSetTurnoInicio(e.target.dataset.usuario, parseInt(e.target.dataset.dia,10), e.target.value); return; }
    if(e.target.dataset.action==="escala-turno-fim"){ escalaSetTurnoFim(e.target.dataset.usuario, parseInt(e.target.dataset.dia,10), e.target.value); return; }
    if(e.target.dataset.action==="ponto-usuario"){ state.pontoUsuarioId = e.target.value; return; }
    if(e.target.dataset.action==="corrigirponto-data"){ state.modal.novoRegistradoEmInput = e.target.value; return; }
    if(e.target.dataset.action==="corrigirponto-motivo"){ state.modal.motivo = e.target.value; return; }
    if(e.target.dataset.action==="desempenho-mes"){
      state.desempenhoMes = e.target.value;
      carregarDesempenhoEquipe("MES");
      return;
    }
    if(e.target.dataset.action==="fechamento-desde"){ state.fechamentoDesde = e.target.value; return; }
    if(e.target.dataset.action==="fechamento-ate"){ state.fechamentoAte = e.target.value; return; }
    if(e.target.dataset.action==="receita-linha-insumo"){ state.modal.linhas[parseInt(e.target.dataset.idx,10)].insumoIngredienteId = e.target.value; return; }
    if(e.target.dataset.action==="receita-linha-qtd"){ state.modal.linhas[parseInt(e.target.dataset.idx,10)].quantidade = parseFloat(e.target.value||"0"); return; }
    if(e.target.dataset.action==="auditoria-filtro-usuario"){ state.auditoriaFiltroUsuario = e.target.value; render(); return; }
    if(e.target.dataset.action==="auditoria-filtro-acao"){ state.auditoriaFiltroAcao = e.target.value; render(); return; }
    if(e.target.dataset.action==="supervisor-rpc-select"){ state.modal.supervisorId = e.target.value; return; }
    if(e.target.dataset.action==="cancelaritem-supervisor"){ state.modal.supervisorId = e.target.value; return; }
    if(e.target.dataset.action==="relatorio-mes"){
      state.relatorioMes = e.target.value;
      if(state.subAba.relatorios==="gestao") carregarRelatorioGestao("MES");
      else carregarRelatorio("MES");
      return;
    }
    if(e.target.dataset.action==="perdas-mes"){ state.perdasMes = e.target.value; carregarPerdas("MES"); return; }
    if(e.target.dataset.action==="perda-tipo"){ state.modal.tipo = e.target.value; render(); return; }
    if(e.target.dataset.action==="perda-insumo"){ state.modal.insumoId = e.target.value; return; }
    if(e.target.dataset.action==="perda-produto"){ state.modal.produtoId = e.target.value; return; }
    if(e.target.dataset.action==="perda-motivo"){ state.modal.motivo = e.target.value; return; }
    if(e.target.dataset.action==="dre-mes"){ carregarRelatorioDre(e.target.value); return; }
  };

  app.oninput = function(e){
    var action = e.target.dataset.action;
    if(action==="draft-busca"){ state.draft.busca = e.target.value; render(); return; }
    if(action==="draft-obs"){ draftObs(e.target.dataset.produto, e.target.value); return; }
    if(action==="cancelar-motivo"){ state.modal.motivo = e.target.value; return; }
    if(action==="pagamento-cliente-busca"){ state.modal.buscaCliente = e.target.value; render(); return; }
    if(action==="pagamento-pontos"){ state.modal.pontosResgatados = parseInt(e.target.value||"0",10); render(); atualizarTotaisPagamento(); return; }
    if(action==="pagamento-cupom"){ state.modal.cupomCodigo = e.target.value; render(); atualizarTotaisPagamento(); return; }
    if(action==="cliente-busca"){ state.clienteBusca = e.target.value; render(); return; }
    if(action==="pagamento-valor"){
      var idx = parseInt(e.target.dataset.idx,10);
      pagamentoEditarLinha(idx, Math.round(parseFloat(e.target.value||"0")*100));
      render();
      return;
    }
    if(action==="auditoria-busca"){ state.auditoriaBusca = e.target.value; render(); return; }
    if(action==="restaurante-slug-input"){ state.restauranteSlugInput = e.target.value; return; }
    if(action==="opcoespedido-obs"){ state.modal.obs = e.target.value; return; }
    if(action==="login-usuario-input"){ state.loginUsuarioInput = e.target.value; return; }
    if(action==="login-senha-input"){ state.loginSenhaInput = e.target.value; return; }
    if(action==="login-mfa-codigo"){ state.loginMfaCodigo = e.target.value.replace(/\D/g,"").slice(0,6); return; }
    if(action==="supervisor-rpc-pin-input"){ supervisorRpcPinInput(e.target.value); return; }
    if(action==="cancelaritem-pin-input"){ cancelarItemPinInput(e.target.value); return; }
    if(action==="ponto-pin-input"){ state.pontoPin = e.target.value; state.pontoErro = ""; return; }
  };

  app.onkeydown = function(e){
    if(e.key!=="Enter") return;
    if(e.target.id==="loginUsuarioInput" || e.target.id==="loginSenhaInput"){
      e.preventDefault();
      tentarLogin(document.getElementById("loginUsuarioInput").value, document.getElementById("loginSenhaInput").value);
    }
    if(e.target.id==="loginMfaCodigoInput"){
      e.preventDefault();
      confirmarMfaLogin(document.getElementById("loginMfaCodigoInput").value);
    }
    if(e.target.dataset.action==="supervisor-rpc-pin-input"){ e.preventDefault(); confirmarSupervisorRpc(); }
    if(e.target.dataset.action==="cancelaritem-pin-input"){ e.preventDefault(); confirmarCancelarItem(); }
  };

  app.ondragstart = function(e){
    var card = e.target.closest(".kanban-item");
    if(!card) return;
    card.classList.add("dragging");
    e.dataTransfer.setData("text/plain", JSON.stringify({comandaId:card.dataset.comanda, itemId:card.dataset.item}));
    e.dataTransfer.effectAllowed = "move";
  };
  app.ondragend = function(e){
    var card = e.target.closest(".kanban-item");
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
  if(e.key==="Escape" && state.modal){ fecharModalAtual(); return; }
  if(e.key==="Enter" && state.modal && document.activeElement && document.activeElement.tagName!=="TEXTAREA"){
    var btn = document.querySelector(".modal-overlay .btn-primary");
    if(btn && !btn.disabled){ e.preventDefault(); btn.click(); }
    return;
  }
  if(e.key==="F8" && state.view==="caixa" && can(PERM.SANGRIA) && state.caixaSessao && state.caixaSessao.status==="ABERTA" && !state.modal){
    e.preventDefault(); state.modal={type:"caixaMov", tipo:"SANGRIA"}; render();
  }
});

window.addEventListener("online", function(){
  render();
  if(state.usuarioAtualId) offlineSincronizar();
});
window.addEventListener("offline", render);
