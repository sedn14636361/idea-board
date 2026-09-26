// 分割保存を、偽のFirestoreを相手に往復させて確かめる。
// 本物のFirestoreは手元に無いので、REST の形だけ同じものを用意して
// 「自分たちのロジックが正しいか」を確かめる。
import { projectPushSplit, projectPullSplit, projectRemoveSplit, splitByBytes, hashOf } from "../../src/cloud.js";

const DB = new Map();                 // docId → fields
let calls = { put: 0, get: 0, del: 0 };
const LIMIT = 1048576;                // Firestore の1件あたりの上限（バイト）
const bytes = (s) => Buffer.byteLength(s, "utf8");

globalThis.fetch = async (url, opt = {}) => {
  const u = String(url);
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  if (u.includes("identitytoolkit") || u.includes("securetoken"))
    return ok({ idToken: "T", refreshToken: "R", id_token: "T", refresh_token: "R" });

  const m = u.match(/\/documents\/projects\/[^/]+\/items(?:\/([^?]+))?/);
  const id = m && m[1] ? decodeURIComponent(m[1]) : null;
  const method = opt.method || "GET";

  if (method === "PATCH") {
    calls.put++;
    const fields = JSON.parse(opt.body).fields;
    // 本物と同じように、大きすぎるものは拒否する
    const size = bytes(JSON.stringify(fields));
    if (size > LIMIT) return { ok: false, status: 400, json: async () => ({ error: { message: "too big" } }) };
    DB.set(id, fields);
    return ok({ name: "x/" + id, fields });
  }
  if (method === "DELETE") { calls.del++; DB.delete(id); return ok({}); }
  if (id) {
    calls.get++;
    if (!DB.has(id)) return { ok: false, status: 404, json: async () => ({}) };
    return ok({ name: "projects/p/databases/(default)/documents/projects/r/items/" + id, fields: DB.get(id) });
  }
  return ok({ documents: [...DB.entries()].map(([k, f]) => ({ name: "x/" + k, fields: f })) });
};

let ng = 0;
const eq = (l, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log("ok " + l);
};
const conf = { projectId: "p", apiKey: "k", room: "r" };

// ---- 1) バイト数での切り分け ----
{
  const jp = "あ".repeat(500000);                 // 日本語50万文字 = 150万バイト
  eq("日本語は1文字3バイトとして数える", bytes(jp), 1500000);
  const parts = splitByBytes(jp);
  eq("上限を超えるかけらが無い", parts.every((s) => bytes(s) <= 700 * 1024), true);
  eq("つなぎ直すと元に戻る", parts.join("") === jp, true);
  const emoji = "🎈".repeat(10) + "あ" + "a";      // 4バイト文字を含む
  eq("サロゲートペアを壊さない", splitByBytes(emoji, 9).join("") === emoji, true);
}

// ---- 2) 往復（画像入りの大きなプロジェクト）----
const bigImage = "data:image/png;base64," + "A".repeat(1200000);  // 1.2MB の画像
const project = {
  id: "proj1", name: "物語の構成", currentBoardId: "b1",
  boards: [
    { id: "b1", title: "ボード1", nextNum: 3,
      notes: [{ id: "n1", num: 1, text: "第一幕のはじまり。ここで主人公が動き出す" },
              { id: "n2", num: 2, text: "#1 を受けて転換する" }],
      edges: [], texts: [], zones: [], strokes: [], images: [{ id: "i1", src: bigImage, x: 0, y: 0, w: 400, h: 300 }] },
    { id: "b2", title: "ボード2", nextNum: 1, notes: [], edges: [], texts: [], zones: [], strokes: [], images: [] },
  ],
};

const whole = JSON.stringify(project);
console.log(`\n元のプロジェクト: ${Math.round(bytes(whole)/1024)} KB（1件に入れると上限 ${Math.round(LIMIT/1024)} KB を超える）`);
eq("丸ごと1件には収まらない大きさ", bytes(whole) > LIMIT, true);

calls = { put: 0, get: 0, del: 0 };
const r1 = await projectPushSplit(conf, project, "このPC");
eq("保存できた", r1.ok, true);
console.log(`  書き込み ${calls.put} 件 / できた文書 ${DB.size} 件`);
eq("どの文書も上限に収まっている", [...DB.values()].every((f) => bytes(JSON.stringify(f)) <= LIMIT), true);

const back = await projectPullSplit(conf, "proj1");
eq("読み戻せた", !!back && !!back.project, true);
eq("中身が完全に一致する", JSON.stringify(back.project.boards), JSON.stringify(project.boards));
eq("名前も戻る", back.project.name, "物語の構成");
eq("開いていたボードも戻る", back.project.currentBoardId, "b1");
eq("画像が失われていない", back.project.boards[0].images[0].src === bigImage, true);

// ---- 3) 変わったボードだけ書き込む ----
calls = { put: 0, get: 0, del: 0 };
const r2 = await projectPushSplit(conf, project, "このPC", r1.hashes);
console.log(`  変更なしで再保存 → 書き込み ${calls.put} 件`);
eq("変わっていなければ目次だけ書く", calls.put, 1);

const edited = JSON.parse(JSON.stringify(project));
edited.boards[1].notes.push({ id: "n9", num: 1, text: "ボード2に追記" });
calls = { put: 0, get: 0, del: 0 };
const r3 = await projectPushSplit(conf, edited, "このPC", r2.hashes);
console.log(`  ボード2だけ変更 → 書き込み ${calls.put} 件`);
eq("変わったボードと目次だけ書く", calls.put, 2);
const back3 = await projectPullSplit(conf, "proj1");
eq("追記が反映されている", back3.project.boards[1].notes.length, 1);
eq("触っていないボードは無傷", back3.project.boards[0].images[0].src === bigImage, true);

// ---- 4) 小さくなったとき、余ったかけらが残らない ----
const shrunk = JSON.parse(JSON.stringify(edited));
shrunk.boards[0].images = [];                    // 画像を消す
const beforeCount = DB.size;
const r4 = await projectPushSplit(conf, shrunk, "このPC", r3.hashes);
console.log(`  画像を消した → 文書 ${beforeCount} 件 → ${DB.size} 件`);
eq("余ったかけらが消えている", DB.size < beforeCount, true);
const back4 = await projectPullSplit(conf, "proj1");
eq("読み戻しても壊れない", back4.project.boards[0].images.length, 0);

// ---- 5) 旧形式も読める ----
DB.set("old1", { payload: { stringValue: JSON.stringify({ id: "old1", name: "旧", boards: [] }) },
                 name: { stringValue: "旧" }, savedAt: { integerValue: "1" } });
const oldOne = await projectPullSplit(conf, "old1");
eq("旧形式(payload)も読める", oldOne && oldOne.shape, "whole");
eq("旧形式の中身", oldOne.project.name, "旧");

// ---- 6) 消すとかけらごと消える ----
await projectRemoveSplit(conf, "proj1", r4.hashes.__parts);
eq("proj1 の文書が全部消えた", [...DB.keys()].filter((k) => k.includes("proj1")).length, 0);

// ---- 7) 再起動した直後（端末側の記録が空）でも正しく動く ----
console.log("\n■ 再起動直後（前回の記録なし）");
DB.clear();
const p7 = {
  id: "proj7", name: "再起動", currentBoardId: "x1",
  boards: [
    { id: "x1", title: "1", notes: [{ id: "a", num: 1, text: "一" }], edges: [], texts: [], zones: [], strokes: [], images: [] },
    { id: "x2", title: "2", notes: [], edges: [], texts: [], zones: [], strokes: [],
      images: [{ id: "big", src: "data:," + "B".repeat(900000) }] },   // 2かけらになる大きさ
  ],
};
await projectPushSplit(conf, p7, "PC");
const x2parts = [...DB.keys()].filter((k) => k.startsWith("__b_proj7_x2_")).length;
console.log(`  ボード2は ${x2parts} かけら`);
eq("ボード2は複数のかけらに分かれている", x2parts >= 2, true);

calls = { put: 0, get: 0, del: 0 };
await projectPushSplit(conf, p7, "PC", {});                 // 記録なしで、中身は同じ
console.log(`  記録なし・変更なしで保存 → 書き込み ${calls.put} 件`);
eq("記録が無くても、変わっていないボードは送り直さない", calls.put, 1);

const p7b = JSON.parse(JSON.stringify(p7));
p7b.boards = p7b.boards.filter((b) => b.id !== "x2");       // ボード2を消す
await projectPushSplit(conf, p7b, "PC", {});                // 記録なし
eq("記録が無くても、消したボードのかけらが残らない",
   [...DB.keys()].filter((k) => k.startsWith("__b_proj7_x2_")).length, 0);
eq("残したボードは読める", (await projectPullSplit(conf, "proj7")).project.boards.map((b) => b.id), ["x1"]);

await projectPushSplit(conf, p7, "PC", {});                 // ボード2を戻す
await projectRemoveSplit(conf, "proj7");                    // かけらの数を渡さずに消す
eq("かけらの数を渡さなくても、全部消える", [...DB.keys()].filter((k) => k.includes("proj7")).length, 0);

console.log(ng === 0 ? "\n分割保存: すべて期待どおりです" : `\n分割保存: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
