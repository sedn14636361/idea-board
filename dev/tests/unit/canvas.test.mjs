// 端のないボードの広さ（src/canvas.js）
import { contentBox, canvasBounds, unionBounds, BASE_W, BASE_H } from "../../src/canvas.js";
let ng = 0;
const eq = (l, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.error(`NG ${l}\n   得: ${a}\n   期: ${b}`); ng++; } else console.log(`ok ${l}`); };
const note = (x, y, extra = {}) => ({ x, y, w: 190, h: 170, ew: 430, eh: 400, ...extra });

eq("何も無ければ null", contentBox({ notes: [], texts: [] }), null);
eq("空のボードは今までの広さ（0,0〜3200,2200）", canvasBounds(null, 1280, 800), { minX: 0, minY: 0, maxX: BASE_W, maxY: BASE_H });
eq("今のデータ（100〜3000）も外側に画面1つ分の余白を持つ（開いたときは原点を左上に合わせるので見え方は同じ）", canvasBounds(contentBox({ notes: [note(100, 100), note(2800, 1800)] }), 1280, 800),
  { minX: -1200, minY: -700, maxX: 4300, maxY: 2800 });
eq("広げた外側にも画面1つ分の余白がある（右・下へ）", (() => { const b = canvasBounds(contentBox({ notes: [note(5000, 4000)] }), 1280, 800); return [b.maxX >= 5190 + 1280, b.maxY >= 4170 + 800]; })(), [true, true]);
eq("左・上（マイナス）にもいくらでも広がる", canvasBounds(contentBox({ notes: [note(-3000, -2000)] }), 1280, 800).minX <= -3000 - 1280, true);
eq("開いた付箋は開いた大きさで測る", contentBox({ notes: [note(0, 0, { expanded: true })] }), { minX: 0, minY: 0, maxX: 430, maxY: 400 });
eq("中の付箋は数えない（親の中に収まる）", contentBox({ notes: [note(0, 0), note(-500, -500, { parentId: "p" })] }), { minX: 0, minY: 0, maxX: 190, maxY: 170 });
eq("文字・領域・画像・手書きも数える", contentBox({ notes: [], texts: [{ x: -100, y: 0 }], zones: [{ x: 0, y: -50, w: 10, h: 10 }],
  images: [{ x: 900, y: 0, w: 300, h: 200 }], strokes: [{ pts: [{ x: 0, y: 3000 }] }] }), { minX: -100, minY: -50, maxX: 1200, maxY: 3000 });
eq("値の無い座標は無視する", contentBox({ notes: [note(undefined, 5), note(10, 10)] }), { minX: 10, minY: 10, maxX: 200, maxY: 180 });
eq("見ている間は縮めない（合わせると広い方）", unionBounds({ minX: -2000, minY: 0, maxX: 3200, maxY: 2200 }, { minX: 0, minY: -100, maxX: 4000, maxY: 2200 }),
  { minX: -2000, minY: -100, maxX: 4000, maxY: 2200 });
eq("きりのよい値（100単位）に広げる", canvasBounds({ minX: -10, minY: 210, maxX: 3250, maxY: 2150 }, 33, 33), { minX: -100, minY: 0, maxX: 3300, maxY: 2200 });

console.log(ng === 0 ? "\nボードの広さ: すべて期待どおりです" : `\nボードの広さ: ${ng} 件 期待と違います`);
process.exit(ng ? 1 : 0);
