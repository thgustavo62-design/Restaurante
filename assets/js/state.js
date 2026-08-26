"use strict";

function estadoVazio(){
  return {
    usuarioAtualId:null,
    empresaId:null,
    view:"dashboard",
    viewParams:{},
    modal:null,
    toasts:[],
    printHtml:null,
    loginSelectedUserId:null,
    pinBuffer:"",
    pinError:"",
    sidebarCollapsed:false,
    sidebarMobileAberto:false,
    salaoFiltro:"TODAS",
    cardapioFiltro:"Todos",
    financeiroFiltro:"TODAS",
    relatorioPeriodo:"HOJE",
    draft:null,
    carregando:false,
    usuariosLogin:[],
    config:{
      empresaNome:"", empresaCnpj:"", taxaServicoPctPadrao:10, limiteDescontoPct:10,
      limiteDiferencaCentavos:500, limiteAlertaSangriaCentavos:100000, impressoraLargura:"80mm", reciboRodape:"",
      horarioAbertura:"18:00", horarioFechamento:"00:00", chavePix:""
    },
    usuarios:[], categorias:[], categoriaIdPorNome:{}, produtos:[], mesas:[],
    insumos:[], fichaTecnica:[], estoqueMovimentos:[], contas:[],
    comandas:[], caixaSessao:null, caixaMovimentos:[], caixaSessoesHistorico:[], auditoria:[]
  };
}
