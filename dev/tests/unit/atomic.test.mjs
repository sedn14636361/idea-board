// 送信が途中で切れたとき・2台が同時に送ったときに、サーバーの版が壊れないか
import { makeFakeFirestore } from "../fakefs.mjs";
const F = makeFakeFirestore();
globalThis.fetch = F.fetch;
const C = await import(new URL("../../src/cloud.js", import.meta.url).href);
const conf = { projectId: "p", apiKey: "k", room: "r" };
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };
const board = (text) => ({ id: "b1", title: "1", notes: [{ id: "n", num: 1, text }], edges: [], texts: [], zones: [], strokes: [],
  images: [{ id: "i", src: "data:," + text[0].repeat(900000) }] });            // 2かけらになる大きさ
const proj = (text) => ({ id: "P", name: "P", currentBoardId: "b1", boards: [board(text)] });
// ボード全体が、送ったどれかの版と完全に一致するかで判定する（文字だけ見ると、混ざった状態を見逃す）
const which = async (...cands) => {
  const r = await C.projectPullSplit(conf, "P");
  if (!r) return "読めない";
  const got = JSON.stringify(r.project.boards[0]);
  const hit = cands.find((c) => JSON.stringify(board(c)) === got);
  return hit || "どちらの版でもない（混ざっている）";
};

console.log("■ 送信が途中で切れる");
await C.projectPushSplit(conf, proj("旧版の内容"), "A");
eq("旧版が読める", await which("旧版の内容"), "旧版の内容");
let n = 0;
F.hooks.beforeWrite = () => ++n <= 1;          // 1件目は届き、2件目で通信が切れる
try { await C.projectPushSplit(conf, proj("新版の内容"), "A"); } catch (e) {}
F.hooks.beforeWrite = null;
eq("途中で切れても、サーバーには旧版がそのまま読める", await which("旧版の内容", "新版の内容"), "旧版の内容");

console.log("\n■ 2台が同時に送る（同じ版から編集）");
// サーバーに残っているかけらが、目次の指すものだけか（使われなくなったかけらが残っていないか）
const orphans = () => {
  const meta = JSON.parse(F.DB.get("P").fields.meta.stringValue);
  const live = new Set(meta.boards.flatMap((m) => Array.from({ length: m.parts }, (_, i) => m.v ? `__b_P_${m.id}_${m.v}_${i}` : `__b_P_${m.id}_${i}`)));
  return [...F.DB.keys()].filter((k) => k.startsWith("__b_P_") && !live.has(k)).length;
};
// アプリと同じ送り方: サーバーが最後に同期した版のままか確かめ、条件つきで書く
const send = async (text, known) => {
  const head = await C.projectHead(conf, "P");
  if (!head || head.updateTime !== known) return "conflict";
  const r = await C.projectPushSplit(conf, proj(text), "x", {}, { updateTime: head.updateTime });
  return r.ok ? "ok" : (r.conflict ? "conflict" : "error");
};
F.DB.clear();
await C.projectPushSplit(conf, proj("共通の元"), "A", {}, { exists: false });
let corrupt = 0, bothWon = 0, noneWon = 0, left = 0;
for (let t = 0; t < 300; t++) {
  const base = (await C.projectHead(conf, "P")).updateTime;   // 2台とも、ここまで同期している
  F.hooks.delay = () => new Promise((r) => setTimeout(r, Math.random() * 20));
  const [ra, rb] = await Promise.all([send("Aの編集" + t, base).catch(() => "error"), send("Bの編集" + t, base).catch(() => "error")]);
  F.hooks.delay = null;
  const now = await which("Aの編集" + t, "Bの編集" + t, "Aの編集" + (t - 1), "Bの編集" + (t - 1), "共通の元");
  const winner = ra === "ok" ? "Aの編集" + t : rb === "ok" ? "Bの編集" + t : null;
  if (ra === "ok" && rb === "ok") bothWon++;
  if (!winner) noneWon++;
  if (winner && now !== winner) corrupt++;
  if (!winner && !now.startsWith("Aの編集") && !now.startsWith("Bの編集") && now !== "共通の元") corrupt++;
  left += orphans();
}
eq("300回の同時送信で、サーバーの版が混ざった・勝った方と違う回数", corrupt, 0);
eq("両方とも書けてしまった回数（片方が黙って上書きされた）", bothWon, 0);
console.log(`  どちらも書けなかった回数: ${noneWon}（利用者に尋ねる。上書きはしない）`);
eq("使われなくなったかけらの残り（延べ）", left, 0);

console.log("\n■ 途中で切れたあとの残りかけら");
F.DB.clear();
await C.projectPushSplit(conf, proj("旧版の内容"), "A", {}, { exists: false });
let k = 0;
F.hooks.beforeWrite = () => ++k <= 1;
try { await C.projectPushSplit(conf, proj("新版の内容"), "A", {}, { updateTime: (await C.projectHead(conf, "P")).updateTime }); } catch (e) {}
F.hooks.beforeWrite = null;
eq("途中で切れても旧版が丸ごと読める", await which("旧版の内容", "新版の内容"), "旧版の内容");
eq("途中で切れたとき、書きかけのかけらは片づけられている", orphans(), 0);

console.log("\n■ 旧形式（版の印の無いかけら）からの移行");
F.DB.clear();
const oldBody = JSON.stringify(board("旧形式の内容"));
const oldParts = C.splitByBytes(oldBody);
oldParts.forEach((pt, i) => F.DB.set(`__b_P_b1_${i}`, { fields: { part: { stringValue: pt } }, updateTime: "2026-01-01T00:00:00.000001Z" }));
F.DB.set("P", { updateTime: "2026-01-01T00:00:00.000002Z", fields: { shape: { stringValue: "split" }, name: { stringValue: "P" },
  savedAt: { integerValue: "1" }, meta: { stringValue: JSON.stringify({ currentBoardId: "b1", boards: [{ id: "b1", parts: oldParts.length }] }) } } });
eq("旧形式のかけらが読める", await which("旧形式の内容"), "旧形式の内容");
const h0 = await C.projectHead(conf, "P");
const rr = await C.projectPushSplit(conf, proj("移行後の内容"), "A", {}, { updateTime: h0.updateTime });
eq("旧形式の上から新しい版を書ける", [rr.ok, await which("移行後の内容")], [true, "移行後の内容"]);
eq("旧形式のかけらは片づけられている", [...F.DB.keys()].filter((k) => /^__b_P_b1_\d+$/.test(k)).length, 0);

console.log(ng === 0 ? "\n原子性: すべて期待どおりです" : `\n原子性: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
