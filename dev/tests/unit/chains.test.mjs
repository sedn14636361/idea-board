// スマホでつなげて書いた付箋の、パソコンでの並びと線（src/incoming.js の chainsOf / layoutChains / linksOf）
import { chainsOf, layoutChains, linksOf } from "../../src/incoming.js";
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };
const ids = (chains) => chains.map((c) => c.map((i) => i.id));
const at = (lay, list) => list.map((i) => { const c = lay.cells.get(i); return [i.id, c.col, c.row]; });

// 試験データ: 単独 s1・s2、3つつなぎ a1→a2→a3、単独 s3・s4、2つつなぎ b1→b2
const I = (id, prev) => ({ id, text: id, ...(prev ? { prev } : {}) });
const list = [I("s1"), I("a1"), I("a2", "a1"), I("s2"), I("a3", "a2"), I("s3"), I("s4"), I("b1"), I("b2", "b1")];
{
  const ch = chainsOf(list);
  eq("鎖に分ける（先頭が届いた順）", ids(ch), [["s1"], ["a1", "a2", "a3"], ["s2"], ["s3"], ["s4"], ["b1", "b2"]]);
  const lay = layoutChains(ch, 3);
  eq("単独は3列で詰め、つながった付箋はその下に横一列", at(lay, list),
    [["s1", 0, 0], ["a1", 0, 2], ["a2", 1, 2], ["s2", 1, 0], ["a3", 2, 2], ["s3", 2, 0], ["s4", 0, 1], ["b1", 0, 3], ["b2", 1, 3]]);
  eq("格子の大きさ", [lay.cols, lay.rows], [3, 4]);
  eq("線: 前の付箋 → この付箋", linksOf(list), [["a1", "a2"], ["a2", "a3"], ["b1", "b2"]]);
}
{
  const five = [I("t1"), I("t2", "t1"), I("t3", "t2"), I("t4", "t3"), I("t5", "t4")];
  const lay = layoutChains(chainsOf(five), 3);
  eq("5つつなぎは横一列に5つ（3列で折り返さない）", [at(lay, five).map((x) => x.slice(1)), lay.cols, lay.rows], [[[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], 5, 1]);
}
{
  const one = [I("x")];
  eq("単独だけなら今までどおり（1つは1列）", [ids(chainsOf(one)), layoutChains(chainsOf(one)).cols, linksOf(one)], [[["x"]], 1, []]);
  const four = [I("p"), I("q"), I("r"), I("s")];
  eq("単独4つは3列で2段（今までと同じ並び）", at(layoutChains(chainsOf(four)), four), [["p", 0, 0], ["q", 1, 0], ["r", 2, 0], ["s", 0, 1]]);
}
{
  // 前の付箋が一緒に届いていない（先に取り込み済み）: 並びは単独。線は linksOf に残る（パソコン側で取り込み済みの付箋を探す）
  const late = [I("a3", "a2")];
  eq("前の付箋が届いていなければ単独として置く。つながりは残す", [ids(chainsOf(late)), linksOf(late)], [[["a3"]], [["a2", "a3"]]]);
  // 届いた順が逆でも鎖の中の順は prev のとおり
  eq("届いた順が逆でも順番は保つ", ids(chainsOf([I("c2", "c1"), I("c1")])), [["c1", "c2"]]);
  // 同じ付箋の次が2つ: 1つめだけ続け、2つめは別の鎖（どちらも消えない）
  eq("同じ前を指す付箋が2つあっても消えない", ids(chainsOf([I("d1"), I("d2", "d1"), I("d3", "d1")])), [["d1", "d2"], ["d3"]]);
  eq("自分を指す・輪になっていても消えない", [ids(chainsOf([I("e1", "e1")])), chainsOf([I("f1", "f2"), I("f2", "f1")]).flat().length], [[["e1"]], 2]);
  eq("数字の id と文字の prev でもつながる", ids(chainsOf([{ id: 1700000000001 }, { id: "1700000000002", prev: 1700000000001 }])), [[1700000000001, "1700000000002"]]);
}
console.log(ng === 0 ? "\nつなげた付箋: すべて期待どおりです" : `\nつなげた付箋: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
