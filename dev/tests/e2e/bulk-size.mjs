// 選んだ付箋の大きさ（6.23.0。src/arrange.js の matchSize / scaleSize / followSize）
//   そろえる: 最初に選んだ付箋（範囲選択では左上、Shift+クリックでは押した順）に幅・高さ・両方を合わせる
//   縮める 80%・広げる 125%／選んだ付箋の角を引っぱると、ほかの選んだ付箋も同じ割合で変わる（ユーザー指定）
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
pg.on("pageerror", (e) => { console.log("  pageerror:", e.message); ng++; });

// 試験データ: a 260×182・b 190×170・c 開いた付箋 430×400（中に k）・選ばない d 260×182
const note = (id, num, text, x, y, extra = {}) => ({ id, num, text, x, y, w: 260, h: 182, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 5, z: num, ...extra });
const A = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 6,
  notes: [note("a", 1, "a", 100, 100), note("b", 2, "b", 450, 100, { w: 190, h: 170 }), note("c", 3, "c", 760, 100, { expanded: true }),
    note("k", 4, "中", 10, 10, { parentId: "c", w: 160, h: 140 }), note("d", 5, "選ばない", 100, 400)],
  edges: [], texts: [], zones: [], strokes: [], images: [] }] };
await pg.goto(BASE);
await pg.evaluate((A) => {
  localStorage.clear();
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA" }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
}, A);
await pg.reload(); await pg.waitForTimeout(1500);

const saved = async () => { await pg.waitForTimeout(1300); return pg.evaluate(() => JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0]); };
const sizes = async () => Object.fromEntries((await saved()).notes.map((n) => [n.id, n.expanded ? [n.ew, n.eh] : [n.w, n.h]]));
const s0 = await sizes();
const origin = () => pg.evaluate(() => { const r = document.querySelector("[data-origin]").getBoundingClientRect(); return { x: r.left, y: r.top }; });
const clickEmpty = async () => { const o = await origin(); await pg.mouse.click(o.x + 1300, o.y + 40); await pg.waitForTimeout(150); };
const shiftClick = async (id) => {
  const b = await pg.locator(`[data-note="${id}"]`).first().boundingBox();
  await pg.keyboard.down("Shift"); await pg.mouse.click(b.x + b.width / 2, b.y + 60); await pg.keyboard.up("Shift");
  await pg.waitForTimeout(150);
};
const dragSelect = async (x1, y1, x2, y2) => {
  const o = await origin();
  await pg.mouse.move(o.x + x1, o.y + y1); await pg.mouse.down();
  await pg.mouse.move(o.x + x2, o.y + y2, { steps: 8 }); await pg.mouse.up();
  await pg.waitForTimeout(300);
};
const size = async (k) => { await pg.locator(`[data-selsize] [data-size="${k}"]`).click(); };
const openSize = async () => { if (!(await pg.locator("[data-selsize]").count())) await pg.locator("[data-selsizebtn]").click(); };

// 1) Shift+クリックで b → a → c の順に選ぶ → 基準は b（#2）
await shiftClick("b"); await shiftClick("a"); await shiftClick("c");
eq("前提: 3枚を選んだ", await pg.getByText(/個選択中$/).textContent(), "3個選択中");
await openSize();
eq("基準は最初に選んだ #2", await pg.locator("[data-selsize]").textContent().then((t) => t.includes("#2 にそろえる")), true);
await size("both");
let s = await sizes();
eq("両方: b の 190×170 に（開いた c は最小 240×200 まで）", [s.a, s.b, s.c], [[190, 170], [190, 170], [240, 200]]);
eq("選ばない付箋・中の付箋は変わらない", [s.d, s.k], [s0.d, s0.k]);
await clickEmpty();
await pg.keyboard.press("Control+z");
eq("Ctrl+Z 1回で全部戻る", await sizes(), s0);

// 2) 幅だけ・高さだけ（選択は残っている）
await shiftClick("b"); await shiftClick("a"); await shiftClick("c");
await openSize(); await size("w");
s = await sizes();
eq("幅だけ b に", [s.a, s.c], [[190, 182], [240, 400]]);
await pg.keyboard.press("Control+z"); await clickEmpty();
await pg.keyboard.press("Control+z");
await shiftClick("c"); await shiftClick("a");
await openSize();
eq("基準は c（#3）", await pg.locator("[data-selsize]").textContent().then((t) => t.includes("#3 にそろえる")), true);
await size("h");
s = await sizes();
eq("高さだけ c（400）に", [s.a, s.c], [[260, 400], [430, 400]]);
await clickEmpty(); await pg.keyboard.press("Control+z");
eq("戻す", await sizes(), s0);

// 3) 範囲選択では左上が基準。縮める・広げる
await dragSelect(60, 60, 700, 320);
await openSize();
eq("範囲選択の基準は左上の #1", await pg.locator("[data-selsize]").textContent().then((t) => t.includes("#1 にそろえる")), true);
await size("shrink");
s = await sizes();
eq("縮める: それぞれ 80%", [s.a, s.b], [[208, 146], [152, 136]]);
await size("grow");
s = await sizes();
eq("広げる: それぞれ 125%", [s.a, s.b], [[260, 183], [190, 170]]);
await clickEmpty(); await pg.keyboard.press("Control+z"); await pg.keyboard.press("Control+z");
eq("2回で戻る", await sizes(), s0);

// 4) 選んだ付箋の角を引っぱると、ほかの選んだ付箋も同じ割合で変わる（1回のドラッグは Ctrl+Z 1回）
const corner = async (id) => { const b = await pg.locator(`[data-note="${id}"] > [data-resize]`).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
await shiftClick("a"); await shiftClick("b");
{
  const p = await corner("a");
  await pg.mouse.move(p.x, p.y); await pg.mouse.down();
  await pg.mouse.move(p.x + 130, p.y + 91, { steps: 8 }); await pg.mouse.up();
}
s = await sizes();
eq("a を 1.5 倍 → b も 1.5 倍（285×255）", [s.a, s.b], [[390, 273], [285, 255]]);
eq("選んでいない c・d は変わらない", [s.c, s.d], [s0.c, s0.d]);
await clickEmpty(); await pg.keyboard.press("Control+z");
eq("Ctrl+Z 1回で両方戻る", await sizes(), s0);

// Shift+角（幅だけ）でも追従する
await shiftClick("a"); await shiftClick("b");
{
  const p = await corner("a");
  await pg.mouse.move(p.x, p.y); await pg.keyboard.down("Shift"); await pg.mouse.down();
  await pg.mouse.move(p.x + 130, p.y + 10, { steps: 8 }); await pg.mouse.up(); await pg.keyboard.up("Shift");
}
s = await sizes();
eq("Shift で幅だけ 1.5 倍 → b も幅だけ", [s.a, s.b], [[390, 182], [285, 170]]);
await clickEmpty(); await pg.keyboard.press("Control+z");

// 選んでいない付箋の角は今までどおり（ほかは変わらない）
await shiftClick("a"); await shiftClick("b");
{
  const p = await corner("d");
  await pg.mouse.move(p.x, p.y); await pg.mouse.down();
  await pg.mouse.move(p.x + 52, p.y + 26, { steps: 6 }); await pg.mouse.up();
}
s = await sizes();
eq("d だけ変わる", [s.a, s.b, s.d], [s0.a, s0.b, [312, 208]]);

console.log(ng === 0 ? "\nbulk-size: すべて期待どおりです" : `\nbulk-size: ${ng} 件 期待と違います`);
await browser.close();
process.exit(ng ? 1 : 0);
