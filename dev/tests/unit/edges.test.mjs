// 線の端は付箋の枠の外（src/edges.js。6.22.0）
import { edgeEnds, END_R } from "../../src/edges.js";
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };
const r2 = (v) => Math.round(v * 100) / 100;

// 付箋: 左上 (x,y)・幅 w・高さ h（今の標準 260×182）
const box = (x, y, w = 260, h = 182) => ({ cx: x + w / 2, cy: y + h / 2, hw: w / 2, hh: h / 2, x, y, w, h });
// 点から四角までの距離（中なら負）
const dist = (p, b) => {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w));
  const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h));
  if (dx === 0 && dy === 0) return -Math.min(p.x - b.x, b.x + b.w - p.x, p.y - b.y, b.y + b.h - p.y);
  return Math.hypot(dx, dy);
};
// 線（p1→p2）がどちらの付箋にも入らない（線の太さ 2.2 の半分も含めて外）
const segOutside = (e, A, B) => {
  for (let i = 0; i <= 200; i++) {
    const p = { x: e.p1.x + (e.p2.x - e.p1.x) * i / 200, y: e.p1.y + (e.p2.y - e.p1.y) * i / 200 };
    if (dist(p, A) < 1.1 || dist(p, B) < 1.1) return false;
  }
  return true;
};
// 端の点（半径 END_R）は枠の外にあり、離れすぎない（辺に当たるときはちょうど接する）
const check = (label, A, B, { touch = true } = {}) => {
  const e = edgeEnds(A, B);
  if (!e) { eq(`${label}: 線がある`, null, "線"); return null; }
  const d1 = dist(e.p1, A), d2 = dist(e.p2, B);
  eq(`${label}: 端の点は枠に食い込まない`, [d1 >= END_R - 1e-6, d2 >= END_R - 1e-6], [true, true]);
  if (touch) eq(`${label}: 端の点は枠に接する`, [r2(d1), r2(d2)], [END_R, END_R]);
  eq(`${label}: 線はどちらの付箋にも入らない`, segOutside(e, A, B), true);
  return e;
};

// 横並び: 間 300 / 40 / 24（「＋→」の間）/ 14 / 9
for (const gap of [300, 40, 24, 14, 9]) {
  const A = box(0, 0), B = box(260 + gap, 0);
  const e = check(`横に ${gap}px 空け`, A, B);
  if (e) eq(`横に ${gap}px 空け: 端の位置`, [r2(e.p1.x), r2(e.p2.x), e.p1.y, e.p2.y], [260 + END_R, 260 + gap - END_R, 91, 91]);
}
// 縦並び: 間 14（6.21.0 では端が 3px 内側に入っていた）
{
  const A = box(0, 0), B = box(0, 196);
  const e = check("縦に 14px 空け", A, B);
  eq("縦に 14px 空け: 端の位置", [e.p1.x, r2(e.p1.y), r2(e.p2.y)], [130, 182 + END_R, 196 - END_R]);
}
// 斜め・大きさ違い・中の付箋（160×140）と開いた付箋（430×400）
check("斜め（右下へ。右の辺に当たる）", box(0, 0), box(400, 230));
check("斜め（左上へ）", box(400, 230), box(0, 0));
check("大きさ違い（中の付箋と開いた付箋）", box(20, 600, 160, 140), box(700, 400, 430, 400));
// 角の近くを通る線: 点は枠から END_R 以上離れる（接しなくてよい）
check("角の近く", box(0, 0), box(262 + 8, 184 + 8), { touch: false });
check("角の近く（斜め）", box(0, 0), box(320, 230), { touch: false });
// 重なっている・間が狭すぎる（2つの点が入りきらない）→ 線を描かない（ユーザーが選択）
eq("重なっている → 描かない", edgeEnds(box(0, 0), box(200, 100)), null);
eq("ぴったり接している → 描かない", edgeEnds(box(0, 0), box(260, 0)), null);
eq(`間が ${2 * END_R}px（点がちょうど入る）→ 描かない`, edgeEnds(box(0, 0), box(260 + 2 * END_R, 0)), null);
eq("中心が同じ → 描かない", edgeEnds(box(0, 0), box(0, 0)), null);
eq("片方が無い → 描かない", edgeEnds(box(0, 0), null), null);

console.log(ng === 0 ? "\n線の端: すべて期待どおりです" : `\n線の端: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
