// 元に戻す／やり直すの履歴（src/history.js）
import { makeHist, recordChange, undoStep, redoStep, canUndo, canRedo, sameBoards, boardToShow, GROUP_MS, DEPTH } from "../../src/history.js";
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

// 試験データ: 色の違う付箋3枚（#2 はタグ付き、#3 の中に付箋1枚）、線1本、文字1つ、画像1枚
const n1 = { id: "a", num: 1, x: 0, y: 0, color: 0, tags: [], z: 1 };
const n2 = { id: "b", num: 2, x: 300, y: 0, color: 3, tags: ["メイン", "重要度高"], z: 2 };
const n3 = { id: "c", num: 3, x: 600, y: 0, color: 5, tags: [], z: 3 };
const k1 = { id: "k", num: 4, parentId: "c", x: 10, y: 10, color: 5, tags: [], z: 4 };
const B1 = { id: "B1", title: "ボード1", nextNum: 5, notes: [n1, n2, n3, k1], edges: [{ id: "e", from: "a", to: "b" }],
  texts: [{ id: "t", x: 0, y: 400, text: "見出し", z: 5 }], images: [{ id: "i1", x: 0, y: 600, w: 100, h: 80 }, { id: "i2", x: 200, y: 600, w: 100, h: 80 }] };
const B2 = { id: "B2", title: "ボード2", nextNum: 1, notes: [], edges: [] };
const S = (boards, cur = "B1") => ({ boards, currentBoardId: cur });
const s0 = S([B1, B2]);
const withNotes = (b, notes) => ({ ...b, notes });

// ---- 変わったかどうか ----
eq("同じ参照は同じ", sameBoards(s0.boards, s0.boards), true);
eq("付箋を前面に上げただけ（z だけ）は変わっていない", sameBoards(s0.boards, [withNotes(B1, B1.notes.map((n) => n.id === "a" ? { ...n, z: 99 } : n)), B2]), true);
eq("文字の z だけも変わっていない", sameBoards(s0.boards, [{ ...B1, texts: [{ ...B1.texts[0], z: 50 }] }, B2]), true);
eq("画像をつかんで並びが変わっただけは変わっていない", sameBoards(s0.boards, [{ ...B1, images: [B1.images[1], B1.images[0]] }, B2]), true);
eq("タグを付けて外した（中身が同じ別の配列）は変わっていない", sameBoards(s0.boards, [withNotes(B1, B1.notes.map((n) => n.id === "b" ? { ...n, tags: ["メイン", "重要度高"] } : n)), B2]), true);
eq("動かせば変わった", sameBoards(s0.boards, [withNotes(B1, B1.notes.map((n) => n.id === "a" ? { ...n, x: 5 } : n)), B2]), false);
eq("色を変えれば変わった", sameBoards(s0.boards, [withNotes(B1, B1.notes.map((n) => n.id === "a" ? { ...n, color: 1 } : n)), B2]), false);
eq("タグの順が違えば変わった", sameBoards(s0.boards, [withNotes(B1, B1.notes.map((n) => n.id === "b" ? { ...n, tags: ["重要度高", "メイン"] } : n)), B2]), false);
eq("線のメモが付けば変わった", sameBoards(s0.boards, [{ ...B1, edges: [{ ...B1.edges[0], memo: "理由" }] }, B2]), false);
eq("ボード名が変われば変わった", sameBoards(s0.boards, [{ ...B1, title: "第一章" }, B2]), false);
eq("ボードが増えれば変わった", sameBoards(s0.boards, [B1, B2, { id: "B3", notes: [] }]), false);
eq("付箋の中身の違いが無い項目を足しても（undefined）変わらない", sameBoards(s0.boards, [withNotes(B1, B1.notes.map((n) => n.id === "a" ? { ...n, memo: undefined } : n)), B2]), true);

// ---- 剥がす → 戻す（中の付箋・線・番号も戻る） ----
{
  const h = makeHist();
  // #3（中に k を持つ）を剥がす: c と k が消え、番号が詰まる（この試験では詰めた後の状態を手で作る）
  const removed = S([{ ...B1, nextNum: 3, notes: [n1, n2], edges: B1.edges }, B2]);
  recordChange(h, s0, 1000, { boundary: true });
  eq("剥がしたあとは戻せる", canUndo(h, removed), true);
  const back = undoStep(h, removed);
  eq("戻すと剥がす前の丸ごと（中の付箋・番号も）", back === s0, true);
  eq("戻したらやり直せる", canRedo(h, back), true);
  const again = redoStep(h, back);
  eq("やり直すと剥がした状態", again === removed, true);
  eq("やり直したあとはもう一度戻せる", undoStep(h, again) === s0, true);
}

// ---- まとめ方 ----
{
  const h = makeHist();
  let st = s0, t = 0;
  const move = (x, opt) => { const nx = S([withNotes(B1, st.boards[0].notes.map((n) => n.id === "a" ? { ...n, x } : n)), B2]); recordChange(h, st, t, opt); st = nx; };
  // ドラッグ: 押し始め(boundary) → 押している間は2秒止まっても同じ手
  move(10, { boundary: true, pointerDown: true }); t += 16;
  move(20, { pointerDown: true }); t += 2000;
  move(30, { pointerDown: true });
  const afterDrag = st;
  // 離して 100ms 後に打った1文字は別の手にしたいので、押し始め（クリック）を boundary にする
  t += 100; move(40, { boundary: true });
  // 続けて 0.3秒ごとに入力 → 同じ手
  t += 300; move(41, {}); t += 300; move(42, {});
  // 0.6秒止まってから入力 → 新しい手
  t += GROUP_MS + 100; move(43, {});
  const a = undoStep(h, st);
  eq("止まってから打った分だけ戻る", a.boards[0].notes[0].x, 42);
  const b = undoStep(h, a);
  eq("ひと続きの入力は1手", b.boards[0].notes[0].x, 30);
  const c = undoStep(h, b);
  eq("ドラッグ1回は（途中で止まっても）1手", c.boards[0].notes[0].x, 0);
  eq("それ以上は戻らない", undoStep(h, c), null);
  eq("ドラッグ後の状態へやり直せる", redoStep(h, c) === afterDrag, true);
}

// ---- 押しただけ（前面に上げる）の手は積まない ----
{
  const h = makeHist();
  const raised = S([withNotes(B1, B1.notes.map((n) => n.id === "a" ? { ...n, z: 99 } : n)), B2]);
  recordChange(h, s0, 0, { boundary: true });
  eq("押しただけでは戻すものが無い", canUndo(h, raised), false);
  eq("押しただけでは戻らない", undoStep(h, raised), null);
}

// ---- 戻したあとに変えたら、やり直しは消える ----
{
  const h = makeHist();
  const s1 = S([withNotes(B1, [n1]), B2]);
  recordChange(h, s0, 0, { boundary: true });
  const back = undoStep(h, s1);
  const s2 = S([withNotes(B1, [n2]), B2]);
  recordChange(h, back, 10, { boundary: true });
  eq("戻したあとに変えたら、やり直せない（ボタン）", canRedo(h, s2), false);
  eq("戻したあとに変えたら、やり直せない（キー）", redoStep(h, s2), null);
  eq("変えた分は戻せる", undoStep(h, s2) === back, true);
}

// ---- 上限 ----
{
  const h = makeHist();
  let st = s0;
  for (let i = 1; i <= DEPTH + 20; i++) {
    const nx = S([withNotes(B1, [{ ...n1, x: i }]), B2]);
    recordChange(h, st, i * 10000, { boundary: true });
    st = nx;
  }
  let count = 0, cur = st, s;
  while ((s = undoStep(h, cur))) { cur = s; count++; }
  eq(`${DEPTH}手まで戻れる`, count, DEPTH);
  eq("いちばん古い手は捨てられる", cur.boards[0].notes[0].x, 20);
}

// ---- 戻したあとに見せるボード ----
{
  const onB1 = S([B1, B2], "B1");
  const b2Changed = S([B1, { ...B2, notes: [n1] }], "B1");
  eq("今のボードが変わらず、別のボードが変わるならそちらへ", boardToShow(onB1, b2Changed), "B2");
  eq("今のボードが変わるならそのまま", boardToShow(S([withNotes(B1, [n1]), B2], "B1"), onB1), "B1");
  eq("消したボードを戻したら、そのボードを開く", boardToShow(S([B1, B2], "B1"), S([B1], "B1")), "B2");
  const B3 = { id: "B3", title: "ボード3", notes: [] };
  eq("足したボードを開いたまま戻したら、足す前に開いていたボード", boardToShow(S([B1, B2], "B2"), S([B1, B2, B3], "B3")), "B2");
}

console.log(ng === 0 ? "\n元に戻す: すべて期待どおりです" : `\n元に戻す: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
