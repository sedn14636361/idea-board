// スマホからパソコンのボードの付箋1枚を直す（src/cloud.js の projectEditNote。6.21.0）
//   直した付箋の直した項目だけが変わる・ほかのボードは書き直さない・入れ違いでも壊れない・
//   パソコンで先に直されていたら書かない・剥がされていたら書かない・途中で切れても旧版のまま
import { makeFakeFirestore } from "../fakefs.mjs";
const F = makeFakeFirestore();
globalThis.fetch = F.fetch;
const C = await import(new URL("../../src/cloud.js", import.meta.url).href);
const { noteContentHash } = await import(new URL("../../src/incoming.js", import.meta.url).href);
const conf = { projectId: "p", apiKey: "k", room: "r" };
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

// 試験データ: ボード2枚。b1 は画像入りでかけらが3つ。タイトルあり #1・タイトルなし #2（スマホの一覧に無いタグ「自由タグ」）・
// #2 の中の付箋 #3・#1→#2 の線（メモつき）・文字・領域。b2 は別のボード
const N = (id, num, extra = {}) => ({ id, num, text: id + "の本文", x: num * 300, y: 40, w: 260, h: 182, ew: 430, eh: 400, title: "", useTitle: false,
  tags: [], refs: [], parentId: null, expanded: false, color: 5, z: num, ...extra });
const b1 = () => ({ id: "b1", title: "本編", nextNum: 4,
  notes: [N("n1", 1, { title: "起", useTitle: true, text: "はじまり", color: 0 }), N("n2", 2, { tags: ["メイン", "自由タグ"], expanded: true, src: { id: "m9", rev: 2, h: "x" } }),
    N("k3", 3, { parentId: "n2", x: 10, y: 10 })],
  edges: [{ from: "n1", to: "n2", memo: "つなぎ" }], texts: [{ id: "t1", x: 0, y: 500, text: "見出しの文字" }],
  zones: [{ id: "z1", x: -20, y: -20, w: 1200, h: 600, label: "第1章", color: "#E8D96A" }], strokes: [],
  images: [{ id: "i", x: 0, y: 700, w: 100, h: 100, src: "data:image/png;base64," + "A".repeat(1600000) }] });
const b2 = () => ({ id: "b2", title: "設定メモ", nextNum: 2, notes: [N("m1", 1, { text: "世界観" })], edges: [], texts: [], zones: [], strokes: [], images: [] });
const proj = () => ({ id: "P", name: "物語A", currentBoardId: "b2", boards: [b1(), b2()] });
const meta = () => JSON.parse(F.DB.get("P").fields.meta.stringValue);
const orphans = () => {
  const live = new Set(meta().boards.flatMap((m) => Array.from({ length: m.parts }, (_, i) => `__b_P_${m.id}_${m.v}_${i}`)));
  return [...F.DB.keys()].filter((k) => k.startsWith("__b_P_") && !live.has(k));
};
const pull = async () => (await C.projectPullSplit(conf, "P")).project;
const fix = (n) => ({ ...n, title: "新しい題", useTitle: true, text: "直した本文", color: 2, tags: ["メイン", "自由タグ", "伏線1"] });

console.log("■ 直した付箋だけが変わる");
await C.projectPushSplit(conf, proj(), "パソコン", {}, { exists: false });
eq("前提: b1 はかけら3つ", meta().boards.map((m) => [m.id, m.parts]), [["b1", 3], ["b2", 1]]);
const before = await pull();
const b2Doc = `__b_P_b2_${meta().boards[1].v}_0`;
const b2Ut = F.DB.get(b2Doc).updateTime;
const headUt = F.DB.get("P").updateTime;
const h2 = noteContentHash(before.boards[0].notes[1]);
const r = await C.projectEditNote(conf, "P", "b1", "n2", fix, { check: (n) => noteContentHash(n) === h2, device: "スマホ" });
eq("書けた", r.ok, true);
const after = await pull();
const n2a = after.boards[0].notes[1], n2b = before.boards[0].notes[1];
eq("直した項目が変わる", [n2a.title, n2a.useTitle, n2a.text, n2a.color, n2a.tags], ["新しい題", true, "直した本文", 2, ["メイン", "自由タグ", "伏線1"]]);
eq("直していない項目（位置・大きさ・番号・開き・取り込みの印）はそのまま",
  JSON.stringify({ ...n2a, title: 0, useTitle: 0, text: 0, color: 0, tags: 0 }), JSON.stringify({ ...n2b, title: 0, useTitle: 0, text: 0, color: 0, tags: 0 }));
eq("ほかの付箋・線・文字・領域・画像・番号の続きは1文字も変わらない",
  JSON.stringify({ ...after.boards[0], notes: after.boards[0].notes.filter((n) => n.id !== "n2") }),
  JSON.stringify({ ...before.boards[0], notes: before.boards[0].notes.filter((n) => n.id !== "n2") }));
eq("ほかのボードは変わらない", JSON.stringify(after.boards[1]), JSON.stringify(before.boards[1]));
eq("ほかのボードのかけらは書き直さない（同じ文書・同じ更新時刻）", F.DB.get(b2Doc)?.updateTime, b2Ut);
eq("プロジェクトの名前・開いていたボード・ボード名は変わらない", [after.name, after.currentBoardId, meta().boards.map((m) => m.t)], ["物語A", "b2", ["本編", "設定メモ"]]);
eq("目次の更新時刻が変わる（パソコンはこれで気づく）", F.DB.get("P").updateTime !== headUt, true);
eq("書いた端末の名前", F.DB.get("P").fields.device.stringValue, "スマホ");
eq("使われなくなったかけらは残らない", orphans(), []);
eq("目次の指紋は、読んだ中身の指紋と同じ", meta().boards[0].h, C.hashOf(JSON.stringify(after.boards[0])));

console.log("\n■ パソコンで先に直されていたら書かない");
{
  const cur = await pull();
  const stale = noteContentHash(before.boards[0].notes[1]);          // スマホが前に読んだときの指紋
  const ut = F.DB.get("P").updateTime;
  const r2 = await C.projectEditNote(conf, "P", "b1", "n2", (n) => ({ ...n, text: "上書きしてしまう" }), { check: (n) => noteContentHash(n) === stale });
  eq("changed で返り、いまの付箋を返す", [r2.ok, r2.reason, r2.note?.text], [false, "changed", "直した本文"]);
  eq("サーバーは書き換わらない", [F.DB.get("P").updateTime === ut, JSON.stringify(await pull()) === JSON.stringify(cur)], [true, true]);
}

console.log("\n■ 剥がされていた・ボードが無い");
{
  const ut = F.DB.get("P").updateTime;
  eq("付箋が無い", (await C.projectEditNote(conf, "P", "b1", "消えた", fix)).reason, "gone");
  eq("ボードが無い", (await C.projectEditNote(conf, "P", "無い", "n2", fix)).reason, "gone");
  eq("プロジェクトが無い", (await C.projectEditNote(conf, "無い", "b1", "n2", fix)).reason, "gone");
  eq("どれもサーバーは書き換わらない", F.DB.get("P").updateTime, ut);
}

console.log("\n■ 入れ違い: スマホが読んでから書くまでに、パソコンがほかの付箋を直して送った");
{
  const pc = await pull();
  pc.boards[0].notes[0] = { ...pc.boards[0].notes[0], text: "パソコンで直した #1" };
  let fired = false, pcPush = null;
  // スマホが新しいかけらを書き始める直前に、パソコンの送信を割り込ませ、終わるまで待つ（パソコンが先に書き終える）
  F.hooks.delay = async (u, opt) => {
    if (fired || (opt.method || "GET") !== "PATCH" || !u.includes("__b_P_b1_")) return;
    fired = true;
    pcPush = C.projectPushSplit(conf, pc, "パソコン", {}, { updateTime: F.DB.get("P").updateTime });
    await pcPush;
  };
  const r3 = await C.projectEditNote(conf, "P", "b1", "n2", (n) => ({ ...n, text: "スマホで直した #2" }));
  F.hooks.delay = null;
  const pr = await pcPush;
  const now = await pull();
  eq("前提: パソコンの送信は通った", pr?.ok, true);
  eq("スマホは読み直して書けた", r3.ok, true);
  eq("両方の直しが残る（どちらも消えない）", [now.boards[0].notes[0].text, now.boards[0].notes[1].text], ["パソコンで直した #1", "スマホで直した #2"]);
  eq("使われなくなったかけらは残らない", orphans(), []);
}

console.log("\n■ 2台が同時に直す（スマホ2台）を 50 回");
{
  let lost = 0, broken = 0;
  for (let t = 0; t < 50; t++) {
    F.hooks.delay = () => new Promise((res) => setTimeout(res, Math.random() * 6));
    const [ra, rb] = await Promise.all([
      C.projectEditNote(conf, "P", "b1", "n1", (n) => ({ ...n, text: "A" + t })).catch(() => ({ ok: false })),
      C.projectEditNote(conf, "P", "b1", "k3", (n) => ({ ...n, text: "B" + t })).catch(() => ({ ok: false })),
    ]);
    F.hooks.delay = null;
    const p = await C.projectPullSplit(conf, "P");
    if (!p) { broken++; continue; }
    const ns = p.project.boards[0].notes;
    if (ra.ok && ns.find((n) => n.id === "n1").text !== "A" + t) lost++;
    if (rb.ok && ns.find((n) => n.id === "k3").text !== "B" + t) lost++;
    if (p.project.boards[0].images[0].src.length !== b1().images[0].src.length) broken++;
  }
  eq("書けたと返った直しが消えたことは無い", lost, 0);
  eq("読めなくなった・画像が欠けたことは無い", broken, 0);
  eq("使われなくなったかけらは残らない", orphans(), []);
}

console.log("\n■ 書いている途中で通信が切れる");
{
  const cur = JSON.stringify(await pull());
  let n = 0;
  F.hooks.beforeWrite = () => ++n <= 1;            // かけらの1件目は届き、2件目で切れる
  let threw = false;
  try { await C.projectEditNote(conf, "P", "b1", "n2", (x) => ({ ...x, text: "届かない" })); } catch (e) { threw = true; }
  F.hooks.beforeWrite = null;
  eq("失敗として返る（例外）", threw, true);
  eq("サーバーは前の版のまま読める", JSON.stringify(await pull()) === cur, true);
}

console.log(ng === 0 ? "\nスマホから直す: すべて期待どおりです" : `\nスマホから直す: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
