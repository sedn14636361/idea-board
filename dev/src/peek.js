// スマホ版の「今ある付箋」（書きながら見る一覧）の計算（画面に依存しない純粋な関数。6.16.0）
//   boardRows  : パソコンのボード1枚 → 一覧の行（文字だけ。画像・手書きなどは持たない）
//   localRows  : このスマホの「ためた分」 → 一覧の行
//   filterRows : 検索で絞る

const headingOf = (n) => (n.title || "").trim() || (n.text || "").split("\n").find((l) => l.trim()) || "";

// 付箋の中心が入っている領域の名前（重なっていれば面積の小さい方。PC 版の付箋リストと同じ決め方）
const zoneOf = (zones, n) => {
  const w = n.expanded ? n.ew : n.w, h = n.expanded ? n.eh : n.h;
  const cx = n.x + (w || 0) / 2, cy = n.y + (h || 0) / 2;
  let best = null;
  for (const z of zones || []) {
    if (cx < z.x || cx > z.x + z.w || cy < z.y || cy > z.y + z.h) continue;
    if (!best || z.w * z.h < best.w * best.h) best = z;
  }
  return best ? (best.label || "").trim() : "";
};

// 最上位の付箋を番号の順に並べ、中の付箋は親のすぐ下に字下げ（depth）して並べる。
// 行: { id, num, heading, text, tags, color, depth, zone }
export function boardRows(board) {
  const notes = board?.notes || [];
  const ids = new Set(notes.map((n) => n.id));
  const kids = {};
  for (const n of notes) {
    const p = n.parentId && ids.has(n.parentId) ? n.parentId : "";
    (kids[p] ||= []).push(n);
  }
  for (const k of Object.keys(kids)) kids[k].sort((a, b) => (a.num || 0) - (b.num || 0));
  const out = [];
  const walk = (n, depth, zone) => {
    out.push({ id: n.id, num: n.num || 0, heading: headingOf(n), text: n.text || "", tags: [...(n.tags || [])], color: n.color ?? null, depth, zone });
    for (const c of kids[n.id] || []) walk(c, depth + 1, zone);
  };
  for (const n of kids[""] || []) walk(n, 0, zoneOf(board?.zones, n));
  return out;
}

// このスマホの付箋。新しいものを上に（書いたばかりのものがすぐ見えるように）。zone はまとめ先
export function localRows(items) {
  return [...(items || [])].reverse().map((it) => ({
    id: it.id, num: 0, heading: headingOf(it), text: it.text || "", tags: [...(it.tags || [])],
    color: it.color ?? null, depth: 0, zone: it.area || "",
  }));
}

// 見出し・本文・タグ・領域（まとめ先）・#番号 のどれかに、空白で区切った語がすべて入っている行だけ
export function filterRows(rows, query) {
  const words = (query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return rows;
  return rows.filter((r) => {
    const hay = [r.heading, r.text, ...(r.tags || []), r.zone, r.num ? `#${r.num}` : ""].join("\n").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
