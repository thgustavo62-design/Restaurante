"use strict";

// Fase 3.5 [NOVO] — contingência sem internet: cache do "app shell"
// (HTML/JS/CSS) pra tela continuar abrindo offline. Estratégia
// network-first (tenta a rede, só cai pro cache se a rede falhar) — nunca
// serve versão velha do app por padrão quando há internet, só quando não
// tem jeito. Nunca cacheia chamada pro Supabase (dado tem que ser sempre
// fresco ou passar pela fila offline, nunca um cache de API escondido).

var CACHE_NAME = "visionfood-shell-v1";

self.addEventListener("install", function(e){
  self.skipWaiting();
});
self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(nomes){
      return Promise.all(nomes.filter(function(n){ return n!==CACHE_NAME; }).map(function(n){ return caches.delete(n); }));
    }).then(function(){ return self.clients.claim(); })
  );
});
self.addEventListener("fetch", function(e){
  var url = new URL(e.request.url);
  if(url.hostname.indexOf("supabase.co")!==-1) return; // API/dados: sempre rede, nunca cache
  if(e.request.method!=="GET") return;
  if(url.origin!==self.location.origin) return; // fontes do Google etc.: deixa o navegador cuidar

  e.respondWith(
    fetch(e.request).then(function(res){
      var copia = res.clone();
      caches.open(CACHE_NAME).then(function(cache){ cache.put(e.request, copia); });
      return res;
    }).catch(function(){
      return caches.match(e.request).then(function(cached){
        if(cached) return cached;
        if(e.request.mode==="navigate") return caches.match("/index.html");
        return undefined;
      });
    })
  );
});
