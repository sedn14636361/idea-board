// タイトルの番号（6.23.0。画面に依存しない純粋な関数）
//
// 番号はタイトルの文章には入れず、付箋に「どの組か」（note.seq = { id, den }）だけを持たせ、表示のたびに数える。
//   番号 = 同じボードの同じ組の付箋の中での「読む順」（行ごとに左→右、行は上→下。ユーザーが選択）の位置
//   den  = 分母を出すか（「1/4」か「1」か。組の全員で同じ値にする）
// こうしておくと、剥がしたら詰まる・動かしたら振り直す・「＋→」で作った付箋が組に入る、が数え直すだけでそろう（ユーザーが選択）

// ボード上の位置（中の付箋は親の位置を足す。読む順を決めるための目安）
export function absRects(notes) {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const memo = new Map();
  const at = (n, depth = 0) => {
    if (memo.has(n.id)) return memo.get(n.id);
    const p = n.parentId && depth < 8 ? byId.get(n.parentId) : null;
    const base = p ? at(p, depth + 1) : { x: 0, y: 0 };
    const r = { x: base.x + (n.x || 0), y: base.y + (n.y || 0), h: (n.expanded ? n.eh : n.h) || 170 };
    memo.set(n.id, r);
    return r;
  };
  for (const n of notes) at(n);
  return memo;
}

// 読む順: 上から並べ、行の先頭の付箋の高さの半分より下に始まる付箋で次の行。行の中は左から（6.10.0 の整列と同じ考え方）
// items: [{ id, x, y, h }] → id の並び
export function readingOrder(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && it.y < row[0].y + row[0].h / 2) row.push(it);
    else rows.push([it]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x || a.y - b.y)).map((it) => it.id);
}

// ボードの付箋 → Map(id → { i, n, den })
export function seriesOf(notes) {
  const groups = new Map();
  for (const n of notes || []) {
    if (!n.seq || !n.seq.id) continue;
    if (!groups.has(n.seq.id)) groups.set(n.seq.id, []);
    groups.get(n.seq.id).push(n);
  }
  const out = new Map();
  if (groups.size === 0) return out;
  const rects = absRects(notes);
  for (const members of groups.values()) {
    const order = readingOrder(members.map((m) => ({ id: m.id, ...rects.get(m.id) })));
    const den = members.some((m) => m.seq.den !== false);
    order.forEach((id, k) => out.set(id, { i: k + 1, n: order.length, den }));
  }
  return out;
}

export const seqLabel = (info) => (info ? (info.den ? `${info.i}/${info.n}` : `${info.i}`) : "");

// 選んだ付箋（ids）のタイトルをまとめて変える。
//   number: 番号を付ける。同じボードに同じタイトルの組があれば、その組に入る（無ければ新しい組 newSeqId()）
//   den:    分母を出すか（入る組の全員に合わせる）
// 番号を付けないときは、選んだ付箋を組から外す。タイトル欄は表示する（useTitle）
export function titlesOn(notes, ids, { title, number, den }, newSeqId) {
  const pick = new Set(ids);
  const t = (title || "").replace(/\n/g, "").trim();
  let seqId = null;
  if (number) {
    const same = notes.find((n) => !pick.has(n.id) && n.seq?.id && (n.title || "").trim() === t);
    seqId = same ? same.seq.id : newSeqId();
  }
  return notes.map((n) => {
    if (pick.has(n.id)) {
      const m = { ...n, title: t, useTitle: true };
      if (number) m.seq = { id: seqId, den: !!den };
      else delete m.seq;
      return m;
    }
    if (number && n.seq?.id === seqId && n.seq.den !== !!den) return { ...n, seq: { ...n.seq, den: !!den } };
    return n;
  });
}

// 組の全員の分母の出し方を変える
export function seqDenOn(notes, seqId, den) {
  return notes.map((n) => (n.seq?.id === seqId && n.seq.den !== !!den ? { ...n, seq: { ...n.seq, den: !!den } } : n));
}

// 1枚を組から外す
export function leaveSeq(notes, id) {
  return notes.map((n) => {
    if (n.id !== id || !n.seq) return n;
    const m = { ...n };
    delete m.seq;
    return m;
  });
}
