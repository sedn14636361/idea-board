// 付箋の右に、つながる付箋を置く（画面に依存しない純粋な関数）
//   sidePlace       : 新しい付箋の置き場所（パソコン版の「＋→」とスマホ版の「直す」の「＋」で共通。6.22.0 で切り出した）
//   appendSideNotes : ボードに、元の付箋から右へつながる付箋を何枚か足す（スマホ版。サーバー上のボードを直すとき）

export const SIDE_GAP = 24;

const sizeOf = (m) => (m.expanded ? { w: m.ew, h: m.eh } : { w: m.w, h: m.h });

// src のすぐ右（間隔 gap）。同じ親の付箋とぶつかれば、ぶつかった付箋の右へずらして空くまで繰り返す。
// 中の付箋で、親の中のボードの幅（ew - 16）からはみ出すときは下に置く（中の付箋は親の幅で縮んでしまうため）。
// size: 新しい付箋の { w, h }。snap: グリッド配置なら目盛りに合わせる関数（無ければそのまま）
export function sidePlace(notes, src, size, { gap = SIDE_GAP, snap = null } = {}) {
  const fit = snap || ((v) => v);
  const sibs = notes.filter((m) => (m.parentId || null) === (src.parentId || null)).map((m) => ({ x: m.x, y: m.y, ...sizeOf(m) }));
  const hits = (x, y) => sibs.find((r) => x < r.x + r.w && x + size.w > r.x && y < r.y + r.h && y + size.h > r.y);
  const ss = sizeOf(src);
  const place = (dx, dy) => {
    let x = dx ? src.x + ss.w + gap : src.x, y = dy ? src.y + ss.h + gap : src.y;
    if (snap) { x = fit(x); y = fit(y); }
    for (let i = 0, r; i < 200 && (r = hits(x, y)); i++) {
      if (dx) x = fit(r.x + r.w + gap);
      else y = fit(r.y + r.h + gap);
    }
    return { x, y };
  };
  let pos = place(1, 0);
  const parent = src.parentId && notes.find((m) => m.id === src.parentId);
  if (parent && pos.x + size.w > parent.ew - 16) pos = place(0, 1);
  return { x: src.parentId ? Math.max(0, pos.x) : pos.x, y: src.parentId ? Math.max(0, pos.y) : pos.y };
}

// srcId の付箋から右へ、drafts（{ text, title, useTitle, color, tags }）を順に足し、
// 「元 → 1枚目 → 2枚目 …」と線でつなぐ。大きさ・親・タイトル欄の有無の既定は元の付箋から引き継ぐ。
// 番号はボードの続き（nextNum）、重なり順はボードの一番上の次。newId は id を作る関数。
// 元の付箋が見つからなければ、ボードをそのまま返す。
export function appendSideNotes(board, srcId, drafts, { newId, gap = SIDE_GAP } = {}) {
  let notes = [...(board.notes || [])];
  const edges = [...(board.edges || [])];
  let src = notes.find((n) => n.id === srcId);
  if (!src || !drafts?.length) return board;
  let num = board.nextNum || notes.reduce((m, n) => Math.max(m, n.num || 0), 0) + 1;
  let z = notes.reduce((m, n) => Math.max(m, n.z || 0), 0);
  const child = !!src.parentId;
  for (const d of drafts) {
    const size = { w: src.w || (child ? 160 : 260), h: src.h || (child ? 140 : 182) };
    const pos = sidePlace(notes, src, size, { gap });
    const n = {
      id: newId(), num: num++, parentId: src.parentId || null, x: pos.x, y: pos.y,
      title: (d.title || "").trim(), useTitle: !!d.useTitle, text: d.text || "",
      tags: [...(d.tags || [])], refs: [], color: d.color ?? src.color, z: ++z, expanded: false,
      w: size.w, h: size.h, ew: child ? 340 : 430, eh: child ? 300 : 400,
    };
    notes = [...notes, n];
    edges.push({ id: newId(), from: src.id, to: n.id });
    src = n;                                   // 次の付箋は、いま足した付箋の右へ
  }
  return { ...board, notes, edges, nextNum: num };
}
