// 付箋を別のボード・別のプロジェクトへ移す／複製する（6.6.0）
//   範囲選択の「↗ 移動」・付箋の ⧉・付箋リスト（☰）の3つの入口から、どのプロジェクトのどのボードへでも移せるか
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1400, height: 860 } })).newPage();
pg.on("pageerror", (e) => console.log("  pageerror:", e.message));

const note = (id, num, text, x, y, extra = {}) => ({ id, num, text, x, y, w: 190, h: 170, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 0, z: num, ...extra });
const board = (id, title, notes = [], extra = {}) => ({ id, title, nextNum: notes.length + 1, notes, edges: [], texts: [], zones: [], strokes: [], images: [], ...extra });
// プロジェクトA: ボード1 に ①（中に②）③④・文字2つ、線 ①–③ と ④–①。ボード2 は空
const A = { id: "PA", name: "プロジェクトA", currentBoardId: "a1", boards: [
  board("a1", "ボード1", [note("n1", 1, "①", 120, 140), note("n2", 2, "②", 10, 10, { parentId: "n1" }), note("n3", 3, "③ #1 を見る", 420, 160), note("n4", 4, "④", 900, 140, { refs: ["n1"] })],
    { edges: [{ id: "e13", from: "n1", to: "n3", memo: "原因" }, { id: "e41", from: "n4", to: "n1" }],
      texts: [{ id: "t1", text: "見出し", x: 120, y: 90, size: 1 }, { id: "t2", text: "残る文字", x: 900, y: 90, size: 1 }] }),
  board("a2", "ボード2")] };
// プロジェクトB: ボード1 は空、ボード2 に2枚（起動時には読み込まれない＝開いていないプロジェクト）
const B = { id: "PB", name: "プロジェクトB", currentBoardId: "b1", boards: [
  board("b1", "ボード1"), board("b2", "ボード2", [note("m1", 1, "B2の1", 60, 80), note("m2", 2, "B2の2", 300, 80)])] };

await pg.goto(BASE);
await pg.evaluate(({ A, B }) => {
  localStorage.clear();
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: A.name }, { id: "PB", name: B.name }], currentProjectId: "PA" }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
  localStorage.setItem("idea-board-project:PB", JSON.stringify(B));
}, { A, B });
const open = async () => {
  await pg.reload(); await pg.waitForTimeout(1500);
  const s = pg.getByText("プロジェクトA", { exact: true });
  if (await s.count()) { await s.first().dblclick(); await pg.waitForTimeout(800); }
};
await open();
const saved = (pid, bid) => pg.evaluate(({ pid, bid }) => {
  const b = JSON.parse(localStorage.getItem("idea-board-project:" + pid)).boards.find((x) => x.id === bid);
  return { notes: b.notes.map((n) => `${n.num}:${n.text}${n.parentId ? "(中)" : ""}`), edges: b.edges.length, texts: (b.texts || []).map((t) => t.text) };
}, { pid, bid });
const boxOf = async (text) => pg.evaluate((text) => {
  const ta = [...document.querySelectorAll("textarea")].find((t) => t.value === text);
  const r = ta.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
}, text);

console.log("■ 範囲選択（①③と文字「見出し」）→「↗ 移動」→ プロジェクトB のボード2");
const b1 = await boxOf("①"), b3 = await boxOf("③ #1 を見る");
const tl = await pg.getByText("見出し", { exact: true }).boundingBox();
await pg.mouse.move(tl.x - 30, tl.y - 15);
await pg.mouse.down();
await pg.mouse.move(b3.x + b3.w + 40, b3.y + b3.h + 60, { steps: 8 });
await pg.mouse.up();
await pg.waitForTimeout(300);
eq("3個選択中（①③と文字）", await pg.getByText(/個選択中$/).innerText(), "3個選択中");
await pg.getByRole("button", { name: "↗ 移動" }).click();
await pg.waitForTimeout(800);
eq("行き先に、開いていないプロジェクトのボードも出る", await pg.locator("[data-dest]").evaluateAll((els) => els.map((e) => e.dataset.dest)),
  ["プロジェクトA/ボード1", "プロジェクトA/ボード2", "プロジェクトB/ボード1", "プロジェクトB/ボード2"]);
await pg.locator('[data-dest="プロジェクトB/ボード2"]').getByRole("button", { name: "移動" }).click();
await pg.waitForTimeout(1800);
const a1 = await saved("PA", "a1"), b2 = await saved("PB", "b2");
eq("B2: 既存の続きの番号で、①（中に②）③と文字が入る。①–③ の線も", b2, { notes: ["1:B2の1", "2:B2の2", "3:①", "4:②(中)", "5:③ #3 を見る"], edges: 1, texts: ["見出し"] });
eq("A1: ④だけ残って #1 に。④–① の線は消える。文字「残る文字」は残る", a1, { notes: ["1:④"], edges: 0, texts: ["残る文字"] });
eq("選択は解除される", await pg.getByText(/個選択中$/).count(), 0);
await open();
eq("開き直しても同じ（A1）", await saved("PA", "a1"), a1);
eq("開き直しても同じ（B2）", await saved("PB", "b2"), b2);

console.log("\n■ 付箋の ⧉ → 別のボード（A のボード2）へ「複製」");
await pg.evaluate(() => {
  let e = [...document.querySelectorAll("textarea")].find((t) => t.value === "④");
  while (e && !e.querySelector?.('button[title^="複製・他のボード"]')) e = e.parentElement;
  e.querySelector('button[title^="複製・他のボード"]').click();
});
await pg.waitForTimeout(700);
await pg.locator('[data-dest="プロジェクトA/ボード2"]').getByRole("button", { name: "複製" }).click();
await pg.waitForTimeout(1500);
eq("A2 に ④ の複製", (await saved("PA", "a2")).notes, ["1:④"]);
eq("A1 の ④ はそのまま", (await saved("PA", "a1")).notes, ["1:④"]);

console.log("\n■ 付箋リスト（☰）で ④ を選んで「移動」→ プロジェクトB のボード1");
await pg.getByTitle("付箋リストを開く／閉じる").click();
await pg.waitForTimeout(400);
await pg.locator("input[type=checkbox]").first().check();
await pg.getByRole("button", { name: "移動", exact: true }).first().click();
await pg.waitForTimeout(800);
await pg.locator('[data-dest="プロジェクトB/ボード1"]').getByRole("button", { name: "移動" }).click();
await pg.waitForTimeout(1800);
eq("B1 に ④", (await saved("PB", "b1")).notes, ["1:④"]);
eq("A1 は空になる", (await saved("PA", "a1")).notes, []);
eq("B2 はそのまま", (await saved("PB", "b2")).notes, b2.notes);

await browser.close();
console.log(ng === 0 ? "\n付箋の移動: すべて期待どおりです" : `\n付箋の移動: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
