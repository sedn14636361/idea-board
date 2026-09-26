import { chromium } from "playwright";

const BASE = process.env.BASE;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();

const fatal = [];   // 白画面につながる例外
page.on("pageerror", (e) => fatal.push("pageerror: " + e.message));

// 飛び番号のある旧形式データを仕込む（#3 が欠番、本文に #4 #5 の参照あり）
const seed = {
  notes: [
    { id: "a", num: 1, x: 40,  y: 60,  text: "最初の付箋" },
    { id: "b", num: 2, x: 260, y: 60,  text: "#4 を見よ" },
    { id: "c", num: 4, x: 480, y: 60,  text: "これは4番" },
    { id: "d", num: 5, x: 700, y: 60,  text: "#5 と #999" },
  ],
  edges: [],
};
await page.goto(BASE);
await page.evaluate((s) => { localStorage.clear(); localStorage.setItem("idea-board-state", JSON.stringify(s)); }, seed);
await page.reload();
await page.waitForTimeout(1500);

const saved = () =>
  page.evaluate(() => {
    const k = Object.keys(localStorage).filter((x) => x.startsWith("idea-board-project:"));
    if (!k.length) return null;
    const b = JSON.parse(localStorage.getItem(k[0])).boards[0];
    return { nums: b.notes.map((n) => n.num), texts: b.notes.map((n) => n.text), nextNum: b.nextNum };
  });
const onScreen = () =>
  page.evaluate(() =>
    [...new Set([...document.querySelectorAll("*")]
      .map((e) => (e.textContent || "").trim())
      .filter((t) => /^#\d+$/.test(t)))].sort((a, b) => +a.slice(1) - +b.slice(1))
  );

let ng = 0;
const eq = (label, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${label}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log("ok " + label);
};

// --- 1) 読み込み時の詰め直し ---
const afterLoad = await saved();
console.log("読み込み後:", JSON.stringify(afterLoad));
eq("読み込みで 1..4 に詰まる", afterLoad.nums, [1, 2, 3, 4]);
eq("本文の参照が追従", afterLoad.texts, ["最初の付箋", "#3 を見よ", "これは4番", "#4 と #999"]);
eq("nextNum が 5", afterLoad.nextNum, 5);
eq("画面の番号が #1..#4", await onScreen(), ["#1", "#2", "#3", "#4"]);

// --- 2) 実際に付箋を剥がして繰り上がるか ---
await page.locator('button[title="剥がす（中身も一緒）"]').first().click();
await page.waitForTimeout(1500);
const afterDel = await saved();
console.log("削除後:", JSON.stringify(afterDel));
eq("削除で 1..3 に繰り上がる", afterDel.nums, [1, 2, 3]);
eq("削除後も本文の参照が追従", afterDel.texts, ["#2 を見よ", "これは4番", "#3 と #999"]);
eq("削除後の nextNum が 4", afterDel.nextNum, 4);
eq("画面の番号が #1..#3", await onScreen(), ["#1", "#2", "#3"]);

// --- 3) 剥がしたあとも描画が生きているか ---
const bodyLen = await page.evaluate(() => document.body.innerText.length);
eq("画面が白くなっていない", bodyLen > 50, true);
if (fatal.length) { console.error("致命的なJSエラー:\n" + fatal.join("\n")); ng++; }
else console.log("ok 未捕捉の例外なし");

await browser.close();
console.log(ng === 0 ? "\nE2E: すべて期待どおりです" : `\nE2E: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
