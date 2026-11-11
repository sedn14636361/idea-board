// 付箋の操作列: 一番右のボタンが付箋からはみ出すなら、番号と色の丸以外のボタンを全部「⋯」にしまう（6.11.0）
//   どの幅でもボタンが付箋の外に出ない／入りきる幅では「⋯」を出さない／メニューには名前が出る／
//   メニューから タイトル欄・開閉・右に付箋・線でつなぐ・複製・剥がす が今までのボタンと同じに動く／
//   大きさを変えると出し入れが切り替わる／しまっても行の高さ（本文の位置）は変わらない
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
pg.on("pageerror", (e) => console.log("  pageerror:", e.message));

const note = (id, num, x, y, w, extra = {}) => ({ id, num, text: id, x, y, w, h: 170, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 0, z: num, ...extra });
const A = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 8,
  notes: [
    note("w120", 1, 100, 100, 120),
    note("w150", 2, 300, 100, 150),
    note("w190", 3, 520, 100, 190),
    note("w260", 4, 780, 100, 260),
    note("P", 5, 1100, 100, 190, { expanded: true }),
    note("K", 6, 10, 10, 120, { parentId: "P" }),       // 開いた P の中の、幅 120 の付箋
    note("T", 7, 100, 450, 190),                         // 線でつなぐ先
  ],
  edges: [], texts: [], zones: [], strokes: [], images: [] }] };
await pg.goto(BASE);
await pg.evaluate((A) => {
  localStorage.clear();
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA" }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
}, A);
await pg.reload(); await pg.waitForTimeout(1500);

const saved = async () => { await pg.waitForTimeout(1200); return pg.evaluate(() => JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0]); };
const N = (id) => pg.locator(`[data-note="${id}"]`);
const more = (id) => N(id).locator(':scope > div:first-child button[title="ほかの操作"]');
// 付箋の操作列（外枠の最初の子）にあるボタンが、すべて付箋の枠の中に収まっているか
const inside = (id) => pg.evaluate((id) => {
  const el = document.querySelector(`[data-note="${id}"]`), r = el.getBoundingClientRect();
  return [...el.firstElementChild.querySelectorAll(":scope > span button, :scope > button")]
    .every((b) => { const q = b.getBoundingClientRect(); return q.left >= r.left - 0.5 && q.right <= r.right + 0.5; });
}, id);
const rowH = (id) => pg.evaluate((id) => document.querySelector(`[data-note="${id}"]`).firstElementChild.getBoundingClientRect().height, id);
// 項目は「アイコン名:名前」（6.20.0 からアイコンは線画の svg。data-icon で確かめる）
const items = () => pg.locator("[data-toolitem]").evaluateAll((els) => els.map((e) => (e.querySelector("[data-icon]")?.dataset.icon || "") + ":" + e.textContent));

// 1) 幅ごとの出し入れ
for (const id of ["w120", "w150", "w190", "w260", "P", "K"]) eq(`${id}: ボタンが付箋の枠の外に出ていない`, await inside(id), true);
eq("幅 120・150・190・中の付箋（120）は「⋯」にしまう", [await more("w120").count(), await more("w150").count(), await more("w190").count(), await more("K").count()], [1, 1, 1, 1]);
eq("標準の幅 260・開いた付箋は「⋯」を出さない", [await more("w260").count(), await more("P").count()], [0, 0]);
eq("しまったときは ✕ などのボタンを操作列に出さない", await N("w120").locator(':scope > div:first-child button[title="剥がす（中身も一緒）"]').count(), 0);
eq("しまっても行の高さは同じ（本文の位置が変わらない）", await rowH("w120"), await rowH("w260"));

// 2) メニューの中身（名前つき）
await more("w120").click();
eq("メニューには名前が出る", await items(), ["title:タイトル欄を使う", "open:中のボードを開く", "side:右に付箋を作る", "copy:複製・コピー", "link:線でつなぐ", "remove:剥がす"]);
await pg.mouse.click(1500, 800);
eq("外を押すとメニューが閉じる", await pg.locator("[data-toolitem]").count(), 0);

// 3) メニューから操作する
await more("w120").click();
await pg.locator('[data-toolitem="title"]').click();
eq("タイトル欄を使う: タイトル欄が出て、メニューは閉じる", [await N("w120").locator('input[placeholder="タイトル"]').count(), await pg.locator("[data-toolitem]").count()], [1, 0]);
await more("w120").click();
eq("タイトル欄を使っているときは「やめる」になる", (await items())[0], "title:タイトル欄をやめる");
await pg.locator('[data-toolitem="nest"]').click();
eq("中のボードを開く: 開いて広くなり、ボタンが操作列に戻る", [(await saved()).notes.find((n) => n.id === "w120").expanded, await more("w120").count(), await inside("w120")], [true, 0, true]);
await N("w120").locator('button[title="中のボードをしまう"]').first().click();
eq("しまうと、また「⋯」になる", [(await saved()).notes.find((n) => n.id === "w120").expanded, await more("w120").count()], [false, 1]);

const before = await saved();
await more("w150").click();
await pg.locator('[data-toolitem="side"]').click();
{
  const b = await saved();
  eq("右に付箋を作る: 1枚増え、元の付箋から線が引かれる", [b.notes.length - before.notes.length, b.edges.filter((e) => e.from === "w150").length], [1, 1]);
}
await pg.mouse.click(1500, 800);

await more("w120").click();
await pg.locator('[data-toolitem="link"]').click();
await N("T").getByText("#7", { exact: true }).click();
eq("線でつなぐ: 押した先の付箋と線でつながる", (await saved()).edges.some((e) => (e.from === "w120" && e.to === "T") || (e.from === "T" && e.to === "w120")), true);

await more("w120").click();
await pg.locator('[data-toolitem="copy"]').click();
eq("複製・コピー: 今までの ⧉ のメニューが開く", await N("w120").getByText("⧉ このボードに複製").count(), 1);
const n1 = (await saved()).notes.length;
await N("w120").getByText("⧉ このボードに複製").click();
eq("このボードに複製: 1枚増える（複製は24ずれて重なるので最後に）", (await saved()).notes.length - n1, 1);
await pg.mouse.click(1500, 800);

await more("K").click();
eq("中の付箋のメニュー", await items(), ["title:タイトル欄を使う", "open:中のボードを開く", "side:右に付箋を作る", "copy:複製・コピー", "link:線でつなぐ", "remove:剥がす"]);
await pg.locator('[data-toolitem="remove"]').click();
eq("剥がす: 中の付箋が剥がれる（✕ と同じく確認は出ない）", (await saved()).notes.some((n) => n.id === "K"), false);

// 4) 大きさを変えると切り替わる
const handle = N("w150").locator(':scope > [title="ドラッグで大きさを変える"]');
{
  const b = await handle.boundingBox();
  await pg.mouse.move(b.x + 9, b.y + 9); await pg.mouse.down();
  await pg.mouse.move(b.x + 109, b.y + 9, { steps: 6 }); await pg.mouse.up();
  await pg.waitForTimeout(200);
  eq("幅 150 → 250 に広げると、ボタンが操作列に戻る", [await more("w150").count(), await inside("w150")], [0, true]);
  const c = await handle.boundingBox();
  await pg.mouse.move(c.x + 9, c.y + 9); await pg.mouse.down();
  await pg.mouse.move(c.x - 121, c.y + 9, { steps: 6 }); await pg.mouse.up();
  await pg.waitForTimeout(200);
  eq("いちばん狭く（120）すると、また「⋯」になる", [await more("w150").count(), await inside("w150")], [1, true]);
}

console.log(ng ? `tool-menu: ${ng} 件 期待と違います` : "tool-menu: すべて期待どおりです");
await browser.close();
process.exit(ng ? 1 : 0);
