"use strict";

// ---------- mapeamento snake_case (Supabase) <-> camelCase (app) ----------
function mapProduto(row, catNomePorId){
  return {id:row.id, nome:row.nome, categoria:(catNomePorId&&catNomePorId[row.categoria_id])||"", categoriaId:row.categoria_id, precoCentavos:row.preco_centavos, ativo:row.ativo, esgotado:row.esgotado};
}
function mapInsumo(row){
  return {id:row.id, nome:row.nome, unidade:row.unidade, estoqueAtual:Number(row.estoque_atual), estoqueMinimo:Number(row.estoque_minimo), custoMedioCentavos:row.custo_medio_centavos};
}
function mapMesa(row){
  return {id:row.id, numero:row.numero, capacidade:row.capacidade, area:row.area};
}
function mapComanda(row){
  return {id:row.id, codigo:row.codigo, mesaId:row.mesa_id, tipo:row.tipo, status:row.status,
    abertura:row.abertura, fechamento:row.fechamento, usuarioAbertura:row.usuario_abertura,
    taxaServicoAtiva:row.taxa_servico_ativa, descontoCentavos:row.desconto_centavos,
    trocoCentavos:row.troco_centavos, itens:[], pagamentos:[]};
}
function mapItem(row){
  return {id:row.id, comandaId:row.comanda_id, produtoId:row.produto_id, nome:row.nome, observacao:row.observacao||"",
    quantidade:Number(row.quantidade), precoUnitCentavos:row.preco_unit_centavos, status:row.status,
    usuarioId:row.usuario_id, enviadoEm:row.enviado_em, canceladoAposPreparo:!!row.cancelado_apos_preparo};
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
