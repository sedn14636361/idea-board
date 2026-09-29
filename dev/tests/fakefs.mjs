// 仕様どおりの偽 Firestore（projects/{room}/items と inbox/{room}/items）。
// - 文書ごとにサーバー時刻 updateTime を持ち、書くたびに単調に増える（マイクロ秒）
// - PATCH と DELETE の currentDocument.updateTime / currentDocument.exists を守る。合わなければ 400 FAILED_PRECONDITION
// - POST ?documentId= は作成だけ。同じ ID があれば 409 ALREADY_EXISTS
// - 条件なしの DELETE は、文書が無くても成功する
// - 1件 1MiB を超える書き込みは拒否
// - 一覧は __name__ 昇順・pageSize ごとのページ
// - hooks.beforeWrite(id) が false を返したら、その書き込みを通信断として失敗させる
export function makeFakeFirestore() {
  const DB = new Map();                 // projects の id → { fields, updateTime }
  const INBOX = new Map();              // inbox の id → { fields, updateTime }
  let tick = Date.parse("2026-01-01T00:00:00Z") * 1000;   // マイクロ秒
  const stamp = () => { tick += 1 + Math.floor(Math.random() * 5); const ms = Math.floor(tick / 1000);
    return new Date(ms).toISOString().replace("Z", "").replace(/\.\d+$/, "") + "." + String(tick % 1000000).padStart(6, "0") + "Z"; };
  const hooks = { beforeWrite: null, delay: null };
  const LIMIT = 1048576;
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const docName = (col, id) => `projects/p/databases/(default)/documents/${col}/r/items/` + id;
  // 条件を満たさなければ、そのときの返事を返す
  const unmet = (cur, q) => {
    const wantUt = q.get("currentDocument.updateTime");
    const wantEx = q.get("currentDocument.exists");
    if (wantUt && (!cur || cur.updateTime !== wantUt)) return res(400, { error: { status: "FAILED_PRECONDITION" } });
    if (wantEx === "false" && cur) return res(400, { error: { status: "FAILED_PRECONDITION" } });
    if (wantEx === "true" && !cur) return res(404, { error: { status: "NOT_FOUND" } });
    return null;
  };

  async function fetch(url, opt = {}) {
    const u = String(url);
    if (hooks.delay) await hooks.delay(u, opt);
    if (u.includes("identitytoolkit") || u.includes("securetoken"))
      return res(200, { idToken: "T", refreshToken: "R", id_token: "T", refresh_token: "R" });
    const m = u.match(/\/documents\/(projects|inbox)\/[^/]+\/items(?:\/([^?]+))?(\?.*)?$/);
    if (!m) return res(200, {});
    const col = m[1];
    const store = col === "inbox" ? INBOX : DB;
    const id = m[2] ? decodeURIComponent(m[2]) : null;
    const q = new URLSearchParams((m[3] || "").slice(1));
    const method = opt.method || "GET";
    const put = (key, fields) => {
      if (Buffer.byteLength(JSON.stringify(fields)) > LIMIT) return res(400, { error: { status: "INVALID_ARGUMENT" } });
      const updateTime = stamp();
      store.set(key, { fields, updateTime });
      return res(200, { name: docName(col, key), fields, updateTime });
    };
    if (method === "POST" && !id) {
      const key = q.get("documentId");
      if (hooks.beforeWrite && hooks.beforeWrite(key) === false) throw new TypeError("Failed to fetch");
      if (store.has(key)) return res(409, { error: { status: "ALREADY_EXISTS" } });
      return put(key, JSON.parse(opt.body).fields);
    }
    if (method === "PATCH") {
      if (hooks.beforeWrite && hooks.beforeWrite(id) === false) throw new TypeError("Failed to fetch");
      const bad = unmet(store.get(id), q);
      if (bad) return bad;
      return put(id, JSON.parse(opt.body).fields);
    }
    if (method === "DELETE") {
      const bad = unmet(store.get(id), q);
      if (bad) return bad;
      store.delete(id);
      return res(200, {});
    }
    if (id) {
      const cur = store.get(id);
      if (!cur) return res(404, { error: { status: "NOT_FOUND" } });
      return res(200, { name: docName(col, id), fields: cur.fields, updateTime: cur.updateTime });
    }
    const size = Number(q.get("pageSize") || 1000);
    const from = Number(q.get("pageToken") || 0);
    const all = [...store.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const page = all.slice(from, from + size);
    return res(200, { documents: page.map(([k, v]) => ({ name: docName(col, k), fields: v.fields, updateTime: v.updateTime })),
      ...(from + size < all.length ? { nextPageToken: String(from + size) } : {}) });
  }
  return { DB, INBOX, fetch, hooks };
}
