// スマホ版: 新しい版を公開したら、開き直さなくても（画面に戻ってきたときに）知らせが出て、切り替えられるか
//   DIST: 今の dist。これを元に、版の文字とファイル名だけ変えた「次の版」(9.9.9) を作って公開し直す
//   サーバーは GitHub Pages と同じく 10 分のキャッシュ（Cache-Control: max-age=600）で返す
import { chromium } from "playwright";
import fs from "fs";
import { servePages, makeNext } from "./pages.mjs";

const DIST = process.env.DIST;
const VERSION = (fs.readFileSync(new URL("../../src/version.js", import.meta.url), "utf8").match(/APP_VERSION\s*=\s*"([^"]+)"/) || [])[1];
const NEXT = "9.9.9";

const NEXTDIR = makeNext(DIST, VERSION, NEXT);

let dir = DIST;
const web = await servePages(() => dir);
const URL_ = web.base + "mobile.html";

let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext();
const pg = await ctx.newPage();
pg.on("pageerror", (e) => console.log("  pageerror:", e.message));
const shown = async () => (await pg.locator("body").innerText()).match(/版 ([\w.]+)/)?.[1];
const bar = () => pg.getByText("新しい版があります").count();
const ta = () => pg.locator("textarea").first();

console.log(`■ ${VERSION} を入れて使っている`);
await pg.goto(URL_); await pg.waitForTimeout(2500);
await pg.goto(URL_); await pg.waitForTimeout(4000);
eq(`${VERSION} が出ている`, await shown(), VERSION);
eq("知らせは出ていない", await bar(), 0);
await ta().fill("1枚目");
await pg.getByRole("button", { name: "＋ アイデアボックスに入れる" }).click();
await pg.waitForTimeout(500);

console.log(`\n■ ${NEXT} を公開 → 開き直さずに画面へ戻ってくる`);
dir = NEXTDIR;
await pg.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
await pg.waitForTimeout(5000);
eq("「新しい版があります」が出る", await bar(), 1);
eq("まだ切り替わってはいない（書いている途中で勝手に変わらない）", await shown(), VERSION);

console.log("\n■ 直している間は知らせを出さない");
await pg.getByRole("button", { name: /^ためた分/ }).click();
await pg.locator("[data-item]", { hasText: "1枚目" }).first().locator("div", { hasText: "1枚目" }).last().click();
await pg.waitForTimeout(300);
eq("直している間は出ない", await bar(), 0);
await pg.getByRole("button", { name: "やめる", exact: true }).click();
await pg.waitForTimeout(300);
eq("やめると出る", await bar(), 1);

console.log("\n■ 「切り替える」");
await pg.getByRole("button", { name: /^書く/ }).click();
await ta().fill("書きかけの本文");
await pg.getByRole("button", { name: "切り替える" }).click();
await pg.waitForTimeout(3500);
eq(`${NEXT} に切り替わる`, await shown(), NEXT);
eq("書きかけの本文は残る", await ta().inputValue(), "書きかけの本文");
eq("書いた付箋も残っている", (await pg.evaluate(() => JSON.parse(localStorage.getItem("idea-board-inbox") || "[]"))).map((i) => i.text), ["1枚目"]);
eq("知らせは消える", await bar(), 0);

console.log("\n■ 切り替えたあと、電波が無くても開ける");
await ctx.setOffline(true);
await pg.reload(); await pg.waitForTimeout(2500);
eq(`電波なしでも ${NEXT} が開く`, await shown(), NEXT);
await ctx.setOffline(false);

await b.close(); await web.close();
fs.rmSync(NEXTDIR, { recursive: true, force: true });
console.log(ng === 0 ? "\n新しい版の知らせ: すべて期待どおりです" : `\n新しい版の知らせ: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
