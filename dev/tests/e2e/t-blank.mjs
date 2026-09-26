// 名前を付けただけの空のプロジェクトが、新しい端末で片づけられて消えない
import { device, pidOf, eq, done, F } from "./harness.mjs";
const BASE = process.env.BASE;
const A = await device("A", { base: BASE, seed: { notes: [{ id: "a1", num: 1, x: 60, y: 120, text: "Aの付箋" }], edges: [] } });
await A.waitForTimeout(4000);
const APID = await pidOf(A);
// B: まだ中身は無いが「新企画」と名前を付けたプロジェクトだけを持っている
const board = { id: "bb1", title: "ボード1", notes: [], edges: [], texts: [], zones: [], strokes: [], images: [], nextNum: 1 };
const B = await device("B", { base: BASE, seed: { projects: [{ id: "pnew", name: "新企画", boards: [board], currentBoardId: "bb1" }], currentProjectId: "pnew" } });
await B.waitForTimeout(5000);
const names = await B.evaluate(() => JSON.parse(localStorage.getItem("idea-board-index")).projects.map((m) => m.name));
eq("名前を付けた空のプロジェクトは残っている", names.includes("新企画"), true);
eq("サーバーにも保存された", F.DB.has("pnew"), true);
// C: 何もしていない新しい端末は、これまでどおりサーバーの最新を開く
const C = await device("C", { base: BASE });
await C.waitForTimeout(4000);
const cNames = await C.evaluate(() => JSON.parse(localStorage.getItem("idea-board-index")).projects.map((m) => m.name));
eq("何もしていない新しい端末は、白紙を片づけてサーバーのものを開く", cNames.filter((n) => n === "プロジェクト1").length <= 1 && !!(await pidOf(C)), true);
eq("サーバーに空の「プロジェクト1」が増えていない", [...F.DB.keys()].filter((k) => !k.startsWith("__")).sort(), [APID, "pnew"].sort());
await done("白紙判定");
