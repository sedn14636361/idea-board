// 選んだ付箋のタイトルをまとめて変える・番号を付ける（6.23.0。src/series.js）
//   番号はタイトル欄の右端のチップ（1/5・分母なしなら 1）。読む順（行ごとに左→右、行は上→下）で数える
//   ＋→ で組に入る・同じタイトルで一括変更すると組に入る・剥がすと詰まる・動かすと振り直す（ユーザーが選択）
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
pg.on("pageerror", (e) => { console.log("  pageerror:", e.message); ng++; });

// 試験データ（260×182。描くと高さ 198 なので、行の判定は先頭の高さの半分 99）:
//   上の行 C(100,60) B(400,40) A(700,80)、下の行 E(120,340) D(420,320)。選ばない X(100,700)
const note = (id, num, text, x, y, extra = {}) => ({ id, num, text, x, y, w: 260, h: 182, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 5, z: num, ...extra });
const A = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 7,
  notes: [note("A", 1, "あ", 700, 80), note("B", 2, "い", 400, 40), note("C", 3, "う", 100, 60), note("D", 4, "え", 420, 320), note("E", 5, "お", 120, 340), note("X", 6, "選ばない", 100, 700)],
  edges: [], texts: [], zones: [], strokes: [], images: [] }] };
await pg.goto(BASE);
await pg.evaluate((A) => {
  localStorage.clear();
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA" }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
}, A);
await pg.reload(); await pg.waitForTimeout(1500);

const saved = async () => { await pg.waitForTimeout(1300); return pg.evaluate(() => JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0]); };
const origin = () => pg.evaluate(() => { const r = document.querySelector("[data-origin]").getBoundingClientRect(); return { x: r.left, y: r.top }; });
const dragSelect = async (x1, y1, x2, y2) => {
  const o = await origin();
  await pg.mouse.move(o.x + x1, o.y + y1); await pg.mouse.down();
  await pg.mouse.move(o.x + x2, o.y + y2, { steps: 8 }); await pg.mouse.up();
  await pg.waitForTimeout(300);
};
const clickEmpty = async () => { const o = await origin(); await pg.mouse.click(o.x + 1300, o.y + 40); await pg.waitForTimeout(150); };
// 付箋ごとのチップ（無ければ ""）
const chips = () => pg.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-note]")].map((el) => {
  const c = el.querySelector(":scope > div > [data-seqchip]");
  return [el.dataset.note, c ? c.textContent : ""];
})));
const drag = async (id, dx, dy) => {
  const g = await pg.evaluate((id) => {
    const row = document.querySelector(`[data-note="${id}"]`).firstElementChild;
    const sp = [...row.children].find((c) => c.style.flex.startsWith("1"));
    const r = sp.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);
  await pg.mouse.move(g.x, g.y); await pg.mouse.down();
  await pg.mouse.move(g.x + dx, g.y + dy, { steps: 6 }); await pg.mouse.up();
  await pg.waitForTimeout(300);
};

// 1) 5枚を範囲選択 →「T タイトル」→「序」・番号（既定で分母あり）→ 入れる
await dragSelect(60, 20, 1000, 560);
eq("前提: 5枚を選んだ", await pg.getByText(/個選択中$/).textContent(), "5個選択中");
await pg.locator("[data-seltitlebtn]").click();
await pg.locator("[data-bulktitle]").fill("序");
eq("見本が出る", await pg.locator("[data-bulksample]").textContent(), "序 1/5、序 2/5 …");
await pg.locator("[data-bulkapply]").click();
let b = await saved();
eq("5枚のタイトルが「序」・タイトル欄を出す", b.notes.filter((n) => n.id !== "X").map((n) => [n.title, n.useTitle]), Array(5).fill(["序", true]));
eq("選ばない付箋は変わらない", [b.notes.find((n) => n.id === "X").title, !!b.notes.find((n) => n.id === "X").seq], ["", false]);
eq("タイトル欄の右端に読む順の番号（C B A / E D）", await chips(), { A: "3/5", B: "2/5", C: "1/5", D: "5/5", E: "4/5", X: "" });
eq("タイトルの文章には番号を入れない", b.notes.find((n) => n.id === "A").title, "序");

// 2) Ctrl+Z 1回で一括変更の前に戻る・やり直せる
await clickEmpty();
await pg.keyboard.press("Control+z");
b = await saved();
eq("Ctrl+Z で戻る（タイトル・番号）", [b.notes.every((n) => !n.title && !n.seq), await chips()], [true, { A: "", B: "", C: "", D: "", E: "", X: "" }]);
await pg.keyboard.press("Control+Shift+z");
await saved();
eq("やり直すと番号も戻る", await chips(), { A: "3/5", B: "2/5", C: "1/5", D: "5/5", E: "4/5", X: "" });

// 3) 動かしたら振り直す: A を下の行の右へ
await drag("A", 0, 300);
eq("A を下の行の右へ → A は 5/5、D は 4/5", await chips(), { A: "5/5", B: "2/5", C: "1/5", D: "4/5", E: "3/5", X: "" });

// 4) 「＋→」で作った付箋は同じ組に入る（B の右 → 上の行の3番目）
await pg.locator('[data-note="B"] [data-sidenote]').first().click();
await pg.waitForTimeout(300);
await clickEmpty();
b = await saved();
const F = b.notes.find((n) => !["A", "B", "C", "D", "E", "X"].includes(n.id));
eq("新しい付箋もタイトル「序」", [F.title, F.useTitle], ["序", true]);
let c = await chips();
eq("新しい付箋は 3/6、全体が /6", [c[F.id], c.C, c.B, c.E, c.D, c.A], ["3/6", "1/6", "2/6", "4/6", "5/6", "6/6"]);

// 5) 剥がしたら詰める（B）
await pg.locator('[data-note="B"] button[title="剥がす（中身も一緒）"]').first().click();
const conf = pg.getByRole("button", { name: "剥がす", exact: true });
if (await conf.count()) await conf.click();
await pg.waitForTimeout(300);
c = await chips();
eq("B を剥がすと詰まる", [c.C, c[F.id], c.E, c.D, c.A], ["1/5", "2/5", "3/5", "4/5", "5/5"]);

// 6) チップのメニュー: 分母を隠す（組の全員）・この付箋の番号を外す
await pg.locator('[data-note="C"] [data-seqchip]').click();
await pg.locator('[data-seqitem="den"]').click();
await pg.waitForTimeout(200);
c = await chips();
eq("分母を隠す → 組の全員が数字だけ", [c.C, c[F.id], c.E, c.D, c.A], ["1", "2", "3", "4", "5"]);
await pg.locator('[data-note="C"] [data-seqchip]').click();
await pg.locator('[data-seqitem="leave"]').click();
await pg.waitForTimeout(200);
c = await chips();
eq("C の番号を外す → C はチップなし、残りが詰まる", [c.C, c[F.id], c.E, c.D, c.A], ["", "1", "2", "3", "4"]);
eq("番号を外してもタイトルは残る", (await saved()).notes.find((n) => n.id === "C").title, "序");

// 7) 付箋リスト（☰）から: X を「序」・番号 → 同じタイトルの組の続きに入る（分母なしの組に合わせ、分母を出すにすると全員に出る）
await pg.locator("button", { hasText: "☰" }).first().click();
await pg.waitForTimeout(500);
const row = pg.locator("div", { has: pg.locator('input[type="checkbox"]') }).filter({ hasText: "選ばない" }).last();
await row.locator('input[type="checkbox"]').first().check();
await pg.locator("[data-listtitlebtn]").click();
await pg.locator("[data-listtitle] [data-bulktitle]").fill("序");
eq("組の分母の出し方（なし）を初めの値にしない（X は組の外）", await pg.locator("[data-listtitle] [data-bulkden]").isChecked(), true);
await pg.locator("[data-listtitle] [data-bulkapply]").click();
await pg.waitForTimeout(300);
c = await chips();
eq("X は一番下なので 5/5（組の全員に分母が出る）", [c[F.id], c.E, c.D, c.A, c.X], ["1/5", "2/5", "3/5", "4/5", "5/5"]);
eq("付箋リストの行にも「序 5/5」", (await pg.locator("div", { has: pg.locator('input[type="checkbox"]') }).filter({ hasText: "選ばない" }).last().textContent()).includes("序 5/5"), true);
await pg.locator("button", { hasText: "☰" }).first().click();

// 8) 番号なしで一括変更すると組から外れる
await dragSelect(60, 640, 400, 880);
await pg.locator("[data-seltitlebtn]").click();
await pg.locator("[data-bulknumber]").uncheck();
eq("番号なしの見本", await pg.locator("[data-bulksample]").textContent(), "序");
await pg.locator("[data-bulkapply]").click();
await pg.waitForTimeout(200);
eq("X のチップが消える", (await chips()).X, "");

// 9) 開き直しても番号は同じ
await saved(); // 自動保存（0.8秒）を待つ
await pg.reload(); await pg.waitForTimeout(1500);
c = await chips();
eq("開き直しても同じ", [c[F.id], c.E, c.D, c.A, c.X], ["1/4", "2/4", "3/4", "4/4", ""]);

console.log(ng === 0 ? "\nbulk-title: すべて期待どおりです" : `\nbulk-title: ${ng} 件 期待と違います`);
await browser.close();
process.exit(ng ? 1 : 0);
