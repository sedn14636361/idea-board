// 入力欄の中の Ctrl+Z は文章だけ、外の Ctrl+Z は移動など（文章は戻さない）（6.22.0。ユーザー指定）
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
pg.on("pageerror", (e) => { console.log("  pageerror:", e.message); ng++; });

// 試験データ: 付箋3枚（#3 の本文が #2 を指す。#1 はタイトル欄あり）、直書きの文字1つ、領域1つ
const note = (id, num, text, x, y, color, extra = {}) => ({ id, num, text, x, y, w: 260, h: 182, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color, z: num, ...extra });
const A = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 4,
  notes: [
    note("n1", 1, "りんご", 100, 100, 0, { title: "果物", useTitle: true }),
    note("n2", 2, "みかん", 420, 100, 3),
    note("n3", 3, "#2 を見る", 740, 100, 2),
  ],
  edges: [], texts: [{ id: "t1", text: "見出し", x: 100, y: 420, size: 1 }], zones: [], strokes: [], images: [] }] };
await pg.goto(BASE);
await pg.evaluate((A) => {
  localStorage.clear();
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA" }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
}, A);
await pg.reload(); await pg.waitForTimeout(1500);

const saved = async () => { await pg.waitForTimeout(1300); return pg.evaluate(() => JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0]); };
const N = (b, id) => b.notes.find((n) => n.id === id);
const pos = (b, id) => [N(b, id).x, N(b, id).y];
const origin = () => pg.evaluate(() => { const r = document.querySelector("[data-origin]").getBoundingClientRect(); return { x: r.left, y: r.top }; });
const clickEmpty = async () => { const o = await origin(); await pg.mouse.click(o.x + 1250, o.y + 700); await pg.waitForTimeout(100); };
const drag = async (id, dx, dy) => {
  const g = await pg.evaluate((id) => {
    const row = document.querySelector(`[data-note="${id}"]`).firstElementChild;
    const sp = [...row.children].find((c) => c.style.flex.startsWith("1"));
    const r = sp.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);
  await pg.mouse.move(g.x, g.y); await pg.mouse.down();
  await pg.mouse.move(g.x + dx, g.y + dy, { steps: 6 }); await pg.mouse.up();
};
const body = (id) => pg.locator(`[data-note="${id}"] textarea`).first();
const focusedNote = () => pg.evaluate(() => document.activeElement?.closest?.("[data-note]")?.dataset.note || document.activeElement?.tagName);

// 1) 付箋 #2 を動かす → 本文に「abc」と書く → 入力欄の中で Ctrl+Z: 文章だけが戻り、位置はそのまま
await drag("n2", 80, 40);
eq("前提: #2 が動いた", pos(await saved(), "n2"), [500, 140]);
await body("n2").click();
await pg.keyboard.type("abc", { delay: 60 });
eq("前提: 書いた", N(await saved(), "n2").text, "みかんabc");
await pg.keyboard.press("Control+z");
let b = await saved();
eq("1: 入力欄の中の Ctrl+Z で文章が戻り始める", N(b, "n2").text.startsWith("みかん") && N(b, "n2").text.length < 6, true);
eq("1: 位置はそのまま", pos(b, "n2"), [500, 140]);
for (let i = 0; i < 4; i++) await pg.keyboard.press("Control+z");
b = await saved();
eq("1: 何度押しても文章だけ（位置は戻らない）", [N(b, "n2").text, pos(b, "n2")], ["みかん", [500, 140]]);
eq("1: カーソルは本文に残っている", await focusedNote(), "n2");

// 2) もう一度「abc」と書いて、入力欄の外で Ctrl+Z: 位置が戻り、文章は書いたまま
await pg.keyboard.type("xyz", { delay: 60 });
await clickEmpty();
await pg.keyboard.press("Control+z");
b = await saved();
eq("2: 入力欄の外の Ctrl+Z で位置が戻る", pos(b, "n2"), [420, 100]);
eq("2: 文章は書いたまま", N(b, "n2").text, "みかんxyz");
await pg.keyboard.press("Control+Shift+z");
b = await saved();
eq("2: やり直すと位置が進み、文章は書いたまま", [pos(b, "n2"), N(b, "n2").text], [[500, 140], "みかんxyz"]);

// 3) 文章しか変えていなければ、入力欄の外の Ctrl+Z では何も変わらない（タイトル・直書きの文字も文章）
await pg.keyboard.press("Control+z");   // 位置を戻しておく（やり直しは残る）
await pg.locator('[data-note="n1"] input').first().click();
await pg.keyboard.type("A", { delay: 60 });
await pg.locator('[data-text="t1"] textarea').first().click();
await pg.keyboard.press("End");
await pg.keyboard.type("！", { delay: 60 });
await clickEmpty();
const before3 = await saved();
eq("前提: タイトルと文字を書いた", [N(before3, "n1").title, before3.texts[0].text], ["果物A", "見出し！"]);
eq("3: 文章を書いても、やり直しは残る", await pg.locator("[data-redo]").isDisabled(), false);
await pg.keyboard.press("Control+Shift+z");
b = await saved();
eq("3: やり直すと位置が進み、タイトル・文字は書いたまま", [pos(b, "n2"), N(b, "n2").text, N(b, "n1").title, b.texts[0].text], [[500, 140], "みかんxyz", "果物A", "見出し！"]);
await pg.keyboard.press("Control+z");
await pg.keyboard.press("Control+z");
b = await saved();
eq("3: 入力欄の外の Ctrl+Z を重ねても、文章は1文字も戻らない", [N(b, "n2").text, N(b, "n1").title, b.texts[0].text], ["みかんxyz", "果物A", "見出し！"]);
eq("3: 位置は一番初めまで戻る", pos(b, "n2"), [420, 100]);
eq("3: 文章しか違わないので、もう戻すものは無い（↶ は押せない）", await pg.locator("[data-undo]").isDisabled(), true);

// 4) タイトル欄の中の Ctrl+Z はタイトルだけ戻す（打ってから欄を離れずに）
await drag("n1", 0, 60);
await pg.locator('[data-note="n1"] input').first().click();
await pg.keyboard.press("End");
await pg.keyboard.type("B", { delay: 60 });
eq("前提: タイトルに打った", N(await saved(), "n1").title, "果物AB");
await pg.keyboard.press("Control+z");
b = await saved();
eq("4: タイトル欄の中の Ctrl+Z でタイトルが戻る", N(b, "n1").title, "果物A");
eq("4: 動かした位置はそのまま", pos(b, "n1"), [100, 160]);
eq("4: ほかの文章は変わらない", [N(b, "n2").text, b.texts[0].text], ["みかんxyz", "見出し！"]);
await clickEmpty();

// 5) #2 を剥がす（番号が詰まり #3 の本文の「#2」は消えた付箋を指さなくなる）→ #3 に書き足す → 外の Ctrl+Z
await pg.locator('[data-note="n2"] button[title="剥がす（中身も一緒）"]').first().click();
const conf = pg.getByRole("button", { name: "剥がす", exact: true });
if (await conf.count()) await conf.click();
b = await saved();
eq("前提: #2 を剥がし、#3 は #2 になる", b.notes.map((n) => `${n.id}#${n.num}`), ["n1#1", "n3#2"]);
await body("n3").click();
await pg.keyboard.press("End");
await pg.keyboard.type("！", { delay: 60 });
await clickEmpty();
await pg.keyboard.press("Control+z");
b = await saved();
eq("5: 剥がした付箋が番号ごと戻る", b.notes.map((n) => `${n.id}#${n.num}:${n.text}`).sort(), ["n1#1:りんご", "n2#2:みかんxyz", "n3#3:#2 を見る！"]);

console.log(ng === 0 ? "\nundo-field: すべて期待どおりです" : `\nundo-field: ${ng} 件 期待と違います`);
await browser.close();
process.exit(ng ? 1 : 0);
