// 元に戻す（Ctrl+Z）／やり直す（Ctrl+Shift+Z・Ctrl+Y）の履歴（画面に依存しない純粋な関数）
//
// 1手 = プロジェクトのボード一式（boards）と開いていたボードの丸ごとの控え。部分の差分ではなく丸ごと入れ替えるので、
// 番号の詰め直し・引用・線・中の付箋も一緒に元どおりになる。ボードは書き換えのたびに作り直される（不変）ので、
// 控えは参照を持つだけで済み、変わっていない付箋や画像の中身は複製しない。
//
// 細かい変化は1手にまとめる。ドラッグの途中（指・マウスを押している間）と、
// 前の変化から GROUP_MS 以内の変化（ひと続きの入力）は同じ手。押し始め（boundary）は必ず新しい手を始める。
// 間隔と上限は ProseMirror の履歴の既定値（newGroupDelay 500ms・depth 100）に合わせた。

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

// 開いている手を閉じる。中身が変わっていれば積み、新しい変化なのでやり直しは捨てる
export function closeGroup(h, cur) {
  if (h.open && !sameBoards(h.open.boards, cur.boards)) {
    h.undo.push(h.open);
    if (h.undo.length > DEPTH) h.undo.splice(0, h.undo.length - DEPTH);
    h.redo = [];
  }
  h.open = null;
}

// 利用者の操作で before → (新しい状態) に変わった。続きの手か、新しい手を始めるかを決める
export function recordChange(h, before, now, { boundary = false, pointerDown = false } = {}) {
  const cont = h.open && !boundary && (pointerDown || now - h.lastAt <= GROUP_MS);
  if (!cont) {
    closeGroup(h, before);
    h.open = before;
  }
  h.lastAt = now;
}

// 戻す。戻す先の控えを返す（無ければ null）。今の状態はやり直しに積む
export function undoStep(h, cur) {
  closeGroup(h, cur);
  if (h.undo.length === 0) return null;
  const snap = h.undo.pop();
  h.redo.push(cur);
  return snap;
}

// やり直す。戻したあとに何か変えていたら、やり直しはもう無い
export function redoStep(h, cur) {
  closeGroup(h, cur);
  if (h.redo.length === 0) return null;
  const snap = h.redo.pop();
  h.undo.push(cur);
  return snap;
}

export const canUndo = (h, cur) => !!h && (h.undo.length > 0 || (!!h.open && !sameBoards(h.open.boards, cur.boards)));
export const canRedo = (h, cur) => !!h && h.redo.length > 0 && !(h.open && !sameBoards(h.open.boards, cur.boards));

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
