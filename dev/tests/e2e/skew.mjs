// 端末の時計がずれているとき、他の端末の編集を黙って上書きしないか
import { device, notesOn, pidOf, serverNotes, typeInto, banner, eq, done, F } from "./harness.mjs";
const BASE = process.env.BASE;

console.log("■ Bの時計が10分遅れている");
const A = await device("A", { base: BASE, seed: { notes: [{ id: "a1", num: 1, x: 60, y: 120, text: "最初" }], edges: [] } });
await A.waitForTimeout(4000);
const PID = await pidOf(A);
const B = await device("B", { base: BASE, clockOffsetMs: -10 * 60 * 1000 });
await B.waitForTimeout(4000);
eq("Bに同じプロジェクトが開く", await notesOn(B), ["最初"]);

await typeInto(B, "Bが書いた大事な文章");
await B.waitForTimeout(5000);
eq("Bの文章がサーバーに届いた", serverNotes(PID), ["Bが書いた大事な文章"]);

await typeInto(A, "Aが書いた別の文章");            // Aはまだ Bの文章を知らない
await A.waitForTimeout(6000);
const now = serverNotes(PID);
console.log("  サーバーの中身:", JSON.stringify(now));
eq("Bの文章を黙って上書きしない", JSON.stringify(now) === JSON.stringify(["Bが書いた大事な文章"]) || (await banner(A)), true);
eq("Aに「両方で変更」と尋ねる", await banner(A), true);
await done("時計のずれ");
