// Offline-Betrieb: App-Dateien, Bibliotheken und Kartenkacheln aus dem Cache.
const APP = "app-v4", LIB = "lib-v1", KACHELN = "kacheln-v1";
const APP_DATEIEN = ["./", "index.html", "app.css", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png",
  "main.js", "store.js", "geo.js", "dem.js", "karte.js", "ui.js", "planen.js", "vorschlag.js", "standards.js", "aufnehmen.js", "blatt.js", "daten.js"];
const LIBS = ["https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js", "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css",
  "https://unpkg.com/maplibre-contour@0.1.0/dist/index.min.js", "https://cdn.jsdelivr.net/npm/proj4@2.12.1/dist/proj4.js",
  "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"];
const KACHEL_HOSTS = ["maps.wien.gv.at", "mapsneu.wien.gv.at", "elevation-tiles-prod.s3.amazonaws.com", "demotiles.maplibre.org"];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    await (await caches.open(APP)).addAll(APP_DATEIEN);
    const lib = await caches.open(LIB);
    await Promise.all(LIBS.map(async u => { if (!(await lib.match(u))) await lib.add(new Request(u, { mode: "cors" })); }));
    self.skipWaiting();
  })());
});
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.origin === location.origin) {
    // App: zuerst Netz (immer aktuell), offline aus dem Cache
    e.respondWith(fetch(r, { cache: "no-cache" }).then(res => {
      if (res.ok) { const c = res.clone(); caches.open(APP).then(x => x.put(r, c)); }
      return res;
    }).catch(() => caches.match(r, { ignoreSearch: true }).then(x => x || caches.match("index.html"))));
  } else if (KACHEL_HOSTS.includes(u.hostname)) {
    // Kacheln: zuerst Cache; neu geladene werden mitgespeichert
    e.respondWith(caches.open(KACHELN).then(async c => {
      const hit = await c.match(r.url); if (hit) return hit;
      try {
        const res = await fetch(r.url, { mode: "cors" });
        if (res.ok) c.put(r.url, res.clone());
        return res;
      } catch { return new Response("", { status: 504 }); }
    }));
  } else if (LIBS.includes(r.url)) {
    e.respondWith(caches.match(r.url).then(x => x || fetch(r)));
  }
});
