// Shift を押しながら右下の角を引っぱると、幅か高さの片方だけが変わる（6.12.0。付箋と領域）
//   引っぱった量の大きい方だけ／付箋は動かない／開いた付箋・中の付箋も／途中で Shift を押しても切り替わる／
//   いちばん小さい大きさで止まる／動かさずに離したら選択に足す・外す（大きさは変わらない）／
//   領域も同じ／Shift なしは今までどおり両方／グリッド配置でも固定した方は元のまま
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1500, height: 1200 } })).newPage();
pg.on("pageerror", (e) => console.log("  pageerror:", e.message));

// 試験データ: A 190×170 / B 開いた付箋 430×400（中に C 160×140。A を広げても重ならない位置）/ 領域 Z 300×200
const note = (id, num, x, y, extra = {}) => ({ id, num, text: id, x, y, w: 190, h: 170, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 0, z: num, ...extra });
const DATA = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 4,
  notes: [note("A", 1, 100, 100), note("B", 2, 650, 100, { expanded: true }), note("C", 3, 10, 10, { parentId: "B", w: 160, h: 140 })],
  edges: [], texts: [], zones: [{ id: "Z", x: 100, y: 560, w: 300, h: 200, label: "領域", color: "#E8C547" }], strokes: [], images: [] }] };
const open = async (extraIndex = {}, patch = (d) => d) => {
  await pg.goto(BASE);
  await pg.evaluate(({ d, extraIndex }) => {
    localStorage.clear();
    localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA", ...extraIndex }));
    localStorage.setItem("idea-board-project:PA", JSON.stringify(d));
  }, { d: patch(JSON.parse(JSON.stringify(DATA))), extraIndex });
  await pg.reload(); await pg.waitForTimeout(1500);
};
const saved = async () => { await pg.waitForTimeout(1200); return pg.evaluate(() => JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0]); };
const noteOf = async (id) => (await saved()).notes.find((n) => n.id === id);
const sizeOf = async (id) => { const n = await noteOf(id); return n.expanded ? [n.ew, n.eh] : [n.w, n.h]; };
const posOf = async (id) => { const n = await noteOf(id); return [n.x, n.y]; };
const zoneOf = async () => { const z = (await saved()).zones[0]; return [z.x, z.y, z.w, z.h]; };
const corner = (id) => pg.locator(`[data-note="${id}"] > [title="ドラッグで大きさを変える"]`);
const zoneCorner = () => pg.locator('[data-zone="Z"] [title="ドラッグで領域の大きさを変える"]');
const picked = () => pg.evaluate(() => [...document.querySelectorAll("[data-note]")]
  .filter((el) => getComputedStyle(el).boxShadow.includes("61, 111, 180")).map((el) => el.dataset.note).sort());
// 角を (dx, dy) だけ引っぱる
const pull = async (loc, dx, dy, { shift = true } = {}) => {
  const b = await loc.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await pg.mouse.move(x, y);
  if (shift) await pg.keyboard.down("Shift");
  await pg.mouse.down();
  await pg.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await pg.mouse.move(x + dx, y + dy, { steps: 4 });
  await pg.mouse.up();
  if (shift) await pg.keyboard.up("Shift");
  await pg.waitForTimeout(150);
};

await open();
// 1) 付箋 A
await pull(corner("A"), 80, 20);
eq("A: 右へ多く → 幅だけ 190→270、高さ 170 のまま", await sizeOf("A"), [270, 170]);
eq("A: 位置は動かない", await posOf("A"), [100, 100]);
eq("A: 選択は変わらない", await picked(), []);
await pull(corner("A"), 10, 60);
eq("A: 下へ多く → 高さだけ 170→230、幅 270 のまま", await sizeOf("A"), [270, 230]);

// 2) 開いた付箋 B・中の付箋 C
await pull(corner("B"), 60, 10);
eq("B（開いた付箋）: 幅だけ 430→490", [await sizeOf("B"), await posOf("B")], [[490, 400], [650, 100]]);
await pull(corner("C"), 40, 10);
eq("C（中の付箋）: 幅だけ 160→200、B は変わらない", [await sizeOf("C"), await posOf("C"), await sizeOf("B")], [[200, 140], [10, 10], [490, 400]]);

// 3) ドラッグの途中で Shift を押す（A は 270×230 から）
{
  const b = await corner("A").boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await pg.mouse.move(x, y); await pg.mouse.down();
  await pg.mouse.move(x + 30, y + 40, { steps: 5 });
  await pg.waitForTimeout(100);
  const box = () => sizeOf("A"); // 押したまま保存を待って読む（画面の枠は上の帯 16px のぶん高い）
  eq("途中: Shift なしは両方変わる", await box(), [300, 270]);
  await pg.keyboard.down("Shift"); await pg.waitForTimeout(100);
  eq("途中: Shift を押すと（ポインタを動かさなくても）縦が多いので高さだけ", await box(), [270, 270]);
  await pg.mouse.move(x + 90, y + 40, { steps: 5 });
  await pg.mouse.up(); await pg.keyboard.up("Shift");
  eq("途中: 横が多くなると幅だけ（270→360、高さ 230 のまま）", await sizeOf("A"), [360, 230]);
}

// 4) いちばん小さい大きさで止まる
await pull(corner("A"), -400, -10);
eq("小さくしすぎ: 幅は 120 で止まり、高さ 230 のまま", await sizeOf("A"), [120, 230]);

// 5) 動かさずに離す → 選択に足す・外す（大きさは変わらない）
await pull(corner("A"), 0, 0);
eq("角を Shift+クリック: A が選択に入る", [await picked(), await sizeOf("A")], [["A"], [120, 230]]);
await pull(corner("C"), 1, 1);
eq("中の付箋 C の角を Shift+クリック（手ぶれ 1px）: B が選択に入る、C の大きさは変わらない", [await picked(), await sizeOf("C")], [["A", "B"], [200, 140]]);
await pull(corner("A"), 0, 0);
eq("もう一度: A が選択から外れる", await picked(), ["B"]);

// 6) 領域
await pull(zoneCorner(), 50, 120);
eq("領域: 下へ多く → 高さだけ 200→320、幅 300 のまま", await zoneOf(), [100, 560, 300, 320]);
await pull(zoneCorner(), 20, 30, { shift: false });
eq("領域: Shift なしは両方", await zoneOf(), [100, 560, 320, 350]);

// 7) Shift なしは今までどおり
await pull(corner("A"), 30, 30, { shift: false });
eq("A: Shift なしは幅も高さも変わる", await sizeOf("A"), [150, 260]);

// 8) グリッド配置: 変える方は目盛りに合わせ、固定した方は元のまま（目盛りに乗っていない 201）
await open({ gridMode: true }, (d) => { d.boards[0].notes[0].w = 201; d.boards[0].notes[0].h = 230; d.boards[0].zones[0].w = 301; return d; });
await pull(corner("A"), 10, 80);
eq("グリッド配置: 高さは目盛り（26 の倍数）、幅 201 のまま", await sizeOf("A"), [201, Math.round(310 / 26) * 26]);
await pull(zoneCorner(), 5, 60);
{ const z = await zoneOf(); eq("グリッド配置の領域: 幅 301 のまま、高さは目盛り", [z[2], z[3] % 26], [301, 0]); }

console.log(ng ? `shift-resize: ${ng} 件 期待と違います` : "shift-resize: すべて期待どおりです");
await browser.close();
process.exit(ng ? 1 : 0);
