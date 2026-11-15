// 付箋どうしを結ぶ線の端（画面に依存しない純粋な関数。6.22.0）
//
// 線は2枚の中心を結ぶ向きのまま、端を付箋の枠の外で切る（draw.io の「浮いた接続」と同じ考え方）。
// 端の点（半径 END_R）が枠の外側に接するように、枠を END_R だけ外へ広げた四角と、中心を結ぶ線の交わる点を端にする。
// 辺に当たるときは点と辺の距離がちょうど END_R、角の近くでは END_R より離れる（枠に食い込まない）。
// 6.21.0 までは端を「中心どうしの距離の 45% まで」で止めていたため、間が狭い（横並びで約36px未満）と
// 端が付箋の内側に入り、重なった付箋では線が付箋の上に描かれていた。
//
// 2枚が重なっている・間が狭くて枠の外に線を引く場所が無いときは null（線を描かない。ユーザーが選択）。
//   r: { cx, cy, hw, hh }（中心と、幅・高さの半分。ボードの座標）

export const END_R = 4;

// 中心 a から中心 b へ向かう線が、a を pad だけ広げた四角を出る位置（a→b の長さに対する割合）
const exitT = (a, dx, dy, pad) => {
  const tx = dx !== 0 ? (a.hw + pad) / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? (a.hh + pad) / Math.abs(dy) : Infinity;
  return Math.min(tx, ty);
};

export function edgeEnds(a, b, pad = END_R) {
  if (!a || !b) return null;
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  if (dx === 0 && dy === 0) return null;
  const ta = exitT(a, dx, dy, pad);
  const tb = exitT(b, -dx, -dy, pad);
  // 線は中心どうしを通るので、[ta, 1 - tb] の範囲だけがどちらの（広げた）四角の外。空なら引く場所が無い
  if (ta + tb >= 1) return null;
  return {
    p1: { x: a.cx + dx * ta, y: a.cy + dy * ta },
    p2: { x: b.cx - dx * tb, y: b.cy - dy * tb },
  };
}
