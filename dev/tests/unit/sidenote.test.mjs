// 付箋の右に、つながる付箋を置く（src/sidenote.js。6.22.0）
//   sidePlace はパソコン版の「＋→」（6.8.0）と同じ置き方。appendSideNotes はスマホ版の「直す」の「＋」で足す付箋
import { sidePlace, appendSideNotes } from "../../src/sidenote.js";
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

// 試験データ: #1 (40,80) 260×182、そのすぐ右 (324,80) に #2（ぶつかる）、#3 は開いた付箋 (700,80) 430×400 で中に #4 (10,10) 160×140
const N = (id, num, x, y, extra = {}) => ({ id, num, text: id, x, y, w: 260, h: 182, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 5, z: num, ...extra });
const board = () => ({ id: "b1", nextNum: 5, notes: [
  N("n1", 1, 40, 80, { color: 2, tags: ["メイン"], useTitle: true, title: "題" }), N("n2", 2, 324, 80),
  N("n3", 3, 700, 80, { expanded: true, z: 9 }), N("k4", 4, 10, 10, { parentId: "n3", w: 160, h: 140, ew: 340, eh: 300 }),
], edges: [{ id: "e0", from: "n1", to: "n2" }], texts: [], zones: [], strokes: [], images: [] });

console.log("■ 置き場所（パソコン版の「＋→」と同じ）");
{
  const b = board();
  eq("すぐ右（間隔24）に空きがあればそこ", sidePlace([N("a", 1, 0, 0)], N("a", 1, 0, 0), { w: 260, h: 182 }), { x: 284, y: 0 });
  eq("#2 の右（608）は開いた #3 とぶつかるので、#3 の右（1154）", sidePlace(b.notes, b.notes[1], { w: 260, h: 182 }), { x: 1154, y: 80 });
  eq("ぶつかれば、ぶつかった付箋の右へずらす（#1 の右は #2 → #3 → その右）", sidePlace(b.notes, b.notes[0], { w: 260, h: 182 }), { x: 700 + 430 + 24, y: 80 });
  eq("目盛りに合わせる関数を渡すと合わせる", sidePlace([N("a", 1, 0, 0)], N("a", 1, 0, 0), { w: 260, h: 182 }, { gap: 26, snap: (v) => Math.round(v / 26) * 26 }), { x: 286, y: 0 });
  eq("中の付箋で、親の中に入るなら右（194+160=354 ≦ 430-16）", sidePlace(b.notes, b.notes[3], { w: 160, h: 140 }), { x: 194, y: 10 });
  const right = { ...b.notes[3], x: 200 };                       // 右は 384+160=544 > 414 ではみ出す
  eq("中の付箋で、親の中の幅からはみ出すときは下へ", sidePlace([...b.notes.slice(0, 3), right], right, { w: 160, h: 140 }), { x: 200, y: 10 + 140 + 24 });
}

console.log("\n■ つながる付箋を足す");
{
  let k = 0;
  const newId = () => "new" + ++k;
  const b0 = board();
  const b = appendSideNotes(b0, "n1", [{ text: "一枚目", color: 2, tags: ["メイン"], useTitle: false }, { text: "二枚目", title: "題2", useTitle: true, color: 0, tags: [] }], { newId });
  const added = b.notes.slice(4);
  eq("2枚足される。番号はボードの続き", added.map((n) => [n.text, n.num]), [["一枚目", 5], ["二枚目", 6]]);
  eq("ボードの番号の続きが進む", b.nextNum, 7);
  eq("1枚目は元の付箋の右（ぶつからない所）、2枚目はその右", added.map((n) => [n.x, n.y]), [[1154, 80], [1154 + 260 + 24, 80]]);
  eq("色・タグ・タイトルは書いたとおり", added.map((n) => [n.color, n.tags, n.useTitle, n.title]), [[2, ["メイン"], false, ""], [0, [], true, "題2"]]);
  eq("大きさは元の付箋から、親も同じ（最上位）", added.map((n) => [n.w, n.h, n.ew, n.eh, n.parentId]), [[260, 182, 430, 400, null], [260, 182, 430, 400, null]]);
  eq("重なり順はボードの一番上の次", added.map((n) => n.z), [10, 11]);
  eq("線は 元→1枚目→2枚目（今ある線はそのまま）", b.edges.map((e) => [e.from, e.to]), [["n1", "n2"], ["n1", added[0].id], [added[0].id, added[1].id]]);
  eq("今ある付箋は1文字も変わらない", JSON.stringify(b.notes.slice(0, 4)), JSON.stringify(b0.notes));
  eq("元のボードは書き換えない（新しいボードを返す）", [b0.notes.length, b0.edges.length, b0.nextNum], [4, 1, 5]);
  const ids = new Set([...b.notes.map((n) => n.id), ...b.edges.map((e) => e.id)]);
  eq("id はすべて違う", ids.size, b.notes.length + b.edges.length);
}
{
  let k = 0;
  const b = appendSideNotes(board(), "k4", [{ text: "中に足す", color: 5, tags: [] }], { newId: () => "c" + ++k });
  const n = b.notes.at(-1);
  eq("中の付箋に足すと、同じ親の中・中の付箋の大きさ・入るなら右", [n.parentId, n.w, n.h, n.ew, n.eh, n.x, n.y], ["n3", 160, 140, 340, 300, 194, 10]);
  const b2 = board(); b2.notes[3] = { ...b2.notes[3], x: 200 };
  const m = appendSideNotes(b2, "k4", [{ text: "下に" }], { newId: () => "d" + ++k }).notes.at(-1);
  eq("中の付箋に足して親からはみ出すなら下", [m.x, m.y], [200, 174]);
}
{
  const b0 = board();
  eq("元の付箋が無ければそのまま返す", appendSideNotes(b0, "無い", [{ text: "x" }], { newId: () => "z" }) === b0, true);
  eq("足すものが無ければそのまま返す", appendSideNotes(b0, "n1", [], { newId: () => "z" }) === b0, true);
}

console.log(ng === 0 ? "\nつながる付箋を置く: すべて期待どおりです" : `\nつながる付箋を置く: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
