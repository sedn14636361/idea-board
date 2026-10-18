// 開いていない手元のプロジェクトも、起動するとサーバーへ上がるか（6.6.0 で修正）
// 6.5.0 までは起動直後の突き合わせが読み込み前の空の一覧を見ており、開くまでサーバーへ上がらなかった
import { device, F, eq, done } from "./harness.mjs";
const note = (id, num, text) => ({ id, num, text, x: 60, y: 80, w: 190, h: 170, tags: [], refs: [], parentId: null });
const board = (id, notes) => ({ id, title: "ボード1", nextNum: notes.length + 1, notes, edges: [], texts: [], zones: [], strokes: [], images: [] });
const A = { id: "PA", name: "プロジェクトA", currentBoardId: "a1", boards: [board("a1", [note("n1", 1, "A")])] };
const B = { id: "PB", name: "プロジェクトB", currentBoardId: "b1", boards: [board("b1", [note("m1", 1, "B")])] };
const P = await device("P", { base: process.env.BASE });
await P.evaluate(({ A, B }) => {
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: A.name }, { id: "PB", name: B.name }], currentProjectId: "PA" }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
  localStorage.setItem("idea-board-project:PB", JSON.stringify(B));
}, { A, B });
await P.reload();
const onServer = () => [...F.DB.keys()].filter((k) => !k.startsWith("__")).sort();
for (let i = 0; i < 30 && onServer().length < 2; i++) await P.waitForTimeout(1000);
eq("開いていない B もサーバーへ上がる", onServer(), ["PA", "PB"]);
await done("開いていないプロジェクトの送信");
