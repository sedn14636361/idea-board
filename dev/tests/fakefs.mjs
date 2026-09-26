// 仕様どおりの偽 Firestore（projects/{room}/items だけ）。
// - 文書ごとにサーバー時刻 updateTime を持ち、書くたびに単調に増える（マイクロ秒）
// - PATCH の currentDocument.updateTime / currentDocument.exists を守る。合わなければ 400 FAILED_PRECONDITION
// - 1件 1MiB を超える書き込みは拒否
// - 一覧は __name__ 昇順・pageSize ごとのページ
// - hooks.beforeWrite(id) が false を返したら、その書き込みを通信断として失敗させる
export function makeFakeFirestore() {
  const DB = new Map();                 // id → { fields, updateTime }
  let tick = Date.parse("2026-01-01T00:00:00Z") * 1000;   // マイクロ秒
  const stamp = () => { tick += 1 + Math.floor(Math.random() * 5); const ms = Math.floor(tick / 1000);
    return new Date(ms).toISOString().replace("Z", "").replace(/\.\d+$/, "") + "." + String(tick % 1000000).padStart(6, "0") + "Z"; };
  const hooks = { beforeWrite: null, delay: null };
  const LIMIT = 1048576;
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const docName = (id) => "projects/p/databases/(default)/documents/projects/r/items/" + id;

  async function fetch(url, opt = {}) {
    const u = String(url);
    if (hooks.delay) await hooks.delay(u, opt);
    if (u.includes("identitytoolkit") || u.includes("securetoken"))
      return res(200, { idToken: "T", refreshToken: "R", id_token: "T", refresh_token: "R" });
    const m = u.match(/\/documents\/projects\/[^/]+\/items(?:\/([^?]+))?(\?.*)?$/);
    if (!m) return res(200, {});
    const id = m[1] ? decodeURIComponent(m[1]) : null;
    const q = new URLSearchParams((m[2] || "").slice(1));
    const method = opt.method || "GET";
    if (method === "PATCH") {
      if (hooks.beforeWrite && hooks.beforeWrite(id) === false) throw new TypeError("Failed to fetch");
      const cur = DB.get(id);
      const wantUt = q.get("currentDocument.updateTime");
      const wantEx = q.get("currentDocument.exists");
      if (wantUt && (!cur || cur.updateTime !== wantUt)) return res(400, { error: { status: "FAILED_PRECONDITION" } });
      if (wantEx === "false" && cur) return res(400, { error: { status: "FAILED_PRECONDITION" } });
      if (wantEx === "true" && !cur) return res(404, { error: { status: "NOT_FOUND" } });
      const fields = JSON.parse(opt.body).fields;
      if (Buffer.byteLength(JSON.stringify(fields)) > LIMIT) return res(400, { error: { status: "INVALID_ARGUMENT" } });
      const updateTime = stamp();
      DB.set(id, { fields, updateTime });
      return res(200, { name: docName(id), fields, updateTime });
    }
    if (method === "DELETE") { DB.delete(id); return res(200, {}); }
    if (id) {
      const cur = DB.get(id);
      if (!cur) return res(404, { error: { status: "NOT_FOUND" } });
      return res(200, { name: docName(id), fields: cur.fields, updateTime: cur.updateTime });
    }
    const size = Number(q.get("pageSize") || 1000);
    const from = Number(q.get("pageToken") || 0);
    const all = [...DB.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const page = all.slice(from, from + size);
    return res(200, { documents: page.map(([k, v]) => ({ name: docName(k), fields: v.fields, updateTime: v.updateTime })),
      ...(from + size < all.length ? { nextPageToken: String(from + size) } : {}) });
  }
  return { DB, fetch, hooks };
}
