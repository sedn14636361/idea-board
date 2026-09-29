// スマホから届いた付箋を、パソコンでどう扱うか決める（画面に依存しない純粋な関数）
//
// スマホで取り込み済みの付箋を直すと、同じ id・大きい rev（版番号）で届く。
// パソコンの付箋には取り込んだときの印 note.src = { id, rev, h } を残してあり、
// h は取り込んだ時点の中身の指紋。今の中身の指紋と同じなら「パソコンで手を加えていない」。
import { hashOf } from "./cloud.js";

// 書き換えの対象になる中身（位置や大きさは含めない。動かしただけなら書き換えてよい）
export const noteContentHash = (n) =>
  hashOf(JSON.stringify([n.title || "", !!n.useTitle, n.text || "", n.tags || [], n.color ?? null]));

// 返り値: Map(届いた付箋 → { kind, noteId, num, boardId })
//   new    … 初めて届いた／取り込んだ付箋が見つからない（剥がした・別のプロジェクト・6.3.0 より前に取り込んだ）→ 新しく貼る
//   update … 取り込み済みで、パソコンで中身に手を加えていない → その付箋を書き換える
//   edited … 取り込み済みだが、パソコンで中身に手を加えている → 上書きせず新しく貼る（両方残る）
//   same   … 同じ版かそれより新しい版を取り込み済み（送り直しの重複）→ 貼らない
export function incomingPlan(project, items) {
  const found = new Map(); // src.id → [{ note, boardId }]
  for (const b of project?.boards || []) {
    for (const n of b.notes || []) {
      if (!n.src?.id) continue;
      if (!found.has(n.src.id)) found.set(n.src.id, []);
      found.get(n.src.id).push({ note: n, boardId: b.id });
    }
  }
  const plan = new Map();
  const claimed = new Set(); // 同じ付箋を2つの届いた付箋で書き換えない
  for (const it of items || []) {
    const list = it.id != null ? found.get(String(it.id)) || [] : [];
    const rev = it.rev || 0;
    const at = (x) => ({ noteId: x.note.id, num: x.note.num, boardId: x.boardId });
    if (list.length === 0) { plan.set(it, { kind: "new" }); continue; }
    const newer = list.find((x) => (x.note.src.rev || 0) >= rev);
    if (newer) { plan.set(it, { kind: "same", ...at(newer) }); continue; }
    const clean = list.find((x) => !claimed.has(x.note.id) && noteContentHash(x.note) === x.note.src.h);
    if (clean) {
      claimed.add(clean.note.id);
      plan.set(it, { kind: "update", ...at(clean) });
    } else {
      plan.set(it, { kind: "edited", ...at(list[0]) });
    }
  }
  return plan;
}
