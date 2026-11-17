// ボードを HTML 1ファイルに書き出す（6.28.0。src/exporthtml.js）
//   書き出す画面の「HTML」→ 見本 → ファイルに保存 → そのファイルを file:// で開き、画面と同じ位置に付箋と線があるか、
//   閉じた入れ子を開けるか、スクリプトが動かないか、外へ取りに行かないかを確かめる
import { chromium } from "playwright";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
const BASE = process.env.BASE;
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };
const near = (l, got, want, tol = 2) => {
  const bad = Object.keys(want).filter((k) => !got[k] || ["x", "y", "w", "h"].some((p) => Math.abs(got[k][p] - want[k][p]) > tol));
  if (bad.length) { console.error(`NG ${l}\n   ずれ: ${bad.map((k) => `${k} 得=${JSON.stringify(got[k])} 期=${JSON.stringify(want[k])}`).join("\n         ")}`); ng++; }
  else console.log(`ok ${l}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const pg = await ctx.newPage();
pg.on("pageerror", (e) => { console.log("  pageerror:", e.message); ng++; });

// 試験データ（単体試験 exporthtml.test.mjs と同じ形。閉じた入れ子の中の線 e5 を足した）
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const note = (id, num, text, x, y, extra = {}) => ({ id, num, text, x, y, w: 260, h: 182, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 5, z: num, ...extra });
const A = { id: "PA", name: "企画", currentBoardId: "a1", boards: [{ id: "a1", title: "物語 <案>", nextNum: 12,
  notes: [
    note("n1", 1, "はじまり", 0, 0, { useTitle: true, title: "序", seq: { id: "s", den: true }, color: 0 }),
    note("n2", 2, "つづき", 300, 0, { useTitle: true, title: "序", seq: { id: "s", den: true }, color: 0 }),
    note("n3", 3, "タグ #1 を見る", 0, 260, { tags: ["起", "承", "転", "結", "重要度高"], color: 2 }),
    note("n4", 4, "開いた", 600, 0, { expanded: true, color: 3 }),
    note("c41", 5, "中1", 20, 30, { parentId: "n4", w: 160, h: 140 }),
    note("c42", 6, "中2", 220, 30, { parentId: "n4", w: 160, h: 140 }),
    note("n5", 7, "閉じた", 600, 500, { color: 4 }),
    note("c51", 8, "しまった中", 10, 10, { parentId: "n5", w: 160, h: 140 }),
    note("c52", 11, "しまった中2", 200, 10, { parentId: "n5", w: 160, h: 140 }),
    note("n6", 9, "マイナス", -300, -200),
    note("n7", 10, '<script>window.__x=1</script><img src=x onerror="window.__x=2"> & "引用" 😀', 300, 260),
  ],
  edges: [
    { id: "e1", from: "n1", to: "n2", memo: "原因" },
    { id: "e2", from: "c41", to: "n3" },
    { id: "e3", from: "c51", to: "n6" },
    { id: "e4", from: "c41", to: "c42" },
    { id: "e5", from: "c51", to: "c52" },
  ],
  texts: [{ id: "t1", text: "見出し\n2行目", x: 100, y: 760, size: 2, z: 1 }],
  zones: [{ id: "z1", x: -20, y: -20, w: 600, h: 520, color: "#93C9EE", label: "第一幕" }],
  images: [{ id: "i1", src: PNG, x: 1100, y: 0, w: 80, h: 80 }],
  strokes: [{ id: "s1", color: "#B0483C", width: 4, pts: [{ x: 0, y: 900 }, { x: 50, y: 950 }, { x: 100, y: 900 }] }],
}] };
await pg.goto(BASE);
await pg.evaluate((A) => {
  localStorage.clear();
  localStorage.setItem("idea-board-index", JSON.stringify({ projects: [{ id: "PA", name: "企画" }], currentProjectId: "PA" }));
  localStorage.setItem("idea-board-project:PA", JSON.stringify(A));
}, A);
await pg.reload(); await pg.waitForTimeout(1500);

// 付箋の枠と線の端（原点からの距離・ボードの座標）。中に付箋を持つ付箋の中の付箋も測る
const measure = (p, originSel) => p.evaluate((originSel) => {
  const o = document.querySelector(originSel).getBoundingClientRect();
  const rects = {};
  for (const el of document.querySelectorAll("[data-note]")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue; // 閉じた入れ子の中（見えていない）
    if (el.closest(".ib-pop")) continue;
    rects[el.dataset.note] = { x: Math.round(r.left - o.left), y: Math.round(r.top - o.top), w: el.offsetWidth, h: el.offsetHeight };
  }
  const svgs = [...document.querySelectorAll("svg")].filter((g) => g.querySelector('path[stroke-width="2.2"]') && !g.closest(".ib-pop"));
  const dots = svgs.flatMap((g) => [...g.querySelectorAll("circle")].map((c) => {
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2 - o.left), y: Math.round(r.top + r.height / 2 - o.top) };
  })).sort((a, b) => a.x - b.x || a.y - b.y);
  return { rects, dots };
}, originSel);
const app = await measure(pg, "[data-origin]");

// 1) 書き出す画面の「HTML」
await pg.getByRole("button", { name: "書き出す" }).click();
await pg.waitForTimeout(300);
eq("はじめはテキスト（今までどおり）", [await pg.locator("[data-exportfmt=text]").getAttribute("aria-selected"), await pg.locator("textarea[readonly]").count()], ["true", 1]);
await pg.locator("[data-exportfmt=html]").click();
await pg.waitForTimeout(500);
eq("HTML: 見本が出て、テキストの欄とチェックとコピーは出ない",
  [await pg.locator("iframe[data-exportpreview]").count(), await pg.locator("textarea[readonly]").count(), await pg.getByText("中の付箋も含める").count(), await pg.getByRole("button", { name: "コピー", exact: true }).count()],
  [1, 0, 0, 0]);
eq("見本はスクリプトを動かさない枠（sandbox）", await pg.locator("iframe[data-exportpreview]").getAttribute("sandbox"), "");
const frame = pg.frameLocator("iframe[data-exportpreview]");
eq("見本にボードが出る", [await frame.locator('[data-note="n1"]').count(), await frame.locator(".ib-head strong").textContent()], [1, "物語 <案>"]);
eq("数の表示はこのボードの枚数", await pg.getByText("このボードの7枚").count(), 1);

// 2) ファイルに保存 → file:// で開く
// ファイル名はアプリがリンクに付けた名前で確かめる（この Chromium は日本語のファイル名を "download" と報告する。.txt の保存も同じ）
await pg.evaluate(() => { const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { window.__dlname = this.download; return c.call(this); }; });
const [dl] = await Promise.all([pg.waitForEvent("download"), pg.locator("[data-exportsave]").click()]);
eq("ファイル名はボード名＋.html（使えない文字は _）", await pg.evaluate(() => window.__dlname), "物語 _案_.html");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ib-html-"));
const file = path.join(dir, "board.html");
await dl.saveAs(file);
const out = await ctx.newPage();
const outside = [];
out.on("request", (r) => { if (!r.url().startsWith("file:") && !r.url().startsWith("data:")) outside.push(r.url()); });
out.on("pageerror", (e) => { console.log("  書き出した HTML の pageerror:", e.message); ng++; });
let dialogs = 0;
out.on("dialog", async (d) => { dialogs++; await d.dismiss(); });
await out.setViewportSize({ width: 1500, height: 1000 });
await out.goto(pathToFileURL(file).href);
await out.waitForTimeout(800);

eq("外へ取りに行かない", outside, []);
eq("本文の <script>・onerror は動かない（文字のまま見える）", [await out.evaluate(() => window.__x ?? null), dialogs, await out.locator("script").count()], [null, 0, 0]);
eq("本文はそのままの文字で見える", (await out.locator('[data-note="n7"] .ib-text').textContent()).startsWith("<script>window.__x=1</script><img src=x"), true);
eq("画像が表示される", await out.locator(".ib-img").evaluate((im) => im.complete && im.naturalWidth > 0), true);
eq("見出しの番号・タグ（赤が先頭・3件＋2）", [
  await out.locator('[data-note="n2"] .ib-seq').textContent(),
  await out.locator('[data-note="n3"] .ib-tag').allTextContents(),
], ["2/2", ["重要度高", "起", "承", "+2"]]);

// 3) 位置: 画面と同じ（±2px）。原点からの距離で比べる
const exp = await measure(out, ".ib-origin");
near("付箋の位置と大きさが画面と同じ（開いた入れ子の中の c41・c42 も）", exp.rects, app.rects);
eq("線の端の点の数が画面と同じ", exp.dots.length, app.dots.length);
const dotsOk = app.dots.every((d, i) => exp.dots[i] && Math.abs(d.x - exp.dots[i].x) <= 2 && Math.abs(d.y - exp.dots[i].y) <= 2);
eq("線の端の位置が画面と同じ（±2px）", dotsOk, true);
if (!dotsOk) console.log("   画面:", JSON.stringify(app.dots), "\n   HTML:", JSON.stringify(exp.dots));
eq("閉じた入れ子の中からの線（e3）はオレンジの点線", await out.locator('.ib-edgelayer [data-edge="e3"]').getAttribute("data-bundled"), "1");

// 4) 閉じた入れ子を開く・閉じる
const c51 = out.locator('[data-note="c51"]');
eq("はじめは中の付箋が見えない", await c51.isVisible(), false);
await out.locator('[data-nest="n5"] > summary').click();
await out.waitForTimeout(200);
eq("押すと中の付箋と、中の線（e5）が見える", [await c51.isVisible(), await out.locator('.ib-pop [data-edge="e5"]').isVisible()], [true, true]);
const popTop = await out.evaluate(() => {
  const s = document.querySelector('[data-nest="n5"] > summary').getBoundingClientRect();
  const p = document.querySelector('[data-nest="n5"] .ib-popbody').getBoundingClientRect();
  return { below: Math.round(p.top - s.bottom), left: Math.round(p.left - s.left) };
});
eq("開いた中身は付箋のすぐ下", popTop, { below: 6, left: 0 });
// 中の付箋の位置は、開いた付箋の中のボードの左上から（画面と同じ計算）
const inPop = await out.evaluate(() => {
  const b = document.querySelector('[data-nest="n5"] .ib-popbody .ib-note').getBoundingClientRect();
  const c = document.querySelector('[data-note="c51"]').getBoundingClientRect();
  return { dx: Math.round(c.left - b.left), dy: Math.round(c.top - b.top) };
});
eq("中の付箋は画面の開いた形と同じ位置（7.5+10, 100.5+10。±1）", Math.abs(inPop.dx - 17.5) <= 1 && Math.abs(inPop.dy - 110.5) <= 1, true);
await out.locator('[data-note="c52"]').scrollIntoViewIfNeeded();
eq("開いた中身は手前（他の付箋・線より上）", await out.evaluate(() => {
  const r = document.querySelector('[data-note="c52"]').getBoundingClientRect();
  return document.elementFromPoint(r.left + 20, r.top + 40)?.closest("[data-note]")?.dataset.note;
}), "c52");
await out.locator('[data-nest="n5"] > summary').click();
await out.waitForTimeout(200);
eq("もう一度押すと閉じる", await c51.isVisible(), false);

// 5) 選んだ付箋だけ（Shift+クリックで n1・n2）
await pg.getByRole("button", { name: "閉じる" }).click();
await pg.keyboard.down("Shift");
// 線 e3 が n1 の左下を横切るので、右上の本文を押す
await pg.locator('[data-note="n1"]').click({ position: { x: 230, y: 90 } });
await pg.locator('[data-note="n2"]').click({ position: { x: 230, y: 90 } });
await pg.keyboard.up("Shift");
await pg.getByRole("button", { name: "書き出す" }).click();
await pg.waitForTimeout(500);
eq("前に選んだ形式（HTML）のまま開く", await pg.locator("[data-exportfmt=html]").getAttribute("aria-selected"), "true");
eq("選んだときは「選択中の2枚」", await pg.getByText("選択中の2枚").count(), 1);
const ids = await frame.locator("[data-note]").evaluateAll((els) => els.map((e) => e.dataset.note));
eq("見本は選んだ2枚と、その間の線だけ", [ids, await frame.locator("[data-edge]").evaluateAll((els) => els.map((e) => e.dataset.edge)), await frame.locator(".ib-zone, .ib-img").count()], [["n1", "n2"], ["e1"], 0]);
await pg.locator("[data-exportfmt=text]").click();
eq("テキストに戻すと今までどおり", (await pg.locator("textarea[readonly]").inputValue()).startsWith("【序 1/2】"), true);

await browser.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(ng === 0 ? "\nhtml-export: すべて期待どおりです" : `\nhtml-export: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
