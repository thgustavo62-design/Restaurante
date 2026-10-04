"use strict";

function renderModal(){
  var m = state.modal;
  if(m.type==="supervisorRpc") return renderSupervisorRpcModal(m);
  if(m.type==="cancelarItem") return renderCancelarItemModal(m);
  if(m.type==="desconto") return renderDescontoModal(m);
  if(m.type==="pagamento") return renderPagamentoModal(m);
  if(m.type==="caixaMov") return renderCaixaMovModal(m);
  if(m.type==="caixaFechar") return renderCaixaFecharModal(m);
  if(m.type==="produtoForm") return renderProdutoFormModal(m);
  if(m.type==="insumoMov") return renderInsumoMovModal(m);
  if(m.type==="rendimento") return renderRendimentoModal(m);
  if(m.type==="contaForm") return renderContaFormModal(m);
  if(m.type==="usuarioForm") return renderUsuarioFormModal(m);
  if(m.type==="trocarPin") return renderTrocarPinModal(m);
  if(m.type==="fornecedorForm") return renderFornecedorFormModal(m);
  if(m.type==="pedidoCompraForm") return renderPedidoCompraFormModal(m);
  if(m.type==="recibo") return renderReciboModal(m);
  if(m.type==="revisarPedido") return renderRevisarPedidoModal(m);
  if(m.type==="confirmarLogout") return renderConfirmarLogoutModal(m);
  if(m.type==="transferirItem") return renderTransferirItemModal(m);
  if(m.type==="transferirMesa") return renderTransferirMesaModal(m);
  if(m.type==="juntarMesas") return renderJuntarMesasModal(m);
  if(m.type==="opcoesPedido") return renderOpcoesPedidoModal(m);
  if(m.type==="opcoesProduto") return renderOpcoesProdutoModal(m);
  if(m.type==="inventario") return renderInventarioModal(m);
  if(m.type==="novoDelivery") return renderNovoDeliveryModal(m);
  if(m.type==="mfaSetup") return renderMfaSetupModal(m);
  if(m.type==="clienteForm") return renderClienteFormModal(m);
  if(m.type==="cupomForm") return renderCupomFormModal(m);
  return "";
}

// Fase 3.7 — novo delivery: escolhe cliente (endereço/bairro vêm do
// cadastro, mas dá pra ajustar só pra esta entrega), taxa sugerida pelo
// bairro configurado em Configurações, editável à mão.
function renderNovoDeliveryModal(m){
  if(m.escolhendoCliente){
    var busca = (m.buscaCliente||"").toLowerCase();
    var lista = state.clientes.filter(function(c){ return !busca || c.nome.toLowerCase().indexOf(busca)!==-1; });
    return '<div class="modal-overlay"><div class="modal-box">'+
      '<h2>Delivery — escolher cliente</h2>'+
      '<div class="search-box">'+icon("search",16)+'<input placeholder="Buscar cliente..." value="'+escapeHtml(m.buscaCliente||"")+'" data-action="delivery-cliente-busca"></div>'+
      '<div style="max-height:40vh; overflow-y:auto; margin-top:8px;">'+
      (lista.length ? lista.map(function(c){
        return '<div class="item" data-action="delivery-cliente-escolher" data-cliente="'+c.id+'" style="cursor:pointer;"><div>'+escapeHtml(c.nome)+'</div></div>';
      }).join("") : '<div class="empty-hint">Nenhum cliente encontrado. Cadastre um na tela Clientes primeiro.</div>')+
      '</div>'+
      '<div class="action-row" style="margin-top:14px;"><button class="btn btn-ghost btn-block" data-action="delivery-cliente-voltar">Voltar</button></div>'+
    '</div></div>';
  }
  var cliente = m.clienteId ? state.clientes.find(function(c){ return c.id===m.clienteId; }) : null;
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>Novo delivery</h2>'+
    '<div class="field"><label>Cliente</label>'+
      (cliente ? '<div class="item" style="padding:10px 0;"><div>'+escapeHtml(cliente.nome)+'</div><button class="btn btn-sm" data-action="delivery-cliente-trocar">Trocar</button></div>'
       : '<button class="btn btn-block" data-action="delivery-cliente-trocar">Escolher cliente</button>')+
    '</div>'+
    '<div class="field"><label>Endereço</label><input id="dlvEndereco" value="'+escapeHtml(m.endereco||"")+'" placeholder="Rua, número, complemento"></div>'+
    '<div class="field"><label>Bairro</label><input id="dlvBairro" value="'+escapeHtml(m.bairro||"")+'" data-action="delivery-bairro" placeholder="Pra sugerir a taxa"></div>'+
    '<div class="field"><label>Taxa de entrega (R$)</label><input id="dlvTaxa" type="number" min="0" step="0.01" value="'+(m.taxaEntregaCentavos/100).toFixed(2)+'"></div>'+
    '<div class="field" style="margin-bottom:0;"><label>Agendar para (opcional)</label><input id="dlvAgendado" type="datetime-local" value="'+(m.agendadoPara||"")+'"></div>'+
    (m.erro ? '<div class="pin-error">'+escapeHtml(m.erro)+'</div>' : '')+
    '<div class="action-row">'+
      '<button class="btn btn-ghost" data-action="delivery-cancelar">Cancelar</button>'+
      '<button class="btn btn-primary btn-block" data-action="delivery-confirmar" '+(cliente?"":"disabled")+'>Abrir delivery</button>'+
    '</div>'+
  '</div></div>';
}

// Fase 4.3 — ativar verificação em duas etapas (TOTP nativo do Supabase
// Auth, sem provedor externo). Escaneia o QR com Google Authenticator/
// Authy/etc, confirma com o código de 6 dígitos pra provar que configurou
// certo antes de considerar ativado.
function renderMfaSetupModal(m){
  return '<div class="modal-overlay"><div class="modal-box" style="text-align:center;">'+
    '<h2>Ativar verificação em duas etapas</h2>'+
    '<div class="modal-sub">Escaneie com Google Authenticator, Authy ou outro app TOTP</div>'+
    '<img src="'+m.qrCode+'" alt="QR code" style="width:180px; height:180px; margin:10px auto; display:block; background:#fff; padding:8px; border-radius:8px;">'+
    '<div class="modal-sub" style="word-break:break-all; font-size:10.5px;">Ou digite manualmente: '+escapeHtml(m.secret)+'</div>'+
    '<div class="field" style="text-align:left; margin-top:14px;"><label>Código de 6 dígitos</label><input id="mfaCodigoInput" inputmode="numeric" maxlength="6" placeholder="000000" value="'+escapeHtml(m.codigo||"")+'"></div>'+
    (m.erro ? '<div class="pin-error">'+escapeHtml(m.erro)+'</div>' : '')+
    '<div class="action-row">'+
      '<button class="btn btn-ghost" data-action="mfa-setup-cancelar">Cancelar</button>'+
      '<button class="btn btn-primary btn-block" data-action="mfa-setup-confirmar">Ativar</button>'+
    '</div>'+
  '</div></div>';
}

// Fase 2.7 — cadastro de cliente (CRM básico), com consentimento LGPD
// explícito antes de guardar telefone/observações.
function renderClienteFormModal(m){
  var editando = !!m.clienteId;
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>'+(editando?"Editar cliente":"Novo cliente")+'</h2>'+
    '<div class="field"><label>Nome</label><input id="clNome" value="'+escapeHtml(m.nome)+'" placeholder="Nome do cliente"></div>'+
    '<div class="field"><label>Telefone</label><input id="clTelefone" value="'+escapeHtml(m.telefone)+'" placeholder="(00) 00000-0000"></div>'+
    '<div class="field"><label>Aniversário</label><input id="clAniversario" type="date" value="'+(m.aniversario||"")+'"></div>'+
    '<div class="field"><label>Endereço</label><input id="clEndereco" value="'+escapeHtml(m.endereco||"")+'" placeholder="Rua, número"></div>'+
    '<div class="field"><label>Bairro</label><input id="clBairro" value="'+escapeHtml(m.bairro||"")+'" placeholder="Pra taxa de entrega automática"></div>'+
    '<div class="field"><label>Observações</label><textarea id="clObservacoes" placeholder="Preferências, restrições, etc.">'+escapeHtml(m.observacoes)+'</textarea></div>'+
    '<label style="display:flex; align-items:flex-start; gap:8px; font-size:12px; color:var(--text-secondary); margin-bottom:10px;">'+
      '<input type="checkbox" id="clConsentimento" '+(m.consentimentoLgpd?"checked":"")+' style="margin-top:2px;">'+
      '<span>O cliente autorizou guardar esses dados de contato (LGPD).</span>'+
    '</label>'+
    (m.erro ? '<div class="pin-error">'+escapeHtml(m.erro)+'</div>' : '')+
    '<div class="action-row">'+
      '<button class="btn btn-ghost" data-action="cliente-form-cancelar">Cancelar</button>'+
      '<button class="btn btn-primary btn-block" data-action="cliente-form-salvar" '+(m.salvando?"disabled":"")+'>Salvar</button>'+
    '</div>'+
  '</div></div>';
}

// Fase 5 — cupom de desconto. codigo é sempre salvo em maiúsculas (a
// comparação no servidor já ignora caixa via upper(), mas padronizar aqui
// evita "promo10" vs "PROMO10" parecerem cupons diferentes na listagem).
function renderCupomFormModal(m){
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>Novo cupom</h2>'+
    '<div class="field"><label>Código</label><input id="cupCodigo" value="'+escapeHtml(m.codigo||"")+'" placeholder="Ex: BEMVINDO10" style="text-transform:uppercase;"></div>'+
    '<div class="field"><label>Tipo de desconto</label><select id="cupTipo">'+
      '<option value="PERCENTUAL" '+(m.tipo!=="VALOR_FIXO"?"selected":"")+'>Percentual (%)</option>'+
      '<option value="VALOR_FIXO" '+(m.tipo==="VALOR_FIXO"?"selected":"")+'>Valor fixo (R$)</option>'+
    '</select></div>'+
    '<div class="field"><label>Valor</label><input id="cupValor" type="number" min="1" step="0.01" placeholder="Ex: 10" value="'+(m.valorInput||"")+'"></div>'+
    '<div class="field"><label>Válido de (opcional)</label><input id="cupValidoDe" type="date" value="'+(m.validoDe||"")+'"></div>'+
    '<div class="field"><label>Válido até (opcional)</label><input id="cupValidoAte" type="date" value="'+(m.validoAte||"")+'"></div>'+
    '<div class="field"><label>Limite de usos (opcional)</label><input id="cupUsosMax" type="number" min="1" value="'+(m.usosMax||"")+'"></div>'+
    (m.erro ? '<div class="pin-error">'+escapeHtml(m.erro)+'</div>' : '')+
    '<div class="action-row">'+
      '<button class="btn btn-ghost" data-action="cupom-form-cancelar">Cancelar</button>'+
      '<button class="btn btn-primary btn-block" data-action="cupom-form-salvar" '+(m.salvando?"disabled":"")+'>Salvar</button>'+
    '</div>'+
  '</div></div>';
}

// escolha de cliente pro fiado fica DENTRO do próprio modal de pagamento
// (mesmo m, troca só o conteúdo) — stackar um modal por cima do outro não
// existe no app (state.modal é um slot só), então isso evita perder o que
// já tinha sido preenchido no pagamento ao abrir o seletor de cliente.
function renderEscolherClienteFiadoInline(m){
  var busca = (m.buscaCliente||"").toLowerCase();
  var lista = state.clientes.filter(function(c){ return !busca || c.nome.toLowerCase().indexOf(busca)!==-1; });
  return '<h2>Fiado — escolher cliente</h2>'+
    '<div class="modal-sub">Fiado agora é sempre vinculado a um cliente cadastrado.</div>'+
    '<div class="search-box">'+icon("search",16)+'<input placeholder="Buscar cliente..." value="'+escapeHtml(m.buscaCliente||"")+'" data-action="pagamento-cliente-busca"></div>'+
    '<div style="max-height:40vh; overflow-y:auto; margin-top:8px;">'+
    (lista.length ? lista.map(function(c){
      return '<div class="item" data-action="pagamento-cliente-escolher" data-cliente="'+c.id+'" style="cursor:pointer;">'+
        '<div>'+escapeHtml(c.nome)+'</div></div>';
    }).join("") : '<div class="empty-hint">Nenhum cliente encontrado. Cadastre um na tela Clientes primeiro.</div>')+
    '</div>'+
    '<div class="action-row" style="margin-top:14px;">'+
      '<button class="btn btn-ghost btn-block" data-action="pagamento-cliente-voltar">Voltar</button>'+
    '</div>';
}

// Fase 2.6 — inventário: conta física de todos os insumos de uma vez,
// gera um ajuste (perda ou sobra) só pra quem mudou (registrar_inventario,
// 0054). Pré-preenchido com o valor do sistema — só precisa mexer no que
// realmente diverge da contagem.
function renderInventarioModal(m){
  return '<div class="modal-overlay"><div class="modal-box" style="max-width:480px;">'+
    '<h2>Inventário</h2>'+
    '<div class="modal-sub">Confira a contagem física de cada insumo. Só gera ajuste no que for diferente do sistema.</div>'+
    '<div style="max-height:50vh; overflow-y:auto;">'+
    state.insumos.map(function(i){
      return '<div class="field" style="display:flex; align-items:center; justify-content:space-between; gap:10px;">'+
        '<label style="margin:0; flex:1;">'+escapeHtml(i.nome)+' <span style="color:var(--text-muted);">('+i.unidade+', sistema: '+i.estoqueAtual+')</span></label>'+
        '<input id="invContado-'+i.id+'" type="number" min="0" step="0.01" value="'+i.estoqueAtual+'" style="width:110px;">'+
      '</div>';
    }).join("")+
    '</div>'+
    (m.erro ? '<div class="pin-error">'+escapeHtml(m.erro)+'</div>' : '')+
    '<div class="action-row" style="margin-top:14px;">'+
      '<button class="btn btn-ghost" data-action="inventario-cancelar">Cancelar</button>'+
      '<button class="btn btn-primary btn-block" data-action="inventario-confirmar" '+(m.salvando?"disabled":"")+'>Confirmar inventário</button>'+
    '</div>'+
  '</div></div>';
}

// Fase 1.3 — gestão de grupos/opções de um produto (tela Cardápio).
function renderOpcoesProdutoModal(m){
  var p = state.produtos.find(function(x){ return x.id===m.produtoId; });
  var grupos = gruposComInativasDoProduto(m.produtoId);
  return '<div class="modal-overlay"><div class="modal-box" style="max-width:520px;">'+
    '<h2>Opções — '+escapeHtml(p.nome)+'</h2>'+
    '<div class="modal-sub">Perguntas obrigatórias (ex: ponto da carne) e adicionais opcionais (ex: bacon) — aparecem no lançamento do pedido, no KDS, no recibo e no cardápio público.</div>'+
    grupos.map(function(g){
      return '<div class="card" style="padding:12px; margin-bottom:10px;">'+
        '<div style="display:flex; justify-content:space-between; align-items:center;">'+
          '<div><b>'+escapeHtml(g.grupo.nome)+'</b> '+(g.grupo.obrigatorio?'<span class="badge badge-status-info">OBRIGATÓRIO · '+g.grupo.minimo+'-'+g.grupo.maximo+'</span>':'<span class="badge">OPCIONAL · até '+g.grupo.maximo+'</span>')+'</div>'+
          '<button class="icon-btn" data-action="grupo-opcoes-remover" data-grupo="'+g.grupo.id+'" style="color:var(--danger);">'+icon("trash",14)+'</button>'+
        '</div>'+
        (g.opcoes.length ? g.opcoes.map(function(o){
          return '<div class="pagamento-linha"><span class="forma">'+escapeHtml(o.nome)+(o.precoAdicionalCentavos>0?' +'+brl(o.precoAdicionalCentavos):'')+(!o.ativo?' (inativa)':'')+'</span>'+
            '<button class="btn btn-sm" data-action="opcao-toggle-ativa" data-opcao="'+o.id+'">'+(o.ativo?"Desativar":"Reativar")+'</button>'+
            '<button class="icon-btn" data-action="opcao-remover" data-opcao="'+o.id+'" style="color:var(--danger);">'+icon("x",14)+'</button></div>';
        }).join("") : '<div class="empty-hint">Nenhuma opção ainda.</div>')+
        '<div style="display:flex; gap:8px; margin-top:8px;">'+
          '<input id="novaOpcaoNome-'+g.grupo.id+'" placeholder="Nome (ex: Bacon)" style="flex:2;">'+
          '<input id="novaOpcaoPreco-'+g.grupo.id+'" type="number" min="0" step="0.01" placeholder="+R$" style="flex:1;">'+
          '<button class="btn btn-sm" data-action="opcao-criar" data-grupo="'+g.grupo.id+'">'+icon("plus",14)+'</button>'+
        '</div>'+
      '</div>';
    }).join("")+
    '<div class="card" style="padding:12px;">'+
      '<div class="card-title" style="margin-bottom:8px;">Novo grupo de opções</div>'+
      '<div class="field"><label>Nome (ex: Ponto da carne, Adicionais)</label><input id="novoGrupoNome" placeholder="Nome do grupo"></div>'+
      '<div style="display:flex; gap:8px; align-items:flex-end;">'+
        '<label style="display:flex; align-items:center; gap:6px; font-size:12.5px;"><input type="checkbox" id="novoGrupoObrigatorio"> Obrigatório</label>'+
        '<div class="field" style="flex:1; margin-bottom:0;"><label>Mínimo</label><input id="novoGrupoMinimo" type="number" min="0" step="1" value="1"></div>'+
        '<div class="field" style="flex:1; margin-bottom:0;"><label>Máximo</label><input id="novoGrupoMaximo" type="number" min="1" step="1" value="1"></div>'+
      '</div>'+
      '<button class="btn btn-block" style="margin-top:10px;" data-action="grupo-opcoes-criar" data-produto="'+m.produtoId+'">'+icon("plus",15)+' Criar grupo</button>'+
    '</div>'+
    (m.erro ? '<div class="pin-error">'+escapeHtml(m.erro)+'</div>' : '')+
    '<div class="action-row" style="margin-top:14px;">'+
      '<button class="btn btn-primary btn-block" data-action="opcoesproduto-fechar">Concluir</button>'+
    '</div>'+
  '</div></div>';
}

// Fase 1.3 — perguntas e adicionais: escolher as opções de um produto
// antes de entrar no pedido (grupos obrigatórios bloqueiam confirmar sem
// escolher o mínimo — a trava real é o trigger no banco, 0051; aqui só
// evita a viagem ao servidor pra descobrir isso).
function renderOpcoesPedidoModal(m){
  var p = state.produtos.find(function(x){ return x.id===m.produtoId; });
  var grupos = gruposDoProduto(m.produtoId);
  var adicional = 0;
  grupos.forEach(function(g){
    (m.selecionadas[g.grupo.id]||[]).forEach(function(oid){
      var o = g.opcoes.find(function(x){ return x.id===oid; });
      if(o) adicional += o.precoAdicionalCentavos;
    });
  });
  var precoUnit = p.precoCentavos + adicional;
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>'+escapeHtml(p.nome)+'</h2>'+
    grupos.map(function(g){
      var sel = m.selecionadas[g.grupo.id]||[];
      return '<div class="field"><label>'+escapeHtml(g.grupo.nome)+
        (g.grupo.obrigatorio?' <span style="color:var(--danger);">*</span>':'')+
        ' <span style="color:var(--text-muted); font-weight:400;">('+(g.grupo.maximo>1?('até '+g.grupo.maximo):'escolha 1')+')</span></label>'+
        '<div class="ingrediente-chips">'+g.opcoes.map(function(o){
          var ativo = sel.indexOf(o.id)!==-1;
          return '<button type="button" class="ingrediente-chip '+(ativo?"ativo":"")+'" data-action="opcoespedido-toggle" data-grupo="'+g.grupo.id+'" data-opcao="'+o.id+'" data-max="'+g.grupo.maximo+'">'+
            escapeHtml(o.nome)+(o.precoAdicionalCentavos>0?' +'+brl(o.precoAdicionalCentavos):'')+
          '</button>';
        }).join("")+'</div></div>';
    }).join("")+
    '<div class="field" style="display:flex; align-items:center; justify-content:space-between; gap:10px;">'+
      '<label style="margin:0;">Quantidade</label>'+
      '<div class="qty-ctrl">'+
        '<button data-action="opcoespedido-qtd-menos">'+icon("minus",13)+'</button>'+
        '<span>'+m.qtd+'</span>'+
        '<button data-action="opcoespedido-qtd-mais">'+icon("plus",13)+'</button>'+
      '</div>'+
    '</div>'+
    '<textarea id="opcoesPedidoObs" data-action="opcoespedido-obs" placeholder="Observação extra">'+escapeHtml(m.obs)+'</textarea>'+
    (m.erro ? '<div class="pin-error">'+escapeHtml(m.erro)+'</div>' : '')+
    '<div class="totais-linha total" style="margin-top:10px;"><span>Preço unitário</span><span>'+brl(precoUnit)+'</span></div>'+
    '<div class="action-row">'+
      '<button class="btn btn-ghost" data-action="opcoespedido-cancelar">Cancelar</button>'+
      '<button class="btn btn-primary btn-block" data-action="opcoespedido-confirmar">Adicionar · '+brl(precoUnit*m.qtd)+'</button>'+
    '</div>'+
  '</div></div>';
}

// Fase 1.1 — transferir item, transferir comanda de mesa, juntar mesas.
// As três RPCs (transferir_item/transferir_comanda/juntar_comandas, 0048)
// fazem a validação real; o modal só escolhe o destino.

function renderTransferirItemModal(m){
  var destinos = state.comandas.filter(function(c){ return c.status==="ABERTA" && c.id!==m.comandaOrigemId; });
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>Transferir item</h2>'+
    '<div class="modal-highlight">'+m.item.quantidade+'x '+escapeHtml(m.item.nome)+'</div>'+
    '<div class="field"><label>Para qual comanda?</label><select id="transferirItemDestino">'+
      (destinos.length ? destinos.map(function(c){
        var mesa = state.mesas.find(function(mm){ return mm.id===c.mesaId; });
        return '<option value="'+c.id+'">'+escapeHtml(rotuloComanda(c, mesa))+' · '+c.codigo+'</option>';
      }).join("") : '<option value="">Nenhuma outra comanda aberta</option>')+
    '</select></div>'+
    (m.erro ? '<div class="pin-error">'+escapeHtml(m.erro)+'</div>' : '')+
    '<div class="action-row">'+
      '<button class="btn btn-ghost" data-action="transferiritem-cancelar">Cancelar</button>'+
      '<button class="btn btn-primary btn-block" data-action="transferiritem-confirmar" '+(destinos.length?"":"disabled")+'>Transferir</button>'+
    '</div>'+
  '</div></div>';
}

function renderTransferirMesaModal(m){
  var mesasLivres = state.mesas.filter(function(mm){ return mm.id!==m.mesaOrigemId && mesaStatus(mm.id)==="livre"; });
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>Transferir para outra mesa</h2>'+
    '<div class="modal-sub">A comanda inteira muda de mesa.</div>'+
    '<div class="field"><label>Mesa de destino</label><select id="transferirMesaDestino">'+
      (mesasLivres.length ? mesasLivres.map(function(mm){
        return '<option value="'+mm.id+'">Mesa '+mm.numero+' ('+mm.capacidade+' lugares)</option>';
      }).join("") : '<option value="">Nenhuma mesa livre</option>')+
    '</select></div>'+
    (m.erro ? '<div class="pin-error">'+escapeHtml(m.erro)+'</div>' : '')+
    '<div class="action-row">'+
      '<button class="btn btn-ghost" data-action="transferirmesa-cancelar">Cancelar</button>'+
      '<button class="btn btn-primary btn-block" data-action="transferirmesa-confirmar" '+(mesasLivres.length?"":"disabled")+'>Transferir</button>'+
    '</div>'+
  '</div></div>';
}

function renderJuntarMesasModal(m){
  var destinos = state.comandas.filter(function(c){ return c.status==="ABERTA" && c.id!==m.comandaOrigemId; });
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>Juntar com outra mesa</h2>'+
    '<div class="modal-sub" style="color:var(--danger);">Todos os itens desta comanda passam para a comanda escolhida, e esta fecha. Não dá pra desfazer.</div>'+
    '<div class="field"><label>Juntar nesta comanda</label><select id="juntarMesasDestino">'+
      (destinos.length ? destinos.map(function(c){
        var mesa = state.mesas.find(function(mm){ return mm.id===c.mesaId; });
        return '<option value="'+c.id+'">'+escapeHtml(rotuloComanda(c, mesa))+' · '+c.codigo+'</option>';
      }).join("") : '<option value="">Nenhuma outra comanda aberta</option>')+
    '</select></div>'+
    (m.erro ? '<div class="pin-error">'+escapeHtml(m.erro)+'</div>' : '')+
    '<div class="action-row">'+
      '<button class="btn btn-ghost" data-action="juntarmesas-cancelar">Cancelar</button>'+
      '<button class="btn btn-danger btn-block" data-action="juntarmesas-confirmar" '+(destinos.length?"":"disabled")+'>Juntar</button>'+
    '</div>'+
  '</div></div>';
}

function renderConfirmarLogoutModal(m){
  return '<div class="modal-overlay"><div class="modal-box" style="text-align:center;">'+
    '<h2>Sair do sistema?</h2>'+
    (m.temDraft ?
      '<div class="modal-sub" style="color:var(--danger);">Você tem itens não enviados no pedido em andamento. Eles serão perdidos.</div>' :
      '<div class="modal-sub">Você precisará informar o PIN de novo para entrar.</div>')+
    '<div class="action-row" style="margin-top:16px;">'+
      '<button class="btn btn-ghost" data-action="logout-cancelar">Cancelar</button>'+
      '<button class="btn btn-danger btn-block" data-action="logout-confirmar">'+icon("door",16)+' Sair</button>'+
    '</div>'+
  '</div></div>';
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
    var obsFinal = draftObsFinal(pid, d);
    return '<div class="item-row">'+
      '<div class="info"><div class="nome">'+d.qtd+'x '+escapeHtml(p.nome)+'</div>'+
      (obsFinal ? '<div class="obs">'+escapeHtml(obsFinal)+'</div>' : '')+
      '</div>'+
      '<div class="preco">'+brl(subtotal)+'</div>'+
    '</div>';
  }).join("");
  linhasHtml += (state.draft.itensComOpcoes||[]).map(function(l){
    var p = state.produtos.find(function(x){ return x.id===l.produtoId; });
    var adicional = l.opcoesSelecionadas.reduce(function(s,o){ return s+o.precoAdicionalCentavos; },0);
    var subtotal = (p.precoCentavos+adicional) * l.qtd;
    total += subtotal;
    var desc = l.opcoesSelecionadas.map(function(o){ return o.nome; }).join(" + ")+(l.obs?" · "+l.obs:"");
    return '<div class="item-row">'+
      '<div class="info"><div class="nome">'+l.qtd+'x '+escapeHtml(p.nome)+'</div>'+
      (desc ? '<div class="obs">'+escapeHtml(desc)+'</div>' : '')+
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
    '<div class="field"><label>Preço happy hour (R$, opcional)</label><input id="pfPrecoHappyHour" type="number" min="0" step="0.01" value="'+(m.precoHappyHourCentavos!=null?(m.precoHappyHourCentavos/100).toFixed(2):"")+'" placeholder="Deixe em branco pra não ter preço especial"></div>'+
    '<div class="field"><label>Setor de produção (KDS)</label><select id="pfSetorProducao">'+
      SETORES_PRODUCAO.map(function(s){ return '<option value="'+s+'" '+(s===m.setorProducao?"selected":"")+'>'+s+'</option>'; }).join("")+
    '</select></div>'+
    '<div class="field" style="margin-bottom:0;"><label>Foto do produto (URL)</label><input id="pfFotoUrl" value="'+escapeHtml(m.fotoUrl||"")+'" placeholder="https://..."></div>'+
    (m.fotoUrl ? '<img src="'+escapeHtml(m.fotoUrl)+'" style="width:100%; max-height:140px; object-fit:cover; border-radius:6px; margin-top:10px;" onerror="this.style.display=\'none\'">' : '')+
    '<div class="action-row" style="margin-top:14px;">'+
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

function renderFornecedorFormModal(m){
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>Novo fornecedor</h2>'+
    '<div class="field"><label>Nome</label><input id="fnNome" placeholder="Ex: Distribuidora Boi Bom"></div>'+
    '<div class="field"><label>Contato</label><input id="fnContato" placeholder="Nome do representante"></div>'+
    '<div class="field" style="margin-bottom:0;"><label>Telefone</label><input id="fnTelefone" placeholder="(00) 00000-0000"></div>'+
    (m.erro ? '<div class="pin-error">'+escapeHtml(m.erro)+'</div>' : '')+
    '<div class="action-row" style="margin-top:14px;">'+
      '<button class="btn btn-ghost" data-action="fornecedor-form-cancelar">Cancelar</button>'+
      '<button class="btn btn-primary btn-block" data-action="fornecedor-form-salvar">Salvar</button>'+
    '</div>'+
  '</div></div>';
}

function renderPedidoCompraFormModal(m){
  var totalItens = m.itens.length;
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>Novo pedido de compra</h2>'+
    '<div class="field"><label>Fornecedor</label><select id="pcFornecedor" data-action="pedido-compra-fornecedor">'+
      state.fornecedores.filter(function(f){ return f.ativo; }).map(function(f){
        return '<option value="'+f.id+'" '+(f.id===m.fornecedorId?"selected":"")+'>'+escapeHtml(f.nome)+'</option>';
      }).join("")+
    '</select></div>'+
    '<div class="card" style="padding:12px; margin-bottom:10px;">'+
      '<div class="field"><label>Insumo</label><select id="pcInsumo">'+
        state.insumos.map(function(i){ return '<option value="'+i.id+'">'+escapeHtml(i.nome)+' ('+i.unidade+')</option>'; }).join("")+
      '</select></div>'+
      '<div style="display:flex; gap:10px;">'+
        '<div class="field" style="flex:1;"><label>Quantidade</label><input id="pcQuantidade" type="number" min="0" step="0.01" placeholder="0"></div>'+
        '<div class="field" style="flex:1; margin-bottom:0;"><label>Custo unit. (R$, opcional)</label><input id="pcCustoUnit" type="number" min="0" step="0.01" placeholder="0,00"></div>'+
      '</div>'+
      '<button type="button" class="btn btn-block" data-action="pedido-compra-item-add">'+icon("plus",15)+' Adicionar item</button>'+
    '</div>'+
    (totalItens ? m.itens.map(function(it, idx){
      var insumo = state.insumos.find(function(i){ return i.id===it.insumoId; });
      return '<div class="pagamento-linha"><span class="forma">'+(insumo?escapeHtml(insumo.nome):"?")+' — '+it.quantidade+(insumo?" "+insumo.unidade:"")+
        (it.custoUnitCentavos!=null?' · '+brl(it.custoUnitCentavos)+'/un':'')+'</span>'+
        '<button class="icon-btn" data-action="pedido-compra-item-remover" data-idx="'+idx+'" style="color:var(--danger);">'+icon("x",14)+'</button></div>';
    }).join("") : '<div class="empty-hint">Nenhum item adicionado ainda.</div>')+
    (m.erro ? '<div class="pin-error" style="margin-top:8px;">'+escapeHtml(m.erro)+'</div>' : '')+
    '<div class="action-row" style="margin-top:14px;">'+
      '<button class="btn btn-ghost" data-action="pedido-compra-form-cancelar">Cancelar</button>'+
      '<button class="btn btn-primary btn-block" data-action="pedido-compra-criar" '+(totalItens===0||m.salvando?"disabled":"")+'>Criar pedido</button>'+
    '</div>'+
  '</div></div>';
}

function renderRendimentoModal(m){
  var insumo = state.insumos.find(function(i){ return i.id===m.insumoId; });
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>Rendimento — '+escapeHtml(insumo?insumo.nome:"")+'</h2>'+
    '<div class="modal-sub">Percentual do insumo que efetivamente sobra depois do preparo/perda (ex: limpeza, corte, cozimento).</div>'+
    '<div class="field"><label>Rendimento (%)</label><input id="rdFator" type="number" min="1" max="100" step="1" value="'+(m.fatorAtual!=null?Math.round(m.fatorAtual*100):"")+'" placeholder="Ex: 85"></div>'+
    '<div class="field"><label>Observação</label><textarea id="rdObservacao" placeholder="Ex: medido em 20 unidades, perda de aparas">'+escapeHtml(m.observacaoAtual||"")+'</textarea></div>'+
    (m.erro ? '<div class="pin-error">'+escapeHtml(m.erro)+'</div>' : '')+
    '<div class="action-row">'+
      '<button class="btn btn-ghost" data-action="rendimento-cancelar">Cancelar</button>'+
      '<button class="btn btn-primary btn-block" data-action="rendimento-confirmar" data-insumo="'+m.insumoId+'">Salvar medição</button>'+
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

function renderTrocarPinModal(m){
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>Trocar PIN — '+escapeHtml(m.nome)+'</h2>'+
    '<div class="modal-sub">O funcionário passa a entrar com o novo PIN imediatamente.</div>'+
    '<div class="field"><label>Novo PIN (4 dígitos)</label><input id="tpNovoPin" maxlength="4" inputmode="numeric" placeholder="Ex: 1234"></div>'+
    '<div class="field"><label>Confirmar novo PIN</label><input id="tpConfirmarPin" maxlength="4" inputmode="numeric" placeholder="Repita o PIN"></div>'+
    (m.erro ? '<div class="pin-error">'+escapeHtml(m.erro)+'</div>' : '')+
    '<div class="action-row">'+
      '<button class="btn btn-ghost" data-action="trocarpin-cancelar">Cancelar</button>'+
      '<button class="btn btn-primary btn-block" data-action="trocarpin-confirmar" data-usuario="'+m.usuarioId+'" '+(m.salvando?"disabled":"")+'>Salvar novo PIN</button>'+
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

function selectSupervisorHtml(permissao, supervisorId, dataAction){
  var candidatos = candidatosSupervisor(permissao);
  if(!candidatos.length){
    return '<div class="pin-error">Nenhum usuário ativo tem essa permissão.</div>';
  }
  return '<div class="field" style="text-align:left;"><label>Supervisor</label><select data-action="'+dataAction+'">'+
    candidatos.map(function(u){ return '<option value="'+u.id+'" '+(supervisorId===u.id?"selected":"")+'>'+escapeHtml(u.nome)+' ('+u.papel+')</option>'; }).join("")+
  '</select></div>';
}

function renderSupervisorRpcModal(m){
  return '<div class="modal-overlay"><div class="modal-box" style="text-align:center;">'+
    '<h2>Autorização de supervisor</h2><div class="modal-sub">'+escapeHtml(m.motivo)+'</div>'+
    selectSupervisorHtml(m.permissao, m.supervisorId, "supervisor-rpc-select")+
    pinPadHtml(m.buffer, "supervisor-rpc-digit", "supervisor-rpc-back")+
    '<div class="pin-error">'+escapeHtml(m.error||"")+'</div>'+
    '<div style="margin-top:12px;"><button class="btn btn-ghost" data-action="supervisor-rpc-cancel">Cancelar</button></div>'+
  '</div></div>';
}

function renderCancelarItemModal(m){
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>Cancelar item?</h2>'+
    '<div class="modal-highlight">'+m.item.quantidade+'x '+escapeHtml(m.item.nome)+(m.item.observacao?' — '+escapeHtml(m.item.observacao):'')+'<br><span style="color:var(--text-muted); font-size:11.5px;">Mesa '+m.mesaNum+'</span></div>'+
    '<div class="modal-sub" style="margin-bottom:6px;">Esta ação será registrada na auditoria.</div>'+
    '<div class="field"><label>Motivo</label><textarea id="cancelarMotivoInput" data-action="cancelar-motivo" placeholder="Ex: pedido em duplicidade">'+escapeHtml(m.motivo)+'</textarea></div>'+
    selectSupervisorHtml(PERM.ITEM_CANCELAR, m.supervisorId, "cancelaritem-supervisor")+
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
  if(m.escolhendoCliente){
    return '<div class="modal-overlay"><div class="modal-box">'+renderEscolherClienteFiadoInline(m)+'</div></div>';
  }
  var modo = m.modo||"pessoas";
  var naoPagos = itensNaoPagos(comanda);
  var t = modo==="itens" ? totaisNaoPagos(comanda, m.itensSelecionados) : totaisNaoPagos(comanda);
  var temFiado = m.linhas.some(function(l){ return l.forma==="FIADO"; });
  // Fase 3.6 — fidelidade: cliente é opcional em qualquer pagamento (ganha
  // pontos), só vira obrigatório se tiver linha FIADO. Resgate de pontos
  // só no modo "pessoas" (fechar tudo de uma vez), mesma trava do server.
  var clienteEscolhido = m.fiadoClienteId ? state.clientes.find(function(c){ return c.id===m.fiadoClienteId; }) : null;
  var valorPontoCentavos = (state.config.fidelidade&&state.config.fidelidade.valorPontoCentavos)||0;
  var saldoPontos = clienteEscolhido ? clienteEscolhido.pontosFidelidade : 0;
  var maxPontosUteis = (modo==="pessoas" && valorPontoCentavos>0) ? Math.min(saldoPontos, Math.ceil(t.total/valorPontoCentavos)) : 0;
  var pontosResgatados = Math.min(m.pontosResgatados||0, maxPontosUteis);
  var descontoPontos = pontosResgatados*valorPontoCentavos;
  var totalFinal = Math.max(0, t.total - descontoPontos);
  var soma = m.linhas.reduce(function(s,l){ return s+l.valorCentavos; },0);
  var restante = totalFinal - soma;
  var formas = ["DINHEIRO","PIX","DEBITO","CREDITO","VOUCHER","FIADO"];
  var pessoas = m.dividirPessoas||1;
  var partes = splitCentavos(totalFinal, pessoas);
  var temPix = m.linhas.some(function(l){ return l.forma==="PIX"; });
  var pixValor = temPix ? m.linhas.filter(function(l){ return l.forma==="PIX"; }).reduce(function(s,l){ return s+l.valorCentavos; },0) : 0;
  var itensChecklistHtml = naoPagos.map(function(it){
    var marcado = !!m.itensSelecionados[it.id];
    return '<label class="item-row" style="cursor:pointer;">'+
      '<input type="checkbox" data-action="pagamento-item-toggle" data-item="'+it.id+'" '+(marcado?"checked":"")+' style="margin-right:10px;">'+
      '<div class="info"><div class="nome">'+it.quantidade+'x '+escapeHtml(it.nome)+'</div></div>'+
      '<div class="preco">'+brl(it.precoUnitCentavos*it.quantidade)+'</div>'+
    '</label>';
  }).join("");
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>Fechar conta</h2><div class="modal-sub">'+comanda.codigo+' · '+
      (naoPagos.length<comanda.itens.filter(function(i){return i.status!=="CANCELADO";}).length ? 'Falta pagar ' : 'Total ')+
      '<b style="color:var(--text-primary); font-size:15px;">'+brl(totalFinal)+'</b>'+
      (descontoPontos>0 ? ' <span style="color:var(--success); font-size:11.5px;">(-'+brl(descontoPontos)+' em pontos)</span>' : '')+
    '</div>'+
    '<div class="tabs" style="margin-bottom:12px;">'+
      '<div class="tab '+(modo==="pessoas"?"active":"")+'" data-action="pagamento-modo" data-modo="pessoas">Dividir por pessoas</div>'+
      '<div class="tab '+(modo==="itens"?"active":"")+'" data-action="pagamento-modo" data-modo="itens">Dividir por item</div>'+
    '</div>'+
    (modo==="itens" ? itensChecklistHtml+'<div style="height:10px;"></div>' :
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
      '</div>' : ''))+
    '<div class="pay-methods">'+formas.map(function(f){ return '<button class="pay-method-btn" data-action="pagamento-metodo" data-forma="'+f+'">'+f+'</button>'; }).join("")+'</div>'+
    (m.linhas.length ? m.linhas.map(function(l,idx){
      return '<div class="pagamento-linha"><span class="forma">'+l.forma+'</span>'+
        '<input type="number" id="payval-'+idx+'" min="0" step="0.01" value="'+(l.valorCentavos/100).toFixed(2)+'" data-action="pagamento-valor" data-idx="'+idx+'">'+
        '<button class="icon-btn" data-action="pagamento-remover" data-idx="'+idx+'" style="color:var(--danger);">'+icon("x",14)+'</button></div>';
    }).join("") : '')+
    '<div class="field"><label>Cliente'+(temFiado?' (obrigatório pro fiado)':' (opcional — pontos de fidelidade)')+'</label>'+
      (clienteEscolhido ? '<div class="item" style="padding:10px 0;"><div>'+escapeHtml(clienteEscolhido.nome)+
          (valorPontoCentavos>0 ? ' <span style="color:var(--text-muted); font-size:11px;">· '+saldoPontos+' ponto(s)</span>' : '')+'</div>'+
        '<button class="btn btn-sm" data-action="pagamento-cliente-trocar">Trocar</button></div>'
       : '<button class="btn btn-block" data-action="pagamento-cliente-trocar">Escolher cliente</button>')+
    '</div>'+
    (clienteEscolhido && maxPontosUteis>0 ? '<div class="field"><label>Usar pontos (até '+maxPontosUteis+', vale '+brl(valorPontoCentavos)+' cada)</label>'+
      '<input type="number" min="0" max="'+maxPontosUteis+'" step="1" value="'+pontosResgatados+'" data-action="pagamento-pontos">'+
    '</div>' : '')+
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
      '<button class="btn btn-success btn-lg btn-block" data-action="pagamento-confirmar" '+((t.total===0 || soma<totalFinal || (temFiado && !m.fiadoClienteId))?"disabled":"")+'>Confirmar pagamento</button>'+
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
      '<h2>Conferência de caixa</h2><div class="modal-sub">Informe os valores contados. O esperado é calculado no servidor e só aparece depois de confirmar.</div>'+
      formas.map(function(f){
        return '<div class="field"><label>'+f+'</label><input type="number" min="0" step="0.01" placeholder="0,00" data-action="fechar-informado" data-forma="'+f+'"></div>';
      }).join("")+
      (m.erro ? '<div class="pin-error">'+escapeHtml(m.erro)+'</div>' : '')+
      '<div class="action-row">'+
        '<button class="btn btn-ghost" data-action="caixa-fechar-cancelar">Cancelar</button>'+
        '<button class="btn btn-primary btn-block" data-action="caixa-fechar-informar" '+(m.conferindo?"disabled":"")+'>Conferir caixa</button>'+
      '</div>'+
    '</div></div>';
  }
  // stage === "resultado" — vem do RPC conferir_fechamento_caixa, nada calculado no client
  var r = m.resultado;
  var diferencaDinheiro = r.diferenca_dinheiro;
  var cls = diferencaDinheiro===0 ? "zero" : (diferencaDinheiro>0 ? "pos" : "neg");
  var precisaJustificar = r.precisa_justificativa;
  return '<div class="modal-overlay"><div class="modal-box">'+
    '<h2>Resultado do fechamento</h2>'+
    '<div style="overflow-x:auto;"><table class="recon-table"><tr><th></th><th>Esperado</th><th>Informado</th><th>Diferença</th></tr>'+
    formas.map(function(f){
      var d = (r.diffs[f]||0); var dcls = d===0?"zero":(d>0?"pos":"neg");
      return '<tr><td>'+f+'</td><td>'+brl(r.esperados[f]||0)+'</td><td>'+brl(r.informados[f]||0)+'</td><td class="'+dcls+'">'+brl(d)+'</td></tr>';
    }).join("")+'</table></div>'+
    '<div class="diff-box '+cls+'"><div class="lbl">Diferença em dinheiro</div><div class="valor">'+brl(diferencaDinheiro)+'</div></div>'+
    (m.erro ? '<div class="pin-error">'+escapeHtml(m.erro)+'</div>' : '')+
    (precisaJustificar ?
      '<div class="modal-sub" style="color:var(--danger);">Diferença acima do limite tolerado. Justifique para confirmar.</div>'+
      '<div class="field"><label>Justificativa</label><textarea id="justificativaInput" placeholder="Explique a diferença"></textarea></div>'+
      '<div class="action-row">'+
        '<button class="btn btn-ghost" data-action="caixa-fechar-cancelar">Cancelar</button>'+
        '<button class="btn btn-danger btn-block" data-action="caixa-fechar-justificar-confirmar" '+(m.fechando?"disabled":"")+'>Confirmar mesmo assim</button>'+
      '</div>'
      :
      '<div class="action-row">'+
        '<button class="btn btn-ghost" data-action="caixa-fechar-cancelar">Cancelar</button>'+
        '<button class="btn btn-primary btn-block" data-action="caixa-fechar-confirmar-final" '+(m.fechando?"disabled":"")+'>Confirmar fechamento</button>'+
      '</div>'
    )+
  '</div></div>';
}

