// スマホ版を端末内に丸ごと保存し、電波が無くても起動できるようにする。
// HTMLだけでなく、そこから読み込まれる JS / CSS も一緒に保存するのが要点。
//
// 更新の考え方:
//   開くときは保存済みのページをすぐ返す（電波が無くても開ける）。
//   そのうえで裏でページを取り直し、中身が変わっていたら
//   **新しい JS / CSS をそろえてから** 保存済みのページを差し替える。
//   次に開いたときに新しい版へ切り替わる。
//   ページを先に差し替えると、次にオフラインで開いたときに
//   新しいページがまだ保存していない JS を探して起動できなくなる。
const CACHE = "ideaboard-mobile-v2";
const PAGE = "./mobile.html";

const abs = (u) => new URL(u, self.registration.scope).href;

// ページの中で読み込んでいる、同じサイトのファイルを集める
function assetsOf(html) {
  const urls = new Set(["./mobile-manifest.webmanifest", "./icon-192.png", "./icon-512.png"].map(abs));
  const re = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html))) {
    const u = m[1];
    if (/^(https?:)?\/\//.test(u) || u.startsWith("data:")) continue; // 外部のものは対象外
    urls.add(abs(u));
  }
  return urls;
}

// 新しい版が出ていれば取り込む。取り込んだら true。
async function update() {
  const cache = await caches.open(CACHE);
  let res;
  try {
    res = await fetch(PAGE, { cache: "reload" }); // ページ本体だけは毎回確かめる（数KB）
  } catch (e) {
    return false;                                 // 電波が無いときは何もしない
  }
  if (!res || !res.ok) return false;

  const html = await res.clone().text();
  const hit = await cache.match(PAGE, { ignoreSearch: true });
  if (hit && (await hit.text()) === html) return false; // 変わっていなければ何もしない

  // 先に中身をそろえる
  const urls = assetsOf(html);
  await Promise.all(
    [...urls].map((u) =>
      fetch(u, { cache: "reload" })
        .then((r) => (r && r.ok ? cache.put(u, r) : null))
        .catch(() => null)
    )
  );
  // そろってからページを差し替える
  await cache.put(PAGE, res);

  // 使われなくなった古いファイルを片づける（版を重ねても膨らまないように）
  const keep = new Set([...urls, abs(PAGE)]);
  for (const k of await cache.keys()) {
    const u = new URL(k.url);
    u.search = "";
    if (!keep.has(u.href)) await cache.delete(k);
  }
  return true;
}

self.addEventListener("install", (e) => {
  e.waitUntil(update());
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // 自分の古い版だけ消す（PC 版 sw.js の保存分は同じサイトにあるので触らない）
      await Promise.all(keys.filter((k) => k.startsWith("ideaboard-mobile-") && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
      await update(); // 制御を取った直後にも取りこぼしを埋める
    })()
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return;          // PCとの通信は素通し
  if (url.origin !== self.location.origin) return;       // 別サイトのものは扱わない

  // ページを開くときは、まず保存済みのページを返す（電波が無くても開ける）。
  // そのうえで裏で新しい版を取りに行く（切り替わるのは次に開いたとき）。
  if (req.mode === "navigate") {
    // このページ以外（PC 版など）は扱わない。旧版の登録が残っている端末で PC 版がスマホ版に化けないように
    if (url.href.split(/[?#]/)[0] !== abs(PAGE)) return;
    e.respondWith(
      caches.match(PAGE, { ignoreSearch: true }).then((hit) => hit || fetch(req).catch(() => caches.match(PAGE, { ignoreSearch: true })))
    );
    e.waitUntil(update());
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
