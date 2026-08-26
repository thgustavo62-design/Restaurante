"use strict";

var SUPABASE_URL = "https://enmfjfhqqvezyaieotjb.supabase.co";
var SUPABASE_KEY = "sb_publishable_2JWVIHWn7VxrbnAnWrfLWg_y-TLYZ2o";
var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: true }
});
var PIN_LEN = 4;
function limiteDescontoPct(){ return state.config.limiteDescontoPct; }
function limiteDiferencaCentavos(){ return state.config.limiteDiferencaCentavos; }

var PERM = {
  SALAO_VER:"atendimento.salao.ver",
  COMANDA_ABRIR:"atendimento.comanda.abrir",
  ITEM_LANCAR:"atendimento.comanda.item.lancar",
  ITEM_CANCELAR:"atendimento.comanda.item.cancelar",
  DESCONTO_APLICAR:"atendimento.comanda.desconto.aplicar",
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
  RELATORIOS:"admin.relatorios.ver",
  CONFIGURACOES:"admin.configuracoes.editar"
};

var MATRIZ = {
  ADMIN:[PERM.SALAO_VER,PERM.COMANDA_ABRIR,PERM.ITEM_LANCAR,PERM.ITEM_CANCELAR,PERM.DESCONTO_APLICAR,PERM.COMANDA_FECHAR,PERM.KDS_VER,PERM.ITEM_STATUS,PERM.CAIXA_ABRIR,PERM.CAIXA_FECHAR,PERM.SANGRIA,PERM.SUPRIMENTO,PERM.PAGAMENTO,PERM.AUDITORIA_VER,PERM.CARDAPIO,PERM.ESTOQUE,PERM.EQUIPE,PERM.FINANCEIRO,PERM.RELATORIOS,PERM.CONFIGURACOES],
  GERENTE:[PERM.SALAO_VER,PERM.COMANDA_ABRIR,PERM.ITEM_LANCAR,PERM.ITEM_CANCELAR,PERM.DESCONTO_APLICAR,PERM.COMANDA_FECHAR,PERM.KDS_VER,PERM.ITEM_STATUS,PERM.CAIXA_ABRIR,PERM.CAIXA_FECHAR,PERM.SANGRIA,PERM.SUPRIMENTO,PERM.PAGAMENTO,PERM.AUDITORIA_VER,PERM.CARDAPIO,PERM.ESTOQUE,PERM.EQUIPE,PERM.FINANCEIRO,PERM.RELATORIOS],
  CAIXA:[PERM.SALAO_VER,PERM.COMANDA_ABRIR,PERM.ITEM_LANCAR,PERM.COMANDA_FECHAR,PERM.CAIXA_ABRIR,PERM.CAIXA_FECHAR,PERM.SANGRIA,PERM.SUPRIMENTO,PERM.PAGAMENTO],
  GARCOM:[PERM.SALAO_VER,PERM.COMANDA_ABRIR,PERM.ITEM_LANCAR,PERM.COMANDA_FECHAR],
  COZINHA:[PERM.KDS_VER,PERM.ITEM_STATUS]
};
