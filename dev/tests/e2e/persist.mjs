// クラウド同期の設定が保持されるか。設定は画面から入力し、ブラウザを完全に終了して起動し直しても残るかを見る
import { chromium } from "playwright";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { makeFakeFirestore } from "../fakefs.mjs";
import { serve } from "./serve.mjs";

// 一時フォルダに「HTML 1枚版」と「Pages 相当の配信物」を用意する（元のファイルは触らない）
const SP = fs.mkdtempSync(path.join(os.tmpdir(), "ideaboard-persist-"));
fs.mkdirSync(`${SP}/persist/a`, { recursive: true });
fs.mkdirSync(`${SP}/persist/b`, { recursive: true });
fs.copyFileSync(process.env.HTML, `${SP}/persist/a/IdeaBoard.html`);
fs.cpSync(process.env.DIST, `${SP}/persist/web`, { recursive: true });
const web = await serve(`${SP}/persist/web`);
process.env.PORT = String(web.port);
const EXE = process.env.CHROMIUM_PATH || undefined;
const CONF = { projectId: "test-proj", apiKey: "AIzaTEST0000", room: "room-test-1234567890" };
const F = makeFakeFirestore();
let hits = 0;                                                   // test-proj 宛ての通信の数（設定が使われている証拠）
let seen = [];                                                  // 起動し直したあとに出た通信（何をしに行ったか）
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };

async function route(r) {
  const req = r.request(); const url = req.url();
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
  if (url.includes("/projects/test-proj/")) { hits++; seen.push(req.method() + " " + url.replace(/^.*\/documents\//, "").replace(/\?.*$/, "")); }
  if (url.includes("/documents/inbox/")) return r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: '{"documents":[]}' });
  const res = await F.fetch(url, { method: req.method(), body: req.postData() });
  return r.fulfill({ status: res.status, contentType: "application/json", headers: cors, body: JSON.stringify(await res.json()) });
}
// ディスク上のプロファイルでブラウザを起動する（閉じると本当にブラウザが終了する）
async function open(profile, url) {
  const ctx = await chromium.launchPersistentContext(`${SP}/persist/profile-${profile}`, { executablePath: EXE, headless: true });
  await ctx.route(/googleapis\.com/, route);
  const page = ctx.pages()[0] || await ctx.newPage();
  hits = 0; seen = [];                                          // ここから数える
  await page.goto(url);
  await page.waitForTimeout(2500);
  return { ctx, page };
}
const conf = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("idea-board-cloud")); } catch (e) { return "読めない"; } });
const usedAfter = async (page, ms = 4000) => { const h = hits; await page.waitForTimeout(ms); return hits - h; };

// PC版: 画面から設定を入れる
async function enterPC(page) {
  await page.getByText("デバイス接続").first().click();
  await page.getByText("かんたん設定をはじめる").first().click();
  for (let i = 0; i < 6; i++) {
    const next = page.getByRole("button", { name: "できた、次へ" });
    if (await next.count() === 0) break;
    await next.click(); await page.waitForTimeout(200);
  }
  await page.getByLabel("プロジェクトID").fill(CONF.projectId);
  await page.getByLabel("APIキー").fill(CONF.apiKey);
  await page.getByLabel("合言葉", { exact: false }).fill(CONF.room);
  await page.getByRole("button", { name: "つないでみる" }).click();
  await page.getByRole("button", { name: "設定を終える" }).waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: "設定を終える" }).click();
  await page.waitForTimeout(1500);
}
// スマホ版: ⚙ から設定を入れる
async function enterMobile(page) {
  await page.getByTitle("設定").first().click();
  await page.getByPlaceholder("プロジェクトID").fill(CONF.projectId);
  await page.getByPlaceholder("APIキー").fill(CONF.apiKey);
  await page.getByPlaceholder("合言葉").fill(CONF.room);
  await page.getByRole("button", { name: "保存して確認" }).click();
  await page.waitForTimeout(2500);
}

async function scenario(label, profile, url, enter, extra) {
  console.log(`\n■ ${label}`);
  let { ctx, page } = await open(profile, url);
  eq("最初は設定が無い", await conf(page), null);
  await enter(page);
  eq("1) 画面から入れた設定が保存された", await conf(page), CONF);
  await page.reload(); await page.waitForTimeout(2500);
  eq("2) 再読み込みしても残る", await conf(page), CONF);
  await ctx.close();                                              // ブラウザを完全に終了
  ({ ctx, page } = await open(profile, url));
  eq("3) ブラウザを終了して起動し直しても残る", await conf(page), CONF);
  await page.waitForTimeout(3000);
  console.log(`  起動し直してから出た通信（${hits}件）: ${JSON.stringify([...new Set(seen)])}`);
  eq("3) 入力し直さなくても、その設定で同期が動く", hits > 0, true);
  if (extra) await extra(ctx, page);
  await ctx.close();
}

const fileA = pathToFileURL(`${SP}/persist/a/IdeaBoard.html`).href;
await scenario("PC版・HTML 1枚（file://）", "html", fileA, enterPC, async (ctx, page) => {
  // 4) 新しい版を同じ場所に上書き（中身が変わったファイルに置き換える）
  fs.writeFileSync(`${SP}/persist/a/IdeaBoard.html`, fs.readFileSync(`${SP}/persist/a/IdeaBoard.html`, "utf8") + "\n<!-- new version -->\n");
  await page.goto("about:blank"); await page.goto(fileA); await page.waitForTimeout(2500);
  eq("4) 同じ場所に新しい版を上書きしても残る", await conf(page), CONF);
  // 5) 別の場所・別の名前で開く
  fs.copyFileSync(`${SP}/persist/a/IdeaBoard.html`, `${SP}/persist/b/IdeaBoard (1).html`);
  await page.goto(pathToFileURL(`${SP}/persist/b/IdeaBoard (1).html`).href); await page.waitForTimeout(2500);
  const other = await conf(page);
  console.log(`  5) 別の場所・別の名前で開いたとき: ${other ? "残っている" : "残っていない"}`);
  eq("5) 別の場所・別の名前でも残る", other, CONF);
  // 7) https（Pages 相当）では別扱い
  await page.goto(`http://127.0.0.1:${process.env.PORT}/index.html`); await page.waitForTimeout(2500);
  const web = await conf(page);
  console.log(`  7) 同じブラウザで Pages 相当のアドレスを開いたとき: ${web ? "設定あり" : "設定なし"}`);
});

await scenario("PC版・Pages 相当（http で配信）", "web", `http://127.0.0.1:${process.env.PORT}/index.html`, enterPC, async (ctx, page) => {
  // 4) 同じアドレスの中身が新しい版に変わる
  const p = `${SP}/persist/web/index.html`;
  fs.writeFileSync(p, fs.readFileSync(p, "utf8") + "\n<!-- new version -->\n");
  await page.goto("about:blank"); await page.goto(`http://127.0.0.1:${process.env.PORT}/index.html`); await page.waitForTimeout(2500);
  eq("4) 同じアドレスで新しい版になっても残る", await conf(page), CONF);
});

await scenario("スマホ版（ブラウザで開いた場合）", "mobile", `http://127.0.0.1:${process.env.PORT}/mobile.html`, enterMobile);

await web.close();
fs.rmSync(SP, { recursive: true, force: true });
console.log(ng === 0 ? "\n設定の保持: すべて期待どおりです" : `\n設定の保持: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
