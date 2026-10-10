"use strict";
// Fase 4.4 — infraestrutura compartilhada dos testes. Cria um cliente
// Supabase admin (service_role) e um cliente "normal" (publishable key)
// pra simular o app de verdade, mais os helpers de seed/limpeza usados
// pelos arquivos de teste.
//
// TRAVA DE SEGURANÇA: isto recusa rodar contra o projeto de produção
// (ybsyhjqtwiwomtxbloyu) mesmo que alguém configure TEST_SUPABASE_URL
// errado por engano — ver checarNaoEhProducao() abaixo.

const { createClient } = require("@supabase/supabase-js");
const bcrypt = require("bcryptjs");

// VF-003 (0078) — PIN operacional e senha de login são independentes:
// todo funcionário de teste tem senha "1234" no Auth (login antigo,
// continua servindo só pra simplificar o teste — a regra de 8+
// caracteres mora dentro de criar_funcionario/trocar_credenciais_
// funcionario, não é imposta pelo Auth em si) e PIN "1234" com hash
// bcrypt em usuarios.pin_hash — o mesmo algoritmo que
// restaurante.verificar_pin_supervisor/bater_ponto conferem via
// pgcrypto crypt(), então um hash gerado aqui em JS é validado
// corretamente pelo Postgres sem nenhuma chamada extra.
const PIN_TESTE = "1234";
const PIN_TESTE_HASH = bcrypt.hashSync(PIN_TESTE, 10);

const PROJETO_PRODUCAO = "ybsyhjqtwiwomtxbloyu";

function checarNaoEhProducao(url){
  if (!url) {
    throw new Error(
      "TEST_SUPABASE_URL não configurada. Crie um projeto Supabase SÓ pra teste " +
      "(nunca o de produção), aplique todas as migrations de supabase/migrations/ nele, " +
      "e exporte TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY / TEST_SUPABASE_SERVICE_KEY " +
      "antes de rodar `npm test` (ver tests/README.md)."
    );
  }
  if (url.indexOf(PROJETO_PRODUCAO) !== -1) {
    throw new Error(
      "TEST_SUPABASE_URL aponta pro projeto de PRODUÇÃO (" + PROJETO_PRODUCAO + "). " +
      "Os testes de 4.4 existem exatamente pra nunca rodar contra produção — pare agora " +
      "e configure um projeto de teste separado."
    );
  }
}

function clienteTeste(){
  const url = process.env.TEST_SUPABASE_URL;
  const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
  checarNaoEhProducao(url);
  if (!anonKey) throw new Error("TEST_SUPABASE_ANON_KEY não configurada.");
  return createClient(url, anonKey, { auth: { persistSession: false }, db: { schema: "restaurante" } });
}

function clienteAdmin(){
  const url = process.env.TEST_SUPABASE_URL;
  const serviceKey = process.env.TEST_SUPABASE_SERVICE_KEY;
  checarNaoEhProducao(url);
  if (!serviceKey) throw new Error("TEST_SUPABASE_SERVICE_KEY não configurada.");
  return createClient(url, serviceKey, { auth: { persistSession: false }, db: { schema: "restaurante" } });
}

// Cria uma empresa de teste isolada (slug com timestamp, nunca colide
// entre execuções) com 1 ADMIN, 1 GARCOM, 1 CAIXA, mesas, produto e
// insumo com ficha técnica — o mínimo que as RPCs críticas tocam.
async function seedEmpresaTeste(admin){
  const sufixo = Date.now().toString(36);
  const slug = "teste-" + sufixo;

  const { data: empresa, error: eEmpresa } = await admin
    .from("empresas")
    .insert({ nome: "Empresa Teste " + sufixo, slug, config: { taxaServicoPctPadrao: 10 } })
    .select().single();
  if (eEmpresa) throw eEmpresa;

  async function criarUsuario(nome, papel){
    const email = `${sufixo}-${papel.toLowerCase()}@${slug}.internal`;
    const { data: authUser, error: eAuth } = await admin.auth.admin.createUser({
      email, password: "1234", email_confirm: true
    });
    if (eAuth) throw eAuth;
    const { error: eUsuario } = await admin.from("usuarios").insert({
      id: authUser.user.id, empresa_id: empresa.id, nome, papel, ativo: true, email_interno: email,
      pin_hash: PIN_TESTE_HASH
    });
    if (eUsuario) throw eUsuario;
    return { id: authUser.user.id, email, nome, papel };
  }

  const adminUser = await criarUsuario("Admin Teste", "ADMIN");
  const garcom = await criarUsuario("Garcom Teste", "GARCOM");
  const caixa = await criarUsuario("Caixa Teste", "CAIXA");

  const { data: mesa, error: eMesa } = await admin
    .from("mesas").insert({ empresa_id: empresa.id, numero: 1, capacidade: 4 }).select().single();
  if (eMesa) throw eMesa;

  const { data: categoria, error: eCat } = await admin
    .from("categorias").insert({ empresa_id: empresa.id, nome: "Teste", ordem: 0 }).select().single();
  if (eCat) throw eCat;

  const { data: insumo, error: eInsumo } = await admin
    .from("insumos").insert({ empresa_id: empresa.id, nome: "Insumo Teste", unidade: "un", estoque_atual: 100, estoque_minimo: 10, custo_medio_centavos: 200 })
    .select().single();
  if (eInsumo) throw eInsumo;

  const { data: produto, error: eProduto } = await admin
    .from("produtos").insert({ empresa_id: empresa.id, categoria_id: categoria.id, nome: "Produto Teste", preco_centavos: 1000, setor_producao: "COZINHA" })
    .select().single();
  if (eProduto) throw eProduto;

  const { error: eFicha } = await admin
    .from("ficha_tecnica").insert({ produto_id: produto.id, insumo_id: insumo.id, quantidade: 2 });
  if (eFicha) throw eFicha;

  return { empresa, admin: adminUser, garcom, caixa, mesa, categoria, insumo, produto };
}

// Faz login de verdade (igual o app) e devolve um client autenticado
// como aquele usuário — pra testar as RPCs com a permissão de cada papel,
// não com o service_role (que ignora RLS e esconderia bug de permissão).
async function loginComo(usuario, senha){
  const url = process.env.TEST_SUPABASE_URL;
  const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
  const cliente = createClient(url, anonKey, { auth: { persistSession: false }, db: { schema: "restaurante" } });
  const { error } = await cliente.auth.signInWithPassword({ email: usuario.email, password: senha });
  if (error) throw error;
  return cliente;
}

// Remove a empresa de teste (cascade cuida do resto) e os usuários do
// Auth — chamar sempre no fim de cada arquivo de teste (afterEach/after).
async function limparEmpresaTeste(admin, seed){
  await admin.from("empresas").delete().eq("id", seed.empresa.id);
  for (const u of [seed.admin, seed.garcom, seed.caixa]) {
    try { await admin.auth.admin.deleteUser(u.id); } catch (e) { /* já pode ter ido com o cascade */ }
  }
}

module.exports = { clienteTeste, clienteAdmin, seedEmpresaTeste, loginComo, limparEmpresaTeste };
