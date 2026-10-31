// 選んだ付箋のタグを一括で変える・格子に整列・領域で囲む（6.10.0）
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
pg.on("pageerror", (e) => { console.log("  pageerror:", e.message); ng++; });

// 試験データ: 大きさの違う付箋5枚（1枚は開いていて 430×400）、色はまちまち、一部にタグ。
// 選ばない付箋1枚と、選ぶ文字1つ。拡大率 70%（全体が画面に入る。見出しだけの表示にはならない）
// 色の番号: 0 レモン / 1 さくら / 2 そら / 3 わかば / 4 ふじ / 5 グレー
const note = (id, num, x, y, color, extra = {}) => ({ id, num, text: id, x, y, w: 190, h: 170, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color, z: num, ...extra });
const A = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 7,
  notes: [
    note("s1", 1, 300, 200, 0, { tags: ["メイン"] }),
    note("big", 2, 800, 180, 3, { expanded: true, tags: ["メイン", "重要度高"] }),
    note("s2", 3, 1500, 250, 2, { w: 160, h: 140 }),
    note("s3", 4, 260, 900, 0),
    note("s4", 5, 900, 950, 1, { w: 220, h: 200, tags: ["伏線1"] }),
    note("out", 6, 2100, 1300, 4, { tags: ["メイン"] }),
  ],
  edges: [], texts: [{ id: "t1", text: "第一幕", x: 1250, y: 700, size: 1 }], zones: [], strokes: [], images: [] }] };
await pg.goto(BASE);
await pg.evaluate((A) => {
  localStorage.clear();
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA", zoom: 0.7 }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
}, A);
await pg.reload(); await pg.waitForTimeout(1500);

const saved = async () => {
  await pg.waitForTimeout(1300);
  return pg.evaluate(() => JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0]);
};
const byId = (b) => Object.fromEntries(b.notes.map((n) => [n.id, n]));
const tagsOf = (b, ids) => ids.map((id) => byId(b)[id].tags);
const posOf = (b, ids) => ids.map((id) => [byId(b)[id].x, byId(b)[id].y]);
const ALL = ["s1", "big", "s2", "s3", "s4"];
const Z = 0.7;
const origin = () => pg.evaluate(() => { const r = document.querySelector("[data-origin]").getBoundingClientRect(); return { x: r.left, y: r.top }; });
const toScreen = async (x, y) => { const o = await origin(); return { x: o.x + x * Z, y: o.y + y * Z }; };

// 範囲選択（ボードの座標 230,140 〜 1760,1240）: 5枚と文字。out（2100,1300）は入らない
{
  const a = await toScreen(230, 140), b = await toScreen(1760, 1240);
  await pg.mouse.move(a.x, a.y); await pg.mouse.down();
  await pg.mouse.move(b.x, b.y, { steps: 10 }); await pg.mouse.up();
  await pg.waitForTimeout(300);
  eq("前提: 5枚と文字を選んだ", await pg.getByText(/個選択中$/).textContent(), "6個選択中");
}

// ---- 1) タグ ----
await pg.getByRole("button", { name: "🏷 タグ" }).click();
const chip = (t) => pg.locator(`[data-seltag] [data-tag="${t}"]`);
eq("一部に付いているタグは「一部」と人数", [await chip("メイン").getAttribute("data-state"), await chip("メイン").textContent()], ["some", "メイン 2/5"]);
eq("誰にも付いていないタグは「なし」", await chip("起").getAttribute("data-state"), "none");
await chip("メイン").click();
let b = await saved();
eq("一部のタグを押すと全員に付く", tagsOf(b, ALL).map((t) => t.includes("メイン")), [true, true, true, true, true]);
eq("付いていたタグの並びはそのまま", byId(b).big.tags, ["メイン", "重要度高"]);
eq("全員に付いたら「全員」と✓", [await chip("メイン").getAttribute("data-state"), await chip("メイン").textContent()], ["all", "✓ メイン"]);
await chip("メイン").click();
b = await saved();
eq("全員のタグを押すと全員から外れる", tagsOf(b, ALL), [[], ["重要度高"], [], [], ["伏線1"]]);
await chip("起").click();
await pg.locator("[data-seltag] input").fill("第二章");
await pg.keyboard.press("Enter");
b = await saved();
eq("候補のタグも自由入力のタグも全員に付く", tagsOf(b, ALL).map((t) => t.includes("起") && t.includes("第二章")), [true, true, true, true, true]);
eq("自由入力のタグは「その他」に出る", await chip("第二章").getAttribute("data-state"), "all");
eq("選ばなかった付箋は変わらない", byId(b).out.tags, ["メイン"]);
eq("文字には何も起きない（タグは付箋だけ）", b.texts[0].text, "第一幕");
eq("選択は残る", await pg.getByText(/個選択中$/).textContent(), "6個選択中");
await pg.getByRole("button", { name: "🏷 タグ" }).click();

// ---- 2) 整列（格子）----
const before = posOf(b, [...ALL, "out"]);
await pg.locator("[data-tidy]").click();
b = await saved();
// 単体試験と同じ計算: 3列×2行。列の幅 190 / 430 / 160、1行目の高さ 400（開いた big）
eq("左上（s1）を起点に3列×2行、縁のすき間は24", posOf(b, ALL), [[300, 200], [514, 200], [968, 200], [300, 624], [514, 624]]);
eq("選ばなかった付箋は動かない", posOf(b, ["out"]), [before[5]]);
eq("文字は動かない", [b.texts[0].x, b.texts[0].y], [1250, 700]);
{
  const r = b.notes.filter((n) => ALL.includes(n.id)).map((n) => ({ x: n.x, y: n.y, w: n.expanded ? n.ew : n.w, h: n.expanded ? n.eh : n.h }));
  eq("重ならない", r.some((p, i) => r.some((q, j) => i < j && p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h)), false);
}
await pg.mouse.move(5, 995);
await pg.keyboard.press("Control+z");
eq("Ctrl+Z 1回で整列前に戻る", posOf(await saved(), [...ALL, "out"]), before);
await pg.keyboard.press("Control+Shift+z");
eq("やり直すと整列した位置", posOf(await saved(), ALL), [[300, 200], [514, 200], [968, 200], [300, 624], [514, 624]]);

// ---- 3) 領域で囲む ----
await pg.locator("[data-enclose]").click();
await pg.keyboard.type("第一幕の場面");
b = await saved();
eq("領域が1つできる", b.zones.length, 1);
const zn = b.zones[0];
const textBox = await pg.evaluate((Z) => { const r = document.querySelector('[data-text="t1"]').getBoundingClientRect(); return { w: r.width / Z, h: r.height / Z }; }, Z);
eq("左上は左上の付箋から 24・名前の欄のぶん 40 外", [zn.x, zn.y], [276, 160]);
eq("下は一番下の付箋（s4: 624+200）から 24 外", zn.y + zn.h, 848);
eq("右は一番右のもの（文字）から 24 外", Math.round(zn.x + zn.w), Math.round(Math.max(968 + 160, 1250 + textBox.w) + 24));
{
  const inside = (r) => r.x >= zn.x && r.y >= zn.y && r.x + r.w <= zn.x + zn.w && r.y + r.h <= zn.y + zn.h;
  const rs = b.notes.filter((n) => ALL.includes(n.id)).map((n) => ({ x: n.x, y: n.y, w: n.expanded ? n.ew : n.w, h: n.expanded ? n.eh : n.h }));
  eq("選んだ付箋と文字がすべて入る", [rs.every(inside), inside({ x: 1250, y: 700, ...textBox })], [true, true]);
  eq("選ばなかった付箋は入らない", inside({ x: 2100, y: 1300, w: 190, h: 170 }), false);
}
eq("作ったらそのまま名前を書ける", zn.label, "第一幕の場面");
eq("色がまちまちなら順番の色（1つめ = レモン）", zn.color, "#E8D96A");
// 領域を動かすと中身も一緒に動く（今までの領域と同じ）
{
  const grip = pg.locator(`[data-zone="${zn.id}"]`).getByText("⠿").first();
  const g = await grip.boundingBox();
  await pg.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await pg.mouse.down();
  await pg.mouse.move(g.x + g.width / 2 + 70, g.y + g.height / 2 + 35, { steps: 6 }); await pg.mouse.up();
  const b2 = await saved();
  const dz = [b2.zones[0].x - zn.x, b2.zones[0].y - zn.y];
  eq("前提: 領域が動いた", dz[0] > 0 && dz[1] > 0, true);
  eq("中の付箋も同じだけ動く", posOf(b2, ["s1", "s4"]), [[300 + dz[0], 200 + dz[1]], [514 + dz[0], 624 + dz[1]]]);
  eq("外の付箋は動かない", posOf(b2, ["out"]), [before[5]]);
}

// ---- 4) 付箋リスト（☰）の「タグ」----
await pg.getByRole("button", { name: "解除" }).click();
await pg.locator("button", { hasText: "☰" }).first().click();
await pg.waitForTimeout(400);
const pick = async (text) => {
  const row = pg.locator("div", { has: pg.locator('input[type="checkbox"]') }).filter({ hasText: text }).last();
  await row.locator('input[type="checkbox"]').first().check();
};
await pick("out"); await pick("s2");
await pg.getByRole("button", { name: "タグ", exact: true }).click();
await pg.locator('[data-listtag] [data-tag="メイン"]').click();
b = await saved();
eq("リストで選んだ2枚: 一部（out だけ）→ 2枚とも付く", tagsOf(b, ["out", "s2"]).map((t) => t.includes("メイン")), [true, true]);
eq("リストで選ばなかった付箋は変わらない", byId(b).s1.tags.includes("メイン"), false);

console.log(ng === 0 ? "\n選んだ付箋の一括操作: すべて期待どおりです" : `\n選んだ付箋の一括操作: ${ng} 件 期待と違います`);
await browser.close();
process.exit(ng ? 1 : 0);
