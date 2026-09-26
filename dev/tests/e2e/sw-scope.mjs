// PC 版とスマホ版を同じ場所に置いたとき（GitHub Pages）、互いを横取りしないか
//   NEW=新しい dist（必須） / OLD=比べる古い dist（任意。あれば古い版から更新した端末も確かめる）
// 6.1.0 まではスマホ版を一度開くと、PC 版のアドレスでもスマホ版が出続けていた
import { chromium } from "playwright";
import fs from "fs";
import os from "os";
import path from "path";
import { serve } from "./serve.mjs";
const { OLD, NEW } = process.env;
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ib-sw-"));
const put = (src) => { fs.rmSync(ROOT + "/idea-board", { recursive: true, force: true }); fs.cpSync(src, ROOT + "/idea-board", { recursive: true }); };
const web = await serve(ROOT);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const u = (p) => `http://127.0.0.1:${web.port}/idea-board/${p}`;
let bad = 0;
async function step(pg, label, path, want) {
  await pg.goto(u(path)).catch((e) => console.log("  goto err", e.message.slice(0, 50)));
  await pg.waitForTimeout(2500);
  const t = (await pg.locator("body").innerText().catch(() => "")).slice(0, 200);
  const got = t.includes("アイデアボックス") ? "スマホ版" : t.includes("タグ一覧") ? "PC版" : "表示なし";
  const info = await pg.evaluate(async () => ({ ctrl: navigator.serviceWorker.controller?.scriptURL.split("/").pop() || null, caches: await caches.keys(),
    regs: (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope.split("/idea-board/")[1] + "→" + (r.active?.scriptURL.split("/").pop())) })).catch(() => ({}));
  const ok = got === want; if (!ok) bad++;
  console.log(`${ok ? "ok " : "NG "} ${label.padEnd(30)} 期待 ${want} / 表示 ${got} | ${JSON.stringify(info)}`);
}
// A: 新しい版だけ
put(NEW);
{ const ctx = await b.newContext(); const pg = await ctx.newPage();
  console.log("A: 新しい版で、スマホ版→PC版の順に開く");
  await step(pg, "mobile.html", "mobile.html", "スマホ版");
  await step(pg, "mobile.html 2回目", "mobile.html", "スマホ版");
  await step(pg, "index.html", "index.html", "PC版");
  await step(pg, "index.html 2回目", "index.html", "PC版");
  await step(pg, "mobile.html に戻る", "mobile.html", "スマホ版");
  await ctx.setOffline(true);
  await step(pg, "オフラインで mobile.html", "mobile.html", "スマホ版");
  await step(pg, "オフラインで index.html", "index.html", "PC版");
  await ctx.close(); }
{ const ctx = await b.newContext(); const pg = await ctx.newPage();
  console.log("A2: 新しい版で、PC版→スマホ版の順に開く");
  await step(pg, "index.html", "index.html", "PC版");
  await step(pg, "index.html 2回目", "index.html", "PC版");
  await step(pg, "mobile.html", "mobile.html", "スマホ版");
  await step(pg, "mobile.html 2回目", "mobile.html", "スマホ版");
  await step(pg, "index.html に戻る", "index.html", "PC版");
  await ctx.setOffline(true);
  await step(pg, "オフラインで mobile.html", "mobile.html", "スマホ版");
  await step(pg, "オフラインで index.html", "index.html", "PC版");
  await ctx.close(); }
// B: 古い版でスマホ版を入れた端末が、新しい版に更新される
if (OLD) { put(OLD); const ctx = await b.newContext(); const pg = await ctx.newPage();
  console.log("B: 古い版でスマホ版を入れた端末（PC版が化ける状態）→ 新しい版を公開");
  await step(pg, "[旧] mobile.html", "mobile.html", "スマホ版");
  await step(pg, "[旧] mobile.html 2回目", "mobile.html", "スマホ版");
  put(NEW);
  await step(pg, "[新] mobile.html（1回目は保存分）", "mobile.html", "スマホ版");
  await step(pg, "[新] mobile.html 2回目", "mobile.html", "スマホ版");
  await step(pg, "[新] index.html", "index.html", "PC版");
  await step(pg, "[新] index.html 2回目", "index.html", "PC版");
  await ctx.setOffline(true);
  await step(pg, "オフラインで mobile.html", "mobile.html", "スマホ版");
  await ctx.close(); }
// C: 古い版でスマホ版を入れ、新しい版の公開後にスマホ版を開かずPC版を開く
if (OLD) { put(OLD); const ctx = await b.newContext(); const pg = await ctx.newPage();
  console.log("C: 旧版スマホ版 → 新しい版を公開 → いきなりPC版を開く");
  await step(pg, "[旧] mobile.html", "mobile.html", "スマホ版");
  await step(pg, "[旧] mobile.html 2回目", "mobile.html", "スマホ版");
  put(NEW);
  for (let i = 1; i <= 3; i++) await step(pg, `[新] index.html ${i}回目`, "index.html", i === 1 ? "スマホ版" : "PC版");
  await step(pg, "[新] mobile.html", "mobile.html", "スマホ版");
  await ctx.setOffline(true);
  await step(pg, "オフラインで mobile.html", "mobile.html", "スマホ版");
  await ctx.close(); }
await b.close(); await web.close();
fs.rmSync(ROOT, { recursive: true, force: true });
console.log(bad ? `同じ場所の2つのSW: ${bad} 件 期待と違います` : "同じ場所の2つのSW: すべて期待どおりです");
process.exit(bad ? 1 : 0);
