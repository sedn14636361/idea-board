// ボードを HTML 1ファイルに書き出す（src/exporthtml.js。6.28.0）
import { boardToHtml, noteGeom, esc, safeColor, safeImage, refsOf, strokePath, ROW, MARGIN } from "../../src/exporthtml.js";
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };
const count = (s, re) => (s.match(re) || []).length;

const COLORS = [
  { name: "レモン", bg: "#FFF3A3", edge: "#E8D96A" }, { name: "さくら", bg: "#FFD6E0", edge: "#F0A8BC" },
  { name: "そら", bg: "#CDEBFF", edge: "#93C9EE" }, { name: "わかば", bg: "#D6F5C9", edge: "#A3D98F" },
  { name: "ふじ", bg: "#E6DBFF", edge: "#C3AEEE" }, { name: "グレー", bg: "#EDEBE6", edge: "#C6C1B6" },
];
const tagColorOf = (t) => (["重要度高"].includes(t) ? "#C6392B" : ["起", "承", "転", "結"].includes(t) ? "#4A78B0" : "#6B665C");
const note = (id, num, text, x, y, extra = {}) => ({ id, num, text, x, y, w: 260, h: 182, ew: 430, eh: 400, title: "", useTitle: false, tags: [], refs: [], parentId: null, expanded: false, color: 5, z: num, ...extra });
// 1x1 の PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// 試験データ（ユーザーに示したもの）
//   n1,n2: タイトルと通し番号（序 1/2・序 2/2） n3: 赤のタグ＋カテゴリ色のタグ（5件 → 3件＋「+2」）
//   n4: 開いた入れ子（中に c41,c42） n5: 閉じた入れ子（中に c51。c51 からの線は n5 に束ねてオレンジの点線）
//   n6: マイナスの座標 n7: <script>・&・"・絵文字
//   線のメモ・領域・直書きの文字・画像（PNG と、入れてはいけない http / javascript:）・手書き1本
const board = {
  id: "b1", title: "物語 <案>",
  notes: [
    note("n1", 1, "はじまり", 0, 0, { useTitle: true, title: "序", seq: { id: "s", den: true }, color: 0 }),
    note("n2", 2, "つづき", 300, 0, { useTitle: true, title: "序", seq: { id: "s", den: true }, color: 0 }),
    note("n3", 3, "タグ #1 を見る", 0, 260, { tags: ["起", "承", "転", "結", "重要度高"], color: 2 }),
    note("n4", 4, "開いた", 600, 0, { expanded: true, color: 3 }),
    note("c41", 5, "中1", 20, 30, { parentId: "n4", w: 160, h: 140 }),
    note("c42", 6, "中2", 220, 30, { parentId: "n4", w: 160, h: 140 }),
    note("n5", 7, "閉じた", 600, 500, { color: 4 }),
    note("c51", 8, "しまった中", 10, 10, { parentId: "n5", w: 160, h: 140 }),
    note("n6", 9, "マイナス", -300, -200),
    note("n7", 10, '<script>alert(1)</script> & "引用" 😀', 300, 260, { color: "x" }),
  ],
  edges: [
    { id: "e1", from: "n1", to: "n2", memo: "原因 <b>😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀" },
    { id: "e2", from: "c41", to: "n3" },
    { id: "e3", from: "c51", to: "n6" },
    { id: "e4", from: "c41", to: "c42" },
  ],
  texts: [{ id: "t1", text: "見出し\n2行目", x: 100, y: 700, size: 2 }],
  zones: [{ id: "z1", x: -20, y: -20, w: 600, h: 500, color: "#93C9EE", label: "第一幕<i>" }, { id: "z2", x: 0, y: 0, w: 10, h: 10, color: "red;background:url(http://x)" }],
  images: [
    { id: "i1", src: PNG, x: 1100, y: 0, w: 80, h: 80 },
    { id: "i2", src: "http://example.com/a.png", x: 1100, y: 100, w: 80, h: 80 },
    { id: "i3", src: "javascript:alert(1)", x: 1100, y: 200, w: 80, h: 80 },
  ],
  strokes: [{ id: "s1", color: "#B0483C", width: 4, pts: [{ x: 0, y: 900 }, { x: 50, y: 950 }, { x: 100, y: 900 }] }],
};
const seq = new Map([["n1", { i: 1, n: 2, den: true }], ["n2", { i: 2, n: 2, den: true }]]);
const opts = { colors: COLORS, tagColorOf, alertTags: ["重要度高"], tagLimit: 3, seq, textSizes: [15, 22, 34], grid: 26, projectName: "P&Q", exportedAt: "2026/11/17 10:00", version: "6.28.0" };
const html = boardToHtml(board, opts);

// ---- 安全 ----
eq("<script> は1つも無い（本文の <script> はエスケープ）", count(html, /<script/gi), 0);
eq("本文はエスケープして入る", html.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;引用&quot; 😀"), true);
eq("ボード名・領域名・プロジェクト名もエスケープ", [html.includes("<title>物語 &lt;案&gt;</title>"), html.includes("第一幕&lt;i&gt;"), html.includes("P&amp;Q")], [true, true, true]);
eq("CSP でスクリプトと外部の読み込みを止める", html.includes(`content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"`), true);
eq("画像は data:image/ だけ（http・javascript: は入れない）", [count(html, /<img /g), html.includes("example.com"), html.includes("javascript:")], [1, false, false]);
eq("色コードでない色は既定の色にする（style を壊さない）", [html.includes("url(http"), safeColor("red;x"), safeColor("#abc"), safeColor("#A0B0C0")], [false, "#6B665C", "#abc", "#A0B0C0"]);
eq("esc", esc(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
eq("safeImage", [!!safeImage(PNG), safeImage("data:text/html;base64,AAAA"), safeImage('data:image/png;base64,AA"onerror=x')], [true, null, null]);
eq("外部へ取りに行くものが無い（http・@import・url(）", [/https?:\/\//.test(html), html.includes("@import"), html.includes("url(")], [false, false, false]);

// ---- 中身 ----
eq("付箋は全部ある（閉じた入れ子の中も）", ["n1", "n2", "n3", "n4", "c41", "c42", "n5", "c51", "n6", "n7"].map((id) => html.includes(`data-note="${id}"`)), Array(10).fill(true));
eq("タイトルと通し番号", [html.includes('<span class="ib-titletext">序</span><span class="ib-seq">1/2</span>'), html.includes('<span class="ib-seq">2/2</span>')], [true, true]);
const n3 = html.slice(html.indexOf('data-note="n3"'), html.indexOf('data-note="n3"') + 2000);
const n3tags = [...n3.matchAll(/class="ib-tag[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1]);
eq("赤のタグは先頭・3件まで・残りは +2", n3tags, ["重要度高", "起", "承", "+2"]);
eq("赤のタグは赤", n3.includes("color:#C6392B\">重要度高"), true);
eq("引用（本文の #1）を付箋の下に出す", n3.includes('<span class="ib-refnum">#1</span><span class="ib-refhead">序 1/2</span>'), true);
eq("refsOf: 自分・重複は除く", refsOf({ id: "a", text: "#1 #1 #2", refs: ["b", "a"] }, [{ id: "a", num: 2 }, { id: "b", num: 1 }]).map((m) => m.id), ["b"]);
eq("開いた入れ子の中は、その場に描く（details にしない）", [html.includes('data-nest="n4"'), html.includes('data-nest="n5"')], [false, true]);
const n5 = html.slice(html.indexOf('data-nest="n5"'));
eq("閉じた入れ子: 付箋が summary・中の付箋は開いたときの欄に・数を出す", [n5.indexOf("<summary>") < n5.indexOf('data-note="c51"'), n5.includes('class="ib-pop"'), n5.includes("▸ 1")], [true, true, true]);
eq("直書きの文字（大きさ3段階目・改行はそのまま）", html.includes('font-size:34px;width:max-content">見出し\n2行目</div>'), true);
eq("手書きは画面と同じパス", html.includes(`d="${strokePath(board.strokes[0].pts)}"`), true);
eq("strokePath（中点の二次ベジェ）", strokePath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }]), "M 0 0 Q 10 0 15 5 L 20 10");

// ---- 線 ----
const edges = [...html.matchAll(/<g data-edge="([^"]+)"( data-bundled="1")?>/g)].map((m) => [m[1], !!m[2]]);
eq("線: 中の付箋どうし（e4）はボードと開いた入れ子の中、閉じた入れ子の中からの線（e3）は束ねる", edges, [["e1", false], ["e2", false], ["e3", true], ["e4", false]]);
eq("束ねた線はオレンジの点線", html.includes('stroke="#C98A3D" stroke-width="2.2" stroke-dasharray="6 5"'), true);
eq("メモは18文字で切る（絵文字を割らない）", html.includes(">原因 &lt;b&gt;😀😀😀😀😀😀😀😀😀😀😀😀…</text>"), true);

// ---- 位置（画面で測った値: 開いた 430×400 の付箋の中、(20,30) の 160×140 の付箋は、付箋の左上から (27, 130) に 160×156） ----
const g = noteGeom(board.notes[3], { open: true });
eq("開いた付箋の中のボードの左上（タイトルなし）", [g.inner.x, g.inner.y], [7.5, 100.5]);
eq("タイトルありは 29 下", noteGeom({ ...board.notes[3], useTitle: true }, { open: true }).inner.y, 129.5);
eq("引用が2件なら 59 下（画面: 99 → 158）", noteGeom(board.notes[3], { open: true, refCount: 2 }).inner.y - g.inner.y, 59);
eq("行の高さ（画面の値）", [ROW.bar, ROW.text, ROW.tags], [27, 34, 22]);
eq("付箋の高さは帯 16 を足す", [noteGeom(board.notes[0]).outerH, noteGeom(board.notes[0], { simple: true }).outerH], [198, 187.5]);

// ---- 範囲（マイナスの座標を含む） ----
const m = html.match(/<div class="ib-origin" style="left:(-?\d+)px;top:(-?\d+)px">/);
eq("原点のずれ = 余白 − いちばん左上（n6 の -300, -200）", [+m[1], +m[2]], [MARGIN + 300, MARGIN + 200]);
eq("方眼をボードの 0 にそろえる", html.includes(`background-position:${MARGIN + 300}px ${MARGIN + 200}px`), true);

// ---- 選んだ付箋だけ ----
const sel = boardToHtml(board, { ...opts, noteIds: ["n4", "n3"], textIds: [] });
eq("選んだ付箋（中の付箋ごと）だけ・領域・画像・手書き・文字は入れない",
  [sel.includes('data-note="n4"'), sel.includes('data-note="c41"'), sel.includes('data-note="n1"'), sel.includes("ib-zone\""), sel.includes("<img"), sel.includes('class="ib-strokes"'), sel.includes('class="ib-btext"')],
  [true, true, false, false, false, false, false]);
eq("選んだ付箋どうしの線だけ", [...sel.matchAll(/<g data-edge="([^"]+)"/g)].map((x) => x[1]), ["e2", "e4"]);
const selT = boardToHtml(board, { ...opts, noteIds: [], textIds: ["t1"] });
eq("文字だけ選んだときは文字だけ", [selT.includes('class="ib-btext"'), selT.includes("data-note=")], [true, false]);

// ---- 空のボード・壊れたデータ ----
const empty = boardToHtml({ title: "", notes: [], edges: [] }, {});
eq("空のボードでも書き出せる", [empty.startsWith("<!doctype html>"), empty.includes("<title>ボード</title>")], [true, true]);
const broken = boardToHtml({ notes: [note("x", 1, "a", "abc", null, { color: 99 }), null], edges: [{ id: "q", from: "x", to: "nope" }], strokes: [{ pts: [{ x: "a" }, null, { x: 1, y: 2 }] }] }, { colors: COLORS });
eq("壊れた値でも落ちない（NaN を出さない）", [broken.includes("NaN"), broken.includes('data-note="x"')], [false, true]);

console.log(ng === 0 ? "\nexporthtml: すべて期待どおりです" : `\nexporthtml: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
