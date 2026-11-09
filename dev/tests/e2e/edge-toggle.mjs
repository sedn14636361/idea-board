// つないである付箋どうしで、もう一度「🔗 線でつなぐ」→ 相手を押すと、その線を外す（6.15.0）
//   どちら向きに引いた線でも外れる／メモも一緒に外れ、Ctrl+Z で線とメモが戻る／もう一度でまたつながる／
//   「⋯」の「線でつなぐ」でも同じ／ほかの線は変わらない／親子はつながらない（今までどおり）
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
pg.on("pageerror", (e) => console.log("  pageerror:", e.message));

// 試験データ: A・B・C、幅の狭い N、開いた P（中に K）。線 A→B（メモ「理由」）・C→A
const note = (id, num, x, y, extra = {}) => ({ id, num, text: id, x, y, w: 190, h: 170, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 0, z: num, ...extra });
const DATA = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 7,
  notes: [note("A", 1, 100, 100), note("B", 2, 400, 100), note("C", 3, 100, 400), note("N", 4, 700, 100, { w: 120 }),
    note("P", 5, 900, 300, { expanded: true }), note("K", 6, 10, 10, { parentId: "P", w: 150, h: 120 })],
  edges: [{ id: "e1", from: "A", to: "B", memo: "理由" }, { id: "e2", from: "C", to: "A" }], texts: [], zones: [], strokes: [], images: [] }] };
await pg.goto(BASE);
await pg.evaluate((d) => {
  localStorage.clear();
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA" }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(d));
}, DATA);
await pg.reload(); await pg.waitForTimeout(1500);

const saved = async () => { await pg.waitForTimeout(1200); return pg.evaluate(() => JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0]); };
// 線を「つないだ2枚（並びは問わない）とメモ」で表す
const links = async () => (await saved()).edges.map((e) => [[e.from, e.to].sort().join("-"), e.memo || ""]).sort((a, b) => a[0].localeCompare(b[0]));
const N = (id) => pg.locator(`[data-note="${id}"]`);
const num = { A: 1, B: 2, C: 3, N: 4, P: 5, K: 6 };
const connect = async (from, to) => {
  await N(from).locator(':scope > div:first-child button[title="線でつなぐ"]').click();
  await N(to).getByText(`#${num[to]}`, { exact: true }).click();
};
const blank = async () => { await pg.mouse.click(5, 880); await pg.waitForTimeout(100); };

eq("前提: A-B（理由）と A-C", await links(), [["A-B", "理由"], ["A-C", ""]]);

// 1) A から B へ → A-B が外れる（メモも）。A-C はそのまま
await connect("A", "B");
eq("1: つないである B を押すと A-B が外れる（A-C はそのまま）", await links(), [["A-C", ""]]);
await blank(); await pg.keyboard.press("Control+z");
eq("1: Ctrl+Z で線もメモも戻る", await links(), [["A-B", "理由"], ["A-C", ""]]);
await pg.keyboard.press("Control+Shift+z");
eq("1: やり直すとまた外れる", await links(), [["A-C", ""]]);

// 2) 逆向き（C→A）に引いた線も、A から C を押して外れる
await connect("A", "C");
eq("2: C→A に引いた線も、A から C を押すと外れる", await links(), []);

// 3) もう一度でまたつながる
await connect("A", "B");
eq("3: つないでいなければ今までどおりつながる", await links(), [["A-B", ""]]);
await connect("B", "A");
eq("3: B の側から A を押しても外れる", await links(), []);

// 4) 「⋯」の「線でつなぐ」でも同じ
const viaMenu = async (from, to) => {
  await N(from).locator(':scope > div:first-child button[title="ほかの操作"]').click();
  await pg.locator('[data-toolitem="link"]').click();
  await N(to).getByText(`#${num[to]}`, { exact: true }).click();
};
await viaMenu("N", "A");
eq("4: 「⋯」からつなぐ", await links(), [["A-N", ""]]);
await viaMenu("N", "A");
eq("4: 「⋯」からもう一度で外れる", await links(), []);

// 5) 親子はつながらない（今までどおり）
await connect("P", "K");
eq("5: 開いた付箋と中の付箋はつながらない", await links(), []);

console.log(ng ? `edge-toggle: ${ng} 件 期待と違います` : "edge-toggle: すべて期待どおりです");
await browser.close();
process.exit(ng ? 1 : 0);
