"use strict";

// Fase 5 (Marketing) — cupons, clientes inativos e banner do cardápio
// público. Mesmo padrão de form dos outros cadastros (clientes, contas):
// modal guarda os campos em state.modal, "salvar" lê do DOM e grava.

function abrirCupomForm(){
  state.modal = {type:"cupomForm", codigo:"", tipo:"PERCENTUAL", valorInput:"",
    validoDe:"", validoAte:"", usosMax:"", erro:"", salvando:false};
  render();
}
async function salvarCupom(codigo, tipo, valorInput, validoDe, validoAte, usosMaxInput){
  var m = state.modal;
  codigo = codigo.trim().toUpperCase();
  if(!codigo){ m.erro = "Informe o código do cupom."; render(); return; }
  var valorNum = parseFloat((valorInput||"").replace(",","."));
  if(!(valorNum>0)){ m.erro = "Informe um valor de desconto válido."; render(); return; }
  var valor = tipo==="VALOR_FIXO" ? Math.round(valorNum*100) : Math.round(valorNum);
  if(tipo==="PERCENTUAL" && valor>100){ m.erro = "Desconto percentual não pode passar de 100%."; render(); return; }
  var usosMax = usosMaxInput ? parseInt(usosMaxInput,10) : null;

  m.salvando = true; render();
  var res = await sb.from("cupons").insert({
    empresa_id: state.empresaId, codigo: codigo, tipo: tipo, valor: valor,
    valido_de: validoDe||null, valido_ate: validoAte||null, usos_max: usosMax
  }).select().single();
  m.salvando = false;
  if(res.error){
    m.erro = res.error.message.indexOf("idx_cupons_codigo")!==-1 ? "Já existe um cupom com esse código." : res.error.message;
    render(); return;
  }
  var mapeado = mapCupom(res.data);
  state.cupons.unshift(mapeado);
  state.modal = null;
  render();
  toast("ok","CUPOM CRIADO", mapeado.codigo);
}
async function alternarAtivoCupom(cupomId){
  var c = state.cupons.find(function(x){ return x.id===cupomId; });
  if(!c) return;
  var novo = !c.ativo;
  c.ativo = novo;
  render();
  var res = await sb.from("cupons").update({ativo:novo}).eq("id", cupomId);
  if(res.error){ c.ativo = !novo; toast("err","ERRO", res.error.message); render(); return; }
  toast("ok", novo?"CUPOM ATIVADO":"CUPOM DESATIVADO", c.codigo);
}

// Fase 5 — clientes inativos: busca sob demanda (não entra no
// carregarTudo porque o período é escolhido na hora e pode ser uma
// consulta pesada em bases com muito cliente).
async function buscarClientesInativos(diasInput){
  var dias = parseInt(diasInput,10);
  if(!(dias>0)) return;
  state.clientesInativosDias = dias;
  state.clientesInativosCarregando = true;
  render();
  var res = await sb.rpc("relatorio_clientes_inativos", {p_dias: dias});
  state.clientesInativosCarregando = false;
  if(res.error){ toast("err","ERRO AO BUSCAR", res.error.message); render(); return; }
  state.clientesInativosResultado = res.data;
  render();
}

// Fase 5 — banner do cardápio público: grava dentro de empresas.config.marketing,
// mesmo mecanismo de salvarConfig (0045+) — só que mexendo numa chave só,
// pra não arriscar sobrescrever outras configurações sensíveis sem querer.
async function salvarMarketingBanner(bannerAtivo, bannerTexto, produtoDestaqueId){
  var novoConfig = Object.assign({}, state.config, {
    marketing: {bannerAtivo: !!bannerAtivo, bannerTexto: bannerTexto.trim(), produtoDestaqueId: produtoDestaqueId||""}
  });
  delete novoConfig.empresaNome; delete novoConfig.empresaCnpj; delete novoConfig.totalFichas; delete novoConfig.slug;
  var res = await sb.from("empresas").update({config: novoConfig}).eq("id", state.empresaId);
  if(res.error){ toast("err","ERRO AO SALVAR", res.error.message); return; }
  state.config = Object.assign({}, novoConfig, {empresaNome: state.config.empresaNome, empresaCnpj: state.config.empresaCnpj, totalFichas: state.config.totalFichas, slug: state.config.slug});
  render();
  toast("ok","BANNER ATUALIZADO","");
}
