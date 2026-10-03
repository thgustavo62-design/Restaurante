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
    restauranteSlug:null,
    restauranteSlugInput:"",
    restauranteSlugErro:"",
    loginSelectedUserId:null,
    pinBuffer:"",
    pinError:"",
    loginTentativas:0,
    loginBloqueadoAte:null,
    sidebarCollapsed:false,
    sidebarMobileAberto:false,
    salaoFiltro:"TODAS",
    cardapioFiltro:"Todos",
    financeiroFiltro:"TODAS",
    relatorioPeriodo:"HOJE",
    kdsSetorFiltro:"TODOS",
    auditoriaBusca:"",
    auditoriaFiltroUsuario:"TODOS",
    auditoriaFiltroAcao:"TODAS",
    draft:null,
    carregando:false,
    usuariosLogin:[],
    config:{
      empresaNome:"", empresaCnpj:"", taxaServicoPctPadrao:10, limiteDescontoPct:10,
      limiteDiferencaCentavos:500, limiteAlertaSangriaCentavos:100000, impressoraLargura:"80mm", reciboRodape:"",
      horarioAbertura:"18:00", horarioFechamento:"00:00", chavePix:"", totalFichas:50, slug:""
    },
    usuarios:[], categorias:[], categoriaIdPorNome:{}, produtos:[], mesas:[],
    insumos:[], fichaTecnica:[], estoqueMovimentos:[], contas:[], insumoRendimentos:[],
    fornecedores:[], pedidosCompra:[],
    comandas:[], caixaSessao:null, caixaMovimentos:[], caixaSessoesHistorico:[], auditoria:[],
    kdsItensAvulsos:[],
    vendasHoje:[],
    relatorioResultado:null, relatorioCarregando:false, relatorioMes:""
  };
}
