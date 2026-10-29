// 元に戻す（Ctrl+Z）／やり直す（Ctrl+Shift+Z・Ctrl+Y）（6.8.0）
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
pg.on("pageerror", (e) => { console.log("  pageerror:", e.message); ng++; });

// 試験データ: 色の違う付箋3枚（#2 はタグ付き、#3 の中に付箋1枚）、線1本、文字1つ
// 色の番号: 0 レモン / 1 さくら / 2 そら / 3 わかば / 4 ふじ / 5 グレー
const note = (id, num, text, x, y, color, extra = {}) => ({ id, num, text, x, y, w: 190, h: 170, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color, z: num, ...extra });
const A = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 5,
  notes: [
    note("n1", 1, "レモン", 100, 100, 0),
    note("n2", 2, "わかば", 400, 100, 3, { tags: ["メイン", "重要度高"] }),
    note("n3", 3, "そら", 700, 100, 2),
    note("c1", 4, "中の付箋", 10, 10, 2, { parentId: "n3" }),
  ],
  edges: [{ id: "e1", from: "n1", to: "n2" }], texts: [{ id: "t1", text: "見出し", x: 100, y: 400, size: 1 }], zones: [], strokes: [], images: [] }] };
await pg.goto(BASE);
await pg.evaluate((A) => {
  localStorage.clear();
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA" }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
}, A);
await pg.reload(); await pg.waitForTimeout(1500);

// 保存された中身（0.8秒の自動保存を待ってから読む）
const saved = async () => {
  await pg.waitForTimeout(1300);
  return pg.evaluate(() => JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0]);
};
const shape = (b) => ({
  notes: b.notes.map((n) => `${n.id}#${n.num}@${n.x},${n.y}:${n.color}:${n.text}:${(n.tags || []).join("/")}`).sort(),
  edges: b.edges.map((e) => `${e.from}-${e.to}`).sort(), texts: (b.texts || []).map((t) => t.id), nextNum: b.nextNum,
});
const s0 = shape(await saved());
const origin = () => pg.evaluate(() => { const r = document.querySelector("[data-origin]").getBoundingClientRect(); return { x: r.left, y: r.top }; });
const clickEmpty = async () => { const o = await origin(); await pg.mouse.click(o.x + 1300, o.y + 700); await pg.waitForTimeout(100); };
const undoBtn = pg.locator("[data-undo]"), redoBtn = pg.locator("[data-redo]");

eq("開いた直後は戻すものが無い（ボタンは押せない）", [await undoBtn.isDisabled(), await redoBtn.isDisabled()], [true, true]);
await clickEmpty();
await pg.keyboard.press("Control+z");
eq("開いた直後の Ctrl+Z では何も変わらない", shape(await saved()), s0);

// 1) 中の付箋を持つ付箋を剥がす → Ctrl+Z で中身・番号・線ごと戻る
await pg.locator('[data-note="n3"] button[title="剥がす（中身も一緒）"]').first().click();
const s1 = shape(await saved());
eq("前提: #3 と中の付箋が消え、番号が詰まる", [s1.notes.length, s1.nextNum], [2, 3]);
await pg.keyboard.press("Control+z");
eq("Ctrl+Z で剥がす前に戻る（中の付箋・番号も）", shape(await saved()), s0);
await pg.keyboard.press("Control+Shift+z");
eq("Ctrl+Shift+Z でもう一度剥がした状態", shape(await saved()), s1);
await pg.keyboard.press("Control+z");
await pg.keyboard.press("Control+y");
eq("Ctrl+Y でもやり直せる", shape(await saved()), s1);
await pg.keyboard.press("Control+z");
eq("もう一度戻す", shape(await saved()), s0);

// 2) ドラッグ1回は、途中で止まっても1手
const grip = await pg.evaluate(() => {
  const row = document.querySelector('[data-note="n1"]').firstElementChild;
  const sp = [...row.children].find((c) => c.style.flex.startsWith("1"));
  const r = sp.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await pg.mouse.move(grip.x, grip.y); await pg.mouse.down();
await pg.mouse.move(grip.x + 100, grip.y + 300, { steps: 6 });
await pg.waitForTimeout(800);
await pg.mouse.move(grip.x + 200, grip.y + 400, { steps: 6 }); await pg.mouse.up();
const s2 = await saved();
eq("前提: 動いた", s2.notes.find((n) => n.id === "n1").x !== 100, true);
await pg.keyboard.press("Control+z");
eq("ドラッグ1回が1手で戻る", shape(await saved()), s0);

// 3) ひと続きの入力は1手。入力欄の中の Ctrl+Z ではボードは戻らない
await pg.locator('[data-note="n1"] textarea').first().click();
await pg.keyboard.type("abc", { delay: 60 });
await clickEmpty();
eq("前提: 入力した", (await saved()).notes.find((n) => n.id === "n1").text, "レモンabc");
await pg.keyboard.press("Control+z");
eq("入力した分がまとめて1手で戻る", shape(await saved()), s0);
await pg.locator('[data-note="n2"] button[title="剥がす（中身も一緒）"]').first().click();
const s3 = shape(await saved());
await pg.locator("button", { hasText: "☰" }).first().click();
await pg.locator('input[placeholder="タイトル・本文・タグで検索"]').click();
await pg.keyboard.press("Control+z");
eq("入力欄にいるときの Ctrl+Z ではボードは戻らない", shape(await saved()), s3);
await pg.locator("button", { hasText: "☰" }).first().click();
await clickEmpty();
await pg.keyboard.press("Control+z");
eq("入力欄を離れれば戻る", shape(await saved()), s0);

// 4) 範囲選択して Delete → 確認 →「剥がす」→ 1手で戻る
{
  const o = await origin();
  await pg.mouse.move(o.x + 60, o.y + 60); await pg.mouse.down();
  await pg.mouse.move(o.x + 640, o.y + 480, { steps: 8 }); await pg.mouse.up();
  await pg.waitForTimeout(300);
  eq("前提: 2枚と文字を選んだ", await pg.getByText(/個選択中$/).textContent(), "3個選択中");
  await pg.keyboard.press("Delete");
  await pg.getByRole("button", { name: "剥がす", exact: true }).click();
  const s4 = shape(await saved());
  eq("前提: まとめて剥がした", [s4.notes.length, s4.texts.length, s4.edges.length], [2, 0, 0]);
  await pg.keyboard.press("Control+z");
  eq("まとめて剥がしたのも1手で戻る（線・文字も）", shape(await saved()), s0);
}

// 5) ツールバーのボタン（iPad 用）
eq("戻したあとは「↷」が押せる", await redoBtn.isDisabled(), false);
await redoBtn.click();
eq("「↷」でやり直す", (await saved()).notes.length, 2);
await undoBtn.click();
eq("「↶ 戻す」で戻す", shape(await saved()), s0);

// 6) 色を変える → 戻す → 別の変更をすると、やり直しは消える
await pg.locator('[data-note="n1"] button[title="色を変える"]').first().click();
await pg.locator('[data-note="n1"] [data-colormenu] button[title="ふじ"]').first().click();
eq("前提: 色が変わった", (await saved()).notes.find((n) => n.id === "n1").color, 4);
await pg.keyboard.press("Control+z");
eq("色も戻る", shape(await saved()), s0);
await pg.locator('[data-note="n3"] button[title="剥がす（中身も一緒）"]').first().click();
await pg.waitForTimeout(800);
eq("戻したあとに別の変更をすると、やり直せない", await redoBtn.isDisabled(), true);
await pg.keyboard.press("Control+Shift+z");
eq("（Ctrl+Shift+Z でも何も起きない。#3 は中の付箋ごと剥がしたまま）", shape(await saved()).notes.length, 2);

// 7) 付箋を押しただけ（前面に上げる）は手に数えない
await pg.keyboard.press("Control+z");
await saved();
await pg.locator('[data-note="n2"] textarea').first().click(); // 押すと前面に上がる（z が変わる）
await clickEmpty();
await pg.waitForTimeout(800);
eq("押しただけでは戻すものが増えない（↶ は押せない）", await undoBtn.isDisabled(), true);

// 8) 開き直すと履歴は無い（保存しない）
await pg.reload(); await pg.waitForTimeout(1500);
eq("開き直したら戻すものは無い", await undoBtn.isDisabled(), true);

console.log(ng === 0 ? "\n元に戻す: すべて期待どおりです" : `\n元に戻す: ${ng} 件 期待と違います`);
await browser.close();
process.exit(ng ? 1 : 0);
