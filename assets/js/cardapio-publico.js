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
// Fase 3.3 — pedido pelo QR: só aparece se o link tiver ?mesa=N (o QR
// impresso em cada mesa já codifica isso). Sem mesa, a página continua
// só-leitura, igual sempre foi.
var cpMesaNumero = parseInt(new URLSearchParams(window.location.search).get("mesa")||"", 10) || null;
var cpSlugGlobal = null;
var cpCarrinho = {};
var cpEnviando = false;
var cpPedidoEnviado = false;

function cpTotalCarrinho(){
  return Object.keys(cpCarrinho).reduce(function(s,id){ return s+cpCarrinho[id].produto.preco_centavos*cpCarrinho[id].qtd; },0);
}
function cpQtdCarrinho(){
  return Object.keys(cpCarrinho).reduce(function(s,id){ return s+cpCarrinho[id].qtd; },0);
}
function cpAlterarCarrinho(produto, delta){
  var atual = cpCarrinho[produto.id] ? cpCarrinho[produto.id].qtd : 0;
  var novo = Math.max(0, atual+delta);
  if(novo===0) delete cpCarrinho[produto.id];
  else cpCarrinho[produto.id] = {produto:produto, qtd:novo};
  cpRenderBarra();
}
function cpRenderBarra(){
  var el = document.getElementById("cp-barra-pedido");
  if(!el) return;
  var qtd = cpQtdCarrinho();
  if(!qtd || cpPedidoEnviado){ el.style.display = "none"; return; }
  el.style.display = "flex";
  el.innerHTML = '<div>'+qtd+' ite'+(qtd===1?"m":"ns")+' · '+cpBrl(cpTotalCarrinho())+'</div>'+
    '<button class="cp-btn-pedido" id="cp-ver-pedido">Ver pedido</button>';
  document.getElementById("cp-ver-pedido").onclick = cpAbrirRevisao;
}
function cpAbrirRevisao(){
  var overlay = document.getElementById("cp-overlay");
  var itens = Object.keys(cpCarrinho).map(function(id){ return cpCarrinho[id]; });
  overlay.style.display = "flex";
  overlay.innerHTML = '<div class="cp-modal">'+
    '<h2>Seu pedido — Mesa '+cpMesaNumero+'</h2>'+
    itens.map(function(l){
      return '<div class="cp-modal-linha"><span>'+l.qtd+'x '+cpEscapeHtml(l.produto.nome)+'</span>'+
        '<span>'+cpBrl(l.produto.preco_centavos*l.qtd)+'</span></div>';
    }).join("")+
    '<div class="cp-modal-linha cp-modal-total"><span>Total</span><span>'+cpBrl(cpTotalCarrinho())+'</span></div>'+
    '<textarea id="cp-observacao" placeholder="Alguma observação? (opcional)"></textarea>'+
    '<div id="cp-erro-pedido" class="cp-erro-inline"></div>'+
    '<div class="cp-modal-acoes">'+
      '<button class="cp-btn-secundario" id="cp-fechar-revisao">Voltar</button>'+
      '<button class="cp-btn-pedido" id="cp-enviar-pedido">Enviar pedido</button>'+
    '</div>'+
  '</div>';
  document.getElementById("cp-fechar-revisao").onclick = function(){ overlay.style.display="none"; };
  document.getElementById("cp-enviar-pedido").onclick = cpEnviarPedido;
}
async function cpEnviarPedido(){
  if(cpEnviando) return;
  cpEnviando = true;
  var btn = document.getElementById("cp-enviar-pedido");
  if(btn) btn.disabled = true;
  var itens = Object.keys(cpCarrinho).map(function(id){
    return {produto_id:id, quantidade:cpCarrinho[id].qtd};
  });
  var obs = document.getElementById("cp-observacao").value;
  var res = await cpSb.rpc("criar_pedido_qr", {
    p_slug: cpSlugGlobal, p_mesa_numero: cpMesaNumero, p_itens: itens, p_observacao: obs
  });
  cpEnviando = false;
  if(res.error){
    document.getElementById("cp-erro-pedido").textContent = res.error.message;
    if(btn) btn.disabled = false;
    return;
  }
  cpCarrinho = {};
  cpPedidoEnviado = true;
  document.getElementById("cp-overlay").innerHTML = '<div class="cp-modal" style="text-align:center;">'+
    '<h2>Pedido enviado!</h2><p>O garçom vai confirmar em instantes. Pode fechar esta tela.</p>'+
    '<button class="cp-btn-pedido" id="cp-fechar-sucesso">Fechar</button>'+
  '</div>';
  document.getElementById("cp-fechar-sucesso").onclick = function(){ document.getElementById("cp-overlay").style.display="none"; };
  cpRenderBarra();
}

async function cpCarregar(){
  var root = document.getElementById("cp-root");
  var slug = cpSlugAtual();
  if(!slug){
    root.innerHTML = '<div class="cp-erro">Link inválido — nenhum cardápio informado.</div>';
    return;
  }
  var empRes = await cpSb.from("cardapio_publico_empresa")
    .select("id,nome,slug,banner_ativo,banner_texto,produto_destaque_id").eq("slug", slug).single();
  if(empRes.error || !empRes.data){
    root.innerHTML = '<div class="cp-erro">Cardápio não encontrado.</div>';
    return;
  }
  var empresa = empRes.data;
  cpSlugGlobal = slug;
  document.title = empresa.nome + " — Cardápio";

  var catRes = await cpSb.from("categorias").select("id,nome,ordem").eq("empresa_id", empresa.id).eq("ativo", true).order("ordem");
  var prodRes = await cpSb.from("produtos").select("id,nome,preco_centavos,esgotado,categoria_id,foto_url").eq("empresa_id", empresa.id).eq("ativo", true);
  var grupRes = await cpSb.from("grupos_opcoes").select("id,produto_id,nome,obrigatorio,minimo,maximo,ordem").order("ordem");
  var opcRes = await cpSb.from("opcoes").select("id,grupo_id,nome,preco_adicional_centavos,ordem").eq("ativo", true).order("ordem");

  var categorias = catRes.data || [];
  var produtos = prodRes.data || [];
  var grupos = grupRes.data || [];
  var opcoesPorGrupo = {};
  (opcRes.data||[]).forEach(function(o){
    if(!opcoesPorGrupo[o.grupo_id]) opcoesPorGrupo[o.grupo_id] = [];
    opcoesPorGrupo[o.grupo_id].push(o);
  });
  var gruposPorProduto = {};
  grupos.forEach(function(g){
    if(!gruposPorProduto[g.produto_id]) gruposPorProduto[g.produto_id] = [];
    gruposPorProduto[g.produto_id].push(g);
  });
  var porCategoria = {};
  categorias.forEach(function(c){ porCategoria[c.id] = []; });
  produtos.forEach(function(p){
    if(!porCategoria[p.categoria_id]) porCategoria[p.categoria_id] = [];
    porCategoria[p.categoria_id].push(p);
  });

  var html = '<div class="cp-header"><h1>'+cpEscapeHtml(empresa.nome)+'</h1><p>Cardápio</p></div>';

  // Fase 5 (Marketing) — banner opcional, configurado em Marketing > Banner
  // do cardápio (só texto+produto, nunca o config inteiro — ver 0062).
  if(empresa.banner_ativo && (empresa.banner_texto||empresa.produto_destaque_id)){
    var produtoDestaque = empresa.produto_destaque_id ? produtos.find(function(p){ return p.id===empresa.produto_destaque_id; }) : null;
    html += '<div class="cp-banner">'+
      (empresa.banner_texto ? '<div class="cp-banner-texto">'+cpEscapeHtml(empresa.banner_texto)+'</div>' : '')+
      (produtoDestaque ? '<div class="cp-banner-produto">'+
        (produtoDestaque.foto_url ? '<img src="'+cpEscapeHtml(produtoDestaque.foto_url)+'" alt="">' : '')+
        '<div><div class="cp-banner-produto-nome">'+cpEscapeHtml(produtoDestaque.nome)+'</div>'+
        '<div class="cp-banner-produto-preco">'+cpBrl(produtoDestaque.preco_centavos)+'</div></div>'+
      '</div>' : '')+
    '</div>';
  }

  var temAlgumProduto = false;
  categorias.forEach(function(c){
    var itens = porCategoria[c.id] || [];
    if(!itens.length) return;
    temAlgumProduto = true;
    html += '<div class="cp-categoria"><h2>'+cpEscapeHtml(c.nome)+'</h2><div class="cp-grid">'+
      itens.map(function(p){
        var gruposProd = gruposPorProduto[p.id]||[];
        var temObrigatorio = gruposProd.some(function(g){ return g.obrigatorio; });
        var opcoesHtml = gruposProd.map(function(g){
          var ops = opcoesPorGrupo[g.id]||[];
          if(!ops.length) return "";
          return '<div class="cp-opcoes-grupo"><b>'+cpEscapeHtml(g.nome)+(g.obrigatorio?' (obrigatório)':' (opcional)')+':</b> '+
            ops.map(function(o){ return cpEscapeHtml(o.nome)+(o.preco_adicional_centavos>0?' (+'+cpBrl(o.preco_adicional_centavos)+')':''); }).join(", ")+
          '</div>';
        }).join("");
        var podePedir = cpMesaNumero && !p.esgotado && !temObrigatorio;
        return '<div class="cp-item'+(p.esgotado?' cp-esgotado':'')+'" data-produto="'+p.id+'">'+
          (p.foto_url ? '<img class="cp-thumb" src="'+cpEscapeHtml(p.foto_url)+'" onerror="this.style.display=\'none\'">' : '')+
          '<div class="cp-item-nome">'+cpEscapeHtml(p.nome)+'</div>'+
          (p.esgotado ? '<div class="cp-item-preco cp-esgotado-label">Esgotado</div>' : '<div class="cp-item-preco">'+cpBrl(p.preco_centavos)+'</div>')+
          opcoesHtml+
          (cpMesaNumero && temObrigatorio && !p.esgotado ? '<div class="cp-opcoes-grupo">Peça direto com o garçom</div>' : '')+
          (podePedir ? '<div class="cp-qty-ctrl"><button class="cp-qty-btn" data-cp-menos="'+p.id+'">−</button><span id="cp-qtd-'+p.id+'">0</span><button class="cp-qty-btn" data-cp-mais="'+p.id+'">+</button></div>' : '')+
        '</div>';
      }).join("")+
    '</div></div>';
  });
  if(!temAlgumProduto) html += '<div class="cp-erro">Nenhum produto disponível no momento.</div>';

  html += '<div class="cp-footer-marca">feito com Vision Food</div>';
  if(cpMesaNumero) html += '<div style="height:70px;"></div>'; // espaço pra barra fixa não cobrir o rodapé

  root.innerHTML = html;

  if(cpMesaNumero){
    cpProdutosPorId = {};
    produtos.forEach(function(p){ cpProdutosPorId[p.id] = p; });
    root.onclick = function(e){
      var btnMais = e.target.closest("[data-cp-mais]");
      var btnMenos = e.target.closest("[data-cp-menos]");
      var pid = btnMais ? btnMais.dataset.cpMais : (btnMenos ? btnMenos.dataset.cpMenos : null);
      if(!pid) return;
      var produto = cpProdutosPorId[pid];
      if(!produto) return;
      cpAlterarCarrinho(produto, btnMais?1:-1);
      var span = document.getElementById("cp-qtd-"+pid);
      if(span) span.textContent = cpCarrinho[pid] ? cpCarrinho[pid].qtd : 0;
    };
  }
}

var cpProdutosPorId = {};

document.addEventListener("DOMContentLoaded", function(){
  cpCarregar();
});
