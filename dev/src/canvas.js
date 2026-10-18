// 端のないボード: 置いてある物に合わせてボードの広さを決める（画面に依存しない純粋な関数）
//
// 6.5.0 までは決まった広さ（既定 3200×2200）の紙で、座標 0 より上・左へは置けなかった。
// 6.6.0 からは、置いてある物の外側に「画面1つ分」の余白を常に取り、どの方向へもいくらでも広がる。
// 座標の原点（0,0）はそのまま。左・上へ広がったときは、ボード全体を原点から ox, oy だけずらして描く。

// 初めから見えている広さ（今までの既定の紙）。空のボードや、今のデータの見え方を変えないため常に含める
export const BASE_W = 3200;
export const BASE_H = 2200;

// 置いてある物（最上位の付箋・文字・領域・画像・手書き）が占める範囲。何も無ければ null
export function contentBox(board) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x, y, w = 0, h = 0) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
  };
  for (const n of board?.notes || []) {
    if (n.parentId) continue; // 中の付箋は親の中に収まる
    add(n.x, n.y, n.expanded ? n.ew || 430 : n.w || 190, n.expanded ? n.eh || 400 : n.h || 170);
  }
  for (const t of board?.texts || []) add(t.x, t.y, 240, 60);
  for (const z of board?.zones || []) add(z.x, z.y, z.w || 0, z.h || 0);
  for (const im of board?.images || []) add(im.x, im.y, im.w || 0, im.h || 0);
  for (const s of board?.strokes || []) for (const p of s.pts || []) add(p.x, p.y);
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

// ボードの広さ。box の外側に余白（mx, my。画面1つ分）を取り、初めの広さ（0,0〜BASE_W,BASE_H）も含める
export function canvasBounds(box, mx, my) {
  const b = { minX: 0, minY: 0, maxX: BASE_W, maxY: BASE_H };
  if (box) {
    b.minX = Math.min(b.minX, box.minX - mx);
    b.minY = Math.min(b.minY, box.minY - my);
    b.maxX = Math.max(b.maxX, box.maxX + mx);
    b.maxY = Math.max(b.maxY, box.maxY + my);
  }
  // 少しの移動で広さが細かく変わらないよう、きりのよい値（100単位）に広げる
  return {
    minX: Math.floor(b.minX / 100) * 100, minY: Math.floor(b.minY / 100) * 100,
    maxX: Math.ceil(b.maxX / 100) * 100, maxY: Math.ceil(b.maxY / 100) * 100,
  };
}

// 広さは、同じボードを見ている間は縮めない（縮めると見ている場所が跳ねるため）。ボードを切り替えたら測り直す
export const unionBounds = (a, b) => (!a ? b : {
  minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
});
