// 元に戻す（Ctrl+Z）／やり直す（Ctrl+Shift+Z・Ctrl+Y）の履歴（画面に依存しない純粋な関数）
//
// 1手 = プロジェクトのボード一式（boards）と開いていたボードの丸ごとの控え。部分の差分ではなく丸ごと入れ替えるので、
// 番号の詰め直し・引用・線・中の付箋も一緒に元どおりになる。ボードは書き換えのたびに作り直される（不変）ので、
// 控えは参照を持つだけで済み、変わっていない付箋や画像の中身は複製しない。
//
// 細かい変化は1手にまとめる。ドラッグの途中（指・マウスを押している間）と、
// 前の変化から GROUP_MS 以内の変化（ひと続きの入力）は同じ手。押し始め（boundary）は必ず新しい手を始める。
// 間隔と上限は ProseMirror の履歴の既定値（newGroupDelay 500ms・depth 100）に合わせた。
//
// 6.22.0: 入力欄でキーボードから打った文章は、入力欄の外の Ctrl+Z では戻さない（ユーザー指定。入力欄の中の Ctrl+Z＝ブラウザの
// 取り消しで戻す）。打った変化の手には typed の印を付け（recordChange の typed）、戻す・やり直すときは飛ばす。
// 控えは「その手の前（boards）」と「その手の後（base）」の組で持ち、戻す先は三方向で決める（mergeText）:
//   文章（付箋の本文・タイトル、直書きの文字、領域の名前、線のメモ）は、その手の後から打って変えていれば今のまま残し、
//   打っていなければその手の前に戻す。その手が本文の #番号 を詰め直していて、そのあと書き足した本文は、
//   書き足した分を残したまま #番号 だけ戻す（rebaseRefs）。文章以外は、その手の前に戻す。
//   ボタンなどで文章を変えた手（打ったのではない）は、ふつうに戻る

export const GROUP_MS = 500;
export const DEPTH = 100;

export const makeHist = () => ({ undo: [], redo: [], open: null, lastAt: 0 });

// 付箋の重なり順（z）と、並び順だけの違いは「変わっていない」と見なす。
// 付箋を押しただけ（前面に上げる）・画像をつかんだだけ（配列の末尾へ移す）の手を積まないため
const sameValue = (a, b) => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  return false;
};
const sameItem = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (k === "z") continue;
    if (!sameValue(a[k], b[k])) return false;
  }
  return true;
};
const sameItems = (a, b) => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const byId = new Map();
  for (const x of b) {
    if (!x || x.id == null) return a.every((y, i) => sameItem(y, b[i]));
    byId.set(x.id, x);
  }
  for (const x of a) {
    if (!x || x.id == null || !byId.has(x.id) || !sameItem(x, byId.get(x.id))) return false;
  }
  return true;
};
const sameBoard = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const va = a[k], vb = b[k];
    if (va === vb) continue;
    if (Array.isArray(va) || Array.isArray(vb)) { if (!sameItems(va || [], vb || [])) return false; continue; }
    return false;
  }
  return true;
};
export const sameBoards = (a, b) => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.id !== b[i]?.id || !sameBoard(a[i], b[i])) return false;
  }
  return true;
};

// ---- 文章の三方向（6.22.0） ----
const TEXT_KEYS = { notes: ["text", "title"], texts: ["text"], zones: ["label"], edges: ["memo"] };
const REF_RE = /#\d+/g;
const sameStr = (a, b) => (a ?? "") === (b ?? "");

// その手が #番号 だけを書き換えた本文（before → after）に、そのあと書き足した（after → cur）とき、
// 書き足した分を before に乗せる。#番号 以外の文字が before と after で同じときだけ（違えば null）
export function rebaseRefs(before, after, cur) {
  if (typeof before !== "string" || typeof after !== "string" || typeof cur !== "string") return null;
  if (before.split(REF_RE).join("\u0000") !== after.split(REF_RE).join("\u0000")) return null;
  const tb = [...before.matchAll(REF_RE)].map((m) => [m.index, m.index + m[0].length]);
  const ta = [...after.matchAll(REF_RE)].map((m) => [m.index, m.index + m[0].length]);
  if (tb.length !== ta.length) return null;
  // after と cur の違う所（前と後ろの同じ部分を除いた範囲）
  let p = 0;
  while (p < after.length && p < cur.length && after[p] === cur[p]) p++;
  let q = 0;
  while (q < after.length - p && q < cur.length - p && after[after.length - 1 - q] === cur[cur.length - 1 - q]) q++;
  let s = p, e = after.length - q;
  // #番号 の途中にかかっていたら、その #番号 ごと書き足した側とみなす
  for (const [a, b] of ta) { if (a < s && s < b) s = a; if (a < e && e < b) e = b; }
  if (s > e) e = s;
  const toBefore = (i) => {
    let shift = 0;
    for (let k = 0; k < ta.length; k++) if (ta[k][1] <= i) shift += (tb[k][1] - tb[k][0]) - (ta[k][1] - ta[k][0]);
    return i + shift;
  };
  const mid = cur.slice(s, cur.length - (after.length - e));
  return before.slice(0, toBefore(s)) + mid + before.slice(toBefore(e));
}

// 戻す先の物の文章を決める。target: 戻す先（その手の前）、base: その手の後、cur: 今
export function mergeText(target, base, cur) {
  const curById = new Map((cur || []).map((b) => [b.id, b]));
  const baseById = new Map((base || []).map((b) => [b.id, b]));
  let changed = false;
  const out = target.map((tb) => {
    const cb = curById.get(tb.id);
    if (!cb || cb === tb) return tb;
    const bb = baseById.get(tb.id) || null;
    let boardChanged = false;
    const nb = { ...tb };
    for (const [key, keys] of Object.entries(TEXT_KEYS)) {
      const list = tb[key];
      if (!Array.isArray(list)) continue;
      const now = new Map((cb[key] || []).filter((x) => x && x.id != null).map((x) => [x.id, x]));
      const was = new Map(((bb && bb[key]) || []).filter((x) => x && x.id != null).map((x) => [x.id, x]));
      let listChanged = false;
      const next = list.map((x) => {
        const c = x && now.get(x.id);
        if (!c) return x;             // 今は無い物（剥がした付箋など）: 戻す先のまま
        const y = was.get(x.id) || x; // その手の後に無かった物は、その手で文章を変えていないとみなす
        let z = x;
        for (const k of keys) {
          if (sameStr(c[k], y[k])) continue;     // その手の後から打っていない: 戻す先の文章
          let v = c[k];                         // 打って変えた: 今のまま
          if (!sameStr(x[k], y[k]) && key === "notes" && k === "text") v = rebaseRefs(x[k], y[k], c[k]) ?? c[k];
          if (sameStr(z[k], v) && z[k] === v) continue;
          if (z === x) z = { ...x };
          if (v === undefined) delete z[k]; else z[k] = v;
        }
        if (z !== x) listChanged = true;
        return z;
      });
      if (listChanged) { nb[key] = next; boardChanged = true; }
    }
    if (!boardChanged) return tb;
    changed = true;
    return nb;
  });
  return changed ? out : target;
}

// 控えの数の上限: 打った手は数えない（入力で上限を使い切らないため）。打った手も含めて DEPTH の10倍まで
const trim = (list) => {
  let shaped = list.filter((e) => !e.typed).length;
  while (list.length && (shaped > DEPTH || list.length > DEPTH * 10)) {
    const e = list.shift();
    if (!e.typed) shaped--;
  }
};

// 開いている手を閉じる。中身が変わっていれば「手の前（boards）・手の後（base）」の組で積み、
// 新しい変化なのでやり直しは捨てる（打っただけの手では捨てない）
export function closeGroup(h, cur) {
  if (h.open && !sameBoards(h.open.boards, cur.boards)) {
    h.undo.push({ ...h.open, base: cur.boards });
    trim(h.undo);
    if (!h.open.typed) h.redo = [];
  }
  h.open = null;
}

// 利用者の操作で before → (新しい状態) に変わった。続きの手か、新しい手を始めるかを決める。
// typed: 入力欄でキーボードから打った変化（6.22.0）。ひとつの手の中に打っていない変化が混ざれば、その手は打った手ではない
export function recordChange(h, before, now, { boundary = false, pointerDown = false, typed = false } = {}) {
  const cont = h.open && !boundary && (pointerDown || now - h.lastAt <= GROUP_MS);
  if (!cont) {
    closeGroup(h, before);
    h.open = { boards: before.boards, currentBoardId: before.currentBoardId, typed };
  } else if (!typed) {
    h.open.typed = false;
  }
  h.lastAt = now;
}

// 控えから、打った手を飛ばして戻す先を取り出す
const take = (list, cur) => {
  while (list.length) {
    const e = list.pop();
    if (e.typed) continue;
    return { boards: mergeText(e.boards, e.base, cur.boards), currentBoardId: e.currentBoardId };
  }
  return null;
};

// 戻す。戻す先の状態を返す（無ければ null）。今の状態はやり直しに積む
export function undoStep(h, cur) {
  closeGroup(h, cur);
  const snap = take(h.undo, cur);
  if (!snap) return null;
  h.redo.push({ boards: cur.boards, currentBoardId: cur.currentBoardId, base: snap.boards, typed: false });
  return snap;
}

// やり直す。戻したあとに何か変えていたら、やり直しはもう無い（打っただけなら残る）
export function redoStep(h, cur) {
  closeGroup(h, cur);
  const snap = take(h.redo, cur);
  if (!snap) return null;
  h.undo.push({ boards: cur.boards, currentBoardId: cur.currentBoardId, base: snap.boards, typed: false });
  return snap;
}

const openChange = (h, cur) => !!h.open && !h.open.typed && !sameBoards(h.open.boards, cur.boards);
export const canUndo = (h, cur) => !!h && (openChange(h, cur) || h.undo.some((e) => !e.typed));
export const canRedo = (h, cur) => !!h && h.redo.some((e) => !e.typed) && !openChange(h, cur);

// 戻したあとに見せるボード。今のボードが変わるならそのまま、変わらず別のボードが変わるならそちらへ切り替える
// （見えないところで戻って、何も起きなかったように見えるのを防ぐ）
export function boardToShow(snap, cur) {
  const curId = cur.currentBoardId;
  const before = new Map((cur.boards || []).map((b) => [b.id, b]));
  const changed = snap.boards.filter((b) => !sameBoard(before.get(b.id), b)).map((b) => b.id);
  const has = (id) => snap.boards.some((b) => b.id === id);
  if (has(curId) && (changed.includes(curId) || changed.length === 0)) return curId;
  if (changed.length > 0) return changed[0];
  return has(curId) ? curId : (has(snap.currentBoardId) ? snap.currentBoardId : snap.boards[0]?.id);
}

// 控えの中身を f（boards → boards）で書き換える（6.11.1。空のまま離れた直書きの文字を、無かったことにするため）。
// 書き換えて「手の前と後が同じ」になった手（何も変わらない手）は捨てる
export function rewriteHist(h, f, cur) {
  if (!h) return;
  const fix = (e) => {
    const boards = f(e.boards);
    const base = e.base ? f(e.base) : e.base;
    return boards === e.boards && base === e.base ? e : { ...e, boards, base };
  };
  const keep = (e) => !e.base || !sameBoards(e.boards, e.base);
  h.undo = h.undo.map(fix).filter(keep);
  h.redo = h.redo.map(fix).filter(keep);
  if (h.open) {
    const boards = f(h.open.boards);
    h.open = sameBoards(boards, cur.boards) ? null : (boards === h.open.boards ? h.open : { ...h.open, boards });
  }
}

// 空のまま入力欄から離れた直書きの文字 id を消した（6.11.1・6.22.0）。seen: 消す前、cur: 消した後。
// 一度も書いていなければ、作った手ごと無かったことにする（Ctrl+Z で空の文字は戻らない）。
// 書いてあったことがあれば（書いてから全部消した・書いてある文字を全部消した）、「消した」を1手として積み、
// Ctrl+Z で最後に書いてあった文章のまま戻せるようにする（打った手は戻さないので、ここで積まないと戻せない）
export function dropBlankText(h, id, seen, cur) {
  if (!h) return;
  const textIn = (boards) => {
    for (const b of boards || []) for (const t of b.texts || []) if (t.id === id && !isBlankText(t)) return t.text;
    return null;
  };
  let written = h.open ? textIn(h.open.boards) : null;
  for (let i = h.undo.length - 1; written == null && i >= 0; i--) written = textIn(h.undo[i].base) ?? textIn(h.undo[i].boards);
  if (written == null) { rewriteHist(h, withoutBlankText(id), cur); return; }
  closeGroup(h, seen);
  const boards = seen.boards.map((b) => ((b.texts || []).some((t) => t.id === id)
    ? { ...b, texts: b.texts.map((t) => (t.id === id ? { ...t, text: written } : t)) } : b));
  h.undo.push({ boards, currentBoardId: seen.currentBoardId, base: cur.boards, typed: false });
  trim(h.undo);
  h.redo = [];
}

// 文字 id が空（空白・改行だけを含む）の控えから、その文字を外す（書いてあった控えはそのまま）
export const isBlankText = (t) => !(t?.text || "").trim();
export const withoutBlankText = (id) => (boards) => {
  let changed = false;
  const out = boards.map((b) => {
    const ts = b.texts || [];
    if (!ts.some((t) => t.id === id && isBlankText(t))) return b;
    changed = true;
    return { ...b, texts: ts.filter((t) => !(t.id === id && isBlankText(t))) };
  });
  return changed ? out : boards;
};
