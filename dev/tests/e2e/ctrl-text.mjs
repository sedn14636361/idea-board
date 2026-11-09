// Ctrl（Mac は ⌘）+ダブルクリックで、押した位置に直書きの文字を作り、そのまま書ける（6.11.0）
//   貼る前の画面（「付箋を貼る」）は出ない／付箋は増えない／普通のダブルクリックは今までどおり付箋（貼る前の画面）／
//   付箋の上・開いた付箋の中では文字を作らない／グリッド配置なら目盛りに合わせる
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
pg.on("pageerror", (e) => console.log("  pageerror:", e.message));

const note = (id, num, x, y, extra = {}) => ({ id, num, text: id, x, y, w: 190, h: 170, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 0, z: num, ...extra });
const A = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 3,
  notes: [note("N", 1, 100, 100), note("P", 2, 800, 100, { expanded: true })],
  edges: [], texts: [], zones: [], strokes: [], images: [] }] };
const open = async (extraIndex = {}) => {
  await pg.goto(BASE);
  await pg.evaluate(({ A, extraIndex }) => {
    localStorage.clear();
    // propMode は既定の ON（貼る前に色・タグを決める）のまま
    localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA", ...extraIndex }));
    localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
  }, { A, extraIndex });
  await pg.reload(); await pg.waitForTimeout(1500);
};
const saved = async () => { await pg.waitForTimeout(1200); return pg.evaluate(() => JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0]); };
const at = async (wx, wy) => { const r = await pg.locator("[data-origin]").boundingBox(); return { x: r.x + wx, y: r.y + wy }; };
const dbl = async ({ x, y }, key) => {
  if (key) await pg.keyboard.down(key);
  await pg.mouse.dblclick(x, y);
  if (key) await pg.keyboard.up(key);
  await pg.waitForTimeout(150);
};
const modal = () => pg.getByText("付箋を貼る", { exact: true }).count();

await open();
eq("前提: 貼る前に色・タグを決める が ON（普通のダブルクリックで「付箋を貼る」が出る）", await (async () => { await dbl(await at(600, 700)); const m = await modal(); await pg.keyboard.press("Escape"); await pg.mouse.click(5, 880); await pg.waitForTimeout(200); return m; })(), 1);
await open();

// 1) Ctrl+ダブルクリック → その位置に文字。すぐ打てる
await dbl(await at(600, 300), "Control");
eq("Ctrl+ダブルクリック: 「付箋を貼る」は出ない", await modal(), 0);
await pg.keyboard.type("メモ abc");
{
  const b = await saved();
  eq("押した位置を左上に文字ができ、打った文字が入る", b.texts.map((t) => [t.x, t.y, t.text]), [[600, 300, "メモ abc"]]);
  eq("付箋は増えない", b.notes.length, 2);
}

// 2) Mac の ⌘（Meta）でも同じ
await pg.mouse.click(5, 880);
await dbl(await at(600, 500), "Meta");
await pg.keyboard.type("2つめ");
{
  const b = await saved();
  eq("⌘+ダブルクリックでも文字ができる", b.texts.map((t) => [t.x, t.y, t.text]), [[600, 300, "メモ abc"], [600, 500, "2つめ"]]);
  eq("⌘でも「付箋を貼る」は出ない", await modal(), 0);
}

// 3) 付箋の上・開いた付箋の中では文字を作らない（今までどおり）
await pg.mouse.click(5, 880);
const nBox = await pg.locator('[data-note="N"]').getByText("#1", { exact: true }).boundingBox();
await dbl({ x: nBox.x + nBox.width / 2, y: nBox.y + nBox.height / 2 }, "Control");
eq("付箋の上を Ctrl+ダブルクリック: 文字は増えない", (await saved()).texts.length, 2);
await dbl(await at(800 + 300, 100 + 300), "Control");
eq("開いた付箋の中を Ctrl+ダブルクリック: 文字は増えず、今までどおり「付箋を貼る」", [(await saved()).texts.length, await modal()], [2, 1]);
await pg.keyboard.press("Escape");

// 4) グリッド配置なら目盛り（26）に合わせる
await open({ gridMode: true });
await dbl(await at(601, 303), "Control");
await pg.keyboard.type("g");
eq("グリッド配置: 目盛りに合わせる", (await saved()).texts.map((t) => [t.x, t.y, t.text]), [[Math.round(601 / 26) * 26, Math.round(303 / 26) * 26, "g"]]);

console.log(ng ? `ctrl-text: ${ng} 件 期待と違います` : "ctrl-text: すべて期待どおりです");
await browser.close();
process.exit(ng ? 1 : 0);
