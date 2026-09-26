// 1枚のHTMLを file:// で開いて、実際にアプリとして使えるかを確かめる
import { chromium } from "playwright";
import { pathToFileURL } from "url";
const F = pathToFileURL(process.env.F).href;   // 一番上の IdeaBoard.html
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const fatal = [];
page.on("pageerror", (e) => fatal.push("pageerror: " + e.message));

let ng = 0;
const eq = (l, got, want) => { if (String(got) !== String(want)) { console.error(`NG ${l}\n   得: ${got}\n   期: ${want}`); ng++; } else console.log(`ok ${l}（${got}）`); };

await page.goto(F);
await page.waitForTimeout(2500);

const bodyLen = await page.evaluate(() => (document.body.innerText || "").length);
eq("画面が描けている（白画面でない）", bodyLen > 100, true);
console.log("画面の冒頭:", (await page.evaluate(() => (document.body.innerText||"").slice(0,80))).replace(/\n/g," / "));

// 付箋を1枚貼ってみる（「＋ 追加」→「付箋」→「貼る」）
await page.getByText("＋ 追加", { exact: false }).first().click();
await page.waitForTimeout(400);
await page.getByText("付箋", { exact: true }).first().click();
await page.waitForTimeout(600);
const put = page.getByRole("button", { name: "貼る", exact: true });
if (await put.count()) { await put.first().click(); await page.waitForTimeout(700); }

const nums = await page.evaluate(() =>
  [...new Set([...document.querySelectorAll("*")].map(e => (e.textContent||"").trim()).filter(t => /^#\d+$/.test(t)))]);
console.log("  貼ったあとの番号:", JSON.stringify(nums));
eq("付箋を貼れた", nums.length >= 1, true);

// 保存されているか
await page.waitForTimeout(1500);
const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("idea-board")));
eq("localStorage に保存された", keys.length > 0, true);
console.log("  保存キー:", JSON.stringify(keys));

// 開き直しても残っているか
await page.goto("about:blank");
await page.goto(F);
await page.waitForTimeout(2500);
const nums2 = await page.evaluate(() =>
  [...new Set([...document.querySelectorAll("*")].map(e => (e.textContent||"").trim()).filter(t => /^#\d+$/.test(t)))]);
eq("開き直しても付箋が残っている", nums2.length >= 1, true);

if (fatal.length) { console.error("致命的なJSエラー:\n" + fatal.join("\n")); ng++; }
else console.log("ok 未捕捉の例外なし");

await browser.close();
console.log(ng === 0 ? "\n1枚HTML: すべて期待どおりです" : `\n1枚HTML: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
