// スマホ版で出した付箋を直す → パソコンの付箋も書き換わるか（仕様どおりの偽 Firestore の上で）
//   スマホ(M) と パソコン(P) の2台。BASE は PC 版の index.html
import { device, eq, done, F, net } from "./harness.mjs";
const BASE = process.env.BASE;
const MOBILE = BASE.replace(/index\.html$/, "mobile.html");

// --- スマホ側の操作 ---
const M = await device("M", { base: MOBILE });
const mItems = () => M.evaluate(() => JSON.parse(localStorage.getItem("idea-board-inbox") || "[]"));
const mUnsent = () => M.evaluate(() => JSON.parse(localStorage.getItem("idea-board-inbox-unsent") || "[]"));
const tab = (name) => M.getByRole("button", { name: new RegExp("^" + name) }).first().click();
// 「色」の見出しのすぐ下に並ぶ丸いボタン（右上の i や ⚙ を押さないように、見出しから辿る）
const colorBtn = (i) => M.getByText("色", { exact: true }).locator("xpath=following-sibling::div[1]").locator("button").nth(i);
async function write(text, { color = null, tagsOn = [] } = {}) {
  await tab("書く");
  await M.locator("textarea").first().fill(text);
  if (color != null) await colorBtn(color).click();
  for (const t of tagsOn) await M.getByRole("button", { name: t, exact: true }).first().click();
  await M.getByRole("button", { name: "＋ アイデアボックスに入れる" }).click();
  await M.waitForTimeout(800);
}
const card = (text) => M.locator("[data-item]", { hasText: text }).first();
async function openCard(text) {
  await tab("ためた分");
  // 送信済みのものは「これまで全部」に出る
  const all = M.getByRole("button", { name: /^これまで全部/ });
  if (await all.count()) await all.click();
  await card(text).locator("div", { hasText: text }).last().click();
  await M.waitForTimeout(300);
}
async function editTo(from, to, { color = null, tagsToggle = [] } = {}) {
  await openCard(from);
  await M.locator("textarea").first().fill(to);
  if (color != null) await colorBtn(color).click();
  for (const t of tagsToggle) await M.getByRole("button", { name: t, exact: true }).first().click();
  await M.getByRole("button", { name: "保存", exact: true }).click();
  await M.waitForTimeout(1200);
}
const inbox = () => [...F.INBOX.values()].map((d) => { const x = JSON.parse(d.fields.payload.stringValue); return `${x.text}@${x.rev || 0}`; });

// --- パソコン側の操作 ---
const P = await device("P", { base: BASE });
const pNotes = () => P.evaluate(() => {
  const cur = JSON.parse(localStorage.getItem("idea-board-index") || "{}").currentProjectId;
  const b = JSON.parse(localStorage.getItem("idea-board-project:" + cur)).boards[0];
  return b.notes.map((n) => ({ num: n.num, text: n.text, color: n.color, tags: n.tags, x: Math.round(n.x), y: Math.round(n.y) }));
});
async function openPreview() {
  await P.getByRole("button", { name: /^デバイス接続/ }).first().click();
  await P.waitForTimeout(1500);
  await P.getByRole("button", { name: /届いた付箋を見る/ }).click();
  await P.waitForTimeout(400);
}
const labels = () => P.locator("[data-plan]").allInnerTexts();
async function paste() {
  await P.getByRole("button", { name: /件をこのボードに貼る/ }).click();
  await P.waitForTimeout(1500);
}
async function receiveAll() { await openPreview(); const l = await labels(); await paste(); return l; }

console.log("■ 1) スマホで「りんご」を送り、パソコンで取り込む");
await write("りんご", { color: 0, tagsOn: ["メイン"] });
eq("受信箱に1件", inbox(), ["りんご@0"]);
eq("取り込み確認で、新しいものには区分を出さない", await receiveAll(), []);
const first = await pNotes();
eq("パソコンに #1 りんご", first.map((n) => [n.num, n.text, n.tags]), [[1, "りんご", ["メイン"]]]);
eq("受信箱は空", inbox(), []);

console.log("\n■ 8) 「やめる」・チェック・↑↓・✕では何も変わらない");
await write("下書きの確認用");
await tab("書く");
await M.locator("textarea").first().fill("書きかけの下書き");
const before = await mItems();
await openCard("りんご");
eq("タップで「書く」と同じ画面が開き、中身が入っている", await M.locator("textarea").first().inputValue(), "りんご");
eq("タブの名前が「直す」になる", await M.getByRole("button", { name: "直す" }).count(), 1);
await M.locator("textarea").first().fill("やめるので残らない");
await M.getByRole("button", { name: "やめる", exact: true }).click();
await M.waitForTimeout(500);
eq("やめると何も変わらない", await mItems(), before);
await tab("書く");
eq("書きかけの下書きが戻る", await M.locator("textarea").first().inputValue(), "書きかけの下書き");
await tab("ためた分");
if (await M.getByRole("button", { name: /^これまで全部/ }).count()) await M.getByRole("button", { name: /^これまで全部/ }).click();
await card("下書きの確認用").locator("input[type=checkbox]").click();
await card("下書きの確認用").getByRole("button", { name: "↑" }).click();
await M.waitForTimeout(300);
eq("チェックと↑では編集が開かない", await M.getByRole("button", { name: "直す" }).count(), 0);
await card("下書きの確認用").getByRole("button", { name: "✕" }).click();
await M.waitForTimeout(300);
eq("✕では編集が開かず、消える", [await M.getByRole("button", { name: "直す" }).count(), (await mItems()).map((i) => i.text)], [0, ["りんご"]]);
// スマホで消しても送った分は受信箱に残る（今の仕様）。この先の確認を分かりやすくするため、受信箱から片づける
for (const [k, d] of F.INBOX) if (d.fields.payload.stringValue.includes("下書きの確認用")) F.INBOX.delete(k);

console.log("\n■ 2) スマホで「みかん」に直す（色・タグも） → パソコンの #1 が書き換わる");
await editTo("りんご", "みかん", { color: 2, tagsToggle: ["メイン", "キャラクター"] });
const it = (await mItems())[0];
eq("スマホの付箋が直り、版が1になる（id と日時は同じ）", [it.text, it.color, it.tags, it.rev, it.id === before[0].id, it.t === before[0].t], ["みかん", 2, ["キャラクター"], 1, true, true]);
eq("受信箱が新しい内容に置き換わる（1件のまま）", inbox(), ["みかん@1"]);
eq("取り込み確認に「#1 を書き換え」", await receiveAll(), ["#1 を書き換え"]);
const second = await pNotes();
eq("パソコンの #1 が書き換わる（数・位置は同じ）", second.map((n) => [n.num, n.text, n.tags, n.x, n.y]), [[1, "みかん", ["キャラクター"], first[0].x, first[0].y]]);
eq("色も書き換わる", second[0].color !== first[0].color, true);

console.log("\n■ 3) パソコンで手を加えた付箋は上書きしない（両方残す）");
await P.locator("textarea").first().fill("みかん（PCで追記）");
await P.locator("textarea").first().evaluate((el) => el.blur());
await P.waitForTimeout(1500);
await editTo("みかん", "ぶどう");
eq("取り込み確認に「PCで編集済みのため新しく貼る」", await receiveAll(), ["#1 はPCで編集済みのため新しく貼る"]);
eq("#1 はパソコンの内容のまま、#2 ぶどうが増える", (await pNotes()).map((n) => [n.num, n.text]), [[1, "みかん（PCで追記）"], [2, "ぶどう"]]);

console.log("\n■ 6) 同じ版がもう一度届いても、貼らない");
await F.fetch("https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/inbox/r/items/" + it.id, {
  method: "PATCH", body: JSON.stringify({ fields: { payload: { stringValue: JSON.stringify({ ...(await mItems())[0], colorName: "x" }) } } }),
});
eq("取り込み確認に「取り込み済み」", await receiveAll(), ["取り込み済み"]);
eq("付箋は増えない", (await pNotes()).map((n) => n.text), ["みかん（PCで追記）", "ぶどう"]);
eq("受信箱からは消える", inbox(), []);

console.log("\n■ 5) パソコンが一覧を読んだあとにスマホが直す → 新しい方は消えない");
await editTo("ぶどう", "メロン");
await openPreview();
eq("読んだ時点では #2 の書き換え", await labels(), ["#2 を書き換え"]);
await editTo("メロン", "すいか");                       // パソコンが画面を開いている間に直して送る
eq("受信箱は すいか", inbox(), ["すいか@4"]);
await paste();                                            // パソコンは読んだとき（メロン）の内容を貼る
eq("パソコンにはメロン", (await pNotes()).map((n) => n.text), ["みかん（PCで追記）", "メロン"]);
eq("すいかは受信箱に残っている（消されていない）", inbox(), ["すいか@4"]);
eq("次の確認で「#2 を書き換え」", await receiveAll(), ["#2 を書き換え"]);
eq("すいかに書き換わる", (await pNotes()).map((n) => n.text), ["みかん（PCで追記）", "すいか"]);

console.log("\n■ 4) パソコンで剥がしてから直す → 新しく貼る");
// #2 の付箋を剥がす（付箋の ✕。確認は出ない）。付箋が重なっていることがあるので、「すいか」の付箋の ✕ を直接押す
await P.evaluate(() => {
  let e = [...document.querySelectorAll("textarea")].find((t) => t.value === "すいか");
  while (e && !e.querySelector?.('button[title="剥がす（中身も一緒）"]')) e = e.parentElement;
  e.querySelector('button[title="剥がす（中身も一緒）"]').click();
});
await P.waitForTimeout(1500);
eq("#2 を剥がした", (await pNotes()).map((n) => n.text), ["みかん（PCで追記）"]);
await editTo("すいか", "レモン");
// 同じ元の付箋はパソコンで手を加えた #1 だけが残っているので、上書きせず新しく貼る
eq("取り込み確認では #1 を上書きせず新しく貼る", await receiveAll(), ["#1 はPCで編集済みのため新しく貼る"]);
eq("レモンが新しく貼られる", (await pNotes()).map((n) => n.text), ["みかん（PCで追記）", "レモン"]);

console.log("\n■ 7) 電波なしで直す → 開き直す → 電波が戻ると新しい内容で届く");
// 偽サーバーは通信を横取りして返すので、ブラウザのオフライン（online イベント用）と、偽サーバー側の遮断の両方を使う
net.offline.add("M");
await M.context().setOffline(true);
await editTo("レモン", "オフラインで直した");
eq("送れず、未送信に残る", [inbox(), (await mUnsent()).length], [[], 1]);
await M.reload(); await M.waitForTimeout(2000);
eq("開き直しても未送信のまま", (await mUnsent()).length, 1);
net.offline.delete("M");
await M.context().setOffline(false);
await M.waitForTimeout(2500);
eq("電波が戻ると届く", inbox(), ["オフラインで直した@6"]);
eq("未送信が空になる", await mUnsent(), []);
eq("パソコンで取り込むと書き換え", await receiveAll(), ["#2 を書き換え"]);
eq("パソコンの付箋も直る", (await pNotes()).map((n) => n.text), ["みかん（PCで追記）", "オフラインで直した"]);

await done("スマホで直す");
