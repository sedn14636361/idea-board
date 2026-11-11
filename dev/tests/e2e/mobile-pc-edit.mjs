// スマホ版: 「ボード上の付箋」のパソコンのボードの付箋を直す（6.21.0）
//   ① 「＋ アイデアボックスに入れる」（直すときは 保存／やめる）は、送り先と「色・タグ・まとめ先を戻す」の間
//   ② 開いた行の「直す」→ 書く欄で直して保存 → サーバー上のそのボードだけ書き換わる（ほかは1文字も変わらない）→
//      パソコンは開き直さずに1分以内に読み込む／パソコンで同じころに直していたら尋ねる／パソコンで先に直されていたら知らせる／
//      剥がされていたら知らせる／電波が無ければ知らせて書いた内容を残す
//   ③ タイトルが無い付箋は、見出しを出さず本文をそのまま出す。直すときのタイトル欄は空
import { device, eq, done, F, net, banner } from "./harness.mjs";
const BASE = process.env.BASE;
const MOBILE = BASE.replace(/index\.html$/, "mobile.html");
globalThis.fetch = F.fetch;                                   // サーバーを直接いじる場面（剥がされていた）のため
const C = await import(new URL("../../src/cloud.js", import.meta.url).href);
const CONF = { projectId: "p", apiKey: "k", room: "r" };

// --- 試験データ: 物語A（本編: タイトルあり #1・タイトルなし #2（スマホの一覧に無いタグ「自由タグ」）・中に #4 を持つ #3・#1→#2 の線・
//     画像（かけらが2つ以上になる大きさ）・文字・領域 ／ 設定メモ: #1）---
const N = (id, num, x, y, extra = {}) => ({ id, num, text: id + "の本文", x, y, w: 260, h: 182, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 5, z: num, ...extra });
const PROJECT = { id: "PA", name: "物語A", currentBoardId: "b1", boards: [
  { id: "b1", title: "本編", nextNum: 5,
    notes: [N("n1", 1, 40, 80, { title: "起", useTitle: true, text: "はじまりの場面", color: 0 }), N("n2", 2, 360, 80, { tags: ["メイン", "自由タグ"], text: "山場の案\n二行目" }),
      N("n3", 3, 680, 80, { expanded: true, text: "人物" }), N("k4", 4, 10, 10, { parentId: "n3", text: "主人公の過去" })],
    edges: [{ from: "n1", to: "n2", memo: "つなぎ" }], texts: [{ id: "t1", x: 40, y: 560, text: "見出しの文字", size: 1 }],
    zones: [{ id: "z1", x: 20, y: 40, w: 600, h: 300, label: "第1章", color: "#E8D96A" }], strokes: [],
    images: [{ id: "i1", x: 40, y: 640, w: 120, h: 80, src: "data:image/png;base64," + "A".repeat(900000) }] },
  { id: "b2", title: "設定メモ", nextNum: 2, notes: [N("m1", 1, 50, 80, { text: "世界観のメモ" })], edges: [], texts: [], zones: [], strokes: [], images: [] },
] };
const P = await device("P", { base: BASE });
await P.setViewportSize({ width: 1400, height: 900 });
await P.evaluate((p) => {
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: p.id, name: p.name }], currentProjectId: p.id }));
  localStorage.setItem("idea-board-project:" + p.id, JSON.stringify(p));
}, PROJECT);
await P.reload();
for (let i = 0; i < 40 && !F.DB.has("PA"); i++) await P.waitForTimeout(500);
const meta = () => JSON.parse(F.DB.get("PA").fields.meta.stringValue);
eq("前提: サーバーに上がり、本編はかけら2つ以上", meta().boards.map((b) => [b.id, b.parts >= 2]), [["b1", true], ["b2", false]]);
const server = async () => (await C.projectPullSplit(CONF, "PA")).project;
const pcNote = (id) => P.evaluate((id) => {
  const raw = localStorage.getItem("idea-board-project:PA");
  return JSON.parse(raw).boards[0].notes.find((n) => n.id === id) || null;
}, id);

// --- スマホ: 送り先を「物語A」にして、ボード上の付箋 → パソコンのボード ---
const M = await device("M", { base: MOBILE });
await M.setViewportSize({ width: 390, height: 760 });
await M.locator("[data-peek-toggle]").click();
await M.locator('[data-peek-src="pc"]').click();
await M.getByRole("button", { name: "送り先のプロジェクトを選ぶ" }).click();
await M.getByText("物語A", { exact: true }).last().click();
await M.waitForTimeout(1500);
const row = (num) => M.locator("[data-peek-row]").filter({ has: M.getByText(`#${num}`, { exact: true }) }).first();

// ① ボタンの位置
{
  const y = async (loc) => (await loc.boundingBox()).y;
  const target = M.getByText("送り先", { exact: true }).first();
  const add = M.locator("[data-add]");
  const reset = M.getByRole("button", { name: "色・タグ・まとめ先を戻す" });
  eq("①: 「＋ アイデアボックスに入れる」は送り先と「色・タグ・まとめ先を戻す」の間", [await add.innerText(), (await y(target)) < (await y(add)), (await y(add)) < (await y(reset))], ["＋ アイデアボックスに入れる", true, true]);
  eq("①: 画面の下に浮かせていない（ほかの欄と一緒に動く）", await add.evaluate((el) => getComputedStyle(el.parentElement).position), "static");
}

// ③ タイトルが無い付箋は見出しを出さない
eq("③: タイトルのある #1 は見出し（太字）が出る", await row(1).locator("[data-peek-title]").innerText(), "起");
eq("③: タイトルの無い #2 は見出しを出さず、本文をそのまま出す", [await row(2).locator("[data-peek-title]").count(), (await row(2).locator("[data-peek-body]").first().innerText()).trim()], [0, "山場の案 二行目"]);

// ② 直す
const before = await server();
await row(2).click();
eq("②: 開いた行に「直す」が出る", await row(2).locator("[data-peek-edit]").count(), 1);
eq("②: 閉じた行には出ない", await row(1).locator("[data-peek-edit]").count(), 0);
await row(2).locator("[data-peek-edit]").click();
await M.waitForTimeout(300);
const titleBox = M.locator('input[placeholder="タイトル"]');
eq("③: タイトルの無い付箋を直すとき、タイトル欄は空（1行目を入れない）", [await M.locator('input[type="checkbox"]').first().isChecked(), await titleBox.count()], [false, 0]);
eq("②: 書く欄に本文が入る", await M.locator("textarea").first().inputValue(), "山場の案\n二行目");
eq("②: 一覧に無いタグ（パソコンで付けた）も出て、消えない", await M.locator("[data-extra-tags] button").allInnerTexts(), ["自由タグ ✕"]);
eq("②: 直している間は、まとめ先・送り先・つなげる「＋」は出さない",
  [await M.getByText("まとめ先（PCで囲みになります）").count(), await M.getByText("送り先", { exact: true }).count(), await M.locator("[data-thread-add]").count()], [0, 0, 0]);
eq("②: ボタンは「やめる」「保存」", await M.locator("[data-add-row] button").allInnerTexts(), ["やめる", "保存"]);
// 直す: タイトルを付ける・本文・色（そら）・タグ「伏線1」を足す
await M.locator('input[type="checkbox"]').first().check();
await M.locator('input[placeholder="タイトル"]').fill("山場");
await M.locator("textarea").first().fill("山場の案（スマホで直した）");
await M.locator('[data-color="2"]').click();
await M.getByRole("button", { name: "伏線1", exact: true }).click();
const utBefore = F.DB.get("PA").updateTime;
const b2Doc = `__b_PA_b2_${meta().boards[1].v}_0`, b2Ut = F.DB.get(b2Doc).updateTime;
await M.locator("[data-add]").click();
await M.waitForTimeout(1200);
eq("②: 保存すると直すのが終わり、書く欄に戻る（書きかけは戻る）", [await M.locator("[data-add]").innerText(), await M.locator("textarea").first().inputValue()], ["＋ アイデアボックスに入れる", ""]);
const after = await server();
const n2a = after.boards[0].notes.find((n) => n.id === "n2"), n2b = before.boards[0].notes.find((n) => n.id === "n2");
eq("②: サーバーの #2 の直した項目", [n2a.title, n2a.useTitle, n2a.text, n2a.color, n2a.tags], ["山場", true, "山場の案（スマホで直した）", 2, ["メイン", "自由タグ", "伏線1"]]);
eq("②: #2 の直していない項目（位置・大きさ・番号など）は同じ",
  JSON.stringify({ ...n2a, title: 0, useTitle: 0, text: 0, color: 0, tags: 0 }), JSON.stringify({ ...n2b, title: 0, useTitle: 0, text: 0, color: 0, tags: 0 }));
eq("②: ほかの付箋・線・文字・領域・画像は1文字も変わらない",
  JSON.stringify({ ...after.boards[0], notes: after.boards[0].notes.filter((n) => n.id !== "n2") }), JSON.stringify({ ...before.boards[0], notes: before.boards[0].notes.filter((n) => n.id !== "n2") }));
eq("②: ほかのボードは書き直さない", [JSON.stringify(after.boards[1]) === JSON.stringify(before.boards[1]), F.DB.get(b2Doc)?.updateTime === b2Ut], [true, true]);
eq("②: 目次の更新時刻が変わった", F.DB.get("PA").updateTime !== utBefore, true);
eq("②: 一覧にもすぐ出る（太字の見出しが付いた）", await row(2).locator("[data-peek-title]").innerText(), "山場");

// パソコン: 開き直さずに、1分以内に読み込む
{
  const t0 = Date.now();
  let got = null;
  while (Date.now() - t0 < 65000) { got = await pcNote("n2"); if (got?.text === "山場の案（スマホで直した）") break; await P.waitForTimeout(2000); }
  eq("②: パソコンは開き直さずに1分以内に読み込む", [got?.text, got?.title, Date.now() - t0 < 65000], ["山場の案（スマホで直した）", "山場", true]);
  await P.waitForTimeout(800);
  eq("②: パソコンの画面にも出る", await P.locator('[data-note="n2"] textarea').first().inputValue(), "山場の案（スマホで直した）");
  eq("②: パソコンで線・画像・中の付箋はそのまま", await P.evaluate(() => { const b = JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0];
    return [b.edges.length, b.edges[0].memo, b.images[0].src.length, b.notes.find((n) => n.id === "k4").parentId]; }), [1, "つなぎ", "data:image/png;base64,".length + 900000, "n3"]);
}

// パソコンで先に直されていた: スマホが #1 を読んだあとにパソコンで直す → スマホの保存は書かずに知らせる → もう一度で上書き
{
  await row(1).click();
  await row(1).locator("[data-peek-edit]").click();
  eq("③: タイトルのある付箋はタイトル欄にタイトル", await M.locator('input[placeholder="タイトル"]').inputValue(), "起");
  const ta = P.locator('[data-note="n1"] textarea').first();
  await ta.click(); await ta.fill("パソコンで直したはじまり"); await ta.evaluate((el) => el.blur());
  for (let i = 0; i < 20 && (await server()).boards[0].notes[0].text !== "パソコンで直したはじまり"; i++) await P.waitForTimeout(500);
  eq("前提: パソコンの直しがサーバーに上がった", (await server()).boards[0].notes[0].text, "パソコンで直したはじまり");
  await M.locator("textarea").first().fill("スマホで直したはじまり");
  await M.locator("[data-add]").click();
  await M.waitForTimeout(1200);
  eq("②: 黙って上書きせず知らせる", [await M.locator("[data-pc-msg]").innerText(), (await server()).boards[0].notes[0].text],
    ["パソコンで変更されていました。もう一度「保存」すると、この内容で上書きします", "パソコンで直したはじまり"]);
  eq("②: 書いた内容は残っている", await M.locator("textarea").first().inputValue(), "スマホで直したはじまり");
  await M.locator("[data-add]").click();
  await M.waitForTimeout(1200);
  eq("②: もう一度保存すると上書きする", (await server()).boards[0].notes[0].text, "スマホで直したはじまり");
}

// 電波が無い: 知らせて、書いた内容を残す → つながってから保存できる
{
  await row(4).click();
  await row(4).locator("[data-peek-edit]").click();
  await M.locator("textarea").first().fill("電波の無い所で直した過去");
  net.offline.add("M");
  await M.locator("[data-add]").click();
  await M.waitForTimeout(1500);
  eq("②: 電波が無いと知らせる", await M.locator("[data-pc-msg]").innerText(), "保存できませんでした。電波のある所で、もう一度「保存」してください");
  eq("②: 書いた内容と直している状態は残る", [await M.locator("textarea").first().inputValue(), await M.locator("[data-add]").innerText()], ["電波の無い所で直した過去", "保存"]);
  net.offline.delete("M");
  await M.locator("[data-add]").click();
  await M.waitForTimeout(1200);
  eq("②: つながってから保存できる（中の付箋）", (await server()).boards[0].notes.find((n) => n.id === "k4")?.text, "電波の無い所で直した過去");
}

// 剥がされていた: スマホが読んだあとにサーバーから #4 が無くなる
{
  await row(3).click();
  await row(3).locator("[data-peek-edit]").click();
  const cur = await C.projectPullSplit(CONF, "PA");
  const proj = cur.project;
  proj.boards[0] = { ...proj.boards[0], notes: proj.boards[0].notes.filter((n) => n.id !== "n3" && n.id !== "k4") };
  const w = await C.projectPushSplit(CONF, proj, "パソコン", cur.hashes, { updateTime: cur.updateTime });
  eq("前提: パソコンで #3 を剥がした版がサーバーに上がった", w.ok, true);
  await M.locator("textarea").first().fill("剥がされた付箋を直す");
  await M.locator("[data-add]").click();
  await M.waitForTimeout(1200);
  eq("②: 剥がされていたと知らせ、書かない", [await M.locator("[data-pc-msg]").innerText(), (await server()).boards[0].notes.some((n) => n.id === "n3")], ["この付箋はパソコンで剥がされています", false]);
  await M.getByRole("button", { name: "やめる" }).click();
  eq("②: やめると知らせも消える", await M.locator("[data-pc-msg]").count(), 0);
}

// パソコンで同じころに直していた（パソコンが送る前にスマホが保存した）→ パソコンで尋ねる
{
  await P.waitForTimeout(65000);                     // パソコンが上の変更（剥がした版）を読み込むのを待つ
  net.offline.add("P");                               // パソコンの直しをまだ送れない状態にする
  const t2 = P.locator('[data-note="n2"] textarea').first();
  await t2.click(); await t2.fill("パソコンでも直した山場"); await t2.evaluate((el) => el.blur());
  await M.locator('[data-peek-reload]').click();
  await M.waitForTimeout(1500);
  await row(1).click();
  await row(1).locator("[data-peek-edit]").click();
  await M.locator("textarea").first().fill("同じころにスマホで直したはじまり");
  await M.locator("[data-add]").click();
  await M.waitForTimeout(1500);
  eq("前提: スマホの直しはサーバーに入った", (await server()).boards[0].notes[0].text, "同じころにスマホで直したはじまり");
  net.offline.delete("P");
  let asked = false;
  for (let i = 0; i < 40 && !asked; i++) { asked = await banner(P); if (!asked) await P.waitForTimeout(2000); }
  eq("②: パソコンは黙って上書きも読み込みもせず、「両方で変更されています」と尋ねる", asked, true);
  eq("②: 尋ねている間、パソコンの直しは手元に残り、サーバーにはスマホの直しが残る",
    [(await pcNote("n2"))?.text, (await server()).boards[0].notes[0].text], ["パソコンでも直した山場", "同じころにスマホで直したはじまり"]);
}

// 直すのは送り先が今のプロジェクトのときだけ。ふだんの「入れる」は今までどおり動く
{
  await M.locator("textarea").first().fill("ふだんのメモ");
  await M.locator("[data-add]").click();
  await M.waitForTimeout(800);
  eq("①: ふだんの「＋ アイデアボックスに入れる」は今までどおり", await M.evaluate(() => JSON.parse(localStorage.getItem("idea-board-inbox") || "[]").map((i) => i.text).slice(-1)), ["ふだんのメモ"]);
}

await done("パソコンの付箋を直す（スマホ）");
