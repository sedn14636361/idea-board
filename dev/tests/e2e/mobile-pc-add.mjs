// スマホ版: パソコンのボードの付箋を直すときに「＋」で付箋を足す（6.22.0）
//   ① 直している間も「＋」が出る。足した付箋は並びに出て、戻って直せる。直している元の付箋は外せない
//   ② 「保存」で、直した付箋と足した付箋を1回で書く。足した付箋は元の付箋の右へ（ぶつからない所）並び、線でつながる。
//      色・タグ・大きさは引き継ぐ。空の付箋は入らない。ほかの付箋・ほかのボードは変わらない。中の付箋に足すと同じ親の中
//   ③ 「やめる」と何も書かない。パソコンで先に直されていたら、足した付箋も書かない
//   ④ パソコンは画面に戻ったらすぐ読み込む（60秒待たない）
//   ⑤ 直す前のふだんの「つなげて書く」の下書きは、終わったら戻る
import { device, eq, done, F } from "./harness.mjs";
const BASE = process.env.BASE;
const MOBILE = BASE.replace(/index\.html$/, "mobile.html");
globalThis.fetch = F.fetch;
const C = await import(new URL("../../src/cloud.js", import.meta.url).href);
const CONF = { projectId: "p", apiKey: "k", room: "r" };

// --- 試験データ: 本編 #1（タイトルあり）・#2（タイトルなし・タグ「メイン」「自由タグ」・そら色）・すぐ右に #3（ぶつかる）・
//     開いた #4 の中に #5・#1→#2 の線・画像（かけら2つ以上）／設定メモ ---
const N = (id, num, x, y, extra = {}) => ({ id, num, text: id + "の本文", x, y, w: 260, h: 182, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 5, z: num, ...extra });
const PROJECT = { id: "PA", name: "物語A", currentBoardId: "b1", boards: [
  { id: "b1", title: "本編", nextNum: 6,
    notes: [N("n1", 1, 40, 80, { title: "起", useTitle: true, text: "はじまり", color: 0 }), N("n2", 2, 40, 360, { tags: ["メイン", "自由タグ"], text: "山場の案", color: 2 }),
      N("n3", 3, 324, 360, { text: "すぐ右の付箋" }), N("n4", 4, 700, 80, { expanded: true, text: "人物" }), N("k5", 5, 10, 10, { parentId: "n4", text: "主人公の過去", w: 160, h: 140, ew: 340, eh: 300 })],
    edges: [{ id: "e1", from: "n1", to: "n2" }], texts: [], zones: [], strokes: [],
    images: [{ id: "i1", x: 40, y: 700, w: 120, h: 80, src: "data:image/png;base64," + "A".repeat(900000) }] },
  { id: "b2", title: "設定メモ", nextNum: 2, notes: [N("m1", 1, 50, 80, { text: "世界観のメモ" })], edges: [], texts: [], zones: [], strokes: [], images: [] },
] };
const P = await device("P", { base: BASE });
await P.setViewportSize({ width: 1400, height: 900 });
const heads = [];   // パソコンが目次を確かめた時刻（定期の確認・画面に戻ったとき）
P.on("request", (r) => { if (r.method() === "GET" && r.url().includes("mask.fieldPaths=savedAt")) heads.push(Date.now()); });
await P.evaluate((p) => {
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: p.id, name: p.name }], currentProjectId: p.id }));
  localStorage.setItem("idea-board-project:" + p.id, JSON.stringify(p));
}, PROJECT);
await P.reload();
for (let i = 0; i < 40 && !F.DB.has("PA"); i++) await P.waitForTimeout(500);
const server = async () => (await C.projectPullSplit(CONF, "PA")).project;
const pcBoard = () => P.evaluate(() => JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0]);

// --- スマホ ---
const M = await device("M", { base: MOBILE });
await M.setViewportSize({ width: 390, height: 760 });
await M.locator("[data-peek-toggle]").click();
await M.locator('[data-peek-src="pc"]').click();
await M.getByRole("button", { name: "送り先のプロジェクトを選ぶ" }).click();
await M.getByText("物語A", { exact: true }).last().click();
await M.waitForTimeout(1500);
const row = (num) => M.locator("[data-peek-row]").filter({ has: M.getByText(`#${num}`, { exact: true }) }).first();
const ta = () => M.locator("textarea").first();
const cards = () => M.locator("[data-thread-card]").evaluateAll((els) => els.map((e) => e.dataset.threadCard + ":" + e.innerText.replace("✕", "").trim() + (e.querySelector("[data-thread-remove]") ? "" : "（外せない）")));
const openEdit = async (num) => { await row(num).click(); await row(num).locator("[data-peek-edit]").click(); await M.waitForTimeout(300); };

// ⑤ ふだんの下書き（つなげて書いている途中）を作っておく
await ta().fill("ふだんの1枚目");
await M.locator("[data-thread-add]").click();
await ta().fill("ふだんの2枚目");

// ① 直している間も「＋」が出る
await openEdit(2);
eq("①: 直している間も「＋」が出る。ふだんの下書きの並びは出ない", [await M.locator("[data-thread-add]").count(), await cards()], [1, []]);
await ta().fill("山場の案（直した）");
await M.locator("[data-thread-add]").click();
eq("①: 押すと空の欄になり、直している付箋は上の並びに（外せない）", [await ta().inputValue(), await cards()], ["", ["b0:山場の案（直した）（外せない）"]]);
eq("①: 色・タグは引き継ぐ（そら・メイン・自由タグ）", [await M.locator('[data-color="2"]').evaluate((el) => el.style.border.startsWith("3px")),
  await M.locator("[data-extra-tags] button").allInnerTexts()], [true, ["自由タグ ✕"]]);
await ta().fill("足した1");
await M.locator("[data-thread-add]").click();
await ta().fill("足した2");
await M.locator("[data-thread-add]").click();                       // 3枚目は空のまま（入らない）
eq("①: 並び", await cards(), ["b0:山場の案（直した）（外せない）", "b1:足した1", "b2:足した2"]);
await M.locator('[data-thread-card="b0"] > div').click();           // 直している付箋へ戻る
eq("①: 戻ると直している付箋の中身が出て、足した付箋は下の並びに（空の欄も、保存するまでは残る）", [await ta().inputValue(), await cards()],
  ["山場の案（直した）", ["a0:足した1", "a1:足した2", "a2:（まだ書いていません）"]]);
eq("①: 足した付箋は下の並びに残る", await M.locator("[data-thread-card]").evaluateAll((els) => els.map((e) => e.dataset.threadCard)), ["a0", "a1", "a2"]);

// ② 保存（パソコンの定期の確認が終わった直後に保存し、④で「画面に戻った」で読み込むかを確かめる）
const before = await server();
const n0 = heads.length;
for (let i = 0; i < 70 && heads.length === n0; i++) await P.waitForTimeout(1000);
const periodicAt = heads.at(-1);
await M.locator("[data-add]").click();
await M.waitForTimeout(1500);
const after = await server();
const b = after.boards[0], b0 = before.boards[0];
const added = b.notes.filter((n) => !b0.notes.some((m) => m.id === n.id));
eq("②: 直した付箋が直っている", b.notes.find((n) => n.id === "n2").text, "山場の案（直した）");
eq("②: 足した2枚だけ入る（空の付箋は入らない）。番号は続き", added.map((n) => [n.num, n.text]), [[6, "足した1"], [7, "足した2"]]);
eq("②: 元の付箋の右へ、#3・開いた #4 とぶつからない所から並ぶ", added.map((n) => [n.x, n.y]), [[1154, 360], [1438, 360]]);
eq("②: 色・タグ・大きさは引き継ぐ", added.map((n) => [n.color, n.tags, n.w, n.h, n.parentId]), [[2, ["メイン", "自由タグ"], 260, 182, null], [2, ["メイン", "自由タグ"], 260, 182, null]]);
eq("②: 線は #2→#6→#7（今ある線はそのまま）", b.edges.map((e) => [b.notes.find((n) => n.id === e.from)?.num, b.notes.find((n) => n.id === e.to)?.num]), [[1, 2], [2, 6], [6, 7]]);
eq("②: ほかの付箋・画像は1文字も変わらない", JSON.stringify([b.notes.filter((n) => n.id !== "n2" && !added.includes(n)), b.images]), JSON.stringify([b0.notes.filter((n) => n.id !== "n2"), b0.images]));
eq("②: ほかのボードは変わらない", JSON.stringify(after.boards[1]), JSON.stringify(before.boards[1]));
eq("⑤: 直すのを終えると、ふだんの下書きの並びが戻る", [await ta().inputValue(), await cards()], ["ふだんの2枚目", ["b0:ふだんの1枚目"]]);

// ④ パソコンは画面に戻ったらすぐ読み込む
{
  await P.waitForTimeout(2000);
  eq("④: 前提: 画面に戻る前は、まだ読み込んでいない（定期の確認は直前に済んでいる）", [(await pcBoard()).notes.length, Date.now() - periodicAt < 30000], [5, true]);
  const t0 = Date.now();
  await P.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); });
  let got = null;
  for (let i = 0; i < 20; i++) { got = await pcBoard(); if (got.notes.length === 7) break; await P.waitForTimeout(500); }
  eq("④: 画面に戻ると数秒で読み込む（次の定期の確認より前）", [got.notes.length, Date.now() - t0 < 10000, Date.now() - periodicAt < 60000], [7, true, true]);
  eq("④: パソコンの画面にも出る", await P.locator('[data-note]').filter({ has: P.locator("textarea", { hasText: "足した1" }) }).count() + await P.evaluate(() => [...document.querySelectorAll("[data-note] textarea")].filter((t) => t.value === "足した2").length), 2);
}

// ③ やめる
{
  const ut = F.DB.get("PA").updateTime;
  await openEdit(1);
  await M.locator("[data-thread-add]").click();
  await ta().fill("捨てる付箋");
  await M.getByRole("button", { name: "やめる" }).click();
  await M.waitForTimeout(800);
  eq("③: 「やめる」と何も書かない", F.DB.get("PA").updateTime, ut);
  eq("③: ふだんの下書きは戻る", [await ta().inputValue(), await cards()], ["ふだんの2枚目", ["b0:ふだんの1枚目"]]);
}

// ② 中の付箋に足す
{
  await M.locator("[data-peek-reload]").click();
  await M.waitForTimeout(1200);
  await openEdit(5);
  await M.locator("[data-thread-add]").click();
  await ta().fill("中に足した");
  await M.locator('[data-thread-card="b0"] > div').click();
  await M.locator("[data-add]").click();
  await M.waitForTimeout(1500);
  const n = (await server()).boards[0].notes.find((x) => x.text === "中に足した");
  eq("②: 中の付箋に足すと同じ親の中・中の付箋の大きさ・右に入る", [n?.parentId, n?.w, n?.h, n?.x, n?.y], ["n4", 160, 140, 194, 10]);
}

// ③ パソコンで先に直されていたら、足した付箋も書かない → もう一度保存で両方入る
{
  await M.locator("[data-peek-reload]").click();
  await M.waitForTimeout(1200);
  await openEdit(1);
  await ta().fill("スマホで直した起");
  await M.locator("[data-thread-add]").click();
  await ta().fill("起の次");
  const cur = await C.projectPullSplit(CONF, "PA");
  cur.project.boards[0].notes[0] = { ...cur.project.boards[0].notes[0], text: "パソコンで直した起" };
  eq("前提: パソコンで #1 を直した版がサーバーに上がった", (await C.projectPushSplit(CONF, cur.project, "パソコン", cur.hashes, { updateTime: cur.updateTime })).ok, true);
  await M.locator("[data-add]").click();
  await M.waitForTimeout(1500);
  const s1 = await server();
  eq("③: 知らせて、直した付箋も足した付箋も書かない", [await M.locator("[data-pc-msg]").count(), s1.boards[0].notes[0].text, s1.boards[0].notes.some((n) => n.text === "起の次")], [1, "パソコンで直した起", false]);
  // 並びの小さい表示はタイトル（「起」）を出す（6.21.0 の決まり）
  eq("③: 書いた内容と足した付箋は残っている", [await ta().inputValue(), await cards()], ["起の次", ["b0:起（外せない）"]]);
  await M.locator("[data-add]").click();
  await M.waitForTimeout(1500);
  const s2 = await server();
  eq("③: もう一度保存すると、直した付箋と足した付箋が入る", [s2.boards[0].notes[0].text, s2.boards[0].notes.some((n) => n.text === "起の次")], ["スマホで直した起", true]);
}

await done("パソコンの付箋に足す（スマホ）");
