// 2台同期の8場面（仕様どおりの偽 Firestore の上で）
import { device, notesOn, pidOf, backupsOf, serverNotes, typeInto, banner, eq, done, F, net } from "./harness.mjs";
const BASE = process.env.BASE;
const LIMIT = 1048576;

console.log("■ 1) 手元のプロジェクトがサーバーへ移る");
const A = await device("A", { base: BASE, seed: { notes: [{ id: "a1", num: 1, x: 60, y: 120, text: "Aで書いた最初の付箋" }], edges: [] } });
await A.waitForTimeout(4000);
const PID = await pidOf(A);
eq("サーバーに目次ができた", F.DB.has(PID), true);
eq("サーバーの中身が手元と同じ", serverNotes(PID), ["Aで書いた最初の付箋"]);

console.log("\n■ 2) 別の端末(B)で開く");
const B = await device("B", { base: BASE });
await B.waitForTimeout(2500);
eq("Bは開いただけでAのプロジェクトが出る", await notesOn(B), ["Aで書いた最初の付箋"]);
eq("サーバーに空のプロジェクトが増えていない", [...F.DB.keys()].filter((k) => !k.startsWith("__")), [PID]);

console.log("\n■ 3) Aの編集が、開き直したBに届く");
await typeInto(A, "Aで書き直した");
await A.waitForTimeout(5000);
eq("Aの編集がサーバーに届いた", serverNotes(PID), ["Aで書き直した"]);
await B.reload(); await B.waitForTimeout(4000);
eq("Bを開き直すとAの編集が見える", await notesOn(B), ["Aで書き直した"]);

console.log("\n■ 4) 両方で編集したら、黙って上書きしない");
await typeInto(A, "Aの2回目の編集");
await A.waitForTimeout(5000);
await typeInto(B, "Bが同時に書いた");
await B.waitForTimeout(5500);
eq("Bは送らず、サーバーはAのまま", serverNotes(PID), ["Aの2回目の編集"]);
eq("Bに競合の案内が出る", await banner(B), true);

console.log("\n■ 5) 「サーバーの方」を選ぶ");
await B.getByRole("button", { name: "サーバーの方" }).first().click();
await B.waitForTimeout(2500);
eq("Bの中身がサーバーの内容になる", await notesOn(B), ["Aの2回目の編集"]);
eq("Bが書いた内容は控えに残っている", (await backupsOf(B)).includes("Bが同時に書いた"), true);
eq("案内が消えた", await banner(B), false);

console.log("\n■ 6) オフラインで編集 → つながったら送られる");
net.offline.add("B");
await typeInto(B, "Bがオフラインで書いた");
await B.waitForTimeout(5000);
eq("オフライン中はサーバーに届かない", serverNotes(PID), ["Aの2回目の編集"]);
eq("オフラインでもBの手元に残っている", await notesOn(B), ["Bがオフラインで書いた"]);
net.offline.delete("B");
await B.reload(); await B.waitForTimeout(5000);
eq("つながったらサーバーに届いた", serverNotes(PID), ["Bがオフラインで書いた"]);

console.log("\n■ 7) 1MBを超える画像入り");
await A.reload(); await A.waitForTimeout(4000);
await A.evaluate(() => {
  const cur = JSON.parse(localStorage.getItem("idea-board-index")).currentProjectId;
  const k = "idea-board-project:" + cur;
  const p = JSON.parse(localStorage.getItem(k));
  p.boards[0].images = [{ id: "img1", src: "data:image/png;base64," + "A".repeat(1200000), x: 300, y: 300, w: 200, h: 150 }];
  localStorage.setItem(k, JSON.stringify(p));
});
await A.reload(); await A.waitForTimeout(7000);
eq("どの文書も1MB以内", [...F.DB.values()].every((v) => Buffer.byteLength(JSON.stringify(v.fields)) <= LIMIT), true);
await B.reload(); await B.waitForTimeout(6000);
const bImg = await B.evaluate(() => {
  const cur = JSON.parse(localStorage.getItem("idea-board-index")).currentProjectId;
  const im = JSON.parse(localStorage.getItem("idea-board-project:" + cur)).boards[0].images[0];
  return im ? im.src.length : 0;
});
eq("Bに画像が欠けずに届いた", bImg, "data:image/png;base64,".length + 1200000);

console.log("\n■ 8) 「この端末の方」を選ぶ");
await typeInto(A, "Aの3回目");
await A.waitForTimeout(5000);
await typeInto(B, "Bを残したい");
await B.waitForTimeout(5500);
eq("競合の案内が出る", await banner(B), true);
eq("選ぶまではサーバーはAのまま", serverNotes(PID), ["Aの3回目"]);
await B.getByRole("button", { name: "この端末の方" }).first().click();
await B.waitForTimeout(3000);
eq("サーバーがBの内容になる", serverNotes(PID), ["Bを残したい"]);
await A.reload(); await A.waitForTimeout(5000);
eq("Aを開き直すとBの内容になる", await notesOn(A), ["Bを残したい"]);
eq("Aが書いた内容はAの控えに残っている", (await backupsOf(A)).includes("Aの3回目"), true);
await done("2台同期");
