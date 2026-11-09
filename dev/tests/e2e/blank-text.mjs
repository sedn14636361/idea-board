// 直書きの文字は、空のまま入力欄から離れたら消える（6.11.1。空白・改行だけも空）
//   作って何も書かずに離れる（Ctrl+ダブルクリック・＋追加→文字）→ 消え、Ctrl+Z でも戻らない／書いた文字は残る／
//   書いてあった文字を全部消して離れる → 消え、Ctrl+Z で書いてあった状態に戻る／空白・改行だけ → 消える／
//   自分の「A」「⠿」を押しても消えず、カーソルが戻る／別のウィンドウへ移った（カーソルは残る）では消えない／
//   付箋・ほかの文字は変わらない／開き直しても消えたまま
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
pg.on("pageerror", (e) => console.log("  pageerror:", e.message));

// 試験データ: 付箋1枚と、書いてある文字「hello」
const N = { id: "N", num: 1, text: "付箋", x: 100, y: 100, w: 190, h: 170, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 0, z: 1 };
const H = { id: "h", x: 100, y: 450, text: "hello", size: 1, z: 2 };
const A = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 2, notes: [N], edges: [], texts: [H], zones: [], strokes: [], images: [] }] };
await pg.goto(BASE);
await pg.evaluate((A) => {
  localStorage.clear();
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA" }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
}, A);
await pg.reload(); await pg.waitForTimeout(1500);

const saved = async () => { await pg.waitForTimeout(1200); return pg.evaluate(() => JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0]); };
const textsOf = async () => (await saved()).texts.map((t) => t.text);
const at = async (wx, wy) => { const r = await pg.locator("[data-origin]").boundingBox(); return { x: r.x + wx, y: r.y + wy }; };
const ctrlDbl = async (wx, wy) => { const p = await at(wx, wy); await pg.keyboard.down("Control"); await pg.mouse.dblclick(p.x, p.y); await pg.keyboard.up("Control"); await pg.waitForTimeout(150); };
const away = async () => { const p = await at(1100, 760); await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(150); }; // ボードの空いているところ
const undoDisabled = async () => { await pg.waitForTimeout(800); return pg.locator("[data-undo]").isDisabled(); };
const focusedText = () => pg.evaluate(() => document.activeElement?.closest?.("[data-text]")?.dataset.text || null);
// 作った直後はその文字の入力欄にカーソルがあるので、それで作った文字を特定する
const newestId = async () => { const id = await focusedText(); if (!id) throw new Error("作った文字にカーソルが無い"); return id; };
const before = await saved();

// 1) Ctrl+ダブルクリックで作って何も書かずに離れる
await ctrlDbl(600, 200);
eq("1: 作った直後は文字が2つ（入力欄にカーソル）", [(await pg.locator("[data-text]").count()), !!(await focusedText())], [2, true]);
await away();
eq("1: 離れたら消える", await textsOf(), ["hello"]);
eq("1: 戻すものは無い（↶ を押せない）", await undoDisabled(), true);
await pg.keyboard.press("Control+z");
eq("1: Ctrl+Z でも空の文字は戻らない", await textsOf(), ["hello"]);

// 2) 「＋ 追加」→「文字」で作って何も書かずに離れる
await pg.locator("button", { hasText: "追加" }).first().click();
await pg.locator("button", { hasText: "文字" }).filter({ hasText: "ボードに見出しを書く" }).click();
await pg.waitForTimeout(150);
eq("2: ＋追加→文字で作った", (await pg.locator("[data-text]").count()), 2);
await away();
eq("2: 離れたら消える", await textsOf(), ["hello"]);

// 3) 書いた文字は残る
await ctrlDbl(600, 200);
await pg.keyboard.type("abc");
await away();
eq("3: 書いた文字は残る", await textsOf(), ["hello", "abc"]);

// 4) 書いてあった hello を全部消して離れる → 消える。Ctrl+Z で hello に戻る
await pg.locator('[data-text="h"] textarea').click();
await pg.keyboard.press("Control+a");
await pg.keyboard.press("Backspace");
await away();
eq("4: 全部消して離れたら消える", await textsOf(), ["abc"]);
await pg.keyboard.press("Control+z");
eq("4: Ctrl+Z で hello に戻る（元の並びの位置に）", await textsOf(), ["hello", "abc"]);

// 5) 空白・改行だけ → 消える
await ctrlDbl(600, 600);
await pg.keyboard.type("   ");
await pg.keyboard.press("Enter");
await pg.keyboard.type(" ");
await away();
eq("5: 空白・改行だけは消える", (await textsOf()).sort(), ["abc", "hello"]);

// 6) 自分の「A」「⠿」を押しても消えず、カーソルが戻る。そのあと離れたら消える
await ctrlDbl(600, 400);
const id6 = await newestId();
const t6 = pg.locator(`[data-text="${id6}"]`);
await t6.locator('button[title="文字サイズを変える"]').click();
await pg.waitForTimeout(200);
{
  const b = await saved();
  const t = b.texts.find((x) => x.id === id6);
  eq("6: 「A」を押しても消えず、大きさが変わる", [!!t, t?.size], [true, 2]);
  eq("6: 「A」のあと入力欄にカーソルが戻る", await focusedText(), id6);
}
{
  const g = await t6.locator('[title="ドラッグで移動"]').boundingBox();
  await pg.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await pg.mouse.down();
  await pg.mouse.move(g.x + g.width / 2 + 60, g.y + g.height / 2, { steps: 6 }); await pg.mouse.up();
  await pg.waitForTimeout(200);
  const t = (await saved()).texts.find((x) => x.id === id6);
  eq("6: 「⠿」で動かしても消えず、動く", [!!t, t?.x], [true, 660]);
  eq("6: 「⠿」のあと入力欄にカーソルが戻る", await focusedText(), id6);
}
await away();
eq("6: そのあと離れたら消える", (await textsOf()).sort(), ["abc", "hello"]);

// 7) 別のウィンドウへ移った（入力欄の blur だけ起き、カーソルは入力欄に残る）では消えない
await ctrlDbl(600, 400);
const id7 = await newestId();
await pg.evaluate((id) => { document.querySelector(`[data-text="${id}"] textarea`).dispatchEvent(new FocusEvent("blur")); }, id7);
await pg.waitForTimeout(300);
eq("7: ウィンドウを離れただけでは消えない", (await saved()).texts.some((x) => x.id === id7), true);
await away();
eq("7: そのあとボードを押して離れたら消える", (await saved()).texts.some((x) => x.id === id7), false);

// 8) 付箋は変わらない・開き直しても空の文字は無い
{
  const b = await saved();
  eq("8: 付箋は変わらない", b.notes, before.notes);
  await pg.reload(); await pg.waitForTimeout(1500);
  const b2 = await saved();
  eq("8: 開き直しても、書いた文字だけが残る", b2.texts.map((t) => t.text).sort(), ["abc", "hello"]);
}

console.log(ng ? `blank-text: ${ng} 件 期待と違います` : "blank-text: すべて期待どおりです");
await browser.close();
process.exit(ng ? 1 : 0);
