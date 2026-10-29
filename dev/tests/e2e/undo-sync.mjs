// 元に戻す × サーバー同期（6.8.0）: 他の端末の版を読み込んだら、その前の履歴は消える
// （残すと Ctrl+Z で読み込む前の状態に戻り、他の端末の編集を上書きしてしまう）
import { device, pidOf, notesOn, serverNotes, typeInto, eq, done, F } from "./harness.mjs";
const BASE = process.env.BASE;
const board = (id, notes = []) => ({ id, title: "ボード1", notes, edges: [], texts: [], zones: [], strokes: [], images: [], nextNum: notes.length + 1 });
const A = await device("A", { base: BASE, seed: { projects: [{ id: "pa", name: "企画A", boards: [board("ab1", [{ id: "a1", num: 1, x: 60, y: 120, text: "はじめ" }])], currentBoardId: "ab1" }], currentProjectId: "pa" } });
await A.waitForTimeout(4000);
const PID = await pidOf(A);
eq("前提: サーバーにある", F.DB.has(PID), true);

const B = await device("B", { base: BASE });
await B.waitForTimeout(4000);
eq("前提: B もサーバーの版を開いている", [await pidOf(B), await notesOn(B)], [PID, ["はじめ"]]);

// B で書き換えて送る → B には戻せる手がある
await typeInto(B, "Bの編集");
await B.waitForTimeout(6000);
eq("前提: B の編集がサーバーへ", serverNotes(PID), ["Bの編集"]);
eq("B は戻せる", await B.locator("[data-undo]").isDisabled(), false);

// A で読み込んでから書き換えて送る
await A.reload(); await A.waitForTimeout(5000);
await typeInto(A, "Aの編集");
await A.waitForTimeout(6000);
eq("前提: A の編集がサーバーへ", serverNotes(PID), ["Aの編集"]);

// B は開き直さずに、定期の突き合わせ（60秒）で A の版を読み込む
await B.waitForTimeout(65000);
eq("B が A の版を読み込んだ", await notesOn(B), ["Aの編集"]);
eq("読み込んだら、その前の履歴は消える（↶ は押せない）", await B.locator("[data-undo]").isDisabled(), true);
await B.mouse.click(10, 700);
await B.keyboard.press("Control+z");
await B.waitForTimeout(6000);
eq("Ctrl+Z を押しても A の編集は消えない（B の手元）", await notesOn(B), ["Aの編集"]);
eq("Ctrl+Z を押しても A の編集は消えない（サーバー）", serverNotes(PID), ["Aの編集"]);

// 読み込んだあとの B の編集は、また戻せる
await typeInto(B, "Bの2回目");
await B.mouse.click(10, 700);
await B.keyboard.press("Control+z");
await B.waitForTimeout(1500);
eq("読み込んだあとの編集は戻せる（読み込んだ版まで）", await notesOn(B), ["Aの編集"]);
await done("元に戻す × 同期");
