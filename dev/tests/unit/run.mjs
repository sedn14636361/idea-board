// 単体試験をすべて流す: npm test
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(here).filter((f) => f.endsWith(".test.mjs")).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ["--no-warnings", path.join(here, f)], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? "通過" : "失敗"}  ${f}`);
  if (!ok || process.env.VERBOSE) console.log(out.replace(/^/gm, "    "));
}
console.log(failed ? `\n単体試験: ${failed} 件 失敗` : `\n単体試験: ${files.length} 件すべて通過`);
process.exit(failed ? 1 : 0);
