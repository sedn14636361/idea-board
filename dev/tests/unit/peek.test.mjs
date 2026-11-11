// スマホ版の「今ある付箋」の一覧（src/peek.js）と、ボード1枚だけ読む（src/cloud.js の projectPeek）
import { boardRows, localRows, filterRows } from "../../src/peek.js";
import { projectPushSplit, projectPeek } from "../../src/cloud.js";
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

// 試験データ: 物語A のボード1。領域「第1章」(0,0〜400,300) の中に #1。#2 はタグ付きで領域の外。
// #3 は開いていて中に #5・#4（番号の順に並ぶ）。#6 は #5 の中（2段目）。画像つき
const N = (id, num, x, y, extra = {}) => ({ id, num, text: id + "の本文", x, y, w: 190, h: 170, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 0, z: num, ...extra });
const B1 = { id: "b1", title: "本編", nextNum: 7,
  notes: [
    N("n3", 3, 900, 50, { expanded: true, color: 2 }),
    N("n1", 1, 50, 50, { title: "起", useTitle: true, text: "はじまり\n二行目" }),
    N("n2", 2, 500, 50, { tags: ["メイン", "重要度高"], color: 1, text: "\n\n空行のあとの一行目" }),
    N("k5", 5, 10, 10, { parentId: "n3" }), N("k4", 4, 10, 200, { parentId: "n3" }), N("g6", 6, 5, 5, { parentId: "k5" }),
  ],
  edges: [], texts: [{ id: "t", x: 0, y: 500, text: "見出し" }],
  zones: [{ id: "z1", x: 0, y: 0, w: 400, h: 300, label: "第1章", color: "#E8D96A" }, { id: "z0", x: -100, y: -100, w: 2000, h: 900, label: "全体", color: "#93C9EE" }],
  strokes: [], images: [{ id: "i", x: 0, y: 700, w: 100, h: 100, src: "data:image/png;base64," + "A".repeat(2000) }] };
const B2 = { id: "b2", title: "設定メモ", nextNum: 2, notes: [N("m1", 1, 0, 0, { text: "世界観" })], edges: [], texts: [], zones: [], strokes: [], images: [] };

// ---- パソコンのボード → 行 ----
{
  const rows = boardRows(B1);
  eq("番号の順。中の付箋は親のすぐ下に（番号の順で）", rows.map((r) => `${"・".repeat(r.depth)}#${r.num}`), ["#1", "#2", "#3", "・#4", "・#5", "・・#6"]);
  eq("見出しはタイトルだけ。無ければ空（本文の1行目を見出しにしない。6.21.0）", rows.slice(0, 2).map((r) => r.heading), ["起", ""]);
  eq("タイトル欄を使っていない付箋は、タイトルが入っていても見出しにしない", boardRows({ notes: [N("q", 1, 0, 0, { title: "隠れた題", useTitle: false })] })[0].heading, "");
  eq("直すときに使うタイトル・タイトル欄の有無を持つ", [rows[0].title, rows[0].useTitle, rows[1].title, rows[1].useTitle], ["起", true, "", false]);
  eq("中身の指紋 h を持ち、中身が違えば違う", [typeof rows[0].h, rows[0].h !== rows[1].h], ["string", true]);
  eq("領域は中心が入っている一番小さいもの。中の付箋は親と同じ", rows.map((r) => r.zone), ["第1章", "全体", "全体", "全体", "全体", "全体"]);
  eq("タグと色を持つ", [rows[1].tags, rows[1].color, rows[2].color], [["メイン", "重要度高"], 1, 2]);
  eq("画像などは持たない（行は文字だけ）", JSON.stringify(rows).includes("base64"), false);
  eq("空のボード・無いボード", [boardRows({ notes: [] }), boardRows(null)], [[], []]);
  eq("親が見つからない付箋は最上位として出す（消さない）", boardRows({ notes: [N("x", 1, 0, 0, { parentId: "無い" })] }).map((r) => [r.id, r.depth]), [["x", 0]]);
}

// ---- このスマホの付箋 → 行 ----
{
  const items = [{ id: "1", text: "古い", tags: [], color: 5, area: "" }, { id: "2", title: "題", text: "新しい", tags: ["伏線1"], color: 0, area: "キャラ案" }];
  const rows = localRows(items);
  eq("新しいものが上。見出し（タイトルだけ）・まとめ先（zone）", rows.map((r) => [r.id, r.heading, r.zone]), [["2", "題", "キャラ案"], ["1", "", ""]]);
  eq("元の並びは変えない", items.map((i) => i.id), ["1", "2"]);
}

// ---- 検索 ----
{
  const rows = boardRows(B1);
  eq("空なら全部", filterRows(rows, "  ").length, 6);
  eq("本文で", filterRows(rows, "はじまり").map((r) => r.num), [1]);
  eq("タグで", filterRows(rows, "重要度").map((r) => r.num), [2]);
  eq("#番号で", filterRows(rows, "#4").map((r) => r.num), [4]);
  eq("領域の名前で", filterRows(rows, "第1章").map((r) => r.num), [1]);
  eq("空白で区切った語はすべて含むもの", filterRows(rows, "全体 メイン").map((r) => r.num), [2]);
  eq("大文字小文字を区別しない", filterRows([{ heading: "ABC", text: "", tags: [], zone: "", num: 0 }], "abc").length, 1);
}

// ---- ボード1枚だけ読む（偽 Firestore。読んだ文書を数える）----
{
  const DB = new Map(); const gets = [];
  globalThis.fetch = async (url, opt = {}) => {
    const u = String(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.includes("identitytoolkit") || u.includes("securetoken")) return ok({ idToken: "T", refreshToken: "R", id_token: "T", refresh_token: "R" });
    const m = u.match(/\/documents\/projects\/[^/]+\/items(?:\/([^?]+))?/);
    const id = m && m[1] ? decodeURIComponent(m[1]) : null;
    const method = opt.method || "GET";
    if (method === "PATCH") { const fields = JSON.parse(opt.body).fields; DB.set(id, fields); return ok({ name: "x/" + id, fields, updateTime: "t" + DB.size }); }
    if (method === "DELETE") { DB.delete(id); return ok({}); }
    gets.push(id);
    if (!DB.has(id)) return { ok: false, status: 404, json: async () => ({}) };
    return ok({ name: "x/" + id, fields: DB.get(id), updateTime: "t" });
  };
  const conf = { projectId: "p", apiKey: "k", room: "r" };
  const big = { ...B1, images: [{ id: "i", x: 0, y: 0, w: 10, h: 10, src: "data:image/png;base64," + "A".repeat(1600000) }] }; // かけら3つ
  const r = await projectPushSplit(conf, { id: "P", name: "物語A", boards: [big, B2], currentBoardId: "b1" }, "pc", {}, { exists: false });
  eq("前提: 保存できた", r.ok, true);
  const meta = JSON.parse(DB.get("P").meta.stringValue);
  eq("目次にボード名（t）が入る", meta.boards.map((b) => [b.id, b.t, b.parts]), [["b1", "本編", 3], ["b2", "設定メモ", 1]]);

  gets.length = 0;
  const p2 = await projectPeek(conf, "P", "b2");
  eq("b2 を読む: 名前・ボードの一覧・中身", [p2.name, p2.boards, p2.boardId, boardRows(p2.board).map((x) => x.text)],
    ["物語A", [{ id: "b1", title: "本編" }, { id: "b2", title: "設定メモ" }], "b2", ["世界観"]]);
  eq("b2 を読むとき、読むのは目次と b2 のかけら1つだけ（画像の多い b1 は読まない）", [gets.length, gets.some((g) => g.includes("_b1_"))], [2, false]);

  gets.length = 0;
  const p1 = await projectPeek(conf, "P");
  eq("ボードを指定しなければ、パソコンで開いていたボード（b1。かけら3つ＋目次）", [p1.boardId, boardRows(p1.board).length, gets.length], ["b1", 6, 4]);
  eq("無いボードを指定しても、開いていたボードを返す", (await projectPeek(conf, "P", "消えた")).boardId, "b1");
  eq("無いプロジェクトは null", await projectPeek(conf, "無い"), null);

  // 6.15.0 までに保存された目次（t が無い）: 名前は ""（画面で「ボード1」などにする）
  const old = JSON.parse(DB.get("P").meta.stringValue);
  DB.set("P", { ...DB.get("P"), meta: { stringValue: JSON.stringify({ ...old, boards: old.boards.map(({ t, ...b }) => b) }) } });
  eq("ボード名の無い目次でも読める（名前は空）", (await projectPeek(conf, "P", "b2")).boards.map((b) => b.title), ["", ""]);
  // 旧形式（丸ごと）
  DB.set("W", { name: { stringValue: "旧" }, payload: { stringValue: JSON.stringify({ boards: [B2, B1], currentBoardId: "b1" }) } });
  const w = await projectPeek(conf, "W");
  eq("旧形式（丸ごと）も読める", [w.boardId, w.boards.map((b) => b.title)], ["b1", ["設定メモ", "本編"]]);
}

console.log(ng === 0 ? "\n今ある付箋: すべて期待どおりです" : `\n今ある付箋: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
