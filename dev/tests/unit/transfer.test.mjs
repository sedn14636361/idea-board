// transferNotes: 付箋をボード・プロジェクトをまたいで移す／複製する（src/notes.js）
import { transferNotes } from "../../src/notes.js";
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

let seq = 0;
const ids = () => `new${++seq}`;
const z = () => 100 + seq;
const note = (id, num, text, x, y, extra = {}) => ({ id, num, text, x, y, w: 190, h: 170, parentId: null, tags: [], refs: [], ...extra });
// プロジェクトA: ボードA1 に ①（中に②）③④ と直書き文字。線 ①–③、④–①。④は①を引用、③の本文は「#1 を見る」
const A = () => ({ id: "PA", name: "A", currentBoardId: "a1", boards: [
  { id: "a1", nextNum: 5, notes: [
    note("n1", 1, "①", 100, 100, { src: { id: "phone1", rev: 0 } }), note("n2", 2, "②", 10, 10, { parentId: "n1" }),
    note("n3", 3, "③ #1 を見る", 400, 140), note("n4", 4, "④ #3 と #1", 800, 100, { refs: ["n1"] })],
    edges: [{ id: "e13", from: "n1", to: "n3", memo: "原因" }, { id: "e41", from: "n4", to: "n1" }],
    texts: [{ id: "t1", text: "見出し", x: 100, y: 60 }, { id: "t2", text: "残る文字", x: 900, y: 60 }] },
  { id: "a2", nextNum: 1, notes: [], edges: [], texts: [] }] });
// プロジェクトB: ボードB1、B2（B2 に既存の付箋が2枚）
const B = () => ({ id: "PB", name: "B", currentBoardId: "b1", boards: [
  { id: "b1", nextNum: 1, notes: [], edges: [], texts: [] },
  { id: "b2", nextNum: 3, notes: [note("m1", 1, "B2の1", 60, 80), note("m2", 2, "B2の2", 300, 80)], edges: [], texts: [] }] });
const board = (ps, pid, bid) => ps.find((p) => p.id === pid).boards.find((b) => b.id === bid);
const sum = (b) => b.notes.map((n) => `${n.num}:${n.text}${n.parentId ? "(中)" : ""}`);

console.log("■ ①（中に②）③ と文字を、プロジェクトB のボードB2 へ移す");
{
  const r = transferNotes([A(), B()], { from: { pid: "PA", bid: "a1" }, to: { pid: "PB", bid: "b2" }, noteIds: ["n1", "n3"], textIds: ["t1"], move: true, newId: ids, newZ: z });
  const b2 = board(r.projects, "PB", "b2"), a1 = board(r.projects, "PA", "a1");
  eq("移した数（中の付箋を含む）", [r.moved, r.texts], [3, 1]);
  eq("B2: 既存の続きの番号で並ぶ。②は①の中のまま", sum(b2), ["1:B2の1", "2:B2の2", "3:①", "4:②(中)", "5:③ #3 を見る"]);
  eq("B2: 次の番号", b2.nextNum, 6);
  const [c1, c2, c3] = b2.notes.slice(2);
  eq("B2: ②の親は新しい①", c2.parentId, c1.id);
  eq("B2: 一緒に移した ①–③ の線は残る（メモも）", b2.edges.map((e) => [e.from === c1.id, e.to === c3.id, e.memo]), [[true, true, "原因"]]);
  eq("B2: 並びはそのまま、既存の付箋の右側（490+60=550）に置く", [c1.x, c1.y, c3.x, c3.y], [550, 120, 850, 160]);
  eq("B2: 中の付箋の位置は親の中のまま", [c2.x, c2.y], [10, 10]);
  eq("B2: 文字も同じだけずれて移る", b2.texts.map((t) => [t.text, t.x, t.y]), [["見出し", 550, 80]]);
  eq("B2: スマホから取り込んだ印は、移すときは残す", c1.src, { id: "phone1", rev: 0 });
  eq("A1: ④だけ残り、#1 に詰め直す。本文の #番号 は残った付箋の分だけ書き換える", sum(a1), ["1:④ #3 と #1"]);
  eq("A1: ④–① の線は消える", a1.edges, []);
  eq("A1: ④の引用（①）は外れる", a1.notes[0].refs, []);
  eq("A1: 選ばなかった文字は残る", a1.texts.map((t) => t.text), ["残る文字"]);
  eq("ほかのボードには触らない", [board(r.projects, "PA", "a2").notes.length, board(r.projects, "PB", "b1").notes.length], [0, 0]);
}

console.log("\n■ 複製（元はそのまま）");
{
  const a = A();
  const r = transferNotes([a, B()], { from: { pid: "PA", bid: "a1" }, to: { pid: "PB", bid: "b1" }, noteIds: ["n1"], move: false, newId: ids, newZ: z });
  eq("元のプロジェクトは同じもの（書き換えていない）", r.projects[0] === a, true);
  eq("B1: 空のボードなので左上（60, 80）に置く", board(r.projects, "PB", "b1").notes.map((n) => [n.num, n.text, n.x, n.y]), [[1, "①", 60, 80], [2, "②", 10, 10]]);
  eq("複製ではスマホの印を外す", board(r.projects, "PB", "b1").notes[0].src, undefined);
}

console.log("\n■ 同じプロジェクトの別のボードへ移す");
{
  const r = transferNotes([A()], { from: { pid: "PA", bid: "a1" }, to: { pid: "PA", bid: "a2" }, noteIds: ["n3"], move: true, newId: ids, newZ: z });
  eq("A2 に移り、A1 から消える", [sum(board(r.projects, "PA", "a2")), sum(board(r.projects, "PA", "a1"))],
    [["1:③ #1 を見る"], ["1:①", "2:②(中)", "3:④ #3 と #1"]]);
}

console.log("\n■ 中の付箋だけを選んでも、その付箋から下が移る（親は残る）");
{
  const r = transferNotes([A(), B()], { from: { pid: "PA", bid: "a1" }, to: { pid: "PB", bid: "b1" }, noteIds: ["n2"], move: true, newId: ids, newZ: z });
  eq("B1: ②が一番上の付箋になる", board(r.projects, "PB", "b1").notes.map((n) => [n.text, n.parentId]), [["②", null]]);
  eq("A1: ①は残る", sum(board(r.projects, "PA", "a1")), ["1:①", "2:③ #1 を見る", "3:④ #2 と #1"]);
}

console.log("\n■ 何もしない場合");
{
  const ps = [A(), B()];
  eq("同じボードへは移さない", transferNotes(ps, { from: { pid: "PA", bid: "a1" }, to: { pid: "PA", bid: "a1" }, noteIds: ["n1"], move: true, newId: ids, newZ: z }).projects, ps);
  eq("移す先が読み込まれていなければ何もしない（元も消さない）", transferNotes([A()], { from: { pid: "PA", bid: "a1" }, to: { pid: "PB", bid: "b1" }, noteIds: ["n1"], move: true, newId: ids, newZ: z }).moved, 0);
  eq("選んだものが無ければ何もしない", transferNotes(ps, { from: { pid: "PA", bid: "a1" }, to: { pid: "PB", bid: "b1" }, noteIds: ["無い"], move: true, newId: ids, newZ: z }).projects, ps);
}

console.log(ng === 0 ? "\n付箋の移動: すべて期待どおりです" : `\n付箋の移動: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
