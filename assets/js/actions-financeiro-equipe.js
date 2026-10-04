"use strict";

function abrirContaForm(){
  state.modal = {type:"contaForm"};
  render();
}
async function salvarConta(tipo, descricao, categoria, valorCentavos, vencimento){
  if(!descricao.trim() || !(valorCentavos>0) || !vencimento) return;
  var res = await sb.from("contas").insert({
    empresa_id: state.empresaId, tipo:tipo, descricao:descricao.trim(), categoria:(categoria.trim()||"Geral"),
    valor_centavos:valorCentavos, vencimento:vencimento
  }).select().single();
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  state.contas.push(mapConta(res.data));
  state.modal = null;
  render();
  toast("ok","CONTA CRIADA", descricao.trim());
}
// Fase 2.9 — exportação pro contador: 3 CSVs (vendas por forma, contas,
// fechamentos de caixa) do mês escolhido, agregados no banco (0057).
async function exportarParaContador(mes){
  if(!mes) return;
  var res = await sb.rpc("relatorio_exportacao_contador", {p_mes: mes+"-01"});
  if(res.error){ toast("err","ERRO AO EXPORTAR", res.error.message); return; }
  var d = res.data;
  baixarCsv("vendas-por-forma-"+d.mes+".csv", ["forma","total_centavos","quantidade"],
    d.vendas_por_forma.map(function(v){ return [v.forma, v.total, v.quantidade]; }));
  baixarCsv("contas-"+d.mes+".csv", ["tipo","descricao","categoria","valor_centavos","vencimento","pago_em"],
    d.contas.map(function(c){ return [c.tipo, c.descricao, c.categoria, c.valor_centavos, c.vencimento, c.pago_em||""]; }));
  baixarCsv("fechamentos-caixa-"+d.mes+".csv", ["terminal","abertura_em","fechamento_em","saldo_inicial_centavos","saldo_calculado_centavos","saldo_informado_centavos","diferenca_centavos"],
    d.fechamentos_caixa.map(function(f){ return [f.terminal, f.abertura_em, f.fechamento_em, f.saldo_inicial_centavos, f.saldo_calculado_centavos, f.saldo_informado_centavos, f.diferenca_centavos]; }));
  toast("ok","EXPORTAÇÃO CONCLUÍDA", "3 arquivos CSV de "+d.mes+" baixados");
}

async function marcarContaPaga(contaId){
  var c = state.contas.find(function(x){ return x.id===contaId; });
  var agora = new Date().toISOString();
  var res = await sb.from("contas").update({pago_em:agora}).eq("id", contaId);
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  c.pagoEm = agora;
  render();
  toast("ok","CONTA PAGA", c.descricao);
}

// Fase 2.7 — cadastro de clientes (CRM básico).
function abrirClienteForm(clienteId){
  var c = clienteId ? state.clientes.find(function(x){ return x.id===clienteId; }) : null;
  state.modal = {type:"clienteForm", clienteId:clienteId||null,
    nome: c?c.nome:"", telefone: c?c.telefone:"", aniversario: c?c.aniversario:"",
    observacoes: c?c.observacoes:"", consentimentoLgpd: c?c.consentimentoLgpd:false,
    endereco: c?c.endereco:"", bairro: c?c.bairro:"", erro:"", salvando:false};
  render();
}
async function salvarCliente(nome, telefone, aniversario, observacoes, consentimentoLgpd, endereco, bairro){
  var m = state.modal;
  if(!nome.trim()){ m.erro = "Informe o nome do cliente."; render(); return; }
  m.salvando = true; render();
  var payload = {
    nome: nome.trim(), telefone: telefone.trim()||null, aniversario: aniversario||null,
    observacoes: observacoes.trim()||null, consentimento_lgpd: consentimentoLgpd,
    consentimento_em: consentimentoLgpd ? new Date().toISOString() : null,
    endereco: endereco.trim()||null, bairro: bairro.trim()||null
  };
  var res;
  if(m.clienteId){
    res = await sb.from("clientes").update(payload).eq("id", m.clienteId).select().single();
  } else {
    res = await sb.from("clientes").insert(Object.assign({empresa_id:state.empresaId}, payload)).select().single();
  }
  m.salvando = false;
  if(res.error){ m.erro = res.error.message; render(); return; }
  var mapeado = mapCliente(res.data);
  if(m.clienteId){
    var idx = state.clientes.findIndex(function(c){ return c.id===m.clienteId; });
    if(idx!==-1) state.clientes[idx] = mapeado;
  } else {
    state.clientes.push(mapeado);
    state.clientes.sort(function(a,b){ return a.nome.localeCompare(b.nome); });
  }
  state.modal = null;
  render();
  toast("ok", m.clienteId?"CLIENTE ATUALIZADO":"CLIENTE CRIADO", mapeado.nome);
}

function abrirUsuarioForm(){
  state.modal = {type:"usuarioForm", erro:""};
  render();
}
async function salvarUsuario(nome, papel, pin){
  if(!nome.trim()){ state.modal.erro = "Informe o nome."; render(); return; }
  if(!/^[0-9]{4}$/.test(pin)){ state.modal.erro = "PIN deve ter exatamente 4 dígitos."; render(); return; }
  state.modal.salvando = true; render();
  var res = await sb.rpc("criar_funcionario", {p_nome:nome.trim(), p_papel:papel, p_pin:pin});
  if(res.error){ state.modal.erro = res.error.message; state.modal.salvando = false; render(); return; }
  state.usuarios.push({id:res.data, nome:nome.trim(), papel:papel, ativo:true});
  state.modal = null;
  render();
  registrarAuditoriaLocal("usuarios", res.data, "USUARIO_CRIADO", state.usuarioAtualId, nome.trim()+" · "+papel);
  toast("ok","USUÁRIO CRIADO", nome.trim()+" · "+papel);
}
function abrirTrocarPin(usuarioId){
  var u = state.usuarios.find(function(x){ return x.id===usuarioId; });
  if(!u) return;
  state.modal = {type:"trocarPin", usuarioId:usuarioId, nome:u.nome, erro:"", salvando:false};
  render();
}
async function confirmarTrocarPin(usuarioId, novoPin, confirmarPin){
  var m = state.modal;
  if(!/^[0-9]{4}$/.test(novoPin||"")){ m.erro = "PIN deve ter exatamente 4 dígitos."; render(); return; }
  if(novoPin !== confirmarPin){ m.erro = "Os PINs digitados não coincidem."; render(); return; }
  m.erro = ""; m.salvando = true; render();
  var res = await sb.rpc("trocar_pin_funcionario", {p_usuario_id:usuarioId, p_novo_pin:novoPin});
  if(res.error){ m.erro = res.error.message; m.salvando = false; render(); return; }
  var u = state.usuarios.find(function(x){ return x.id===usuarioId; });
  state.modal = null;
  render();
  toast("ok","PIN ALTERADO", u ? u.nome : "");
}
async function toggleUsuarioAtivo(usuarioId){
  var u = state.usuarios.find(function(x){ return x.id===usuarioId; });
  var novo = !u.ativo;
  u.ativo = novo;
  render();
  var res = await sb.from("usuarios").update({ativo:novo}).eq("id", usuarioId);
  if(res.error){ u.ativo = !novo; toast("err","ERRO", res.error.message); render(); return; }
  registrarAuditoriaLocal("usuarios", usuarioId, novo?"USUARIO_ATIVADO":"USUARIO_DESATIVADO", state.usuarioAtualId, u.nome);
}

async function salvarConfig(campos){
  var c = state.config;
  var novoConfig = Object.assign({}, c, {
    taxaServicoPctPadrao: Math.max(0, campos.taxaPct||0),
    limiteDescontoPct: Math.max(0, campos.descontoPct||0),
    limiteDiferencaCentavos: Math.max(0, campos.diferencaCentavos||0),
    limiteAlertaSangriaCentavos: Math.max(0, campos.alertaSangriaCentavos||0),
    impressoraLargura: campos.impressoraLargura==="58mm" ? "58mm" : "80mm",
    reciboRodape: campos.reciboRodape.trim(),
    horarioAbertura: campos.horarioAbertura || c.horarioAbertura,
    horarioFechamento: campos.horarioFechamento || c.horarioFechamento,
    chavePix: campos.chavePix.trim(),
    atrasoPorSetor: campos.atrasoPorSetor || c.atrasoPorSetor,
    taxasMaquininha: campos.taxasMaquininha || c.taxasMaquininha,
    produtoCouvertId: campos.produtoCouvertId,
    happyHoraInicio: campos.happyHoraInicio,
    happyHoraFim: campos.happyHoraFim,
    fidelidade: campos.fidelidade || c.fidelidade,
    bairrosTaxaEntrega: campos.bairrosTaxaEntrega || c.bairrosTaxaEntrega,
    aceitarQrSemTokenAte: campos.aceitarQrSemTokenAte || null
  });
  delete novoConfig.empresaNome; delete novoConfig.empresaCnpj; delete novoConfig.totalFichas; delete novoConfig.slug;
  var res = await sb.from("empresas").update({
    nome: campos.nome.trim() || c.empresaNome, cnpj: campos.cnpj.trim(), config: novoConfig
  }).eq("id", state.empresaId);
  if(res.error){ toast("err","ERRO AO SALVAR", res.error.message); return; }
  var mudancasSensiveis = [];
  if(c.limiteDescontoPct!==novoConfig.limiteDescontoPct) mudancasSensiveis.push("limite desconto: "+c.limiteDescontoPct+"% -> "+novoConfig.limiteDescontoPct+"%");
  if(c.limiteDiferencaCentavos!==novoConfig.limiteDiferencaCentavos) mudancasSensiveis.push("limite diferença caixa: "+brl(c.limiteDiferencaCentavos)+" -> "+brl(novoConfig.limiteDiferencaCentavos));
  if(mudancasSensiveis.length) registrarAuditoriaLocal("configuracoes", state.empresaId, "CONFIG_ALTERADA", state.usuarioAtualId, mudancasSensiveis.join(" · "));
  state.config = Object.assign({}, novoConfig, {empresaNome: campos.nome.trim()||c.empresaNome, empresaCnpj: campos.cnpj.trim()});
  render();
  toast("ok","CONFIGURAÇÕES SALVAS", "");
}
// 0.5 — GERENTE/ADMIN decide um conflito de sincronização offline:
// aplicar mesmo assim (processa o pagamento guardado) ou descartar (a
// venda não é registrada). Qualquer um dos dois recarrega tudo, porque o
// resultado pode mexer em caixa/estoque/comanda de formas que só um
// refresh completo reflete com segurança.
async function resolverSyncConflito(conflitoId, aplicar){
  var res = await sb.rpc("resolver_sync_conflito", {p_conflito_id: conflitoId, p_aplicar: aplicar});
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  state.syncConflitos = state.syncConflitos.filter(function(c){ return c.id!==conflitoId; });
  render();
  await carregarTudo();
  toast("ok", aplicar?"CONFLITO APLICADO":"CONFLITO DESCARTADO", "");
}
function estaAberto(){
  var c = state.config;
  var agora = new Date();
  var hm = String(agora.getHours()).padStart(2,"0")+":"+String(agora.getMinutes()).padStart(2,"0");
  if(c.horarioAbertura===c.horarioFechamento) return true;
  if(c.horarioAbertura < c.horarioFechamento){
    return hm >= c.horarioAbertura && hm < c.horarioFechamento;
  }
  return hm >= c.horarioAbertura || hm < c.horarioFechamento;
}

