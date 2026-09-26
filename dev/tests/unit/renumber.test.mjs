// renumber() の検証。IdeaBoard.jsx から関数本体を取り出して単体で動かす。
import fs from "fs";

const src = fs.readFileSync(new URL("../../src/IdeaBoard.jsx", import.meta.url), "utf8");
const start = src.indexOf("function renumber(notes) {");
if (start < 0) throw new Error("renumber が見つかりません");
let d = 0, end = -1;
for (let i = src.indexOf("{", start); i < src.length; i++) {
  if (src[i] === "{") d++;
  else if (src[i] === "}") { d--; if (d === 0) { end = i + 1; break; } }
}
const renumber = eval(`(${src.slice(start, end)})`);

let ng = 0;
const eq = (label, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${label}\n   得: ${a}\n   期: ${b}`); ng++; }
  else console.log(`ok ${label}`);
};
// 削除の再現: 消してから詰め直す
const del = (notes, ids) => renumber(notes.filter((n) => !ids.includes(n.id)));
const shape = (r) => ({ nums: r.notes.map((n) => n.num), texts: r.notes.map((n) => n.text), nextNum: r.nextNum });

// ケース1: 飛びなし → 何も変わらない
{
  const ns = [1,2,3,4,5].map((i) => ({ id: "n"+i, num: i, text: "本文 #2 と #5" }));
  eq("1 飛びなしは無変化", shape(renumber(ns)),
     { nums:[1,2,3,4,5], texts:Array(5).fill("本文 #2 と #5"), nextNum:6 });
}
// ケース2: #3 が欠番 → 1,2,3,4 に詰まり本文も追従
{
  const ns = [
    { id:"a", num:1, text:"先頭" },
    { id:"b", num:2, text:"#4 を見よ" },
    { id:"c", num:4, text:"これは #4 自身" },
    { id:"d", num:5, text:"#5 と #2" },
  ];
  eq("2 欠番を詰める", shape(renumber(ns)),
     { nums:[1,2,3,4], texts:["先頭","#3 を見よ","これは #3 自身","#4 と #2"], nextNum:5 });
}
// ケース3: 先頭を削除 → 後ろが繰り上がり、本文の参照も追従
{
  const ns = [
    { id:"a", num:1, text:"消される" },
    { id:"b", num:2, text:"#3 の続き" },
    { id:"c", num:3, text:"おわり" },
  ];
  eq("3 先頭削除で繰り上がり", shape(del(ns, ["a"])),
     { nums:[1,2], texts:["#2 の続き","おわり"], nextNum:3 });
}
// ケース4: 消えた付箋への #1 はそのまま残す
{
  const ns = [
    { id:"a", num:1, text:"消される" },
    { id:"b", num:2, text:"#3 と #1 を参照" },
    { id:"c", num:3, text:"素材" },
  ];
  eq("4 消えた番号への参照は残す", shape(del(ns, ["a"])),
     { nums:[1,2], texts:["#2 と #1 を参照","素材"], nextNum:3 });
}
// ケース5: 該当のない番号は触らない
{
  const ns = [
    { id:"a", num:2, text:"#999 と #333 と #2" },
    { id:"b", num:5, text:"色は #C6392B" },
  ];
  eq("5 該当なしの番号は無変化", shape(renumber(ns)),
     { nums:[1,2], texts:["#999 と #333 と #1","色は #C6392B"], nextNum:3 });
}
// ケース6: 全削除で nextNum が 1 に戻る
{
  eq("6 空なら nextNum=1", shape(renumber([])), { nums:[], texts:[], nextNum:1 });
}
// ケース7: 連鎖しないこと（#3→#2, #2→#1 が二重適用されない）
{
  const ns = [
    { id:"a", num:2, text:"#2 と #3" },
    { id:"b", num:3, text:"—" },
  ];
  eq("7 置換は1パスで連鎖しない", shape(renumber(ns)),
     { nums:[1,2], texts:["#1 と #2","—"], nextNum:3 });
}

console.log(ng === 0 ? "\nすべて期待どおりです" : `\n${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
