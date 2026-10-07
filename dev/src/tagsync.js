// タグ表（{ presetTags: [{ name, color, overview?, tags: [] }], alertTags: [] }）を端末間で合わせる
//
// 6.3.0 までは一覧をまるごと上書きしていた（最後に書いた端末の勝ち）。
// そのため、送る前に閉じる・電波が無い・別の端末が古い一覧で書く、のどれでも足したタグが消えていた。
// ここでは「前回そろえた時点（base）」「この端末（local）」「サーバー（server）」の3つを比べて合わせる（三方向マージ・diff3 と同じ考え方）。
//   - どちらかで足したものは残す。両方で足したものも残す
//   - どちらかで消し、もう一方で何もしていなければ消す（利用者が消した操作を伝える）
//   - 一方がカテゴリを消し、もう一方がそこにタグを足していたら、カテゴリごと残す（新しいタグを消さない）
//   - 色などの値・並び順は、変えた側を採用する（両方で変えていたらサーバー側）

const uniq = (xs) => [...new Set(xs)];

// 並び順: この端末で並びを変えていれば、この端末の順。そうでなければサーバーの順。残りは後ろに足す
function orderOf(keep, b, l, s) {
  const common = (xs) => xs.filter((x) => b.includes(x) && l.includes(x));
  const localMoved = JSON.stringify(common(l)) !== JSON.stringify(common(b).filter((x) => l.includes(x)));
  const first = localMoved ? l : s;
  const second = localMoved ? s : l;
  return uniq([...first, ...second]).filter((x) => keep.has(x));
}

// 文字の一覧（タグ名・赤で目立たせるタグ）を合わせる
export function mergeList(b = [], l = [], s = []) {
  const removed = new Set(b.filter((x) => !l.includes(x) || !s.includes(x)));
  const keep = new Set([...l, ...s].filter((x) => !removed.has(x) || (!b.includes(x))));
  return orderOf(keep, b, l, s);
}

const props = (c) => Object.keys(c || {}).filter((k) => k !== "name" && k !== "tags");

function mergeCategory(b, l, s) {
  const out = { ...s };
  for (const k of uniq([...props(l), ...props(s)])) {
    // この端末で値を変えていれば、この端末の値（無い値は「変えていない」と見なす。スマホ版は overview を持たない）
    if (l[k] !== undefined && (!b || l[k] !== b[k])) out[k] = l[k];
  }
  out.name = s.name;
  out.tags = mergeList(b?.tags || [], l.tags || [], s.tags || []);
  return out;
}

export function mergeTags(base, local, server) {
  const B = new Map((base?.presetTags || []).map((c) => [c.name, c]));
  const L = new Map((local?.presetTags || []).map((c) => [c.name, c]));
  const S = new Map((server?.presetTags || []).map((c) => [c.name, c]));
  const out = new Map();
  for (const name of uniq([...S.keys(), ...L.keys()])) {
    const b = B.get(name), l = L.get(name), s = S.get(name);
    if (l && s) { out.set(name, mergeCategory(b, l, s)); continue; }
    const one = l || s;
    if (!b) { out.set(name, { ...one, tags: [...(one.tags || [])] }); continue; } // 片方で足したカテゴリ
    // 片方で消したカテゴリ。もう一方がそこへ新しくタグを足していたら、消さずに残す
    const added = (one.tags || []).filter((t) => !(b.tags || []).includes(t));
    if (added.length > 0) out.set(name, { ...one, tags: [...one.tags] });
  }
  const names = orderOf(new Set(out.keys()), [...B.keys()], [...L.keys()], [...S.keys()]);
  return {
    presetTags: names.map((n) => out.get(n)),
    alertTags: mergeList(base?.alertTags || [], local?.alertTags || [], server?.alertTags || []),
  };
}

export const sameTags = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// タグを合わせてサーバーに書く（スマホ版・パソコン版で共通の手順）
//   io.pull()                → { data, updateTime } | null（サーバーにまだ無い）。data: null は中身が壊れている。読めなければ例外
//   io.push(data, expect)    → { ok, conflict }。expect は { updateTime } か { exists: false }
//   base                     → 前回そろえた内容（無ければ null）
//   local                    → この端末の今の内容
//   isPristine(local)        → この端末が一度もそろえておらず、初期のままか（そのときはサーバーをそのまま使う）
// 返り値: { merged, base }（merged をこの端末の内容に、base を次の「前回そろえた時点」にする）。書けなければ例外
export async function syncTags(io, base, local, isPristine = () => false) {
  for (let i = 0; i < 4; i++) {
    const cur = await io.pull();
    if (!cur) {
      const r = await io.push(local, { exists: false });
      if (r.ok) return { merged: local, base: local };
      if (r.conflict) continue;
      throw new Error("タグを保存できませんでした");
    }
    // サーバーの中身が壊れている（data: null）ときは、この端末の内容で直す
    const server = cur.data || local;
    const merged = !base && isPristine(local) && cur.data ? cur.data : mergeTags(base, local, server);
    if (cur.data && sameTags(merged, cur.data)) return { merged, base: merged };
    const r = await io.push(merged, { updateTime: cur.updateTime });
    if (r.ok) return { merged, base: merged };
    if (!r.conflict) throw new Error("タグを保存できませんでした");
    // 読んでから書くまでに他の端末が書いた → 読み直して合わせ直す
  }
  throw new Error("タグを保存できませんでした（他の端末と入れ違いが続いています）");
}
