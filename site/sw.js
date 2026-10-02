/* Finanças Flow — service worker
 * - HTML (navegação): rede primeiro, cópia do cache se estiver offline.
 * - /vendor/*, /icons/* e arquivos com ?v=...: cache primeiro (versionados/estáveis).
 * - Demais estáticos do próprio site (engine.js, store.js, manifest...): rede primeiro também,
 *   para o HTML novo nunca rodar com JS velho; o cache só serve offline.
 * - NUNCA intercepta nem guarda /api/* nem /.netlify/* (dados e login sempre direto na rede).
 */
'use strict';
// Ao trocar um arquivo em /vendor ou /icons (sem mudar o nome), aumente VERSION.
const VERSION = 'ff-v2-3';
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;
const PRECACHE = [
  '/',
  '/app.js',
  '/app.css',
  '/engine.js',
  '/store.js',
  '/vendor/xlsx.full.min.js',
  '/manifest.webmanifest',
  '/vendor/netlify-identity.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // um arquivo faltando não pode impedir a instalação
    await Promise.all(PRECACHE.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function neverCache(url) {
  return url.pathname.startsWith('/api/') || url.pathname === '/api' || url.pathname.startsWith('/.netlify/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fontes do Google etc.: cache normal do navegador
  if (neverCache(url)) return;                     // dados e login: sempre rede, nunca cache
  if (req.headers.has('authorization')) return;

  const isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isNav) { event.respondWith(networkFirst(req, true)); return; }

  const versioned = url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/icons/') || url.searchParams.has('v');
  event.respondWith(versioned ? cacheFirst(req) : networkFirst(req));
});

function cacheable(res) {
  if (!res || !res.ok || res.type === 'opaque') return false;
  const cc = res.headers.get('cache-control') || '';
  return !/no-store|private/i.test(cc);
}

async function networkFirst(req, isNav) {
  const cache = await caches.open(SHELL);
  const key = isNav ? '/' : new URL(req.url).pathname;
  try {
    const res = await fetch(req);
    if (cacheable(res)) cache.put(key, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return hit;
    if (!isNav) return Response.error();
    return new Response('<!doctype html><meta charset="utf-8"><title>Sem conexão</title><p style="font-family:system-ui;padding:24px">Sem conexão. Abra de novo quando a internet voltar.</p>', { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(STATIC);
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) cache.put(req, res.clone()).catch(() => {});
  return res;
}
