// 選んだ付箋をまとめて扱う計算（画面に依存しない純粋な関数）
//   snapToGrid : 選んだ付箋の左上を一番近い目盛りへ（6.14.0。6.10.0〜6.11.x の tidyGrid は格子に並べ直していた）
//   enclose    : 選んだ物がすべて入る長方形（領域で囲む）
//   tagStates  : 選んだ付箋それぞれにタグが付いているか（全員／一部／なし）

// 選んだ付箋の左上を、ボードの原点から数えた一番近い目盛り（grid の倍数）へ動かす（6.14.0）。
// 付箋の大きさは使わない。同じ目盛りに来た付箋は重なってよい（ユーザー指定）。
// items: [{ id, x, y }] → { id: { x, y } }
export function snapToGrid(items, grid) {
  const g = grid > 0 ? grid : 1;
  const r = (v) => Math.round(v / g) * g || 0; // -0 を 0 にする
  const out = {};
  for (const it of items) out[it.id] = { x: r(it.x), y: r(it.y) };
  return out;
}

// rects がすべて入る長方形。周りに pad、上は名前の欄のぶん top だけ空ける。
// grid を渡すと、外側へ目盛りに合わせる（中身がはみ出さないように、左上は切り下げ・右下は切り上げ）
export function enclose(rects, { pad = 24, top = 40, grid = 0 } = {}) {
  if (rects.length === 0) return null;
  let minX = Math.min(...rects.map((r) => r.x)) - pad;
  let minY = Math.min(...rects.map((r) => r.y)) - top;
  let maxX = Math.max(...rects.map((r) => r.x + r.w)) + pad;
  let maxY = Math.max(...rects.map((r) => r.y + r.h)) + pad;
  if (grid > 0) {
    minX = Math.floor(minX / grid) * grid; minY = Math.floor(minY / grid) * grid;
    maxX = Math.ceil(maxX / grid) * grid; maxY = Math.ceil(maxY / grid) * grid;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// 選んだ付箋（notes）について、tags の各タグが "all"（全員）/ "some"（一部）/ "none"（誰にも無い）か
export function tagStates(notes, tags) {
  const out = {};
  for (const t of tags) {
    const k = notes.filter((n) => (n.tags || []).includes(t)).length;
    out[t] = k === 0 ? "none" : k === notes.length ? "all" : "some";
  }
  return out;
}

// タグを押したとき: 全員に付いていれば全員から外す。それ以外（一部・なし）なら全員に付ける
export function toggleTagOn(notes, ids, tag) {
  const set = new Set(ids);
  const picked = notes.filter((n) => set.has(n.id));
  const all = picked.length > 0 && picked.every((n) => (n.tags || []).includes(tag));
  return notes.map((n) => {
    if (!set.has(n.id)) return n;
    const has = (n.tags || []).includes(tag);
    if (all) return { ...n, tags: (n.tags || []).filter((t) => t !== tag) };
    return has ? n : { ...n, tags: [...(n.tags || []), tag] };
  });
}
