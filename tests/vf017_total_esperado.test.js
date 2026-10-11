"use strict";
// VF-017 (0086) — confirmar_pagamento com p_total_esperado_centavos: se o
// total que o operador viu for diferente do que o servidor calcula agora,
// recusa e não grava nada; se bater, grava exatamente aquele valor.
//
// Ainda não rodou contra um Supabase de verdade (sem homologação — ver
// tests/README.md). Matriz equivalente (desconto manual + cupom + taxa +
// pagamento misto com troco; parcial por item com formas diferentes) foi
// conferida em produção via MCP com transação desfeita: diferença de 0
// centavo entre prévia, comandas.total_centavos e caixa_movimentos.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste } = require("./setup");

test("total esperado diferente do calculado é recusado; igual grava exatamente o mostrado", async (t) => {
  const admin = clienteAdmin();
  const seed = await seedEmpresaTeste(admin);
  t.after(() => limparEmpresaTeste(admin, seed));
  const caixa = await loginComo(seed.caixa, "1234");
  const sessao = await caixa.from("caixa_sessoes").insert({
    empresa_id: seed.empresa.id, terminal: "T-017", usuario_abertura: seed.caixa.id, saldo_inicial_centavos: 0, status: "ABERTA"
  }).select().single();
  if (sessao.error) throw sessao.error;
  const c = await caixa.from("comandas").insert({
    empresa_id: seed.empresa.id, codigo: "V17" + crypto.randomBytes(3).toString("hex"),
    mesa_id: null, tipo: "BALCAO", status: "ABERTA", usuario_abertura: seed.caixa.id, taxa_servico_ativa: true
  }).select().single();
  if (c.error) throw c.error;
  const it = await caixa.from("comanda_itens").insert({ comanda_id: c.data.id, produto_id: seed.produto.id, nome: "x", quantidade: 2, preco_unit_centavos: 1000 });
  if (it.error) throw it.error;

  const previa = await caixa.rpc("calcular_total_pagamento", { p_comanda_id: c.data.id, p_item_ids: null, p_pontos_resgatados: 0, p_cupom_codigo: null, p_cliente_id: null });
  if (previa.error) throw previa.error;
  const total = previa.data.total;
  const linhas = [{ forma: "DINHEIRO", valor_centavos: total + 1000 }];

  const errado = await caixa.rpc("confirmar_pagamento", { p_comanda_id: c.data.id, p_linhas: linhas, p_sessao_id: sessao.data.id, p_total_esperado_centavos: total + 1 });
  assert.ok(errado.error);
  assert.match(errado.error.message, /O total da conta mudou/);
  const nada = await admin.from("pagamentos").select("id").eq("comanda_id", c.data.id);
  assert.equal(nada.data.length, 0, "recusado não pode gravar nada");

  const certo = await caixa.rpc("confirmar_pagamento", { p_comanda_id: c.data.id, p_linhas: linhas, p_sessao_id: sessao.data.id, p_total_esperado_centavos: total });
  if (certo.error) throw certo.error;
  assert.equal(certo.data.comanda.total_centavos, total, "gravado == mostrado, ao centavo");
  assert.equal(certo.data.comanda.troco_centavos, 1000);
});
