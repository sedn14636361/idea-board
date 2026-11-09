// Windows で Shift を押し続けたまま動かすと「Maximum update depth exceeded」で落ちていた（6.14.1 で修正）
//   Windows はキーを押し続けると keydown を繰り返し送る。Playwright の keyboard.down は1回しか送らないので、
//   CDP の Input.dispatchKeyEvent（autoRepeat）で、動かしている間も Shift の keydown を送り続ける
//   付箋1枚・選んだ複数・中の付箋の移動、付箋・領域の大きさの変更で、落ちず・真横/真縦に動く
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
pg.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));

// 試験データ: A・B（線でつながる）・開いた C（中に K）・領域 Z
const note = (id, num, x, y, extra = {}) => ({ id, num, text: id, x, y, w: 190, h: 170, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 0, z: num, ...extra });
const DATA = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 5,
  notes: [note("A", 1, 100, 100), note("B", 2, 400, 100), note("C", 3, 700, 100, { expanded: true }), note("K", 4, 10, 10, { parentId: "C", w: 150, h: 120 })],
  edges: [{ id: "e", from: "A", to: "B" }], texts: [], zones: [{ id: "Z", x: 100, y: 560, w: 300, h: 160, label: "z", color: "#E8C547" }], strokes: [], images: [] }] };
await pg.goto(BASE);
await pg.evaluate((d) => {
  localStorage.clear();
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA" }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(d));
}, DATA);
await pg.reload(); await pg.waitForTimeout(1500);

const cdp = await pg.context().newCDPSession(pg);
const key = (type, autoRepeat = false) => cdp.send("Input.dispatchKeyEvent", { type, key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16, modifiers: type === "keyUp" ? 0 : 8, autoRepeat });
const mouse = (type, x, y, shift = true) => cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, modifiers: shift ? 8 : 0 });
const saved = async () => { await pg.waitForTimeout(1200); return pg.evaluate(() => JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0]); };
const noteOf = async (id) => (await saved()).notes.find((n) => n.id === id);
// Shift を押し続けたまま（keydown を繰り返しながら）(dx, dy) だけ引っぱる
const holdDrag = async (loc, dx, dy) => {
  const b = await loc.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await key("rawKeyDown"); await key("keyDown");
  for (let i = 0; i < 4; i++) await key("keyDown", true);
  await mouse("mousePressed", x, y);
  for (let i = 1; i <= 20; i++) { await mouse("mouseMoved", x + dx * i / 20, y + dy * i / 20); await key("keyDown", true); }
  await mouse("mouseReleased", x + dx, y + dy);
  await key("keyUp");
  await pg.waitForTimeout(200);
};
const N = (id) => pg.locator(`[data-note="${id}"]`);

await holdDrag(N("A").getByText("#1", { exact: true }), 100, 20);
eq("付箋1枚: 落ちない", errors, []);
eq("付箋1枚: 真横に 100", [(await noteOf("A")).x, (await noteOf("A")).y], [200, 100]);

await holdDrag(N("K").getByText("#4", { exact: true }), 30, 6);
eq("中の付箋: 落ちない・真横に 30", [errors, (await noteOf("K")).x, (await noteOf("K")).y], [[], 40, 10]);

// A と B を選んで、A の本文をつかんで下へ
for (const id of ["A", "B"]) {
  const b = await N(id).getByText(id === "A" ? "#1" : "#2", { exact: true }).boundingBox();
  await pg.keyboard.down("Shift"); await pg.mouse.click(b.x + 3, b.y + 3); await pg.keyboard.up("Shift");
  await pg.waitForTimeout(150);
}
await holdDrag(N("A").locator("textarea"), 10, 80);
{
  const a = await noteOf("A"), b = await noteOf("B");
  eq("選んだ2枚: 落ちない・そろって真下に 80", [errors, [a.x, a.y], [b.x, b.y]], [[], [200, 180], [400, 180]]);
}

await holdDrag(N("B").locator(':scope > [title="ドラッグで大きさを変える"]'), 60, 10);
{
  const b = await noteOf("B");
  eq("付箋の大きさ: 落ちない・幅だけ +60", [errors, b.w, b.h], [[], 250, 170]);
}
await holdDrag(pg.locator('[data-zone="Z"] [title="ドラッグで領域の大きさを変える"]'), 8, 60);
{
  const z = (await saved()).zones[0];
  eq("領域の大きさ: 落ちない・高さだけ +60", [errors, z.w, z.h], [[], 300, 220]);
}
eq("起動時のエラー画面が出ていない", await pg.getByText("起動時にエラーが発生しました").count(), 0);

console.log(ng ? `shift-repeat: ${ng} 件 期待と違います` : "shift-repeat: すべて期待どおりです");
await browser.close();
process.exit(ng ? 1 : 0);
