// オフラインでも起動できるようにアプリ本体をキャッシュする
const CACHE = "ideaboard-v1";

self.addEventListener("install", () => { self.skipWaiting(); });

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) {
        fetch(e.request).then((res) => {
          if (res && res.status === 200) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        }).catch(() => {});
        return hit;
      }
      return fetch(e.request)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
