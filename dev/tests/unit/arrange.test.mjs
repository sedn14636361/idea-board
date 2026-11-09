// 選んだ付箋の整列・領域で囲む・タグの一括（src/arrange.js）
import { snapToGrid, enclose, tagStates, toggleTagOn } from "../../src/arrange.js";
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };
const R = (id, x, y, w = 190, h = 170) => ({ id, x, y, w, h });
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ---- 整列（一番近い目盛りへ。6.14.0）----
eq("何も無ければ空", snapToGrid([], 26), {});
// 試験データ: (101,99) (300,250) (515,77) → 目盛り 26 の一番近い点
eq("一番近い目盛りへ（四捨五入）", snapToGrid([R("a", 101, 99), R("b", 300, 250), R("c", 515, 77)], 26),
  { a: { x: 104, y: 104 }, b: { x: 312, y: 260 }, c: { x: 520, y: 78 } });
eq("付箋の大きさは使わない（開いた付箋 430×400 も同じ）", snapToGrid([R("big", 101, 99, 430, 400)], 26), { big: { x: 104, y: 104 } });
eq("ちょうど半分（13）は大きい方へ", snapToGrid([R("h", 13, 39)], 26), { h: { x: 26, y: 52 } });
eq("マイナスの座標も一番近い目盛りへ（-0 にしない）", snapToGrid([R("m", -40, -12)], 26), { m: { x: -52, y: 0 } });
eq("同じ目盛りに来れば重なってよい", snapToGrid([R("p", 100, 100), R("q", 108, 96)], 26), { p: { x: 104, y: 104 }, q: { x: 104, y: 104 } });
eq("すでに目盛りの上なら動かない", snapToGrid([R("s", 52, 78)], 26), { s: { x: 52, y: 78 } });
eq("目盛りの間隔を変えた設定（20）", snapToGrid([R("t", 31, 49)], 20), { t: { x: 40, y: 40 } });

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
