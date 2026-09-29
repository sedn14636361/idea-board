// incomingPlan: スマホで直した付箋を、パソコンでどう扱うか
import { incomingPlan, noteContentHash } from "../../src/incoming.js";
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

// 取り込んだ直後の付箋（src.h は取り込んだ時点の中身の指紋）
const imported = (id, num, srcId, rev, f) => {
  const n = { id, num, title: "", useTitle: false, tags: [], color: 0, ...f };
  return { ...n, src: { id: srcId, rev, h: noteContentHash(n) } };
};
const proj = (...boards) => ({ boards: boards.map((notes, i) => ({ id: "b" + (i + 1), notes })) });
const kinds = (p, items) => { const m = incomingPlan(p, items); return items.map((it) => { const x = m.get(it); return x.kind + (x.num ? "#" + x.num : ""); }); };

const n1 = imported("n1", 1, "100", 0, { text: "りんご", tags: ["メイン"] });
eq("初めて届いた → 新しく貼る", kinds(proj([]), [{ id: "100", text: "りんご" }]), ["new"]);
eq("取り込み済み・PCで手を加えていない・新しい版 → 書き換え", kinds(proj([n1]), [{ id: "100", rev: 1, text: "みかん" }]), ["update#1"]);
eq("位置や大きさを変えただけなら書き換え", kinds(proj([{ ...n1, x: 500, y: 40, w: 300 }]), [{ id: "100", rev: 1 }]), ["update#1"]);
eq("PCで本文を直していた → 上書きせず新しく貼る", kinds(proj([{ ...n1, text: "りんご（PCで追記）" }]), [{ id: "100", rev: 1 }]), ["edited#1"]);
eq("PCでタグを変えていた → 上書きせず新しく貼る", kinds(proj([{ ...n1, tags: [] }]), [{ id: "100", rev: 1 }]), ["edited#1"]);
eq("PCで色を変えていた → 上書きせず新しく貼る", kinds(proj([{ ...n1, color: 3 }]), [{ id: "100", rev: 1 }]), ["edited#1"]);
eq("同じ版がもう一度届いた → 貼らない", kinds(proj([n1]), [{ id: "100", text: "りんご" }]), ["same#1"]);
eq("古い版が届いた → 貼らない", kinds(proj([imported("n1", 1, "100", 3, { text: "x" })]), [{ id: "100", rev: 2 }]), ["same#1"]);
eq("剥がして見つからない → 新しく貼る", kinds(proj([imported("n9", 1, "999", 0, { text: "別" })]), [{ id: "100", rev: 1 }]), ["new"]);
eq("印の無い付箋（6.3.0 より前に取り込んだ・自分で書いた）は対象にしない", kinds(proj([{ id: "n1", num: 1, text: "りんご" }]), [{ id: "100", rev: 1 }]), ["new"]);
eq("別のボードにあっても見つける", incomingPlan(proj([], [n1]), [{ id: "100", rev: 1 }]).values().next().value, { kind: "update", noteId: "n1", num: 1, boardId: "b2" });
// PCで手を加えた付箋 #1 と、そのとき新しく貼った #2（rev1）がある → rev2 は #2 を書き換える
const n2 = imported("n2", 2, "100", 1, { text: "みかん" });
eq("手を加えた方ではなく、手つかずの方を書き換える", kinds(proj([{ ...n1, text: "PCで直した" }, n2]), [{ id: "100", rev: 2 }]), ["update#2"]);
eq("id の無い付箋は新しく貼る", kinds(proj([n1]), [{ text: "idなし" }]), ["new"]);
eq("数値の id も文字の id と同じに扱う", kinds(proj([n1]), [{ id: 100, rev: 1 }]), ["update#1"]);

console.log(ng === 0 ? "\n取り込みの判定: すべて期待どおりです" : `\n取り込みの判定: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
