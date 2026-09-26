// オフラインでも起動できるようにアプリ本体をキャッシュする
const CACHE = "ideaboard-v1";

self.addEventListener("install", () => { self.skipWaiting(); });

self.addEventListener("activate", (e) => {
  e.waitUntil(
    // 自分の古い版だけ消す（スマホ版 mobile-sw.js の保存分は同じサイトにあるので触らない）
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("ideaboard-v") && k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // スマホ版のページは mobile-sw.js に任せる
  if (e.request.mode === "navigate" && new URL(e.request.url).pathname.endsWith("/mobile.html")) return;
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
