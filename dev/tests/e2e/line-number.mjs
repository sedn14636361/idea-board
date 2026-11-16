// 「＋→」で線でつなぐ付箋を作ると、通し番号が振られる（6.27.0。ユーザー指定）
//   元の付箋に番号があればその組に入る。無ければ元の付箋と新しい付箋で新しい組（分母あり）。タイトルは元の付箋のもの（無ければ番号だけ）。
//   順番は読む順。作ったら本文にカーソル
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
pg.on("pageerror", (e) => { console.log("  pageerror:", e.message); ng++; });

// 試験データ: A（タイトル「序」・番号なし）、B（タイトルなし・タイトル欄なし）、C（「破」の組・分母なし・1枚）
const note = (id, num, text, x, y, extra = {}) => ({ id, num, text, x, y, w: 260, h: 182, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 5, z: num, ...extra });
const A = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 4,
  notes: [note("A", 1, "あ", 60, 60, { title: "序", useTitle: true }), note("B", 2, "い", 60, 340), note("C", 3, "う", 60, 620, { title: "破", useTitle: true, seq: { id: "g", den: false } })],
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
const clickEmpty = async () => { const o = await origin(); await pg.mouse.click(o.x + 1300, o.y + 40); await pg.waitForTimeout(150); };
const chips = () => pg.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-note]")].map((el) => {
  const c = el.querySelector(":scope > div > [data-seqchip]");
  return [el.dataset.note, c ? c.textContent : ""];
})));
const side = async (id) => { await pg.locator(`[data-note="${id}"] [data-sidenote]`).first().click(); await pg.waitForTimeout(250); };
const newest = async (known) => (await saved()).notes.map((n) => n.id).find((id) => !known.includes(id));

// 1) タイトル「序」・番号なしの A から「＋→」→ A と新しい付箋で新しい組（序 1/2・序 2/2）。そのまま本文に書ける
await side("A");
await pg.keyboard.type("続き");
let b = await saved();
const N1 = await newest(["A", "B", "C"]);
let c = await chips();
eq("A は 1/2、新しい付箋は 2/2", [c.A, c[N1]], ["1/2", "2/2"]);
const n1 = b.notes.find((n) => n.id === N1);
eq("新しい付箋のタイトルは「序」・タイトル欄あり・打った文字は本文に", [n1.title, n1.useTitle, n1.text], ["序", true, "続き"]);
eq("線は A → 新しい付箋", b.edges.map((e) => `${e.from}→${e.to}`), [`A→${N1}`]);
eq("ほかの付箋は変わらない", [c.B, c.C], ["", "1"]);

// 2) Ctrl+Z で作る前に戻る（A の番号も外れる）
await clickEmpty();
await pg.keyboard.press("Control+z");
await pg.keyboard.press("Control+z");
b = await saved();
c = await chips();
eq("Ctrl+Z で新しい付箋も線も A の番号も無くなる", [b.notes.length, b.edges.length, c.A, !!b.notes.find((n) => n.id === "A").seq], [3, 0, "", false]);

// 3) タイトルの無い B から「＋→」→ 番号だけ（1/2・2/2）。B にもタイトル欄が出る。続けて新しい付箋から「＋→」で 3 枚目
await side("B");
const N2 = await newest(["A", "B", "C"]);
c = await chips();
b = await saved();
eq("タイトルの無い B は番号だけ（1/2・2/2）", [c.B, c[N2]], ["1/2", "2/2"]);
eq("B もタイトル欄を出す（タイトルは空のまま）", [b.notes.find((n) => n.id === "B").useTitle, b.notes.find((n) => n.id === "B").title, b.notes.find((n) => n.id === N2).title], [true, "", ""]);
await clickEmpty();
await side(N2);
const N3 = await newest(["A", "B", "C", N2]);
c = await chips();
eq("続けて「＋→」→ 同じ組の 3 枚目（1/3・2/3・3/3）", [c.B, c[N2], c[N3]], ["1/3", "2/3", "3/3"]);

// 4) 番号のある C（「破」・分母なし）から「＋→」→ その組に入る（1・2）
await clickEmpty();
await side("C");
const N4 = await newest(["A", "B", "C", N2, N3]);
c = await chips();
eq("C の組に入る（分母なしのまま 1・2）", [c.C, c[N4]], ["1", "2"]);
eq("タイトルは「破」", (await saved()).notes.find((n) => n.id === N4).title, "破");

// 5) 開き直しても同じ
await pg.reload(); await pg.waitForTimeout(1500);
c = await chips();
eq("開き直しても番号は同じ", [c.B, c[N2], c[N3], c.C, c[N4], c.A], ["1/3", "2/3", "3/3", "1", "2", ""]);

console.log(ng === 0 ? "\nline-number: すべて期待どおりです" : `\nline-number: ${ng} 件 期待と違います`);
await browser.close();
process.exit(ng ? 1 : 0);
