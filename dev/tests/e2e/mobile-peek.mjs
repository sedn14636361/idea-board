// スマホ版: 書く欄の下の「今ある付箋」（6.16.0）。このスマホの「ためた分」と、パソコンのボードの付箋を見ながら書ける
//   はじめは閉じている／開け閉めできて覚えている／書く欄が同時に見える／入れると一覧が増える／
//   パソコンのボード: 番号・領域・字下げ・ボードの切り替え・検索・全文／見ているボードだけ読む／
//   電波なしでは前に読んだ内容／クラウド未設定では「このスマホ」だけ
import { device, eq, done, F, net, browser } from "./harness.mjs";
const BASE = process.env.BASE;
const MOBILE = BASE.replace(/index\.html$/, "mobile.html");

// --- パソコン: プロジェクト「物語A」（本編: 領域「第1章」の中の #1・タグ付きの #2・中に #4 を持つ #3 ／ 設定メモ: #1）---
const N = (id, num, x, y, extra = {}) => ({ id, num, text: id + "の本文", x, y, w: 190, h: 170, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 0, z: num, ...extra });
const PROJECT = { id: "PA", name: "物語A", currentBoardId: "b1", boards: [
  { id: "b1", title: "本編", nextNum: 5,
    notes: [N("n1", 1, 50, 80, { title: "起", useTitle: true, text: "はじまりの場面\n主人公が旅に出る" }), N("n2", 2, 500, 80, { tags: ["メイン", "重要度高"], color: 1, text: "山場の案" }),
      N("n3", 3, 900, 80, { expanded: true, color: 2, text: "人物" }), N("k4", 4, 10, 10, { parentId: "n3", text: "主人公の過去" })],
    edges: [], texts: [], zones: [{ id: "z1", x: 20, y: 30, w: 300, h: 300, label: "第1章", color: "#E8D96A" }], strokes: [], images: [] },
  { id: "b2", title: "設定メモ", nextNum: 2, notes: [N("m1", 1, 50, 80, { text: "世界観のメモ" })], edges: [], texts: [], zones: [], strokes: [], images: [] },
] };
const P = await device("P", { base: BASE });
await P.evaluate((p) => {
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: p.id, name: p.name }], currentProjectId: p.id }));
  localStorage.setItem("idea-board-project:" + p.id, JSON.stringify(p));
}, PROJECT);
await P.reload();
for (let i = 0; i < 40 && !F.DB.has("PA"); i++) await P.waitForTimeout(500);
eq("前提: パソコンのプロジェクトがサーバーに上がった", F.DB.has("PA"), true);
eq("前提: 目次にボード名が入っている", JSON.parse(F.DB.get("PA").fields.meta.stringValue).boards.map((b) => b.t), ["本編", "設定メモ"]);

// --- スマホ ---
const M = await device("M", { base: MOBILE });
await M.setViewportSize({ width: 390, height: 760 });
const gets = [];   // スマホがサーバーから読んだ文書
M.on("request", (r) => { const m = r.method() === "GET" && r.url().match(/\/documents\/projects\/[^/]+\/items\/([^?]+)/); if (m) gets.push(decodeURIComponent(m[1])); });
const write = async (text) => {
  await M.locator("textarea").first().fill(text);
  await M.getByRole("button", { name: "＋ アイデアボックスに入れる" }).click();
  await M.waitForTimeout(500);
};
const toggle = M.locator("[data-peek-toggle]");
const list = M.locator("[data-peek-list]");
// 行に出ている文字（番号・見出し・本文の冒頭・領域・タグを「 / 」でつなぐ）
const rows = () => M.locator("[data-peek-row]").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s*\n\s*/g, " / ")));
const indent = () => M.locator("[data-peek-row]").evaluateAll((els) => els.map((e) => parseInt(e.style.marginLeft) || 0));

for (const t of ["一つめのメモ", "二つめのメモ", "三つめのメモ"]) await write(t);

// 1) はじめは閉じている。開くと「このスマホ」の3件。書く欄も同時に見えている
eq("1: はじめは閉じている", [await toggle.count(), await list.count()], [1, 0]);
await toggle.click();
eq("1: 開くと、このスマホの3件が新しい順に出る", await rows(), ["三つめのメモ", "二つめのメモ", "一つめのメモ"]);
{
  const ta = await M.locator("textarea").first().boundingBox(), li = await list.boundingBox();
  eq("1: 書く欄と一覧が同時に画面の中にある（書く欄が上）", [ta.y >= 0, ta.y + ta.height <= li.y, li.y < 760], [true, true, true]);
}
// 2) 開いたまま書いて入れると、一覧が増える
await write("四つめのメモ");
eq("2: 開いたまま入れると一覧の先頭に増える", (await rows())[0], "四つめのメモ");
eq("2: 件数の表示", await M.locator('[data-peek-src="local"]').innerText(), "このスマホ (4)");

// 3) パソコンのボード: 送り先が無ければ選ばせる → 選ぶと読む
gets.length = 0;
await M.locator('[data-peek-src="pc"]').click();
eq("3: 送り先が無ければ、選ぶボタンが出る（まだ何も読まない）", [await M.getByRole("button", { name: "送り先のプロジェクトを選ぶ" }).count(), gets.filter((g) => g.startsWith("__b_")).length], [1, 0]);
await M.getByRole("button", { name: "送り先のプロジェクトを選ぶ" }).click();
await M.getByText("物語A", { exact: true }).last().click();
await M.waitForTimeout(1500);
eq("3: パソコンで開いていたボード（本編）の付箋が、番号の順に出る",
  await rows(), ["#1 / 起 / はじまりの場面 主人公が旅に出る / ▢ 第1章", "#2 / 山場の案 / メイン / 重要度高", "#3 / 人物", "#4 / 主人公の過去"]);
eq("3: 中の付箋は字下げ", await indent(), [0, 0, 0, 14]);
eq("3: ボードの名前が出る", await M.locator("[data-peek-board]").allInnerTexts(), ["本編", "設定メモ"]);
eq("3: 読んだのは目次と「本編」のかけらだけ（設定メモは読まない）", [gets.some((g) => g.includes("_b1_")), gets.some((g) => g.includes("_b2_"))], [true, false]);

// 4) 押すと全文が開く・検索
await M.locator('[data-peek-row="n1"]').click();
eq("4: 押すと全文（改行もそのまま）", (await M.locator('[data-peek-row="n1"]').innerText()).includes("はじまりの場面\n主人公が旅に出る"), true);
await M.locator("[data-peek-search]").fill("重要度");
eq("4: タグで検索", await rows(), ["#2 / 山場の案 / メイン / 重要度高"]);
await M.locator("[data-peek-search]").fill("#4");
eq("4: 番号で検索", await rows(), ["#4 / 主人公の過去"]);
await M.locator("[data-peek-search]").fill("どこにも無い");
eq("4: 見つからないとき", [await rows(), await list.innerText()], [[], "見つかりません"]);
await M.locator("[data-peek-search]").fill("");

// 5) ボードを切り替える
gets.length = 0;
await M.locator('[data-peek-board="b2"]').click();
await M.waitForTimeout(1200);
eq("5: 設定メモに切り替えると、その付箋が出る", await rows(), ["#1 / 世界観のメモ"]);
eq("5: 読んだのは「設定メモ」だけ", [gets.some((g) => g.includes("_b2_")), gets.some((g) => g.includes("_b1_"))], [true, false]);

// 6) パソコンで足した付箋は「読み直す」で出る
await M.locator('[data-peek-board="b1"]').click();
await M.waitForTimeout(1200);
{
  // パソコンの画面で、ボードの空いているところをダブルクリックして付箋を足す
  await P.evaluate(() => localStorage.setItem("idea-board-index", JSON.stringify({ ...JSON.parse(localStorage.getItem("idea-board-index")), propMode: false })));
  await P.reload(); await P.waitForTimeout(2500);
  const o = await P.locator("[data-origin]").boundingBox();
  await P.mouse.dblclick(o.x + 400, o.y + 450);
  await P.keyboard.type("パソコンで足した付箋");
  const before = F.DB.get("PA").fields.meta.stringValue;
  for (let i = 0; i < 40 && F.DB.get("PA").fields.meta.stringValue === before; i++) await P.waitForTimeout(500);
  await P.waitForTimeout(500);
}
eq("6: 読み直す前は出ていない", (await rows()).some((r) => r.includes("パソコンで足した付箋")), false);
await M.locator("[data-peek-reload]").click();
await M.waitForTimeout(1500);
eq("6: 「読み直す」でパソコンで足した付箋が出る", (await rows()).some((r) => r.includes("#5 / パソコンで足した付箋")), true);

// 7) しまえる。開き直しても、開け閉めと見ていた側を覚えている
await toggle.click();
eq("7: しまえる", await list.count(), 0);
await M.reload(); await M.waitForTimeout(2000);
eq("7: 開き直しても閉じたまま", await list.count(), 0);
await toggle.click();
await M.waitForTimeout(1200);
eq("7: 開くと、前に見ていた「パソコンのボード」の本編", (await rows())[0], "#1 / 起 / はじまりの場面 主人公が旅に出る / ▢ 第1章");

// 8) 電波なしで開き直しても、前に読んだ内容が出る
net.offline.add("M");
await M.reload(); await M.waitForTimeout(2500);
eq("8: 電波なしでも、開いたまま・前に読んだ付箋が出る", (await rows()).length, 5);
eq("8: 読めなかったことを知らせる", await M.locator("[data-peek-status]").innerText(), "読み込めませんでした");
await M.locator("textarea").first().fill("電波なしで書く");
eq("8: 電波なしでも書く欄はそのまま使える", await M.locator("textarea").first().inputValue(), "電波なしで書く");
net.offline.delete("M");

// 9) クラウド未設定の端末では「このスマホ」だけ（切り替えを出さない）
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 760 } });
  const L = await ctx.newPage();
  await L.goto(MOBILE);
  await L.evaluate(() => localStorage.clear());
  await L.reload(); await L.waitForTimeout(1200);
  await L.locator("textarea").first().fill("クラウドなしのメモ");
  await L.getByRole("button", { name: "＋ アイデアボックスに入れる" }).click();
  await L.locator("[data-peek-toggle]").click();
  eq("9: クラウド未設定: 切り替えは出ず、このスマホの付箋だけ", [await L.locator("[data-peek-src]").count(), await L.locator("[data-peek-row]").allInnerTexts()], [0, ["クラウドなしのメモ"]]);
  await ctx.close();
}

await done("今ある付箋（スマホ）");
