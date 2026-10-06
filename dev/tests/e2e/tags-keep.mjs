// 足したタグが消えないか・送ったあとも色やタグの選択が残るか（6.4.0）
// 6.3.0 では A・A2・B のすべてで足したタグが消えていた（一覧をまるごと上書きしていたため）
import { device, eq, done, F, net } from "./harness.mjs";
const BASE = process.env.BASE, MOBILE = BASE.replace(/index\.html$/, "mobile.html");
const cloudTags = () => { const d = F.DB.get("__tags"); return d ? JSON.parse(d.fields.payload.stringValue).presetTags.flatMap((c) => c.tags) : []; };
const mTags = (M) => M.evaluate(() => JSON.parse(localStorage.getItem("idea-board-tag-catalog") || "[]").flatMap((c) => c.tags));
async function addTag(M, name) {
  await M.getByRole("button", { name: "タグを編集" }).click();
  await M.getByPlaceholder("新しいタグ").fill(name);
  await M.getByRole("button", { name: "追加", exact: true }).first().click();
  await M.getByRole("button", { name: "完了", exact: true }).first().click();
}
const M = await device("M", { base: MOBILE });
await M.waitForTimeout(1500);

console.log("■ A) タグを足してすぐ（3秒以内に）開き直す");
await addTag(M, "新タグA");
eq("足した直後、端末には残っている", (await mTags(M)).includes("新タグA"), true);
await M.waitForTimeout(800);
await M.reload(); await M.waitForTimeout(2500);
eq("開き直しても残っている", (await mTags(M)).includes("新タグA"), true);

console.log("\n■ A2) 電波が無いときにタグを足し、電波が戻ってから開き直す");
net.offline.add("M");
await addTag(M, "新タグA2");
await M.waitForTimeout(4000);
net.offline.delete("M");
await M.reload(); await M.waitForTimeout(2500);
eq("開き直しても残っている", (await mTags(M)).includes("新タグA2"), true);

console.log("\n■ B) パソコンを開いたあとにスマホでタグを足す → パソコンで別のタグを編集");
const P = await device("P", { base: BASE });
await P.waitForTimeout(2000);
await addTag(M, "新タグB");
await M.waitForTimeout(4500);
eq("スマホのタグがサーバーに届いた", cloudTags().includes("新タグB"), true);
await P.getByRole("button", { name: "設定", exact: true }).first().click();
await P.waitForTimeout(500);
const inp = P.getByPlaceholder("タグ1、タグ2、…").first();
await inp.fill((await inp.inputValue()) + "、PCタグ");
await inp.evaluate((el) => el.blur());
await P.waitForTimeout(4500);
eq("パソコンのタグもサーバーに届いた", cloudTags().includes("PCタグ"), true);
eq("スマホで足したタグがサーバーに残っている", cloudTags().includes("新タグB"), true);
await M.reload(); await M.waitForTimeout(2500);
eq("スマホを開き直しても残っている", (await mTags(M)).includes("新タグB"), true);

console.log("\n■ C) 消したタグは他の端末でも消える（消した操作は伝わる）");
await M.getByRole("button", { name: "タグを編集" }).click();
await M.locator("span", { hasText: /^新タグA$/ }).locator("xpath=..").getByRole("button", { name: "✕" }).click();
await M.getByRole("button", { name: "完了", exact: true }).first().click();
await M.waitForTimeout(4500);
eq("サーバーから消えた", cloudTags().includes("新タグA"), false);
await P.reload(); await P.waitForTimeout(3500);
eq("パソコンでも消えている", (await P.evaluate(() => JSON.parse(localStorage.getItem("idea-board-index")).settings.presetTags.flatMap((c) => c.tags))).includes("新タグA"), false);
eq("ほかの足したタグは残っている", ["新タグA2", "新タグB", "PCタグ"].every((t) => cloudTags().includes(t)), true);

console.log("\n■ D) 送ったあとも色・タグ・まとめ先・タイトルのチェックが残る");
const tab = (name) => M.getByRole("button", { name: new RegExp("^" + name) }).first().click();
const colorBtn = (i) => M.getByText("色", { exact: true }).locator("xpath=following-sibling::div[1]").locator("button").nth(i);
const compose = () => M.evaluate(() => JSON.parse(localStorage.getItem("idea-board-compose") || "null"));
await tab("書く");
await M.getByRole("button", { name: "編集", exact: true }).first().click();       // まとめ先を作る
await M.getByPlaceholder("例: 第1章 / キャラ案").fill("第1章");
await M.getByRole("button", { name: "追加", exact: true }).first().click();
await M.getByRole("button", { name: /^(完了|閉じる)$/ }).first().click();
await M.getByRole("button", { name: "第1章", exact: true }).click();
await colorBtn(2).click();
await M.getByRole("button", { name: "新タグB", exact: true }).click();
await M.getByText("タイトルを付ける").click();
await M.getByPlaceholder("タイトル").fill("1枚目");
await M.locator("textarea").first().fill("1枚目の本文");
await M.getByRole("button", { name: "＋ アイデアボックスに入れる" }).click();
await M.waitForTimeout(800);
const sent = (await M.evaluate(() => JSON.parse(localStorage.getItem("idea-board-inbox")))).at(-1);
eq("送った付箋に選んだものが付いている", [sent.color, sent.tags, sent.area, sent.title], [2, ["新タグB"], "第1章", "1枚目"]);
eq("書いた文字だけ消える", [await M.locator("textarea").first().inputValue(), await M.getByPlaceholder("タイトル").inputValue()], ["", ""]);
eq("選んだものは残る", await compose(), { color: 2, tags: ["新タグB"], area: "第1章", useTitle: true });
await M.reload(); await M.waitForTimeout(2500);
eq("開き直しても残る", await compose(), { color: 2, tags: ["新タグB"], area: "第1章", useTitle: true });
eq("画面でもタイトル欄が出ている", await M.getByPlaceholder("タイトル").count(), 1);

console.log("\n■ E) 「色・タグ・まとめ先を戻す」");
const before = await mTags(M);
await M.locator("textarea").first().fill("書きかけ");
await M.getByRole("button", { name: "色・タグ・まとめ先を戻す" }).click();
await M.waitForTimeout(500);
eq("最初に戻る（色は灰色・タグなし・まとめ先なし・チェックなし）", await compose(), { color: 5, tags: [], area: "", useTitle: false });
eq("書いている本文は残る", await M.locator("textarea").first().inputValue(), "書きかけ");
eq("足したタグは一覧に残る", await mTags(M), before);
eq("何も選んでいないときは押せない", await M.getByRole("button", { name: "色・タグ・まとめ先を戻す" }).isDisabled(), true);

await done("タグと選択の保持");
