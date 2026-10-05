"use strict";

// ---------- mapeamento snake_case (Supabase) <-> camelCase (app) ----------
function mapProduto(row, catNomePorId, catTempoPorId){
  return {id:row.id, nome:row.nome, categoria:(catNomePorId&&catNomePorId[row.categoria_id])||"", categoriaId:row.categoria_id, precoCentavos:row.preco_centavos, ativo:row.ativo, esgotado:row.esgotado,
    setorProducao:row.setor_producao||"COZINHA", fotoUrl:row.foto_url||"", precoHappyHourCentavos:row.preco_happy_hour_centavos,
    tempo:(catTempoPorId&&catTempoPorId[row.categoria_id])||"PRINCIPAL"};
}
function mapInsumo(row){
  return {id:row.id, nome:row.nome, unidade:row.unidade, estoqueAtual:Number(row.estoque_atual), estoqueMinimo:Number(row.estoque_minimo), custoMedioCentavos:row.custo_medio_centavos, validade:row.validade||null, ehSubReceita:!!row.eh_sub_receita, fornecedorPadraoId:row.fornecedor_padrao_id||null};
}
// PRIORIDADE 2 — ficha técnica de sub-receita (insumo produzido a partir
// de outros insumos) — mesmo formato de mapFichaTecnica, insumo→insumo.
function mapFichaTecnicaInsumo(row){
  return {insumoProduzidoId:row.insumo_produzido_id, insumoIngredienteId:row.insumo_ingrediente_id, quantidade:Number(row.quantidade)};
}
function mapPerda(row){
  return {id:row.id, tipo:row.tipo, insumoId:row.insumo_id, produtoId:row.produto_id, comandaItemId:row.comanda_item_id,
    quantidade:Number(row.quantidade), motivo:row.motivo, valorCentavos:row.valor_centavos, usuarioId:row.usuario_id,
    diaOperacional:row.dia_operacional, createdAt:row.created_at};
}
function mapPrePreparoItem(it){
  return {id:it.id, insumoId:it.insumo_id, nome:it.nome, unidade:it.unidade, ehSubReceita:!!it.eh_sub_receita,
    quantidadeSugerida:Number(it.quantidade_sugerida), feitoEm:it.feito_em||null, feitoPorNome:it.feito_por_nome||null};
}
function mapMesa(row){
  return {id:row.id, numero:row.numero, capacidade:row.capacidade, area:row.area, qrToken:row.qr_token};
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
    iniciadoEm:row.iniciado_em||null, prontoEm:row.pronto_em||null, entregueEm:row.entregue_em||null,
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
  return {id:row.id, nome:row.nome, papel:row.papel, ativo:row.ativo, pesoRateioTaxa:row.peso_rateio_taxa!=null?Number(row.peso_rateio_taxa):1};
}
// PRIORIDADE 5 — Controle de Equipe
function mapEscala(row){
  return {id:row.id, usuarioId:row.usuario_id, diaSemana:row.dia_semana, turnoInicio:row.turno_inicio, turnoFim:row.turno_fim, tipo:row.tipo};
}
function mapPonto(row){
  return {id:row.id, usuarioId:row.usuario_id, tipo:row.tipo, registradoEm:row.registrado_em,
    corrigido:!!row.corrigido, corrigidoPor:row.corrigido_por, motivoCorrecao:row.motivo_correcao};
}
function mapRemuneracao(row){
  return {usuarioId:row.usuario_id, tipo:row.tipo, valorCentavos:row.valor_centavos, updatedAt:row.updated_at};
}
// PRIORIDADE 8 — Reservas / Fila de espera.
function mapReserva(row){
  return {id:row.id, nome:row.nome, telefone:row.telefone, pessoas:row.pessoas, dataHora:row.data_hora,
    observacao:row.observacao||"", mesaSugeridaId:row.mesa_sugerida_id, status:row.status,
    clienteId:row.cliente_id, comandaId:row.comanda_id};
}
function mapFilaEntrada(row){
  return {id:row.id, nome:row.nome, telefone:row.telefone, pessoas:row.pessoas, status:row.status,
    createdAt:row.created_at, posicao:row.posicao, tempo_estimado_min:row.tempo_estimado_min};
}
function mapDespesaRecorrente(row){
  return {id:row.id, descricao:row.descricao, categoria:row.categoria, valorCentavos:row.valor_centavos,
    diaVencimento:row.dia_vencimento, ativo:row.ativo};
}
function mapVale(row){
  return {id:row.id, usuarioId:row.usuario_id, valorCentavos:row.valor_centavos, motivo:row.motivo, data:row.data, usuarioLancouId:row.usuario_lancou_id, createdAt:row.created_at};
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
  return {id:row.id, nome:row.nome, contato:row.contato||"", telefone:row.telefone||"", ativo:row.ativo,
    prazoEntregaDias:row.prazo_entrega_dias||null, diaEntregaSemana:row.dia_entrega_semana};
}
function mapPedidoCompra(row){
  return {id:row.id, fornecedorId:row.fornecedor_id, status:row.status, usuarioId:row.usuario_id,
    recebidoEm:row.recebido_em, createdAt:row.created_at, itens:[]};
}
function mapPedidoCompraItem(row){
  return {id:row.id, pedidoId:row.pedido_id, insumoId:row.insumo_id, quantidade:Number(row.quantidade),
    custoUnitCentavos:row.custo_unit_centavos,
    quantidadeRecebida:row.quantidade_recebida!=null?Number(row.quantidade_recebida):null,
    precoUnitRecebidoCentavos:row.preco_unit_recebido_centavos};
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
function mapSyncConflito(row){
  return {id:row.id, comandaId:row.comanda_id, tipo:row.tipo, payload:row.payload, motivo:row.motivo,
    status:row.status, createdAt:row.created_at};
}
function mapAuditoria(row){
  return {id:row.id, entidade:row.entidade, entidadeId:row.entidade_id, acao:row.acao,
    usuarioId:row.usuario_id, motivo:row.motivo, createdAt:row.created_at};
}
// PRIORIDADE 1 — resposta da RPC central_do_dono(), já agregada no banco;
// só reempacota snake_case -> camelCase, nenhum cálculo financeiro aqui.
function mapCentralDono(d){
  return {
    diaOperacional: d.dia_operacional,
    hoje: {
      faturamentoCentavos: d.hoje.faturamento_centavos, vendas: d.hoje.vendas, ticketMedioCentavos: d.hoje.ticket_medio_centavos,
      faturamentoSemanaPassadaCentavos: d.hoje.faturamento_semana_passada_centavos,
      vendasSemanaPassada: d.hoje.vendas_semana_passada, ticketMedioSemanaPassadaCentavos: d.hoje.ticket_medio_semana_passada_centavos,
      variacaoFaturamentoPct: d.hoje.variacao_faturamento_pct, variacaoVendasPct: d.hoje.variacao_vendas_pct, variacaoTicketPct: d.hoje.variacao_ticket_pct,
      projecaoFechamentoCentavos: d.hoje.projecao_fechamento_centavos
    },
    mes: {
      faturamentoCentavos: d.mes.faturamento_centavos, cmvCentavos: d.mes.cmv_centavos, perdasCentavos: d.mes.perdas_centavos,
      despesasCentavos: d.mes.despesas_centavos, custoEquipeCentavos: d.mes.custo_equipe_centavos, custoEquipeDisponivel: d.mes.custo_equipe_disponivel,
      podeVerResultado: d.mes.pode_ver_resultado, resultadoCentavos: d.mes.resultado_centavos,
      contasAPagarPendentesCentavos: d.mes.contas_a_pagar_pendentes_centavos, faltaParaCobrirContasCentavos: d.mes.falta_para_cobrir_contas_centavos
    },
    semaforos: {
      cmvPct: d.semaforos.cmv_pct, perdasPctFaturamento: d.semaforos.perdas_pct_faturamento,
      custoEquipePct: d.semaforos.custo_equipe_pct, custoEquipeDisponivel: d.semaforos.custo_equipe_disponivel,
      diferencaCaixaCentavosMes: d.semaforos.diferenca_caixa_centavos_mes,
      metas: {
        cmvPct: d.semaforos.metas.cmv_pct, perdasPctFaturamento: d.semaforos.metas.perdas_pct_faturamento,
        custoEquipePct: d.semaforos.metas.custo_equipe_pct, diferencaCaixaCentavosMes: d.semaforos.metas.diferenca_caixa_centavos_mes
      }
    },
    atencao: (d.atencao||[]).map(function(a){
      return {tipo:a.tipo, gravidade:a.gravidade, view:a.view, qtd:a.qtd, valorCentavos:a.valor_centavos, media:a.media};
    }),
    salao: {
      mesasTotal: d.salao.mesas_total, mesasOcupadas: d.salao.mesas_ocupadas,
      pedidosAtrasadosCozinha: d.salao.pedidos_atrasados_cozinha, caixasAbertos: d.salao.caixas_abertos
    }
  };
}

function decodeJwt(token){
  try{
    var payload = token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
    while(payload.length % 4) payload += "=";
    return JSON.parse(atob(payload));
  }catch(e){ return {}; }
}
