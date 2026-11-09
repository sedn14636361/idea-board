// 空のまま離れた直書きの文字を、履歴からも無かったことにする（src/history.js の rewriteHist / withoutBlankText。6.11.1）
import { makeHist, recordChange, undoStep, redoStep, canUndo, sameBoards, rewriteHist, withoutBlankText, isBlankText } from "../../src/history.js";
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

// 試験データ: 付箋1枚・書いてある文字「hello」(h) のボード。新しく作る文字は x（空）
const note = { id: "n", num: 1, x: 0, y: 0, color: 0, tags: [], z: 1 };
const hello = { id: "h", x: 0, y: 300, text: "hello", size: 1, z: 2 };
const B = (texts, extra = {}) => ({ id: "B1", title: "ボード1", nextNum: 2, notes: [note], edges: [], texts, ...extra });
const S = (texts, extra) => ({ boards: [B(texts, extra)], currentBoardId: "B1" });
const s0 = S([hello]);
const x = (text) => ({ id: "x", x: 500, y: 200, text, size: 1, z: 3 });

eq("空白・改行だけは空", [isBlankText({ text: "" }), isBlankText({ text: " \n\t　" }), isBlankText({}), isBlankText({ text: " a " })], [true, true, true, false]);

// 1) 作って何も書かずに離れた: 作った手ごと無かったことになり、Ctrl+Z で空の文字が戻らない
{
  const h = makeHist();
  const made = S([hello, x("")]);
  recordChange(h, s0, 1000, { boundary: true });          // 作った
  const after = S([hello]);                               // 離れたので消した（このとき今の状態は作る前と同じ）
  rewriteHist(h, withoutBlankText("x"), after);
  eq("1: 戻すものは残らない（作った手も消える）", canUndo(h, after), false);
  eq("1: Ctrl+Z を押しても何も返らない", undoStep(h, after), null);
  void made;
}

// 2) 前に別の操作（付箋を動かした）があれば、その手は残り、Ctrl+Z 1回でそれが戻る
{
  const h = makeHist();
  const moved = S([hello], { notes: [{ ...note, x: 120 }] });
  recordChange(h, s0, 1000, { boundary: true });          // 付箋を動かした（s0 → moved）
  recordChange(h, moved, 3000, { boundary: true });       // 文字を作った（moved → +x）
  const after = { boards: [{ ...moved.boards[0], texts: [hello] }], currentBoardId: "B1" };
  rewriteHist(h, withoutBlankText("x"), after);
  eq("2: 戻すものは1手（付箋を動かした手）", h.undo.length + (h.open ? 1 : 0), 1);
  const back = undoStep(h, after);
  eq("2: Ctrl+Z 1回で付箋を動かす前に戻る（空の文字は出てこない）", [back.boards[0].notes[0].x, back.boards[0].texts.map((t) => t.id)], [0, ["h"]]);
}

// 3) 書いてから全部消して離れた: 書いてあった状態には Ctrl+Z で戻れる
{
  const h = makeHist();
  recordChange(h, s0, 1000, { boundary: true });                 // 作った（s0 → +x""）
  recordChange(h, S([hello, x("")]), 1200, {});                  // 書いた（500ms 以内なので同じ手）
  const typed = S([hello, x("あいう")]);
  recordChange(h, typed, 5000, { boundary: true });              // 全部消した（typed → x""）
  const after = S([hello]);                                      // 離れたので消した
  rewriteHist(h, withoutBlankText("x"), after);
  eq("3: 戻せる", canUndo(h, after), true);
  const back = undoStep(h, after);
  eq("3: Ctrl+Z で「あいう」が戻る", back.boards[0].texts.map((t) => [t.id, t.text]), [["h", "hello"], ["x", "あいう"]]);
  const back2 = undoStep(h, back);
  eq("3: もう1回で作る前（空の文字は経由しない）", back2.boards[0].texts.map((t) => t.id), ["h"]);
}

// 4) 書いてある文字 h を全部消して離れた: Ctrl+Z で hello に戻る
{
  const h = makeHist();
  recordChange(h, s0, 1000, { boundary: true });                 // h を全部消した（s0 → h""）
  const after = S([]);
  rewriteHist(h, withoutBlankText("h"), after);
  const back = undoStep(h, after);
  eq("4: Ctrl+Z で hello に戻る", back.boards[0].texts.map((t) => [t.id, t.text]), [["h", "hello"]]);
  const fwd = redoStep(h, back);
  eq("4: やり直すと消えた状態（空の文字は出てこない）", fwd.boards[0].texts, []);
}

// 5) ほかの文字・付箋の控えは変えない。何も外さないときは同じ参照
{
  const boards = S([hello, x("")]).boards;
  const out = withoutBlankText("h")(boards);
  eq("5: 書いてある文字は外さない（同じ参照）", out === boards, true);
  const out2 = withoutBlankText("x")(boards);
  eq("5: 空の x だけ外れ、付箋と h はそのまま", [out2[0].texts.map((t) => t.id), out2[0].notes === boards[0].notes], [["h"], true]);
  eq("5: 外したら h だけのボードと同じ", sameBoards(out2, S([hello]).boards), true);
}

console.log(ng === 0 ? "\n空の文字を消す: すべて期待どおりです" : `\n空の文字を消す: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
