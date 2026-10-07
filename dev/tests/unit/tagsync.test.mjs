// タグ表の三方向マージ（src/tagsync.js）
import { mergeTags, mergeList, syncTags } from "../../src/tagsync.js";
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

const cat = (name, tags, extra = {}) => ({ name, color: "#3D6FB4", ...extra, tags });
const T = (...cats) => ({ presetTags: cats, alertTags: ["重要度高"] });
const names = (d) => d.presetTags.map((c) => `${c.name}:${c.tags.join("/")}`);
const base = T(cat("シーン", ["起", "承"]), cat("設定", ["キャラクター"]));

console.log("■ 足したもの");
eq("この端末で足したタグは残る（サーバーは古いまま）",
  names(mergeTags(base, T(cat("シーン", ["起", "承", "新A"]), cat("設定", ["キャラクター"])), base)),
  ["シーン:起/承/新A", "設定:キャラクター"]);
eq("他の端末で足したタグも残る",
  names(mergeTags(base, base, T(cat("シーン", ["起", "承", "新B"]), cat("設定", ["キャラクター"])))),
  ["シーン:起/承/新B", "設定:キャラクター"]);
eq("両方で別々に足したら両方残る",
  names(mergeTags(base, T(cat("シーン", ["起", "承", "新A"]), cat("設定", ["キャラクター"])), T(cat("シーン", ["起", "承", "PC"]), cat("設定", ["キャラクター"])))),
  ["シーン:起/承/PC/新A", "設定:キャラクター"]);
eq("この端末で足したカテゴリは残る",
  names(mergeTags(base, T(...base.presetTags, cat("章", ["第1章"])), base)),
  ["シーン:起/承", "設定:キャラクター", "章:第1章"]);
eq("他の端末で足したカテゴリも残る",
  names(mergeTags(base, base, T(...base.presetTags, cat("章", ["第2章"])))),
  ["シーン:起/承", "設定:キャラクター", "章:第2章"]);

console.log("\n■ 消したもの");
eq("この端末で消したタグは消える",
  names(mergeTags(base, T(cat("シーン", ["起"]), cat("設定", ["キャラクター"])), base)),
  ["シーン:起", "設定:キャラクター"]);
eq("他の端末で消したタグも消える",
  names(mergeTags(base, base, T(cat("シーン", ["承"]), cat("設定", ["キャラクター"])))),
  ["シーン:承", "設定:キャラクター"]);
eq("消したカテゴリは消える",
  names(mergeTags(base, T(cat("シーン", ["起", "承"])), base)),
  ["シーン:起/承"]);
eq("一方がカテゴリを消し、もう一方がそこへタグを足した → カテゴリごと残す",
  names(mergeTags(base, T(cat("シーン", ["起", "承"])), T(cat("シーン", ["起", "承"]), cat("設定", ["キャラクター", "新B"])))),
  ["シーン:起/承", "設定:キャラクター/新B"]);
eq("（逆向き）この端末で足し、他の端末がカテゴリを消した → 残す",
  names(mergeTags(base, T(cat("シーン", ["起", "承"]), cat("設定", ["キャラクター", "新A"])), T(cat("シーン", ["起", "承"])))),
  ["シーン:起/承", "設定:キャラクター/新A"]);
eq("「最初の状態に戻す」（足したタグも消す操作）は、その操作として伝わる",
  names(mergeTags(T(cat("シーン", ["起", "承", "新A"])), T(cat("シーン", ["起", "承"])), T(cat("シーン", ["起", "承", "新A"])))),
  ["シーン:起/承"]);

console.log("\n■ 値と並び順");
eq("この端末で変えた色を採用",
  mergeTags(base, T(cat("シーン", ["起", "承"], { color: "#C6392B" }), cat("設定", ["キャラクター"])), base).presetTags[0].color, "#C6392B");
eq("他の端末で変えた色を採用",
  mergeTags(base, base, T(cat("シーン", ["起", "承"], { color: "#4C7A4C" }), cat("設定", ["キャラクター"]))).presetTags[0].color, "#4C7A4C");
eq("スマホ版が持たない値（overview）はサーバーのものを残す",
  mergeTags(T(cat("シーン", ["起"], { overview: true })), T(cat("シーン", ["起", "新"])), T(cat("シーン", ["起"], { overview: true }))).presetTags[0].overview, true);
eq("この端末で並べ替えたら、その順",
  mergeList(["起", "承", "転"], ["転", "起", "承"], ["起", "承", "転", "PC"]), ["転", "起", "承", "PC"]);
eq("並べ替えていなければサーバーの順",
  mergeList(["起", "承", "転"], ["起", "承", "転", "新"], ["転", "承", "起"]), ["転", "承", "起", "新"]);
eq("赤で目立たせるタグも同じ合わせ方",
  mergeTags({ presetTags: [], alertTags: ["未"] }, { presetTags: [], alertTags: ["未", "要確認"] }, { presetTags: [], alertTags: ["未", "優先度高"] }).alertTags,
  ["未", "優先度高", "要確認"]);
eq("前回そろえた記録が無い（6.3.0 から上げた直後）ときは、両方を合わせる（消さない）",
  names(mergeTags(null, T(cat("シーン", ["起", "新A"])), T(cat("シーン", ["起", "PC"])))), ["シーン:起/PC/新A"]);

console.log("\n■ 書き込みの手順（入れ違い）");
{
  // サーバー: 1回目の書き込みの直前に、他の端末が「新B」を足す
  let server = { data: base, updateTime: "t1" }, n = 0;
  const io = {
    pull: async () => ({ ...server }),
    push: async (data, expect) => {
      if (n++ === 0) server = { data: T(cat("シーン", ["起", "承", "新B"]), cat("設定", ["キャラクター"])), updateTime: "t2" };
      if (expect.updateTime !== server.updateTime) return { ok: false, conflict: true };
      server = { data, updateTime: "t3" };
      return { ok: true };
    },
  };
  const r = await syncTags(io, base, T(cat("シーン", ["起", "承", "新A"]), cat("設定", ["キャラクター"])));
  eq("入れ違ったら読み直して合わせ直す（両方残る）", names(server.data), ["シーン:起/承/新B/新A", "設定:キャラクター"]);
  eq("この端末の内容もそろう", names(r.merged), names(server.data));
}
{
  let server = null;
  const io = { pull: async () => server, push: async (data, expect) => { if (expect.exists === false && !server) { server = { data, updateTime: "t1" }; return { ok: true }; } return { ok: false, conflict: true }; } };
  const r = await syncTags(io, null, base);
  eq("サーバーにまだ無ければ、この端末の内容を置く", [names(server.data), names(r.base)], [names(base), names(base)]);
}
{
  const io = { pull: async () => ({ data: T(cat("シーン", ["承"])), updateTime: "t1" }), push: async () => ({ ok: true }) };
  const r = await syncTags(io, null, base, () => true);
  eq("この端末が初期のままなら、サーバーの内容をそのまま使う（消したタグを生き返らせない）", names(r.merged), ["シーン:承"]);
}

console.log(ng === 0 ? "\nタグの合わせ方: すべて期待どおりです" : `\nタグの合わせ方: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
