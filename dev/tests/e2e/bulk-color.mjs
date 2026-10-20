// 複数の付箋の色をまとめて変える（6.7.0）: 範囲選択の「● 色」と、付箋リストの「色」
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
pg.on("pageerror", (e) => console.log("  pageerror:", e.message));

// 色の番号: 0 レモン / 1 さくら / 2 そら / 3 わかば / 4 ふじ / 5 グレー
const note = (id, num, text, x, y, color, extra = {}) => ({ id, num, text, x, y, w: 190, h: 170, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color, z: num, ...extra });
const A = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 6,
  notes: [
    note("n1", 1, "レモン", 100, 100, 0),
    note("n2", 2, "さくら", 400, 100, 1),
    note("n3", 3, "そら", 700, 100, 2),
    note("n4", 4, "わかば", 100, 650, 3),
    note("c1", 5, "中の付箋", 10, 10, 1, { parentId: "n1" }),   // レモンの中（さくら色）
  ],
  edges: [], texts: [{ id: "t1", text: "見出し", x: 100, y: 400, size: 1 }], zones: [], strokes: [], images: [] }] };
await pg.goto(BASE);
await pg.evaluate((A) => {
  localStorage.clear();
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA" }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
}, A);
await pg.reload(); await pg.waitForTimeout(1500);

const colors = () => pg.evaluate(() => {
  const b = JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0];
  return { ...Object.fromEntries(b.notes.map((n) => [n.id, n.color])), text: JSON.stringify(b.texts[0]) };
});
const before = await colors();
// ボードの座標でドラッグして範囲選択する
const dragSelect = async (x1, y1, x2, y2) => {
  const o = await pg.evaluate(() => { const r = document.querySelector("[data-origin]").getBoundingClientRect(); return { x: r.left, y: r.top }; });
  await pg.mouse.move(o.x + x1, o.y + y1); await pg.mouse.down();
  await pg.mouse.move(o.x + x2, o.y + y2, { steps: 8 }); await pg.mouse.up();
  await pg.waitForTimeout(300);
};
const count = async () => (await pg.getByText(/個選択中$/).textContent().catch(() => "")) || "";

// 1) 3枚と文字を範囲選択 →「● 色」→「そら」
await dragSelect(60, 60, 950, 480);
eq("前提: 3枚と文字が選ばれている", await count(), "4個選択中");
await pg.getByRole("button", { name: "● 色" }).click();
await pg.locator('[data-selcolor] button[title="そら"]').click();
await pg.waitForTimeout(1500);
const c1 = await colors();
eq("選んだ3枚だけがそらになる", [c1.n1, c1.n2, c1.n3], [2, 2, 2]);
eq("選ばなかった付箋・中の付箋・文字は変わらない", [c1.n4, c1.c1, c1.text], [before.n4, before.c1, before.text]);
eq("選択は残っている", await count(), "4個選択中");

// 2) 開き直しても保たれる
await pg.reload(); await pg.waitForTimeout(1500);
const c2 = await colors();
eq("開き直しても色が保たれる", [c2.n1, c2.n2, c2.n3, c2.n4, c2.c1], [2, 2, 2, 3, 1]);

// 3) 文字だけを選んだときは「● 色」が出ない
await dragSelect(60, 380, 400, 480);
eq("前提: 文字だけが選ばれている", await count(), "1個選択中");
eq("文字だけのときは「● 色」が無い", await pg.getByRole("button", { name: "● 色" }).count(), 0);
await pg.getByRole("button", { name: "解除" }).click();

// 4) 付箋リストで2枚をチェック →「色」→「わかば」
await pg.locator("button", { hasText: "☰" }).first().click();
await pg.waitForTimeout(500);
const pick = async (text) => {
  const row = pg.locator("div", { has: pg.locator('input[type="checkbox"]') }).filter({ hasText: text }).last();
  await row.locator('input[type="checkbox"]').first().check();
};
await pick("レモン"); await pick("さくら");
await pg.getByRole("button", { name: "色", exact: true }).click();
await pg.locator('[data-listcolor] button[title="わかば"]').click();
await pg.waitForTimeout(1500);
const c3 = await colors();
eq("リストで選んだ2枚だけがわかばになる", [c3.n1, c3.n2], [3, 3]);
eq("リストで選ばなかった付箋は変わらない", [c3.n3, c3.n4, c3.c1], [2, 3, 1]);

// 5) 1枚ずつの色選びもこれまでどおり
await pg.locator("button", { hasText: "☰" }).first().click();
await pg.keyboard.press("Escape");
const dot = pg.locator(".note-enter").filter({ has: pg.locator("textarea", { hasText: "そら" }) }).locator('button[title="色を変える"]').first();
await dot.click();
await pg.locator('[data-colormenu] button[title="ふじ"]').click();
await pg.waitForTimeout(1500);
eq("1枚ずつの色選びもこれまでどおり", (await colors()).n3, 4);

await browser.close();
console.log(ng === 0 ? "\nまとめて色を変える: すべて期待どおりです" : `\nまとめて色を変える: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
