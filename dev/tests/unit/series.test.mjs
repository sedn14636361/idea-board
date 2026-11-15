// タイトルの番号（src/series.js。6.23.0）と、選んだ付箋の大きさ（src/arrange.js の matchSize / scaleSize / followSize）
import { readingOrder, seriesOf, seqLabel, titlesOn, seqDenOn, leaveSeq } from "../../src/series.js";
import { matchSize, scaleSize, followSize } from "../../src/arrange.js";
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

// 試験データ: 260×182 の付箋5枚。上の行に3枚（少しずつ高さがずれている）、下の行に2枚。行の判定は先頭の高さの半分（91）
const note = (id, x, y, extra = {}) => ({ id, x, y, w: 260, h: 182, title: "", useTitle: false, ...extra });
const A = note("A", 600, 40), B = note("B", 300, 0), C = note("C", 0, 60);   // 上の行（y 0〜60）。左から C, B, A
const D = note("D", 300, 300), E = note("E", 20, 260);                     // 下の行。左から E, D
const all = [A, B, C, D, E];
const labels = (notes) => { const m = seriesOf(notes); return notes.map((n) => `${n.id}:${seqLabel(m.get(n.id))}`).sort(); };

// ---- 読む順 ----
eq("読む順: 行ごとに左→右、行は上→下", readingOrder(all.map((n) => ({ id: n.id, x: n.x, y: n.y, h: n.h }))), ["C", "B", "A", "E", "D"]);
eq("読む順: 先頭の高さの半分より下に始まると次の行", readingOrder([{ id: "p", x: 500, y: 0, h: 182 }, { id: "q", x: 0, y: 92, h: 182 }]), ["p", "q"]);
eq("読む順: 半分より上なら同じ行", readingOrder([{ id: "p", x: 500, y: 0, h: 182 }, { id: "q", x: 0, y: 90, h: 182 }]), ["q", "p"]);

// ---- 一括でタイトルと番号 ----
let id = 0; const newId = () => "s" + (++id);
const t1 = titlesOn(all, ["A", "B", "C", "D", "E"], { title: " 序 ", number: true, den: true }, newId);
eq("5枚に「序」と番号: 読む順に 1/5〜5/5", labels(t1), ["A:3/5", "B:2/5", "C:1/5", "D:5/5", "E:4/5"]);
eq("タイトルは前後の空白を除いて同じ・タイトル欄を出す", t1.map((n) => [n.title, n.useTitle]), Array(5).fill(["序", true]));
eq("分母なし: 「1」", labels(titlesOn(all, ["A", "B"], { title: "序", number: true, den: false }, newId)), ["A:2", "B:1", "C:", "D:", "E:"]);
eq("番号なし: タイトルだけ・組に入らない", labels(titlesOn(all, ["A", "B"], { title: "序", number: false }, newId)), ["A:", "B:", "C:", "D:", "E:"]);

// 動かす・剥がす・足す（数え直すだけでそろう）
eq("動かしたら振り直す（A を一番左上へ）", labels(t1.map((n) => (n.id === "A" ? { ...n, x: -300, y: 0 } : n))), ["A:1/5", "B:3/5", "C:2/5", "D:5/5", "E:4/5"]);
eq("剥がしたら詰める（B を剥がす）", labels(t1.filter((n) => n.id !== "B")), ["A:2/4", "C:1/4", "D:4/4", "E:3/4"]);
const F = { ...note("F", 900, 40), title: "序", useTitle: true, seq: { ...t1[0].seq } };   // 「＋→」で A の右に作った
eq("組に入った付箋（A の右）: 4/6 になり、全体が /6", labels([...t1, F]), ["A:3/6", "B:2/6", "C:1/6", "D:6/6", "E:5/6", "F:4/6"]);

// すでにある組と同じタイトルで一括変更 → その組に入る（分母の出し方も合わせる）
{
  const base = titlesOn(all, ["C", "B", "A"], { title: "序", number: true, den: true }, newId);
  const joined = titlesOn(base, ["E", "D"], { title: "序", number: true, den: true }, newId);
  eq("同じタイトル「序」で一括変更 → 続き（4/5・5/5）", labels(joined), ["A:3/5", "B:2/5", "C:1/5", "D:5/5", "E:4/5"]);
  eq("同じ組の印", new Set(joined.map((n) => n.seq.id)).size, 1);
  const other = titlesOn(base, ["E", "D"], { title: "破", number: true, den: true }, newId);
  eq("違うタイトル「破」は別の組（1/2・2/2）", labels(other), ["A:3/3", "B:2/3", "C:1/3", "D:2/2", "E:1/2"]);
  const noDen = titlesOn(base, ["E"], { title: "序", number: true, den: false }, newId);
  eq("入るときに分母なしを選ぶと、組の全員が分母なし", labels(noDen), ["A:3", "B:2", "C:1", "D:", "E:4"]);
  eq("分母の出し方を組ごと変える", labels(seqDenOn(noDen, noDen[0].seq.id, true)), ["A:3/4", "B:2/4", "C:1/4", "D:", "E:4/4"]);
  eq("1枚を組から外す（残りが詰まる）", labels(leaveSeq(base, "B")), ["A:2/2", "B:", "C:1/2", "D:", "E:"]);
  eq("番号なしで一括変更すると組から外れる", labels(titlesOn(base, ["A"], { title: "序", number: false }, newId)), ["A:", "B:2/2", "C:1/2", "D:", "E:"]);
}
// 中の付箋は親の位置を足して読む順を決める
{
  const P = note("P", 0, 0, { expanded: true, eh: 400 }), K1 = note("K1", 200, 20, { parentId: "P" }), K2 = note("K2", 10, 20, { parentId: "P" });
  const Q = note("Q", 600, 0);
  const s = titlesOn([P, K1, K2, Q], ["K1", "K2", "Q"], { title: "x", number: true, den: true }, newId);
  eq("中の付箋も含めて読む順（K2, K1, Q）", labels(s), ["K1:2/3", "K2:1/3", "P:", "Q:3/3"]);
}

// ---- 大きさ ----
const items = [{ id: "a", w: 260, h: 182, min: { w: 120, h: 90 } }, { id: "b", w: 190, h: 170, min: { w: 120, h: 90 } }, { id: "c", w: 430, h: 400, min: { w: 240, h: 200 } }];
eq("最初に選んだ a に両方そろえる（開いた c は最小 240×200 より小さくしない）", matchSize(items, items[0], "both"), { a: { w: 260, h: 182 }, b: { w: 260, h: 182 }, c: { w: 260, h: 200 } });
eq("幅だけそろえる", matchSize(items, items[1], "w"), { a: { w: 190, h: 182 }, b: { w: 190, h: 170 }, c: { w: 240, h: 400 } });
eq("高さだけそろえる", matchSize(items, items[2], "h"), { a: { w: 260, h: 400 }, b: { w: 190, h: 400 }, c: { w: 430, h: 400 } });
eq("縮める 80%", scaleSize(items, 0.8), { a: { w: 208, h: 146 }, b: { w: 152, h: 136 }, c: { w: 344, h: 320 } });
eq("広げる 125%（目盛り 26 に合わせる）", scaleSize(items, 1.25, 26), { a: { w: 338, h: 234 }, b: { w: 234, h: 208 }, c: { w: 546, h: 494 } });
eq("縮めても最小より小さくしない", scaleSize([{ id: "a", w: 130, h: 100, min: { w: 120, h: 90 } }], 0.8), { a: { w: 120, h: 90 } });
eq("追従: 同じ割合（幅 1.5 倍・高さ 0.5 倍）", followSize(items.slice(0, 2), 1.5, 0.5), { a: { w: 390, h: 91 }, b: { w: 285, h: 90 } });
eq("追従: 固定した向き（割合 1）は変えない", followSize([{ id: "b", w: 191, h: 171, min: { w: 120, h: 90 } }], 1.2, 1, 26), { b: { w: 234, h: 171 } });

console.log(ng === 0 ? "\nタイトルの番号・大きさ: すべて期待どおりです" : `\nタイトルの番号・大きさ: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
