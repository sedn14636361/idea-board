// スマホ版: つなげた付箋を続けて書いて、まとめて入れる（6.18.0）
//   書く欄のすぐ下の幅いっぱいの「＋」で次の付箋を足す／前の付箋へ戻って直せる／開き直しても書きかけが残る／
//   まとめて入れると前の付箋の id（prev）を持つ／パソコンに取り込むと横一列に並び、線でつながる／
//   単独の付箋は今までどおり（線なし）／あとから届いた続きも、取り込み済みの付箋とつながる
import { device, eq, done, F } from "./harness.mjs";
const BASE = process.env.BASE;
const MOBILE = BASE.replace(/index\.html$/, "mobile.html");

const M = await device("M", { base: MOBILE });
await M.setViewportSize({ width: 390, height: 760 });
const ta = M.locator("[data-write-card] textarea");
const plus = M.locator("[data-thread-add]");
const cards = () => M.locator("[data-thread-card]").evaluateAll((els) => els.map((e) => e.dataset.threadCard + ":" + e.innerText.replace("✕", "").trim()));
const mItems = () => M.evaluate(() => JSON.parse(localStorage.getItem("idea-board-inbox") || "[]"));
const colorBtn = (i) => M.getByText("色", { exact: true }).locator("xpath=following-sibling::div[1]").locator("button").nth(i);
const enter = () => M.getByRole("button", { name: "＋ アイデアボックスに入れる" });

console.log("■ 1) 「＋」で次の付箋を足す");
{
  const w = await M.locator("[data-write-card]").boundingBox(), p = await plus.boundingBox();
  eq("「＋」は書く欄のすぐ下・書く欄と同じ幅", [p.y >= w.y + w.height && p.y - (w.y + w.height) < 20, Math.round(p.width), Math.round(p.x)], [true, Math.round(w.width), Math.round(w.x)]);
}
await ta.fill("一つめ");
await plus.click();
eq("足すと空の欄になり、前の付箋が上に並ぶ", [await ta.inputValue(), await cards()], ["", ["b0:一つめ"]]);
await ta.fill("二つめ");
await colorBtn(1).click();                  // 2つめだけ「さくら」
await M.getByRole("button", { name: "メイン", exact: true }).first().click();
await plus.click();
await colorBtn(5).click();                  // 3つめはグレーに戻す（タグは引き継いだまま）
await ta.fill("三つめ");
eq("3つめを書いている: 前の2つが上に並ぶ", await cards(), ["b0:一つめ", "b1:二つめ"]);

console.log("\n■ 2) 前の付箋へ戻って直す");
await M.locator('[data-thread-card="b0"]').click();
eq("1つめへ戻ると中身が入っていて、残りは下に並ぶ", [await ta.inputValue(), await cards()], ["一つめ", ["a0:二つめ", "a1:三つめ"]]);
await ta.fill("一つめ（直した）");
await M.locator('[data-thread-card="a1"]').click();
eq("3つめへ移ると、直した1つめと2つめが上に", [await ta.inputValue(), await cards()], ["三つめ", ["b0:一つめ（直した）", "b1:二つめ"]]);
eq("まだ何も入っていない", (await mItems()).length, 0);

console.log("\n■ 3) 開き直しても書きかけが残る");
await M.reload(); await M.waitForTimeout(2000);
eq("開き直しても、書いている欄と並びが残る", [await ta.inputValue(), await cards()], ["三つめ", ["b0:一つめ（直した）", "b1:二つめ"]]);

console.log("\n■ 4) 空の欄は入らない・まとめて入れる");
await plus.click();                         // 空の4つめを足したまま入れる
await enter().click();
await M.waitForTimeout(1200);
{
  const it = await mItems();
  eq("3件が上から順に入る（空の欄は入らない）", it.map((i) => i.text), ["一つめ（直した）", "二つめ", "三つめ"]);
  eq("2つめ・3つめは前の付箋の id を持つ", [it[0].prev ?? null, it[1].prev === it[0].id, it[2].prev === it[1].id], [null, true, true]);
  eq("色とタグは付箋ごと（3つめは2つめのタグを引き継ぐ）", it.map((i) => [i.color, i.tags]), [[5, []], [1, ["メイン"]], [5, ["メイン"]]]);
  eq("入れたあとは並びが消え、空の欄に戻る", [await ta.inputValue(), await cards()], ["", []]);
  eq("書きかけの控えも消える", await M.evaluate(() => localStorage.getItem("idea-board-thread")), null);
}

console.log("\n■ 5) 単独の付箋は今までどおり");
await M.getByRole("button", { name: "メイン", exact: true }).first().click(); // タグを外す
await ta.fill("単独のメモ");
await enter().click();
await M.waitForTimeout(1200);
eq("単独の付箋はつながりを持たない", "prev" in (await mItems())[3], false);

console.log("\n■ 6) パソコンに取り込むと、横一列に並び、線でつながる");
const P = await device("P", { base: BASE });
const board = () => P.evaluate(() => {
  const cur = JSON.parse(localStorage.getItem("idea-board-index") || "{}").currentProjectId;
  const b = JSON.parse(localStorage.getItem("idea-board-project:" + cur)).boards[0];
  const t = Object.fromEntries(b.notes.map((n) => [n.id, n.text]));
  return { notes: b.notes.map((n) => ({ text: n.text, x: Math.round(n.x), y: Math.round(n.y), w: n.w, color: n.color })), edges: b.edges.map((e) => `${t[e.from]}→${t[e.to]}`) };
});
async function receiveAll() {
  await P.getByRole("button", { name: /^デバイス接続/ }).first().click();
  await P.waitForTimeout(1500);
  await P.getByRole("button", { name: /届いた付箋を見る/ }).click();
  await P.waitForTimeout(400);
  await P.getByRole("button", { name: /件をこのボードに貼る/ }).click();
  await P.waitForTimeout(2500);
}
await receiveAll();
{
  const b = await board();
  const n = Object.fromEntries(b.notes.map((x) => [x.text, x]));
  eq("4枚が貼られる", b.notes.map((x) => x.text).sort(), ["一つめ（直した）", "三つめ", "二つめ", "単独のメモ"].sort());
  eq("線は 1つめ→2つめ→3つめ の2本だけ（単独には無い）", b.edges, ["一つめ（直した）→二つめ", "二つめ→三つめ"]);
  const a = n["一つめ（直した）"], c = n["二つめ"], d = n["三つめ"];
  eq("つなげた3枚は同じ高さで、左から順にすき間 24 で並ぶ", [a.y === c.y && c.y === d.y, c.x - a.x, d.x - c.x], [true, a.w + 24, a.w + 24]);
  eq("単独の付箋は別の段", n["単独のメモ"].y !== a.y, true);
  eq("色もそのまま（2つめだけさくら）", [a.color, c.color, d.color], [5, 1, 5]);
}

console.log("\n■ 7) あとから続きを書いて送っても、取り込み済みの付箋とつながる");
// 取り込み済みの「三つめ」の続きとして届く付箋（前の付箋だけが先にパソコンにある場合）を、受信箱に直接置く
{
  const third = (await mItems())[2];
  await M.evaluate((prev) => {
    const k = "idea-board-inbox", items = JSON.parse(localStorage.getItem(k));
    items.push({ id: "9900000000001", t: 1, title: "", text: "四つめ（あとから）", color: 5, tags: [], area: "", prev });
    localStorage.setItem(k, JSON.stringify(items));
    localStorage.setItem("idea-board-inbox-unsent", JSON.stringify(["9900000000001"]));
  }, third.id);
  await M.reload(); await M.waitForTimeout(2000);
  await M.evaluate(() => window.dispatchEvent(new Event("online"))); // 送れていない分は、電波が戻ったときに送り直す
  await M.waitForTimeout(2500);
  eq("前提: 続きが受信箱に届いた", [...F.INBOX.values()].map((d) => JSON.parse(d.fields.payload.stringValue).text), ["四つめ（あとから）"]);
  await P.reload(); await P.waitForTimeout(2500);
  await receiveAll();
  eq("取り込み済みの「三つめ」から線が引かれる", (await board()).edges, ["一つめ（直した）→二つめ", "二つめ→三つめ", "三つめ→四つめ（あとから）"]);
}

await done("つなげて書く（スマホ）");
