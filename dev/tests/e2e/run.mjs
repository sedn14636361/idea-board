// 実ブラウザの試験をすべて流す: npm run test:e2e（先に dist と一番上の IdeaBoard.html を作っておく）
//   特定のものだけ: npm run test:e2e -- t-sync skew
//   組み合わせの試験の回数: SEEDS="1 2 3 4 5 6" npm run test:e2e -- t-random
//   ブラウザの場所を指定: CHROMIUM_PATH=... （無ければ npx playwright install chromium で入れたもの）
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { serve } from "./serve.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../../dist");
const html = path.resolve(here, "../../../IdeaBoard.html");
const web = await serve(dist);
const BASE = `http://127.0.0.1:${web.port}/index.html`;
const FILE = pathToFileURL(html).href;
const seeds = (process.env.SEEDS || "1 2 3").split(/\s+/).filter(Boolean);

// [名前, ファイル, 追加の環境変数]
const all = [
  ["smoke", "smoke.mjs", { BASE }],                                  // クラウド無し・番号詰め
  ["single-file", "single-file.mjs", { F: html }],                   // HTML 1枚を file:// で
  ["skew", "skew.mjs", { BASE }],                                    // 時計のずれ
  ["t-sync", "t-sync.mjs", { BASE }],                                // 2台同期8場面（http）
  ["t-sync-file", "t-sync.mjs", { BASE: FILE }],                     // 2台同期8場面（HTML 1枚・file://）
  ["t-quota", "t-quota.mjs", { BASE }],                              // 容量一杯
  ["t-list", "t-list.mjs", { BASE }],                                // 100件超・一覧の失敗
  ["t-blank", "t-blank.mjs", { BASE }],                              // 白紙判定
  ["persist", "persist.mjs", { HTML: html, DIST: dist }],            // 設定の保持
  ["sw-scope", "sw-scope.mjs", { NEW: dist }],                       // PC版とスマホ版を同じ場所に置く（Pages）
  ...seeds.map((s) => [`t-random#${s}`, "t-random.mjs", { BASE, SEED: s }]),   // 組み合わせの試験
];
const want = process.argv.slice(2);
const run = want.length ? all.filter(([name]) => want.some((w) => name === w || name.startsWith(w + "#") || name.startsWith(w + "-"))) : all;

// spawnSync だと待っている間この中のサーバーが応答できず、ページが開けない。非同期で待つ
function runOne(file, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--no-warnings", file], { env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill(), 15 * 60 * 1000);
    child.on("close", (status) => { clearTimeout(timer); resolve({ status, out }); });
  });
}

let failed = 0;
for (const [name, file, env] of run) {
  const t0 = Date.now();
  const r = await runOne(path.join(here, file), { ...process.env, ...env });
  const out = r.out;
  const ok = r.status === 0;
  if (!ok) failed++;
  const summary = (out.match(/^(?:.*: (?:すべて期待どおりです|\d+ 件 期待と違います)|seed=.*)$/m) || [""])[0];
  console.log(`${ok ? "通過" : "失敗"}  ${name.padEnd(14)} ${Math.round((Date.now() - t0) / 1000)}秒  ${summary}`);
  if (!ok || process.env.VERBOSE) console.log(out.replace(/^/gm, "    "));
}
await web.close();
console.log(failed ? `\n実ブラウザの試験: ${failed} 件 失敗` : `\n実ブラウザの試験: ${run.length} 件すべて通過`);
process.exit(failed ? 1 : 0);
