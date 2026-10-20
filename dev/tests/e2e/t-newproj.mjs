// サーバー同期中に「新規プロジェクト」を作ると、作ったプロジェクトが開いたまま残る
// （白紙の片づけは、新しい端末で自動的に作られたものだけ。利用者が作ったものは対象外）
import { device, pidOf, eq, done, F } from "./harness.mjs";
const BASE = process.env.BASE;
const names = (pg) => pg.evaluate(() => JSON.parse(localStorage.getItem("idea-board-index")).projects.map((m) => m.name));
const curName = (pg) => pg.evaluate(() => { const ix = JSON.parse(localStorage.getItem("idea-board-index")); return ix.projects.find((m) => m.id === ix.currentProjectId)?.name; });

// A: 付箋が1枚ある「企画A」をサーバーへ送り済み
const board = (id, notes = []) => ({ id, title: "ボード1", notes, edges: [], texts: [], zones: [], strokes: [], images: [], nextNum: notes.length + 1 });
const A = await device("A", { base: BASE, seed: { projects: [{ id: "pa", name: "企画A", boards: [board("ab1", [{ id: "a1", num: 1, x: 60, y: 120, text: "Aの付箋" }])], currentBoardId: "ab1" }], currentProjectId: "pa" } });
await A.waitForTimeout(4000);
const APID = await pidOf(A);
eq("前提: A のプロジェクトがサーバーにある", F.DB.has(APID), true);

// 1) 📁 メニュー →「＋ 新規プロジェクトを開始」
await A.locator("button", { hasText: "📁" }).first().click();
await A.getByRole("button", { name: "＋ 新規プロジェクトを開始" }).click();
await A.waitForTimeout(6000);   // 突き合わせ（開いたとき）と送信（3秒後）を待つ
const newPid = await pidOf(A);
eq("新規: 作ったプロジェクトが開いたまま", [newPid !== APID, await curName(A)], [true, "プロジェクト2"]);
eq("新規: 一覧に両方ある", (await names(A)).sort(), ["プロジェクト2", "企画A"].sort());
eq("新規: 空でもサーバーへ送られる（ほかの端末でも見える）", newPid !== APID && F.DB.has(newPid), true);

// 2) 開き直しても残る
await A.reload(); await A.waitForTimeout(5000);
eq("開き直しても作ったプロジェクトが開いている", [await pidOf(A), await curName(A)], [newPid, "プロジェクト2"]);

// 3) プロジェクト選択画面の「＋ 新しく作る」（開き直した直後は選択画面が出ている）
if (!(await A.getByRole("button", { name: "＋ 新しく作る" }).count())) {
  await A.locator("button", { hasText: "📁" }).first().click();
  await A.getByRole("button", { name: "プロジェクト選択画面を開く" }).click();
}
await A.getByRole("button", { name: "＋ 新しく作る" }).click();
await A.waitForTimeout(6000);
eq("選択画面から新規: 作ったプロジェクトが開いたまま", await curName(A), "プロジェクト3");

// 4) 何もしていない新しい端末は、これまでどおり白紙を片づけてサーバーの最新を開く
const C = await device("C", { base: BASE });
await C.waitForTimeout(5000);
const cIds = await C.evaluate(() => JSON.parse(localStorage.getItem("idea-board-index")).projects.map((m) => m.id));
eq("新しい端末: 自動の白紙は片づけて、サーバーのものだけを持つ", [cIds.length > 0, cIds.every((id) => F.DB.has(id)), F.DB.has(await pidOf(C))], [true, true, true]);
await done("新規プロジェクト");
