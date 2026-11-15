// 入力欄で打った文章は、入力欄の外の Ctrl+Z では戻さない（src/history.js の typed / mergeText / rebaseRefs。6.22.0）
// 文章 = 付箋の本文・タイトル、直書きの文字、領域の名前、線のメモ。打った文章は入力欄の中の Ctrl+Z（ブラウザ）で戻す。
// ボタンなどで文章を変えた手（打ったのではない）はふつうに戻る
import { makeHist, recordChange, undoStep, redoStep, canUndo, canRedo, mergeText, rebaseRefs, DEPTH } from "../../src/history.js";
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

// 試験データ: 付箋3枚（#2 の本文が #3 を指す）・直書きの文字・領域・線（メモ付き）
const a = { id: "a", num: 1, x: 0, y: 0, color: 0, tags: [], z: 1, text: "りんご", title: "" };
const b = { id: "b", num: 2, x: 300, y: 0, color: 3, tags: [], z: 2, text: "#3 を見る", title: "比べる" };
const c = { id: "c", num: 3, x: 600, y: 0, color: 2, tags: [], z: 3, text: "みかん", title: "" };
const B = () => ({ id: "B1", title: "ボード1", nextNum: 4, notes: [a, b, c], edges: [{ id: "e", from: "a", to: "b", memo: "原因" }],
  texts: [{ id: "t", x: 0, y: 400, text: "見出し", size: 1, z: 4 }], zones: [{ id: "z", x: -20, y: -40, w: 900, h: 300, color: "#ccc", label: "第1章" }] });
const S = () => ({ boards: [B()], currentBoardId: "B1" });
const setNote = (st, id, patch) => ({ ...st, boards: [{ ...st.boards[0], notes: st.boards[0].notes.map((n) => n.id === id ? { ...n, ...patch } : n) }] });
const setIn = (st, key, id, patch) => ({ ...st, boards: [{ ...st.boards[0], [key]: st.boards[0][key].map((x) => x.id === id ? { ...x, ...patch } : x) }] });
const N = (st, id) => st.boards[0].notes.find((n) => n.id === id);

// 画面の動きを真似る: 変化のたびに「変わる前の状態」を記録する。typed: 入力欄で打った変化
const run = () => {
  const h = makeHist();
  let st = S(), t = 0;
  return {
    h, get st() { return st; }, set st(v) { st = v; },
    change(next, { boundary = true, wait = 1000, typed = false } = {}) { t += wait; recordChange(h, st, t, { boundary, typed }); st = next; },
    type(next, o = {}) { this.change(next, { ...o, typed: true }); },
  };
};

// 1) 動かす → 本文を打つ → 入力欄の外で Ctrl+Z: 位置だけ戻り、打った文章は残る
{
  const r = run();
  r.change(setNote(r.st, "a", { x: 120 }));                                   // ドラッグ
  r.type(setNote(r.st, "a", { text: "りんごa" }));                            // 本文を押して打つ（押し始めで新しい手）
  r.type(setNote(r.st, "a", { text: "りんごab" }), { boundary: false, wait: 100 });
  r.type(setNote(r.st, "a", { text: "りんごabc" }), { boundary: false, wait: 900 }); // 0.5秒以上あいた（打った手が2つ）
  const back = undoStep(r.h, r.st);
  eq("1: 位置が戻る", N(back, "a").x, 0);
  eq("1: 打った文章は今のまま", N(back, "a").text, "りんごabc");
  eq("1: それ以上は戻らない", undoStep(r.h, back), null);
  const fwd = redoStep(r.h, back);
  eq("1: やり直すと動いた位置・文章は今のまま", [N(fwd, "a").x, N(fwd, "a").text], [120, "りんごabc"]);
}

// 2) 打っただけなら、入力欄の外では戻すものが無い
{
  const r = run();
  r.type(setNote(r.st, "b", { text: "#3 を見る！" }));
  r.type(setNote(r.st, "b", { title: "比べる2" }));
  eq("2: 戻すものは無い（ボタンは押せない）", canUndo(r.h, r.st), false);
  eq("2: Ctrl+Z を押しても何も返らない", undoStep(r.h, r.st), null);
}

// 3) 直書きの文字・領域の名前・線のメモ・タイトルも、打てば残る。色は戻る
{
  const r = run();
  r.change(setNote(r.st, "c", { color: 4 }));
  let s = setNote(r.st, "c", { title: "柑橘" });
  s = setIn(s, "texts", "t", { text: "大見出し" });
  s = setIn(s, "zones", "z", { label: "第一章" });
  s = setIn(s, "edges", "e", { memo: "結果" });
  r.type(s);
  const back = undoStep(r.h, r.st);
  const bb = back.boards[0];
  eq("3: 色が戻る", N(back, "c").color, 2);
  eq("3: 打った文章（タイトル・文字・領域の名前・線のメモ）は今のまま",
    [N(back, "c").title, bb.texts[0].text, bb.zones[0].label, bb.edges[0].memo], ["柑橘", "大見出し", "第一章", "結果"]);
}

// 4) ボタンなどで文章を変えた手（打ったのではない。例: タイトルの一括変更）は戻る
{
  const r = run();
  r.change(setNote(setNote(r.st, "a", { title: "序 1/2" }), "b", { title: "序 2/2" }));
  const back = undoStep(r.h, r.st);
  eq("4: ボタンで変えたタイトルは戻る", [N(back, "a").title, N(back, "b").title], ["", "比べる"]);
  // そのあと #2 のタイトルだけ打って直していたら、打った方は残す
  const r2 = run();
  r2.change(setNote(setNote(r2.st, "a", { title: "序 1/2" }), "b", { title: "序 2/2" }));
  r2.type(setNote(r2.st, "b", { title: "序 2/2 改" }));
  const back2 = undoStep(r2.h, r2.st);
  eq("4: 打って直したタイトルは残り、ほかは戻る", [N(back2, "a").title, N(back2, "b").title], ["", "序 2/2 改"]);
}

// 5) 剥がして番号が詰まったあとに本文を打った → Ctrl+Z: 付箋と番号が戻り、本文は打った分を残して #番号 だけ戻る
{
  const r = run();
  // #1（a）を剥がす: b→#1、c→#2。b の本文の「#3」は「#2」へ詰まる（renumber と同じ）。線 e も外れる
  r.change({ boards: [{ ...r.st.boards[0], nextNum: 3, edges: [], notes: [{ ...b, num: 1, text: "#2 を見る" }, { ...c, num: 2 }] }], currentBoardId: "B1" });
  r.type(setNote(r.st, "b", { text: "#2 を見る！" }));
  const back = undoStep(r.h, r.st);
  eq("5: 剥がした付箋が番号ごと戻る", back.boards[0].notes.map((n) => `${n.id}#${n.num}`), ["a#1", "b#2", "c#3"]);
  eq("5: 打った「！」は残り、#番号 は c を指す #3 に戻る", N(back, "b").text, "#3 を見る！");
  eq("5: 線も戻る（メモごと）", back.boards[0].edges, [{ id: "e", from: "a", to: "b", memo: "原因" }]);
}

// 6) 消えた付箋を指していた #番号（詰めても変わらない）に打ち足した → 戻すとそのまま（別の付箋を指すように変えない）
{
  const r = run();
  const b6 = { ...b, text: "#1 を見る" };   // a（#1）を指す
  r.st = { boards: [{ ...r.st.boards[0], notes: [a, b6, c] }], currentBoardId: "B1" };
  // a を剥がす: b→#1、c→#2。b の本文の「#1」は消えた付箋を指すので書き換えない
  r.change({ boards: [{ ...r.st.boards[0], nextNum: 3, edges: [], notes: [{ ...b6, num: 1 }, { ...c, num: 2 }] }], currentBoardId: "B1" });
  r.type(setNote(r.st, "b", { text: "#1 を見る！" }));
  const back = undoStep(r.h, r.st);
  eq("6: 本文は「#1 を見る！」（a を指す）", N(back, "b").text, "#1 を見る！");
}

// 7) 打ってから剥がした付箋は、剥がしたときの文章で戻る
{
  const r = run();
  r.type(setNote(r.st, "c", { text: "みかんabc" }));
  r.change({ boards: [{ ...r.st.boards[0], nextNum: 3, notes: [a, b] }], currentBoardId: "B1" });
  const back = undoStep(r.h, r.st);
  eq("7: 剥がしたときの文章で戻る", N(back, "c").text, "みかんabc");
}

// 8) 戻したあとに打っても、やり直しは消えない（打っていない変化なら消える）
{
  const r = run();
  r.change(setNote(r.st, "a", { x: 120 }));
  r.st = undoStep(r.h, r.st);
  r.type(setNote(r.st, "a", { text: "りんご！" }));
  eq("8: 打ってもやり直せる", canRedo(r.h, r.st), true);
  const fwd = redoStep(r.h, r.st);
  eq("8: やり直すと位置が進み、文章は今のまま", [N(fwd, "a").x, N(fwd, "a").text], [120, "りんご！"]);
  r.st = fwd;
  r.st = undoStep(r.h, r.st);
  r.change(setNote(r.st, "b", { color: 0 }));
  eq("8: 色を変えたらやり直しは消える", canRedo(r.h, r.st), false);
}

// 9) 何度打っても、戻せる手の数（上限 DEPTH）を使い切らない
{
  const r = run();
  r.change(setNote(r.st, "a", { x: 120 }));
  for (let i = 0; i < DEPTH + 50; i++) r.type(setNote(r.st, "a", { text: "りんご" + i }));
  r.change(setNote(r.st, "b", { y: 50 }));
  const b1 = undoStep(r.h, r.st);
  const b2 = undoStep(r.h, b1);
  eq("9: 2回で b の移動と a の移動が戻る", [N(b1, "b").y, N(b1, "a").x, N(b2, "a").x], [0, 120, 0]);
  eq("9: 文章は最後に打ったまま", N(b2, "a").text, "りんご" + (DEPTH + 49));
}

// 10) ひと続き（0.5秒以内）に色を変えて打った: 打っていない変化が混ざった手なので、色も文章も戻る
{
  const r = run();
  r.change(setNote(r.st, "a", { color: 3 }));
  r.type(setNote(r.st, "a", { color: 3, text: "りんごx" }), { boundary: false, wait: 100 });
  const back = undoStep(r.h, r.st);
  eq("10: 色は戻る", N(back, "a").color, 0);
}

// 11) 部品
eq("11: 変えないときは同じ参照", (() => { const s = S().boards; return mergeText(s, s, s) === s; })(), true);
eq("11: #番号 の途中を打ち直した → その #番号 ごと打った方", rebaseRefs("#12 と #3", "#11 と #2", "#19 と #2"), "#19 と #3");
eq("11: 前に書き足した", rebaseRefs("#3 を見る", "#2 を見る", "はじめに #2 を見る"), "はじめに #3 を見る");
eq("11: #番号 以外も違えば合わせない（null）", rebaseRefs("abc #3", "xyz #2", "xyz #2!"), null);
eq("11: 長さの違う番号（#10 → #9）", rebaseRefs("#10 と #11", "#9 と #10", "#9 と #10 と"), "#10 と #11 と");

console.log(ng === 0 ? "\n打った文章を戻さない Ctrl+Z: すべて期待どおりです" : `\n打った文章を戻さない Ctrl+Z: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
