// スマホ版を端末内に丸ごと保存し、電波が無くても起動できるようにする。
// HTMLだけでなく、そこから読み込まれる JS / CSS も一緒に保存するのが要点。
const CACHE = "ideaboard-mobile-v2";
const PAGE = "./mobile.html";

async function precache() {
  const cache = await caches.open(CACHE);
  const urls = new Set([PAGE, "./mobile-manifest.webmanifest", "./icon-192.png", "./icon-512.png"]);
  try {
    // ページ本体を取得し、その中で読み込まれているファイルも全部集める
    const res = await fetch(PAGE, { cache: "reload" });
    if (res && res.ok) {
      await cache.put(PAGE, res.clone());
      const html = await res.text();
      const re = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
      let m;
      while ((m = re.exec(html))) {
        const u = m[1];
        if (/^(https?:)?\/\//.test(u) || u.startsWith("data:")) continue; // 外部のものは対象外
        urls.add(new URL(u, self.registration.scope).href);
      }
    }
  } catch (e) { /* 取得できないものは後でキャッシュされる */ }

  await Promise.all(
    [...urls].map((u) =>
      fetch(u, { cache: "reload" })
        .then((r) => (r && r.ok ? cache.put(u, r) : null))
        .catch(() => null)
    )
  );
}

self.addEventListener("install", (e) => {
  e.waitUntil(precache());
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
      await precache(); // 制御を取った直後にも取りこぼしを埋める
    })()
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return;          // PCとの通信は素通し
  if (url.origin !== self.location.origin) return;       // 別サイトのものは扱わない

  // ページを開くときは、まず保存済みのページを返す（電波が無くても開ける）
  if (req.mode === "navigate") {
    e.respondWith(
      caches.match(PAGE, { ignoreSearch: true }).then((hit) => hit || fetch(req).catch(() => caches.match(PAGE)))
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) {
        fetch(req).then((res) => {
          if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        }).catch(() => {});
        return hit;
      }
      return fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(PAGE, { ignoreSearch: true }));
    })
  );
});
