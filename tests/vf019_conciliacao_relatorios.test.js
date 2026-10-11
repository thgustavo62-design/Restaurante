"use strict";
// VF-019 (0087) — Central do Dono, DRE e Resumo financeiro leem a MESMA fonte
// (restaurante.indicadores_mes), então o resultado do mês é igual nos três; e
// relatorio_conciliacao confirma faturamento == entradas de VENDA no caixa.
//
// Ainda não rodou contra um Supabase de verdade (sem homologação — ver
// tests/README.md). O mesmo cenário (desconto 10% + taxa + débito/dinheiro com
// troco; parcial por item; parcial que fica aberta; fiado; perda; despesa;
// taxa de maquininha) foi conferido em produção via MCP com transação desfeita:
// Central = DRE = Resumo = -643.500 e a conciliação fechou com diferença 0.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

test("resultado do mês é igual na Central, no DRE e no Resumo; conciliação fecha", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const dono = await loginComo(seed.admin, "1234");

  await admin.from("empresas").update({ config: { taxasMaquininha: { DEBITO: { pct: 2, prazoDias: 1 } } } }).eq("id", seed.empresa.id);
  const sessao = await dono.from("caixa_sessoes").insert({
    empresa_id: seed.empresa.id, terminal: "T-019", usuario_abertura: seed.admin.id, saldo_inicial_centavos: 0, status: "ABERTA"
  }).select().single();
  if (sessao.error) throw sessao.error;
  const c = await dono.from("comandas").insert({
    empresa_id: seed.empresa.id, codigo: "V19" + crypto.randomBytes(3).toString("hex"),
    mesa_id: null, tipo: "BALCAO", status: "ABERTA", usuario_abertura: seed.admin.id, taxa_servico_ativa: true
  }).select().single();
  if (c.error) throw c.error;
  await dono.from("comanda_itens").insert({ comanda_id: c.data.id, produto_id: seed.produto.id, nome: "x", quantidade: 3, preco_unit_centavos: 1000 });
  const previa = await dono.rpc("calcular_total_pagamento", { p_comanda_id: c.data.id, p_item_ids: null, p_pontos_resgatados: 0, p_cupom_codigo: null, p_cliente_id: null });
  if (previa.error) throw previa.error;
  const pago = await dono.rpc("confirmar_pagamento", {
    p_comanda_id: c.data.id, p_sessao_id: sessao.data.id, p_total_esperado_centavos: previa.data.total,
    p_linhas: [{ forma: "DEBITO", valor_centavos: 1000 }, { forma: "DINHEIRO", valor_centavos: previa.data.total - 1000 + 500 }]
  });
  if (pago.error) throw pago.error;

  const hoje = new Date().toISOString().slice(0, 10);
  const central = await dono.rpc("central_do_dono");
  const dre = await dono.rpc("relatorio_dre", { p_mes: hoje });
  const resumo = await dono.rpc("relatorio_financeiro_resumo", { p_mes: hoje });
  const conc = await dono.rpc("relatorio_conciliacao", { p_mes: hoje });
  for (const r of [central, dre, resumo, conc]) if (r.error) throw r.error;

  assert.equal(central.data.mes.faturamento_centavos, dre.data.faturamento);
  assert.equal(central.data.mes.resultado_centavos, dre.data.resultado, "Central == DRE");
  assert.equal(resumo.data.sobrou_centavos, dre.data.resultado, "Resumo == DRE");
  assert.equal(conc.data.verificacoes[0].ok, true, "faturamento == entradas de VENDA no caixa");
  assert.equal(conc.data.verificacoes[0].diferenca_centavos, 0);
});
