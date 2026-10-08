// 変更箇所のスクリーンショットを撮る道具（ユーザー指定: 変更したら、変更箇所のスクリーンショットを示す）
//   const { page, close } = await phone();          // スマホの大きさの画面
//   await mark(page, page.getByText("…"), "① 何が変わったか");
//   await page.screenshot({ path: "…/変更後-1-….png" });
// 変更前（main の build）と変更後を同じ手順で撮り、並べて示す
import { chromium } from "playwright";
export { chromium };

export async function phone({ width = 390, height = 640 } = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  return { browser, ctx, page, close: () => browser.close() };
}

export async function desktop({ width = 1280, height = 800 } = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  return { browser, ctx, page, close: () => browser.close() };
}

// 赤枠と見出しで示す。見出しは枠の上（画面の上端に近ければ下）に出す
export async function mark(page, locator, label) {
  const b = await locator.first().boundingBox();
  if (!b) throw new Error(`示す場所が見つかりません: ${label}`);
  await page.evaluate(({ b, label }) => {
    const d = document.createElement("div");
    d.className = "__mark";
    Object.assign(d.style, {
      position: "fixed", left: b.x - 4 + "px", top: b.y - 4 + "px", width: b.width + 8 + "px", height: b.height + 8 + "px",
      border: "3px solid #E0245E", borderRadius: "8px", zIndex: 2147483647, pointerEvents: "none", boxSizing: "border-box",
    });
    const t = document.createElement("div");
    t.textContent = label;
    const below = b.y < 28;
    Object.assign(t.style, {
      position: "absolute", right: "-3px", [below ? "top" : "bottom"]: "100%", whiteSpace: "nowrap",
      background: "#E0245E", color: "#fff", font: "bold 12px sans-serif", padding: "2px 7px",
      borderRadius: below ? "0 0 6px 6px" : "6px 6px 0 0",
    });
    d.appendChild(t);
    document.body.appendChild(d);
  }, { b, label });
}

export const unmark = (page) => page.evaluate(() => document.querySelectorAll(".__mark").forEach((e) => e.remove()));
