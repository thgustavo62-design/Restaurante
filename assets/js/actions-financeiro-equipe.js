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
async function marcarContaPaga(contaId){
  var c = state.contas.find(function(x){ return x.id===contaId; });
  var agora = new Date().toISOString();
  var res = await sb.from("contas").update({pago_em:agora}).eq("id", contaId);
  if(res.error){ toast("err","ERRO", res.error.message); return; }
  c.pagoEm = agora;
  render();
  toast("ok","CONTA PAGA", c.descricao);
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
  toast("ok","USUÁRIO CRIADO", nome.trim()+" · "+papel);
}
async function toggleUsuarioAtivo(usuarioId){
  var u = state.usuarios.find(function(x){ return x.id===usuarioId; });
  var novo = !u.ativo;
  u.ativo = novo;
  render();
  var res = await sb.from("usuarios").update({ativo:novo}).eq("id", usuarioId);
  if(res.error){ u.ativo = !novo; toast("err","ERRO", res.error.message); render(); }
}

async function salvarConfig(campos){
  var c = state.config;
  var novoConfig = Object.assign({}, c, {
    taxaServicoPctPadrao: Math.max(0, campos.taxaPct||0),
    limiteDescontoPct: Math.max(0, campos.descontoPct||0),
    limiteDiferencaCentavos: Math.max(0, campos.diferencaCentavos||0),
    impressoraLargura: campos.impressoraLargura==="58mm" ? "58mm" : "80mm",
    reciboRodape: campos.reciboRodape.trim(),
    horarioAbertura: campos.horarioAbertura || c.horarioAbertura,
    horarioFechamento: campos.horarioFechamento || c.horarioFechamento,
    chavePix: campos.chavePix.trim()
  });
  delete novoConfig.empresaNome; delete novoConfig.empresaCnpj;
  var res = await sb.from("empresas").update({
    nome: campos.nome.trim() || c.empresaNome, cnpj: campos.cnpj.trim(), config: novoConfig
  }).eq("id", state.empresaId);
  if(res.error){ toast("err","ERRO AO SALVAR", res.error.message); return; }
  state.config = Object.assign({}, novoConfig, {empresaNome: campos.nome.trim()||c.empresaNome, empresaCnpj: campos.cnpj.trim()});
  render();
  toast("ok","CONFIGURAÇÕES SALVAS", "");
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

