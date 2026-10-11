"use strict";
// VF-019 — a tela do DRE mostra as mesmas linhas/fórmula da Central do Dono e
// do Resumo financeiro (perdas, maquininha, custo de equipe só para quem tem
// permissão) e o bloco de conciliação (verde quando fecha, vermelho quando
// não). Lógica pura de render, sandbox de VM — não precisa de Supabase.

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function carregar(state) {
  const sandbox = { console, state, hojeOperacionalStr: function () { return "2026-10-11"; } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "assets", "js", "helpers.js"), "utf8"), sandbox);
  sandbox.state = state; // helpers.js zera `state`; define o de teste depois dele
  const tela = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "render-screens.js"), "utf8");
  const ini = tela.indexOf("function renderDre(){");
  const fim = tela.indexOf("// PRIORIDADE 5 — Equipe ganhou 5 sub-abas");
  assert.ok(ini > 0 && fim > ini, "trecho do DRE não encontrado");
  vm.runInContext(tela.slice(ini, fim), sandbox);
  return sandbox;
}

const base = {
  mes: "2026-10", periodo: { desde: "2026-10-01", ate: "2026-10-31" },
  faturamento: 11106, cmv: 0, perdas: 700, despesas: 653000, taxa_maquininha: 60,
  taxa_servico_incluida_no_faturamento: 846, resultado_antes_equipe: -642654,
  custo_equipe: 846, resultado: -643500, formulas: { faturamento: "x" }
};

test("DRE completo (quem vê custo de equipe): todas as linhas e o resultado final", () => {
  const sb = carregar({ relatorioDreMes: "2026-10", relatorioDreResultado: base, relatorioConciliacao: null });
  const html = sb.renderDre();
  for (const trecho of ["Faturamento", "(-) CMV", "(-) Perdas", "(-) Taxas de maquininha", "Resultado antes do custo de equipe", "(-) Custo de equipe", ">Resultado<"])
    assert.ok(html.includes(trecho), "faltou: " + trecho);
  assert.ok(html.includes("2026-10-01 a 2026-10-31"));
});

test("DRE sem permissão de equipe: não mostra custo de equipe nem resultado final", () => {
  const d = Object.assign({}, base, { custo_equipe: null, resultado: null });
  const sb = carregar({ relatorioDreMes: "2026-10", relatorioDreResultado: d, relatorioConciliacao: null });
  const html = sb.renderDre();
  assert.ok(html.includes("Resultado antes do custo de equipe"));
  assert.ok(!html.includes("(-) Custo de equipe"));
  assert.ok(!html.includes(">Resultado<"));
});

test("conciliação: verde quando fecha, vermelha e com aviso quando não fecha", () => {
  const conc = (ok, dif) => ({ verificacoes: [{ ok, valor_a_centavos: 11106, valor_b_centavos: 11106 - dif, diferenca_centavos: dif }],
    derivados: { itens_brutos_centavos: 10800, desconto_manual_centavos: 540, taxa_servico_centavos: 846, descontos_cupom_e_pontos_centavos: 0,
      recebido_em_comandas_ainda_abertas_centavos: 1980, recebido_por_forma_centavos: { DEBITO: 2980, DINHEIRO: 6326 } } });
  const fecha = carregar({ relatorioDreMes: "2026-10", relatorioDreResultado: base, relatorioConciliacao: conc(true, 0) }).renderDre();
  assert.ok(fecha.includes("Conciliação do mês · fecha") && fecha.includes("var(--success)"));
  const naoFecha = carregar({ relatorioDreMes: "2026-10", relatorioDreResultado: base, relatorioConciliacao: conc(false, 500) }).renderDre();
  assert.ok(naoFecha.includes("NÃO FECHA"));
});
