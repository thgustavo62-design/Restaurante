"use strict";

// ---------- mapeamento snake_case (Supabase) <-> camelCase (app) ----------
function mapProduto(row, catNomePorId){
  return {id:row.id, nome:row.nome, categoria:(catNomePorId&&catNomePorId[row.categoria_id])||"", categoriaId:row.categoria_id, precoCentavos:row.preco_centavos, ativo:row.ativo, esgotado:row.esgotado,
    setorProducao:row.setor_producao||"COZINHA", fotoUrl:row.foto_url||"", precoHappyHourCentavos:row.preco_happy_hour_centavos};
}
function mapInsumo(row){
  return {id:row.id, nome:row.nome, unidade:row.unidade, estoqueAtual:Number(row.estoque_atual), estoqueMinimo:Number(row.estoque_minimo), custoMedioCentavos:row.custo_medio_centavos, validade:row.validade||null};
}
function mapMesa(row){
  return {id:row.id, numero:row.numero, capacidade:row.capacidade, area:row.area};
}
function mapComanda(row){
  return {id:row.id, codigo:row.codigo, mesaId:row.mesa_id, tipo:row.tipo, status:row.status,
    abertura:row.abertura, fechamento:row.fechamento, usuarioAbertura:row.usuario_abertura,
    taxaServicoAtiva:row.taxa_servico_ativa, descontoCentavos:row.desconto_centavos,
    trocoCentavos:row.troco_centavos, fichaNumero:row.ficha_numero, totalCentavos:row.total_centavos,
    updatedAt:row.updated_at, clienteId:row.cliente_id||null, pessoas:row.pessoas||null,
    enderecoEntrega:row.endereco_entrega||"", statusEntregador:row.status_entregador||null,
    taxaEntregaCentavos:row.taxa_entrega_centavos||0, agendadoPara:row.agendado_para||null,
    itens:[], pagamentos:[]};
}
function mapItem(row){
  return {id:row.id, comandaId:row.comanda_id, produtoId:row.produto_id, nome:row.nome, observacao:row.observacao||"",
    quantidade:Number(row.quantidade), precoUnitCentavos:row.preco_unit_centavos, status:row.status,
    usuarioId:row.usuario_id, enviadoEm:row.enviado_em, canceladoAposPreparo:!!row.cancelado_apos_preparo,
    motivoCancelamento:row.motivo_cancelamento||"", setorProducao:row.setor_producao||"", pagoEm:row.pago_em||null,
    opcoesSelecionadas:(row.opcoes_selecionadas||[]).map(function(o){
      return {opcaoId:o.opcao_id, nome:o.nome, precoAdicionalCentavos:o.preco_adicional_centavos};
    })};
}
function mapGrupoOpcoes(row){
  return {id:row.id, produtoId:row.produto_id, nome:row.nome, obrigatorio:row.obrigatorio,
    minimo:row.minimo, maximo:row.maximo, ordem:row.ordem};
}
function mapOpcao(row){
  return {id:row.id, grupoId:row.grupo_id, nome:row.nome, precoAdicionalCentavos:row.preco_adicional_centavos,
    ordem:row.ordem, ativo:row.ativo};
}
function mapCaixaSessao(row){
  return {id:row.id, terminal:row.terminal, usuarioAbertura:row.usuario_abertura, aberturaEm:row.abertura_em,
    saldoInicialCentavos:row.saldo_inicial_centavos, usuarioFechamento:row.usuario_fechamento,
    fechamentoEm:row.fechamento_em, saldoCalculadoCentavos:row.saldo_calculado_centavos,
    saldoInformadoCentavos:row.saldo_informado_centavos, diferencaCentavos:row.diferenca_centavos,
    fechamentoDetalhe:row.fechamento_detalhe, status:row.status};
}
function mapMovimento(row){
  return {id:row.id, sessaoId:row.sessao_id, tipo:row.tipo, valorCentavos:row.valor_centavos,
    formaPagamento:row.forma_pagamento, comandaId:row.comanda_id, usuarioId:row.usuario_id,
    motivo:row.motivo, createdAt:row.created_at};
}
function mapConta(row){
  return {id:row.id, tipo:row.tipo, descricao:row.descricao, categoria:row.categoria,
    valorCentavos:row.valor_centavos, vencimento:row.vencimento, pagoEm:row.pago_em};
}
function mapUsuario(row){
  return {id:row.id, nome:row.nome, papel:row.papel, ativo:row.ativo};
}
function mapEstoqueMov(row){
  return {id:row.id, insumoId:row.insumo_id, tipo:row.tipo, quantidade:Number(row.quantidade),
    motivo:row.motivo, origem:row.origem, origemId:row.origem_id, usuarioId:row.usuario_id, createdAt:row.created_at};
}
function mapRendimento(row){
  return {id:row.id, insumoId:row.insumo_id, fator:Number(row.fator), observacao:row.observacao||"",
    medidoEm:row.medido_em, usuarioId:row.usuario_id};
}
function mapFornecedor(row){
  return {id:row.id, nome:row.nome, contato:row.contato||"", telefone:row.telefone||"", ativo:row.ativo};
}
function mapPedidoCompra(row){
  return {id:row.id, fornecedorId:row.fornecedor_id, status:row.status, usuarioId:row.usuario_id,
    recebidoEm:row.recebido_em, createdAt:row.created_at, itens:[]};
}
function mapPedidoCompraItem(row){
  return {id:row.id, pedidoId:row.pedido_id, insumoId:row.insumo_id, quantidade:Number(row.quantidade),
    custoUnitCentavos:row.custo_unit_centavos};
}
function mapPedidoQr(row){
  return {id:row.id, mesaId:row.mesa_id, itens:row.itens||[], observacao:row.observacao||"",
    status:row.status, motivoRejeicao:row.motivo_rejeicao||"", comandaId:row.comanda_id, createdAt:row.created_at};
}
function mapCliente(row){
  return {id:row.id, nome:row.nome, telefone:row.telefone||"", aniversario:row.aniversario||"",
    observacoes:row.observacoes||"", consentimentoLgpd:!!row.consentimento_lgpd, consentimentoEm:row.consentimento_em,
    pontosFidelidade:row.pontos_fidelidade||0, endereco:row.endereco||"", bairro:row.bairro||""};
}
function mapCupom(row){
  return {id:row.id, codigo:row.codigo, tipo:row.tipo, valor:row.valor,
    validoDe:row.valido_de, validoAte:row.valido_ate,
    usosMax:row.usos_max, usosAtuais:row.usos_atuais||0, ativo:!!row.ativo, createdAt:row.created_at};
}
function mapAuditoria(row){
  return {id:row.id, entidade:row.entidade, entidadeId:row.entidade_id, acao:row.acao,
    usuarioId:row.usuario_id, motivo:row.motivo, createdAt:row.created_at};
}

function decodeJwt(token){
  try{
    var payload = token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
    while(payload.length % 4) payload += "=";
    return JSON.parse(atob(payload));
  }catch(e){ return {}; }
}
