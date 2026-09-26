// 実ブラウザの端末を、仕様どおりの偽 Firestore（../fakefs.mjs）につなぐための道具
import { chromium } from "playwright";
import { makeFakeFirestore } from "../fakefs.mjs";

export const CONF = { projectId: "p", apiKey: "k", room: "r" };
export const F = makeFakeFirestore();
export const net = { offline: new Set(), failList: false };
export const writes = [];   // サーバーの目次が書き換わった記録 { who, id, device, at }
export const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

async function route(r, who) {
  const req = r.request();
  const url = req.url();
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
  if (net.offline.has(who)) return r.abort("internetdisconnected");
  if (url.includes("/documents/inbox/")) return r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: '{"documents":[]}' });
  if (net.failList && req.method() === "GET" && /\/items(\?|$)/.test(url))
    return r.fulfill({ status: 500, contentType: "application/json", headers: cors, body: "{}" });
  let res;
  try { res = await F.fetch(url, { method: req.method(), body: req.postData() }); }
  catch (e) { return r.abort("connectionreset"); }
  const body = await res.json();
  if (req.method() === "PATCH" && res.ok) {
    const id = decodeURIComponent((url.match(/\/items\/([^?]+)/) || [])[1] || "");
    if (!id.startsWith("__")) writes.push({ who, id, at: Date.now(), ut: body.updateTime });
  }
  return r.fulfill({ status: res.status, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
}

// clockOffsetMs: この端末の時計のずれ
export async function device(who, { seed = null, base, clockOffsetMs = 0 } = {}) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  if (clockOffsetMs) await ctx.addInitScript((off) => { const n = Date.now; Date.now = () => n() + off; }, clockOffsetMs);
  await ctx.route(/googleapis\.com/, (r) => route(r, who));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  [${who}] pageerror:`, e.message));
  await page.goto(base);
  await page.evaluate(({ conf, seed }) => {
    localStorage.clear();
    localStorage.setItem("idea-board-cloud", JSON.stringify(conf));
    if (seed) localStorage.setItem("idea-board-state", JSON.stringify(seed));
  }, { conf: CONF, seed });
  await page.reload();
  await page.waitForTimeout(2500);
  return page;
}

export const notesOn = (page) => page.evaluate(() => {
  const cur = JSON.parse(localStorage.getItem("idea-board-index") || "{}").currentProjectId;
  const raw = localStorage.getItem("idea-board-project:" + cur);
  return raw ? JSON.parse(raw).boards[0].notes.map((n) => n.text) : [];
});
export const pidOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("idea-board-index")).currentProjectId);
export const backupsOf = (page) => page.evaluate(() => {
  const out = [];
  for (const k of Object.keys(localStorage)) if (k.startsWith("idea-board-backups:"))
    for (const b of JSON.parse(localStorage.getItem(k))) { try { out.push(...JSON.parse(b.data).boards.flatMap((x) => x.notes.map((n) => n.text))); } catch (e) {} }
  return out;
});
// サーバーにある版のボード1の付箋（新旧どちらの形式でも読む）
export function serverNotes(pid) {
  const head = F.DB.get(pid);
  if (!head) return null;
  const f = head.fields;
  if (f.payload) return JSON.parse(f.payload.stringValue).boards[0].notes.map((n) => n.text);
  const b = JSON.parse(f.meta.stringValue).boards[0];
  const id = (i) => (b.v ? `__b_${pid}_${b.id}_${b.v}_${i}` : `__b_${pid}_${b.id}_${i}`);
  const body = Array.from({ length: b.parts }, (_, i) => F.DB.get(id(i))?.fields.part.stringValue ?? "").join("");
  try { return JSON.parse(body).notes.map((n) => n.text); } catch (e) { return "読めない"; }
}
export async function typeInto(page, text) {
  const ta = page.locator("textarea").first();
  await ta.click();
  await ta.fill(text);
  await ta.evaluate((el) => el.blur());
}
export const banner = async (page) => (await page.getByText("両方で変更されています", { exact: false }).count()) > 0;

let ng = 0;
export const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };
export const done = async (label) => { await browser.close(); console.log(ng === 0 ? `\n${label}: すべて期待どおりです` : `\n${label}: ${ng} 件 期待と違います`); process.exit(ng ? 1 : 0); };

// 「控えを残せない」知らせが出ているときだけ、その知らせの ✕ で閉じる。
// 画面全体から ✕ を探すと、付箋の ✕（剥がす）を押してしまう。
export async function closeKeepFail(page) {
  const msg = page.getByText("控えを残せないため", { exact: false });
  if ((await msg.count()) === 0) return false;
  await msg.first().locator("xpath=..").getByRole("button", { name: "✕" }).click({ timeout: 2000 });
  return true;
}
