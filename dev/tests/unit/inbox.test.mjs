// スマホ→パソコンの受信箱: 直して送り直したとき・取り込みとすれ違ったときに、直した内容が消えないか
//   CLOUD_JS=<別の cloud.js> で、古い版にかけて検出できるかを確かめられる
import { makeFakeFirestore } from "../fakefs.mjs";
const F = makeFakeFirestore();
globalThis.fetch = F.fetch;
const C = await import(process.env.CLOUD_JS ? new URL(process.env.CLOUD_JS, "file://").href : new URL("../../src/cloud.js", import.meta.url).href);
const conf = { projectId: "p", apiKey: "k", room: "r" };
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };
const texts = async () => (await C.cloudList(conf)).map((x) => `${x.text}@${x.rev || 0}`);

console.log("■ 直して送り直すと、受信箱の1件が新しい内容に置き換わる");
await C.cloudPush(conf, [{ id: "100", text: "りんご" }]);
await C.cloudPush(conf, [{ id: "100", text: "みかん", rev: 1 }]);
eq("1件のまま・新しい内容", await texts(), ["みかん@1"]);

console.log("\n■ パソコンが読んだあとにスマホが直して送った → 取り込み後の削除で新しい方を消さない");
const seen = await C.cloudList(conf);                         // パソコンが読む（みかん@1）
await C.cloudPush(conf, [{ id: "100", text: "ぶどう", rev: 2 }]); // その間にスマホが直して送る
await C.cloudRemove(conf, seen);                               // パソコンが「みかん」を取り込んで消す
eq("新しい方（ぶどう）は残っている", await texts(), ["ぶどう@2"]);
await C.cloudRemove(conf, await C.cloudList(conf));            // 次の確認で取り込んで消す
eq("読んだときのままなら消える", await texts(), []);

console.log("\n■ 取り込み済みのあとで直して送った → もう一度届く");
await C.cloudPush(conf, [{ id: "200", text: "なし" }]);
await C.cloudRemove(conf, await C.cloudList(conf));
await C.cloudPush(conf, [{ id: "200", text: "もも", rev: 1 }]);
eq("直したものが届いている", await texts(), ["もも@1"]);

console.log("\n■ 送れなかったものは、送れたと返さない");
F.hooks.beforeWrite = (id) => id !== "301";
let done = [];
try { done = await C.cloudPush(conf, [{ id: "300", text: "a" }, { id: "301", text: "b" }]); } catch (e) { done = ["例外"]; }
F.hooks.beforeWrite = null;
eq("通信が切れたら例外（送れたとは言わない）", done.includes("301"), false);

console.log(ng === 0 ? "\n受信箱: すべて期待どおりです" : `\n受信箱: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
