"use strict";
// PRIORIDADE 10 — Painel pelo celular: service worker só pra permitir
// "Adicionar à tela inicial" e dar uma sobrevida ao app-shell numa queda
// de conexão (o app já tem fila própria pra lançar item/KDS/receber em
// dinheiro offline, assets/js/offline.js — sem o shell carregado, essa
// fila nem aparece).
//
// [DECISÃO DE DESIGN] estratégia é sempre network-first, nunca
// cache-first: o app está em desenvolvimento ativo (schema e regra de
// negócio mudam toda semana) — servir um JS velho do cache por padrão
// podia rodar lógica desatualizada contra um banco novo sem ninguém
// perceber. O cache só entra como fallback quando a rede falha de
// verdade, e só pra arquivo estático do próprio site (nunca pra chamada
// da Supabase — essa nunca passa por aqui, é outro domínio).
var CACHE_NAME = "vision-food-shell-v1";

self.addEventListener("install", function(e){
  self.skipWaiting();
});
self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(nomes){
      return Promise.all(nomes.filter(function(n){ return n !== CACHE_NAME; }).map(function(n){ return caches.delete(n); }));
    }).then(function(){ return self.clients.claim(); })
  );
});
self.addEventListener("fetch", function(e){
  if(e.request.method !== "GET") return;
  var url = new URL(e.request.url);
  if(url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request).then(function(resposta){
      var copia = resposta.clone();
      caches.open(CACHE_NAME).then(function(cache){ cache.put(e.request, copia); });
      return resposta;
    }).catch(function(){
      return caches.match(e.request).then(function(cacheada){
        if(cacheada) return cacheada;
        if(e.request.mode==="navigate") return caches.match("/index.html");
        return undefined;
      });
    })
  );
});
