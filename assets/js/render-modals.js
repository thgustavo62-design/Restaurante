"use strict";

function renderModal(){
  var m = state.modal;
  if(m.type==="supervisor") return renderSupervisorModal(m);
  if(m.type==="cancelarItem") return renderCancelarItemModal(m);
  if(m.type==="desconto") return renderDescontoModal(m);
  if(m.type==="pagamento") return renderPagamentoModal(m);
  if(m.type==="caixaMov") return renderCaixaMovModal(m);
  if(m.type==="caixaFechar") return renderCaixaFecharModal(m);
  if(m.type==="produtoForm") return renderProdutoFormModal(m);
  if(m.type==="insumoMov") return renderInsumoMovModal(m);
  if(m.type==="contaForm") return renderContaFormModal(m);
  if(m.type==="usuarioForm") return renderUsuarioFormModal(m);
  if(m.type==="recibo") return renderReciboModal(m);
  if(m.type==="revisarPedido") return renderRevisarPedidoModal(m);
  return "";
}

function renderRevisarPedidoModal(m){
  var comanda = state.comandas.find(function(c){ return c.id===m.comandaId; });
  if(!comanda || !state.draft) return "";
  var mesa = state.mesas.find(function(mm){ return mm.id===comanda.mesaId; });
  var itens = state.draft.itens;
  var ids = Object.keys(itens);
  var total = 0;
  var linhasHtml = ids.map(function(pid){
    var p = state.produtos.find(function(x){ return x.id===pid; });
    var d = itens[pid];
    var subtotal = p.precoCentavos * d.qtd;
    total += subtotal;
    return '<div class="item-row">'+
      '<div class="info"><div class="nome">'+d.qtd+'x '+escapeHtml(p.nome)+'</div>'+
      (d.obs ? '<div class="obs">'+escapeHtml(d.obs)+'</div>' : '')+
      '</div>'+
      '<div class="preco">'+brl(subtotal)+'</div>'+
    '</div>';
  }).join("");
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>Revisar pedido</h2>'+
    '<div class="modal-sub">Confira os itens antes de lançar na mesa '+(mesa?mesa.numero:"?")+' e enviar para a cozinha.</div>'+
    linhasHtml+
    '<div class="totais-linha total" style="margin-top:12px;"><span>Total deste pedido</span><span>'+brl(total)+'</span></div>'+
    '<div class="action-row" style="margin-top:16px;">'+
      '<button class="btn btn-ghost" data-action="pedido-revisar-voltar">Voltar e editar</button>'+
      '<button class="btn btn-primary btn-block" data-action="pedido-revisar-confirmar">'+icon("check",16)+' Confirmar e enviar</button>'+
    '</div>'+
  '</div></div>';
}

function renderReciboModal(m){
  var comanda = m.comanda;
  if(!comanda) return "";
  return '<div class="modal-overlay"><div class="modal-box" style="text-align:center;">'+
    '<h2>Pagamento confirmado</h2><div class="modal-sub">'+comanda.codigo+' · '+brl(totaisComanda(comanda).total)+'</div>'+
    buildReciboHtml(comanda)+
    '<div class="action-row" style="margin-top:16px;">'+
      '<button class="btn" data-action="recibo-imprimir">'+icon("book",15)+' Imprimir comprovante</button>'+
      '<button class="btn btn-primary btn-block" data-action="recibo-fechar">Concluir</button>'+
    '</div>'+
  '</div></div>';
}

function renderProdutoFormModal(m){
  var editando = !!m.produtoId;
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>'+(editando?"Editar produto":"Novo produto")+'</h2>'+
    '<div class="field"><label>Nome</label><input id="pfNome" value="'+escapeHtml(m.nome)+'" placeholder="Ex: Picanha na Brasa"></div>'+
    '<div class="field"><label>Categoria</label><select id="pfCategoria">'+
      state.categorias.map(function(c){ return '<option value="'+escapeHtml(c)+'" '+(c===m.categoria?"selected":"")+'>'+escapeHtml(c)+'</option>'; }).join("")+
    '</select></div>'+
    '<div class="field"><label>Ou nova categoria</label><input id="pfNovaCategoria" placeholder="Deixe em branco para usar a de cima"></div>'+
    '<div class="field"><label>Preço (R$)</label><input id="pfPreco" type="number" min="0" step="0.01" value="'+(m.precoCentavos/100).toFixed(2)+'"></div>'+
    '<div class="action-row">'+
      '<button class="btn btn-ghost" data-action="produto-form-cancelar">Cancelar</button>'+
      '<button class="btn btn-primary btn-block" data-action="produto-form-salvar" data-produto="'+(m.produtoId||"")+'">Salvar</button>'+
    '</div>'+
  '</div></div>';
}

function renderInsumoMovModal(m){
  var insumo = state.insumos.find(function(i){ return i.id===m.insumoId; });
  var titulo = m.tipo==="ENTRADA" ? "Entrada de estoque" : "Saída de estoque";
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>'+titulo+'</h2>'+
    '<div class="field"><label>Insumo</label><select id="imInsumo">'+
      state.insumos.map(function(i){ return '<option value="'+i.id+'" '+(insumo&&i.id===insumo.id?"selected":"")+'>'+escapeHtml(i.nome)+' ('+i.unidade+')</option>'; }).join("")+
    '</select></div>'+
    '<div class="field"><label>Quantidade</label><input id="imQuantidade" type="number" min="0" step="0.01" placeholder="0"></div>'+
    '<div class="field"><label>Motivo / origem</label><textarea id="imMotivo" placeholder="Ex: compra do fornecedor, perda, ajuste de inventário"></textarea></div>'+
    '<div class="action-row">'+
      '<button class="btn btn-ghost" data-action="insumo-mov-cancelar">Cancelar</button>'+
      '<button class="btn btn-primary btn-block" data-action="insumo-mov-confirmar" data-tipo="'+m.tipo+'">Confirmar</button>'+
    '</div>'+
  '</div></div>';
}

function renderContaFormModal(m){
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>Nova conta</h2>'+
    '<div class="field"><label>Tipo</label><select id="cfTipo"><option value="PAGAR">A pagar</option><option value="RECEBER">A receber</option></select></div>'+
    '<div class="field"><label>Descrição</label><input id="cfDescricao" placeholder="Ex: Fornecedor de bebidas"></div>'+
    '<div class="field"><label>Categoria</label><input id="cfCategoria" placeholder="Ex: Insumos, Instalações, Eventos"></div>'+
    '<div class="field"><label>Valor (R$)</label><input id="cfValor" type="number" min="0" step="0.01" placeholder="0,00"></div>'+
    '<div class="field"><label>Vencimento</label><input id="cfVencimento" type="date" value="'+diasA(7)+'"></div>'+
    '<div class="action-row">'+
      '<button class="btn btn-ghost" data-action="conta-form-cancelar">Cancelar</button>'+
      '<button class="btn btn-primary btn-block" data-action="conta-form-salvar">Salvar</button>'+
    '</div>'+
  '</div></div>';
}

function renderUsuarioFormModal(m){
  var papeis = ["ADMIN","GERENTE","CAIXA","GARCOM","COZINHA"];
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>Novo usuário</h2>'+
    '<div class="field"><label>Nome</label><input id="ufNome" placeholder="Nome do funcionário"></div>'+
    '<div class="field"><label>Papel</label><select id="ufPapel">'+papeis.map(function(p){ return '<option value="'+p+'">'+p+'</option>'; }).join("")+'</select></div>'+
    '<div class="field"><label>PIN (4 dígitos)</label><input id="ufPin" maxlength="4" placeholder="Ex: 1234"></div>'+
    (m.erro ? '<div class="pin-error">'+escapeHtml(m.erro)+'</div>' : '')+
    '<div class="action-row">'+
      '<button class="btn btn-ghost" data-action="usuario-form-cancelar">Cancelar</button>'+
      '<button class="btn btn-primary btn-block" data-action="usuario-form-salvar">Salvar</button>'+
    '</div>'+
  '</div></div>';
}

function pinPadHtml(buffer, actionDigit, actionBack){
  var dots = "";
  for(var i=0;i<PIN_LEN;i++) dots += '<div class="pin-dot '+(i<buffer.length?"filled":"")+'"></div>';
  var keys = ["1","2","3","4","5","6","7","8","9","","0","back"];
  return '<div class="pin-dots">'+dots+'</div>'+
    '<div class="pinpad">'+keys.map(function(k){
      if(k==="") return '<span></span>';
      if(k==="back") return '<button data-action="'+actionBack+'">'+icon("arrowLeft",16)+'</button>';
      return '<button data-action="'+actionDigit+'" data-d="'+k+'">'+k+'</button>';
    }).join("")+'</div>';
}

function renderSupervisorModal(m){
  return '<div class="modal-overlay"><div class="modal-box" style="text-align:center;">'+
    '<h2>Autorização de supervisor</h2><div class="modal-sub">'+escapeHtml(m.motivo)+'</div>'+
    pinPadHtml(m.buffer, "supervisor-digit", "supervisor-back")+
    '<div class="pin-error">'+escapeHtml(m.error||"")+'</div>'+
    '<div style="margin-top:12px;"><button class="btn btn-ghost" data-action="supervisor-cancel">Cancelar</button></div>'+
  '</div></div>';
}

function renderCancelarItemModal(m){
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>Cancelar item?</h2>'+
    '<div class="modal-highlight">'+m.item.quantidade+'x '+escapeHtml(m.item.nome)+(m.item.observacao?' — '+escapeHtml(m.item.observacao):'')+'<br><span style="color:var(--text-muted); font-size:11.5px;">Mesa '+m.mesaNum+'</span></div>'+
    '<div class="modal-sub" style="margin-bottom:6px;">Esta ação será registrada na auditoria.</div>'+
    '<div class="field"><label>Motivo</label><textarea id="cancelarMotivoInput" data-action="cancelar-motivo" placeholder="Ex: pedido em duplicidade">'+escapeHtml(m.motivo)+'</textarea></div>'+
    '<div class="field" style="margin-bottom:6px;"><label>PIN do supervisor</label></div>'+
    pinPadHtml(m.buffer, "cancelaritem-digit", "cancelaritem-back")+
    '<div class="pin-error">'+escapeHtml(m.error||"")+'</div>'+
    '<div class="action-row"><button class="btn btn-ghost btn-block" data-action="cancelaritem-voltar">Voltar</button></div>'+
  '</div></div>';
}

function renderDescontoModal(m){
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>Aplicar desconto</h2><div class="modal-sub">Limite sem aprovação: '+limiteDescontoPct()+'%</div>'+
    '<div class="field"><label>Desconto (%)</label><input type="number" id="descontoInput" min="0" max="100" step="1" placeholder="Ex: 10"></div>'+
    '<div class="action-row">'+
      '<button class="btn btn-ghost" data-action="desconto-cancelar">Cancelar</button>'+
      '<button class="btn btn-primary btn-block" data-action="desconto-confirmar" data-comanda="'+m.comandaId+'">Aplicar</button>'+
    '</div>'+
  '</div></div>';
}

function renderPagamentoModal(m){
  var comanda = state.comandas.find(function(c){ return c.id===m.comandaId; });
  var t = totaisComanda(comanda);
  var soma = m.linhas.reduce(function(s,l){ return s+l.valorCentavos; },0);
  var restante = t.total - soma;
  var formas = ["DINHEIRO","PIX","DEBITO","CREDITO","VOUCHER","FIADO"];
  var pessoas = m.dividirPessoas||1;
  var partes = splitCentavos(t.total, pessoas);
  var temPix = m.linhas.some(function(l){ return l.forma==="PIX"; });
  var pixValor = temPix ? m.linhas.filter(function(l){ return l.forma==="PIX"; }).reduce(function(s,l){ return s+l.valorCentavos; },0) : 0;
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>Fechar conta</h2><div class="modal-sub">'+comanda.codigo+' · Total <b style="color:var(--text-primary); font-size:15px;">'+brl(t.total)+'</b></div>'+
    '<div class="field" style="display:flex; align-items:center; justify-content:space-between; gap:10px;">'+
      '<label style="margin:0;">Dividir entre</label>'+
      '<div class="qty-ctrl">'+
        '<button data-action="pagamento-dividir-menos">'+icon("minus",13)+'</button>'+
        '<span>'+pessoas+' pessoa'+(pessoas>1?"s":"")+'</span>'+
        '<button data-action="pagamento-dividir-mais">'+icon("plus",13)+'</button>'+
      '</div>'+
    '</div>'+
    (pessoas>1 ? '<div class="modal-sub" style="margin-top:0;">Cada pessoa paga '+brl(partes[partes.length-1])+
      (partes[0]!==partes[partes.length-1] ? ' ('+partes.filter(function(v){return v===partes[0];}).length+' pessoa(s) paga(m) '+brl(partes[0])+', 1 centavo a mais por causa do arredondamento)' : '')+
    '</div>' : '')+
    '<div class="pay-methods">'+formas.map(function(f){ return '<button class="pay-method-btn" data-action="pagamento-metodo" data-forma="'+f+'">'+f+'</button>'; }).join("")+'</div>'+
    (m.linhas.length ? m.linhas.map(function(l,idx){
      return '<div class="pagamento-linha"><span class="forma">'+l.forma+'</span>'+
        '<input type="number" id="payval-'+idx+'" min="0" step="0.01" value="'+(l.valorCentavos/100).toFixed(2)+'" data-action="pagamento-valor" data-idx="'+idx+'">'+
        '<button class="icon-btn" data-action="pagamento-remover" data-idx="'+idx+'" style="color:var(--danger);">'+icon("x",14)+'</button></div>';
    }).join("") : '')+
    (temPix ? '<div class="receipt-preview" style="margin:10px auto;">'+
      '<div class="center bold">PIX — '+brl(pixValor)+'</div>'+
      pixQrGridHtml(comanda.codigo+pixValor)+
      '<div class="center" style="word-break:break-all; font-size:9.5px;">'+pixCodigoSimulado(comanda,pixValor)+'</div>'+
      '<div class="center" style="color:#a00; font-size:9.5px; margin-top:4px;">SIMULAÇÃO — não processa pagamento real</div>'+
    '</div>' : '')+
    '<div class="totais-box">'+
      '<div class="totais-linha"><span>Pago até agora</span><span>'+brl(soma)+'</span></div>'+
      '<div class="totais-linha total" style="color:'+(restante>0?"var(--warning)":"var(--success)")+';"><span>'+(restante>0?"RESTANTE":"TROCO")+'</span><span>'+brl(Math.abs(restante))+'</span></div>'+
    '</div>'+
    (m.erro ? '<div class="pin-error" style="margin-top:8px;">'+escapeHtml(m.erro)+'</div>' : '')+
    '<div class="action-row">'+
      '<button class="btn btn-ghost" data-action="pagamento-cancelar">Cancelar</button>'+
      '<button class="btn btn-success btn-lg btn-block" data-action="pagamento-confirmar" '+(soma<t.total?"disabled":"")+'>Confirmar pagamento</button>'+
    '</div>'+
  '</div></div>';
}

function renderCaixaMovModal(m){
  var titulo = m.tipo==="SANGRIA" ? "Registrar sangria" : "Registrar suprimento";
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>'+titulo+'</h2><div class="modal-sub">Motivo obrigatório · gera comprovante</div>'+
    '<div class="field"><label>Valor</label><input type="number" id="movValorInput" min="0" step="0.01" placeholder="0,00"></div>'+
    '<div class="field"><label>Motivo</label><textarea id="movMotivoInput" placeholder="Descreva o motivo"></textarea></div>'+
    '<div class="action-row">'+
      '<button class="btn btn-ghost" data-action="caixa-mov-cancelar">Cancelar</button>'+
      '<button class="btn btn-primary btn-block" data-action="caixa-mov-confirmar" data-tipo="'+m.tipo+'">Confirmar</button>'+
    '</div>'+
  '</div></div>';
}

function renderCaixaFecharModal(m){
  var formas = formasDaSessao();
  if(m.stage==="concluido"){
    var sessao = state.caixaSessoesHistorico[state.caixaSessoesHistorico.length-1];
    var cls2 = sessao.diferencaCentavos===0 ? "zero" : (sessao.diferencaCentavos>0 ? "pos" : "neg");
    return '<div class="modal-overlay"><div class="modal-box" style="text-align:center;">'+
      '<h2>Caixa fechado</h2>'+
      '<div class="diff-box '+cls2+'"><div class="lbl">Diferença final</div><div class="valor">'+brl(sessao.diferencaCentavos||0)+'</div></div>'+
      '<div class="action-row">'+
        '<button class="btn" data-action="fechamento-imprimir" data-sessao="'+sessao.id+'">'+icon("book",15)+' Imprimir relatório</button>'+
        '<button class="btn btn-primary btn-block" data-action="caixa-fechar-ok">Concluir</button>'+
      '</div>'+
    '</div></div>';
  }
  if(!m.stage || m.stage==="contar"){
    return '<div class="modal-overlay"><div class="modal-box">'+
      '<h2>Conferência de caixa</h2><div class="modal-sub">Informe os valores contados. Os valores esperados só aparecem depois de confirmar.</div>'+
      formas.map(function(f){
        return '<div class="field"><label>'+f+'</label><input type="number" min="0" step="0.01" placeholder="0,00" data-action="fechar-informado" data-forma="'+f+'"></div>';
      }).join("")+
      '<div class="action-row">'+
        '<button class="btn btn-ghost" data-action="caixa-fechar-cancelar">Cancelar</button>'+
        '<button class="btn btn-primary btn-block" data-action="caixa-fechar-informar">Conferir caixa</button>'+
      '</div>'+
    '</div></div>';
  }
  var esperados = {}; var diffs = {};
  formas.forEach(function(f){ esperados[f]=esperadoPorForma(f); diffs[f]=(m.informados[f]||0)-esperados[f]; });
  var diferencaDinheiro = diffs.DINHEIRO||0;
  var cls = diferencaDinheiro===0 ? "zero" : (diferencaDinheiro>0 ? "pos" : "neg");
  var precisaJustificar = Math.abs(diferencaDinheiro) > limiteDiferencaCentavos();
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>Resultado do fechamento</h2>'+
    '<div style="overflow-x:auto;"><table class="recon-table"><tr><th></th><th>Esperado</th><th>Informado</th><th>Diferença</th></tr>'+
    formas.map(function(f){
      var d = diffs[f]; var dcls = d===0?"zero":(d>0?"pos":"neg");
      return '<tr><td>'+f+'</td><td>'+brl(esperados[f])+'</td><td>'+brl(m.informados[f]||0)+'</td><td class="'+dcls+'">'+brl(d)+'</td></tr>';
    }).join("")+'</table></div>'+
    '<div class="diff-box '+cls+'"><div class="lbl">Diferença em dinheiro</div><div class="valor">'+brl(diferencaDinheiro)+'</div></div>'+
    (precisaJustificar ?
      '<div class="modal-sub" style="color:var(--danger);">Diferença acima do limite de '+brl(limiteDiferencaCentavos())+'. Justifique para confirmar.</div>'+
      '<div class="field"><label>Justificativa</label><textarea id="justificativaInput" placeholder="Explique a diferença"></textarea></div>'+
      '<div class="action-row">'+
        '<button class="btn btn-ghost" data-action="caixa-fechar-cancelar">Cancelar</button>'+
        '<button class="btn btn-danger btn-block" data-action="caixa-fechar-justificar-confirmar">Confirmar mesmo assim</button>'+
      '</div>'
      :
      '<div class="action-row">'+
        '<button class="btn btn-ghost" data-action="caixa-fechar-cancelar">Cancelar</button>'+
        '<button class="btn btn-primary btn-block" data-action="caixa-fechar-confirmar-final">Confirmar fechamento</button>'+
      '</div>'
    )+
  '</div></div>';
}

