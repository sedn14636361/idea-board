// ボードを HTML 1ファイルに書き出す（6.28.0。画面に依存しない純粋な関数）
//
// 画面の DOM を写し取るのではなく、ボードのデータから組み立てる。画面には入力欄・ボタンが混ざり、
// textarea の文字は outerHTML に出ないため。外部のファイルや通信は使わない（file:// で開いても、アプリが無くても見られる）。
//
// 見た目は画面に合わせる（ユーザーが選択: 見た目どおり・今のボード・閉じた入れ子は見る人が開ける）
//   - 付箋・線・領域・画像・手書き・直書きの文字を、ボードの配置と色のまま描く
//   - 開いた入れ子は画面と同じく中のボードを描く。閉じた入れ子は <details> にして、押すと中を開ける（JS は使わない）
//   - 線の端の計算は画面と同じ edgeEnds（src/edges.js）。付箋の位置は、画面で測った行の高さ（ROW）から決める
//
// 安全: 利用者の文章（本文・タイトル・タグ・線のメモ・領域名・ボード名）はすべてエスケープする。
//   色は # で始まる色コードだけ通す。画像は data:image/ だけ入れる。さらに CSP でスクリプトと外部の読み込みを止める

import { edgeEnds, END_R } from "./edges.js";

// 画面（IdeaBoard.jsx の renderNote）の行の高さ。6.27.0 の画面で測った値（px）
//   bar: 操作列（minHeight 27）／ title: タイトル欄（上の余白 2 ＋ 27）／ text: 開いた付箋の本文（flex 0 0 34px）
//   refRow: 引用の1行（上の帯 5 ＋ 上下の余白 ＋ 文字）／ refGap: 行の間／ refPad: 引用の欄の下の余白
//   tags: タグの行（開いた付箋では「＋タグ」「❝引用」があるので、タグが無くても必ずある）
//   innerM: 中のボードの左右の余白／ innerB: 中のボードの点線の太さ／ innerBottom: 下の余白
export const ROW = { bar: 27, title: 29, text: 34, refRow: 26, refGap: 3, refPad: 4, tags: 22, innerM: 6, innerB: 1.5, innerBottom: 8 };
export const MAX_DEPTH = 2;      // 入れ子は 0,1,2 の3段階
export const MARGIN = 40;        // 書き出す範囲の外側の余白
export const TEXT_MAX_W = 640;   // 直書きの文字の最大の幅（画面と同じ）
const POP_GAP = 6;               // 閉じた入れ子を開いたとき、付箋と中のボードの間

// ---- 文字・値の無害化 ----
export const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
// 色: #rgb / #rrggbb / #rrggbbaa だけ。ほかは既定の色
export const safeColor = (c, fallback = "#6B665C") => (typeof c === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(c) ? c : fallback);
// 画像: data:image/〜;base64, だけ（外部の読み込み・javascript: を入れない）
export const safeImage = (src) => (typeof src === "string" && /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]*$/i.test(src) ? src : null);
// 属性（値はエスケープ）。src="…" と直に書くと、HTML 1枚の版の確認（tools/bundle-single.mjs の「外部ファイルへの参照」）に引っかかる
const attr = (name, v) => `${name}="${esc(v)}"`;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const px = (v) => `${Math.round(num(v) * 100) / 100}px`;
export const tint = (hex, a) => {
  let h = safeColor(hex).slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

// 手書きの点列 → 滑らかなパス（中点をつなぐ二次ベジェ）。画面でも使う
export const strokePath = (pts) => {
  if (!pts || pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y} l 0.1 0`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q ${pts[i].x} ${pts[i].y} ${mx} ${my}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
};
// 書き出しでは数字以外を入れない
const safePath = (pts) => strokePath((pts || []).filter((p) => p && Number.isFinite(+p.x) && Number.isFinite(+p.y)).map((p) => ({ x: +p.x, y: +p.y })));

// ---- 付箋の形 ----
// 見出しの文字（画面の headingOf と同じ。番号の付いた付箋は「序 1/4」）
const seqText = (info) => (info ? (info.den ? `${info.i}/${info.n}` : `${info.i}`) : "");

// 付箋が引用している付箋（画面と同じ: 引用ボタンで選んだもの＋本文の #番号。自分は除く・重複なし・6件まで）
export function refsOf(n, notes) {
  const byNum = new Map(notes.map((m) => [m.num, m]));
  const byId = new Map(notes.map((m) => [m.id, m]));
  const textIds = [...new Set(((n.text || "").match(/#\d+/g) || []).map((s) => parseInt(s.slice(1), 10)))]
    .map((k) => byNum.get(k)?.id).filter(Boolean);
  const seen = new Set();
  return [...(n.refs || []), ...textIds]
    .filter((id) => { if (id === n.id || seen.has(id)) return false; seen.add(id); return true; })
    .map((id) => byId.get(id)).filter(Boolean).slice(0, 6);
}

// 付箋の枠と中のボードの位置（付箋の左上からの距離）。open: 中のボードを描くか
export function noteGeom(n, { simple = false, open = false, refCount = 0 } = {}) {
  const w = open ? num(n.ew, 430) : num(n.w, 190);
  const h = open ? num(n.eh, 400) : num(n.h, 170);
  const bl = simple ? 1.5 : 0;           // 左右と下の枠
  const bt = simple ? 4 : 16;            // 上の帯
  const refsH = refCount > 0 ? refCount * ROW.refRow + (refCount - 1) * ROW.refGap + ROW.refPad : 0;
  const rows = ROW.bar + (n.useTitle ? ROW.title : 0) + ROW.text + refsH + ROW.tags;
  const inner = open ? {
    x: bl + ROW.innerM + ROW.innerB,
    y: bt + rows + ROW.innerB,
    w: w - ROW.innerM * 2 - ROW.innerB * 2,
    h: h - rows - ROW.innerBottom - ROW.innerB * 2,
  } : null;
  return { w, h, bl, bt, outerW: w + bl * 2, outerH: h + bt + bl, rows, refsH, inner };
}

// ---- 並べ方 ----
// 1つの層（ボード全体、または閉じた入れ子を開いたときの中）に見えている付箋の四角（層の座標）
//   roots: 層のいちばん上の付箋。base: 層の原点。中の付箋は親の中のボードの左上から、親の幅・高さに収める（画面の maxWidth と同じ）
function placeLayer(roots, ctx, base = { x: 0, y: 0 }) {
  const rects = new Map();
  const put = (n, depth, ox, oy, limW, limH) => {
    const open = depth < MAX_DEPTH && !!n.expanded;
    const g = noteGeom(n, { simple: ctx.simple, open, refCount: refsOf(n, ctx.notes).length });
    // 中の付箋は親の中に収める（画面: maxWidth: calc(100% - x)。中身の幅・高さに効く）
    const w = limW == null ? g.w : Math.max(0, Math.min(g.w, limW - num(n.x)));
    const h = limH == null ? g.h : Math.max(0, Math.min(g.h, limH - num(n.y)));
    const r = { x: ox + num(n.x), y: oy + num(n.y), w: w + g.bl * 2, h: h + g.bt + g.bl, open, depth, cw: w, ch: h, g };
    rects.set(n.id, r);
    if (open) {
      const ix = r.x + g.inner.x, iy = r.y + g.inner.y;
      const iw = w - ROW.innerM * 2 - ROW.innerB * 2;
      const ih = h - g.rows - ROW.innerBottom - ROW.innerB * 2;
      r.inner = { x: ix, y: iy, w: iw, h: ih };
      for (const k of ctx.byParent.get(n.id) || []) put(k, depth + 1, ix, iy, iw, ih);
    }
  };
  for (const n of roots) put(n, n.__depth ?? 0, base.x, base.y, null, null);
  return rects;
}

// 線: 見えている付箋どうしを直接、しまわれている側は見えている親に束ねてオレンジの点線（画面の renderEdges と同じ）
//   inLayer: この層の付箋の id（両端がこの層にある線だけ描く）
function layerEdges(edges, rects, ctx, inLayer) {
  const anchorOf = (id) => {
    const chain = [];
    let cur = ctx.byId.get(id);
    while (cur && inLayer.has(cur.id)) { chain.unshift(cur); cur = cur.parentId ? ctx.byId.get(cur.parentId) : null; }
    for (const m of chain) if (!rects.get(m.id)?.open) return m.id;
    return id;
  };
  const isAncestor = (a, b) => { // a が b の祖先か
    let cur = ctx.byId.get(b);
    for (let i = 0; cur && i < 10; i++) { if (cur.parentId === a) return true; cur = ctx.byId.get(cur.parentId); }
    return false;
  };
  const seen = new Set();
  const out = [];
  for (const ed of edges || []) {
    if (!inLayer.has(ed.from) || !inLayer.has(ed.to)) continue;
    if (isAncestor(ed.from, ed.to) || isAncestor(ed.to, ed.from)) continue;
    const aid = anchorOf(ed.from), bid = anchorOf(ed.to);
    if (aid === bid) continue;
    const ra = rects.get(aid), rb = rects.get(bid);
    if (!ra || !rb) continue;
    const key = [aid, bid].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const ends = edgeEnds(
      { cx: ra.x + ra.w / 2, cy: ra.y + ra.h / 2, hw: ra.w / 2, hh: ra.h / 2 },
      { cx: rb.x + rb.w / 2, cy: rb.y + rb.h / 2, hw: rb.w / 2, hh: rb.h / 2 },
    );
    if (!ends) continue;
    out.push({ id: ed.id, a: aid, b: bid, bundled: aid !== ed.from || bid !== ed.to, memo: ed.memo || "", ...ends });
  }
  return out;
}

const edgesSvg = (list) => {
  if (list.length === 0) return "";
  const parts = list.map((e) => {
    const color = e.bundled ? "#C98A3D" : "#B0483C";
    let s = `<path d="M ${e.p1.x} ${e.p1.y} L ${e.p2.x} ${e.p2.y}" stroke="${color}" stroke-width="2.2"${e.bundled ? ' stroke-dasharray="6 5"' : ""} fill="none" opacity="0.85"/>`
      + `<circle cx="${e.p1.x}" cy="${e.p1.y}" r="${END_R}" fill="${color}"/><circle cx="${e.p2.x}" cy="${e.p2.y}" r="${END_R}" fill="${color}"/>`;
    if (e.memo) {
      const mx = (e.p1.x + e.p2.x) / 2, my = (e.p1.y + e.p2.y) / 2;
      const chars = [...e.memo];
      const label = chars.length > 18 ? chars.slice(0, 18).join("") + "…" : e.memo;
      const w = [...label].length * 11 + 14;
      s += `<g class="ib-memo"><title>${esc(e.memo)}</title><rect x="${mx - w / 2}" y="${my - 11}" width="${w}" height="22" rx="6" fill="#FFFDF6" stroke="${color}" stroke-width="1.5"/>`
        + `<text x="${mx}" y="${my + 5}" text-anchor="middle" font-size="12" fill="#3E3A33">${esc(label)}</text></g>`;
    }
    return `<g data-edge="${esc(e.id)}"${e.bundled ? ' data-bundled="1"' : ""}>${s}</g>`;
  });
  return `<svg class="ib-edges" width="1" height="1">${parts.join("")}</svg>`;
};

// ---- 付箋の HTML ----
function tagChips(n, ctx, { all = false } = {}) {
  const tags = n.tags || [];
  const isAlert = (t) => ctx.alertTags.includes(t);
  const alertPart = tags.filter(isAlert);
  const normal = tags.filter((t) => !isAlert(t));
  const shown = all ? [...alertPart, ...normal] : [...alertPart, ...normal.slice(0, Math.max(0, ctx.tagLimit - alertPart.length))];
  const hidden = tags.length - shown.length;
  const chips = shown.map((t) => {
    const c = safeColor(ctx.tagColorOf(t));
    return `<span class="ib-tag" style="background:${tint(c, 0.15)};color:${c}">${esc(t)}</span>`;
  });
  if (hidden > 0) chips.push(`<span class="ib-tag ib-more" title="${esc(tags.filter((t) => !shown.includes(t)).join("、"))}">+${hidden}</span>`);
  return chips.join("");
}

function refRows(n, ctx) {
  return refsOf(n, ctx.notes).map((m) => {
    const mc = ctx.colors[m.color] || ctx.colors[0];
    const parent = m.parentId ? ctx.byId.get(m.parentId) : null;
    const head = ctx.headingOf(m);
    return `<div class="ib-ref" style="background:${safeColor(mc.bg, "#EDEBE6")};border-top-color:${safeColor(mc.edge, "#C6C1B6")}">`
      + `<span class="ib-refnum">#${num(m.num)}</span><span class="ib-refhead">${head ? esc([...head].slice(0, 30).join("")) : "（無題）"}</span>`
      + (parent ? `<span class="ib-refin">#${num(parent.num)}内</span>` : "") + `</div>`;
  }).join("");
}

// 付箋1枚（中の付箋も）。pos: 置く位置（親の中・層の中の座標）。r: placeLayer の四角（開いているか・大きさ）
function noteHtml(n, ctx, r, { pos = true } = {}) {
  const c = ctx.colors[n.color] || ctx.colors[0];
  const bg = safeColor(c.bg, "#EDEBE6"), edge = safeColor(c.edge, "#C6C1B6");
  const open = r.open;
  const kids = ctx.byParent.get(n.id) || [];
  const desc = ctx.descCount(n.id);
  const refs = refsOf(n, ctx.notes);
  const g = noteGeom(n, { simple: ctx.simple, open, refCount: refs.length });
  const w = r.cw, h = r.ch;
  const info = ctx.seq.get(n.id);
  const style = [
    pos ? `left:${px(n.x)};top:${px(n.y)}` : "left:0;top:0",
    `width:${px(w)};height:${px(h)}`, `z-index:${Math.round(num(n.z, 1))}`,
    ctx.simple ? `background:#FFFFFF;border:1.5px solid ${edge};border-top:4px solid ${edge}` : `background:${bg};border-top:16px solid ${edge}`,
    open ? `box-shadow:${ctx.simple ? "0 2px 8px rgba(60,50,30,.16)" : "6px 9px 18px rgba(60,50,30,.28)"}` : "",
  ].filter(Boolean).join(";");
  // 閉じた入れ子（中に付箋がある）は「▸ 数」。押すと開く（<details> の summary の中なので）
  const nestChip = !open && desc > 0 && r.depth < MAX_DEPTH ? `<span class="ib-nest" title="中の付箋を見る">▸ ${desc}</span>` : "";
  const bar = `<div class="ib-bar"><span class="ib-num">#${num(n.num)}</span><span class="ib-dot" style="background:${edge}"></span><span class="ib-grow"></span>${nestChip}</div>`;
  const title = n.useTitle
    ? `<div class="ib-title"><span class="ib-titletext">${esc((n.title || "").trim())}</span>${info ? `<span class="ib-seq">${esc(seqText(info))}</span>` : ""}</div>`
    : "";
  const text = `<div class="ib-text${open ? " ib-text-open" : ""}">${esc(n.text || "")}</div>`;
  const refsHtml = refs.length ? `<div class="ib-refs"${open ? ` style="height:${px(g.refsH)}"` : ""}>${refRows(n, ctx)}</div>` : "";
  const tagsHtml = (n.tags || []).length || open ? `<div class="ib-tags${open ? " ib-tags-open" : ""}">${tagChips(n, ctx)}</div>` : "";
  let inner = "";
  if (open) {
    const kidsHtml = kids.map((k) => {
      const kr = ctx.rects.get(k.id) || placeLayer([{ ...k, __depth: r.depth + 1 }], ctx).get(k.id);
      return wrapNote(k, ctx, kr);
    }).join("");
    inner = `<div class="ib-inner" style="border-color:${edge}">${kidsHtml}</div>`;
  }
  return `<div class="ib-note" data-note="${esc(n.id)}" style="${style}">${bar}${title}${text}${refsHtml}${tagsHtml}${inner}</div>`;
}

// 閉じた入れ子（中に付箋がある）は <details>: 付箋が summary、押すと付箋のすぐ下に、開いた形の付箋（中のボードと線）を出す
function wrapNote(n, ctx, r) {
  const desc = ctx.descCount(n.id);
  if (r.open || desc === 0 || r.depth >= MAX_DEPTH) return noteHtml(n, ctx, r);
  const card = noteHtml(n, ctx, r, { pos: false });
  const pop = popHtml(n, ctx, r);
  return `<details class="ib-nestbox" data-nest="${esc(n.id)}" style="left:${px(n.x)};top:${px(n.y)};width:${px(r.w)};height:${px(r.h)};z-index:${Math.round(num(n.z, 1))}">`
    + `<summary>${card}</summary><div class="ib-pop" style="top:${px(r.h + POP_GAP)}">${pop}</div></details>`;
}

// 開いた形の付箋。中の付箋の位置と線は、この付箋の中だけで計算する
function popHtml(n, ctx, r) {
  const opened = { ...n, expanded: true };
  const g = noteGeom(opened, { simple: ctx.simple, open: true, refCount: refsOf(n, ctx.notes).length });
  const rects = placeLayer([{ ...opened, x: 0, y: 0, __depth: r.depth }], ctx);
  const sub = new Set([n.id, ...ctx.descIds(n.id)]);
  // 線: この付箋の中の付箋どうしだけ（外の付箋との線はボードの側で、この付箋に束ねて描いている）
  const inner = new Set([...sub].filter((id) => id !== n.id));
  const lines = layerEdges(ctx.edges, rects, ctx, inner);
  const local = { ...ctx, rects };
  const body = noteHtml({ ...opened, x: 0, y: 0 }, local, { ...rects.get(n.id), open: true }, { pos: true });
  return `<div class="ib-popbody" style="width:${px(g.outerW)};height:${px(g.outerH)}">${body}<div class="ib-layer ib-edgelayer">${edgesSvg(lines)}</div></div>`;
}

// ---- 書き出し ----
// board: ボード1枚（notes / edges / texts / zones / images / strokes / title）
// opts:
//   colors: 付箋の色（[{ bg, edge }]）, tagColorOf(t): タグの色, alertTags: 赤で目立たせるタグ, tagLimit: 付箋に出すタグの数
//   seq: Map(id → { i, n, den })（タイトルの番号）, textSizes: 直書きの文字の大きさ3段階
//   simple: 見た目「シンプル」, grid: 方眼の間隔, gridMode: 方眼の線（false なら点）
//   noteIds: 選んだ最上位の付箋だけ書き出す（null ならボード全体）, textIds: 選んだ文字
//   projectName, exportedAt（表示用の文字）, version
export function boardToHtml(board, opts = {}) {
  const notes = (board?.notes || []).filter((n) => n && n.id);
  const byId = new Map(notes.map((n) => [n.id, n]));
  const byParent = new Map();
  for (const n of notes) {
    const p = n.parentId && byId.has(n.parentId) ? n.parentId : "root";
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(n);
  }
  const descIds = (id, acc = []) => { for (const k of byParent.get(id) || []) { acc.push(k.id); descIds(k.id, acc); } return acc; };
  const headingOf = (n) => {
    const t = (n.title || "").trim();
    const lab = seqText((opts.seq || new Map()).get(n.id));
    if (lab) return t ? `${t} ${lab}` : lab;
    return t || (n.text || "").split("\n").find((l) => l.trim())?.trim() || "";
  };
  const ctx = {
    notes, byId, byParent, edges: board?.edges || [],
    colors: opts.colors || [{ bg: "#EDEBE6", edge: "#C6C1B6" }],
    tagColorOf: opts.tagColorOf || (() => "#6B665C"),
    alertTags: opts.alertTags || [],
    tagLimit: Math.max(1, num(opts.tagLimit, 3)),
    seq: opts.seq || new Map(),
    simple: !!opts.simple,
    headingOf, descIds,
    descCount: (id) => descIds(id).length,
  };

  // 書き出す物: 選んでいればその付箋（中の付箋ごと）と文字だけ。選んでいなければボード全体
  const whole = !(opts.noteIds?.length || opts.textIds?.length);
  const picked = new Set(opts.noteIds || []), pickedTexts = new Set(opts.textIds || []);
  const roots = (byParent.get("root") || []).filter((n) => whole || picked.has(n.id));
  const texts = (board?.texts || []).filter((t) => t && (whole || pickedTexts.has(t.id)));
  const zones = whole ? board?.zones || [] : [];
  const images = whole ? (board?.images || []).filter((im) => safeImage(im.src)) : [];
  const strokes = whole ? (board?.strokes || []).filter((s) => s && Array.isArray(s.pts)) : [];

  const inLayer = new Set();
  for (const n of roots) { inLayer.add(n.id); for (const d of descIds(n.id)) inLayer.add(d); }
  const rects = placeLayer(roots, ctx);
  ctx.rects = rects;
  const lines = layerEdges(ctx.edges, rects, ctx, inLayer);

  // 範囲（ボードの座標）
  const sizes = opts.textSizes && opts.textSizes.length ? opts.textSizes : [15, 22, 34];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x, y, w = 0, h = 0) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
  };
  for (const n of roots) { const r = rects.get(n.id); add(r.x, r.y, r.w, r.h); }
  for (const t of texts) {
    const fs = sizes[t.size ?? 1] || sizes[1];
    const lines2 = String(t.text || "").split("\n");
    const longest = Math.max(1, ...lines2.map((l) => [...l].length));
    add(num(t.x), num(t.y), num(t.w) || Math.min(TEXT_MAX_W, longest * fs + 10), lines2.length * fs * 1.5 + 4);
  }
  for (const z of zones) add(num(z.x), num(z.y), num(z.w), num(z.h));
  for (const im of images) add(num(im.x), num(im.y), num(im.w), num(im.h));
  for (const s of strokes) for (const p of s?.pts || []) { if (!p) continue; const hw = num(s.width, 2) / 2; add(+p.x - hw, +p.y - hw, hw * 2, hw * 2); }
  for (const e of lines) { add(e.p1.x - END_R, e.p1.y - END_R, END_R * 2, END_R * 2); add(e.p2.x - END_R, e.p2.y - END_R, END_R * 2, END_R * 2); }
  if (minX === Infinity) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
  const ox = MARGIN - minX, oy = MARGIN - minY;
  const W = Math.ceil(maxX - minX + MARGIN * 2), H = Math.ceil(maxY - minY + MARGIN * 2);
  const grid = Math.max(4, num(opts.grid, 26));

  const zonesHtml = zones.map((z) => {
    const col = safeColor(z.color, "#C6C1B6");
    return `<div class="ib-zone" style="left:${px(z.x)};top:${px(z.y)};width:${px(z.w)};height:${px(z.h)};background:${tint(col, 0.13)};border-color:${tint(col, 0.55)}">`
      + (String(z.label || "").trim() ? `<span class="ib-zonename" style="background:${col}">${esc(z.label)}</span>` : "") + `</div>`;
  }).join("");
  const imagesHtml = images.map((im, i) =>
    `<img class="ib-img" alt="" ${attr("src", safeImage(im.src))} style="left:${px(im.x)};top:${px(im.y)};width:${px(im.w)};height:${px(im.h)};z-index:${1 + i}">`).join("");
  const notesHtml = roots.map((n) => wrapNote(n, ctx, rects.get(n.id))).join("");
  const strokesHtml = strokes.length
    ? `<svg class="ib-strokes" width="1" height="1">${strokes.map((s) =>
      `<path d="${safePath(s.pts)}" stroke="${safeColor(s.color, "#3E3A33")}" stroke-width="${Math.max(0.5, num(s.width, 2))}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join("")}</svg>`
    : "";
  const textsHtml = texts.map((t) => {
    const fs = sizes[t.size ?? 1] || sizes[1];
    const width = num(t.w) > 0 ? `width:${px(t.w)}` : "width:max-content";
    return `<div class="ib-btext" data-text="${esc(t.id)}" style="left:${px(t.x)};top:${px(t.y)};z-index:${Math.round(num(t.z, 1))};font-size:${num(fs, 22)}px;${width}">${esc(t.text || "")}</div>`;
  }).join("");

  const title = String(board?.title || "ボード");
  const sub = [opts.projectName, opts.exportedAt].filter(Boolean).map(esc).join(" ・ ");
  const bgImage = opts.gridMode
    ? "linear-gradient(#E2DBCB 1px, transparent 1px), linear-gradient(90deg, #E2DBCB 1px, transparent 1px)"
    : "radial-gradient(#D9D2C2 1.2px, transparent 1.2px)";

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="IdeaBoard ${esc(opts.version || "")}">
<title>${esc(title)}</title>
<style>
${CSS}
</style>
</head>
<body>
<header class="ib-head"><div class="ib-headin"><strong>${esc(title)}</strong>${sub ? `<span>${sub}</span>` : ""}</div></header>
<main class="ib-board" style="width:${W}px;height:${H}px;background-image:${bgImage};background-size:${grid}px ${grid}px;background-position:${ox}px ${oy}px">
<div class="ib-origin" style="left:${ox}px;top:${oy}px">
${zonesHtml}${imagesHtml}${notesHtml}<div class="ib-layer ib-edgelayer">${edgesSvg(lines)}</div>${strokesHtml}${textsHtml}
</div>
</main>
</body>
</html>
`;
}

// 書き出した HTML の見た目。値は画面（IdeaBoard.jsx）に合わせる
const CSS = `
*{box-sizing:content-box}
html,body{margin:0;background:#F6F2E9;color:#3E3A33;font-family:'Zen Maru Gothic','Hiragino Maru Gothic ProN','Hiragino Sans','Yu Gothic','Meiryo',sans-serif}
/* 6.28.1: ページの幅をボードに合わせる（body が画面の幅のままだと、横に送ったとき見出しの帯が途中で切れていた）。文字は左端に留める */
body{width:max-content;min-width:100%}
.ib-head{position:sticky;top:0;z-index:2147483600;padding:8px 0;background:#3E3A33;color:#F6F2E9;font-size:14px}
.ib-headin{position:sticky;left:0;display:inline-flex;gap:12px;align-items:baseline;flex-wrap:wrap;max-width:100vw;box-sizing:border-box;padding:0 16px}
.ib-head span{font-size:12px;color:#D8D3C8}
.ib-board{position:relative}
.ib-origin{position:absolute;width:0;height:0}
.ib-zone{position:absolute;z-index:0;border:2px solid;border-radius:10px;box-sizing:border-box}
.ib-zonename{position:absolute;top:-2px;left:-2px;max-width:90%;border-radius:8px 0 8px 0;padding:2px 8px;font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ib-img{position:absolute;display:block;object-fit:contain;background:#fff;border-radius:4px;box-shadow:2px 4px 10px rgba(60,50,30,.25)}
.ib-note{position:absolute;display:flex;flex-direction:column;border-radius:3px;box-shadow:3px 5px 10px rgba(60,50,30,.22);overflow:hidden}
.ib-bar{display:flex;align-items:center;gap:4px;height:${ROW.bar}px;padding:5px 6px 0;box-sizing:border-box;flex-shrink:0}
.ib-num{font-size:10px;font-weight:700;color:rgba(62,58,51,.65)}
.ib-dot{width:11px;height:11px;border-radius:50%;border:2px solid rgba(62,58,51,.45);flex-shrink:0}
.ib-grow{flex:1}
.ib-nest{font-size:11px;font-weight:700;border-radius:5px;background:rgba(62,58,51,.12);padding:2px 7px;white-space:nowrap}
.ib-title{display:flex;align-items:center;height:${ROW.title - 2}px;margin-top:2px;box-sizing:border-box;border-bottom:1px solid rgba(62,58,51,.18);flex-shrink:0}
.ib-titletext{flex:1;min-width:0;padding:3px 10px 4px;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ib-seq{flex-shrink:0;margin-right:6px;border-radius:5px;background:rgba(62,58,51,.12);font-size:11.5px;font-weight:700;padding:1px 7px;font-variant-numeric:tabular-nums;white-space:nowrap}
.ib-text{flex:1;min-height:0;overflow:auto;padding:6px 10px 4px;font-size:14px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
.ib-text-open{flex:0 0 ${ROW.text}px;box-sizing:border-box;height:${ROW.text}px}
.ib-refs{flex-shrink:0;padding:0 8px ${ROW.refPad}px;display:flex;flex-direction:column;gap:${ROW.refGap}px;overflow:hidden;box-sizing:border-box}
.ib-ref{display:flex;align-items:center;gap:5px;height:${ROW.refRow}px;box-sizing:border-box;flex-shrink:0;border-top:5px solid;border-radius:3px;box-shadow:1px 2px 4px rgba(60,50,30,.2);font-size:11px;padding:2px 6px 3px;overflow:hidden}
.ib-refnum{font-weight:700;color:rgba(62,58,51,.65);font-size:10px;flex-shrink:0}
.ib-refhead{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
.ib-refin{font-size:9px;color:rgba(62,58,51,.55);flex-shrink:0}
.ib-tags{flex-shrink:0;display:flex;flex-wrap:wrap;align-items:center;gap:3px;padding:0 8px 5px;box-sizing:border-box}
.ib-tags-open{height:${ROW.tags}px;flex-wrap:nowrap;overflow:hidden}
.ib-tag{border-radius:8px;font-size:10px;padding:1px 7px;font-weight:700;line-height:1.5;white-space:nowrap}
.ib-more{background:rgba(62,58,51,.22);color:#3E3A33}
.ib-inner{position:relative;flex:1;min-height:0;margin:0 ${ROW.innerM}px ${ROW.innerBottom}px;background:rgba(255,255,255,.55) radial-gradient(rgba(62,58,51,.14) 1px, transparent 1px);background-size:18px 18px;border:${ROW.innerB}px dashed;border-radius:6px;overflow:hidden}
.ib-nestbox{position:absolute;display:block}
.ib-nestbox>summary{display:block;list-style:none;cursor:pointer;width:100%;height:100%;position:relative}
.ib-nestbox>summary::-webkit-details-marker{display:none}
.ib-nestbox>summary:focus-visible{outline:3px solid #3D6FB4;outline-offset:2px}
.ib-nestbox>summary>.ib-note{left:0;top:0}
.ib-nestbox[open]{z-index:2147483000 !important}
.ib-nestbox[open]>summary .ib-nest{background:#3E3A33;color:#F6F2E9}
.ib-pop{position:absolute;left:0}
.ib-popbody{position:relative;border-radius:4px;box-shadow:0 10px 30px rgba(30,25,15,.35)}
.ib-layer{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none}
.ib-edgelayer{z-index:99998}
.ib-edges,.ib-strokes{position:absolute;left:0;top:0;overflow:visible}
.ib-strokes{z-index:110000;pointer-events:none}
.ib-memo{pointer-events:auto}
.ib-btext{position:absolute;max-width:${TEXT_MAX_W}px;padding:1px 4px;font-weight:700;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;box-sizing:border-box}
@media print{.ib-head{position:static}html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;
