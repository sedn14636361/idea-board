// 付箋・文字を作ったら、そのまま書ける（入力欄にカーソルがある）（6.9.0）
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
pg.on("pageerror", (e) => { console.log("  pageerror:", e.message); ng++; });

// 試験データ: 付箋1枚（#1）と、中のボードを開いた付箋1枚（#2）
const note = (id, num, text, x, y, extra = {}) => ({ id, num, text, x, y, w: 190, h: 170, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 5, z: num, ...extra });
const A = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 3,
  notes: [note("n1", 1, "いまある付箋", 100, 100), note("n2", 2, "入れ物", 400, 100, { expanded: true })],
  edges: [], texts: [], zones: [], strokes: [], images: [] }] };
const open = async (common = {}) => {
  await pg.goto(BASE);
  await pg.evaluate(({ A, common }) => {
    localStorage.clear();
    localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA", ...common }));
    localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
  }, { A, common });
  await pg.reload(); await pg.waitForTimeout(1500);
};
const saved = async () => {
  await pg.waitForTimeout(1300);
  return pg.evaluate(() => JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0]);
};
// いちばん新しい付箋（番号が最大）
const newest = (b) => b.notes.reduce((a, n) => (n.num > a.num ? n : a));
const origin = () => pg.evaluate(() => { const r = document.querySelector("[data-origin]").getBoundingClientRect(); return { x: r.left, y: r.top }; });
const addMenu = async (label) => {
  await pg.locator("button", { hasText: "追加" }).first().click();
  await pg.locator("button", { hasText: label }).filter({ hasText: label === "付箋" ? "アイデアを書く" : "ボードに見出しを書く" }).click();
};

// 1) 貼る前に決める（既定 ON）: ダブルクリック → 画面で「貼る」→ そのまま書ける
await open();
{
  const o = await origin();
  await pg.mouse.dblclick(o.x + 300, o.y + 500);
  await pg.getByRole("button", { name: "貼る", exact: true }).click();
  await pg.keyboard.type("テスト1");
  const m = newest(await saved());
  eq("ダブルクリック→貼る: 作った付箋の本文に入る", [m.num, m.text], [3, "テスト1"]);
}
// 2) 貼る前の画面でタイトルを付けた → タイトルは書いてあるので本文に
{
  const o = await origin();
  await pg.mouse.dblclick(o.x + 700, o.y + 600);
  await pg.getByText("タイトルを付ける").click();
  await pg.keyboard.type("見出し");          // 画面のタイトル欄（もとから自動でカーソルがある）
  await pg.keyboard.press("Enter");         // Enter で貼る
  await pg.keyboard.type("テスト2");
  const m = newest(await saved());
  eq("タイトルを付けて貼る: タイトルはそのまま、本文に入る", [m.title, m.text], ["見出し", "テスト2"]);
}

// 3) 貼る前に決めない: 「＋ 追加」→「付箋」/ 中の「＋」/ 中のボードをダブルクリック
await open({ propMode: false });
await addMenu("付箋");
await pg.keyboard.type("テスト3");
eq("＋追加→付箋: 作った付箋に入る", newest(await saved()).text, "テスト3");

await pg.locator('[data-note="n2"] button[title="中に付箋を貼る"]').click();
await pg.keyboard.type("テスト4");
{ const m = newest(await saved()); eq("中の＋: 中に作った付箋に入る", [m.parentId, m.text], ["n2", "テスト4"]); }

{
  const r = await pg.locator('[data-note="n2"] button[title="中に付箋を貼る"]').locator("..").boundingBox();
  await pg.mouse.dblclick(r.x + r.width - 60, r.y + r.height - 60);
  await pg.keyboard.type("テスト5");
  const m = newest(await saved()); eq("中のボードをダブルクリック: 中に作った付箋に入る", [m.parentId, m.text], ["n2", "テスト5"]);
}

// 4) 付箋の「＋→」（6.8.0 から）も同じ
await pg.mouse.click(10, 880);
await pg.locator('[data-note="n1"] [data-sidenote]').click();
await pg.keyboard.type("テスト6");
eq("＋→: 作った付箋に入る", newest(await saved()).text, "テスト6");

// 5) 直書きの文字
await pg.mouse.click(10, 880);
await addMenu("文字");
await pg.keyboard.type("テスト7");
{ const b = await saved(); eq("＋追加→文字: 作った文字に入る", b.texts.map((t) => t.text), ["テスト7"]); }

// 6) 前からある付箋の中身は変わっていない
{ const b = await saved(); eq("前からある付箋は変わらない", b.notes.filter((n) => ["n1", "n2"].includes(n.id)).map((n) => n.text), ["いまある付箋", "入れ物"]); }

// 7) 縮小して見出しだけの表示でも、作れる（入力欄が無いので何もしない・エラーにならない）
await open({ propMode: false, zoom: 0.5 });
await addMenu("付箋");
await pg.waitForTimeout(300);
eq("縮小表示: 付箋は作られる", (await saved()).notes.length, 3);
eq("縮小表示: どの入力欄にもカーソルは無い", await pg.evaluate(() => ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)), false);

console.log(ng === 0 ? "\n作ったらそのまま書ける: すべて期待どおりです" : `\n作ったらそのまま書ける: ${ng} 件 期待と違います`);
await browser.close();
process.exit(ng ? 1 : 0);
