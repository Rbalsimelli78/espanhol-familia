// Service worker: guarda os arquivos do app para abrir mais rápido e funcionar com internet fraca.
// Ao publicar uma versão nova, aumente o número abaixo.
const VERSAO = "esp-v2";
const ARQUIVOS = ["./", "index.html", "styles.css", "app.js", "content.js", "firebase-config.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Rede primeiro (pega sempre a versão mais nova); se estiver sem internet, usa a cópia guardada.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copia = r.clone(); caches.open(VERSAO).then((c) => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request))
  );
});
