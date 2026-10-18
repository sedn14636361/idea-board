// 付箋を別のプロジェクトへ移したとき、クラウドの A と B の両方が新しい中身になるか（6.6.0）
import { device, F, eq, done } from "./harness.mjs";
const BASE = process.env.BASE;
const note = (id, num, text, x, y, extra = {}) => ({ id, num, text, x, y, w: 190, h: 170, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 0, z: num, ...extra });
const board = (id, title, notes = []) => ({ id, title, nextNum: notes.length + 1, notes, edges: [], texts: [], zones: [], strokes: [], images: [] });
const A = { id: "PA", name: "プロジェクトA", currentBoardId: "a1", boards: [board("a1", "ボード1", [note("n1", 1, "移す付箋", 120, 140), note("n4", 2, "残る付箋", 900, 140)])] };
const B = { id: "PB", name: "プロジェクトB", currentBoardId: "b1", boards: [board("b1", "ボード1", [note("m1", 1, "Bの付箋", 60, 80)])] };
const P = await device("P", { base: BASE });
await P.evaluate(({ A, B }) => {
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: A.name }, { id: "PB", name: B.name }], currentProjectId: "PA" }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
  localStorage.setItem("idea-board-project:PB", JSON.stringify(B));
}, { A, B });
await P.reload(); await P.waitForTimeout(2000);
const s = P.getByText("プロジェクトA", { exact: true }); if (await s.count()) { await s.first().dblclick(); }
const server = (pid) => { const h = F.DB.get(pid); if (!h) return null; const b = JSON.parse(h.fields.meta.stringValue).boards[0];
  const id = (i) => (b.v ? `__b_${pid}_${b.id}_${b.v}_${i}` : `__b_${pid}_${b.id}_${i}`);
  return JSON.parse(Array.from({ length: b.parts }, (_, i) => F.DB.get(id(i)).fields.part.stringValue).join("")).notes.map((n) => n.text); };
// 開いているプロジェクト（A）がサーバーに上がるまで待つ。開いていない B は、移して読み込まれたときに上がる
for (let i = 0; i < 40 && !server("PA"); i++) await P.waitForTimeout(1000);
eq("移す前: サーバーの A", server("PA"), ["移す付箋", "残る付箋"]);
await P.evaluate(() => {
  let e = [...document.querySelectorAll("textarea")].find((t) => t.value === "移す付箋");
  while (e && !e.querySelector?.('button[title^="複製・他のボード"]')) e = e.parentElement;
  e.querySelector('button[title^="複製・他のボード"]').click();
});
await P.waitForTimeout(700);
await P.locator('[data-dest="プロジェクトB/ボード1"]').getByRole("button", { name: "移動" }).click();
await P.waitForTimeout(15000);
eq("移した後: サーバーの A から消える", server("PA"), ["残る付箋"]);
eq("移した後: サーバーの B に届く", server("PB"), ["Bの付箋", "移す付箋"]);
await done("クラウドとの付箋の移動");
