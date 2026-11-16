// 範囲選択・領域作成のドラッグ中は文字を選ばない（6.26.0。ユーザー指定「文字が青く反転するのは見栄えが悪い」）
//   Safari（WebKit）はポインタを捕まえても文字選択が始まる。この環境には WebKit が無いので、仕組みを確かめる:
//   ドラッグの間は文字を選べない（user-select: none）・今ある文字選択を消す・selectstart を止める・離したら元どおり
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
pg.on("pageerror", (e) => { console.log("  pageerror:", e.message); ng++; });

// 試験データ: タグ付きの付箋2枚と直書きの文字
const note = (id, num, text, x, y, extra = {}) => ({ id, num, text, x, y, w: 260, h: 182, ew: 430, eh: 400, title: "", useTitle: false, tags: ["メイン"], refs: [], parentId: null, expanded: false, color: 0, z: num, ...extra });
const A = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 3,
  notes: [note("n1", 1, "主人公が村を出る", 80, 60), note("n2", 2, "師匠と出会う", 380, 60)],
  edges: [], texts: [{ id: "t1", text: "第一章", x: 80, y: 320, size: 2 }], zones: [], strokes: [], images: [] }] };
await pg.goto(BASE);
await pg.evaluate((A) => {
  localStorage.clear();
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA" }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
}, A);
await pg.reload(); await pg.waitForTimeout(1500);

const origin = () => pg.evaluate(() => { const r = document.querySelector("[data-origin]").getBoundingClientRect(); return { x: r.left, y: r.top }; });
// 見本の文字: ボードの上に置いた、ふつうに選べる span（Safari が範囲選択の途中で選んでしまう文字の代わり。
// 付箋の中の文字は React の userSelect: none で Chromium では選べないが、Safari は -webkit- の付かない user-select を見ない）
await pg.evaluate(() => {
  const s = document.createElement("span");
  s.id = "probe"; s.textContent = "見本の文字";
  Object.assign(s.style, { position: "absolute", left: "300px", top: "380px", fontSize: "20px" });
  document.querySelector("[data-origin]").appendChild(s);
});
const state = () => pg.evaluate(() => {
  const el = document.getElementById("probe");
  const ev = new Event("selectstart", { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  const cs = getComputedStyle(el);
  return { userSelect: cs.userSelect, webkit: cs.webkitUserSelect, selected: String(window.getSelection()), selectstartStopped: ev.defaultPrevented };
});
const selectChip = () => pg.evaluate(() => {
  const r = document.createRange(); r.selectNodeContents(document.getElementById("probe"));
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  return String(s);
});

const before = await state();
eq("前提: ふだんは文字を選べる（selectstart を止めない）", [before.userSelect !== "none", before.selectstartStopped], [true, false]);

// 1) 文字を選んだ状態から範囲選択を始める → ドラッグの間は選べない・選択は消える・selectstart は止まる
eq("前提: 見本の文字を選んだ", await selectChip(), "見本の文字");
const o = await origin();
await pg.mouse.move(o.x + 30, o.y + 20); await pg.mouse.down();
await pg.mouse.move(o.x + 400, o.y + 250, { steps: 6 });
const during = await state();
eq("ドラッグ中: 文字を選べない（user-select と -webkit-user-select が none）", [during.userSelect, during.webkit], ["none", "none"]);
eq("ドラッグ中: 前に選んでいた文字の選択は消える", during.selected, "");
eq("ドラッグ中: 文字選択の始まり（selectstart）を止める", during.selectstartStopped, true);
await pg.mouse.move(o.x + 700, o.y + 420, { steps: 6 });
await pg.mouse.up();
await pg.waitForTimeout(300);
eq("範囲選択はできている（付箋2枚と文字）", await pg.getByText(/個選択中$/).textContent(), "3個選択中");
const after = await state();
eq("離したら元どおり（選べる・止めない）", [after.userSelect !== "none", after.selectstartStopped], [true, false]);
eq("離したら html の印は外れる", await pg.evaluate(() => document.documentElement.classList.contains("ib-noselect")), false);

// 2) 動かさずに押して離しただけ（選択の解除）でも印は残らない
await pg.mouse.click(o.x + 900, o.y + 600);
eq("押して離しただけでも印は残らない", await pg.evaluate(() => document.documentElement.classList.contains("ib-noselect")), false);

// 3) 入力欄の文字選択は今までどおり使える
await pg.locator('[data-note="n2"] textarea').first().click();
await pg.keyboard.press("Control+a");
eq("本文の入力欄では Ctrl+A で全部選べる", await pg.evaluate(() => { const t = document.activeElement; return t.value.slice(t.selectionStart, t.selectionEnd); }), "師匠と出会う");

// 4) 領域作成のドラッグでも同じ
await pg.mouse.click(o.x + 900, o.y + 600);
await pg.locator("button", { hasText: "追加" }).first().click();
const zoneItem = pg.locator("button", { hasText: "領域" }).first();
if (await zoneItem.count()) {
  await zoneItem.click();
  await pg.mouse.move(o.x + 60, o.y + 40); await pg.mouse.down();
  await pg.mouse.move(o.x + 300, o.y + 300, { steps: 6 });
  eq("領域作成のドラッグ中も文字を選べない", (await state()).userSelect, "none");
  await pg.mouse.up();
  await pg.waitForTimeout(200);
  eq("離したら元どおり", (await state()).userSelect !== "none", true);
}

console.log(ng === 0 ? "\nmarquee-noselect: すべて期待どおりです" : `\nmarquee-noselect: ${ng} 件 期待と違います`);
await browser.close();
process.exit(ng ? 1 : 0);
