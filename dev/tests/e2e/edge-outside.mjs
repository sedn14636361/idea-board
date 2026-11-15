// 線の端は付箋の枠の外に接する。重なっていて外に引く場所が無ければ描かない（6.22.0。src/edges.js）
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
pg.on("pageerror", (e) => { console.log("  pageerror:", e.message); ng++; });

// 試験データ（付箋は 260×182。描くと操作列のぶん高さ 198）:
//   e1: #1 と #2 が横に 40px（今までも外だった間）  e2: #1 と #3 が縦に 14px（6.21.0 では端が 3px 内側）
//   e3: #3 と #4 が斜め                              e4: #5 と #6 が重なる（描かない）
//   e5: 開いた #7 の中の付箋 #8 から #9               e6: #1 の「＋→」で作った付箋（間 24px。作った直後も外）
const note = (id, num, text, x, y, color, extra = {}) => ({ id, num, text, x, y, w: 260, h: 182, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color, z: num, ...extra });
const A = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 10,
  notes: [
    note("n1", 1, "一", 100, 100, 0), note("n2", 2, "横 40", 400, 100, 3), note("n3", 3, "縦 14", 100, 312, 2), note("n4", 4, "斜め", 520, 560, 4),
    note("n5", 5, "重なり", 1000, 100, 1), note("n6", 6, "重なり2", 1150, 180, 3),
    note("n7", 7, "開いた", 100, 800, 2, { expanded: true }), note("c8", 8, "中", 20, 20, 2, { parentId: "n7", w: 160, h: 140 }), note("n9", 9, "遠い", 900, 900, 1),
  ],
  edges: [{ id: "e1", from: "n1", to: "n2" }, { id: "e2", from: "n1", to: "n3" }, { id: "e3", from: "n3", to: "n4" },
    { id: "e4", from: "n5", to: "n6", memo: "重なりのメモ" }, { id: "e5", from: "c8", to: "n9" }],
  texts: [], zones: [], strokes: [], images: [] }] };
await pg.goto(BASE);
await pg.evaluate((A) => {
  localStorage.clear();
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA" }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
}, A);
await pg.reload(); await pg.waitForTimeout(1500);

// 描かれた線ごとに、端の点（circle）とつないだ付箋の枠（ボードの座標）を測る
const measure = () => pg.evaluate(() => {
  const o = document.querySelector("[data-origin]").getBoundingClientRect();
  const scale = (() => { const r = document.querySelector('[data-note="n1"]'); return r.getBoundingClientRect().width / r.offsetWidth; })();
  const rects = {};
  // 中に付箋を持つ（開いた）付箋は外す: 中の付箋から出る線の端は、親の枠の中にあってよい
  for (const el of document.querySelectorAll("[data-note]")) {
    if (el.querySelector("[data-note]")) continue;
    const r = el.getBoundingClientRect();
    rects[el.dataset.note] = { x: (r.left - o.left) / scale, y: (r.top - o.top) / scale, w: el.offsetWidth, h: el.offsetHeight };
  }
  const edgeSvg = [...document.querySelectorAll("svg")].find((g) => g.querySelector('path[stroke-width="2.2"]'));
  const dots = [...(edgeSvg ? edgeSvg.querySelectorAll("circle") : [])].map((c) => ({ x: +c.getAttribute("cx"), y: +c.getAttribute("cy"), r: +c.getAttribute("r") }));
  const lines = [...document.querySelectorAll('svg path[stroke-width="2.2"]')].length;
  const labels = [...document.querySelectorAll("svg text")].map((t) => t.textContent);
  return { rects, dots, lines, labels, scale };
});
// 点から四角までの距離（中なら負）
const dist = (p, b) => {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w)), dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h));
  if (dx === 0 && dy === 0) return -Math.min(p.x - b.x, b.x + b.w - p.x, p.y - b.y, b.y + b.h - p.y);
  return Math.hypot(dx, dy);
};
// 端の点ごとに、一番近い付箋の枠までの距離（点の半径 r に対して: r 以上なら食い込まない、r+0.6 以下なら接している）
const nearest = (m, d) => Math.min(...Object.values(m.rects).map((b) => dist(d, b)));
const report = (label, m, { touch = true } = {}) => {
  const ds = m.dots.map((d) => nearest(m, d));
  eq(`${label}: どの端の点も付箋に食い込まない（枠から半径以上）`, ds.every((v, i) => v >= m.dots[i].r - 0.6), true);
  if (touch) eq(`${label}: どの端の点も枠に接する（半径+0.6px 以内）`, ds.every((v, i) => v <= m.dots[i].r + 0.6), true);
  if (ds.some((v, i) => v < m.dots[i].r - 0.6)) console.log("   食い込み:", ds.map((v) => v.toFixed(1)).join(" "));
};

let m = await measure();
eq("線は4本（重なっている #5–#6 は描かない）", m.lines, 4);
eq("重なっている線のメモも出さない", m.labels.includes("重なりのメモ"), false);
report("100%", m, { touch: false });
// 辺に当たる線（横・縦・中の付箋）はちょうど接する。斜めの線は角の近くを通るので離れることがある
{
  const d = m.dots.map((p) => Math.round(nearest(m, p) * 10) / 10);
  eq("横 40・縦 14・中の付箋の線: 端は枠からちょうど半径（4px）", d.filter((v) => v === 4).length >= 6, true);
}

// 「＋→」で作った直後（出てくる動きの途中で測っても）端は外
await pg.locator('[data-note="n1"] [data-sidenote]').first().click();
await pg.waitForTimeout(80);
m = await measure();
report("「＋→」の直後", m, { touch: false });
await pg.waitForTimeout(1000);
m = await measure();
report("「＋→」から1秒後", m, { touch: false });
await pg.keyboard.press("Escape");
await pg.mouse.click(1300, 860);
await pg.keyboard.press("Control+z");
await pg.waitForTimeout(500);

// 重なっている #6 を離すと線が出る（データの線は残っている）
{
  const g = await pg.evaluate(() => {
    const row = document.querySelector('[data-note="n6"]').firstElementChild;
    const sp = [...row.children].find((c) => c.style.flex.startsWith("1"));
    const r = sp.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await pg.mouse.move(g.x, g.y); await pg.mouse.down();
  await pg.mouse.move(g.x + 0, g.y + 260, { steps: 6 }); await pg.mouse.up();
  await pg.waitForTimeout(400);
  m = await measure();
  eq("離すと #5–#6 の線が出る（メモも）", [m.lines, m.labels.includes("重なりのメモ")], [5, true]);
  report("離したあと", m, { touch: false });
}

// 縮小（40%）・見出しの表示でも外
for (let i = 0; i < 6; i++) await pg.locator("button", { hasText: "−" }).first().click();
await pg.waitForTimeout(500);
m = await measure();
eq("前提: 縮小した", Math.round(m.scale * 100) <= 40, true);
report("40%", m, { touch: false });

console.log(ng === 0 ? "\nedge-outside: すべて期待どおりです" : `\nedge-outside: ${ng} 件 期待と違います`);
await browser.close();
process.exit(ng ? 1 : 0);
