// 2つ以上を選んでいるとき、選んだ付箋はどこをつかんでも選択全体を動かせる（6.14.0）
//   本文・タイトル・開いた付箋の中の空き → 全体が同じだけ動く／動かさずに離せば今までどおり（本文にカーソルが入り書ける）／
//   ボタン・中の付箋・選んでいない付箋・1つだけ選んでいるときは今までどおり
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
pg.on("pageerror", (e) => console.log("  pageerror:", e.message));

// 試験データ: P（タイトル欄つき）・Q・開いた R（中に K）・選ばない U・文字 T
const note = (id, num, x, y, extra = {}) => ({ id, num, text: id + "の本文", x, y, w: 260, h: 170, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 0, z: num, ...extra });
const DATA = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 6,
  notes: [note("P", 1, 101, 99, { useTitle: true, title: "見出しP" }), note("Q", 2, 400, 99), note("R", 3, 700, 99, { expanded: true }),
    note("K", 4, 10, 10, { parentId: "R", w: 160, h: 140 }), note("U", 5, 101, 560)],
  edges: [], texts: [{ id: "T", x: 400, y: 600, text: "文字T", size: 1, z: 9 }], zones: [], strokes: [], images: [] }] };
await pg.goto(BASE);
await pg.evaluate((d) => {
  localStorage.clear();
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA" }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(d));
}, DATA);
await pg.reload(); await pg.waitForTimeout(1500);

const saved = async () => { await pg.waitForTimeout(1200); return pg.evaluate(() => JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0]); };
const pos = async (...ids) => { const b = await saved(); return ids.map((id) => { const n = b.notes.find((m) => m.id === id) || b.texts.find((t) => t.id === id); return [n.x, n.y]; }); };
const picked = () => pg.evaluate(() => [...document.querySelectorAll("[data-note]")]
  .filter((el) => getComputedStyle(el).boxShadow.includes("61, 111, 180")).map((el) => el.dataset.note).sort());
const focusedIn = () => pg.evaluate(() => document.activeElement?.closest?.("[data-note]")?.dataset.note || null);
const center = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const drag = async (from, dx, dy) => {
  await pg.mouse.move(from.x, from.y); await pg.mouse.down();
  await pg.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 }); await pg.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await pg.mouse.up(); await pg.waitForTimeout(150);
};
const shiftClick = async (loc) => { const c = await center(loc); await pg.keyboard.down("Shift"); await pg.mouse.click(c.x, c.y); await pg.keyboard.up("Shift"); await pg.waitForTimeout(150); };
const N = (id) => pg.locator(`[data-note="${id}"]`);

// 前提: P・Q・R を選ぶ
for (const id of ["P", "Q", "R"]) await shiftClick(N(id).getByText(`#${{ P: 1, Q: 2, R: 3 }[id]}`, { exact: true }));
eq("前提: P・Q・R を選んだ", await picked(), ["P", "Q", "R"]);
const start = await pos("P", "Q", "R", "U", "T");

// 1) 本文をつかんで動かす → 全体が同じだけ動く
await drag(await center(N("P").locator("textarea")), 60, 40);
eq("1: P の本文をつかむ → P・Q・R が (+60,+40)、U・文字は動かない", await pos("P", "Q", "R", "U", "T"),
  [[161, 139], [460, 139], [760, 139], start[3], start[4]]);
eq("1: 動かしたあと入力欄にカーソルは無い", await focusedIn(), null);
eq("1: 選択はそのまま", await picked(), ["P", "Q", "R"]);

// 2) タイトル欄・開いた付箋の中の空き
await drag(await center(N("P").locator('input[placeholder="タイトル"]')), -30, 0);
eq("2: P のタイトル欄をつかむ → 全体が (-30,0)", await pos("P", "Q", "R"), [[131, 139], [430, 139], [730, 139]]);
{
  const inner = N("R").locator("[data-nodrag]").filter({ has: N("K") });
  const b = await inner.boundingBox();
  await drag({ x: b.x + b.width - 60, y: b.y + b.height - 80 }, 0, 26);
  eq("2: R の中の空きをつかむ → 全体が (0,+26)", await pos("P", "Q", "R"), [[131, 165], [430, 165], [730, 165]]);
}

// 3) 動かさずに離す → 本文にカーソルが入り、書ける（選択はそのまま）
await N("Q").locator("textarea").click();
await pg.keyboard.press("End");
await pg.keyboard.type("を書き足す");
{
  const b = await saved();
  eq("3: Q の本文を押しただけ → そこに書ける", b.notes.find((n) => n.id === "Q").text, "Qの本文を書き足す");
  eq("3: 位置は変わらない", await pos("P", "Q", "R"), [[131, 165], [430, 165], [730, 165]]);
}
eq("3: 選択はそのまま", await picked(), ["P", "Q", "R"]);

// 4) 今までどおりのもの
await drag(await center(N("P").locator('button[title="タイトル欄をやめる"]')), 50, 50);
eq("4: ボタンから引っぱっても動かない", await pos("P", "Q", "R"), [[131, 165], [430, 165], [730, 165]]);
await drag(await center(N("K").locator("textarea")), 40, 0);
eq("4: 中の付箋 K の本文を引っぱっても、K も R も動かない（今までどおり）", await pos("K", "R"), [[10, 10], [730, 165]]);
await drag(await center(N("K").getByText("#4", { exact: true })), 40, 0);
eq("4: K の番号（つかみ代）からは K だけが親の中で動く。R は動かない", await pos("K", "R"), [[50, 10], [730, 165]]);
await drag(await center(N("U").locator("textarea")), 80, 0);
eq("4: 選んでいない U の本文を引っぱっても動かない", (await pos("U"))[0], start[3]);

// 5) 1つだけ選んでいるときは今までどおり（本文からは動かない）
// K を番号からつかむと、今までどおり選択は解除される（選んでいない付箋をつかんだため）
eq("4: K をつかんだので選択は解除されている", await picked(), []);
await shiftClick(N("P").getByText("#1", { exact: true }));
eq("5: 前提: P だけを選んだ", await picked(), ["P"]);
await drag(await center(N("P").locator("textarea")), 70, 0);
eq("5: 1つだけのときは本文を引っぱっても動かない", (await pos("P"))[0], [131, 165]);

console.log(ng ? `multi-grab: ${ng} 件 期待と違います` : "multi-grab: すべて期待どおりです");
await browser.close();
process.exit(ng ? 1 : 0);
