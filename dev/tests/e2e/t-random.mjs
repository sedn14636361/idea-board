// 組み合わせの試験: 3台で、編集・待つ・開き直す・オフライン・競合での選択（容量一杯を含む）を乱数で組み合わせ、
// 最後に「書いた文章が1つ残らず、どこかの端末の中身・復元ポイント・サーバーの今の版から取り出せるか」を確かめる。
// 利用者が画面で見たうえで書き換えたもの（自分で上書きした文）は数えない。
// 除外（ユーザー判断）: 閉じる直前0.8秒の編集／控え6件の押し出し／保存失敗の6秒表示 → これらに触れる操作はしない
import { device, pidOf, serverNotes, banner, F, net, browser, writes, closeKeepFail } from "./harness.mjs";
const BASE = process.env.BASE;
const SEED = Number(process.env.SEED || 1);
const STEPS = Number(process.env.STEPS || 30);

let s = SEED >>> 0;                                   // 再現できる乱数（mulberry32）
const rnd = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

const log = [];
const errors = [];
const D = {};
const names = ["A", "B", "C"];
const offsets = { A: 0, B: -7 * 60000, C: 3 * 60000 };

D.A = await device("A", { base: BASE, clockOffsetMs: offsets.A, seed: { notes: [{ id: "a1", num: 1, x: 60, y: 120, text: "元" }], edges: [] } });
await D.A.waitForTimeout(4000);
const PID = await pidOf(D.A);
for (const n of ["B", "C"]) { D[n] = await device(n, { base: BASE, clockOffsetMs: offsets[n] }); await D[n].waitForTimeout(3500); }
for (const n of names) D[n].on("pageerror", (e) => errors.push(`${n}: ${e.message}`));

const typed = [];            // { token, by, step }
const superseded = new Set();   // 利用者が画面で見たうえで書き換えた文
const discarded = new Set();    // 競合の案内で、利用者がもう一方を選んで捨てた文
let k = 0;
const screenText = (p) => p.evaluate(() => { const t = document.querySelector("textarea"); return t ? t.value : null; });

for (let step = 1; step <= STEPS; step++) {
  const who = pick(names);
  const p = D[who];
  const r = rnd();
  try {
    if (r < 0.35) {                                   // 編集（画面に見えていた文を、利用者が自分で書き換える）
      const before = await screenText(p);
      if (before === null) { log.push(`${step} ${who} 編集できず`); continue; }
      const token = `${who}${++k}`;
      const ta = p.locator("textarea").first();
      await ta.fill(token, { timeout: 5000 });
      await ta.evaluate((el) => el.blur());
      if (before) superseded.add(before);
      typed.push({ token, by: who, step });
      log.push(`${step} ${who} 編集 ${before}→${token}`);
      await p.waitForTimeout(1500);                   // 手元の保存（0.8秒）が済むまで待つ（除外経路に触れない）
    } else if (r < 0.55) {
      const ms = Math.floor(rnd() * 6000);
      log.push(`${step} 待つ ${ms}ms`);
      await p.waitForTimeout(ms);
    } else if (r < 0.70) {
      log.push(`${step} ${who} 開き直す`);
      await p.reload();
      await p.waitForTimeout(3500);
    } else if (r < 0.80) {
      if (net.offline.has(who)) { net.offline.delete(who); log.push(`${step} ${who} オンライン`); }
      else { net.offline.add(who); log.push(`${step} ${who} オフライン`); }
    } else {
      if (!(await banner(p))) { log.push(`${step} ${who} （案内なし）`); continue; }
      const choice = rnd() < 0.5 ? "サーバーの方" : "この端末の方";
      const full = choice === "サーバーの方" && rnd() < 0.5;
      if (full) await p.evaluate(() => { let i = 0; for (const size of [256 * 1024, 16 * 1024, 1024, 64, 4]) { const c = "x".repeat(size); try { for (;;) { localStorage.setItem("zz" + i, c); i++; } } catch (e) {} } });
      const before = await screenText(p);
      const serverBefore = serverNotes(PID);
      await p.getByRole("button", { name: choice }).first().click({ timeout: 5000 });
      await p.waitForTimeout(3000);
      const after = await screenText(p);
      // 「サーバーの方」で画面が変わった → この端末の文を捨てた／「この端末の方」で送れた → サーバーにあった文を捨てた
      if (choice === "サーバーの方" && after !== before && before) discarded.add(before);
      if (choice === "この端末の方" && Array.isArray(serverBefore) && JSON.stringify(serverNotes(PID)) !== JSON.stringify(serverBefore))
        for (const t of serverBefore) if (t !== after) discarded.add(t);
      // 「サーバーの方」を選んで画面が変わった＝利用者が手元の版を捨てることを選んだ（控えに残る前提）
      log.push(`${step} ${who} 競合で「${choice}」${full ? "（容量一杯）" : ""} ${before}→${after}`);
      if (full) await p.evaluate(() => { for (const x of Object.keys(localStorage)) if (x.startsWith("zz")) localStorage.removeItem(x); });
      await closeKeepFail(p).catch(() => {});
    }
  } catch (e) {
    log.push(`${step} ${who} 操作失敗: ${String(e.message).split("\n")[0]}`);
  }
}

// 落ち着かせる: 全員オンラインにして待ち、開き直す（競合の選択は利用者に任せたまま）
net.offline.clear();
for (const n of names) await D[n].waitForTimeout(4000);
for (const n of names) { await D[n].reload(); await D[n].waitForTimeout(4000); }

// どこから取り出せるか
const where = {};
let rotation = false;
for (const n of names) {
  const snap = await D[n].evaluate(() => {
    const texts = (proj) => (proj.boards || []).flatMap((b) => (b.notes || []).map((x) => x.text));
    const out = { project: [], backups: [], backupCount: 0, screen: [...document.querySelectorAll("textarea")].map((t) => t.value),
      projects: [], current: null, startOpen: !!document.body.innerText.match(/プロジェクトを選ぶ|どのプロジェクトを開きますか/) };
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("idea-board-project:")) { const p = JSON.parse(localStorage.getItem(key)); out.project.push(...texts(p)); out.projects.push(p.id + ":" + p.name); }
      if (key.startsWith("idea-board-backups:")) {
        const list = JSON.parse(localStorage.getItem(key));
        out.backupCount = Math.max(out.backupCount, list.length);
        for (const b of list) { try { out.backups.push(...texts(JSON.parse(b.data))); } catch (e) {} }
      }
    }
    try { out.current = JSON.parse(localStorage.getItem("idea-board-index")).currentProjectId; } catch (e) {}
    return out;
  });
  if (snap.backupCount >= 6) rotation = true;
  where[n] = snap;
}
const server = serverNotes(PID);
const has = (arr, tok) => arr.includes(tok);
const lost = [];          // 黙って消えた（どの端末の今の中身にも、サーバーの今の版にも無い）
for (const t of typed) {
  if (superseded.has(t.token) || discarded.has(t.token)) continue;
  const current = names.some((n) => has(where[n].project, t.token) || has(where[n].screen, t.token)) ||
    (Array.isArray(server) && server.includes(t.token));
  if (current) continue;
  const inBackup = names.filter((n) => has(where[n].backups, t.token));
  lost.push({ ...t, 控えにはある: inBackup.join("・") || "なし" });
}
const serverOk = Array.isArray(server);
const kept = typed.filter((t) => !superseded.has(t.token) && !discarded.has(t.token)).length;
console.log(`seed=${SEED} 手順=${STEPS} 書いた文=${typed.length} 書き換えた=${[...superseded].filter((x) => typed.some((t) => t.token === x)).length} 選んで捨てた=${[...discarded].filter((x) => typed.some((t) => t.token === x)).length} 確かめた=${kept} 黙って消えた=${lost.length} サーバー読める=${serverOk} 例外=${errors.length}`);
if (lost.length || !serverOk || errors.length || process.env.VERBOSE) {
  for (const n of names) console.log(`  ${n}: 開いている=${where[n].current} 手元=${JSON.stringify(where[n].projects)} 画面=${JSON.stringify(where[n].screen)} 控え=${JSON.stringify(where[n].backups)} 選択画面=${where[n].startOpen}`);
  console.log("  サーバー:", JSON.stringify(server), " 目次:", JSON.stringify([...F.DB.keys()].filter((x) => !x.startsWith("__"))));
  console.log("  目次の書き換え:", JSON.stringify(writes.map((w) => `${w.who}:${w.id}`)));
  console.log("  黙って消えた:", JSON.stringify(lost));
  console.log("  例外:", JSON.stringify(errors));
  console.log("  手順:\n    " + log.join("\n    "));
}
await browser.close();
process.exit(lost.length || !serverOk || errors.length ? 1 : 0);
