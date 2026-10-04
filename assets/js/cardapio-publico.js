"use strict";

// Página pública (sem login) do cardápio digital, lida via QR na mesa.
// Deliberadamente um script à parte do app autenticado: não carrega PIN,
// permissões, Realtime nem nenhuma tela interna — só lê nome/preço/esgotado/
// categoria/foto de produtos e categorias ATIVOS, via as policies RLS
// "*_select_publico" (to anon) criadas em 0030_cardapio_publico_restaurante.sql.
//
// Fase 5 (continuação) — cardápio "completo": produto com opções/adicionais
// (obrigatórios ou não) agora pode ser pedido pelo QR também, escolhendo as
// opções num modal antes de entrar no carrinho (antes só dava pra pedir
// produto sem nenhuma opção — o resto exigia "peça com o garçom"). Busca e
// navegação por categoria pra achar algo rápido num cardápio grande.

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
var cpEnviando = false;
var cpPedidoEnviado = false;
var cpBusca = "";
var cpDados = null; // {empresa, categorias, produtos, porCategoria}
var cpProdutosPorId = {};
var cpGruposPorProduto = {};
var cpOpcoesPorGrupo = {};

// carrinho: chave = produtoId, ou produtoId+"|"+opcaoIds-ordenados (uma
// combinação diferente de opções é uma linha diferente no carrinho, mesmo
// sendo o mesmo produto — ex: "Picanha (ao ponto)" e "Picanha (mal passada)"
// não podem ser a mesma linha).
var cpCarrinho = {};

function cpChaveCarrinho(produtoId, opcoes){
  var ids = (opcoes||[]).map(function(o){ return o.id; }).sort();
  return produtoId + (ids.length ? "|"+ids.join(",") : "");
}
function cpPrecoUnitLinha(linha){
  var adicional = (linha.opcoes||[]).reduce(function(s,o){ return s+(o.preco_adicional_centavos||0); },0);
  return linha.produto.preco_centavos + adicional;
}
function cpTotalCarrinho(){
  return Object.keys(cpCarrinho).reduce(function(s,k){ var l=cpCarrinho[k]; return s+cpPrecoUnitLinha(l)*l.qtd; },0);
}
function cpQtdCarrinho(){
  return Object.keys(cpCarrinho).reduce(function(s,k){ return s+cpCarrinho[k].qtd; },0);
}
// produto SEM nenhum grupo de opção: +/- direto no card, mesma chave = produtoId.
function cpAlterarCarrinhoSimples(produto, delta){
  var chave = produto.id;
  var atual = cpCarrinho[chave] ? cpCarrinho[chave].qtd : 0;
  var novo = Math.max(0, atual+delta);
  if(novo===0) delete cpCarrinho[chave];
  else cpCarrinho[chave] = {produto:produto, opcoes:[], qtd:novo};
  cpRenderBarra();
}
// produto COM grupo de opção: sempre passa pelo modal, que soma na linha
// certa (ou cria uma nova) conforme a combinação de opções escolhida.
function cpAdicionarAoCarrinho(produto, opcoes, qtd){
  var chave = cpChaveCarrinho(produto.id, opcoes);
  var atual = cpCarrinho[chave] ? cpCarrinho[chave].qtd : 0;
  cpCarrinho[chave] = {produto:produto, opcoes:opcoes||[], qtd:atual+qtd};
  cpRenderBarra();
}
function cpAlterarQtdLinha(chave, delta){
  var linha = cpCarrinho[chave];
  if(!linha) return;
  var novo = Math.max(0, linha.qtd+delta);
  if(novo===0) delete cpCarrinho[chave]; else linha.qtd = novo;
}
function cpRemoverLinha(chave){
  delete cpCarrinho[chave];
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

// ---------- modal de opções (escolher adicionais/variações antes de entrar no carrinho) ----------

function cpAbrirOpcoesModal(produtoId){
  var produto = cpProdutosPorId[produtoId];
  if(!produto) return;
  var grupos = cpGruposPorProduto[produtoId]||[];
  var selecionados = {}; // grupoId -> [opcaoId,...]
  grupos.forEach(function(g){ selecionados[g.id] = []; });
  var qtd = 1;

  function desenhar(){
    var overlay = document.getElementById("cp-overlay");
    overlay.style.display = "flex";
    overlay.innerHTML = '<div class="cp-modal">'+
      '<h2>'+cpEscapeHtml(produto.nome)+'</h2>'+
      (produto.foto_url ? '<img class="cp-modal-foto" src="'+cpEscapeHtml(produto.foto_url)+'" onerror="this.style.display=\'none\'">' : '')+
      grupos.map(function(g){
        var ops = cpOpcoesPorGrupo[g.id]||[];
        if(!ops.length) return "";
        return '<div class="cp-opcoes-bloco">'+
          '<div class="cp-opcoes-titulo">'+cpEscapeHtml(g.nome)+
            (g.obrigatorio ? '<span class="cp-tag-obrig">obrigatório</span>' : '<span class="cp-tag-opc">opcional</span>')+
            '<span class="cp-opcoes-regra">'+(g.maximo>1 ? 'até '+g.maximo : 'escolha 1')+'</span>'+
          '</div>'+
          ops.map(function(o){
            var marcado = selecionados[g.id].indexOf(o.id)!==-1;
            return '<label class="cp-opcao-linha">'+
              '<input type="checkbox" data-grupo="'+g.id+'" data-opcao="'+o.id+'" data-maximo="'+g.maximo+'" '+(marcado?"checked":"")+'>'+
              '<span>'+cpEscapeHtml(o.nome)+(o.preco_adicional_centavos>0?' (+'+cpBrl(o.preco_adicional_centavos)+')':'')+'</span>'+
            '</label>';
          }).join("")+
        '</div>';
      }).join("")+
      '<div class="cp-qty-ctrl">'+
        '<span>Quantidade</span>'+
        '<div style="display:flex; align-items:center; gap:10px;">'+
          '<button class="cp-qty-btn" id="cp-opc-menos" type="button">−</button>'+
          '<span id="cp-opc-qtd">'+qtd+'</span>'+
          '<button class="cp-qty-btn" id="cp-opc-mais" type="button">+</button>'+
        '</div>'+
      '</div>'+
      '<div id="cp-opc-erro" class="cp-erro-inline"></div>'+
      '<div class="cp-modal-acoes">'+
        '<button class="cp-btn-secundario" id="cp-opc-cancelar" type="button">Cancelar</button>'+
        '<button class="cp-btn-pedido" id="cp-opc-confirmar" type="button">Adicionar · '+cpBrl((produto.preco_centavos)*qtd)+'</button>'+
      '</div>'+
    '</div>';

    overlay.querySelectorAll("input[data-grupo]").forEach(function(inp){
      inp.onchange = function(){
        var gid = inp.dataset.grupo, oid = inp.dataset.opcao, max = parseInt(inp.dataset.maximo,10)||1;
        var lista = selecionados[gid];
        if(inp.checked){
          if(lista.length>=max){
            // estourou o máximo do grupo — tira a escolha mais antiga pra
            // abrir espaço (comportamento tipo "só a última vale" quando
            // máximo=1, sem travar o clique)
            var removida = lista.shift();
            var inputAntigo = overlay.querySelector('input[data-grupo="'+gid+'"][data-opcao="'+removida+'"]');
            if(inputAntigo) inputAntigo.checked = false;
          }
          lista.push(oid);
        } else {
          selecionados[gid] = lista.filter(function(id){ return id!==oid; });
        }
        atualizarBotaoConfirmar();
      };
    });
    document.getElementById("cp-opc-menos").onclick = function(){ if(qtd>1){ qtd--; document.getElementById("cp-opc-qtd").textContent=qtd; atualizarBotaoConfirmar(); } };
    document.getElementById("cp-opc-mais").onclick = function(){ qtd++; document.getElementById("cp-opc-qtd").textContent=qtd; atualizarBotaoConfirmar(); };
    document.getElementById("cp-opc-cancelar").onclick = function(){ overlay.style.display="none"; };
    document.getElementById("cp-opc-confirmar").onclick = function(){
      for(var i=0;i<grupos.length;i++){
        var g = grupos[i];
        if(g.obrigatorio && selecionados[g.id].length < g.minimo){
          document.getElementById("cp-opc-erro").textContent = 'Escolha pelo menos '+g.minimo+' opção em "'+g.nome+'"';
          return;
        }
      }
      var opcoesEscolhidas = [];
      grupos.forEach(function(g){
        (cpOpcoesPorGrupo[g.id]||[]).forEach(function(o){
          if(selecionados[g.id].indexOf(o.id)!==-1) opcoesEscolhidas.push(o);
        });
      });
      cpAdicionarAoCarrinho(produto, opcoesEscolhidas, qtd);
      overlay.style.display = "none";
    };
    atualizarBotaoConfirmar();
  }
  function atualizarBotaoConfirmar(){
    var adicional = 0;
    grupos.forEach(function(g){
      (cpOpcoesPorGrupo[g.id]||[]).forEach(function(o){
        if(selecionados[g.id].indexOf(o.id)!==-1) adicional += (o.preco_adicional_centavos||0);
      });
    });
    var btn = document.getElementById("cp-opc-confirmar");
    if(btn) btn.textContent = "Adicionar · "+cpBrl((produto.preco_centavos+adicional)*qtd);
  }
  desenhar();
}

// ---------- revisão do carrinho ----------

function cpAbrirRevisao(){
  var overlay = document.getElementById("cp-overlay");
  overlay.style.display = "flex";
  cpDesenharRevisao();
}
function cpDesenharRevisao(){
  var overlay = document.getElementById("cp-overlay");
  var chaves = Object.keys(cpCarrinho);
  if(!chaves.length){ overlay.style.display = "none"; cpRenderBarra(); return; }
  overlay.innerHTML = '<div class="cp-modal">'+
    '<h2>Seu pedido — Mesa '+cpMesaNumero+'</h2>'+
    chaves.map(function(k){
      var l = cpCarrinho[k];
      var opcoesTxt = (l.opcoes||[]).map(function(o){ return o.nome; }).join(", ");
      return '<div class="cp-modal-linha" style="flex-direction:column; align-items:stretch;">'+
        '<div class="cp-linha-cabecalho">'+
          '<div><b>'+l.qtd+'x '+cpEscapeHtml(l.produto.nome)+'</b>'+
          (opcoesTxt ? '<div class="cp-linha-opcoes">'+cpEscapeHtml(opcoesTxt)+'</div>' : '')+'</div>'+
          '<div>'+cpBrl(cpPrecoUnitLinha(l)*l.qtd)+'</div>'+
        '</div>'+
        '<div class="cp-linha-acoes">'+
          '<button class="cp-qty-btn" data-cp-rev-menos="'+cpEscapeHtml(k)+'" type="button">−</button>'+
          '<span>'+l.qtd+'</span>'+
          '<button class="cp-qty-btn" data-cp-rev-mais="'+cpEscapeHtml(k)+'" type="button">+</button>'+
          '<button class="cp-linha-remover" data-cp-rev-remover="'+cpEscapeHtml(k)+'" type="button">Remover</button>'+
        '</div>'+
      '</div>';
    }).join("")+
    '<div class="cp-modal-linha cp-modal-total"><span>Total</span><span>'+cpBrl(cpTotalCarrinho())+'</span></div>'+
    '<textarea id="cp-observacao" placeholder="Alguma observação? (opcional)"></textarea>'+
    '<div id="cp-erro-pedido" class="cp-erro-inline"></div>'+
    '<div class="cp-modal-acoes">'+
      '<button class="cp-btn-secundario" id="cp-fechar-revisao" type="button">Voltar</button>'+
      '<button class="cp-btn-pedido" id="cp-enviar-pedido" type="button">Enviar pedido</button>'+
    '</div>'+
  '</div>';
  overlay.querySelectorAll("[data-cp-rev-mais]").forEach(function(b){ b.onclick=function(){ cpAlterarQtdLinha(b.dataset.cpRevMais,1); cpDesenharRevisao(); }; });
  overlay.querySelectorAll("[data-cp-rev-menos]").forEach(function(b){ b.onclick=function(){ cpAlterarQtdLinha(b.dataset.cpRevMenos,-1); cpDesenharRevisao(); }; });
  overlay.querySelectorAll("[data-cp-rev-remover]").forEach(function(b){ b.onclick=function(){ cpRemoverLinha(b.dataset.cpRevRemover); cpDesenharRevisao(); }; });
  document.getElementById("cp-fechar-revisao").onclick = function(){ overlay.style.display="none"; };
  document.getElementById("cp-enviar-pedido").onclick = cpEnviarPedido;
}
async function cpEnviarPedido(){
  if(cpEnviando) return;
  cpEnviando = true;
  var btn = document.getElementById("cp-enviar-pedido");
  if(btn) btn.disabled = true;
  var itens = Object.keys(cpCarrinho).map(function(k){
    var l = cpCarrinho[k];
    return {
      produto_id: l.produto.id, quantidade: l.qtd,
      opcoes_selecionadas: (l.opcoes||[]).map(function(o){ return {opcao_id:o.id}; })
    };
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
    '<button class="cp-btn-pedido" id="cp-fechar-sucesso" type="button">Fechar</button>'+
  '</div>';
  document.getElementById("cp-fechar-sucesso").onclick = function(){ document.getElementById("cp-overlay").style.display="none"; };
  cpRenderBarra();
}

// ---------- montagem do cardápio ----------

function cpItemHtml(p){
  var gruposProd = cpGruposPorProduto[p.id]||[];
  var temGrupos = gruposProd.some(function(g){ return (cpOpcoesPorGrupo[g.id]||[]).length>0; });
  var podePedir = !!cpMesaNumero && !p.esgotado;
  return '<div class="cp-item'+(p.esgotado?' cp-esgotado':'')+'" data-produto="'+p.id+'">'+
    (p.foto_url ? '<img class="cp-thumb" src="'+cpEscapeHtml(p.foto_url)+'" onerror="this.style.display=\'none\'">' : '')+
    '<div class="cp-item-nome">'+cpEscapeHtml(p.nome)+'</div>'+
    (p.esgotado ? '<div class="cp-item-preco cp-esgotado-label">Esgotado</div>' : '<div class="cp-item-preco">'+cpBrl(p.preco_centavos)+'</div>')+
    (temGrupos && !p.esgotado ? '<div class="cp-opcoes-info">Personalizável — escolha ao adicionar</div>' : '')+
    (podePedir ? (temGrupos
        ? '<button class="cp-btn-opcoes" data-cp-opcoes="'+p.id+'" type="button">Adicionar</button>'
        : '<div class="cp-qty-ctrl"><button class="cp-qty-btn" data-cp-menos="'+p.id+'" type="button">−</button><span id="cp-qtd-'+p.id+'">'+(cpCarrinho[p.id]?cpCarrinho[p.id].qtd:0)+'</span><button class="cp-qty-btn" data-cp-mais="'+p.id+'" type="button">+</button></div>'
      ) : '')+
  '</div>';
}
function cpCategoriasHtml(busca){
  var d = cpDados;
  var temAlgumProduto = false;
  var html = d.categorias.map(function(c){
    var itens = (d.porCategoria[c.id]||[]).filter(function(p){
      return !busca || p.nome.toLowerCase().indexOf(busca)!==-1;
    });
    if(!itens.length) return "";
    temAlgumProduto = true;
    return '<div class="cp-categoria" id="cp-cat-'+c.id+'"><h2>'+cpEscapeHtml(c.nome)+'</h2><div class="cp-grid">'+
      itens.map(cpItemHtml).join("")+
    '</div></div>';
  }).join("");
  if(!temAlgumProduto){
    html = '<div class="cp-erro">'+(busca ? 'Nenhum produto encontrado pra "'+cpEscapeHtml(busca)+'".' : 'Nenhum produto disponível no momento.')+'</div>';
  }
  return html;
}
function cpRenderCategorias(){
  var busca = cpBusca.trim().toLowerCase();
  document.getElementById("cp-categorias-container").innerHTML = cpCategoriasHtml(busca);
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

  cpOpcoesPorGrupo = {};
  (opcRes.data||[]).forEach(function(o){
    if(!cpOpcoesPorGrupo[o.grupo_id]) cpOpcoesPorGrupo[o.grupo_id] = [];
    cpOpcoesPorGrupo[o.grupo_id].push(o);
  });
  cpGruposPorProduto = {};
  grupos.forEach(function(g){
    if(!cpGruposPorProduto[g.produto_id]) cpGruposPorProduto[g.produto_id] = [];
    cpGruposPorProduto[g.produto_id].push(g);
  });
  var porCategoria = {};
  categorias.forEach(function(c){ porCategoria[c.id] = []; });
  produtos.forEach(function(p){
    if(!porCategoria[p.categoria_id]) porCategoria[p.categoria_id] = [];
    porCategoria[p.categoria_id].push(p);
  });
  cpProdutosPorId = {};
  produtos.forEach(function(p){ cpProdutosPorId[p.id] = p; });
  cpDados = {empresa:empresa, categorias:categorias, produtos:produtos, porCategoria:porCategoria};

  var html = '<div class="cp-header"><h1>'+cpEscapeHtml(empresa.nome)+'</h1><p>Cardápio</p></div>';

  // Fase 5 (Marketing) — banner opcional, configurado em Marketing > Banner
  // do cardápio (só texto+produto, nunca o config inteiro — ver 0062).
  if(empresa.banner_ativo && (empresa.banner_texto||empresa.produto_destaque_id)){
    var produtoDestaque = empresa.produto_destaque_id ? cpProdutosPorId[empresa.produto_destaque_id] : null;
    html += '<div class="cp-banner">'+
      (empresa.banner_texto ? '<div class="cp-banner-texto">'+cpEscapeHtml(empresa.banner_texto)+'</div>' : '')+
      (produtoDestaque ? '<div class="cp-banner-produto">'+
        (produtoDestaque.foto_url ? '<img src="'+cpEscapeHtml(produtoDestaque.foto_url)+'" alt="">' : '')+
        '<div><div class="cp-banner-produto-nome">'+cpEscapeHtml(produtoDestaque.nome)+'</div>'+
        '<div class="cp-banner-produto-preco">'+cpBrl(produtoDestaque.preco_centavos)+'</div></div>'+
      '</div>' : '')+
    '</div>';
  }

  html += '<div class="cp-topo">'+
    '<div class="cp-search">'+icon_search()+'<input id="cp-busca-input" placeholder="Buscar no cardápio..."></div>'+
    (categorias.length>1 ? '<div class="cp-nav-categorias">'+categorias.map(function(c){
      return '<div class="cp-nav-cat-item" data-cp-nav="'+c.id+'">'+cpEscapeHtml(c.nome)+'</div>';
    }).join("")+'</div>' : '')+
  '</div>';

  html += '<div id="cp-categorias-container">'+cpCategoriasHtml("")+'</div>';
  html += '<div class="cp-footer-marca">feito com Vision Food</div>';
  if(cpMesaNumero) html += '<div style="height:70px;"></div>'; // espaço pra barra fixa não cobrir o rodapé

  root.innerHTML = html;

  document.getElementById("cp-busca-input").oninput = function(e){
    cpBusca = e.target.value;
    cpRenderCategorias();
  };
  root.querySelectorAll("[data-cp-nav]").forEach(function(b){
    b.onclick = function(){
      var alvo = document.getElementById("cp-cat-"+b.dataset.cpNav);
      if(alvo) alvo.scrollIntoView({behavior:"smooth", block:"start"});
    };
  });

  if(cpMesaNumero){
    root.onclick = function(e){
      var btnMais = e.target.closest("[data-cp-mais]");
      var btnMenos = e.target.closest("[data-cp-menos]");
      var btnOpcoes = e.target.closest("[data-cp-opcoes]");
      if(btnOpcoes){ cpAbrirOpcoesModal(btnOpcoes.dataset.cpOpcoes); return; }
      var pid = btnMais ? btnMais.dataset.cpMais : (btnMenos ? btnMenos.dataset.cpMenos : null);
      if(!pid) return;
      var produto = cpProdutosPorId[pid];
      if(!produto) return;
      cpAlterarCarrinhoSimples(produto, btnMais?1:-1);
      var span = document.getElementById("cp-qtd-"+pid);
      if(span) span.textContent = cpCarrinho[pid] ? cpCarrinho[pid].qtd : 0;
    };
  }
}
function icon_search(){
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto; color:var(--text-muted);"><circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.3-4.3"></path></svg>';
}

document.addEventListener("DOMContentLoaded", function(){
  cpCarregar();
});
