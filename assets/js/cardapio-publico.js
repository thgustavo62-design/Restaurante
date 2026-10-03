"use strict";

// Página pública (sem login) do cardápio digital, lida via QR na mesa.
// Deliberadamente um script à parte do app autenticado: não carrega PIN,
// permissões, Realtime nem nenhuma tela interna — só lê nome/preço/esgotado/
// categoria/foto de produtos e categorias ATIVOS, via as policies RLS
// "*_select_publico" (to anon) criadas em 0030_cardapio_publico_restaurante.sql.

var CP_SUPABASE_URL = "https://ybsyhjqtwiwomtxbloyu.supabase.co";
var CP_SUPABASE_KEY = "sb_publishable_35oPPu0kJ7Da0LtintHzOw_MO_n1oN3";
var cpSb = window.supabase.createClient(CP_SUPABASE_URL, CP_SUPABASE_KEY, {
  auth: { persistSession: false },
  db: { schema: "restaurante" }
});

function cpBrl(centavos){
  return (centavos/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
}
function cpEscapeHtml(s){
  return String(s==null?"":s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];
  });
}
function cpSlugAtual(){
  var porQuery = new URLSearchParams(window.location.search).get("slug");
  if(porQuery) return porQuery;
  var partes = window.location.pathname.split("/").filter(Boolean);
  var idx = partes.indexOf("cardapio");
  if(idx!==-1 && partes[idx+1]) return decodeURIComponent(partes[idx+1]);
  return null;
}

async function cpCarregar(){
  var root = document.getElementById("cp-root");
  var slug = cpSlugAtual();
  if(!slug){
    root.innerHTML = '<div class="cp-erro">Link inválido — nenhum cardápio informado.</div>';
    return;
  }
  var empRes = await cpSb.from("cardapio_publico_empresa").select("id,nome,slug").eq("slug", slug).single();
  if(empRes.error || !empRes.data){
    root.innerHTML = '<div class="cp-erro">Cardápio não encontrado.</div>';
    return;
  }
  var empresa = empRes.data;
  document.title = empresa.nome + " — Cardápio";

  var catRes = await cpSb.from("categorias").select("id,nome,ordem").eq("empresa_id", empresa.id).eq("ativo", true).order("ordem");
  var prodRes = await cpSb.from("produtos").select("nome,preco_centavos,esgotado,categoria_id,foto_url").eq("empresa_id", empresa.id).eq("ativo", true);

  var categorias = catRes.data || [];
  var produtos = prodRes.data || [];
  var porCategoria = {};
  categorias.forEach(function(c){ porCategoria[c.id] = []; });
  produtos.forEach(function(p){
    if(!porCategoria[p.categoria_id]) porCategoria[p.categoria_id] = [];
    porCategoria[p.categoria_id].push(p);
  });

  var html = '<div class="cp-header"><h1>'+cpEscapeHtml(empresa.nome)+'</h1><p>Cardápio</p></div>';
  var temAlgumProduto = false;
  categorias.forEach(function(c){
    var itens = porCategoria[c.id] || [];
    if(!itens.length) return;
    temAlgumProduto = true;
    html += '<div class="cp-categoria"><h2>'+cpEscapeHtml(c.nome)+'</h2><div class="cp-grid">'+
      itens.map(function(p){
        return '<div class="cp-item'+(p.esgotado?' cp-esgotado':'')+'">'+
          (p.foto_url ? '<img class="cp-thumb" src="'+cpEscapeHtml(p.foto_url)+'" onerror="this.style.display=\'none\'">' : '')+
          '<div class="cp-item-nome">'+cpEscapeHtml(p.nome)+'</div>'+
          (p.esgotado ? '<div class="cp-item-preco cp-esgotado-label">Esgotado</div>' : '<div class="cp-item-preco">'+cpBrl(p.preco_centavos)+'</div>')+
        '</div>';
      }).join("")+
    '</div></div>';
  });
  if(!temAlgumProduto) html += '<div class="cp-erro">Nenhum produto disponível no momento.</div>';

  root.innerHTML = html;
}

document.addEventListener("DOMContentLoaded", cpCarregar);
