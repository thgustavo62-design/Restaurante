"use strict";

var SUPABASE_URL = "https://ybsyhjqtwiwomtxbloyu.supabase.co";
var SUPABASE_KEY = "sb_publishable_35oPPu0kJ7Da0LtintHzOw_MO_n1oN3";
var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: true },
  db: { schema: "restaurante" }
});

// 0.10 — toda falha de RPC vira um log em restaurante.erros_cliente, sem
// precisar tocar nos ~40 call sites de sb.rpc(...) espalhados pelo app.
// Promise.resolve(builder) consome o builder (thenable do postgrest-js)
// exatamente UMA vez e devolve uma Promise nativa de verdade — segura
// pra ser "then"ada de novo aqui E no call site original sem disparar a
// requisição duas vezes (o perigo real de só encadear .then() direto no
// builder, que reexecutaria a chamada a cada .then()).
(function interceptarFalhasRpc(){
  var rpcOriginal = sb.rpc.bind(sb);
  sb.rpc = function(nome, params, opts){
    var builder = rpcOriginal(nome, params, opts);
    var promise = Promise.resolve(builder);
    promise.then(function(res){
      // nunca loga falha do próprio registrar_erro_cliente — evitaria um
      // loop (log que falha chamando log de novo) sem ganhar nada.
      if(res && res.error && nome!=="registrar_erro_cliente" && typeof registrarErroClienteSilencioso==="function"){
        registrarErroClienteSilencioso("rpc:"+nome, res.error.message);
      }
    });
    return promise;
  };
})();
var PIN_LEN = 4;
var INGREDIENTES_COMUNS = ["Cebola","Tomate","Alface","Pimenta","Molho","Maionese","Coentro","Alho","Queijo","Bacon"];
var FORMAS_RECEBIVEL = ["FIADO","CREDITO","VOUCHER"];
var VIRADA_DIA_OPERACIONAL_HORA = 5;
function limiteDescontoPct(){ return state.config.limiteDescontoPct; }
function limiteDiferencaCentavos(){ return state.config.limiteDiferencaCentavos; }

var PERM = {
  SALAO_VER:"atendimento.salao.ver",
  COMANDA_ABRIR:"atendimento.comanda.abrir",
  ITEM_LANCAR:"atendimento.comanda.item.lancar",
  ITEM_CANCELAR:"atendimento.comanda.item.cancelar",
  DESCONTO_APLICAR:"atendimento.comanda.desconto.aplicar",
  COMANDA_TRANSFERIR:"atendimento.comanda.transferir",
  COMANDA_REABRIR:"atendimento.comanda.reabrir",
  COMANDA_FECHAR:"atendimento.comanda.fechar",
  KDS_VER:"cozinha.kds.ver",
  ITEM_STATUS:"cozinha.item.atualizar_status",
  CAIXA_ABRIR:"caixa.sessao.abrir",
  CAIXA_FECHAR:"caixa.sessao.fechar",
  SANGRIA:"caixa.movimento.sangria",
  SUPRIMENTO:"caixa.movimento.suprimento",
  PAGAMENTO:"caixa.pagamento.registrar",
  AUDITORIA_VER:"auditoria.ver",
  CARDAPIO:"admin.cardapio.editar",
  ESTOQUE:"admin.estoque.editar",
  EQUIPE:"admin.equipe.editar",
  FINANCEIRO:"admin.financeiro.ver",
  FINANCEIRO_EDITAR:"admin.financeiro.editar",
  RELATORIOS:"admin.relatorios.ver",
  CONFIGURACOES:"admin.configuracoes.editar",
  CLIENTES:"admin.clientes.editar",
  MARKETING:"admin.marketing.editar",
  SYNC_CONFLITOS:"admin.sync_conflitos.resolver",
  CENTRAL_DONO:"admin.central_dono.ver",
  EQUIPE_CUSTOS:"admin.equipe.custos.ver"
};

var MATRIZ = {
  ADMIN:[PERM.SALAO_VER,PERM.COMANDA_ABRIR,PERM.ITEM_LANCAR,PERM.ITEM_CANCELAR,PERM.DESCONTO_APLICAR,PERM.COMANDA_TRANSFERIR,PERM.COMANDA_REABRIR,PERM.COMANDA_FECHAR,PERM.KDS_VER,PERM.ITEM_STATUS,PERM.CAIXA_ABRIR,PERM.CAIXA_FECHAR,PERM.SANGRIA,PERM.SUPRIMENTO,PERM.PAGAMENTO,PERM.AUDITORIA_VER,PERM.CARDAPIO,PERM.ESTOQUE,PERM.EQUIPE,PERM.FINANCEIRO,PERM.FINANCEIRO_EDITAR,PERM.RELATORIOS,PERM.CONFIGURACOES,PERM.CLIENTES,PERM.MARKETING,PERM.SYNC_CONFLITOS,PERM.CENTRAL_DONO,PERM.EQUIPE_CUSTOS],
  GERENTE:[PERM.SALAO_VER,PERM.COMANDA_ABRIR,PERM.ITEM_LANCAR,PERM.ITEM_CANCELAR,PERM.DESCONTO_APLICAR,PERM.COMANDA_TRANSFERIR,PERM.COMANDA_REABRIR,PERM.COMANDA_FECHAR,PERM.KDS_VER,PERM.ITEM_STATUS,PERM.CAIXA_ABRIR,PERM.CAIXA_FECHAR,PERM.SANGRIA,PERM.SUPRIMENTO,PERM.PAGAMENTO,PERM.AUDITORIA_VER,PERM.CARDAPIO,PERM.ESTOQUE,PERM.EQUIPE,PERM.FINANCEIRO,PERM.FINANCEIRO_EDITAR,PERM.RELATORIOS,PERM.CLIENTES,PERM.MARKETING,PERM.SYNC_CONFLITOS,PERM.CENTRAL_DONO],
  CAIXA:[PERM.SALAO_VER,PERM.COMANDA_ABRIR,PERM.ITEM_LANCAR,PERM.COMANDA_FECHAR,PERM.CAIXA_ABRIR,PERM.CAIXA_FECHAR,PERM.SANGRIA,PERM.SUPRIMENTO,PERM.PAGAMENTO],
  GARCOM:[PERM.SALAO_VER,PERM.COMANDA_ABRIR,PERM.ITEM_LANCAR,PERM.COMANDA_FECHAR],
  COZINHA:[PERM.KDS_VER,PERM.ITEM_STATUS]
};
