// 選んだ付箋をまとめて扱う計算（画面に依存しない純粋な関数）
//   tidyGrid   : 左上の付箋を起点に、等間隔の格子に並べ直す（Figma の Tidy Up と同じ形）
//   enclose    : 選んだ物がすべて入る長方形（領域で囲む）
//   tagStates  : 選んだ付箋それぞれにタグが付いているか（全員／一部／なし）

// items: [{ id, x, y, w, h }]（w, h は今見えている大きさ。開いている付箋は開いた大きさ）
// 戻り値: { id: { x, y } }。起点（いちばん左上 = x+y が最小）は動かない。
// 順番は今の位置の読み順（上の行から、行の中は左から）。起点は先頭。
// 列の数は √枚数 の切り上げ。列の幅・行の高さはその列・行でいちばん大きい付箋に合わせるので、縁がそろい重ならない。
// 付箋どうしの縁のすき間はすべて gap。
export function tidyGrid(items, gap = 24) {
  if (items.length === 0) return {};
  const anchor = items.reduce((a, b) => {
    const d = (b.x + b.y) - (a.x + a.y);
    return d < 0 || (d === 0 && (b.y < a.y || (b.y === a.y && b.x < a.x))) ? b : a;
  });
  // 読み順: 上から見ていき、行の先頭の付箋の高さの半分より下に始まる付箋で次の行にする
  const byY = items.filter((it) => it !== anchor).sort((a, b) => a.y - b.y || a.x - b.x);
  const rowsIn = [];
  for (const it of byY) {
    const row = rowsIn[rowsIn.length - 1];
    if (row && it.y < row.top + row.h / 2) row.items.push(it);
    else rowsIn.push({ top: it.y, h: it.h, items: [it] });
  }
  const order = [anchor, ...rowsIn.flatMap((r) => r.items.sort((a, b) => a.x - b.x || a.y - b.y))];

  const n = order.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const colW = Array(cols).fill(0), rowH = Array(rows).fill(0);
  order.forEach((it, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    colW[c] = Math.max(colW[c], it.w);
    rowH[r] = Math.max(rowH[r], it.h);
  });
  const colX = [], rowY = [];
  for (let c = 0, x = anchor.x; c < cols; c++) { colX.push(x); x += colW[c] + gap; }
  for (let r = 0, y = anchor.y; r < rows; r++) { rowY.push(y); y += rowH[r] + gap; }
  const out = {};
  order.forEach((it, i) => { out[it.id] = { x: colX[i % cols], y: rowY[Math.floor(i / cols)] }; });
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
