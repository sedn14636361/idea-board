// 付箋の番号の詰め直しと、ボード・プロジェクトをまたぐ移動・複製（画面に依存しない純粋な関数）

// 通し番号を「今ある付箋だけ・空きなし」に詰め直す。
// 並び順は今の番号のままなので、消した付箋より後ろだけが繰り上がる。
// 本文の #番号 も同じ対応表で一度に置換し、同じ付箋を指し続けるようにする
// （置換は1パスなので #7→#5 と #5→#4 が連鎖することはない）。
export function renumber(notes) {
  const order = [...notes].sort((a, b) => (a.num || 0) - (b.num || 0));
  const newNumOf = new Map();   // id → 新しい番号
  const remap = new Map();      // 旧番号 → 新番号
  let changed = false;
  order.forEach((n, i) => {
    const nn = i + 1;
    newNumOf.set(n.id, nn);
    if (n.num) remap.set(n.num, nn);
    if (n.num !== nn) changed = true;
  });
  if (!changed) return { notes, nextNum: notes.length + 1 };
  const fixText = (t) =>
    typeof t === "string" && t.includes("#")
      // 該当する付箋が無い番号（#999 など）はただの文字なので触らない
      ? t.replace(/#(\d+)/g, (m, d) => { const to = remap.get(parseInt(d, 10)); return to ? `#${to}` : m; })
      : t;
  return {
    notes: notes.map((n) => ({ ...n, num: newNumOf.get(n.id), text: fixText(n.text) })),
    nextNum: notes.length + 1,
  };
}

// 付箋（中の付箋ごと）と直書き文字を、別のボード・別のプロジェクトへ移す／複製する。
// 6.5.0 までは「複製してから、少し後に元を消す」を別々の更新で行っていた（順番が崩れると危うい）。
// ここでは移す先と移す元を**1回の更新で**書き換える。元を消すのは、移す先に足したのと同じ更新の中だけ。
//   projects: 今の projects（読み込み済みのもの）
//   o.from / o.to: { pid, bid }   o.noteIds: 選んだ付箋（中の付箋は自動で含む）   o.textIds: 選んだ直書き文字
//   o.move: true なら元から消す   o.newId(): 新しいID   o.newZ(): 新しい重なり順
// 返り値: { projects, moved: 移した付箋の数（中の付箋を含む）, texts: 移した文字の数 }。移す先・元が見つからなければ projects をそのまま返す
export function transferNotes(projects, o) {
  const findBoard = (ps, pid, bid) => ps.find((p) => p.id === pid)?.boards.find((b) => b.id === bid) || null;
  const src = findBoard(projects, o.from.pid, o.from.bid);
  const dst = findBoard(projects, o.to.pid, o.to.bid);
  const none = { projects, moved: 0, texts: 0 };
  if (!src || !dst || src === dst) return none;

  // 選んだ付箋と、その中の付箋（入れ子）をすべて集める
  const notes = src.notes || [];
  const byParent = new Map();
  for (const n of notes) if (n.parentId) { if (!byParent.has(n.parentId)) byParent.set(n.parentId, []); byParent.get(n.parentId).push(n.id); }
  const set = new Set();
  const walk = (id) => { if (set.has(id)) return; set.add(id); for (const c of byParent.get(id) || []) walk(c); };
  for (const id of o.noteIds || []) if (notes.some((n) => n.id === id)) walk(id);
  const moving = notes.filter((n) => set.has(n.id)).sort((a, b) => (a.num || 0) - (b.num || 0));
  const roots = moving.filter((n) => !n.parentId || !set.has(n.parentId));
  const textIds = new Set(o.textIds || []);
  const movingTexts = (src.texts || []).filter((t) => textIds.has(t.id));
  if (moving.length === 0 && movingTexts.length === 0) return none;

  // 置く場所: 並びはそのまま、移す先の今ある付箋・文字の右側の空いたところへ
  const tops = (dst.notes || []).filter((n) => !n.parentId);
  const rightEdge = Math.max(0, ...tops.map((n) => (n.x || 0) + (n.expanded ? n.ew || 430 : n.w || 190)), ...(dst.texts || []).map((t) => (t.x || 0) + 160));
  const minX = Math.min(...roots.map((n) => n.x || 0), ...movingTexts.map((t) => t.x || 0));
  const minY = Math.min(...roots.map((n) => n.y || 0), ...movingTexts.map((t) => t.y || 0));
  const dx = (rightEdge > 0 ? rightEdge + 60 : 60) - minX;
  const dy = 80 - minY;

  // 番号: 移す先の続きから、元の番号の順に振る。移した付箋どうしを指す本文の #番号 も書き換える
  const idMap = new Map(moving.map((n) => [n.id, o.newId()]));
  let num = dst.nextNum || (dst.notes || []).length + 1;
  const numMap = new Map();
  for (const n of moving) numMap.set(n.num, num++);
  const fixText = (t) => (typeof t === "string" && t.includes("#")
    ? t.replace(/#(\d+)/g, (m, d) => { const to = numMap.get(parseInt(d, 10)); return to ? `#${to}` : m; })
    : t);
  const copies = moving.map((n) => {
    const { src: origin, ...rest } = n;
    const isRoot = !n.parentId || !set.has(n.parentId);
    return {
      ...rest,
      // スマホから取り込んだ印は、移すときは残し、複製では外す（6.3.0。複製にも残すとどちらを書き換えるか決まらない）
      ...(o.move && origin ? { src: origin } : {}),
      id: idMap.get(n.id),
      num: numMap.get(n.num),
      parentId: isRoot ? null : idMap.get(n.parentId),
      x: isRoot ? (n.x || 0) + dx : n.x,
      y: isRoot ? (n.y || 0) + dy : n.y,
      z: o.newZ(),
      tags: [...(n.tags || [])],
      // 引用: 一緒に移した付箋への引用だけ残す（ほかの付箋は移す先に無い）
      refs: (n.refs || []).map((r) => idMap.get(r)).filter(Boolean),
      text: fixText(n.text),
    };
  });
  const edgeCopies = (src.edges || [])
    .filter((e) => set.has(e.from) && set.has(e.to))
    .map((e) => ({ ...e, id: o.newId(), from: idMap.get(e.from), to: idMap.get(e.to) }));
  const textCopies = movingTexts.map((t) => ({ ...t, id: o.newId(), x: (t.x || 0) + dx, y: (t.y || 0) + dy, z: o.newZ() }));

  const addTo = (b) => ({
    ...b,
    nextNum: num,
    notes: [...(b.notes || []), ...copies],
    edges: [...(b.edges || []), ...edgeCopies],
    texts: [...(b.texts || []), ...textCopies],
  });
  const removeFrom = (b) => {
    const kept = (b.notes || [])
      .filter((n) => !set.has(n.id))
      .map((n) => ((n.refs || []).some((r) => set.has(r)) ? { ...n, refs: n.refs.filter((r) => !set.has(r)) } : n));
    const packed = renumber(kept);
    return {
      ...b,
      notes: packed.notes,
      nextNum: packed.nextNum,
      edges: (b.edges || []).filter((e) => !set.has(e.from) && !set.has(e.to)),
      texts: (b.texts || []).filter((t) => !textIds.has(t.id)),
    };
  };
  const next = projects.map((p) => {
    if (p.id !== o.to.pid && !(o.move && p.id === o.from.pid)) return p;   // 複製なら元のプロジェクトには触らない
    return {
      ...p,
      boards: p.boards.map((b) => {
        if (p.id === o.to.pid && b.id === o.to.bid) return addTo(b);
        if (o.move && p.id === o.from.pid && b.id === o.from.bid) return removeFrom(b);
        return b;
      }),
    };
  });
  return { projects: next, moved: moving.length, texts: movingTexts.length };
}
