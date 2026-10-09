// GitHub Pages を真似る道具（mobile-update.mjs と、変更箇所のスクリーンショットで使う）
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";

// /idea-board/ の下で、GitHub Pages と同じく10分のキャッシュ（Cache-Control: max-age=600）で返す。
// 返すフォルダは getDir() で毎回決める（途中で差し替えて「新しい版を公開した」状態を作れる）
export async function servePages(getDir) {
  const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json", ".png": "image/png" };
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/idea-board\/?/, "") || "index.html";
    const f = path.join(getDir(), rel);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Cache-Control": "max-age=600" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}/idea-board/`;
  return { base, close: () => new Promise((r) => srv.close(r)) };
}

// 次の版を作る: dist を写し、版の文字を置き換え、中身が変わったファイルは名前も変える
// （本物の版上げと同じく、HTML が読み込むファイル名が変わる）。返り値は作ったフォルダ
export function makeNext(src, fromVer, toVer = "9.9.9") {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), "ib-next-"));
  fs.cpSync(src, dst, { recursive: true });
  const A = path.join(dst, "assets");
  const ren = new Map();
  const apply = (s) => { for (const [a, b] of ren) s = s.split(a).join(b); return s.split(`"${fromVer}"`).join(`"${toVer}"`); };
  for (let round = 0; round < 5; round++) {
    for (const f of fs.readdirSync(A)) {
      if (!f.endsWith(".js") || [...ren.values()].includes(f)) continue;
      const s = fs.readFileSync(path.join(A, f), "utf8");
      if (apply(s) !== s && !ren.has(f)) ren.set(f, f.replace(/\.js$/, "-n.js"));
    }
  }
  for (const f of fs.readdirSync(A)) {
    if (!f.endsWith(".js")) continue;
    const s = apply(fs.readFileSync(path.join(A, f), "utf8"));
    fs.rmSync(path.join(A, f));
    fs.writeFileSync(path.join(A, ren.get(f) || f), s);
  }
  for (const f of ["index.html", "mobile.html"]) fs.writeFileSync(path.join(dst, f), apply(fs.readFileSync(path.join(dst, f), "utf8")));
  return dst;
}
