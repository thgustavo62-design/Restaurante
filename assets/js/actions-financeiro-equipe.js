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

// PRIORIDADE 7 — despesas recorrentes (aluguel, luz, contador...) —
// o cadastro só guarda o "molde"; quem lança a conta de cada mês é a
// RPC gerar_despesas_recorrentes_do_mes (chamada ao abrir a aba Resumo).
function abrirDespesaRecorrenteForm(despesaId){
  var d = despesaId ? state.despesasRecorrentes.find(function(x){ return x.id===despesaId; }) : null;
  state.modal = {type:"despesaRecorrenteForm", despesaId:despesaId||null,
    descricao: d?d.descricao:"", categoria: d?d.categoria:"Contas fixas",
    valor: d?(d.valorCentavos/100).toFixed(2):"", diaVencimento: d?d.diaVencimento:10,
    ativo: d?d.ativo:true, erro:""};
  render();
}
async function salvarDespesaRecorrente(despesaId, descricao, categoria, valorReais, diaVencimento, ativo){
  var m = state.modal;
  var valorCentavos = Math.round(parseFloat(valorReais||"0")*100);
  if(!descricao.trim()){ m.erro = "Informe a descrição."; render(); return; }
  if(!(valorCentavos>0)){ m.erro = "Informe um valor maior que zero."; render(); return; }
  var res = await sb.rpc("salvar_despesa_recorrente", {
    p_id: despesaId||null, p_descricao: descricao.trim(), p_categoria: categoria.trim()||"Contas fixas",
    p_valor_centavos: valorCentavos, p_dia_vencimento: parseInt(diaVencimento,10)||10, p_ativo: !!ativo
  });
  if(res.error){ m.erro = res.error.message; render(); return; }
  var mapeado = mapDespesaRecorrente(res.data);
  var idx = state.despesasRecorrentes.findIndex(function(x){ return x.id===mapeado.id; });
  if(idx!==-1) state.despesasRecorrentes[idx] = mapeado; else state.despesasRecorrentes.push(mapeado);
  state.modal = null;
  render();
  toast("ok","DESPESA FIXA SALVA", mapeado.descricao);
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
// VF-003 — senha de acesso (login no Supabase Auth, 8+ caracteres) e PIN
// operacional (autorização de supervisor/bater ponto, 4 caracteres) são
// independentes desde a 0078. criar_funcionario exige os dois.
async function salvarUsuario(nome, papel, senha, pin){
  if(!nome.trim()){ state.modal.erro = "Informe o nome."; render(); return; }
  if((senha||"").length < 8){ state.modal.erro = "Senha de acesso deve ter pelo menos 8 caracteres."; render(); return; }
  if(!/^[A-Za-z0-9]{4}$/.test(pin||"")){ state.modal.erro = "PIN operacional deve ter exatamente 4 caracteres (letras e números)."; render(); return; }
  if(senha === pin){ state.modal.erro = "A senha de acesso não pode ser igual ao PIN operacional."; render(); return; }
  state.modal.salvando = true; render();
  var res = await sb.rpc("criar_funcionario", {p_nome:nome.trim(), p_papel:papel, p_senha:senha, p_pin:pin});
  if(res.error){ state.modal.erro = res.error.message; state.modal.salvando = false; render(); return; }
  state.usuarios.push({id:res.data, nome:nome.trim(), papel:papel, ativo:true, pesoRateioTaxa:1});
  state.modal = null;
  render();
  registrarAuditoriaLocal("usuarios", res.data, "USUARIO_CRIADO", state.usuarioAtualId, nome.trim()+" · "+papel);
  toast("ok","USUÁRIO CRIADO", nome.trim()+" · "+papel);
}
// VF-003 — senha e PIN são independentes e opcionais aqui (pelo menos um
// preenchido): dá pra trocar só a senha, só o PIN, ou os dois de uma vez
// — útil pra ir migrando funcionário por funcionário pra senha de
// verdade sem precisar trocar o PIN de todo mundo no mesmo dia.
function abrirTrocarPin(usuarioId){
  var u = state.usuarios.find(function(x){ return x.id===usuarioId; });
  if(!u) return;
  state.modal = {type:"trocarPin", usuarioId:usuarioId, nome:u.nome, erro:"", salvando:false};
  render();
}
async function confirmarTrocarPin(usuarioId, novaSenha, confirmarSenha, novoPin, confirmarPin){
  var m = state.modal;
  var temSenha = !!novaSenha, temPin = !!novoPin;
  if(!temSenha && !temPin){ m.erro = "Preencha uma senha nova, um PIN novo, ou os dois."; render(); return; }
  if(temSenha){
    if(novaSenha.length < 8){ m.erro = "Senha de acesso deve ter pelo menos 8 caracteres."; render(); return; }
    if(novaSenha !== confirmarSenha){ m.erro = "As senhas digitadas não coincidem."; render(); return; }
  }
  if(temPin){
    if(!/^[A-Za-z0-9]{4}$/.test(novoPin)){ m.erro = "PIN operacional deve ter exatamente 4 caracteres (letras e números)."; render(); return; }
    if(novoPin !== confirmarPin){ m.erro = "Os PINs digitados não coincidem."; render(); return; }
  }
  if(temSenha && temPin && novaSenha === novoPin){ m.erro = "A senha de acesso não pode ser igual ao PIN operacional."; render(); return; }
  m.erro = ""; m.salvando = true; render();
  var res = await sb.rpc("trocar_credenciais_funcionario", {p_usuario_id:usuarioId, p_nova_senha: temSenha?novaSenha:null, p_novo_pin: temPin?novoPin:null});
  if(res.error){ m.erro = res.error.message; m.salvando = false; render(); return; }
  var u = state.usuarios.find(function(x){ return x.id===usuarioId; });
  state.modal = null;
  render();
  toast("ok","CREDENCIAIS ALTERADAS", u ? u.nome : "");
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

// PRIORIDADE 5 — Controle de Equipe.
async function salvarPesoRateioUsuario(usuarioId, peso){
  var u = state.usuarios.find(function(x){ return x.id===usuarioId; });
  if(!u || !(peso>0)) return;
  var anterior = u.pesoRateioTaxa;
  u.pesoRateioTaxa = peso;
  var res = await sb.from("usuarios").update({peso_rateio_taxa:peso}).eq("id", usuarioId);
  if(res.error){ u.pesoRateioTaxa = anterior; toast("err","ERRO", res.error.message); render(); }
}

// Escala: edição fica em memória (state.escalasPorUsuario) até "Salvar
// escala" — delete+insert da semana inteira do funcionário de uma vez
// (mesmo padrão simples de listas pequenas editadas por inteiro).
function escalaLinhaDoUsuario(usuarioId, diaSemana){
  var lista = state.escalasPorUsuario[usuarioId];
  if(!lista){ lista = []; state.escalasPorUsuario[usuarioId] = lista; }
  var linha = lista.find(function(e){ return e.diaSemana===diaSemana; });
  if(!linha){ linha = {diaSemana:diaSemana, tipo:"FOLGA", turnoInicio:null, turnoFim:null}; lista.push(linha); }
  return linha;
}
function escalaSetTipo(usuarioId, diaSemana, tipo){
  escalaLinhaDoUsuario(usuarioId, diaSemana).tipo = tipo;
  render();
}
function escalaSetTurnoInicio(usuarioId, diaSemana, valor){
  escalaLinhaDoUsuario(usuarioId, diaSemana).turnoInicio = valor||null;
}
function escalaSetTurnoFim(usuarioId, diaSemana, valor){
  escalaLinhaDoUsuario(usuarioId, diaSemana).turnoFim = valor||null;
}
async function salvarEscalaUsuario(usuarioId){
  var linhas = state.escalasPorUsuario[usuarioId]||[];
  var res = await sb.rpc("salvar_escala", {
    p_usuario_id: usuarioId,
    p_linhas: linhas.map(function(l){ return {dia_semana:l.diaSemana, tipo:l.tipo, turno_inicio:l.turnoInicio||"", turno_fim:l.turnoFim||""}; })
  });
  if(res.error){ toast("err","ERRO AO SALVAR ESCALA", res.error.message); return; }
  state.escalasPorUsuario[usuarioId] = res.data.map(mapEscala);
  render();
  toast("ok","ESCALA SALVA", "");
}

// Ponto: PIN confere a identidade de quem está batendo (mesma confiança
// de autorização de supervisor) — qualquer um logado pode bater o PIN de
// si mesmo ou de um colega.
async function baterPonto(tipo){
  if(!state.pontoUsuarioId){ state.pontoErro = "Escolha o funcionário."; render(); return; }
  if(!state.pontoPin){ state.pontoErro = "Informe o PIN."; render(); return; }
  // VF-004 — mesma régua de confirmarSupervisorRpc: registra a tentativa
  // numa chamada própria antes, pra sobreviver ao rollback se o PIN
  // estiver errado.
  var tent = await sb.rpc("registrar_tentativa_pin", {p_usuario_id: state.pontoUsuarioId});
  if(tent.error){ state.pontoErro = tent.error.message; render(); return; }
  var res = await sb.rpc("bater_ponto", {p_usuario_id: state.pontoUsuarioId, p_pin: state.pontoPin, p_tipo: tipo, p_tentativa_id: tent.data});
  if(res.error){ state.pontoErro = res.error.message; render(); return; }
  state.pontoPin = ""; state.pontoErro = "";
  if(!state.pontosRecentes) state.pontosRecentes = [];
  state.pontosRecentes.unshift(mapPonto(res.data));
  render();
  var u = state.usuarios.find(function(x){ return x.id===state.pontoUsuarioId; });
  toast("ok","PONTO REGISTRADO", (u?u.nome+" — ":"")+(PONTO_TIPO_LABEL[tipo]||tipo));
}
function abrirCorrigirPonto(pontoId){
  var p = (state.pontosRecentes||[]).find(function(x){ return x.id===pontoId; });
  if(!p) return;
  var d = new Date(p.registradoEm);
  var local = new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  state.modal = {type:"corrigirPonto", pontoId:pontoId, novoRegistradoEmInput:local, motivo:"", erro:""};
  render();
}
async function confirmarCorrigirPonto(){
  var m = state.modal;
  if(!m.novoRegistradoEmInput){ m.erro = "Informe a data/hora."; render(); return; }
  if(!m.motivo.trim()){ m.erro = "Motivo é obrigatório."; render(); return; }
  var res = await sb.rpc("corrigir_ponto", {
    p_ponto_id: m.pontoId, p_novo_registrado_em: new Date(m.novoRegistradoEmInput).toISOString(), p_motivo: m.motivo.trim()
  });
  if(res.error){ m.erro = res.error.message; render(); return; }
  var idx = (state.pontosRecentes||[]).findIndex(function(x){ return x.id===m.pontoId; });
  if(idx!==-1) state.pontosRecentes[idx] = mapPonto(res.data);
  state.modal = null;
  render();
  toast("ok","PONTO CORRIGIDO", "");
}

// Custo (ADMIN): remuneração e vales/adiantamentos.
function abrirRemuneracaoForm(usuarioId){
  var rem = state.remuneracoesPorUsuario[usuarioId];
  state.modal = {type:"remuneracaoForm", usuarioId:usuarioId, tipo: rem?rem.tipo:"MENSAL",
    valor: rem?(rem.valorCentavos/100).toFixed(2):"", erro:""};
  render();
}
async function salvarRemuneracao(usuarioId, tipo, valorReais){
  var m = state.modal;
  var valorCentavos = Math.round(parseFloat(valorReais||"0")*100);
  if(!(valorCentavos>=0)){ m.erro = "Informe um valor válido."; render(); return; }
  var res = await sb.rpc("salvar_remuneracao", {p_usuario_id:usuarioId, p_tipo:tipo, p_valor_centavos:valorCentavos});
  if(res.error){ m.erro = res.error.message; render(); return; }
  state.remuneracoesPorUsuario[usuarioId] = mapRemuneracao(res.data);
  state.modal = null;
  render();
  toast("ok","REMUNERAÇÃO SALVA", "");
}
function abrirValeForm(usuarioId){
  state.modal = {type:"valeForm", usuarioId:usuarioId, valor:"", motivo:"", data: hojeOperacionalStr(), erro:""};
  render();
}
async function confirmarVale(usuarioId, valorReais, motivo, data){
  var m = state.modal;
  var valorCentavos = Math.round(parseFloat(valorReais||"0")*100);
  if(!(valorCentavos>0)){ m.erro = "Informe um valor maior que zero."; render(); return; }
  if(!motivo.trim()){ m.erro = "Informe o motivo."; render(); return; }
  var res = await sb.rpc("registrar_vale", {p_usuario_id:usuarioId, p_valor_centavos:valorCentavos, p_motivo:motivo.trim(), p_data:data||null});
  if(res.error){ m.erro = res.error.message; render(); return; }
  if(!state.valesPorUsuario[usuarioId]) state.valesPorUsuario[usuarioId] = [];
  state.valesPorUsuario[usuarioId].unshift(mapVale(res.data));
  state.modal = null;
  render();
  toast("ok","VALE REGISTRADO", "");
  carregarFechamentoEquipe();
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
    aceitarQrSemTokenAte: campos.aceitarQrSemTokenAte || null,
    metasCentralDono: campos.metasCentralDono || c.metasCentralDono,
    alertaAumentoPrecoInsumoPct: campos.alertaAumentoPrecoInsumoPct!=null ? campos.alertaAumentoPrecoInsumoPct : c.alertaAumentoPrecoInsumoPct
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

