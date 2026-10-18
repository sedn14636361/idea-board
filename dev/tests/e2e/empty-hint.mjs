// 初期画面のメッセージ（6.6.0）: 付箋・文字・領域・画像・手書きのどれか一つでもあれば出さない。出すときはボードの左上
import { chromium } from "playwright";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pg = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
pg.on("pageerror", (e) => console.log("  pageerror:", e.message));

const HINT = "最初の付箋を貼りましょう";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const note = { id: "n1", num: 1, text: "付箋", x: 100, y: 100, w: 190, h: 170, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 0, z: 1 };
// どれも一つだけ置いたボード。最後は何も無いボード
const cases = [
  ["付箋だけ", { notes: [note] }, false],
  ["文字だけ", { texts: [{ id: "t1", text: "見出し", x: 100, y: 100, size: 1 }] }, false],
  ["領域だけ", { zones: [{ id: "z1", x: 100, y: 100, w: 300, h: 200, color: "#888", label: "" }] }, false],
  ["画像だけ", { images: [{ id: "i1", src: PNG, x: 100, y: 100, w: 200, h: 150 }] }, false],
  ["手書きだけ", { strokes: [{ id: "s1", pts: [{ x: 100, y: 100 }, { x: 200, y: 150 }], color: "#333", width: 3 }] }, false],
  ["左上（マイナス）の文字だけ", { texts: [{ id: "t1", text: "見出し", x: -2000, y: -1500, size: 1 }] }, false],
  ["何も無い", {}, true],
];
await pg.goto(BASE);
for (const [label, items, want] of cases) {
  const A = { id: "PA", name: "A", currentBoardId: "a1", boards: [{ id: "a1", title: "ボード1", nextNum: 2,
    notes: [], edges: [], texts: [], zones: [], strokes: [], images: [], ...items }] };
  await pg.evaluate((A) => {
    localStorage.clear();
    localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "A" }], currentProjectId: "PA" }));
    localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
  }, A);
  await pg.reload(); await pg.waitForTimeout(1200);
  eq(`${label} → メッセージを${want ? "出す" : "出さない"}`, await pg.getByText(HINT).count() > 0, want);
}

// 何も無いボードでは、ボードの左上に出る（幅 1280 の画面でも見える）
const pos = await pg.evaluate((HINT) => {
  const p = [...document.querySelectorAll("p")].find((e) => e.textContent.includes(HINT));
  const sc = document.querySelector("[data-origin]").closest("[style*='overflow: auto']");
  const r = p.getBoundingClientRect(), s = sc.getBoundingClientRect();
  return { dx: Math.round(r.left - s.left), dy: Math.round(r.top - s.top), inside: r.right <= s.right && r.bottom <= s.bottom };
}, HINT);
eq("ボードの左上に出る（左上から 60px 以内・画面に収まる）", [pos.dx >= 0 && pos.dx <= 60, pos.dy >= 0 && pos.dy <= 60, pos.inside], [true, true, true]);

// 何も無いボードに「＋ 追加」→「文字」で見出しを置くと消える
await pg.getByRole("button", { name: /追加/ }).first().click();
const addText = pg.getByText("ボードに見出しを書く").first();
if (await addText.count()) {
  await addText.click(); await pg.waitForTimeout(600);
  eq("文字を置くと消える", await pg.getByText(HINT).count(), 0);
} else { console.error("NG 「追加」の「文字」が見つかりません"); ng++; }

await browser.close();
console.log(ng === 0 ? "\n初期画面のメッセージ: すべて期待どおりです" : `\n初期画面のメッセージ: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
