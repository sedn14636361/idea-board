// 付箋の右に、同じ色・タグの付箋を作って線でつなぐ「＋→」（6.8.0）
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
pg.on("pageerror", (e) => { console.log("  pageerror:", e.message); ng++; });

// 試験データ: レモン #1、わかば #2（タグ メイン・重要度高）、そら #3（開いていて、中に付箋 #4）
// #2 のすぐ右（614）は #3（700〜1130）とぶつかるので、#3 の右に作られるはず
// 色の番号: 0 レモン / 1 さくら / 2 そら / 3 わかば / 4 ふじ / 5 グレー
const note = (id, num, text, x, y, color, extra = {}) => ({ id, num, text, x, y, w: 190, h: 170, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color, z: num, ...extra });
const A = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 5,
  notes: [
    note("n1", 1, "レモン", 100, 100, 0),
    note("n2", 2, "わかば", 400, 100, 3, { tags: ["メイン", "重要度高"] }),
    note("n3", 3, "そら", 700, 100, 2, { expanded: true }),
    note("c1", 4, "中の付箋", 10, 10, 1, { parentId: "n3", w: 160, h: 140, ew: 340, eh: 300, tags: ["伏線1"] }),
  ],
  edges: [], texts: [], zones: [], strokes: [], images: [] }] };
await pg.goto(BASE);
await pg.evaluate((A) => {
  localStorage.clear();
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA" }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
}, A);
await pg.reload(); await pg.waitForTimeout(1500);

const saved = async () => {
  await pg.waitForTimeout(1300);
  return pg.evaluate(() => JSON.parse(localStorage.getItem("idea-board-project:PA")).boards[0]);
};
const known = new Set(A.boards[0].notes.map((n) => n.id));
const fresh = (b) => b.notes.filter((n) => !known.has(n.id));
const side = (id) => pg.locator(`[data-note="${id}"] [data-sidenote]`).first().click();

// 1) わかば（タグ付き）から作る
await side("n2");
await pg.waitForTimeout(300);
const focusedIn = await pg.evaluate(() => document.activeElement?.closest("[data-note]")?.getAttribute("data-note"));
await pg.keyboard.type("続き");
let b = await saved();
let [m] = fresh(b);
eq("1枚増える", fresh(b).length, 1);
eq("同じ色・同じタグ", [m.color, m.tags], [3, ["メイン", "重要度高"]]);
eq("同じ親（最上位）・同じ高さ・次の番号", [m.parentId, m.y, m.num, b.nextNum], [null, 100, 5, 6]);
eq("すぐ右は #3 とぶつかるので、#3 の右（1130+24）に作る", m.x, 1154);
eq("元の付箋と線でつながる", b.edges.map((e) => [e.from, e.to === m.id]), [["n2", true]]);
eq("作った付箋にカーソルがあり、そのまま書ける", [focusedIn === m.id, m.text], [true, "続き"]);
known.add(m.id);

// 2) レモンから作る: 右へ 314 → #2 とぶつかる → 614 → #3 → 1154 → 1) の付箋 → 1368
await pg.mouse.click(10, 880);
await side("n1");
b = await saved(); [m] = fresh(b);
eq("ふさがっていれば空くまで右へ", [m.x, m.y, m.color, m.tags], [1368, 100, 0, []]);
known.add(m.id);

// 3) 中の付箋から作る: 親（#3）の中に作る
await side("c1");
b = await saved(); [m] = fresh(b);
eq("中の付箋からは同じ親の中に、同じ大きさで", [m.parentId, m.x, m.y, m.w, m.h, m.color, m.tags], ["n3", 194, 10, 160, 140, 1, ["伏線1"]]);
eq("親の中に見えている", await pg.locator(`[data-note="n3"] [data-note="${m.id}"]`).isVisible(), true);
known.add(m.id);
// 4) もう一度: 右は親の枠からはみ出すので下に作る
await side("c1");
b = await saved(); [m] = fresh(b);
eq("親の枠からはみ出すときは下に", [m.parentId, m.x, m.y], ["n3", 10, 174]);
const lastId = m.id;

// 5) Ctrl+Z で、作った付箋と線が消える
await pg.mouse.click(10, 880);
await pg.keyboard.press("Control+z");
b = await saved();
eq("Ctrl+Z で作った付箋が消える", b.notes.some((n) => n.id === lastId), false);
eq("線も消える", b.edges.some((e) => e.to === lastId), false);
eq("番号も戻る", b.nextNum, 8);

// 6) 「貼る前に色・タグを決める」が ON（既定。この試験の保存データでもそのまま）でも、設定の画面は出ない
eq("貼る前の設定の画面は出ていない", await pg.locator("strong", { hasText: /^付箋を貼る$/ }).count(), 0);

console.log(ng === 0 ? "\n横に付箋を作る: すべて期待どおりです" : `\n横に付箋を作る: ${ng} 件 期待と違います`);
await browser.close();
process.exit(ng ? 1 : 0);
