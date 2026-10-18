// 端のないボード（6.6.0）: どの方向へもいくらでも置けるか、見ている場所が跳ねないか
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1400, height: 860 } })).newPage();
pg.on("pageerror", (e) => console.log("  pageerror:", e.message));

const note = (id, num, text, x, y) => ({ id, num, text, x, y, w: 190, h: 170, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 0, z: num });
// 今のデータ: (100,100) と (2800,1800) の付箋を線でつなぐ
const A = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 3,
  notes: [note("n1", 1, "左上の付箋", 100, 100), note("n2", 2, "右下の付箋", 2800, 1800)], edges: [{ id: "e", from: "n1", to: "n2" }],
  texts: [], zones: [], strokes: [], images: [] }] };
await pg.goto(BASE);
await pg.evaluate((A) => {
  localStorage.clear();
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA" }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
}, A);
await pg.reload(); await pg.waitForTimeout(1500);

const saved = () => pg.evaluate(() => JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0]);
const savedNote = async (text) => (await saved()).notes.find((n) => n.text === text);
const scroller = () => pg.evaluate(() => {
  const sc = document.querySelector("[data-origin]").closest("[style*='overflow: auto']");
  const r = sc.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, sl: sc.scrollLeft, st: sc.scrollTop, sw: sc.scrollWidth, sh: sc.scrollHeight };
});
const origin = () => pg.evaluate(() => { const r = document.querySelector("[data-origin]").getBoundingClientRect(); return { x: r.left, y: r.top }; });
const rectOf = (text) => pg.evaluate((text) => { const ta = [...document.querySelectorAll("textarea")].find((t) => t.value === text); const r = ta.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, text);
// 付箋のつかみ代（操作列のボタン以外の余白）を探す
const grip = (text) => pg.evaluate((text) => {
  const e = [...document.querySelectorAll("textarea")].find((t) => t.value === text).closest(".note-enter");
  const r = e.getBoundingClientRect();
  for (let x = r.left + 6; x < r.right - 6; x += 3) {
    const el = document.elementFromPoint(x, r.top + 9);
    if (el && e.contains(el) && !el.closest("button,[data-nodrag],textarea,input")) return { x, y: r.top + 9 };
  }
  return null;
}, text);
const scrollTo = (x, y) => pg.evaluate(({ x, y }) => { const sc = document.querySelector("[data-origin]").closest("[style*='overflow: auto']"); sc.scrollLeft = x; sc.scrollTop = y; }, { x, y });

console.log("■ 今のデータを開く");
let sc = await scroller(), o = await origin();
eq("原点 (0,0) が画面の左上（今までと同じ見え方）", [near(o.x, sc.left), near(o.y, sc.top)], [true, true]);
eq("左・上にもスクロールできる余白がある", [sc.sl > 0, sc.st > 0], [true, true]);

console.log("\n■ 付箋を左端より左へドラッグ（画面の端で自動スクロール）");
let g = await grip("左上の付箋");
await pg.mouse.move(g.x, g.y); await pg.mouse.down();
await pg.mouse.move(sc.left + 8, g.y, { steps: 10 });
await pg.waitForTimeout(1500);                       // 端に寄せたまま待つ → 自動でスクロール
await pg.mouse.up();
await pg.waitForTimeout(1200);
let n1 = await savedNote("左上の付箋");
eq("座標がマイナスになる（-500 より左）", n1.x < -500, true);
let r1 = await rectOf("左上の付箋"); sc = await scroller();
eq("ドラッグを離した場所に見えたまま", r1.x > sc.left - 10 && r1.x < sc.left + 200, true);

console.log("\n■ 開き直す");
await pg.reload(); await pg.waitForTimeout(1500);
n1 = await savedNote("左上の付箋");
eq("マイナスの座標のまま残る", n1.x < -500, true);
// 付箋のある所まで左へスクロールできる（スクロールできる範囲の中にある）
r1 = await rectOf("左上の付箋"); sc = await scroller();
const needLeft = sc.sl + (r1.x - sc.left) - 60;
eq("付箋の場所はスクロールできる範囲の中", needLeft >= 0, true);
await scrollTo(needLeft, sc.st);
await pg.waitForTimeout(300);
r1 = await rectOf("左上の付箋"); sc = await scroller();
eq("左へスクロールすると見える", r1.x >= sc.left && r1.x + r1.w <= sc.right, true);

console.log("\n■ 付箋を 3200 より右・2200 より下へ（自動スクロール）");
const wBefore = (await scroller()).sw;
const r2 = await rectOf("右下の付箋");
await pg.evaluate((t) => { [...document.querySelectorAll("textarea")].find((x) => x.value === t).scrollIntoView({ block: "center", inline: "center" }); }, "右下の付箋");
await pg.waitForTimeout(300);
g = await grip("右下の付箋"); sc = await scroller();
await pg.mouse.move(g.x, g.y); await pg.mouse.down();
await pg.mouse.move(sc.right - 8, sc.bottom - 8, { steps: 10 });
await pg.waitForTimeout(1500);
await pg.mouse.up();
await pg.waitForTimeout(1200);
const n2 = await savedNote("右下の付箋");
eq("3200 より右・2200 より下へ置ける", [n2.x > 3200, n2.y > 2200], [true, true]);
eq("ボードが広がる", (await scroller()).sw > wBefore, true);

console.log("\n■ マイナスの場所での操作");
await scrollTo(0, 0); await pg.waitForTimeout(300);
sc = await scroller(); o = await origin();
// 何も無い所をダブルクリック → そこに付箋
const click = { x: sc.left + 150, y: sc.top + 300 };
await pg.mouse.dblclick(click.x, click.y);
await pg.waitForTimeout(400);
// 「貼る前に色・タグを決める」（既定で入）の画面が出たら、そのまま貼る
const put = pg.getByRole("button", { name: "貼る", exact: true });
if (await put.count()) await put.last().click();
await pg.waitForTimeout(1200);
const bd = await saved();
const added = bd.notes.find((n) => !["n1", "n2"].includes(n.id));
const zoom = 1;
const want = { x: (click.x - o.x) / zoom - 95, y: (click.y - o.y) / zoom - 40 };
eq("ダブルクリックした場所（マイナス）に付箋ができる", [added && near(added.x, want.x, 30), added && near(added.y, want.y, 30), added && added.x < 0], [true, true, true]);
// 範囲選択でマイナスの場所の付箋を選べる
await pg.keyboard.press("Escape");
await pg.mouse.move(sc.left + 20, sc.top + 220); await pg.mouse.down();
await pg.mouse.move(sc.left + 420, sc.top + 560, { steps: 6 }); await pg.mouse.up();
await pg.waitForTimeout(300);
eq("範囲選択で選べる", await pg.getByText(/個選択中$/).count(), 1);
await pg.getByRole("button", { name: "解除", exact: true }).click();

console.log("\n■ 線");
const lineOk = await pg.evaluate(() => {
  const center = (t) => { const r = [...document.querySelectorAll("textarea")].find((x) => x.value === t).closest(".note-enter").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const a = center("左上の付箋"), b = center("右下の付箋");
  // 線は枠と枠を結ぶので、外接矩形は2枚の中心の間に収まり、横幅は中心間の距離の半分以上ある
  return [...document.querySelectorAll("svg line, svg path")].some((p) => {
    const r = p.getBoundingClientRect();
    return r.left >= Math.min(a.x, b.x) - 5 && r.right <= Math.max(a.x, b.x) + 5 && r.width > Math.abs(b.x - a.x) / 2;
  });
});
eq("マイナスの付箋とつないだ線が、2枚の付箋の間に描かれる", lineOk, true);

console.log("\n■ Ctrl＋ホイールで拡大縮小（マウスの下の場所を保つ）");
await pg.evaluate((t) => { [...document.querySelectorAll("textarea")].find((x) => x.value === t).scrollIntoView({ block: "center", inline: "center" }); }, "左上の付箋");
await pg.waitForTimeout(300);
const before = await rectOf("左上の付箋");
const px = before.x + before.w / 2, py = before.y + before.h / 2;
await pg.mouse.move(px, py);
await pg.keyboard.down("Control"); await pg.mouse.wheel(0, -100); await pg.keyboard.up("Control");
await pg.waitForTimeout(600);
const after = await rectOf("左上の付箋");
eq("拡大しても、マウスの下の付箋は同じ場所にある", [near(after.x + after.w / 2, px, 6), near(after.y + after.h / 2, py, 6), after.w > before.w], [true, true, true]);
await pg.keyboard.down("Control"); await pg.mouse.wheel(0, 100); await pg.keyboard.up("Control");
await pg.waitForTimeout(600);

console.log("\n■ 手書き（マイナスの場所）");
await pg.getByRole("button", { name: /^✏️/ }).first().click();
await pg.waitForTimeout(300);
const s0 = await rectOf("左上の付箋");
await pg.mouse.move(s0.x + 10, s0.y + s0.h + 40); await pg.mouse.down();
await pg.mouse.move(s0.x + 160, s0.y + s0.h + 80, { steps: 8 }); await pg.mouse.up();
await pg.getByRole("button", { name: "完了", exact: true }).click();
await pg.waitForTimeout(1200);
const st = (await saved()).strokes;
eq("手書きの線がマイナスの座標で残る", st.length === 1 && st[0].pts.every((p) => p.x < 0), true);

console.log("\n■ 見ている場所（マイナス）に新しく置く");
// 今は左上の付箋（マイナス）のあたりを見ている
const view = await pg.evaluate(() => {
  const o = document.querySelector("[data-origin]").getBoundingClientRect();
  const sc = document.querySelector("[data-origin]").closest("[style*='overflow: auto']").getBoundingClientRect();
  return { x: sc.left - o.left, y: sc.top - o.top, w: sc.width, h: sc.height };   // 画面の左上のボード座標（拡大率 100%）
});
eq("（前提）見ている場所はマイナス", view.x < 0, true);
await pg.getByRole("button", { name: "＋ 追加 ▾" }).click();
await pg.getByRole("button", { name: /^文字/ }).first().click();
await pg.waitForTimeout(1200);
const tx = (await saved()).texts.at(-1);
eq("「＋ 追加 → 文字」は見ている場所に置かれる", tx && tx.x > view.x && tx.x < view.x + view.w && tx.y > view.y && tx.y < view.y + view.h, true);
// 画像をドロップ
const drop = { x: (await scroller()).left + 300, y: (await scroller()).top + 400 };
await pg.evaluate(async ({ x, y }) => {
  const c = document.createElement("canvas"); c.width = 40; c.height = 30;
  c.getContext("2d").fillRect(0, 0, 40, 30);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const dt = new DataTransfer(); dt.items.add(new File([blob], "a.png", { type: "image/png" }));
  const plane = document.querySelector("[data-origin]").parentElement;
  plane.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
}, drop);
await pg.waitForTimeout(1500);
const im = (await saved()).images.at(-1);
const o2 = await origin();
eq("画像はドロップした場所（マイナス）に置かれる", im && near(im.x, drop.x - o2.x - 120, 30) && near(im.y, drop.y - o2.y - 80, 30) && im.x < 0, true);
// スマホから届いた付箋（貼り付けて取り込む）も見ている場所に貼られる
await pg.getByRole("button", { name: /^デバイス接続/ }).first().click();
await pg.getByRole("button", { name: "貼り付けて取り込む" }).click();
await pg.getByPlaceholder("ここに貼り付け").fill(JSON.stringify({ items: [{ id: "p1", text: "スマホから", color: 0, tags: [] }] }));
await pg.getByRole("button", { name: "取り込む", exact: true }).click();
await pg.waitForTimeout(1200);
const ph = (await saved()).notes.find((n) => n.text === "スマホから");
eq("取り込んだ付箋は見ている場所に貼られる", ph && ph.x > view.x - 50 && ph.x < view.x + view.w && ph.x < 0, true);
await pg.keyboard.press("Escape");

console.log("\n■ 付箋リストから飛ぶ");
await scrollTo(1e6, 1e6); await pg.waitForTimeout(300);   // 右下の遠く
await pg.getByTitle("付箋リストを開く／閉じる").click();
await pg.waitForTimeout(300);
await pg.getByText("左上の付箋", { exact: true }).last().click();
await pg.waitForTimeout(1500);
const r3 = await rectOf("左上の付箋"); sc = await scroller();
eq("マイナスの場所の付箋へ飛べる", r3.x >= sc.left - 5 && r3.x + r3.w <= sc.right + 5 && r3.y >= sc.top - 5 && r3.y <= sc.bottom, true);

await browser.close();
console.log(ng === 0 ? "\n端のないボード: すべて期待どおりです" : `\n端のないボード: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
