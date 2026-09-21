// ビルド前の簡易チェック。
// 「定義を消してしまったのに使っている」ような事故を、起動前に見つけるためのもの。
import fs from "fs";

const files = ["src/IdeaBoard.jsx", "src/MobileQuickAdd.jsx"];
let bad = 0;

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const s = fs.readFileSync(f, "utf8");
  const label = `[${f}]`;

  // 1) 括弧の対応
  for (const [a, b] of [["{", "}"], ["(", ")"], ["[", "]"]]) {
    const ca = s.split(a).length - 1;
    const cb = s.split(b).length - 1;
    if (ca !== cb) {
      console.error(`${label} 括弧の数が合いません: ${a}=${ca} ${b}=${cb}`);
      bad++;
    }
  }

  // 2) useState / useRef で作った名前が、すべて定義されているか
  const defined = new Set();
  for (const m of s.matchAll(/const\s*\[\s*([\w$]+)\s*,\s*([\w$]+)\s*\]\s*=\s*useState/g)) {
    defined.add(m[1]); defined.add(m[2]);
  }
  for (const m of s.matchAll(/const\s+([\w$]+)\s*=/g)) defined.add(m[1]);
  for (const m of s.matchAll(/function\s+([\w$]+)/g)) defined.add(m[1]);

  const allow = new Set(["setTimeout", "setInterval", "setItem", "setPointerCapture"]);
  const used = new Set();
  for (const m of s.matchAll(/\b(set[A-Z][\w$]*)\b/g)) used.add(m[1]);
  for (const name of used) {
    if (!defined.has(name) && !allow.has(name)) {
      console.error(`${label} 定義されていません: ${name}`);
      bad++;
    }
  }
}

if (bad > 0) {
  console.error(`\n問題が ${bad} 件あります。ビルドを中止しました。`);
  process.exit(1);
}
console.log("チェック: 問題ありません");
