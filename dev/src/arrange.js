// 選んだ付箋をまとめて扱う計算（画面に依存しない純粋な関数）
//   snapToGrid : 選んだ付箋の左上を一番近い目盛りへ（6.14.0。6.10.0〜6.11.x の tidyGrid は格子に並べ直していた）
//   enclose    : 選んだ物がすべて入る長方形（領域で囲む）
//   tagStates  : 選んだ付箋それぞれにタグが付いているか（全員／一部／なし）
//   matchSize / scaleSize / followSize : 選んだ付箋の大きさ（6.23.0）

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

// ---- 選んだ付箋の大きさ（6.23.0） ----
// items: [{ id, w, h, min: { w, h } }]（w/h は見えている大きさ。開いている付箋は開いたときの大きさ）。
// 返り値 { id: { w, h } }。grid を渡すと目盛りに合わせる（最小より小さくはしない）
const fit = (v, min, grid) => {
  const s = grid > 0 ? Math.round(v / grid) * grid : Math.round(v);
  return Math.max(min, s);
};

// 基準（最初に選んだ付箋。ユーザーが選択）の幅・高さ・両方にそろえる。mode: "w" | "h" | "both"
// 基準の大きさは目盛りに合わせ直さない（基準と同じ大きさにするのが目的のため）
export function matchSize(items, base, mode) {
  const out = {};
  for (const it of items) {
    const w = mode === "h" ? it.w : fit(base.w, it.min.w, 0);
    const h = mode === "w" ? it.h : fit(base.h, it.min.h, 0);
    out[it.id] = { w, h };
  }
  return out;
}

// それぞれを f 倍する（縮める 0.8・広げる 1.25）
export function scaleSize(items, f, grid = 0) {
  const out = {};
  for (const it of items) out[it.id] = { w: fit(it.w * f, it.min.w, grid), h: fit(it.h * f, it.min.h, grid) };
  return out;
}

// 1枚の角を引っぱったとき、ほかの選んだ付箋も同じ割合で変える（ボード上での拡大縮小に追従する。ユーザー指定）。
// rw / rh: 引っぱった付箋の 今の大きさ ÷ 引っぱり始めの大きさ（Shift で片方を固定していれば 1）
export function followSize(items, rw, rh, grid = 0) {
  const out = {};
  for (const it of items) {
    out[it.id] = { w: rw === 1 ? it.w : fit(it.w * rw, it.min.w, grid), h: rh === 1 ? it.h : fit(it.h * rh, it.min.h, grid) };
  }
  return out;
}
