// 競合で「この端末の方」を選んで上書きするとき、サーバーの版が壊れないか
import { makeFakeFirestore } from "../fakefs.mjs";
const F = makeFakeFirestore();
globalThis.fetch = F.fetch;
const C = await import(process.env.CLOUD || new URL("../../src/cloud.js", import.meta.url).href);
const conf = { projectId: "p", apiKey: "k", room: "r" };
const b = (id, text) => ({ id, title: id, notes: [{ id: "n" + id, num: 1, text }], edges: [], texts: [], zones: [], strokes: [], images: [] });
const P = (b1, b2) => ({ id: "P", name: "P", currentBoardId: "b1", boards: [b("b1", b1), b("b2", b2)] });

// A が送る（A の記録 HA）
const ra = await C.projectPushSplit(conf, P("A-1", "共通-2"), "A", {}, { exists: false });
// B がボード2だけ書き換えて送る（ボード2の古いかけらは消される）
const h1 = await C.projectHead(conf, "P");
const rb = await C.projectPushSplit(conf, P("A-1", "Bが書き換えた-2"), "B", {}, { updateTime: h1.updateTime });
// A は B の書き換えを知らないまま、ボード1を編集し、競合で「この端末の方」を選ぶ
const h2 = await C.projectHead(conf, "P");
const ro = await C.projectPushSplit(conf, P("Aが書いた-1", "共通-2"), "A", ra.hashes, { updateTime: h2.updateTime });
const back = await C.projectPullSplit(conf, "P");
const got = back ? back.project.boards.map((x) => x.notes[0].text) : "読めない";
console.log(`  書けた=${ra.ok && rb.ok && ro.ok}  サーバーの中身: ${JSON.stringify(got)}`);
const ok = JSON.stringify(got) === JSON.stringify(["Aが書いた-1", "共通-2"]);
console.log(ok ? "ok 上書き後も、選んだ版が丸ごと読める" : "NG 上書き後にサーバーの版が壊れた");
process.exit(ok ? 0 : 1);
