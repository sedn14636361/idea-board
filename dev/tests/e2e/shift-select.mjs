// Shift+クリックは付箋の上のどこを押しても複数選択に足す・外す（6.10.1）
//   本文・タイトル・タグの行・引用の表示・操作列のボタン・大きさを変える角・開いた付箋の中・中の付箋
//   ボタンは押したことにならない／文字カーソルは入らない／動かない・大きさが変わらない
//   開いている色のメニューの中は今までどおり（色が変わる）／Shift なしは今までどおり
// Shift+ドラッグは真縦か真横にだけ動く（6.11.0）
//   動かした量の大きい方へ／どこをつかんでも／選択は変えない／選択中なら選択全体／中の付箋は親の中で／
//   ドラッグの途中で Shift を押しても／手ぶれでは動かない／グリッド配置でも固定した向きは目盛りに合わせない
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
pg.on("pageerror", (e) => console.log("  pageerror:", e.message));

const note = (id, num, text, x, y, color, extra = {}) => ({ id, num, text, x, y, w: 260, h: 230, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color, z: num, ...extra });
// A: タイトル欄・タグ・引用つき / B: 開いていて中に C / D: 選ばない
const A = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 5,
  notes: [
    note("A", 1, "本文A", 100, 100, 0, { title: "見出しA", useTitle: true, tags: ["メイン"], refs: ["D"] }),
    note("B", 2, "本文B", 450, 100, 2, { expanded: true }),
    note("C", 3, "中のC", 10, 10, 1, { parentId: "B" }),
    note("D", 4, "本文D", 100, 650, 3),
  ],
  edges: [], texts: [], zones: [], strokes: [], images: [] }] };
await pg.goto(BASE);
await pg.evaluate((A) => {
  localStorage.clear();
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA" }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
}, A);
await pg.reload(); await pg.waitForTimeout(1500);

const saved = () => pg.evaluate(() => JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0].notes
  .map(({ id, x, y, w, h, ew, eh, text, title, color }) => ({ id, x, y, w, h, ew, eh, text, title, color })));
// 範囲選択の枠（#3D6FB4）が付いているか
const picked = () => pg.evaluate(() => [...document.querySelectorAll("[data-note]")]
  .filter((el) => getComputedStyle(el).boxShadow.includes("61, 111, 180")).map((el) => el.dataset.note).sort());
const shiftClick = async (loc, opt = {}) => {
  const b = await loc.boundingBox();
  if (!b) throw new Error("見つからない: " + loc);
  const x = b.x + (opt.dx ?? b.width / 2), y = b.y + (opt.dy ?? b.height / 2);
  await pg.keyboard.down("Shift");
  if (opt.dbl) await pg.mouse.dblclick(x, y); else await pg.mouse.click(x, y);
  await pg.keyboard.up("Shift");
  await pg.waitForTimeout(150);
};
const focused = () => pg.evaluate(() => document.activeElement?.tagName || "");
const dialog = () => pg.getByText(/剥がします。よろしいですか/).count();

const nA = pg.locator('[data-note="A"]');
const nB = pg.locator('[data-note="B"]');
const nC = pg.locator('[data-note="C"]');
const before = await saved();

// 1) A の上の各所。押すたびに A が入る・外れる
const spots = [
  ["本文", nA.locator("textarea")],
  ["タイトル欄", nA.locator('input[placeholder="タイトル"]')],
  ["タグのチップ", nA.getByText("メイン", { exact: true })],
  ["引用の表示", nA.getByText("本文D")],
  ["剥がすボタン ✕", nA.locator('button[title="剥がす（中身も一緒）"]')],
  ["色のボタン", nA.locator('button[title="色を変える"]')],
  ["コピーのボタン ⧉", nA.locator('button[title="複製・他のボード/プロジェクトへコピー"]')],
  ["＋→", nA.locator('button[title="右に同じ色・タグの付箋を作って線でつなぐ"]')],
  ["大きさを変える角", nA.locator('[title="ドラッグで大きさを変える"]')],
  ["番号（操作列のすき間）", nA.getByText("#1", { exact: true })],
];
let want = false;
for (const [label, loc] of spots) {
  await shiftClick(loc);
  want = !want;
  eq(`A の${label}: ${want ? "選択に入る" : "選択から外れる"}`, await picked(), want ? ["A"] : []);
}
eq("剥がす確認は出ていない", await dialog(), 0);
eq("入力欄にカーソルは入っていない", await focused(), "BODY");
eq("色・コピーのメニューは開いていない", await pg.locator("[data-notepop]").count(), 0);
await pg.waitForTimeout(1200);
const s1 = await saved();
eq("付箋は増えも減りもせず、位置・大きさ・中身も変わらない", s1, before);

// 2) B の開いた中・中の付箋 C → B が入る・外れる。C は選ばれず、動かない
await shiftClick(nB.locator('[data-nodrag]').filter({ has: nC }), { dx: 300, dy: 200 });
eq("B の開いた中の空き: B が選択に入る", await picked(), ["B"]);
await shiftClick(nC.locator("textarea"));
eq("中の付箋 C の本文: B が選択から外れる（C は選ばれない）", await picked(), []);
await shiftClick(nC.getByText("#3", { exact: true }));
eq("中の付箋 C の操作列: B が選択に入る", await picked(), ["B"]);
await shiftClick(nA.locator("textarea"));
eq("続けて A: A と B の両方が選ばれている", await picked(), ["A", "B"]);
eq("選択中の表示", await pg.getByText(/個選択中$/).textContent(), "2個選択中");
// Shift+ダブルクリックで「中に付箋を貼る」が起きない（2回足し引きして元に戻る）
await shiftClick(nB.locator('[data-nodrag]').filter({ has: nC }), { dx: 300, dy: 200, dbl: true });
await pg.waitForTimeout(1200);
eq("B の中を Shift+ダブルクリック: 付箋は増えない", (await saved()).length, before.length);
eq("B の中を Shift+ダブルクリック: 2回足し引きして B は選ばれたまま", await picked(), ["A", "B"]);
eq("C・D は動かず、何も変わらない", (await saved()).filter((n) => n.id !== "A" && n.id !== "B"), before.filter((n) => n.id !== "A" && n.id !== "B"));

// 3) 開いている色のメニューの中は今までどおり（Shift でも色を選べる）。選択は変わらない
await nA.locator('button[title="色を変える"]').click();
await shiftClick(pg.locator('[data-notepop] button[title="さくら"]'));
await pg.waitForTimeout(1200);
eq("色のメニューの中を Shift+クリック: 色が変わる", (await saved()).find((n) => n.id === "A").color, 1);

// 4) Shift なしは今までどおり（本文に書ける。選択は解除）
await nA.locator("textarea").click();
await pg.keyboard.type("x");
await pg.waitForTimeout(1200);
eq("Shift なしで本文を押すと書ける", (await saved()).find((n) => n.id === "A").text, "本文Ax");

// ---- 5) Shift+ドラッグ（6.11.0）----
const pos = async (id) => { await pg.waitForTimeout(1200); const n = (await saved()).find((m) => m.id === id); return [n.x, n.y]; }; // 保存は 0.8 秒あと
const centerOf = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
// from から (dx, dy) だけ、途中の点を通って動かす。shift: 押しながら
const drag = async (from, dx, dy, { shift = true } = {}) => {
  await pg.mouse.move(from.x, from.y);
  if (shift) await pg.keyboard.down("Shift");
  await pg.mouse.down();
  await pg.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await pg.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await pg.mouse.up();
  if (shift) await pg.keyboard.up("Shift");
  await pg.waitForTimeout(200);
};
await pg.mouse.click(5, 880); // 選択を解除（ボードの空いているところ）
await pg.waitForTimeout(200);
eq("前提: 何も選ばれていない", await picked(), []);
eq("前提: A の位置", await pos("A"), [100, 100]);
await drag(await centerOf(nA.locator("textarea")), 100, 30);
eq("A の本文をつかんで右下へ（横が大きい）: 真横に 100 だけ動く", await pos("A"), [200, 100]);
await drag(await centerOf(nA.locator('input[placeholder="タイトル"]')), 20, 120);
eq("A のタイトル欄をつかんで下へ（縦が大きい）: 真下に 120 だけ動く", await pos("A"), [200, 220]);
await drag(await centerOf(nA.locator('button[title="剥がす（中身も一緒）"]')), -40, -10);
eq("A の ✕ をつかんで左へ: 真横に動き、剥がす確認は出ない", [await pos("A"), await dialog()], [[160, 220], 0]);
eq("Shift+ドラッグでは選択は変わらない", await picked(), []);

// 選択中の付箋をつかむと、選択全体が同じだけ動く
await shiftClick(nA.locator("textarea"));
await shiftClick(pg.locator('[data-note="D"] textarea'));
eq("前提: A と D を選んだ", await picked(), ["A", "D"]);
await drag(await centerOf(nA.locator("textarea")), -25, 80); // D は画面の下の端に近く、つかむと自動スクロールが始まるので A で
eq("選択中の A をつかんで下へ: A と D が真下に 80 動く", [await pos("A"), await pos("D")], [[160, 300], [100, 730]]);
eq("選択は A と D のまま", await picked(), ["A", "D"]);

// 中の付箋 C をつかむと、C が B の中で真横に動く（B は動かない・選択も変わらない）
await drag(await centerOf(nC.locator("textarea")), 60, 15);
eq("中の付箋 C を右へ: C だけ真横に 60 動く", [await pos("C"), await pos("B")], [[70, 10], [450, 100]]);
eq("選択は A と D のまま（C・B は入らない）", await picked(), ["A", "D"]);

// 手ぶれ（2px）では動かず、選択に足す・外すだけ
{
  const c = await centerOf(nB.getByText("#2", { exact: true }));
  await pg.mouse.move(c.x, c.y); await pg.keyboard.down("Shift"); await pg.mouse.down();
  await pg.mouse.move(c.x + 2, c.y + 1); await pg.mouse.up(); await pg.keyboard.up("Shift");
  await pg.waitForTimeout(200);
  eq("Shift+クリックの手ぶれ（2px）: B は動かず、選択に入る", [await pos("B"), await picked()], [[450, 100], ["A", "B", "D"]]);
}
await pg.getByRole("button", { name: "解除" }).click();
await pg.waitForTimeout(200);

// ドラッグの途中で Shift を押す（つかみ代の番号から普通にドラッグを始める。A は (160, 300)）
const onScreen = (id) => pg.evaluate((id) => { const r = document.querySelector(`[data-note="${id}"]`).getBoundingClientRect(), o = document.querySelector("[data-origin]").getBoundingClientRect(); return [Math.round(r.left - o.left), Math.round(r.top - o.top)]; }, id);
{
  const c = await centerOf(nA.getByText("#1", { exact: true }));
  await pg.mouse.move(c.x, c.y); await pg.mouse.down();
  await pg.mouse.move(c.x + 60, c.y + 50, { steps: 6 });
  await pg.waitForTimeout(100);
  eq("Shift なしの間は斜めにも動く", await onScreen("A"), [220, 350]);
  await pg.keyboard.down("Shift");
  await pg.waitForTimeout(100);
  eq("途中で Shift を押すと（ポインタを動かさなくても）真横に戻る", await onScreen("A"), [220, 300]);
  await pg.mouse.move(c.x + 80, c.y + 200, { steps: 6 });
  await pg.mouse.up(); await pg.keyboard.up("Shift");
  eq("そのまま下へ動かすと真縦（縦が大きくなったので向きが変わる）", await pos("A"), [160, 500]);
}

// グリッド配置: 動かす向きは目盛りに合わせ、固定した向きは元のまま（目盛りに合わせると元の位置からずれる）
await pg.evaluate(() => {
  const k = "idea-board-index", idx = JSON.parse(localStorage.getItem(k));
  localStorage.setItem(k, JSON.stringify({ ...idx, gridMode: true }));
  const pk = "idea-board-project:PA", p = JSON.parse(localStorage.getItem(pk));
  p.boards[0].notes.find((n) => n.id === "A").x = 101; // 目盛り（26）に乗っていない位置
  localStorage.setItem(pk, JSON.stringify(p));
});
await pg.reload(); await pg.waitForTimeout(1500);
eq("前提: グリッド配置で A は (101, 500)", await pos("A"), [101, 500]);
await drag(await centerOf(nA.locator("textarea")), 15, 100);
eq("グリッド配置で真下へ: y は目盛り（26 の倍数）、x は 101 のまま", await pos("A"), [101, Math.round((500 + 100) / 26) * 26]);

console.log(ng ? `shift-select: ${ng} 件 期待と違います` : "shift-select: すべて期待どおりです");
await browser.close();
process.exit(ng ? 1 : 0);
