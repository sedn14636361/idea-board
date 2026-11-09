// 選んだ付箋の整列・領域で囲む・タグの一括（src/arrange.js）
import { tidyGrid, enclose, tagStates, toggleTagOn } from "../../src/arrange.js";
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };
const R = (id, x, y, w = 190, h = 170) => ({ id, x, y, w, h });
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ---- 整列 ----
eq("何も無ければ空", tidyGrid([]), {});
eq("1枚なら動かない", tidyGrid([R("a", 37, 81)]), { a: { x: 37, y: 81 } });
// 4枚（同じ大きさ）: 2列×2行。起点 a(100,100)
eq("同じ大きさ4枚は2×2、すき間24", tidyGrid([R("a", 100, 100), R("b", 900, 120), R("c", 130, 700), R("d", 800, 650)]),
  { a: { x: 100, y: 100 }, b: { x: 314, y: 100 }, c: { x: 100, y: 294 }, d: { x: 314, y: 294 } });
eq("読み順: 上の行から、行の中は左から（並びはばらばらに渡しても同じ）",
  tidyGrid([R("d", 800, 650), R("c", 130, 700), R("b", 900, 120), R("a", 100, 100)]),
  { a: { x: 100, y: 100 }, b: { x: 314, y: 100 }, c: { x: 100, y: 294 }, d: { x: 314, y: 294 } });
eq("起点は x+y が最小の付箋（いちばん上の付箋ではない）", tidyGrid([R("top", 2000, 0), R("left", 0, 300)]).left, { x: 0, y: 300 });
eq("横に少しずれただけの付箋は同じ行（行の先頭の高さの半分まで）", Object.keys(tidyGrid([R("a", 0, 0), R("c", 0, 400), R("b", 600, 60)])),
  ["a", "b", "c"]);

// 試験データ: 大きさの違う5枚（1枚は開いていて 430×400）→ 3列。列ごとに上から詰める（6.11.0）
{
  const items = [R("s1", 300, 200), R("big", 800, 180, 430, 400), R("s2", 1500, 250, 160, 140), R("s3", 260, 900), R("s4", 900, 950, 220, 200)];
  const p = tidyGrid(items, 24);
  eq("5枚は3列、起点 s1 は動かない", p.s1, { x: 300, y: 200 });
  eq("1段目: s1 → big → s2", [p.big, p.s2], [{ x: 514, y: 200 }, { x: 968, y: 200 }]);
  eq("s3 は s1 の真下に24あけて（big の高さに引っぱられない）", p.s3, { x: 300, y: 394 });
  eq("s4 は big の真下に24あけて", p.s4, { x: 514, y: 624 });
  const placed = items.map((it) => ({ ...it, ...p[it.id] }));
  eq("重ならない", placed.some((a, i) => placed.some((b, j) => i < j && overlaps(a, b))), false);
  eq("1段目の縁と縁のすき間はちょうど24", [p.big.x - (p.s1.x + 190), p.s2.x - (p.big.x + 430)], [24, 24]);
  eq("列の幅はその列でいちばん広い付箋（s4 は big の列なので big の左端にそろう）", p.s4.x, p.big.x);
}

// 計画でお見せした例: B だけ大きい6枚（A〜F の読み順、3列）。6.10.x では A と D の間が 254・E と F の間が 264 空いていた
{
  const items = [R("A", 100, 100), R("B", 400, 100, 430, 400), R("C", 900, 100), R("D", 100, 700), R("E", 400, 700), R("F", 900, 700)];
  const p = tidyGrid(items, 24);
  eq("6枚: 位置", p, { A: { x: 100, y: 100 }, B: { x: 314, y: 100 }, C: { x: 768, y: 100 },
    D: { x: 100, y: 294 }, E: { x: 314, y: 524 }, F: { x: 768, y: 294 } });
  const placed = Object.fromEntries(items.map((it) => [it.id, { ...it, ...p[it.id] }]));
  const below = (a, b) => placed[b].y - (placed[a].y + placed[a].h);
  eq("6枚: 上下のすき間はすべて24（A→D・B→E・C→F）", [below("A", "D"), below("B", "E"), below("C", "F")], [24, 24, 24]);
  eq("6枚: 各列の左端がそろう", [p.A.x === p.D.x, p.B.x === p.E.x, p.C.x === p.F.x], [true, true, true]);
  const all = Object.values(placed);
  eq("6枚: 重ならない", all.some((a, i) => all.some((b, j) => i < j && overlaps(a, b))), false);
}

// 大きさがまちまちでも重ならず、各列の上下のすき間は gap（グリッド配置の 26 で）
{
  const sizes = [[190, 170], [430, 400], [120, 90], [300, 260], [190, 170], [240, 200], [430, 400], [150, 120], [200, 330], [120, 90]];
  const items = sizes.map(([w, h], i) => R("n" + i, (i % 4) * 500, Math.floor(i / 4) * 500, w, h));
  const p = tidyGrid(items, 26);
  const placed = items.map((it) => ({ ...it, ...p[it.id] }));
  eq("10枚・まちまち: 重ならない", placed.some((a, i) => placed.some((b, j) => i < j && overlaps(a, b))), false);
  const gaps = [];
  for (const a of placed) for (const b of placed) if (a.x === b.x && b.y > a.y && !placed.some((c) => c.x === a.x && c.y > a.y && c.y < b.y)) gaps.push(b.y - (a.y + a.h));
  eq("10枚・まちまち: 同じ列で隣り合う付箋の上下のすき間はすべて26", [...new Set(gaps)], [26]);
}

// ---- 領域で囲む ----
eq("何も無ければ null", enclose([]), null);
eq("周りに24、上は40あける", enclose([R("a", 100, 100), R("b", 400, 300, 160, 140)]), { x: 76, y: 60, w: 508, h: 404 });
eq("目盛りに合わせるときは外側へ（はみ出さない）", enclose([R("a", 100, 100)], { grid: 26 }), { x: 52, y: 52, w: 286, h: 260 });
{
  const rs = [R("a", -50, 30), R("b", 600, 800, 430, 400)];
  const z = enclose(rs, { grid: 26 });
  eq("中身がすべて入る", rs.every((r) => r.x >= z.x && r.y >= z.y && r.x + r.w <= z.x + z.w && r.y + r.h <= z.y + z.h), true);
}

// ---- タグ ----
const ns = [{ id: "a", tags: ["メイン", "重要度高"] }, { id: "b", tags: ["メイン"] }, { id: "c", tags: [] }, { id: "x", tags: ["伏線1"] }];
eq("全員／一部／なし", tagStates(ns.slice(0, 3), ["メイン", "重要度高", "伏線1"]), { "メイン": "some", "重要度高": "some", "伏線1": "none" });
eq("一部に付いているタグを押すと全員に付く（選ばなかった x は変わらない）", toggleTagOn(ns, ["a", "b", "c"], "重要度高").map((n) => n.tags),
  [["メイン", "重要度高"], ["メイン", "重要度高"], ["重要度高"], ["伏線1"]]);
eq("全員に付いているタグを押すと全員から外れる", toggleTagOn(ns, ["a", "b"], "メイン").map((n) => n.tags), [["重要度高"], [], [], ["伏線1"]]);
eq("付いていた付箋はそのまま（同じものを返す）", toggleTagOn(ns, ["a", "c"], "メイン")[0] === ns[0], true);

console.log(ng === 0 ? "\n整列・囲む・タグ: すべて期待どおりです" : `\n整列・囲む・タグ: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
