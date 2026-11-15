// 付箋を貼る前の画面で通し番号を選ぶ（6.25.0）
//   「タイトルを付ける」の下に「通し番号: なし／1/4／1」と見本。はじめは、同じボードに同じタイトルの組があればその形、無ければ「なし」（ユーザーが選択）
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
pg.on("pageerror", (e) => { console.log("  pageerror:", e.message); ng++; });

// 試験データ: 「序」の組（分母あり）が2枚 S1(100,60)・S2(400,60)。ほかに番号の無い付箋 P(100,400)
const note = (id, num, text, x, y, extra = {}) => ({ id, num, text, x, y, w: 260, h: 182, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 5, z: num, ...extra });
const A = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 4,
  notes: [note("S1", 1, "一", 100, 60, { title: "序", useTitle: true, seq: { id: "g1", den: true } }), note("S2", 2, "二", 400, 60, { title: "序", useTitle: true, seq: { id: "g1", den: true } }),
    note("P", 3, "番号なし", 100, 400)],
  edges: [], texts: [], zones: [], strokes: [], images: [] }] };
await pg.goto(BASE);
await pg.evaluate((A) => {
  localStorage.clear();
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA" }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
}, A);
await pg.reload(); await pg.waitForTimeout(1500);

const saved = async () => { await pg.waitForTimeout(1300); return pg.evaluate(() => JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0]); };
const origin = () => pg.evaluate(() => { const r = document.querySelector("[data-origin]").getBoundingClientRect(); return { x: r.left, y: r.top }; });
const clickEmpty = async () => { const o = await origin(); await pg.mouse.click(o.x + 1300, o.y + 700); await pg.waitForTimeout(150); };
const chips = () => pg.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-note]")].map((el) => {
  const c = el.querySelector(":scope > div > [data-seqchip]");
  return [el.dataset.note, c ? c.textContent : ""];
})));
const newId = async () => (await saved()).notes.map((n) => n.id).find((id) => !["S1", "S2", "P"].includes(id));
const pressed = () => pg.locator('[data-pendnum] [data-numstyle][aria-pressed="true"]').getAttribute("data-numstyle");
const sample = () => pg.locator("[data-pendsample]").textContent();
// 何も無い所をダブルクリック → 貼る前の画面 →「タイトルを付ける」→ タイトル
const openAt = async (x, y, title) => {
  const o = await origin();
  await pg.mouse.dblclick(o.x + x, o.y + y);
  await pg.waitForTimeout(200);
  eq(`前提: 貼る前の画面（${title}）`, await pg.getByText("タイトルを付ける").count(), 1);
  eq("タイトルを付けないときは通し番号を出さない", await pg.locator("[data-pendnum]").count(), 0);
  await pg.getByText("タイトルを付ける").click();
  await pg.locator('input[placeholder="タイトル"]').last().fill(title);
};
const paste = async () => { await pg.getByRole("button", { name: "貼る", exact: true }).click(); await pg.waitForTimeout(300); await clickEmpty(); };

// 1) 「序」と打つと、同じタイトルの組（分母あり）の形「1/4」がはじめから選ばれ、見本は「序 3/3」
await openAt(760, 80, "序");
eq("「序」の組があるので、はじめは「1/4」", await pressed(), "den");
eq("見本: 貼る位置で数えて 序 3/3", await sample(), "序 3/3");
await paste();
let id = await newId();
let c = await chips();
eq("貼った付箋は 3/3、組の全員が /3", [c.S1, c.S2, c[id]], ["1/3", "2/3", "3/3"]);
eq("番号の無い付箋は変わらない", c.P, "");
eq("タイトルの文章は「序」", (await saved()).notes.find((n) => n.id === id).title, "序");
await pg.keyboard.press("Control+z");
c = await chips();
eq("Ctrl+Z 1回で貼る前に戻る", [c.S1, c.S2, Object.keys(c).length], ["1/2", "2/2", 3]);

// 2) 「1」を選んで組に入る → 組の全員が分母なしになる
await openAt(760, 80, "序");
await pg.locator('[data-pendnum] [data-numstyle="plain"]').click();
eq("「1」を選ぶと見本は 序 3", [await pressed(), await sample()], ["plain", "序 3"]);
await paste();
id = await newId();
c = await chips();
eq("組の全員が分母なし（1・2・3）", [c.S1, c.S2, c[id]], ["1", "2", "3"]);
await pg.keyboard.press("Control+z");
c = await chips();
eq("Ctrl+Z で分母の出し方も戻る", [c.S1, c.S2], ["1/2", "2/2"]);

// 3) 組の無いタイトル「破」: はじめは「なし」。「1/4」を選ぶと新しい組（破 1/1）
await openAt(760, 400, "破");
eq("「破」の組は無いので、はじめは「なし」", [await pressed(), await sample()], ["none", "破"]);
await pg.locator('[data-pendnum] [data-numstyle="den"]').click();
eq("「1/4」を選ぶと 破 1/1", await sample(), "破 1/1");
await paste();
id = await newId();
c = await chips();
eq("新しい組 破 1/1（序の組は変わらない）", [c[id], c.S1, c.S2], ["1/1", "1/2", "2/2"]);
await pg.keyboard.press("Control+z");

// 4) 「序」でも「なし」を選べば組に入らない
await openAt(760, 80, "序");
await pg.locator('[data-pendnum] [data-numstyle="none"]').click();
eq("「なし」の見本は 序", await sample(), "序");
await paste();
id = await newId();
c = await chips();
eq("番号なしで貼る（序の組は 1/2・2/2 のまま）", [c[id], c.S1, c.S2], ["", "1/2", "2/2"]);
eq("タイトルは「序」・組の印なし", await saved().then((b) => { const n = b.notes.find((m) => m.id === id); return [n.title, !!n.seq]; }), ["序", false]);

console.log(ng === 0 ? "\npaste-number: すべて期待どおりです" : `\npaste-number: ${ng} 件 期待と違います`);
await browser.close();
process.exit(ng ? 1 : 0);
