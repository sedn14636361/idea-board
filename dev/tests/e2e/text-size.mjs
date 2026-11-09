// 直書きの文字の大きさ（6.13.0）
//   ふだんは書いたことがすべて入る（幅は一番長い行の実際の幅、640 で折り返し、高さは全部の行）／
//   書き足す・「A」で大きくすると広がる／右下の角で幅を決めるとその幅で折り返し、高さは中身に合わせる／
//   いちばん狭くしても全部見える／角のダブルクリックで中身に合わせた幅に戻る／Ctrl+Z／開き直しても保つ／
//   空の文字の角を引っぱっても消えない
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
pg.on("pageerror", (e) => console.log("  pageerror:", e.message));

// 試験データ: 見出し・半角・約90字の長い一行・3行（大きさ A2）
const LONG = "とても長い一行の文章を書いた場合にどのように表示されるのかを確かめるための試験用の文です。".repeat(2);
const TEXTS = [
  { id: "t1", x: 40, y: 40, text: "見出し", size: 1, z: 1 },
  { id: "t2", x: 40, y: 120, text: "abc def ghi", size: 1, z: 2 },
  { id: "t3", x: 40, y: 200, text: LONG, size: 1, z: 3 },
  { id: "t4", x: 40, y: 420, text: "一行目\n二行目はもう少し長い\n三行目", size: 2, z: 4 },
];
const open = async (extraIndex = {}) => {
  await pg.goto(BASE);
  await pg.evaluate(({ TEXTS, extraIndex }) => {
    localStorage.clear();
    localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA", ...extraIndex }));
    localStorage.setItem("idea-board-project:PA", JSON.stringify({ id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 1, notes: [], edges: [], texts: TEXTS, zones: [], strokes: [], images: [] }] }));
  }, { TEXTS, extraIndex });
  await pg.reload(); await pg.waitForTimeout(1500);
};
const saved = async () => { await pg.waitForTimeout(1200); return pg.evaluate(() => JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0]); };
const textOf = async (id) => (await saved()).texts.find((t) => t.id === id);
// 入力欄の大きさと、中身が全部見えているか（はみ出し＝スクロールが要るか）
const box = (id) => pg.evaluate((id) => {
  const ta = document.querySelector(`[data-text="${id}"] > textarea`);
  return { w: ta.offsetWidth, h: ta.offsetHeight, all: ta.scrollHeight <= ta.clientHeight + 1 && ta.scrollWidth <= ta.clientWidth + 1 };
}, id);
const allVisible = () => pg.evaluate(() => [...document.querySelectorAll("[data-text] > textarea")]
  .filter((ta) => !(ta.scrollHeight <= ta.clientHeight + 1 && ta.scrollWidth <= ta.clientWidth + 1)).map((ta) => ta.closest("[data-text]").dataset.text));
const handle = (id) => pg.locator(`[data-text="${id}"] [data-textresize]`);
const pullHandle = async (id, dx) => {
  await pg.locator(`[data-text="${id}"]`).hover();
  const b = await handle(id).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await pg.mouse.move(x, y); await pg.mouse.down();
  await pg.mouse.move(x + dx / 2, y, { steps: 4 }); await pg.mouse.move(x + dx, y, { steps: 4 }); await pg.mouse.up();
  await pg.waitForTimeout(150);
};
const away = async () => { await pg.mouse.click(1350, 860); await pg.waitForTimeout(150); };

await open();
// 1) ふだんは全部入る
eq("1: 4つとも中身が全部見えている", await allVisible(), []);
{
  const b3 = await box("t3");
  eq("1: 長い一行は 640（＋左右の余白）までで折り返し、3行以上の高さ", [b3.w <= 650, b3.h > 100], [true, true]);
  const b2 = await box("t2");
  eq("1: 半角の「abc def ghi」は右に大きな余白を作らない（文字数から見積もっていた 6.12.0 は 294px）", b2.w < 160, true);
  const b4 = await box("t4");
  eq("1: 3行（A2）は3行ぶんの高さ", b4.all, true);
}

// 2) 書き足す・「A」で大きくすると広がる
{
  const before = await box("t1");
  await pg.locator('[data-text="t1"] > textarea').click();
  await pg.keyboard.press("End");
  await pg.keyboard.type("をもっと長く書き足してみる");
  const typed = await box("t1");
  eq("2: 書き足すと幅が広がり、全部見える", [typed.w > before.w, typed.all], [true, true]);
  await pg.locator('[data-text="t1"] button[title="文字サイズを変える"]').click();
  await pg.waitForTimeout(150);
  const bigger = await box("t1");
  eq("2: 「A」で大きくすると広がり、全部見える", [bigger.w > typed.w, bigger.h > typed.h, bigger.all], [true, true, true]);
  await away();
}

// 3) 角で幅を決める（長い文を 300 狭く）→ その幅で折り返し、高さは中身に合わせる
{
  const b = await box("t3");
  await pullHandle("t3", -300);
  const t = await textOf("t3");
  const nb = await box("t3");
  eq("3: 幅を決めた（元の幅 −300）", t.w, b.w - 300);
  eq("3: 入力欄はその幅で、行が増えて高くなり、全部見える", [nb.w, nb.h > b.h, nb.all], [b.w - 300, true, true]);
  await pg.keyboard.press("Control+z");
  eq("3: Ctrl+Z で幅を決める前に戻る（中身に合わせる）", (await textOf("t3")).w, undefined);
  eq("3: 戻した大きさ", (await box("t3")).w, b.w);
}

// 4) 広げる → 開き直しても保つ → 角のダブルクリックで中身に合わせる
{
  const b = await box("t2");
  await pullHandle("t2", 200);
  eq("4: 広げた幅を保存", (await textOf("t2")).w, b.w + 200);
  await pg.reload(); await pg.waitForTimeout(1500);
  eq("4: 開き直しても同じ幅", (await box("t2")).w, b.w + 200);
  await pg.locator('[data-text="t2"]').hover();
  await handle("t2").dblclick();
  await pg.waitForTimeout(150);
  eq("4: 角のダブルクリックで中身に合わせた幅に戻る", [(await textOf("t2")).w, (await box("t2")).w], [undefined, b.w]);
}

// 5) いちばん狭くしても全部見える（1文字ずつ折り返す）
await pullHandle("t4", -2000);
{
  const t = await textOf("t4");
  const b = await box("t4");
  eq("5: 幅は 48 で止まる", t.w, 48);
  eq("5: 高さが伸びて全部見える", b.all, true);
}
await away();
eq("5: そのあとも全部の文字が全部見えている", await allVisible(), []);

// 6) 空の文字の角を引っぱっても消えず、カーソルが戻る
{
  const r = await pg.locator("[data-origin]").boundingBox();
  await pg.keyboard.down("Control"); await pg.mouse.dblclick(r.x + 800, r.y + 100); await pg.keyboard.up("Control");
  await pg.waitForTimeout(200);
  const id = await pg.evaluate(() => document.activeElement?.closest?.("[data-text]")?.dataset.text);
  eq("6: 空の文字も、入力欄に「文字を入力」が全部見える大きさ", (await box(id)).all, true);
  await pullHandle(id, 120);
  const t = (await saved()).texts.find((x) => x.id === id);
  eq("6: 角を引っぱっても消えず、幅が決まる", [!!t, t?.w > 0], [true, true]);
  eq("6: カーソルが入力欄に戻る", await pg.evaluate(() => document.activeElement?.closest?.("[data-text]")?.dataset.text), id);
  await away();
  eq("6: そのあと離れたら消える（6.11.1 のまま）", (await saved()).texts.some((x) => x.id === id), false);
}

// 7) グリッド配置では、決めた幅を目盛りに合わせる
await open({ gridMode: true });
await pullHandle("t2", 100);
eq("7: グリッド配置: 幅は 26 の倍数", (await textOf("t2")).w % 26, 0);

console.log(ng ? `text-size: ${ng} 件 期待と違います` : "text-size: すべて期待どおりです");
await browser.close();
process.exit(ng ? 1 : 0);
