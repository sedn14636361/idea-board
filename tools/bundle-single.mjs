// HTML 1枚で動く版を作る。できあがりは release/IdeaBoard.html
// ダブルクリックで開けば、インストールなしでそのまま使える。
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const tmp = path.resolve("release/.single");
const out = path.resolve("release/IdeaBoard.html");

execSync("npx vite build --config vite.single.config.js", {
  stdio: "inherit",
  env: { ...process.env, SINGLE_OUT: tmp },
});

let html = fs.readFileSync(path.join(tmp, "index.html"), "utf8");
const js = fs.readFileSync(path.join(tmp, "app.js"), "utf8");

// 外部の JS を、その場に埋め込んだ module に置き換える
let replaced = 0;
html = html.replace(/<script type="module"[^>]*src="\.\/app\.js"[^>]*><\/script>/, () => {
  replaced++;
  // 中身に </script> があると HTML の途中で切れてしまうので逃がす
  return `<script type="module">\n${js.replace(/<\/script>/g, "<\\/script>")}\n</script>`;
});
if (replaced !== 1) {
  console.error("JS の読み込み部分が見つかりませんでした。index.html の形が変わっていないか確認してください。");
  process.exit(1);
}

// 1枚で完結させるため、別ファイル頼りの記述を外す（file:// では読めない）
html = html.replace(/\s*<link[^>]*rel="manifest"[^>]*>/g, "");
html = html.replace(/\s*<link[^>]*rel="(apple-touch-)?icon"[^>]*>/g, "");

// 取りこぼしが無いか確かめる
const left = [...html.matchAll(/(?:src|href)="(?!data:|https?:|#)([^"]+)"/g)].map((m) => m[1]);
if (left.length) {
  console.error("外部ファイルへの参照が残っています:", left);
  process.exit(1);
}

fs.writeFileSync(out, html);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nできました: ${path.relative(process.cwd(), out)}（${Math.round(fs.statSync(out).size / 1024)} KB）`);
console.log("ダブルクリックで開けば、そのまま使えます。");
