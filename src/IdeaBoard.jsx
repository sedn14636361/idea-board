import { useState, useRef, useEffect, useLayoutEffect } from "react";
import {
  loadCloudConf, saveCloudConf, cloudTest, cloudList, cloudRemove, loadCloudDraft, saveCloudDraft,
  projectList, projectPushSplit, projectPullSplit, projectRemoveSplit, projectHead, hashOf,
  cloudDiagnose, makeRoomKey, FIRESTORE_RULES, tagsPush, tagsPull,
} from "./cloud.js";
import { APP_VERSION } from "./version.js";

// ---- 定数 ----
const COLORS = [
  { name: "レモン", bg: "#FFF3A3", edge: "#E8D96A" },
  { name: "さくら", bg: "#FFD6E0", edge: "#F0A8BC" },
  { name: "そら", bg: "#CDEBFF", edge: "#93C9EE" },
  { name: "わかば", bg: "#D6F5C9", edge: "#A3D98F" },
  { name: "ふじ", bg: "#E6DBFF", edge: "#C3AEEE" },
  { name: "グレー", bg: "#EDEBE6", edge: "#C6C1B6" },
];
const DEFAULT_COLOR = COLORS.length - 1; // 新しい付箋の既定色（灰色）
const STORAGE_KEY = "idea-board-state";          // 旧形式（読み込み時に移行するだけ）
const INDEX_KEY = "idea-board-index";            // プロジェクト一覧と共通設定
const projKey = (id) => `idea-board-project:${id}`;   // プロジェクト本体（1つずつ保存）
const backupKey = (id) => `idea-board-backups:${id}`; // 復元ポイント（プロジェクトごと）
const BACKUP_MAX = 6;                       // 残す復元ポイントの数
const BACKUP_INTERVAL_MS = 10 * 60 * 1000;  // これだけ間が空いたら新しい復元ポイントを作る

// 保存先の読み書き（アプリ版では localStorage に置き換わる）
const storeGet = async (key) => localStorage.getItem(key);
const storeSet = async (key, value) => {
  localStorage.setItem(key, value); // 容量超過時は例外が飛ぶ（呼び出し側で処理）
};
const storeDelete = async (key) => localStorage.removeItem(key);
const MAX_DEPTH = 2; // 0,1,2 の3段階まで

// 設定画面で変更できる既定値
const DEFAULT_SETTINGS = {
  grid: 26,          // グリッド間隔(px)
  canvasW: 3200,     // キャンバス幅
  canvasH: 2200,     // キャンバス高さ
  noteTagLimit: 3,   // 付箋上に表示するタグ数（超過分は +n に格納）
  overviewZoom: 0.65, // この倍率より縮小したら、付箋を見出し表示に切り替える
  colorNotes: ["", "", "", "", "", ""], // 色ごとの使い分けメモ（設定画面で編集）
  confirmDelete: true,                  // 剥がすときに確認するか
  showColorNotes: true,                  // 色を選ぶときにメモを表示するか
  textSizes: [15, 22, 34], // ボード直書き文字のサイズ3段階
  // 赤色で強調表示するタグ（重要・緊急を示すもの）
  alertTags: ["重要度高", "優先度高", "未", "未実装"],
  // overview: 縮小して俯瞰したときに優先して表示するカテゴリ（付箋の中身が分かるものを優先）
  presetTags: [
    { name: "シーン", color: "#4A78B0", overview: true, tags: ["起", "承", "転", "結", "メイン", "サブ", "深掘り", "描写", "伏線1", "伏線2"] },
    { name: "設定", color: "#7A5FA8", overview: true, tags: ["キャラクター", "世界観", "ギミック"] },
    { name: "アイデア", color: "#C77E3C", overview: false, tags: ["重要度高", "重要度中", "重要度低", "実装", "未実装"] },
    { name: "その他", color: "#4C7A4C", overview: false, tags: ["済", "未", "優先度高", "優先度中", "優先度低"] },
  ],
};

// カテゴリ色の予備パレット（色未設定のカテゴリに順番に割り当て）
const CATEGORY_FALLBACK = ["#4A78B0", "#7A5FA8", "#C77E3C", "#4C7A4C", "#B0483C", "#3E8E8E"];
const FREE_TAG_COLOR = "#6B665C"; // どのカテゴリにも属さない自由タグ
const ALERT_TAG_COLOR = "#C6392B"; // 重要・緊急タグの赤
const tint = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

let idSeq = 1;
const nextId = () => `n${Date.now().toString(36)}_${idSeq++}`;

function makeNote(x, y, parentId, num) {
  const child = !!parentId;
  return {
    id: nextId(),
    num,
    parentId: parentId || null,
    x, y,
    title: "",
    useTitle: false,
    text: "",
    tags: [],
    refs: [],
    color: DEFAULT_COLOR,
    z: 1,
    expanded: false,
    w: child ? 160 : 190,
    h: child ? 140 : 170,
    ew: child ? 340 : 430,
    eh: child ? 300 : 400,
  };
}

const noteDefaults = (n) => ({
  parentId: null, expanded: false, title: "", tags: [], refs: [],
  w: 190, h: 170, ew: 430, eh: 400,
  // 既存データ: タイトルが入っていればタイトル欄を使う扱いにする
  useTitle: (n.title || "").trim() !== "",
  ...n,
});

const makeBoard = (title) => ({ id: nextId(), title, notes: [], edges: [], texts: [], zones: [], strokes: [], images: [], nextNum: 1 });

// 画像は保存容量を抑えるため、長辺をこのサイズに縮小して取り込む
const IMAGE_MAX_PX = 1400;

// 手書きのペン設定
const PEN_COLORS = ["#3E3A33", "#B0483C", "#3D6FB4", "#4C7A4C", "#C98A3D"];
const PEN_WIDTHS = [2, 4, 8];

const makeProject = (name) => {
  const b = makeBoard("ボード1");
  return { id: nextId(), name, boards: [b], currentBoardId: b.id };
};

// 通し番号を「今ある付箋だけ・空きなし」に詰め直す。
// 並び順は今の番号のままなので、消した付箋より後ろだけが繰り上がる。
// 本文の #番号 も同じ対応表で一度に置換し、同じ付箋を指し続けるようにする
// （置換は1パスなので #7→#5 と #5→#4 が連鎖することはない）。
function renumber(notes) {
  const order = [...notes].sort((a, b) => (a.num || 0) - (b.num || 0));
  const newNumOf = new Map();   // id → 新しい番号
  const remap = new Map();      // 旧番号 → 新番号
  let changed = false;
  order.forEach((n, i) => {
    const nn = i + 1;
    newNumOf.set(n.id, nn);
    if (n.num) remap.set(n.num, nn);
    if (n.num !== nn) changed = true;
  });
  if (!changed) return { notes, nextNum: notes.length + 1 };
  const fixText = (t) =>
    typeof t === "string" && t.includes("#")
      // 該当する付箋が無い番号（#999 など）はただの文字なので触らない
      ? t.replace(/#(\d+)/g, (m, d) => { const to = remap.get(parseInt(d, 10)); return to ? `#${to}` : m; })
      : t;
  return {
    notes: notes.map((n) => ({ ...n, num: newNumOf.get(n.id), text: fixText(n.text) })),
    nextNum: notes.length + 1,
  };
}

// 読み込み時の整備: 通し番号の付与と、深すぎる入れ子の展開解除
function normalizeBoard(b) {
  let notes = (b.notes || []).map(noteDefaults);
  let maxN = 0;
  for (const n of notes) if (n.num) maxN = Math.max(maxN, n.num);
  notes = notes.map((n) => (n.num ? n : { ...n, num: ++maxN }));
  const map = Object.fromEntries(notes.map((n) => [n.id, n]));
  const depthOf = (n) => {
    let d = 0, p = n.parentId;
    while (p && map[p]) { d++; p = map[p].parentId; }
    return d;
  };
  notes = notes.map((n) => (depthOf(n) >= MAX_DEPTH ? { ...n, expanded: false } : n));
  // 過去の削除でできた飛び番号も、ここで 1..N に詰める
  const packed = renumber(notes);
  return { ...b, notes: packed.notes, edges: b.edges || [], texts: b.texts || [], zones: b.zones || [], strokes: b.strokes || [], images: b.images || [], nextNum: packed.nextNum };
}

function anchorIdOf(id, map) {
  const chain = [];
  let cur = map[id];
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentId ? map[cur.parentId] : null;
  }
  for (let i = 0; i < chain.length - 1; i++) {
    if (!chain[i].expanded) return chain[i].id;
  }
  return id;
}

function collectDescendants(id, byParent, acc = []) {
  for (const c of byParent[id] || []) {
    acc.push(c.id);
    collectDescendants(c.id, byParent, acc);
  }
  return acc;
}

export default function IdeaBoard() {
  const [projects, setProjects] = useState([]);     // 読み込み済みのプロジェクト
  const [projectMetas, setProjectMetas] = useState([]); // 一覧表示用の軽い情報（名前・件数）
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [projMenuOpen, setProjMenuOpen] = useState(false);
  const [connectFrom, setConnectFrom] = useState(null);
  const [colorMenuFor, setColorMenuFor] = useState(null);
  const [tagMenuFor, setTagMenuFor] = useState(null);
  const [tagInput, setTagInput] = useState("");
  const [quoteMenuFor, setQuoteMenuFor] = useState(null);
  const [quoteQuery, setQuoteQuery] = useState("");
  const [copyMenuFor, setCopyMenuFor] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]); // 複数選択中の付箋（最上位のみ）
  const [selectedTextIds, setSelectedTextIds] = useState([]); // 複数選択中のボード文字
  const [selBox, setSelBox] = useState(null); // 範囲選択の矩形 {x1,y1,x2,y2}
  const [edgeMenu, setEdgeMenu] = useState(null); // 線のメモ編集 {id}
  const [zoneMode, setZoneMode] = useState(false); // 領域作成モード
  const [selectMode, setSelectMode] = useState(false); // 範囲選択モード（タッチ操作用）
  const [drawMode, setDrawMode] = useState(false); // 手書きモード
  const [eraseMode, setEraseMode] = useState(false); // 消しゴム
  const [eraseKind, setEraseKind] = useState("part"); // "part"=なぞった部分だけ / "whole"=線ごと消す
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [penWidth, setPenWidth] = useState(PEN_WIDTHS[1]);
  const [penFingerDraw, setPenFingerDraw] = useState(true); // 指でも描くか（オフならApple Pencilのみ）
  const [showStrokes, setShowStrokes] = useState(true); // 手書きレイヤーの表示
  const [liveStroke, setLiveStroke] = useState(null); // 描画中の線
  const [imgError, setImgError] = useState(null); // 画像取り込みのエラー表示
  const [listOpen, setListOpen] = useState(false); // 付箋リスト（サイドパネル）
  const [listQuery, setListQuery] = useState("");
  const [listTag, setListTag] = useState(null); // リストの絞り込みタグ
  const [listScope, setListScope] = useState("board"); // "board" | "project"
  const [listPicked, setListPicked] = useState([]);   // 一覧で選んだ付箋（今のボードのみ）
  const [listActionOpen, setListActionOpen] = useState(null); // "copy" | "move" | null
  const [pendingJump, setPendingJump] = useState(null); // ボード切替後にジャンプする付箋
  const [propMode, setPropMode] = useState(true); // 追加時にプロパティを選ぶモード（既定ON）
  const [backups, setBackups] = useState([]); // 復元ポイントの一覧（日時のみ）
  const [startOpen, setStartOpen] = useState(false); // 起動時のプロジェクト選択画面
  const [startPick, setStartPick] = useState(null);  // 起動画面で選んでいるもの {id, from}
  const [helpOpen, setHelpOpen] = useState(false);  // 使い方
  const [addMenuOpen, setAddMenuOpen] = useState(false); // 「追加」メニュー
  const [viewMenuOpen, setViewMenuOpen] = useState(false); // 「表示」メニュー
  const [pendingNote, setPendingNote] = useState(null); // 貼る前の付箋 {x,y,parentId,color,title,tags}
  const [zoneColorMenuFor, setZoneColorMenuFor] = useState(null);
  const [activeTag, setActiveTag] = useState(null);
  const [tagPanelOpen, setTagPanelOpen] = useState(false);
  const [tagPanelTag, setTagPanelTag] = useState(null);
  const [flashId, setFlashId] = useState(null);
  const [confirmBox, setConfirmBox] = useState(null);
  const [gridMode, setGridMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [simpleStyle, setSimpleStyle] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsRev, setSettingsRev] = useState(0); // 既定に戻す時に入力欄を再描画するためのキー
  const [showAllTags, setShowAllTags] = useState({}); // 付箋ごとのタグ展開状態(非保存)
  const [loaded, setLoaded] = useState(false);
  const [centers, setCenters] = useState({});
  const zRef = useRef(10);
  const dragRef = useRef(null);
  const resizeRef = useRef(null);
  const selBoxRef = useRef(null);
  const zoneDragRef = useRef(null);
  const drawRef = useRef(null);
  const imgDragRef = useRef(null);
  const imgResizeRef = useRef(null);
  const imgInputRef = useRef(null);
  const zoneResizeRef = useRef(null);
  const contentRef = useRef(null);
  const noteEls = useRef({});
  const saveTimer = useRef(null);
  const flashTimer = useRef(null);
  const gridRef = useRef(false);
  gridRef.current = gridMode;
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const scrollerRef = useRef(null);

  // 設定由来の値
  const GRID = settings.grid || DEFAULT_SETTINGS.grid;
  const CANVAS_W = settings.canvasW || DEFAULT_SETTINGS.canvasW;
  const CANVAS_H = settings.canvasH || DEFAULT_SETTINGS.canvasH;
  const snap = (v) => Math.round(v / GRID) * GRID;
  // 縮小して全体を見ているときは、付箋を見出し＋タグの表示に切り替える
  const OVERVIEW_ZOOM = settings.overviewZoom ?? DEFAULT_SETTINGS.overviewZoom;
  const overview = zoom < OVERVIEW_ZOOM;
  const updateSettings = (patch) => setSettings((s) => ({ ...s, ...patch }));

  // 付箋がどの領域の中にあるか（中心が入っているかで判定。重なっていれば小さいほうを優先）
  const zoneOfIn = (brd, n) => {
    if (!brd || n.parentId) return null; // 入れ子の中の付箋は対象外
    const w = n.expanded ? n.ew : n.w;
    const h = n.expanded ? n.eh : n.h;
    const cx = n.x + w / 2;
    const cy = n.y + h / 2;
    const hits = (brd.zones || []).filter(
      (z) => cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h
    );
    if (hits.length === 0) return null;
    return hits.sort((a, b) => a.w * a.h - b.w * b.h)[0];
  };

  // 付箋の見出し: タイトルがあればそれ、なければ本文の最初の1行
  const headingOf = (n) =>
    (n.title || "").trim() || (n.text || "").split("\n").find((l) => l.trim())?.trim() || "";

  // 俯瞰時に優先表示するタグか（中身が分かる「性質」のタグを優先し、進捗・重要度は後回し）
  const isOverviewTag = (t) => {
    const cats = settings.presetTags || [];
    for (const c of cats) {
      if ((c.tags || []).includes(t)) return c.overview !== false;
    }
    return true; // 自由入力タグは中身を表す可能性が高いので優先側
  };

  // タグの色: 赤色強調タグ > 属するカテゴリの色 > 自由タグ色
  const tagColorOf = (t) => {
    if ((settings.alertTags || []).includes(t)) return ALERT_TAG_COLOR;
    const cats = settings.presetTags || [];
    for (let i = 0; i < cats.length; i++) {
      if ((cats[i].tags || []).includes(t)) return cats[i].color || CATEGORY_FALLBACK[i % CATEGORY_FALLBACK.length];
    }
    return FREE_TAG_COLOR;
  };

  // 一覧に出すための軽い情報だけを取り出す
  const metaOf = (p) => ({
    id: p.id,
    name: p.name,
    boards: p.boards.length,
    notes: p.boards.reduce((a, b) => a + (b.notes || []).length, 0),
  });
  // 読み込み済みのものは最新の内容で上書きした一覧
  const allMetas = projectMetas.map((m) => {
    const loaded = projects.find((p) => p.id === m.id);
    return loaded ? metaOf(loaded) : m;
  });

  const project = projects.find((p) => p.id === currentProjectId) || null;
  const boards = project?.boards || [];
  const currentId = project?.currentBoardId || null;

  const updateProject = (fn) =>
    setProjects((ps) => ps.map((p) => (p.id === currentProjectId ? fn(p) : p)));
  const setBoards = (fn) =>
    updateProject((p) => ({ ...p, boards: typeof fn === "function" ? fn(p.boards) : fn }));
  const setCurrentId = (id) => updateProject((p) => ({ ...p, currentBoardId: id }));

  const board = boards.find((b) => b.id === currentId) || null;
  const notes = board?.notes || [];
  const edges = board?.edges || [];
  const texts = board?.texts || [];
  const zones = board?.zones || [];
  const strokes = board?.strokes || [];
  const images = board?.images || [];

  const updateBoard = (fn) =>
    setBoards((bs) => bs.map((b) => (b.id === currentId ? fn(b) : b)));
  const setNotes = (fn) =>
    updateBoard((b) => ({ ...b, notes: typeof fn === "function" ? fn(b.notes) : fn }));
  const setEdges = (fn) =>
    updateBoard((b) => ({ ...b, edges: typeof fn === "function" ? fn(b.edges) : fn }));
  const setTexts = (fn) =>
    updateBoard((b) => ({ ...b, texts: typeof fn === "function" ? fn(b.texts || []) : fn }));
  const setZones = (fn) =>
    updateBoard((b) => ({ ...b, zones: typeof fn === "function" ? fn(b.zones || []) : fn }));
  const setStrokes = (fn) =>
    updateBoard((b) => ({ ...b, strokes: typeof fn === "function" ? fn(b.strokes || []) : fn }));
  const setImages = (fn) =>
    updateBoard((b) => ({ ...b, images: typeof fn === "function" ? fn(b.images || []) : fn }));

  // ---- 読み込み ----
  // プロジェクトは1件ずつ別々に保存する。まず一覧(INDEX_KEY)を読み、
  // 旧形式(1つにまとまった保存)しかなければ、この場で分割して移行する。
  useEffect(() => {
    (async () => {
      const normalizeProject = (p) => {
        const bs = (p.boards || []).map(normalizeBoard);
        const boards = bs.length > 0 ? bs : [makeBoard("ボード1")];
        return {
          ...p,
          boards,
          currentBoardId: boards.some((b) => b.id === p.currentBoardId) ? p.currentBoardId : boards[0].id,
        };
      };

      const applyCommon = (data) => {
        setGridMode(!!data.gridMode);
        setZoom(data.zoom || 1);
        setSimpleStyle(!!data.simpleStyle);
        if (typeof data.propMode === "boolean") setPropMode(data.propMode);
        if (data.settings) {
          setSettings({
            ...DEFAULT_SETTINGS,
            ...data.settings,
            alertTags: Array.isArray(data.settings.alertTags) ? data.settings.alertTags : DEFAULT_SETTINGS.alertTags,
          });
        }
        zRef.current = data.zMax || 10;
      };

      try {
        const idxRaw = await storeGet(INDEX_KEY);
        if (idxRaw) {
          const idx = JSON.parse(idxRaw);
          applyCommon(idx);
          const metas = (idx.projects || []).map((m) => ({
            id: m.id, name: m.name, boards: m.boards || 0, notes: m.notes || 0,
          }));
          setProjectMetas(metas);
          if (metas.length === 0) {
            const p = makeProject("プロジェクト1");
            setProjectMetas([metaOf(p)]);
            setProjects([p]);
            setCurrentProjectId(p.id);
          } else {
            // 起動を速くするため、前回開いていた1件だけ読み込む
            const cur = idx.currentProjectId && metas.some((m) => m.id === idx.currentProjectId)
              ? idx.currentProjectId : metas[0].id;
            const raw = await storeGet(projKey(cur));
            if (raw) {
              setProjects([normalizeProject(JSON.parse(raw))]);
              setCurrentProjectId(cur);
            } else {
              const p = makeProject("プロジェクト1");
              setProjectMetas([metaOf(p)]);
              setProjects([p]);
              setCurrentProjectId(p.id);
            }
            if (metas.length > 1) { setStartPick({ id: cur, from: "local" }); setStartOpen(true); }
          }
        } else {
          // 旧形式からの移行
          const raw = await storeGet(STORAGE_KEY);
          if (raw) {
            const data = JSON.parse(raw);
            let ps;
            if (data.projects) {
              ps = data.projects.map(normalizeProject);
            } else {
              let bs;
              if (data.boards) bs = data.boards.map(normalizeBoard);
              else bs = [normalizeBoard({ id: nextId(), title: "ボード1", notes: data.notes, edges: data.edges })];
              if (bs.length === 0) bs = [makeBoard("ボード1")];
              ps = [{
                id: nextId(),
                name: "プロジェクト1",
                boards: bs,
                currentBoardId: data.currentId && bs.some((b) => b.id === data.currentId) ? data.currentId : bs[0].id,
              }];
            }
            if (ps.length === 0) ps = [makeProject("プロジェクト1")];
            applyCommon(data);
            setProjects(ps);
            setProjectMetas(ps.map(metaOf));
            setCurrentProjectId(
              data.currentProjectId && ps.some((p) => p.id === data.currentProjectId) ? data.currentProjectId : ps[0].id
            );
            if (ps.length > 1) {
              setStartPick({ id: data.currentProjectId || ps[0].id, from: "local" });
              setStartOpen(true);
            }
          } else {
            const p = makeProject("プロジェクト1");
            setProjectMetas([metaOf(p)]);
            setProjects([p]);
            setCurrentProjectId(p.id);
          }
        }
      } catch (e) {
        console.error("読み込みに失敗しました", e);
        const p = makeProject("プロジェクト1");
        setProjectMetas([metaOf(p)]);
        setProjects([p]);
        setCurrentProjectId(p.id);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // ---- 自動保存 ----
  // プロジェクトは1件ずつ別のキーに保存し、中身が変わったものだけ書き込む
  const savedRef = useRef({});   // 前回保存した内容（プロジェクトIDごと）
  const savedIndexRef = useRef("");

  useEffect(() => {
    if (!loaded) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        for (const p of projects) {
          const payload = JSON.stringify(p);
          if (savedRef.current[p.id] === payload) continue; // 変化なし
          await storeSet(projKey(p.id), payload);
          savedRef.current[p.id] = payload;
          if (p.id === currentProjectId) maybeBackup(p.id, payload);
        }
        const index = JSON.stringify({
          projects: allMetas,
          currentProjectId, gridMode, zoom, simpleStyle, propMode, settings, zMax: zRef.current,
        });
        if (savedIndexRef.current !== index) {
          await storeSet(INDEX_KEY, index);
          savedIndexRef.current = index;
        }
      } catch (e) {
        console.error("保存に失敗しました", e);
        setImgError("保存できませんでした。画像が多すぎる可能性があります（📁メニューからファイルへ保存してバックアップしてください）");
        setTimeout(() => setImgError(null), 6000);
      }
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [projects, currentProjectId, gridMode, zoom, simpleStyle, propMode, settings, loaded]);

  // ---- 矩形の実測 ----
  useLayoutEffect(() => {
    const base = contentRef.current?.getBoundingClientRect();
    if (!base) return;
    const zf = zoomRef.current || 1;
    const next = {};
    for (const [id, el] of Object.entries(noteEls.current)) {
      if (!el || !el.isConnected) continue;
      const r = el.getBoundingClientRect();
      next[id] = {
        cx: (r.left + r.width / 2 - base.left) / zf,
        cy: (r.top + r.height / 2 - base.top) / zf,
        hw: r.width / 2 / zf,
        hh: r.height / 2 / zf,
      };
    }
    setCenters((prev) => {
      const keys = Object.keys(next);
      if (
        keys.length === Object.keys(prev).length &&
        keys.every(
          (k) =>
            prev[k] &&
            Math.abs(prev[k].cx - next[k].cx) < 0.5 &&
            Math.abs(prev[k].cy - next[k].cy) < 0.5 &&
            Math.abs(prev[k].hw - next[k].hw) < 0.5 &&
            Math.abs(prev[k].hh - next[k].hh) < 0.5
        )
      )
        return prev;
      return next;
    });
  });

  const noteMap = Object.fromEntries(notes.map((n) => [n.id, n]));
  const byParent = {};
  for (const n of notes) {
    const key = n.parentId || "root";
    (byParent[key] = byParent[key] || []).push(n);
  }

  // ---- 復元ポイント（自動バックアップ） ----
  // プロジェクトごとにスナップショットを残し、あとから戻せるようにする
  const lastBackupAt = useRef({});
  const [keepFail, setKeepFail] = useState(null);   // 控えを残せず上書きを止めたプロジェクト { id, name }

  const loadBackups = async (pid) => {
    try {
      const raw = await storeGet(backupKey(pid));
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  };

  const writeBackups = async (pid, list) => {
    // 容量に収まらない場合は古いものから捨てて再試行する
    let arr = list.slice(-BACKUP_MAX);
    while (arr.length > 0) {
      try {
        await storeSet(backupKey(pid), JSON.stringify(arr));
        return arr;
      } catch (e) {
        arr = arr.slice(1);
      }
    }
    return [];
  };

  // 控えを1件足す。書いたあと読み戻して、本当に残っているかを返す。
  // writeBackups は容量に入らないと古いものから捨て、最後は何も書かずに終わるので、戻り値だけでは信用できない。
  const makeBackup = async (pid, payload, label) => {
    const list = await loadBackups(pid);
    const entry = { t: Date.now(), label: label || "自動保存", data: payload };
    const saved = await writeBackups(pid, [...list, entry]);
    if (pid === currentProjectId) setBackups(saved.map(({ t, label }) => ({ t, label })));
    const kept = (await loadBackups(pid)).some((b) => b.t === entry.t && b.data === payload);
    if (kept) lastBackupAt.current[pid] = Date.now();
    return kept;
  };

  const maybeBackup = (pid, payload) => {
    if (Date.now() - (lastBackupAt.current[pid] || 0) < BACKUP_INTERVAL_MS) return;
    makeBackup(pid, payload).catch(() => {});
  };

  // 開いているプロジェクトが変わったら、その復元ポイント一覧を読み直す
  useEffect(() => {
    if (!currentProjectId) return;
    loadBackups(currentProjectId)
      .then((list) => setBackups(list.map(({ t, label }) => ({ t, label }))))
      .catch(() => setBackups([]));
  }, [currentProjectId]);

  const restoreBackup = async (t) => {
    const pid = currentProjectId;
    const list = await loadBackups(pid);
    const entry = list.find((b) => b.t === t);
    if (!entry) return;
    setConfirmBox({
      message: `${new Date(t).toLocaleString("ja-JP")} の状態に戻します。\n現在の内容は「復元前」として復元ポイントに残ります。`,
      okLabel: "この状態に戻す",
      action: async () => {
        try {
          const cur = projects.find((p) => p.id === pid);
          if (cur && !(await makeBackup(pid, JSON.stringify(cur), "復元前"))) {
            setKeepFail({ id: pid, name: cur.name });
            return;
          }
          const data = JSON.parse(entry.data);
          const bs = (data.boards || []).map(normalizeBoard);
          const boards = bs.length > 0 ? bs : [makeBoard("ボード1")];
          const restored = {
            ...data,
            id: pid,
            boards,
            currentBoardId: boards.some((b) => b.id === data.currentBoardId) ? data.currentBoardId : boards[0].id,
          };
          setProjects((ps) => ps.map((p) => (p.id === pid ? restored : p)));
          resetViewState();
          setProjMenuOpen(false);
        } catch (e) {
          console.error("復元に失敗しました", e);
        }
      },
    });
  };

  // ---- スマホ連携（同じWi-Fi内の端末から付箋を受け取る） ----
  const bridge = typeof window !== "undefined" ? window.ideaboardBridge : null;
  const isMacApp = bridge?.platform === "darwin";
  const [shareOpen, setShareOpen] = useState(false);

  // スマホ側の色を、このPCの色定義に合わせ直す
  // （色の並び順が違っていても、名前や色コードで照合して同じ色にする）
  const resolveColor = (it) => {
    if (it.colorName) {
      const i = COLORS.findIndex((c) => c.name === it.colorName);
      if (i >= 0) return i;
    }
    if (it.colorBg) {
      const i = COLORS.findIndex((c) => c.bg === it.colorBg);
      if (i >= 0) return i;
      // 同じ色が無ければ、いちばん近い色を選ぶ
      const hex = (v) => parseInt(v.slice(1), 16);
      const t = hex(it.colorBg);
      const tr = (t >> 16) & 255, tg = (t >> 8) & 255, tb = t & 255;
      let best = DEFAULT_COLOR, bestD = Infinity;
      COLORS.forEach((c, idx) => {
        const v = hex(c.bg);
        const d = ((v >> 16 & 255) - tr) ** 2 + ((v >> 8 & 255) - tg) ** 2 + ((v & 255) - tb) ** 2;
        if (d < bestD) { bestD = d; best = idx; }
      });
      return best;
    }
    if (typeof it.color === "number" && it.color >= 0 && it.color < COLORS.length) return it.color;
    return DEFAULT_COLOR;
  };

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [cloud, setCloud] = useState(null);      // クラウド同期の設定
  const [cloudForm, setCloudForm] = useState({ projectId: "", apiKey: "", room: "" });
  const [cloudMsg, setCloudMsg] = useState("");
  const [cloudItems, setCloudItems] = useState([]); // クラウドに届いている付箋
  const [cloudProjects, setCloudProjects] = useState([]); // クラウドにあるプロジェクト一覧
  const [cloudProjMsg, setCloudProjMsg] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);   // 届いた付箋の確認画面
  const [previewPicked, setPreviewPicked] = useState([]);  // 貼るものとして選んだID
  const [tagSyncMsg, setTagSyncMsg] = useState("");
  const tagsLoaded = useRef(false);   // クラウドから読み終わったか
  const tagsSaved = useRef("");       // 最後にクラウドへ上げた内容
  const cloudSavedAt = useRef({});  // プロジェクトごとの最終アップ時刻
  const [setupOpen, setSetupOpen] = useState(false);   // かんたん設定の画面
  const [setupStep, setSetupStep] = useState(0);
  const [setupMsg, setSetupMsg] = useState(null);      // 診断の結果
  const [setupBusy, setSetupBusy] = useState(false);

  // スマホでコピーした内容を貼り付けて取り込む
  const importPasted = () => {
    const raw = pasteText.trim();
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      const items = Array.isArray(data) ? data : data.items || [];
      const catalog = Array.isArray(data) ? null : data.tagCatalog;
      if (items.length === 0) return;
      placeIncoming(items, catalog);
      setPasteText("");
      setPasteOpen(false);
      setShareOpen(false);
    } catch (e) {
      console.error("取り込めませんでした", e);
    }
  };

  // --- クラウド同期（出先のスマホからでも届く） ---
  useEffect(() => {
    const c = loadCloudConf();
    if (c) { setCloud(c); setCloudForm(c); return; }
    const d = loadCloudDraft();
    if (d) setCloudForm(d);
  }, []);

  // 入力途中の内容も控えておく
  useEffect(() => {
    if (cloudForm.projectId || cloudForm.apiKey || cloudForm.room) saveCloudDraft(cloudForm);
  }, [cloudForm]);

  const checkCloud = async (conf = cloud) => {
    if (!conf) return;
    try {
      const list = await cloudList(conf);
      setCloudItems(list);
    } catch (e) { /* つながらないときは何もしない */ }
  };

  // 定期的に確認する（パネルを開いている間は短い間隔で）
  useEffect(() => {
    if (!cloud) return;
    checkCloud();
    const id = setInterval(() => checkCloud(), shareOpen ? 8000 : 60000);
    return () => clearInterval(id);
  }, [cloud, shareOpen]);

  // --- かんたん設定（受け取った人が自分でクラウドを用意できるように） ---
  const linkBtn = {
    border: "none", borderRadius: 6, background: "#3E3A33", color: "#F6F2E9",
    fontSize: 12, fontWeight: 700, padding: "7px 14px", cursor: "pointer",
  };

  const openLink = (url) => {
    if (bridge?.openExternal) bridge.openExternal(url);
    else window.open(url, "_blank");
  };

  // Firebaseの画面を直接開く。メニューの位置が変わっても迷わないようにするため。
  // プロジェクトIDが未入力のときは、最後に開いたプロジェクトが対象になる
  const fbLink = (path) => {
    const pid = cloudForm.projectId.trim() || "_";
    return `https://console.firebase.google.com/project/${encodeURIComponent(pid)}/${path}`;
  };

  const copyToClip = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      return false;
    }
  };

  const runDiagnose = async () => {
    setSetupBusy(true);
    setSetupMsg(null);
    const c = {
      projectId: cloudForm.projectId.trim(),
      apiKey: cloudForm.apiKey.trim(),
      room: cloudForm.room.trim() || makeRoomKey(),
    };
    if (!cloudForm.room.trim()) setCloudForm((v) => ({ ...v, room: c.room }));
    const r = await cloudDiagnose(c);
    setSetupMsg(r);
    if (r.ok) {
      saveCloudConf(c);
      setCloud(c);
      checkCloud(c);
      refreshCloudProjects(c);
    }
    setSetupBusy(false);
  };

  // --- タグ表の共有（どの端末でも同じタグを使う） ---
  // クラウドにあるものを正とし、起動のたびに読み直す
  const pullTags = async (conf = cloud) => {
    if (!conf) return;
    try {
      const r = await tagsPull(conf);
      if (r) {
        setSettings((st) => ({
          ...st,
          presetTags: r.presetTags,
          alertTags: r.alertTags.length > 0 ? r.alertTags : st.alertTags,
        }));
        tagsSaved.current = JSON.stringify({ presetTags: r.presetTags, alertTags: r.alertTags });
      } else {
        // クラウドにまだ無ければ、手元のものを置いておく
        const data = { presetTags: settings.presetTags || [], alertTags: settings.alertTags || [] };
        await tagsPush(conf, data);
        tagsSaved.current = JSON.stringify(data);
      }
    } catch (e) { /* つながらないときは手元のものを使う */ }
    tagsLoaded.current = true;
  };

  useEffect(() => {
    if (!cloud) return;
    tagsLoaded.current = false;
    pullTags();
  }, [cloud]);

  // タグを変えたらクラウドにも反映する
  useEffect(() => {
    if (!cloud || !loaded || !tagsLoaded.current) return;
    const data = { presetTags: settings.presetTags || [], alertTags: settings.alertTags || [] };
    const body = JSON.stringify(data);
    if (body === tagsSaved.current) return;
    const t = setTimeout(async () => {
      const ok = await tagsPush(cloud, data).catch(() => false);
      if (ok) tagsSaved.current = body;
    }, 3000);
    return () => clearTimeout(t);
  }, [settings.presetTags, settings.alertTags, cloud, loaded]);

  // --- プロジェクトの共有（パソコン同士で同じボードを使う） ---
  const deviceName = () => {
    // どのパソコンから上げたか分かるようにしておく
    if (bridge?.platform === "darwin") return "Mac";
    if (bridge?.platform === "win32") return "Windows";
    return "ブラウザ";
  };

  // 一覧を取り直す。電波が無いときは null を返す（「サーバーに何も無い」と区別するため）
  const refreshCloudProjects = async (conf = cloud) => {
    if (!conf) return null;
    try {
      const list = await projectList(conf);
      setCloudProjects(list);
      return list;
    } catch (e) { return null; }
  };

  // ---- サーバーを正とする保存 ----
  // クラウドを設定していれば、すべてのプロジェクトをサーバーに置く（既定）。
  // 手元(localStorage)は控え。電波が無くても使え、戻ったら同期する。
  // プロジェクト単位で「サーバーに置かない」を選ぶこともできる（cloudOptOut）。
  //
  // syncState[pid] = { h: 最後に同期した中身の指紋, at: そのときのサーバー更新時刻 }
  //   再起動をまたいで「手元に未送信の編集があるか」「サーバーが新しいか」を判断するために保存する。
  //   h が今の中身と違えば「手元に未送信の編集がある」、サーバーの savedAt が at より新しければ
  //   「他の端末が更新した」。両方なら競合なので、黙って上書きせず利用者に選んでもらう。
  const [cloudOptOut, setCloudOptOut] = useState([]);
  const [syncConflict, setSyncConflict] = useState(null);   // { id, name, device }
  const syncState = useRef({});
  const pushHashes = useRef({});     // ボードごとの指紋（変わったボードだけ送るため）
  const reconciled = useRef(false);  // 起動後にサーバーと突き合わせ終えたか。終わるまでは送らない
  const syncLoaded = useRef(false);  // 同期の記録を読み終えたか。終わるまでは突き合わせもしない
  const syncBusy = useRef(false);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const optOutRef = useRef(cloudOptOut);
  optOutRef.current = cloudOptOut;
  const curPidRef = useRef(currentProjectId);
  curPidRef.current = currentProjectId;

  const SLACK = 2000;   // 時計のずれを見込む
  const syncedOn = (pid) => !!cloud && !optOutRef.current.includes(pid);
  const cloudShared = cloud ? allMetas.map((m) => m.id).filter((id) => !cloudOptOut.includes(id)) : [];
  const projHash = (p) => hashOf(JSON.stringify(p));
  // 何も書いていない白紙のプロジェクトか（新しい端末で自動的に作られるもの）
  const isBlank = (p) =>
    (p.boards || []).length <= 1 &&
    (p.boards || []).every((b) => ["notes", "edges", "texts", "zones", "strokes", "images"].every((k) => !(b[k] || []).length));
  const persistSync = () => storeSet("idea-board-sync-state", JSON.stringify(syncState.current)).catch(() => {});

  // 同期の記録を読んでから突き合わせる。
  // 記録が空のまま突き合わせると、すべてを「この端末では初めて」と見なしてサーバーで上書きしてしまい、
  // オフラインのあいだに書いた編集が手元から消える（復元ポイントには残るが、利用者は気づけない）。
  useEffect(() => {
    if (!cloud) return;
    syncLoaded.current = false;
    reconciled.current = false;
    (async () => {
      try { const v = await storeGet("idea-board-sync-state"); syncState.current = v ? JSON.parse(v) : {}; } catch (e) {}
      try {
        const v = await storeGet("idea-board-cloud-optout");
        const ids = v ? JSON.parse(v) : [];
        optOutRef.current = ids;          // state の反映を待たずに、すぐ使えるようにする
        setCloudOptOut(ids);
      } catch (e) {}
      syncLoaded.current = true;
      reconcile();
    })();
  }, [cloud]);

  useEffect(() => {
    if (!loaded) return;
    storeSet("idea-board-cloud-optout", JSON.stringify(cloudOptOut)).catch(() => {});
  }, [cloudOptOut, loaded]);

  // サーバーから読んだものを、画面に出せる形に組み立てる
  const buildPulled = (id, r) => {
    const data = r.project;
    const bs = (data.boards || []).map(normalizeBoard);
    const boards = bs.length > 0 ? bs : [makeBoard("ボード1")];
    return {
      ...data,
      id,
      boards,
      currentBoardId: boards.some((b) => b.id === data.currentBoardId) ? data.currentBoardId : boards[0].id,
    };
  };

  // サーバーから読んだものを画面に反映する（位置もそのまま再現される）
  const applyPulled = (id, r, built) => {
    const proj = built || buildPulled(id, r);
    pushHashes.current[id] = r.hashes || {};
    syncState.current[id] = { h: projHash(proj), at: r.savedAt };
    persistSync();
    setProjects((ps) => (ps.some((p) => p.id === id) ? ps.map((p) => (p.id === id ? proj : p)) : [...ps, proj]));
    setProjectMetas((ms) => (ms.some((m) => m.id === id) ? ms.map((m) => (m.id === id ? metaOf(proj) : m)) : [...ms, metaOf(proj)]));
    return proj;
  };

  // サーバーから読み、手元を置き換える。
  // 手元の内容が違うときは、**控えを残せたと確かめてから**置き換える。残せなければ置き換えない。
  // 「手元は前回同期したまま」でも控えは省かない。他の端末が「この端末の方」を選ぶと、
  // サーバー上の同じ版は上書きされ、この端末の手元にしか残っていないことがあるため。
  const pullOne = async (id, local) => {
    const r = await projectPullSplit(cloud, id);
    if (!r || !r.project) return null;
    const proj = buildPulled(id, r);
    if (local && projHash(local) !== projHash(proj)) {
      const kept = await makeBackup(id, JSON.stringify(local), "サーバーから読み込む前").catch(() => false);
      if (!kept) {
        setKeepFail({ id, name: local.name });
        return null;
      }
    }
    if (keepFail?.id === id) setKeepFail(null);
    if (syncConflict?.id === id) setSyncConflict(null);
    return applyPulled(id, r, proj);
  };

  // サーバーへ送る（中身が変わったボードだけ）。
  // 送る直前にサーバーの更新時刻を確かめ、他の端末が先に書いていたら上書きしない。
  const pushOne = async (p, force = false) => {
    // 確かめずに送る（force）のは、利用者が「この端末の方」を選んだときと、
    // たった今サーバーに無いと確かめたときだけ。
    if (!force) {
      const head = await projectHead(cloud, p.id);
      const known = syncState.current[p.id];
      // この端末で一度も同期していないのにサーバーにある → どちらが新しいか分からないので上書きしない
      if (head && (!known || head.savedAt > known.at + SLACK)) {
        setSyncConflict({ id: p.id, name: p.name, device: head.device });
        return false;
      }
    }
    const r = await projectPushSplit(cloud, p, deviceName(), pushHashes.current[p.id] || {});
    if (!r.ok) return false;
    pushHashes.current[p.id] = r.hashes;
    syncState.current[p.id] = { h: projHash(p), at: r.savedAt };
    persistSync();
    if (syncConflict?.id === p.id) setSyncConflict(null);
    return true;
  };

  // 手元とサーバーを突き合わせる。
  //   手元だけ変わった → 送る / サーバーだけ新しい → 読む / 両方変わった → 利用者に選んでもらう
  //   この端末でまだ一度も同期していないものは、サーバーにあればサーバーを正とする（手元は復元ポイントへ）
  //   サーバーに無いものは送る（初めてクラウドを設定したときの移行）
  // full: 全件の一覧を取る（起動時・プロジェクトを開いたとき・パネルを開いたとき）。
  // そうでなければ、開いているプロジェクトの目次だけ確かめる（定期の確認）。
  // 一覧は全ページ読むので文書の数だけ読み取りが増え、定期に回すと Firestore の無料枠を使い切る。
  const reconcile = async (full = true) => {
    if (!cloud || !syncLoaded.current || syncBusy.current) return;
    syncBusy.current = true;
    try {
      let list = [];
      const onServer = new Map();
      if (full) {
        list = await refreshCloudProjects(cloud);
        if (list === null) return;                     // つながらない・失敗。手元のまま続ける
        for (const x of list) onServer.set(x.id, x);
      } else {
        for (const p of projectsRef.current) {
          if (!syncedOn(p.id)) continue;
          const h = await projectHead(cloud, p.id);    // 失敗は例外になり、この回は中断する
          if (h) onServer.set(p.id, { id: p.id, ...h });
        }
      }

      // この端末が白紙のプロジェクトしか持っていないなら、サーバーの最新を開く。
      // 新しい端末でHTMLを開いたとき、自分のデータがそのまま出るようにするため。
      const cur = projectsRef.current.find((p) => p.id === curPidRef.current);
      if (cur && isBlank(cur) && !syncState.current[cur.id] && !onServer.has(cur.id) && list.length > 0) {
        const latest = list[0];                                   // 新しい順に並んでいる
        const r = await projectPullSplit(cloud, latest.id);
        if (r && r.project) {
          const proj = applyPulled(latest.id, r);
          // 白紙は片づける（中身が無いので失うものは無い）
          setProjects((ps) => ps.filter((p) => p.id !== cur.id));
          setProjectMetas((ms) => ms.filter((m) => m.id !== cur.id));
          storeDelete(projKey(cur.id)).catch(() => {});
          projectsRef.current = [...projectsRef.current.filter((p) => p.id !== cur.id && p.id !== latest.id), proj];
          setCurrentProjectId(latest.id);
          resetViewState();
        }
      }

      for (const p of projectsRef.current) {
        if (!syncedOn(p.id)) continue;
        const s = onServer.get(p.id);
        const known = syncState.current[p.id];
        // 一度も同期していない白紙は送らない（空の「プロジェクト1」がサーバーに増えていくのを防ぐ）
        if (!s && !known && isBlank(p)) continue;
        if (!s) { await pushOne(p); continue; }         // 送る直前にもう一度確かめる
        if (!known) { await pullOne(p.id, p); continue; }
        const dirty = projHash(p) !== known.h;
        const newer = s.savedAt > known.at + SLACK;
        if (newer && dirty) { setSyncConflict({ id: p.id, name: p.name, device: s.device }); continue; }
        if (newer) { await pullOne(p.id, p); continue; }
        if (dirty) await pushOne(p);
      }

      // まだ開いていない手元のプロジェクトも、サーバーに無ければ送っておく（全件の一覧を取ったときだけ）
      for (const m of full ? projectMetas : []) {
        if (!syncedOn(m.id) || onServer.has(m.id) || projectsRef.current.some((p) => p.id === m.id)) continue;
        try {
          if (await projectHead(cloud, m.id)) continue;  // サーバーにある。開いたときに突き合わせる
          const raw = await storeGet(projKey(m.id));
          if (raw) await pushOne(JSON.parse(raw), true);
        } catch (e) { /* 読めないものは飛ばす */ }
      }
      reconciled.current = true;
    } catch (e) {
      /* 電波が無いなど。次の機会にやり直す */
    } finally {
      syncBusy.current = false;
    }
  };

  // 編集が落ち着いたら、変わったプロジェクトをサーバーへ送る。
  // 起動直後の突き合わせが終わるまでは送らない（サーバーの新しい中身を古い手元で上書きしないため）。
  useEffect(() => {
    if (!loaded || !cloud) return;
    const t = setTimeout(async () => {
      if (!reconciled.current) { reconcile(); return; }
      if (syncBusy.current) return;
      syncBusy.current = true;
      try {
        for (const p of projectsRef.current) {
          if (!syncedOn(p.id)) continue;
          const known = syncState.current[p.id];
          if (known && projHash(p) === known.h) continue;   // 変わっていない
          if (!known && isBlank(p)) continue;               // 何か書くまでは送らない
          await pushOne(p);
        }
      } catch (e) {
        /* 電波が無いなど。次の編集か定期の突き合わせで送る */
      } finally {
        syncBusy.current = false;
      }
    }, 3000);
    return () => clearTimeout(t);
  }, [projects, cloud, loaded, cloudOptOut]);

  // プロジェクトを開いたら、そのプロジェクトがサーバーで更新されていないか確かめる
  useEffect(() => {
    if (!loaded || !cloud || !currentProjectId) return;
    reconcile();
  }, [currentProjectId]);

  // 他の端末で更新されていないか、定期的に確かめる
  useEffect(() => {
    if (!cloud) return;
    if (shareOpen) reconcile(true);
    const id = setInterval(() => reconcile(false), shareOpen ? 10000 : 60000);
    return () => clearInterval(id);
  }, [cloud, shareOpen]);

  // 「同期する」ボタン／サーバーに置き直す
  const pushProjectToCloud = async (pid) => {
    const p = projects.find((x) => x.id === pid);
    if (!p || !cloud) return;
    setCloudOptOut((ids) => ids.filter((x) => x !== pid));
    optOutRef.current = optOutRef.current.filter((x) => x !== pid);
    setCloudProjMsg("送っています…");
    try {
      const ok = await pushOne(p);
      setCloudProjMsg(ok ? "" : "他の端末で更新されています。上の案内から選んでください");
      refreshCloudProjects();
    } catch (e) {
      setCloudProjMsg("送れませんでした（電波を確認してください）");
    }
  };

  // サーバーからプロジェクトを開く
  const pullProjectFromCloud = async (id) => {
    if (!cloud) return;
    setCloudProjMsg("読み込み中…");
    try {
      const local = projects.find((p) => p.id === id);
      const proj = await pullOne(id, local);
      if (!proj) { setCloudProjMsg("読み込めませんでした"); return; }
      setCloudOptOut((ids) => ids.filter((x) => x !== id));
      setCurrentProjectId(id);
      resetViewState();
      setCloudProjMsg("");
      setShareOpen(false);
      setStartOpen(false);
    } catch (e) {
      setCloudProjMsg("読み込めませんでした");
    }
  };

  // 競合したとき、こちらの内容でサーバーを上書きする
  const keepLocalVersion = async (id) => {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    try {
      await pushOne(p, true);
      setSyncConflict(null);
    } catch (e) {
      setCloudProjMsg("送れませんでした（電波を確認してください）");
    }
  };

  // このプロジェクトをサーバーに置かない（このパソコンの中身は残る）
  const unshareProject = async (id) => {
    if (!cloud) return;
    setConfirmBox({
      message: "このプロジェクトをサーバーから消し、このパソコンだけに置きます。\n他の端末からは開けなくなります（このパソコンの中身は残ります）。",
      okLabel: "サーバーから消す",
      action: async () => {
        setCloudOptOut((ids) => (ids.includes(id) ? ids : [...ids, id]));
        optOutRef.current = [...optOutRef.current, id];
        await projectRemoveSplit(cloud, id, pushHashes.current[id]?.__parts || {}).catch(() => {});
        delete syncState.current[id];
        delete pushHashes.current[id];
        persistSync();
        refreshCloudProjects();
      },
    });
  };

  // 競合中のもの（パネルの案内に使う）
  const cloudNewer = syncConflict && syncConflict.id === currentProjectId ? syncConflict : null;

  // 届いた付箋を確認する画面を開く（このプロジェクト宛てのものを最初から選んでおく）
  const openPreview = () => {
    if (cloudItems.length === 0) return;
    const mine = cloudItems.filter(
      (x) => !x.targetProjectId || x.targetProjectId === currentProjectId
    );
    setPreviewPicked((mine.length > 0 ? mine : cloudItems).map((x) => x._docId).filter(Boolean));
    setPreviewOpen(true);
    setShareOpen(false);
  };

  // 選んだものだけボードに貼り、それだけをクラウドから消す
  const receiveCloud = async () => {
    if (!cloud) return;
    const chosen = cloudItems.filter((x) => previewPicked.includes(x._docId));
    if (chosen.length === 0) return;
    const catalog = chosen.find((x) => Array.isArray(x.tagCatalog))?.tagCatalog
      || cloudItems.find((x) => Array.isArray(x.tagCatalog))?.tagCatalog
      || null;
    placeIncoming(chosen, catalog);
    const ids = chosen.map((x) => x._docId).filter(Boolean);
    setCloudItems((list) => list.filter((x) => !ids.includes(x._docId)));
    setPreviewPicked([]);
    setPreviewOpen(false);
    cloudRemove(cloud, ids).catch(() => {});
  };

  // 選んだものをクラウドから消すだけ（貼らない）
  const discardCloud = () => {
    const ids = previewPicked.slice();
    if (ids.length === 0) return;
    askThen(`選んだ${ids.length}件を、貼らずに消します。よろしいですか？`, "消す", () => {
      setCloudItems((list) => list.filter((x) => !ids.includes(x._docId)));
      setPreviewPicked([]);
      cloudRemove(cloud, ids).catch(() => {});
    });
  };

  const saveCloud = async () => {
    const c = {
      projectId: cloudForm.projectId.trim(),
      apiKey: cloudForm.apiKey.trim(),
      room: cloudForm.room.trim(),
    };
    if (!c.projectId || !c.apiKey || !c.room) { setCloudMsg("3つとも入力してください"); return; }
    setCloudMsg("確認中…");
    try {
      await cloudTest(c);
      const stored = saveCloudConf(c);
      setCloud(c);
      setCloudMsg(stored ? "つながりました" : "つながりましたが、設定を保存できませんでした");
      checkCloud(c);
    } catch (e) {
      setCloudMsg(String(e.message || e));
    }
  };

  // 受け取った付箋を、カテゴリごとにまとめて置く
  const placeIncoming = (items, incoming) => {
    if (!items || items.length === 0) return;

    // スマホで増やしたタグ・カテゴリをこちらの設定にも取り込む
    if (Array.isArray(incoming) && incoming.length > 0) {
      setSettings((st) => {
        const cats = [...(st.presetTags || [])];
        for (const inc of incoming) {
          const idx = cats.findIndex((c) => c.name === inc.name);
          if (idx >= 0) {
            const merged = [...new Set([...(cats[idx].tags || []), ...(inc.tags || [])])];
            cats[idx] = { ...cats[idx], tags: merged };
          } else {
            cats.push({
              name: inc.name,
              color: inc.color || CATEGORY_FALLBACK[cats.length % CATEGORY_FALLBACK.length],
              overview: true,
              tags: [...(inc.tags || [])],
            });
          }
        }
        return { ...st, presetTags: cats };
      });
    }

    // まとめ先（スマホで指定したもの）を優先し、無ければタグのカテゴリでまとめる
    const groups = new Map();
    const groupColor = new Map();
    for (const it of items) {
      const key = ((it.area || "").trim() || (it.category || "").trim() || "");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
      // まとめ先には色が付いてくるので、領域の色に使う
      if ((it.area || "").trim() && it.areaColor && !groupColor.has(key)) groupColor.set(key, it.areaColor);
    }

    // 画面の左上あたりから、空いている場所を探して置く
    const sc = scrollerRef.current;
    const zf = zoom || 1;
    const startX = ((sc?.scrollLeft || 0) + 60) / zf;
    const startY = ((sc?.scrollTop || 0) + 80) / zf;

    const NW = 190, NH = 170, GAP = 24;      // 付箋の大きさと間隔
    const PAD = 22, HEAD = 34;               // 領域の内側の余白と見出しぶん
    const COLS = 3;                          // 3列でまとまりを作る

    let ox = startX, oy = startY, rowH = 0;
    const newZones = [];
    const newNotes = [];

    updateBoard((b) => {
      let num = b.nextNum || 1;
      for (const [catName, list] of groups) {
        const cols = Math.min(COLS, list.length);
        const rows = Math.ceil(list.length / cols);
        const gw = cols * NW + (cols - 1) * GAP + PAD * 2;
        const gh = rows * NH + (rows - 1) * GAP + PAD + HEAD;

        // 横に並べ、広がりすぎたら次の段へ折り返す
        if (ox > startX && ox + gw > startX + 1500) {
          ox = startX;
          oy += rowH + 60;
          rowH = 0;
        }

        const zoneColor = catName
          ? groupColor.get(catName)
            || (settings.presetTags || []).find((c) => c.name === catName)?.color
            || CATEGORY_FALLBACK[newZones.length % CATEGORY_FALLBACK.length]
          : "#C6C1B6";
        if (catName) {
          newZones.push({
            id: nextId(),
            x: gridRef.current ? snap(ox) : ox,
            y: gridRef.current ? snap(oy) : oy,
            w: gw, h: gh, color: zoneColor, label: catName,
          });
        }

        list.forEach((it, i) => {
          const cx = ox + PAD + (i % cols) * (NW + GAP);
          const cy = oy + HEAD + Math.floor(i / cols) * (NH + GAP);
          const n = makeNote(
            gridRef.current ? snap(cx) : cx,
            gridRef.current ? snap(cy) : cy,
            null,
            num++
          );
          n.title = it.title || "";
          n.useTitle = !!(it.title || "").trim();
          n.text = it.text || "";
          n.tags = Array.isArray(it.tags) ? it.tags : [];
          n.color = resolveColor(it);
          n.z = ++zRef.current;
          newNotes.push(n);
        });

        ox += gw + 50;
        rowH = Math.max(rowH, gh);
      }
      return {
        ...b,
        nextNum: num,
        notes: [...b.notes, ...newNotes],
        zones: [...(b.zones || []), ...newZones],
      };
    });
  };

  // ---- 同期フォルダ（他のPCと共有） ----
  const [syncInfo, setSyncInfo] = useState({ folder: null, available: false, device: "" });
  const [syncList, setSyncList] = useState([]);   // フォルダ内のプロジェクト一覧
  const [syncedIds, setSyncedIds] = useState([]); // このPCで同期対象にしているプロジェクト
  const [syncNotice, setSyncNotice] = useState(null); // 他のPCで更新された等の通知
  const syncMtime = useRef({});                   // プロジェクトごとの最終同期時刻

  const refreshSync = async () => {
    if (!bridge?.syncStatus) return;
    try {
      const st = await bridge.syncStatus();
      setSyncInfo(st);
      if (st.available) setSyncList(await bridge.syncList());
    } catch (e) { /* 取得できないときは何もしない */ }
  };

  useEffect(() => {
    if (!bridge?.syncStatus) return;
    // 起動を待たせないよう、少し遅らせて確認する（クラウド上のファイル読み込みは時間がかかる）
    const t = setTimeout(() => refreshSync(), 1200);
    storeGet("idea-board-synced").then((v) => {
      if (v) { try { setSyncedIds(JSON.parse(v)); } catch (e) {} }
    });
    return () => clearTimeout(t);
  }, [bridge]);

  useEffect(() => {
    if (!loaded) return;
    storeSet("idea-board-synced", JSON.stringify(syncedIds)).catch(() => {});
  }, [syncedIds, loaded]);

  const chooseSyncFolder = async () => {
    if (!bridge?.syncChoose) return;
    const st = await bridge.syncChoose();
    setSyncInfo(st);
    if (st.available) setSyncList(await bridge.syncList());
  };

  // 同期フォルダへ書き出す（他のPCから開けるようになる）
  const pushProject = async (pid) => {
    const p = projects.find((x) => x.id === pid);
    if (!p || !bridge?.syncWrite) return;
    const r = await bridge.syncWrite(pid, p, syncMtime.current[pid] || 0);
    if (r.ok) {
      syncMtime.current[pid] = r.mtime;
      setSyncedIds((ids) => (ids.includes(pid) ? ids : [...ids, pid]));
      setSyncList(await bridge.syncList());
    } else if (r.conflict) {
      setSyncNotice({
        pid,
        text: "このプロジェクトは別のPCで更新されています。どちらを残しますか？",
        mtime: r.mtime,
      });
    }
  };

  // 同期フォルダから読み込む
  const pullProject = async (pid) => {
    if (!bridge?.syncRead) return;
    const r = await bridge.syncRead(pid);
    if (!r.ok) return;
    const bs = (r.project.boards || []).map(normalizeBoard);
    const boards = bs.length > 0 ? bs : [makeBoard("ボード1")];
    const proj = {
      ...r.project,
      boards,
      currentBoardId: boards.some((b) => b.id === r.project.currentBoardId) ? r.project.currentBoardId : boards[0].id,
    };
    syncMtime.current[pid] = r.mtime;
    setProjects((ps) => (ps.some((p) => p.id === pid) ? ps.map((p) => (p.id === pid ? proj : p)) : [...ps, proj]));
    setProjectMetas((ms) => (ms.some((m) => m.id === pid) ? ms : [...ms, metaOf(proj)]));
    setSyncedIds((ids) => (ids.includes(pid) ? ids : [...ids, pid]));
    setCurrentProjectId(pid);
    resetViewState();
    setSyncNotice(null);
  };

  // 同期対象のプロジェクトは、保存のたびにフォルダへも書き出す
  useEffect(() => {
    if (!loaded || !bridge?.syncWrite || !syncInfo.available) return;
    if (!syncedIds.includes(currentProjectId)) return;
    const t = setTimeout(() => { pushProject(currentProjectId); }, 2500);
    return () => clearTimeout(t);
  }, [projects, currentProjectId, syncedIds, syncInfo.available, loaded]);

  // 他のPCでの更新を定期的に確認する
  useEffect(() => {
    if (!bridge?.syncList || !syncInfo.available) return;
    const id = setInterval(async () => {
      try {
        const list = await bridge.syncList();
        setSyncList(list);
        const mine = list.find((x) => x.id === currentProjectId);
        if (mine && syncedIds.includes(currentProjectId)) {
          const base = syncMtime.current[currentProjectId] || 0;
          if (mine.mtime - base > 1500 && mine.device && mine.device !== syncInfo.device) {
            setSyncNotice({ pid: currentProjectId, text: `「${mine.device}」で更新されています。`, mtime: mine.mtime });
          }
        }
      } catch (e) { /* 一時的な失敗は無視 */ }
    }, 60000);
    return () => clearInterval(id);
  }, [bridge, syncInfo.available, syncInfo.device, currentProjectId, syncedIds]);

  // ---- プロジェクト操作 ----
  const fileInputRef = useRef(null);

  const resetViewState = () => {
    setConnectFrom(null);
    setColorMenuFor(null);
    setTagMenuFor(null);
    setQuoteMenuFor(null);
    setActiveTag(null);
    setTagPanelOpen(false);
    setTagPanelTag(null);
    setSelectedIds([]);
    setSelectedTextIds([]);
    setSelBox(null);
    setEdgeMenu(null);
    setListTag(null);
    setListPicked([]);
    setPendingJump(null);
    noteEls.current = {};
  };

  // まだ読み込んでいないプロジェクトを読み込む（開くときに初めて読む）
  const ensureProject = async (id) => {
    if (projects.some((p) => p.id === id)) return true;
    try {
      const raw = await storeGet(projKey(id));
      if (!raw) return false;
      const data = JSON.parse(raw);
      const bs = (data.boards || []).map(normalizeBoard);
      const boards = bs.length > 0 ? bs : [makeBoard("ボード1")];
      const proj = {
        ...data,
        boards,
        currentBoardId: boards.some((b) => b.id === data.currentBoardId) ? data.currentBoardId : boards[0].id,
      };
      setProjects((ps) => (ps.some((p) => p.id === id) ? ps : [...ps, proj]));
      return true;
    } catch (e) {
      console.error("プロジェクトを開けませんでした", e);
      return false;
    }
  };

  const switchProject = async (id) => {
    await ensureProject(id);
    setCurrentProjectId(id);
    resetViewState();
    setProjMenuOpen(false);
  };

  const addProject = () => {
    const p = makeProject(`プロジェクト${allMetas.length + 1}`);
    setProjects((ps) => [...ps, p]);
    setProjectMetas((ms) => [...ms, metaOf(p)]);
    setCurrentProjectId(p.id);
    resetViewState();
    setProjMenuOpen(false);
  };

  const removeProject = (id) => {
    const target = allMetas.find((m) => m.id === id);
    setConfirmBox({
      message: `プロジェクト「${target?.name || "無題"}」を削除します。中のボード・付箋もすべて消えます。よろしいですか？`,
      okLabel: "削除する",
      action: () => {
        // 保存済みのデータと復元ポイントも消す
        storeDelete(projKey(id));
        storeDelete(backupKey(id));
        delete savedRef.current[id];
        const restMetas = allMetas.filter((m) => m.id !== id);
        const rest = projects.filter((p) => p.id !== id);
        if (restMetas.length === 0) {
          const p = makeProject("プロジェクト1");
          setProjects([p]);
          setProjectMetas([metaOf(p)]);
          setCurrentProjectId(p.id);
        } else {
          setProjects(rest);
          setProjectMetas(restMetas);
          if (!restMetas.some((m) => m.id === currentProjectId)) switchProject(restMetas[0].id);
        }
        resetViewState();
      },
    });
  };

  const exportProject = (target = project) => {
    if (!target) return;
    try {
      const blob = new Blob([JSON.stringify({ ideaboardProject: 1, ...target }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(target.name || "project").replace(/[\\/:*?"<>|]/g, "_")}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      console.error("書き出しに失敗しました", e);
    }
  };

  const importProject = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const bs = (data.boards || []).map(normalizeBoard);
        const p = {
          id: nextId(),
          name: data.name || "読み込んだプロジェクト",
          boards: bs.length > 0 ? bs : [makeBoard("ボード1")],
          currentBoardId: null,
        };
        p.currentBoardId = p.boards.some((b) => b.id === data.currentBoardId) ? data.currentBoardId : p.boards[0].id;
        setProjects((ps) => [...ps, p]);
        switchProject(p.id);
        setStartOpen(false);
      } catch (e) {
        console.error("プロジェクトの読み込みに失敗しました", e);
      }
    };
    reader.readAsText(file);
  };

  // ---- ボード操作 ----
  const switchBoard = (id) => {
    setCurrentId(id);
    setListTag(null); // 別ボードに無いタグで絞られたままにならないように
    setListPicked([]);
    setConnectFrom(null);
    setColorMenuFor(null);
    setTagMenuFor(null);
    setActiveTag(null);
    setTagPanelOpen(false);
    setTagPanelTag(null);
    setSelectedIds([]);
    setSelectedTextIds([]);
    setSelBox(null);
    setEdgeMenu(null);
    noteEls.current = {};
  };

  const addBoard = () => {
    const b = makeBoard(`ボード${boards.length + 1}`);
    setBoards((bs) => [...bs, b]);
    switchBoard(b.id);
  };

  const removeBoard = () => {
    if (!board) return;
    setConfirmBox({
      message: `ボード「${board.title || "無題"}」を削除します。中の付箋もすべて消えます。よろしいですか？`,
      okLabel: "削除する",
      action: () => {
        updateProject((p) => {
          const rest = p.boards.filter((b) => b.id !== currentId);
          const next = rest.length > 0 ? rest : [makeBoard("ボード1")];
          return { ...p, boards: next, currentBoardId: next[0].id };
        });
        setConnectFrom(null);
        setColorMenuFor(null);
        setTagMenuFor(null);
        setActiveTag(null);
      },
    });
  };

  // ---- 追加 ----
  // 実際に付箋を貼る（props でタイトル・色・タグを指定できる）
  const addNoteNow = (x, y, parentId = null, props = null) => {
    updateBoard((b) => {
      const num = b.nextNum || 1;
      const n = makeNote(x, y, parentId, num);
      if (props) Object.assign(n, props);
      if (gridRef.current) {
        n.x = Math.max(0, snap(n.x));
        n.y = Math.max(0, snap(n.y));
      }
      n.z = ++zRef.current;
      return { ...b, nextNum: num + 1, notes: [...b.notes, n] };
    });
  };

  // プロパティ選択モードのときは、貼る前に設定パネルを出す
  const addNote = (x, y, parentId = null) => {
    if (propMode) {
      setPendingNote({ x, y, parentId, color: DEFAULT_COLOR, title: "", useTitle: false, tags: [] });
      return;
    }
    addNoteNow(x, y, parentId);
  };

  const commitPendingNote = () => {
    if (!pendingNote) return;
    const { x, y, parentId, color, title, useTitle, tags } = pendingNote;
    addNoteNow(x, y, parentId, { color, title: useTitle ? title : "", useTitle, tags });
    setPendingNote(null);
  };

  // ---- ボード直書きの文字 ----
  const TEXT_SIZES = settings.textSizes?.length ? settings.textSizes : DEFAULT_SETTINGS.textSizes;
  const textDragRef = useRef(null);

  const updateText = (id, patch) =>
    setTexts((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const removeText = (id) => {
    setTexts((ts) => ts.filter((t) => t.id !== id));
    setSelectedTextIds((ids) => ids.filter((i) => i !== id));
  };

  const addTextCenter = () => {
    const sc = scrollerRef.current;
    const zf = zoom || 1;
    let x = ((sc?.scrollLeft || 0) + (sc?.clientWidth || 600) / 2) / zf - 60;
    let y = ((sc?.scrollTop || 0) + 120) / zf;
    if (gridRef.current) { x = Math.max(0, snap(x)); y = Math.max(0, snap(y)); }
    zRef.current += 1;
    setTexts((ts) => [...ts, { id: nextId(), x, y, text: "", size: 1, z: zRef.current }]);
  };

  const onTextDragDown = (e, t) => {
    e.stopPropagation();
    zRef.current += 1;
    updateText(t.id, { z: zRef.current });
    const inSelection = selectedTextIds.includes(t.id);
    if (!inSelection && (selectedIds.length > 0 || selectedTextIds.length > 0)) {
      setSelectedIds([]);
      setSelectedTextIds([]);
    }
    textDragRef.current = {
      id: t.id, startX: e.clientX, startY: e.clientY, origX: t.x, origY: t.y,
      group: inSelection
        ? selectedIds.map((id) => { const m = noteMap[id]; return m ? { id, origX: m.x, origY: m.y } : null; }).filter(Boolean)
        : null,
      groupTexts: inSelection
        ? selectedTextIds.map((id) => { const tx = texts.find((x) => x.id === id); return tx ? { id, origX: tx.x, origY: tx.y } : null; }).filter(Boolean)
        : null,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onTextDragMove = (e) => {
    const d = textDragRef.current;
    if (!d) return;
    const zf = zoomRef.current || 1;
    const dx = (e.clientX - d.startX) / zf;
    const dy = (e.clientY - d.startY) / zf;
    if (d.groupTexts) {
      updateBoard((b) => ({
        ...b,
        notes: b.notes.map((n) => {
          const g = (d.group || []).find((x) => x.id === n.id);
          if (!g) return n;
          let nx = Math.max(0, g.origX + dx);
          let ny = Math.max(0, g.origY + dy);
          if (gridRef.current) { nx = Math.max(0, snap(nx)); ny = Math.max(0, snap(ny)); }
          return { ...n, x: nx, y: ny };
        }),
        texts: (b.texts || []).map((t) => {
          const g = d.groupTexts.find((x) => x.id === t.id);
          if (!g) return t;
          let nx = Math.max(0, g.origX + dx);
          let ny = Math.max(0, g.origY + dy);
          if (gridRef.current) { nx = Math.max(0, snap(nx)); ny = Math.max(0, snap(ny)); }
          return { ...t, x: nx, y: ny };
        }),
      }));
      return;
    }
    let nx = Math.max(0, d.origX + dx);
    let ny = Math.max(0, d.origY + dy);
    if (gridRef.current) { nx = Math.max(0, snap(nx)); ny = Math.max(0, snap(ny)); }
    updateText(d.id, { x: nx, y: ny });
  };

  const onTextDragUp = () => { textDragRef.current = null; };

  const addNoteCenter = () => {
    const sc = scrollerRef.current;
    const zf = zoom || 1;
    const x = ((sc?.scrollLeft || 0) + (sc?.clientWidth || 600) / 2) / zf - 95;
    const y = ((sc?.scrollTop || 0) + 140) / zf;
    addNote(x + (Math.random() * 80 - 40), y + Math.random() * 100, null);
  };

  // ---- ズーム ----
  const applyZoom = (nz, px, py) => {
    const sc = scrollerRef.current;
    const zf = zoomRef.current || 1;
    nz = Math.min(2, Math.max(0.3, Math.round(nz * 100) / 100));
    if (nz === zf) return;
    if (sc) {
      const cx = (sc.scrollLeft + px) / zf;
      const cy = (sc.scrollTop + py) / zf;
      setZoom(nz);
      requestAnimationFrame(() => {
        sc.scrollLeft = cx * nz - px;
        sc.scrollTop = cy * nz - py;
      });
    } else {
      setZoom(nz);
    }
  };

  const zoomBy = (factor) => {
    const sc = scrollerRef.current;
    applyZoom((zoomRef.current || 1) * factor, (sc?.clientWidth || 0) / 2, (sc?.clientHeight || 0) / 2);
  };

  // ピンチズーム（iPad等）
  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
    let startDist = 0;
    let startZoom = 1;
    let cx = 0, cy = 0;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e) => {
      if (e.touches.length !== 2) return;
      const rect = sc.getBoundingClientRect();
      startDist = dist(e.touches);
      startZoom = zoomRef.current || 1;
      cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
    };
    const onMove = (e) => {
      if (e.touches.length !== 2 || !startDist) return;
      e.preventDefault();
      applyZoom(startZoom * (dist(e.touches) / startDist), cx, cy);
    };
    const onEnd = () => { startDist = 0; };
    sc.addEventListener("touchstart", onStart, { passive: true });
    sc.addEventListener("touchmove", onMove, { passive: false });
    sc.addEventListener("touchend", onEnd);
    return () => {
      sc.removeEventListener("touchstart", onStart);
      sc.removeEventListener("touchmove", onMove);
      sc.removeEventListener("touchend", onEnd);
    };
  }, []);

  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return; // Ctrl(⌘)+ホイールでズーム
      e.preventDefault();
      const rect = sc.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      applyZoom((zoomRef.current || 1) * factor, e.clientX - rect.left, e.clientY - rect.top);
    };
    sc.addEventListener("wheel", onWheel, { passive: false });
    return () => sc.removeEventListener("wheel", onWheel);
  }, []);

  // ---- グリッド切替 ----
  const toggleGrid = () => {
    setGridMode((g) => {
      const next = !g;
      if (next) {
        setBoards((bs) =>
          bs.map((b) => ({
            ...b,
            notes: b.notes.map((n) => ({
              ...n,
              x: Math.max(0, snap(n.x)),
              y: Math.max(0, snap(n.y)),
              w: Math.max(GRID * 5, snap(n.w)),
              h: Math.max(GRID * 4, snap(n.h)),
              ew: Math.max(GRID * 9, snap(n.ew)),
              eh: Math.max(GRID * 8, snap(n.eh)),
            })),
          }))
        );
      }
      return next;
    });
  };

  // ---- 画像 ----
  // 保存容量を抑えるため、長辺IMAGE_MAX_PXに縮小してデータURL化する
  const fileToDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, IMAGE_MAX_PX / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const cv = document.createElement("canvas");
          cv.width = w;
          cv.height = h;
          cv.getContext("2d").drawImage(img, 0, 0, w, h);
          const hasAlpha = /png|gif|webp|svg/i.test(file.type);
          resolve({ src: cv.toDataURL(hasAlpha ? "image/png" : "image/jpeg", 0.85), w: img.width, h: img.height });
        };
        img.onerror = () => reject(new Error("画像を読み込めませんでした"));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error("ファイルを読み込めませんでした"));
      reader.readAsDataURL(file);
    });

  const addImageFiles = async (files, at) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;
    const sc = scrollerRef.current;
    const zf = zoom || 1;
    let baseX = at ? at.x : ((sc?.scrollLeft || 0) + (sc?.clientWidth || 600) / 2) / zf - 120;
    let baseY = at ? at.y : ((sc?.scrollTop || 0) + 160) / zf;
    for (let i = 0; i < list.length; i++) {
      try {
        const { src, w, h } = await fileToDataUrl(list[i]);
        const disp = 260; // 初期表示幅
        const ratio = h / w || 0.75;
        let x = Math.max(0, baseX + i * 28);
        let y = Math.max(0, baseY + i * 28);
        if (gridRef.current) { x = Math.max(0, snap(x)); y = Math.max(0, snap(y)); }
        setImages((is) => [...is, { id: nextId(), x, y, w: disp, h: Math.round(disp * ratio), src }]);
      } catch (err) {
        setImgError(err.message || "画像を取り込めませんでした");
        setTimeout(() => setImgError(null), 4000);
      }
    }
  };

  const updateImage = (id, patch) => setImages((is) => is.map((im) => (im.id === id ? { ...im, ...patch } : im)));
  const removeImage = (id) => setImages((is) => is.filter((im) => im.id !== id));

  const onImgDragDown = (e, im) => {
    e.stopPropagation();
    // 画像同士の重なりは配列順で決める（つかんだものを末尾＝最前面へ）
    setImages((is) => [...is.filter((x) => x.id !== im.id), is.find((x) => x.id === im.id)].filter(Boolean));
    imgDragRef.current = { id: im.id, startX: e.clientX, startY: e.clientY, origX: im.x, origY: im.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onImgDragMove = (e) => {
    const d = imgDragRef.current;
    if (!d) return;
    const zf = zoomRef.current || 1;
    let nx = Math.max(0, d.origX + (e.clientX - d.startX) / zf);
    let ny = Math.max(0, d.origY + (e.clientY - d.startY) / zf);
    if (gridRef.current) { nx = Math.max(0, snap(nx)); ny = Math.max(0, snap(ny)); }
    updateImage(d.id, { x: nx, y: ny });
  };
  const onImgDragUp = () => { imgDragRef.current = null; };

  const onImgResizeDown = (e, im) => {
    e.stopPropagation();
    imgResizeRef.current = { id: im.id, startX: e.clientX, origW: im.w, ratio: im.h / im.w };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onImgResizeMove = (e) => {
    const r = imgResizeRef.current;
    if (!r) return;
    const zf = zoomRef.current || 1;
    let w = Math.max(60, r.origW + (e.clientX - r.startX) / zf);
    if (gridRef.current) w = Math.max(GRID * 2, snap(w));
    updateImage(r.id, { w, h: Math.round(w * r.ratio) }); // 縦横比は保つ
  };
  const onImgResizeUp = () => { imgResizeRef.current = null; };

  // 貼り付け（Ctrl+V / ⌘V）で画像を取り込む
  useEffect(() => {
    const onPaste = (e) => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return; // 文字入力中は無視
      const files = Array.from(e.clipboardData?.files || []);
      if (files.some((f) => f.type.startsWith("image/"))) {
        e.preventDefault();
        addImageFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  // ---- 手書き ----
  // 点列を滑らかなパスに変換（中点をつなぐ二次ベジェ）
  const strokePath = (pts) => {
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

  const boardPoint = (e) => {
    const rect = contentRef.current.getBoundingClientRect();
    const zf = zoomRef.current || 1;
    return { x: (e.clientX - rect.left) / zf, y: (e.clientY - rect.top) / zf };
  };

  // 消しゴム
  // whole: 触れた線オブジェクトごと消す / part: なぞった部分だけ消して線を分割する
  const eraseAt = (pt) => {
    const r = 12;
    const near = (p) => Math.abs(p.x - pt.x) < r && Math.abs(p.y - pt.y) < r;
    if (eraseKind === "whole") {
      setStrokes((ss) => ss.filter((st) => !st.pts.some(near)));
      return;
    }
    setStrokes((ss) => {
      const out = [];
      for (const st of ss) {
        if (!st.pts.some(near)) { out.push(st); continue; }
        // 消えた点で区切り、残った区間を別々の線として復元する
        let seg = [];
        const pushSeg = () => {
          if (seg.length >= 2) out.push({ ...st, id: nextId(), pts: seg });
          seg = [];
        };
        for (const p of st.pts) {
          if (near(p)) pushSeg();
          else seg.push(p);
        }
        pushSeg();
      }
      return out;
    });
  };

  const onDrawPointerDown = (e) => {
    if (!drawMode) return false;
    // 指で描かない設定のときはペン/マウスのみ
    if (!penFingerDraw && e.pointerType === "touch") return false;
    const pt = boardPoint(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.pointerType !== "mouse") e.preventDefault();
    if (eraseMode) {
      drawRef.current = { erasing: true };
      eraseAt(pt);
      return true;
    }
    drawRef.current = {
      erasing: false,
      pts: [pt],
      color: penColor,
      width: penWidth,
      // Apple Pencilの筆圧（0.5を基準に太さを増減）
      pressure: e.pressure && e.pressure > 0 ? e.pressure : 0.5,
    };
    setLiveStroke({ pts: [pt], color: penColor, width: penWidth });
    return true;
  };

  const onDrawPointerMove = (e) => {
    const d = drawRef.current;
    if (!d) return false;
    const pt = boardPoint(e);
    if (d.erasing) {
      eraseAt(pt);
      return true;
    }
    const last = d.pts[d.pts.length - 1];
    if (Math.abs(pt.x - last.x) + Math.abs(pt.y - last.y) < 1.2) return true; // 点を間引く
    d.pts.push(pt);
    if (e.pressure && e.pressure > 0) d.pressure = (d.pressure + e.pressure) / 2;
    setLiveStroke({ pts: [...d.pts], color: d.color, width: d.width * (0.6 + d.pressure * 0.8) });
    return true;
  };

  const onDrawPointerUp = () => {
    const d = drawRef.current;
    drawRef.current = null;
    setLiveStroke(null);
    if (!d || d.erasing) return;
    if (d.pts.length < 2) return;
    setStrokes((ss) => [
      ...ss,
      { id: nextId(), pts: d.pts, color: d.color, width: d.width * (0.6 + d.pressure * 0.8) },
    ]);
  };

  const clearStrokes = () => {
    if (strokes.length === 0) return;
    setConfirmBox({
      message: "このボードの手書きをすべて消します。よろしいですか？",
      okLabel: "消す",
      action: () => setStrokes([]),
    });
  };

  const undoStroke = () => setStrokes((ss) => ss.slice(0, -1));

  // Delete / BackSpace で、選んでいる付箋や文字を剥がす
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      // 文字を入力している最中は消さない
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (selectedIds.length === 0 && selectedTextIds.length === 0) return;
      e.preventDefault();
      deleteSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, selectedTextIds, settings.confirmDelete, notes, byParent]);

  // ---- 範囲選択（マーキー）と領域作成 ----
  const onBoardPointerDown = (e) => {
    if (drawMode && onDrawPointerDown(e)) return; // 手書きモードが最優先
    if (e.target !== contentRef.current) return;
    if (connectFrom) return;
    // マウスは常に可。タッチ/ペンは選択モードか領域モードのときだけ（通常はスクロール優先）
    if (e.pointerType === "mouse") {
      if (e.button !== 0) return;
    } else if (!selectMode && !zoneMode) {
      return;
    }
    const rect = contentRef.current.getBoundingClientRect();
    const zf = zoomRef.current || 1;
    const x = (e.clientX - rect.left) / zf;
    const y = (e.clientY - rect.top) / zf;
    selBoxRef.current = { x1: x, y1: y, x2: x, y2: y, moved: false, mode: zoneMode ? "zone" : "select" };
    setSelBox({ x1: x, y1: y, x2: x, y2: y });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.pointerType !== "mouse") e.preventDefault(); // タッチ時のスクロールを抑止
  };

  const onBoardPointerMove = (e) => {
    if (drawRef.current) { onDrawPointerMove(e); return; }
    const s = selBoxRef.current;
    if (!s) return;
    const rect = contentRef.current.getBoundingClientRect();
    const zf = zoomRef.current || 1;
    const x = (e.clientX - rect.left) / zf;
    const y = (e.clientY - rect.top) / zf;
    if (Math.abs(x - s.x1) + Math.abs(y - s.y1) > 4) s.moved = true;
    s.x2 = x;
    s.y2 = y;
    setSelBox({ x1: s.x1, y1: s.y1, x2: x, y2: y });
  };

  const onBoardPointerUp = () => {
    if (drawRef.current) { onDrawPointerUp(); return; }
    const s = selBoxRef.current;
    selBoxRef.current = null;
    setSelBox(null);
    if (!s) return;
    if (s.mode === "zone") {
      setZoneMode(false);
      const w = Math.abs(s.x2 - s.x1);
      const h = Math.abs(s.y2 - s.y1);
      if (s.moved && w > 40 && h > 30) {
        let x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2), W = w, H = h;
        if (gridRef.current) {
          x = Math.max(0, snap(x)); y = Math.max(0, snap(y));
          W = Math.max(GRID * 2, snap(W)); H = Math.max(GRID * 2, snap(H));
        }
        setZones((zs) => [
          ...zs,
          { id: nextId(), x, y, w: W, h: H, color: COLORS[zs.length % COLORS.length].edge, label: "" },
        ]);
      }
      return;
    }
    if (!s.moved) {
      setSelectedIds([]); // 空クリックで選択解除
      setSelectedTextIds([]);
      return;
    }
    const minX = Math.min(s.x1, s.x2), maxX = Math.max(s.x1, s.x2);
    const minY = Math.min(s.y1, s.y2), maxY = Math.max(s.y1, s.y2);
    const ids = notes
      .filter((n) => !n.parentId)
      .filter((n) => {
        const w = n.expanded ? n.ew : n.w;
        const h = n.expanded ? n.eh : n.h;
        return n.x < maxX && n.x + w > minX && n.y < maxY && n.y + h > minY;
      })
      .map((n) => n.id);
    setSelectedIds(ids);
    setSelectMode(false);
    // ボード直書きの文字も選択に含める
    const tIds = texts
      .filter((t) => t.x >= minX - 8 && t.x <= maxX + 8 && t.y >= minY - 8 && t.y <= maxY + 8)
      .map((t) => t.id);
    setSelectedTextIds(tIds);
  };

  // ---- 領域（背景色オブジェクト） ----
  const updateZone = (id, patch) => setZones((zs) => zs.map((z) => (z.id === id ? { ...z, ...patch } : z)));
  const removeZone = (id) => {
    setZones((zs) => zs.filter((z) => z.id !== id));
    if (zoneColorMenuFor === id) setZoneColorMenuFor(null);
  };

  const onZoneDragDown = (e, zn) => {
    e.stopPropagation();
    // 領域の上にあるアイテム（中心が領域内の最上位付箋・領域内の文字）を一緒に動かす
    const inside = (x, y) => x >= zn.x && x <= zn.x + zn.w && y >= zn.y && y <= zn.y + zn.h;
    const gNotes = notes
      .filter((n) => !n.parentId)
      .filter((n) => {
        const w = n.expanded ? n.ew : n.w;
        const h = n.expanded ? n.eh : n.h;
        return inside(n.x + w / 2, n.y + h / 2);
      })
      .map((n) => ({ id: n.id, origX: n.x, origY: n.y }));
    const gTexts = texts
      .filter((t) => inside(t.x, t.y))
      .map((t) => ({ id: t.id, origX: t.x, origY: t.y }));
    zoneDragRef.current = { id: zn.id, startX: e.clientX, startY: e.clientY, origX: zn.x, origY: zn.y, gNotes, gTexts };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onZoneDragMove = (e) => {
    const d = zoneDragRef.current;
    if (!d) return;
    const zf = zoomRef.current || 1;
    let nx = Math.max(0, d.origX + (e.clientX - d.startX) / zf);
    let ny = Math.max(0, d.origY + (e.clientY - d.startY) / zf);
    if (gridRef.current) { nx = Math.max(0, snap(nx)); ny = Math.max(0, snap(ny)); }
    // 領域の移動量と同じだけ上のアイテムも動かす（相対配置を保つ）
    const ddx = nx - d.origX;
    const ddy = ny - d.origY;
    updateBoard((b) => ({
      ...b,
      zones: (b.zones || []).map((z) => (z.id === d.id ? { ...z, x: nx, y: ny } : z)),
      notes: b.notes.map((n) => {
        const g = d.gNotes.find((x) => x.id === n.id);
        return g ? { ...n, x: Math.max(0, g.origX + ddx), y: Math.max(0, g.origY + ddy) } : n;
      }),
      texts: (b.texts || []).map((t) => {
        const g = d.gTexts.find((x) => x.id === t.id);
        return g ? { ...t, x: Math.max(0, g.origX + ddx), y: Math.max(0, g.origY + ddy) } : t;
      }),
    }));
  };
  const onZoneDragUp = () => { zoneDragRef.current = null; };

  const onZoneResizeDown = (e, zn) => {
    e.stopPropagation();
    zoneResizeRef.current = { id: zn.id, startX: e.clientX, startY: e.clientY, origW: zn.w, origH: zn.h };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onZoneResizeMove = (e) => {
    const r = zoneResizeRef.current;
    if (!r) return;
    const zf = zoomRef.current || 1;
    let w = Math.max(80, r.origW + (e.clientX - r.startX) / zf);
    let h = Math.max(60, r.origH + (e.clientY - r.startY) / zf);
    if (gridRef.current) { w = Math.max(GRID * 2, snap(w)); h = Math.max(GRID * 2, snap(h)); }
    updateZone(r.id, { w, h });
  };
  const onZoneResizeUp = () => { zoneResizeRef.current = null; };

  const duplicateSelected = () => {
    for (const id of selectedIds) copySubtreeTo(id, currentProjectId, currentId);
    if (selectedTextIds.length > 0) {
      setTexts((ts) => [
        ...ts,
        ...ts
          .filter((t) => selectedTextIds.includes(t.id))
          .map((t) => ({ ...t, id: nextId(), x: t.x + 24, y: t.y + 24, z: ++zRef.current })),
      ]);
    }
    setSelectedIds([]);
    setSelectedTextIds([]);
  };

  const deleteSelected = () => {
    const count = selectedIds.length + selectedTextIds.length;
    if (count === 0) return;
    askThen(
      `選択中の${count}個のアイテム（付箋は中身も含む）を剥がします。よろしいですか？`,
      "剥がす",
      () => {
        const doomed = new Set();
        for (const id of selectedIds) {
          doomed.add(id);
          for (const d of collectDescendants(id, byParent)) doomed.add(d);
        }
        removeNoteIds(doomed);
        setTexts((ts) => ts.filter((t) => !selectedTextIds.includes(t.id)));
        setSelectedIds([]);
        setSelectedTextIds([]);
      }
    );
  };

  // ---- ドラッグ ----
  const onNotePointerDown = (e, note, depth) => {
    // 自分の中の操作UIだけを除外する（親のミニボードのdata-nodragに巻き込まれないように）
    const nd = e.target.closest("[data-nodrag]");
    if (nd && e.currentTarget.contains(nd)) return;
    e.stopPropagation();
    // Shift+クリックで選択に追加/除外（最上位の付箋のみ）
    if (e.shiftKey && depth === 0) {
      setSelectedIds((ids) => (ids.includes(note.id) ? ids.filter((i) => i !== note.id) : [...ids, note.id]));
      return;
    }
    setColorMenuFor(null);
    setTagMenuFor(null);
    setQuoteMenuFor(null);
    setCopyMenuFor(null);
    const inSelection = depth === 0 && selectedIds.includes(note.id);
    if (!inSelection && (selectedIds.length > 0 || selectedTextIds.length > 0)) {
      setSelectedIds([]); // 選択外をつかんだら解除
      setSelectedTextIds([]);
    }
    zRef.current += 1;
    setNotes((ns) => ns.map((m) => (m.id === note.id ? { ...m, z: zRef.current } : m)));
    const el = noteEls.current[note.id];
    let maxX = CANVAS_W - (note.expanded ? note.ew : note.w);
    let maxY = CANVAS_H - 60;
    if (depth > 0 && el?.parentElement) {
      const p = el.parentElement;
      maxX = Math.max(0, p.clientWidth - el.offsetWidth - 4);
      maxY = Math.max(0, p.clientHeight - 40);
    }
    dragRef.current = {
      id: note.id,
      startX: e.clientX, startY: e.clientY,
      origX: note.x, origY: note.y,
      maxX, maxY, moved: false,
      // 選択中の付箋をつかんだら、選択全体（文字も含む）をまとめて動かす
      group: inSelection
        ? selectedIds.map((id) => { const m = noteMap[id]; return m ? { id, origX: m.x, origY: m.y } : null; }).filter(Boolean)
        : null,
      groupTexts: inSelection
        ? selectedTextIds.map((id) => { const t = texts.find((x) => x.id === id); return t ? { id, origX: t.x, origY: t.y } : null; }).filter(Boolean)
        : null,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onNotePointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const zf = zoomRef.current || 1;
    const dx = (e.clientX - d.startX) / zf;
    const dy = (e.clientY - d.startY) / zf;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.group) {
      // 選択グループ全体（付箋＋文字）を移動
      updateBoard((b) => ({
        ...b,
        notes: b.notes.map((n) => {
          const g = d.group.find((x) => x.id === n.id);
          if (!g) return n;
          let nx = Math.min(CANVAS_W - 80, Math.max(0, g.origX + dx));
          let ny = Math.min(CANVAS_H - 60, Math.max(0, g.origY + dy));
          if (gridRef.current) {
            nx = Math.max(0, snap(nx));
            ny = Math.max(0, snap(ny));
          }
          return { ...n, x: nx, y: ny };
        }),
        texts: (b.texts || []).map((t) => {
          const g = (d.groupTexts || []).find((x) => x.id === t.id);
          if (!g) return t;
          let nx = Math.max(0, g.origX + dx);
          let ny = Math.max(0, g.origY + dy);
          if (gridRef.current) { nx = Math.max(0, snap(nx)); ny = Math.max(0, snap(ny)); }
          return { ...t, x: nx, y: ny };
        }),
      }));
      return;
    }
    let nx = Math.min(d.maxX, Math.max(0, d.origX + dx));
    let ny = Math.min(d.maxY, Math.max(0, d.origY + dy));
    if (gridRef.current) {
      nx = Math.min(d.maxX, Math.max(0, snap(nx)));
      ny = Math.min(d.maxY, Math.max(0, snap(ny)));
    }
    setNotes((ns) => ns.map((n) => (n.id === d.id ? { ...n, x: nx, y: ny } : n)));
  };

  // 祖先-子孫の関係か（格納している/されている付箋同士は接続不可）
  const isAncestor = (ancestorId, id) => {
    let p = noteMap[id]?.parentId;
    while (p) {
      if (p === ancestorId) return true;
      p = noteMap[p]?.parentId;
    }
    return false;
  };

  const onNotePointerUp = (e, id) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (connectFrom && !d?.moved && connectFrom !== id) {
      if (isAncestor(connectFrom, id) || isAncestor(id, connectFrom)) {
        // 親子（格納関係）は接続しない
        setConnectFrom(null);
        return;
      }
      const exists = edges.some(
        (ed) => (ed.from === connectFrom && ed.to === id) || (ed.from === id && ed.to === connectFrom)
      );
      if (!exists) setEdges((es) => [...es, { id: nextId(), from: connectFrom, to: id }]);
      setConnectFrom(null);
    }
  };

  // ---- リサイズ ----
  const onResizeDown = (e, note) => {
    e.stopPropagation();
    const exp = note.expanded;
    resizeRef.current = {
      id: note.id, expanded: exp,
      startX: e.clientX, startY: e.clientY,
      origW: exp ? note.ew : note.w,
      origH: exp ? note.eh : note.h,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizeMove = (e) => {
    const r = resizeRef.current;
    if (!r) return;
    const minW = r.expanded ? 240 : 120;
    const minH = r.expanded ? 200 : 90;
    const zf = zoomRef.current || 1;
    let w = Math.max(minW, r.origW + (e.clientX - r.startX) / zf);
    let h = Math.max(minH, r.origH + (e.clientY - r.startY) / zf);
    if (gridRef.current) {
      w = Math.max(minW, snap(w));
      h = Math.max(minH, snap(h));
    }
    setNotes((ns) =>
      ns.map((n) => (n.id === r.id ? (r.expanded ? { ...n, ew: w, eh: h } : { ...n, w, h }) : n))
    );
  };

  const onResizeUp = () => { resizeRef.current = null; };

  // ---- 削除 ----
  // 確認するかどうかは設定に従う（すぐ消すか、一度たずねるか）
  const askThen = (message, okLabel, action) => {
    if (settings.confirmDelete === false) action();
    else setConfirmBox({ message, okLabel, action });
  };

  // 付箋をまとめて剥がす共通処理。
  // 引用外し・線の削除・通し番号の詰め直しを 1回の更新でまとめて行う
  // （別々に更新すると、番号を詰める前の状態が一瞬描画されてしまう）。
  const removeNoteIds = (doomed) => {
    if (doomed.size === 0) return;
    updateBoard((b) => {
      const kept = (b.notes || [])
        .filter((n) => !doomed.has(n.id))
        // 消えた付箋への引用も外す
        .map((n) => ((n.refs || []).some((r) => doomed.has(r)) ? { ...n, refs: n.refs.filter((r) => !doomed.has(r)) } : n));
      const packed = renumber(kept);
      return {
        ...b,
        notes: packed.notes,
        nextNum: packed.nextNum,
        edges: (b.edges || []).filter((e) => !doomed.has(e.from) && !doomed.has(e.to)),
      };
    });
  };

  const removeNote = (id) => {
    const doomed = new Set([id, ...collectDescendants(id, byParent)]);
    removeNoteIds(doomed);
    if (doomed.has(connectFrom)) setConnectFrom(null);
    if (doomed.has(colorMenuFor)) setColorMenuFor(null);
    if (doomed.has(tagMenuFor)) setTagMenuFor(null);
    if (doomed.has(quoteMenuFor)) setQuoteMenuFor(null);
    if (doomed.has(copyMenuFor)) setCopyMenuFor(null);
    setSelectedIds((ids) => ids.filter((i) => !doomed.has(i)));
  };

  const removeEdge = (id) => setEdges((es) => es.filter((e) => e.id !== id));

  const clearAll = () => {
    if (notes.length === 0) return;
    setConfirmBox({
      message: "このボードの付箋・線・文字・領域・手書き・画像をすべて剥がします。よろしいですか？",
      okLabel: "空にする",
      action: () => {
        updateBoard((b) => ({ ...b, notes: [], nextNum: 1 }));
        setEdges([]);
        setTexts([]);
        setZones([]);
        setStrokes([]);
        setImages([]);
        setSelectedIds([]);
        setConnectFrom(null);
        setColorMenuFor(null);
        setTagMenuFor(null);
        setActiveTag(null);
      },
    });
  };

  const updateNote = (id, patch) => setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));

  // ポップオーバーを開くときは、その付箋を最前面に出す（他の付箋にメニューが隠れないように）
  const bringToFront = (id) => {
    zRef.current += 1;
    updateNote(id, { z: zRef.current });
  };

  // ---- 引用ジャンプ ----
  const jumpTo = (id) => {
    // 収納されていたら祖先を展開してから移動
    const chainIds = [];
    let cur = noteMap[id];
    while (cur?.parentId) {
      chainIds.push(cur.parentId);
      cur = noteMap[cur.parentId];
    }
    if (chainIds.length > 0) {
      setNotes((ns) => ns.map((n) => (chainIds.includes(n.id) ? { ...n, expanded: true } : n)));
    }
    zRef.current += 1;
    updateNote(id, { z: zRef.current });
    setFlashId(id);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1500);
    setTimeout(() => {
      noteEls.current[id]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }, 60);
  };

  // ---- 付箋の複製・コピー ----
  // noteIdの付箋を（入れ子の中身・タグ・内部の線ごと）指定先のプロジェクト/ボードへ複製する
  const copySubtreeTo = (noteId, targetProjectId, targetBoardId) => {
    const sameBoard = targetProjectId === currentProjectId && targetBoardId === currentId;
    const subtreeIds = [noteId, ...collectDescendants(noteId, byParent)];
    const subtreeSet = new Set(subtreeIds);
    const srcNotes = subtreeIds.map((id) => noteMap[id]).filter(Boolean);
    const srcEdges = edges.filter((e) => subtreeSet.has(e.from) && subtreeSet.has(e.to));
    setProjects((ps) =>
      ps.map((p) => {
        if (p.id !== targetProjectId) return p;
        return {
          ...p,
          boards: p.boards.map((b) => {
            if (b.id !== targetBoardId) return b;
            let num = b.nextNum || 1;
            const idMap = {};
            for (const sn of srcNotes) idMap[sn.id] = nextId();
            const newNotes = srcNotes.map((sn) => {
              const isRoot = sn.id === noteId;
              return {
                ...sn,
                id: idMap[sn.id],
                num: num++,
                parentId: isRoot ? (sameBoard ? sn.parentId : null) : idMap[sn.parentId],
                x: isRoot ? (sameBoard ? sn.x + 24 : 60 + Math.random() * 80) : sn.x,
                y: isRoot ? (sameBoard ? sn.y + 24 : 80 + Math.random() * 80) : sn.y,
                z: ++zRef.current,
                tags: [...(sn.tags || [])],
                // 引用: サブツリー内は新IDに付け替え。外部への引用は同一ボード内コピーのみ維持
                refs: (sn.refs || []).map((r) => idMap[r] || (sameBoard ? r : null)).filter(Boolean),
              };
            });
            const newEdges = srcEdges.map((e) => ({ id: nextId(), from: idMap[e.from], to: idMap[e.to] }));
            return { ...b, nextNum: num, notes: [...b.notes, ...newNotes], edges: [...b.edges, ...newEdges] };
          }),
        };
      })
    );
    setCopyMenuFor(null);
  };

  // ボードを切り替えてからジャンプする（切替直後は新しい付箋データが揃っていないため）
  useEffect(() => {
    if (!pendingJump) return;
    if (!noteMap[pendingJump]) return;
    jumpTo(pendingJump);
    setPendingJump(null);
  }, [pendingJump, currentId, notes]);

  // 別プロジェクトへコピーする（コピー先の開いているボードに貼る）
  const copyToProject = (noteId, targetProjectId) => {
    setProjects((ps) => {
      const target = ps.find((p) => p.id === targetProjectId);
      if (!target) return ps;
      const tb = target.boards.find((b) => b.id === target.currentBoardId) || target.boards[0];
      if (tb) setTimeout(() => copySubtreeTo(noteId, targetProjectId, tb.id), 0);
      return ps;
    });
  };

  // ---- テキストで書き出す ----
  const [exportOpen, setExportOpen] = useState(false);
  const [exportOpts, setExportOpts] = useState({ tags: false, num: false, nest: true });

  // 1枚分のテキスト。タイトルを使っている付箋だけタイトル行を付ける
  const noteToText = (n, depth = 0, opts = exportOpts) => {
    const pad = "  ".repeat(depth);
    const lines = [];
    const title = (n.title || "").trim();
    const num = opts.num ? `#${n.num} ` : "";
    if (n.useTitle && title) {
      lines.push(`${pad}${num}【${title}】`);
      (n.text || "").split("\n").forEach((l) => lines.push(`${pad}${l}`));
    } else {
      const body = (n.text || "").split("\n");
      lines.push(`${pad}${num}${body[0] || ""}`);
      body.slice(1).forEach((l) => lines.push(`${pad}${l}`));
    }
    if (opts.tags && (n.tags || []).length > 0) {
      lines.push(`${pad}  [${n.tags.join(" / ")}]`);
    }
    return lines.join("\n").replace(/\s+$/, "");
  };

  // 並び順は画面の見た目どおり（上から下、同じ高さなら左から右）
  const sortForExport = (list) =>
    [...list].sort((a, b) => (Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x));

  const buildText = (targets, opts = exportOpts) => {
    const out = [];
    const walk = (n, depth) => {
      out.push(noteToText(n, depth, opts));
      if (opts.nest) {
        const kids = sortForExport(byParent[n.id] || []);
        kids.forEach((k) => walk(k, depth + 1));
      }
    };
    sortForExport(targets).forEach((n) => walk(n, 0));
    return out.filter((t) => t.trim()).join("\n\n");
  };

  // 書き出す対象: 選択中があればそれ、なければこのボード全体
  const exportTargets = () =>
    selectedIds.length > 0
      ? notes.filter((n) => selectedIds.includes(n.id))
      : (byParent["root"] || []);

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      return false;
    }
  };

  const downloadText = (text) => {
    const name = `${(board?.title || "board").replace(/[\\/:*?"<>|]/g, "_")}.txt`;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // ---- 一覧からの一括操作（今のボードの付箋が対象） ----
  const listCopyTo = (boardId) => {
    listPicked.forEach((id) => copySubtreeTo(id, currentProjectId, boardId));
    setListPicked([]);
    setListActionOpen(null);
  };

  const listMoveTo = (boardId) => {
    listPicked.forEach((id) => copySubtreeTo(id, currentProjectId, boardId));
    const doomed = new Set();
    listPicked.forEach((id) => {
      doomed.add(id);
      collectDescendants(id, byParent).forEach((d) => doomed.add(d));
    });
    setTimeout(() => {
      removeNoteIds(doomed);
    }, 0);
    setListPicked([]);
    setListActionOpen(null);
  };

  const listDelete = () => {
    const count = listPicked.length;
    askThen(
      `選んだ${count}枚の付箋（中の付箋も含む）を剥がします。よろしいですか？`,
      "剥がす",
      () => {
        const doomed = new Set();
        listPicked.forEach((id) => {
          doomed.add(id);
          collectDescendants(id, byParent).forEach((d) => doomed.add(d));
        });
        removeNoteIds(doomed);
        setListPicked([]);
      }
    );
  };

  // 別のボード／プロジェクトへ移動する（複製してから元を消す）
  const moveSubtreeTo = (noteId, targetProjectId, targetBoardId) => {
    copySubtreeTo(noteId, targetProjectId, targetBoardId);
    setTimeout(() => removeNote(noteId), 0);
  };

  const moveToProject = (noteId, targetProjectId) => {
    copyToProject(noteId, targetProjectId);
    setTimeout(() => removeNote(noteId), 0);
  };

  // ---- タグ ----
  const addTagValue = (noteId, value) => {
    const t = (value || "").trim();
    if (!t) return;
    setNotes((ns) =>
      ns.map((n) => (n.id === noteId ? { ...n, tags: [...new Set([...(n.tags || []), t])] } : n))
    );
  };

  const addTag = (noteId) => {
    addTagValue(noteId, tagInput);
    setTagInput("");
  };

  const removeTag = (noteId, t) => {
    setNotes((ns) =>
      ns.map((n) => (n.id === noteId ? { ...n, tags: (n.tags || []).filter((x) => x !== t) } : n))
    );
    if (activeTag === t && !notes.some((n) => n.id !== noteId && (n.tags || []).includes(t))) {
      setActiveTag(null);
    }
  };

  // ---- 引用の追加・削除 ----
  const addRef = (noteId, refId) => {
    setNotes((ns) =>
      ns.map((n) => (n.id === noteId ? { ...n, refs: [...new Set([...(n.refs || []), refId])] } : n))
    );
    setQuoteMenuFor(null);
    setQuoteQuery("");
  };

  const removeRef = (noteId, refId) => {
    setNotes((ns) =>
      ns.map((n) => (n.id === noteId ? { ...n, refs: (n.refs || []).filter((x) => x !== refId) } : n))
    );
  };

  // ---- 付箋（再帰） ----
  const renderNote = (n, depth) => {
    const c = COLORS[n.color] || COLORS[0];
    const kids = byParent[n.id] || [];
    const descendants = collectDescendants(n.id, byParent).length;
    const selected = connectFrom === n.id;
    const canNest = depth < MAX_DEPTH;
    const isExpanded = canNest && n.expanded;
    const curW = isExpanded ? n.ew : n.w;
    const curH = isExpanded ? n.eh : n.h;
    const flashing = flashId === n.id;
    const multiSelected = depth === 0 && selectedIds.includes(n.id);
    // 俯瞰の見出し表示にするか（展開中の付箋は中身を見せたいので通常表示のまま）
    const asHeading = overview && depth === 0 && !isExpanded;
    const tagged = activeTag && (n.tags || []).includes(activeTag);
    const dimmed = activeTag && !tagged;

    // 引用の解決: 引用ボタンで選んだもの + 本文中の #番号
    const textRefIds = [...new Set((n.text.match(/#\d+/g) || []).map((s) => parseInt(s.slice(1), 10)))]
      .map((num) => notes.find((m) => m.num === num)?.id)
      .filter(Boolean);
    const seenRef = new Set();
    const refNotes = [...(n.refs || []).map((id) => ({ id, removable: true })), ...textRefIds.map((id) => ({ id, removable: false }))]
      .filter((r) => {
        if (r.id === n.id || seenRef.has(r.id)) return false;
        seenRef.add(r.id);
        return true;
      })
      .map((r) => ({ ...r, note: noteMap[r.id] }))
      .filter((r) => r.note)
      .slice(0, 6);

    // 引用ピッカーの候補（タグと本文を検索）
    const q = quoteQuery.trim().toLowerCase();
    const quoteCandidates =
      quoteMenuFor === n.id
        ? notes
            .filter((m) => m.id !== n.id && !(n.refs || []).includes(m.id))
            .filter(
              (m) =>
                !q ||
                m.text.toLowerCase().includes(q) ||
                (m.title || "").toLowerCase().includes(q) ||
                (m.tags || []).some((t) => t.toLowerCase().includes(q)) ||
                `#${m.num}` === q || String(m.num) === q
            )
            .sort((a, b) => b.num - a.num)
            .slice(0, 30)
        : [];

    return (
      <div
        key={n.id}
        ref={(el) => {
          if (el) noteEls.current[n.id] = el;
          else delete noteEls.current[n.id];
        }}
        className="note-enter"
        onPointerDown={(e) => onNotePointerDown(e, n, depth)}
        onPointerMove={onNotePointerMove}
        onPointerUp={(e) => onNotePointerUp(e, n.id)}
        style={{
          position: "absolute",
          left: n.x, top: n.y,
          width: curW, height: curH,
          maxWidth: depth > 0 ? `calc(100% - ${n.x}px)` : undefined,
          maxHeight: depth > 0 ? `calc(100% - ${n.y}px)` : undefined,
          zIndex: n.z,
          display: "flex", flexDirection: "column",
          background: simpleStyle ? "#FFFFFF" : c.bg,
          border: simpleStyle ? `1.5px solid ${c.edge}` : "none",
          borderTop: simpleStyle ? `4px solid ${c.edge}` : `16px solid ${c.edge}`,
          borderRadius: simpleStyle ? 6 : 3,
          overflow: asHeading ? "visible" : undefined, // 俯瞰ラベルのはみ出しを許可
          opacity: dimmed ? 0.35 : 1,
          transition: "opacity .15s ease",
          boxShadow: flashing
            ? "0 0 0 4px #E8A13B, 0 0 22px 4px rgba(232,161,59,.65)"
            : multiSelected
            ? "0 0 0 3px #3D6FB4, 4px 6px 12px rgba(60,50,30,.25)"
            : selected
            ? "0 0 0 3px #B0483C, 4px 6px 12px rgba(60,50,30,.25)"
            : tagged
            ? `0 0 0 3px ${tagColorOf(activeTag)}, 4px 6px 12px rgba(60,50,30,.25)`
            : isExpanded
            ? (simpleStyle ? "0 2px 8px rgba(60,50,30,.16)" : "6px 9px 18px rgba(60,50,30,.28)")
            : (simpleStyle ? "0 1px 5px rgba(60,50,30,.14)" : "3px 5px 10px rgba(60,50,30,.22)"),
          touchAction: "none",
          userSelect: "none",
          cursor: "grab",
        }}
      >
        {/* 操作列（ボタン以外の部分はドラッグのつかみ代になる） */}
        <div style={{ display: asHeading ? "none" : "flex", alignItems: "center", gap: 4, padding: "4px 6px 0", flexShrink: 0, position: "relative" }}>
          <span
            title="この番号で他の付箋から引用できます（本文に #番号 と書く）"
            style={{ fontSize: 10, fontWeight: 700, color: "rgba(62,58,51,.65)", flexShrink: 0 }}
          >
            #{n.num}
          </span>
          <button
            data-nodrag
            data-colormenu
            title="色を変える"
            onClick={() => { bringToFront(n.id); setColorMenuFor(colorMenuFor === n.id ? null : n.id); setTagMenuFor(null); }}
            style={{
              width: 15, height: 15, borderRadius: "50%",
              border: "2px solid rgba(62,58,51,.45)",
              background: c.edge, cursor: "pointer", padding: 0, flexShrink: 0,
            }}
          />
          {colorMenuFor === n.id && (() => { const withMemo = settings.showColorNotes !== false; return (
            <div
              data-nodrag
              data-colormenu
              style={{
                position: "absolute", top: 22, left: 4, zIndex: 100001,
                background: "#FFFDF6", borderRadius: 8,
                boxShadow: "0 5px 16px rgba(40,35,20,.3)",
                padding: withMemo ? "6px 7px" : "7px 9px",
                display: "flex",
                flexDirection: withMemo ? "column" : "row",
                gap: withMemo ? 2 : 7,
                minWidth: withMemo ? 150 : 0,
              }}
            >
              {COLORS.map((col, i) => {
                const memo = (settings.colorNotes || [])[i] || "";
                // メモを表示しない設定のときは、丸だけを横に並べる
                if (!withMemo) {
                  return (
                    <button
                      key={col.name}
                      title={memo ? `${col.name}：${memo}` : col.name}
                      onClick={() => { updateNote(n.id, { color: i }); setColorMenuFor(null); }}
                      style={{
                        width: 20, height: 20, borderRadius: "50%",
                        border: n.color === i ? "2.5px solid #3E3A33" : "1px solid rgba(0,0,0,.2)",
                        background: col.bg, cursor: "pointer", padding: 0,
                      }}
                    />
                  );
                }
                return (
                  <button
                    key={col.name}
                    title={memo ? `${col.name}：${memo}` : col.name}
                    onClick={() => { updateNote(n.id, { color: i }); setColorMenuFor(null); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 7,
                      border: "none", borderRadius: 6, cursor: "pointer", padding: "3px 6px",
                      background: n.color === i ? "rgba(62,58,51,.1)" : "transparent",
                      width: "100%", textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                        border: n.color === i ? "2.5px solid #3E3A33" : "1px solid rgba(0,0,0,.2)",
                        background: col.bg,
                      }}
                    />
                    <span style={{ fontSize: 11, color: memo ? "#3E3A33" : "#9C9587", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {memo || col.name}
                    </span>
                  </button>
                );
              })}
            </div>
          ); })()}
          <button
            data-nodrag
            title={n.useTitle ? "タイトル欄をやめる" : "タイトル欄を使う"}
            onClick={() => updateNote(n.id, { useTitle: !n.useTitle })}
            style={{
              border: "none", borderRadius: 4, cursor: "pointer",
              fontSize: 10, fontWeight: 700, padding: "1px 5px",
              background: n.useTitle ? "rgba(62,58,51,.7)" : "transparent",
              color: n.useTitle ? "#F6F2E9" : "rgba(62,58,51,.5)",
            }}
          >
            T
          </button>
          {canNest && (
            <button
              data-nodrag
              title={isExpanded ? "中のボードをしまう" : "中のボードを開く"}
              onClick={() => updateNote(n.id, { expanded: !n.expanded })}
              style={{
                border: "none", borderRadius: 4, cursor: "pointer",
                background: descendants > 0 ? "rgba(62,58,51,.12)" : "transparent",
                fontSize: 11, fontWeight: 700, color: "#3E3A33",
                padding: "1px 6px", whiteSpace: "nowrap",
              }}
            >
              {isExpanded ? "▾" : `▸${descendants > 0 ? descendants : ""}`}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            data-nodrag
            data-copymenu
            title="複製・他のボード/プロジェクトへコピー"
            onClick={() => { bringToFront(n.id); setCopyMenuFor(copyMenuFor === n.id ? null : n.id); setColorMenuFor(null); setTagMenuFor(null); setQuoteMenuFor(null); }}
            style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 12, padding: 0 }}
          >
            ⧉
          </button>
          {copyMenuFor === n.id && (
            <div
              data-nodrag
              data-copymenu
              style={{
                position: "absolute", top: 22, right: 4, zIndex: 100001,
                background: "#FFFDF6", borderRadius: 8,
                boxShadow: "0 5px 16px rgba(40,35,20,.3)",
                padding: 8, width: 250, maxHeight: 280, overflowY: "auto",
              }}
            >
              <button
                onClick={() => copySubtreeTo(n.id, currentProjectId, currentId)}
                style={{ width: "100%", textAlign: "left", border: "none", borderRadius: 5, background: "rgba(62,58,51,.08)", color: "#3E3A33", fontSize: 12, fontWeight: 700, padding: "5px 8px", cursor: "pointer", marginBottom: 4 }}
              >
                ⧉ このボードに複製
              </button>
              <button
                onClick={async () => {
                  const ok = await copyText(buildText([n]));
                  setCopyMenuFor(null);
                  if (!ok) console.error("コピーできませんでした");
                }}
                title="この付箋（中の付箋も含む）の文章をコピーします"
                style={{ width: "100%", textAlign: "left", border: "none", borderRadius: 5, background: "rgba(62,58,51,.08)", color: "#3E3A33", fontSize: 12, fontWeight: 700, padding: "5px 8px", cursor: "pointer", marginBottom: 6 }}
              >
                📄 テキストをコピー
              </button>
              {boards.filter((b) => b.id !== currentId).length > 0 && (
                <>
                  <div style={{ fontSize: 10, color: "#9C9587", marginBottom: 2 }}>別のボードへ</div>
                  {boards.filter((b) => b.id !== currentId).map((b) => (
                    <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 1 }}>
                      <span style={{ flex: 1, fontSize: 12, padding: "3px 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        📄 {b.title || "（無題）"}
                      </span>
                      <button
                        onClick={() => copySubtreeTo(n.id, currentProjectId, b.id)}
                        style={{ border: "1px solid #C9C2B2", background: "transparent", color: "#3E3A33", borderRadius: 4, fontSize: 10, padding: "2px 7px", cursor: "pointer" }}
                      >
                        複製
                      </button>
                      <button
                        onClick={() => moveSubtreeTo(n.id, currentProjectId, b.id)}
                        style={{ border: "none", background: "#3E3A33", color: "#F6F2E9", borderRadius: 4, fontSize: 10, padding: "3px 7px", cursor: "pointer" }}
                      >
                        移動
                      </button>
                    </div>
                  ))}
                </>
              )}
              {allMetas.filter((m) => m.id !== currentProjectId).length > 0 && (
                <>
                  <div style={{ fontSize: 10, color: "#9C9587", margin: "4px 0 2px" }}>他のプロジェクトへ</div>
                  {allMetas.filter((m) => m.id !== currentProjectId).map((p) => (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 1 }}>
                      <span style={{ flex: 1, fontSize: 12, padding: "3px 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        📁 {p.name || "（無題）"}
                      </span>
                      <button
                        onClick={async () => {
                          const ok = await ensureProject(p.id);
                          if (!ok) return;
                          setCopyMenuFor(null);
                          setTimeout(() => copyToProject(n.id, p.id), 0);
                        }}
                        style={{ border: "1px solid #C9C2B2", background: "transparent", color: "#3E3A33", borderRadius: 4, fontSize: 10, padding: "2px 7px", cursor: "pointer" }}
                      >
                        複製
                      </button>
                      <button
                        onClick={async () => {
                          const ok = await ensureProject(p.id);
                          if (!ok) return;
                          setCopyMenuFor(null);
                          setTimeout(() => moveToProject(n.id, p.id), 0);
                        }}
                        style={{ border: "none", background: "#3E3A33", color: "#F6F2E9", borderRadius: 4, fontSize: 10, padding: "3px 7px", cursor: "pointer" }}
                      >
                        移動
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
          <button
            data-nodrag
            title={selected ? "接続を解除" : "線でつなぐ"}
            onClick={() => setConnectFrom(selected ? null : n.id)}
            style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 13, padding: 0 }}
          >
            🔗
          </button>
          <button
            data-nodrag
            title="剥がす（中身も一緒）"
            onClick={() => removeNote(n.id)}
            style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 13, padding: 0 }}
          >
            ✕
          </button>
        </div>

        {/* タイトル（1行）。使う設定のときだけ表示。空なら本文の1行目が見出しに使われる */}
        {!asHeading && n.useTitle && (
          <input
            data-nodrag
            value={n.title || ""}
            placeholder="タイトル"
            onChange={(e) => updateNote(n.id, { title: e.target.value.replace(/\n/g, "") })}
            style={{
              width: "100%", boxSizing: "border-box", flexShrink: 0,
              border: "none", borderBottom: "1px solid rgba(62,58,51,.18)",
              background: "transparent", fontFamily: "inherit",
              fontSize: 13, fontWeight: 700, color: "#3E3A33",
              padding: "3px 10px 4px", margin: "2px 0 0",
            }}
          />
        )}

        {asHeading ? (
          // 縮小表示中: 画面上の見かけの大きさを保った見出し＋タグを出す
          (() => {
            const inv = 1 / (zoom || 1);
            const head = headingOf(n);
            const all = n.tags || [];
            // 中身が分かるタグ（シーン・設定など）を優先。進捗や重要度は入りきらなければ省く
            const primary = all.filter(isOverviewTag);
            const secondary = all.filter((t) => !isOverviewTag(t));
            const chips = [...primary, ...secondary].slice(0, 3);
            const rest = all.length - chips.length;
            // 中に何が入っているか（入れ子の数）も分かるようにする
            const childCount = descendants;
            // ラベルの見かけ幅(px)。付箋より広くても構わない（読みやすさを優先）
            const LABEL_W = Math.max(170, Math.min(240, curW * zoom * 2.2));
            return (
              <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
                {/* 付箋の枠からはみ出してよい横長のラベル。縮小しても読める大きさを保つ */}
                <div
                  style={{
                    position: "absolute", left: "50%", top: "50%",
                    transform: `translate(-50%, -50%) scale(${inv})`,
                    transformOrigin: "center",
                    width: `${LABEL_W * zoom}px`,
                    textAlign: "center",
                    pointerEvents: "none",
                    background: tint(c.edge, 0.92),
                    border: `1px solid ${c.edge}`,
                    borderRadius: 6,
                    boxShadow: "0 2px 6px rgba(60,50,30,.22)",
                    padding: "5px 8px",
                    boxSizing: "border-box",
                  }}
                >
                  <div
                    style={{
                      fontSize: 14, fontWeight: 700, lineHeight: 1.35, color: "#3E3A33",
                      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                      overflow: "hidden", wordBreak: "break-word",
                    }}
                  >
                    {head || <span style={{ color: "rgba(62,58,51,.45)" }}>（無題）</span>}
                  </div>
                  {(chips.length > 0 || childCount > 0) && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, justifyContent: "center", marginTop: 4 }}>
                      {chips.map((t) => (
                        <span
                          key={t}
                          style={{
                            fontSize: 11, fontWeight: 700, borderRadius: 8, padding: "1px 7px",
                            background: "rgba(255,253,246,.9)", color: tagColorOf(t),
                          }}
                        >
                          {t}
                        </span>
                      ))}
                      {rest > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 8, padding: "1px 6px", background: "rgba(255,253,246,.75)", color: "#5A554B" }}>
                          +{rest}
                        </span>
                      )}
                      {childCount > 0 && (
                        <span
                          title="中に格納している付箋の数"
                          style={{ fontSize: 11, fontWeight: 700, borderRadius: 8, padding: "1px 7px", background: "rgba(255,253,246,.75)", color: "#5A554B" }}
                        >
                          ▸{childCount}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()
        ) : (
          <textarea
            data-nodrag
            value={n.text}
            placeholder="アイデアを書く"
            onChange={(e) => updateNote(n.id, { text: e.target.value })}
            style={{
              width: "100%", border: "none", background: "transparent",
              resize: "none",
              flex: isExpanded ? "0 0 34px" : 1,
              minHeight: 0,
              padding: "6px 10px 4px", fontSize: 14, lineHeight: 1.6,
              fontFamily: "inherit", color: "#3E3A33", boxSizing: "border-box",
            }}
          />
        )}

        {/* 引用プレビュー（引用先付箋のトップを表示） */}
        {!asHeading && refNotes.length > 0 && (
          <div data-nodrag style={{ flexShrink: 0, padding: "0 8px 4px", display: "flex", flexDirection: "column", gap: 3, overflow: "hidden" }}>
            {refNotes.map(({ note: m, removable }) => {
              const mc = COLORS[m.color] || COLORS[0];
              const parent = m.parentId ? noteMap[m.parentId] : null;
              return (
                <div
                  key={m.id}
                  title={`#${m.num} を表示（収納中でも開きます）`}
                  onClick={() => jumpTo(m.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    background: mc.bg,
                    borderTop: `5px solid ${mc.edge}`,
                    borderRadius: 3,
                    boxShadow: "1px 2px 4px rgba(60,50,30,.2)",
                    fontSize: 11, color: "#3E3A33",
                    padding: "2px 6px 3px",
                    cursor: "pointer",
                    overflow: "hidden",
                  }}
                >
                  <span style={{ fontWeight: 700, color: "rgba(62,58,51,.65)", flexShrink: 0, fontSize: 10 }}>#{m.num}</span>
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                    {headingOf(m) ? headingOf(m).slice(0, 30) : "（無題）"}
                  </span>
                  {parent && (
                    <span style={{ fontSize: 9, color: "rgba(62,58,51,.55)", flexShrink: 0 }}>#{parent.num}内</span>
                  )}
                  {removable && (
                    <button
                      title="引用を外す"
                      onClick={(e) => { e.stopPropagation(); removeRef(n.id, m.id); }}
                      style={{ border: "none", background: "transparent", cursor: "pointer", color: "rgba(62,58,51,.55)", fontSize: 11, padding: 0, flexShrink: 0 }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* タグ */}
        <div data-nodrag style={{ flexShrink: 0, display: asHeading ? "none" : "flex", flexWrap: "wrap", alignItems: "center", gap: 3, padding: "0 8px 5px", position: "relative" }}>
          {(() => {
            const all = n.tags || [];
            const limit = Math.max(1, settings.noteTagLimit ?? DEFAULT_SETTINGS.noteTagLimit);
            const expandedTags = !!showAllTags[n.id];
            // 赤色強調タグは格納対象にせず、常に先頭に表示する
            const isAlertTag = (t) => (settings.alertTags || []).includes(t);
            const alertPart = all.filter(isAlertTag);
            const normalPart = all.filter((t) => !isAlertTag(t));
            const shown = expandedTags
              ? [...alertPart, ...normalPart]
              : [...alertPart, ...normalPart.slice(0, Math.max(0, limit - alertPart.length))];
            const hiddenCount = all.length - shown.length;
            return (
              <>
                {shown.map((t) => {
                  const tc = tagColorOf(t);
                  return (
                    <button
                      key={t}
                      title={activeTag === t ? "強調を解除" : `タグ「${t}」の付箋を強調`}
                      onClick={() => setActiveTag(activeTag === t ? null : t)}
                      style={{
                        border: "none", borderRadius: 8, cursor: "pointer",
                        fontSize: 10, padding: "1px 7px",
                        background: activeTag === t ? tc : tint(tc, 0.15),
                        color: activeTag === t ? "#FFFDF6" : tc,
                        fontWeight: 700,
                      }}
                    >
                      {t}
                    </button>
                  );
                })}
                {hiddenCount > 0 && (
                  <button
                    title={`残り${hiddenCount}件のタグを表示`}
                    onClick={() => setShowAllTags((m) => ({ ...m, [n.id]: true }))}
                    style={{
                      border: "none", borderRadius: 8, cursor: "pointer",
                      fontSize: 10, padding: "1px 7px", fontWeight: 700,
                      background: "rgba(62,58,51,.22)", color: "#3E3A33",
                    }}
                  >
                    +{hiddenCount}
                  </button>
                )}
                {expandedTags && all.length > limit && (
                  <button
                    title="タグをしまう"
                    onClick={() => setShowAllTags((m) => ({ ...m, [n.id]: false }))}
                    style={{
                      border: "none", borderRadius: 8, cursor: "pointer",
                      fontSize: 10, padding: "1px 7px", fontWeight: 700,
                      background: "rgba(62,58,51,.22)", color: "#3E3A33",
                    }}
                  >
                    «
                  </button>
                )}
              </>
            );
          })()}
          <button
            data-tagmenu
            title="タグをつける"
            onClick={() => { bringToFront(n.id); setTagMenuFor(tagMenuFor === n.id ? null : n.id); setTagInput(""); setColorMenuFor(null); }}
            style={{
              border: "1px dashed rgba(62,58,51,.35)", borderRadius: 8,
              background: "transparent", cursor: "pointer",
              fontSize: 10, padding: "0 6px", color: "rgba(62,58,51,.6)",
            }}
          >
            ＋タグ
          </button>
          {tagMenuFor === n.id && (
            <div
              data-tagmenu
              style={{
                position: "absolute", bottom: 24, left: 4, zIndex: 100001,
                background: "#FFFDF6", borderRadius: 8,
                boxShadow: "0 5px 16px rgba(40,35,20,.3)",
                padding: 8, width: 235,
              }}
            >
              <div style={{ display: "flex", gap: 5, marginBottom: (n.tags || []).length > 0 ? 7 : 0 }}>
                <input
                  value={tagInput}
                  autoFocus
                  placeholder="タグ名"
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addTag(n.id); }}
                  style={{
                    flex: 1, minWidth: 0, border: "1px solid #C9C2B2", borderRadius: 5,
                    fontSize: 12, padding: "3px 6px", fontFamily: "inherit", color: "#3E3A33",
                    background: "#fff",
                  }}
                />
                <button
                  onClick={() => addTag(n.id)}
                  style={{ border: "none", borderRadius: 5, background: "#3E3A33", color: "#F6F2E9", fontSize: 12, padding: "3px 8px", cursor: "pointer" }}
                >
                  追加
                </button>
              </div>
              {(n.tags || []).map((t) => (
                <div key={t} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, padding: "1px 2px" }}>
                  <span style={{ color: tagColorOf(t), fontWeight: 700 }}>{t}</span>
                  <button
                    title="このタグを外す"
                    onClick={() => removeTag(n.id, t)}
                    style={{ border: "none", background: "transparent", cursor: "pointer", color: "#B0483C", fontSize: 12, padding: 0 }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {/* プリセットタグ */}
              <div style={{ maxHeight: 170, overflowY: "auto", marginTop: 6, borderTop: "1px solid #E4DFD2", paddingTop: 6 }}>
                {(settings.presetTags || []).map((cat, ci) => {
                  const cc = cat.color || CATEGORY_FALLBACK[ci % CATEGORY_FALLBACK.length];
                  return (
                    <div key={ci} style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 10, color: cc, fontWeight: 700, marginBottom: 2 }}>{cat.name}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                        {(cat.tags || []).map((t) => {
                          const has = (n.tags || []).includes(t);
                          const tc = tagColorOf(t);
                          return (
                            <button
                              key={t}
                              title={has ? `タグ「${t}」を外す` : `タグ「${t}」をつける`}
                              onClick={() => (has ? removeTag(n.id, t) : addTagValue(n.id, t))}
                              style={{
                                border: "none", borderRadius: 8,
                                cursor: "pointer",
                                fontSize: 10, padding: "1px 7px",
                                background: has ? tc : tint(tc, 0.15),
                                color: has ? "#FFFDF6" : tc,
                                fontWeight: 700,
                              }}
                            >
                              {t}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <button
            data-quotemenu
            title="他の付箋を検索して引用する"
            onClick={() => { bringToFront(n.id); setQuoteMenuFor(quoteMenuFor === n.id ? null : n.id); setQuoteQuery(""); setTagMenuFor(null); setColorMenuFor(null); }}
            style={{
              border: "1px dashed rgba(62,58,51,.35)", borderRadius: 8,
              background: "transparent", cursor: "pointer",
              fontSize: 10, padding: "0 6px", color: "rgba(62,58,51,.6)",
            }}
          >
            ❝引用
          </button>
          {quoteMenuFor === n.id && (
            <div
              data-quotemenu
              style={{
                position: "absolute", bottom: 24, left: 4, zIndex: 100001,
                background: "#FFFDF6", borderRadius: 8,
                boxShadow: "0 5px 16px rgba(40,35,20,.3)",
                padding: 8, width: 220,
              }}
            >
              <input
                value={quoteQuery}
                autoFocus
                placeholder="タグ・本文・番号で検索"
                onChange={(e) => setQuoteQuery(e.target.value)}
                style={{
                  width: "100%", boxSizing: "border-box",
                  border: "1px solid #C9C2B2", borderRadius: 5,
                  fontSize: 12, padding: "4px 7px", fontFamily: "inherit",
                  color: "#3E3A33", background: "#fff", marginBottom: 6,
                }}
              />
              <div style={{ maxHeight: 190, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
                {quoteCandidates.length === 0 && (
                  <span style={{ fontSize: 11, color: "#9C9587", padding: "4px 2px" }}>該当する付箋がありません</span>
                )}
                {quoteCandidates.map((m) => {
                  const mc = COLORS[m.color] || COLORS[0];
                  const parent = m.parentId ? noteMap[m.parentId] : null;
                  return (
                    <button
                      key={m.id}
                      onClick={() => addRef(n.id, m.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 5,
                        textAlign: "left", border: "none",
                        background: mc.bg,
                        borderTop: `4px solid ${mc.edge}`,
                        borderRadius: 3,
                        fontSize: 11, color: "#3E3A33",
                        padding: "2px 6px 3px", cursor: "pointer",
                        overflow: "hidden",
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: 10, color: "rgba(62,58,51,.65)", flexShrink: 0 }}>#{m.num}</span>
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                        {headingOf(m) ? headingOf(m).slice(0, 24) : "（無題）"}
                      </span>
                      {(m.tags || []).slice(0, 2).map((t) => (
                        <span key={t} style={{ fontSize: 9, background: tint(tagColorOf(t), 0.18), color: tagColorOf(t), fontWeight: 700, borderRadius: 6, padding: "0 5px", flexShrink: 0 }}>{t}</span>
                      ))}
                      {parent && (
                        <span style={{ fontSize: 9, color: "rgba(62,58,51,.55)", flexShrink: 0 }}>#{parent.num}内</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 内側のミニボード */}
        {isExpanded && (
          <div
            data-nodrag
            onDoubleClick={(e) => {
              if (e.target !== e.currentTarget) return;
              const r = e.currentTarget.getBoundingClientRect();
              const zf = zoom || 1;
              addNote(Math.max(0, (e.clientX - r.left) / zf - 60), Math.max(0, (e.clientY - r.top) / zf - 20), n.id);
            }}
            style={{
              position: "relative",
              margin: "0 6px 8px",
              flex: 1,
              minHeight: 0,
              background: "rgba(255,255,255,.55)",
              border: `1.5px dashed ${c.edge}`,
              borderRadius: 6,
              overflow: "hidden",
              backgroundImage: gridMode
                ? `linear-gradient(rgba(62,58,51,.10) 1px, transparent 1px), linear-gradient(90deg, rgba(62,58,51,.10) 1px, transparent 1px)`
                : "radial-gradient(rgba(62,58,51,.14) 1px, transparent 1px)",
              backgroundSize: gridMode ? `${GRID}px ${GRID}px` : "18px 18px",
              cursor: connectFrom ? "crosshair" : "default",
            }}
          >
            {kids.length === 0 && (
              <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 11, color: "#9C9587", pointerEvents: "none" }}>
                ダブルクリックで中に付箋を貼る
              </span>
            )}
            <button
              title="中に付箋を貼る"
              onClick={() => addNote(10 + Math.random() * 40, 10 + Math.random() * 30, n.id)}
              style={{
                position: "absolute", right: 6, bottom: 6, zIndex: 99999,
                border: "none", borderRadius: 5, background: c.edge,
                fontWeight: 700, fontSize: 12, padding: "2px 8px", cursor: "pointer", color: "#3E3A33",
              }}
            >
              ＋
            </button>
            {kids.map((k) => renderNote(k, depth + 1))}
          </div>
        )}

        {/* リサイズハンドル */}
        <div
          data-nodrag
          title="ドラッグで大きさを変える"
          onPointerDown={(e) => onResizeDown(e, n)}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          style={{
            position: "absolute", right: 0, bottom: 0,
            width: 18, height: 18,
            cursor: "nwse-resize", touchAction: "none",
            background: `linear-gradient(135deg, transparent 50%, ${c.edge} 50%)`,
            borderBottomRightRadius: 3,
          }}
        />
      </div>
    );
  };

  // ---- 線 ----
  // 見えているノード同士（子が見えていれば 子→別親 を直接）を直線で結ぶ。
  // 収納されている側は、その最上位の見えている親に束ねてオレンジ点線で表示。
  const renderEdges = () => {
    const seen = new Set();

    const edgePoint = (from, to) => {
      const dx = to.cx - from.cx;
      const dy = to.cy - from.cy;
      if (dx === 0 && dy === 0) return { x: from.cx, y: from.cy };
      const sx = dx !== 0 ? (from.hw + 3) / Math.abs(dx) : Infinity;
      const sy = dy !== 0 ? (from.hh + 3) / Math.abs(dy) : Infinity;
      const s = Math.min(sx, sy, 0.45);
      return { x: from.cx + dx * s, y: from.cy + dy * s };
    };

    return edges.map((ed) => {
      const a = noteMap[ed.from];
      const b = noteMap[ed.to];
      if (!a || !b) return null;
      if (isAncestor(ed.from, ed.to) || isAncestor(ed.to, ed.from)) return null;
      const aid = anchorIdOf(ed.from, noteMap);
      const bid = anchorIdOf(ed.to, noteMap);
      if (aid === bid) return null;
      const ra = centers[aid];
      const rb = centers[bid];
      if (!ra || !rb) return null;
      const p1 = edgePoint(ra, rb);
      const p2 = edgePoint(rb, ra);
      const bundled = aid !== ed.from || bid !== ed.to;
      const key = `${[aid, bid].sort().join("|")}`;
      const dup = seen.has(key);
      seen.add(key);
      const d = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
      const color = bundled ? "#C98A3D" : "#B0483C";
      return (
        <g key={ed.id}>
          <path
            d={d}
            stroke="transparent" strokeWidth="16" fill="none"
            style={{ pointerEvents: "stroke", cursor: "pointer" }}
            onClick={() => setEdgeMenu({ id: ed.id, x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 })}
          >
            <title>クリックでメモを書く・線を外す</title>
          </path>
          {!dup && (
            <path
              d={d}
              stroke={color}
              strokeWidth="2.2"
              strokeDasharray={bundled ? "6 5" : "1 0"}
              fill="none" opacity="0.85"
              style={{ pointerEvents: "none" }}
            />
          )}
          {!dup && <circle cx={p1.x} cy={p1.y} r="4" fill={color} />}
          {!dup && <circle cx={p2.x} cy={p2.y} r="4" fill={color} />}
          {!dup && ed.memo && (() => {
            const mx = (p1.x + p2.x) / 2;
            const my = (p1.y + p2.y) / 2;
            const label = ed.memo.length > 18 ? ed.memo.slice(0, 18) + "…" : ed.memo;
            const w = label.length * 11 + 14;
            return (
              <g
                style={{ pointerEvents: "auto", cursor: "pointer" }}
                onClick={() => setEdgeMenu({ id: ed.id, x: mx, y: my })}
              >
                <rect x={mx - w / 2} y={my - 11} width={w} height={22} rx={6}
                  fill="#FFFDF6" stroke={color} strokeWidth="1.5" />
                <text x={mx} y={my + 5} textAnchor="middle" fontSize="12" fill="#3E3A33"
                  style={{ fontFamily: "inherit", userSelect: "none" }}>{label}</text>
              </g>
            );
          })()}
        </g>
      );
    });
  };

  const connectingNote = connectFrom ? noteMap[connectFrom] : null;

  return (
    <div
      style={{ position: "fixed", inset: 0, fontFamily: "'Zen Maru Gothic','Hiragino Maru Gothic ProN',sans-serif", background: "#F6F2E9", overflow: "hidden", display: "flex", flexDirection: "column" }}
      onPointerDown={(e) => {
        if (!e.target.closest("[data-colormenu]")) setColorMenuFor(null);
        if (!e.target.closest("[data-tagmenu]")) setTagMenuFor(null);
        if (!e.target.closest("[data-quotemenu]")) setQuoteMenuFor(null);
        if (!e.target.closest("[data-copymenu]")) setCopyMenuFor(null);
        if (!e.target.closest("[data-zonemenu]")) setZoneColorMenuFor(null);
        if (!e.target.closest("[data-sharemenu]")) setShareOpen(false);
        if (!e.target.closest("[data-addmenu]")) setAddMenuOpen(false);
        if (!e.target.closest("[data-viewmenu]")) setViewMenuOpen(false);
        if (!e.target.closest("[data-edgemenu]")) setEdgeMenu(null);
        if (!e.target.closest("[data-tagpanel]")) { setTagPanelOpen(false); setTagPanelTag(null); }
        if (!e.target.closest("[data-projmenu]")) setProjMenuOpen(false);
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700&display=swap');
        .note-enter { animation: pop .18s ease-out; }
        @keyframes pop { from { transform: scale(.92); opacity: 0 } to { transform: scale(1); opacity: 1 } }
        @media (prefers-reduced-motion: reduce) { .note-enter { animation: none } }
        textarea:focus, input:focus { outline: none }
        button { font-family: inherit }
        button, input, select, textarea { -webkit-app-region: no-drag }
        .board-tabs::-webkit-scrollbar { height: 5px }
        .board-tabs::-webkit-scrollbar-thumb { background: #6B665C; border-radius: 3px }
        .btext .btext-tools { opacity: 0; transition: opacity .12s ease }
        .btext:hover .btext-tools, .btext:focus-within .btext-tools { opacity: 1 }
        .btext textarea { border: 1px dashed transparent; border-radius: 4px }
        .btext:hover textarea, .btext textarea:focus { border-color: rgba(62,58,51,.35) }
        /* タッチ端末ではホバーできないので常に操作UIを表示 */
        @media (hover: none) {
          .btext .btext-tools { opacity: .85 }
          .btext textarea { border-color: rgba(62,58,51,.25) }
        }
        /* タッチのタップ遅延・意図しない拡大を防ぐ */
        button, input, textarea { touch-action: manipulation }
        .bimg .bimg-del, .bimg .bimg-rs { opacity: 0; transition: opacity .12s ease }
        .bimg:hover .bimg-del, .bimg:hover .bimg-rs { opacity: 1 }
        @media (hover: none) { .bimg .bimg-del, .bimg .bimg-rs { opacity: .9 } }
      `}</style>

      {/* ツールバー */}
      <div
        style={{
          position: "relative",
          display: "flex", alignItems: "center", gap: 8,
          // macは左上の信号機ボタンと重ならないよう余白を空ける
          padding: isMacApp ? "8px 12px 8px 84px" : "6px 12px",
          background: "#3E3A33", color: "#F6F2E9", flexWrap: "wrap", zIndex: 100000,
        }}
      >
        {/* macの信号機ボタンのぶんの余白。ここだけドラッグでウィンドウを動かせる */}
        {isMacApp && (
          <div
            style={{
              position: "absolute", left: 0, top: 0, width: 80, height: "100%",
              WebkitAppRegion: "drag", pointerEvents: "none",
            }}
          />
        )}
        <button
          onClick={() => setListOpen((v) => !v)}
          title="付箋リストを開く／閉じる"
          style={{
            border: "1px solid #8A857B", borderRadius: 6,
            background: listOpen ? "#F6F2E9" : "transparent",
            color: listOpen ? "#3E3A33" : "#F6F2E9",
            fontSize: 15, lineHeight: 1, padding: "5px 9px", cursor: "pointer",
          }}
        >
          ☰
        </button>

        {/* プロジェクトメニュー */}
        <div data-projmenu style={{ position: "relative" }}>
          <button
            onClick={() => setProjMenuOpen(!projMenuOpen)}
            title="プロジェクトの切替・保存"
            style={{
              border: "1px solid #8A857B", borderRadius: 6,
              background: projMenuOpen ? "#F6F2E9" : "transparent",
              color: projMenuOpen ? "#3E3A33" : "#F6F2E9",
              fontSize: 12, fontWeight: 700, padding: "4px 10px", cursor: "pointer",
              maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            📁 {project?.name || "プロジェクト"} ▾
          </button>
          {projMenuOpen && (
            <div
              style={{
                position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 100002,
                background: "#FFFDF6", borderRadius: 8,
                boxShadow: "0 6px 20px rgba(40,35,20,.35)",
                padding: 10, width: 250, color: "#3E3A33",
              }}
            >
              <div style={{ fontSize: 11, color: "#9C9587", marginBottom: 3 }}>プロジェクト名</div>
              <input
                value={project?.name || ""}
                onChange={(e) => updateProject((p) => ({ ...p, name: e.target.value }))}
                placeholder="プロジェクト名"
                style={{
                  width: "100%", boxSizing: "border-box",
                  border: "1px solid #C9C2B2", borderRadius: 5,
                  fontSize: 13, fontWeight: 700, padding: "4px 7px",
                  fontFamily: "inherit", color: "#3E3A33", background: "#fff", marginBottom: 8,
                }}
              />
              <div style={{ fontSize: 11, color: "#9C9587", marginBottom: 3 }}>プロジェクト一覧</div>
              <div style={{ maxHeight: 150, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2, marginBottom: 8 }}>
                {allMetas.map((p) => {
                  const active = p.id === currentProjectId;
                  return (
                    <div
                      key={p.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 6,
                        background: active ? "rgba(62,58,51,.12)" : "transparent",
                        borderRadius: 5, padding: "3px 7px",
                      }}
                    >
                      <button
                        onClick={() => !active && switchProject(p.id)}
                        style={{
                          flex: 1, textAlign: "left", border: "none", background: "transparent",
                          fontSize: 13, fontWeight: active ? 700 : 400, color: "#3E3A33",
                          cursor: active ? "default" : "pointer", padding: 0,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}
                      >
                        {p.name || "（無題）"}
                        <span style={{ fontSize: 10, color: "#9C9587", marginLeft: 5 }}>
                          {p.boards}ボード
                        </span>
                      </button>
                      <button
                        title="このプロジェクトを削除"
                        onClick={() => removeProject(p.id)}
                        style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 12, padding: 0, color: "#B0483C" }}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
              <button
                onClick={addProject}
                style={{
                  width: "100%", border: "none", borderRadius: 5, background: "#3E3A33", color: "#F6F2E9",
                  fontSize: 12, fontWeight: 700, padding: "5px 0", cursor: "pointer", marginBottom: 6,
                }}
              >
                ＋ 新規プロジェクトを開始
              </button>
              <button
                onClick={() => { setStartPick({ id: currentProjectId, from: "local" }); setStartOpen(true); setProjMenuOpen(false); }}
                style={{
                  width: "100%", border: "1px solid #C9C2B2", borderRadius: 5, background: "transparent", color: "#3E3A33",
                  fontSize: 11, padding: "4px 0", cursor: "pointer", marginBottom: 8,
                }}
              >
                プロジェクト選択画面を開く
              </button>
              {/* 他のPCと共有（同期フォルダ） */}
              {bridge?.syncStatus && (
                <div style={{ borderTop: "1px solid #E4DFD2", paddingTop: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: "#9C9587", marginBottom: 4 }}>他のPCと共有</div>
                  {!syncInfo.available ? (
                    <>
                      <div style={{ fontSize: 11, color: "#9C9587", lineHeight: 1.6, marginBottom: 6 }}>
                        OneDrive や Dropbox の中にフォルダを選ぶと、そこにプロジェクトが保存され、
                        別のPCからも開けるようになります。
                      </div>
                      <button
                        onClick={chooseSyncFolder}
                        style={{ width: "100%", border: "none", borderRadius: 5, background: "#3E3A33", color: "#F6F2E9", fontSize: 12, fontWeight: 700, padding: "6px 0", cursor: "pointer" }}
                      >
                        同期フォルダを選ぶ
                      </button>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 10, color: "#9C9587", wordBreak: "break-all", marginBottom: 6 }}>
                        {syncInfo.folder}
                      </div>
                      {syncedIds.includes(currentProjectId) ? (
                        <div style={{ fontSize: 11, color: "#4C7A4C", fontWeight: 700, marginBottom: 6 }}>
                          ● このプロジェクトは共有中
                        </div>
                      ) : (
                        <button
                          onClick={() => pushProject(currentProjectId)}
                          style={{ width: "100%", border: "none", borderRadius: 5, background: "#4C7A4C", color: "#FFFDF6", fontSize: 12, fontWeight: 700, padding: "6px 0", cursor: "pointer", marginBottom: 6 }}
                        >
                          このプロジェクトを共有する
                        </button>
                      )}
                      {syncList.filter((x) => !allMetas.some((m) => m.id === x.id)).length > 0 && (
                        <>
                          <div style={{ fontSize: 10, color: "#9C9587", marginBottom: 3 }}>別のPCにあるプロジェクト</div>
                          {syncList.filter((x) => !allMetas.some((m) => m.id === x.id)).map((x) => (
                            <button
                              key={x.id}
                              onClick={() => pullProject(x.id)}
                              style={{
                                display: "block", width: "100%", textAlign: "left", border: "none",
                                background: "rgba(62,58,51,.06)", borderRadius: 5, padding: "4px 8px",
                                cursor: "pointer", fontSize: 11, color: "#3E3A33", marginBottom: 2,
                              }}
                            >
                              {x.name}
                              <span style={{ fontSize: 9.5, color: "#9C9587", marginLeft: 5 }}>
                                {x.device} / {new Date(x.mtime).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </button>
                          ))}
                        </>
                      )}
                      <button
                        onClick={async () => { const st = await bridge.syncClear(); setSyncInfo(st); setSyncList([]); }}
                        style={{ width: "100%", border: "none", background: "transparent", color: "#8A857B", fontSize: 10, padding: "6px 0 0", cursor: "pointer" }}
                      >
                        共有をやめる（フォルダの中身は消えません）
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* 復元ポイント（自動保存の履歴） */}
              <div style={{ borderTop: "1px solid #E4DFD2", paddingTop: 8, marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: "#9C9587" }}>復元ポイント</span>
                  <button
                    title="今の状態を復元ポイントとして残す"
                    onClick={async () => {
                      const cur = projects.find((p) => p.id === currentProjectId);
                      if (cur && !(await makeBackup(currentProjectId, JSON.stringify(cur), "手動"))) setKeepFail({ id: cur.id, name: cur.name });
                    }}
                    style={{ marginLeft: "auto", border: "1px solid #C9C2B2", borderRadius: 5, background: "transparent", color: "#3E3A33", fontSize: 10, padding: "2px 7px", cursor: "pointer" }}
                  >
                    今の状態を残す
                  </button>
                </div>
                {backups.length === 0 ? (
                  <div style={{ fontSize: 11, color: "#9C9587" }}>まだありません（編集を続けると自動で作られます）</div>
                ) : (
                  <div style={{ maxHeight: 120, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                    {[...backups].sort((a, b) => b.t - a.t).map((b) => (
                      <button
                        key={b.t}
                        title="この時点の状態に戻す"
                        onClick={() => restoreBackup(b.t)}
                        style={{
                          textAlign: "left", border: "none", background: "rgba(62,58,51,.06)",
                          borderRadius: 5, padding: "3px 8px", cursor: "pointer",
                          fontSize: 11, color: "#3E3A33", display: "flex", alignItems: "center", gap: 6,
                        }}
                      >
                        <span style={{ flex: 1 }}>
                          {new Date(b.t).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <span style={{ fontSize: 9.5, color: "#9C9587" }}>{b.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ borderTop: "1px solid #E4DFD2", paddingTop: 8, display: "flex", gap: 6 }}>
                <button
                  title="現在のプロジェクトをJSONファイルに保存"
                  onClick={() => exportProject()}
                  style={{ flex: 1, border: "1px solid #C9C2B2", borderRadius: 5, background: "transparent", fontSize: 11, padding: "4px 0", cursor: "pointer", color: "#3E3A33" }}
                >
                  ファイルへ保存
                </button>
                <button
                  title="JSONファイルからプロジェクトを読み込む"
                  onClick={() => fileInputRef.current?.click()}
                  style={{ flex: 1, border: "1px solid #C9C2B2", borderRadius: 5, background: "transparent", fontSize: 11, padding: "4px 0", cursor: "pointer", color: "#3E3A33" }}
                >
                  ファイルを開く
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importProject(f);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
          )}
        </div>
        {/* 追加（付箋・文字・領域・画像） */}
        <div data-addmenu style={{ position: "relative" }}>
          <button
            onClick={() => { setAddMenuOpen((v) => !v); setViewMenuOpen(false); }}
            style={{ background: "#FFF3A3", color: "#3E3A33", border: "none", borderRadius: 6, padding: "5px 13px", fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 0 #C9B94E" }}
          >
            ＋ 追加 ▾
          </button>
          {addMenuOpen && (
            <div
              style={{
                position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 100002,
                background: "#FFFDF6", borderRadius: 8, boxShadow: "0 6px 20px rgba(40,35,20,.35)",
                padding: 7, width: 210, color: "#3E3A33",
              }}
            >
              {[
                { label: "付箋", hint: "アイデアを書く", color: "#E8D96A", act: () => addNoteCenter() },
                { label: "文字", hint: "ボードに見出しを書く", color: "#93C9EE", act: () => addTextCenter() },
                { label: "画像", hint: "写真や資料を貼る", color: "#E39BAF", act: () => imgInputRef.current?.click() },
                { label: "領域", hint: "範囲に背景色を敷く", color: "#8FBF7D", act: () => setZoneMode(true) },
              ].map((it) => (
                <button
                  key={it.label}
                  onClick={() => { it.act(); setAddMenuOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                    border: "none", background: "transparent", borderRadius: 6, padding: "6px 8px", cursor: "pointer",
                  }}
                >
                  <span style={{ width: 14, height: 14, borderRadius: 4, background: it.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{it.label}</span>
                  <span style={{ fontSize: 10.5, color: "#9C9587", marginLeft: "auto" }}>{it.hint}</span>
                </button>
              ))}
              <div style={{ borderTop: "1px solid #E4DFD2", margin: "6px 0" }} />
              <label style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 8px", fontSize: 12, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={propMode}
                  onChange={(e) => setPropMode(e.target.checked)}
                  style={{ width: 14, height: 14, cursor: "pointer" }}
                />
                貼る前に色・タグを決める
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 8px", fontSize: 12, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={settings.confirmDelete !== false}
                  onChange={(e) => updateSettings({ confirmDelete: e.target.checked })}
                  style={{ width: 14, height: 14, cursor: "pointer" }}
                />
                剥がすときに確認する
              </label>
            </div>
          )}
        </div>
        <input
          ref={imgInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => { addImageFiles(e.target.files); e.target.value = ""; }}
        />

        {/* 描く・選ぶ */}
        <button
          onClick={() => { setDrawMode((m) => !m); setSelectMode(false); setZoneMode(false); setEraseMode(false); }}
          title="ボードに手書きする（Apple Pencil対応）"
          style={{
            background: drawMode ? "#3E3A33" : "#E6DBFF",
            color: drawMode ? "#F6F2E9" : "#3E3A33",
            border: drawMode ? "1px solid #F6F2E9" : "none",
            borderRadius: 6, padding: "5px 11px", fontWeight: 700, cursor: "pointer",
            boxShadow: drawMode ? "none" : "0 2px 0 #A98FD6",
          }}
        >
          ✏️
        </button>

        {/* ズーム */}
        <div style={{ display: "flex", alignItems: "center", border: "1px solid #8A857B", borderRadius: 6, overflow: "hidden" }}>
          <button
            title="縮小"
            onClick={() => zoomBy(1 / 1.2)}
            style={{ border: "none", background: "transparent", color: "#D8D3C8", fontSize: 14, padding: "3px 8px", cursor: "pointer" }}
          >
            −
          </button>
          <button
            title="100%に戻す（Ctrl+ホイールでもズームできます）"
            onClick={() => applyZoom(1, (scrollerRef.current?.clientWidth || 0) / 2, (scrollerRef.current?.clientHeight || 0) / 2)}
            style={{ border: "none", background: "transparent", color: "#F6F2E9", fontSize: 12, padding: "3px 4px", cursor: "pointer", minWidth: 42 }}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            title="拡大"
            onClick={() => zoomBy(1.2)}
            style={{ border: "none", background: "transparent", color: "#D8D3C8", fontSize: 14, padding: "3px 8px", cursor: "pointer" }}
          >
            ＋
          </button>
        </div>


        {/* 表示（配置・見た目） */}
        <div data-viewmenu style={{ position: "relative" }}>
          <button
            onClick={() => { setViewMenuOpen((v) => !v); setAddMenuOpen(false); }}
            style={{
              border: "1px solid #8A857B", borderRadius: 6, background: "transparent",
              color: "#D8D3C8", fontSize: 12, padding: "4px 10px", cursor: "pointer",
            }}
          >
            表示 ▾
          </button>
          {viewMenuOpen && (
            <div
              style={{
                position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 100002,
                background: "#FFFDF6", borderRadius: 8, boxShadow: "0 6px 20px rgba(40,35,20,.35)",
                padding: 10, width: 200, color: "#3E3A33",
              }}
            >
              <div style={{ fontSize: 10.5, color: "#9C9587", marginBottom: 4 }}>配置</div>
              <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid #C9C2B2", marginBottom: 10 }}>
                <button
                  onClick={() => gridMode && toggleGrid()}
                  style={{
                    flex: 1, border: "none", padding: "5px 0", fontSize: 12, cursor: "pointer",
                    background: !gridMode ? "#3E3A33" : "transparent",
                    color: !gridMode ? "#F6F2E9" : "#6B665C", fontWeight: !gridMode ? 700 : 400,
                  }}
                >
                  自由
                </button>
                <button
                  onClick={() => !gridMode && toggleGrid()}
                  style={{
                    flex: 1, border: "none", padding: "5px 0", fontSize: 12, cursor: "pointer",
                    background: gridMode ? "#3E3A33" : "transparent",
                    color: gridMode ? "#F6F2E9" : "#6B665C", fontWeight: gridMode ? 700 : 400,
                  }}
                >
                  グリッド
                </button>
              </div>

              <div style={{ fontSize: 10.5, color: "#9C9587", marginBottom: 4 }}>付箋の見た目</div>
              <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid #C9C2B2", marginBottom: 10 }}>
                <button
                  onClick={() => setSimpleStyle(false)}
                  style={{
                    flex: 1, border: "none", padding: "5px 0", fontSize: 12, cursor: "pointer",
                    background: !simpleStyle ? "#3E3A33" : "transparent",
                    color: !simpleStyle ? "#F6F2E9" : "#6B665C", fontWeight: !simpleStyle ? 700 : 400,
                  }}
                >
                  付箋
                </button>
                <button
                  onClick={() => setSimpleStyle(true)}
                  style={{
                    flex: 1, border: "none", padding: "5px 0", fontSize: 12, cursor: "pointer",
                    background: simpleStyle ? "#3E3A33" : "transparent",
                    color: simpleStyle ? "#F6F2E9" : "#6B665C", fontWeight: simpleStyle ? 700 : 400,
                  }}
                >
                  シンプル
                </button>
              </div>

              <button
                onClick={() => { setSelectMode((m) => !m); setZoneMode(false); setDrawMode(false); setViewMenuOpen(false); }}
                style={{
                  width: "100%", border: "1px solid #C9C2B2", borderRadius: 6, marginBottom: 6,
                  background: selectMode ? "#3D6FB4" : "transparent",
                  color: selectMode ? "#FFFDF6" : "#3E3A33",
                  fontSize: 12, padding: "6px 0", cursor: "pointer",
                }}
              >
                ▨ 範囲を選択する
              </button>
              {strokes.length > 0 && (
                <button
                  onClick={() => setShowStrokes((v) => !v)}
                  style={{
                    width: "100%", border: "1px solid #C9C2B2", borderRadius: 6,
                    background: "transparent", color: showStrokes ? "#3E3A33" : "#9C9587",
                    fontSize: 12, padding: "6px 0", cursor: "pointer",
                  }}
                >
                  {showStrokes ? "✏️ 手書きを隠す" : "✏️ 手書きを表示"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* タグ一覧 */}
        <div data-tagpanel style={{ position: "relative" }}>
          <button
            onClick={() => { setTagPanelOpen(!tagPanelOpen); setTagPanelTag(null); }}
            style={{
              border: "1px solid #8A857B", borderRadius: 6,
              background: tagPanelOpen ? "#F6F2E9" : "transparent",
              color: tagPanelOpen ? "#3E3A33" : "#D8D3C8",
              fontSize: 12, padding: "4px 10px", cursor: "pointer",
              fontWeight: tagPanelOpen ? 700 : 400,
            }}
          >
            タグ一覧
          </button>
          {tagPanelOpen && (() => {
            const tagCounts = {};
            for (const nn of notes) for (const t of nn.tags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
            const tagNames = Object.keys(tagCounts).sort((a, b) => a.localeCompare(b, "ja"));
            const taggedNotes = tagPanelTag
              ? notes.filter((nn) => (nn.tags || []).includes(tagPanelTag)).sort((a, b) => a.num - b.num)
              : [];
            return (
              <div
                style={{
                  position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 100002,
                  background: "#FFFDF6", borderRadius: 8,
                  boxShadow: "0 6px 20px rgba(40,35,20,.35)",
                  padding: 10, width: 240, color: "#3E3A33",
                }}
              >
                {!tagPanelTag ? (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 7 }}>このボードのタグ</div>
                    {tagNames.length === 0 && (
                      <span style={{ fontSize: 11, color: "#9C9587" }}>タグはまだありません（付箋の「＋タグ」から付けられます）</span>
                    )}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {tagNames.map((t) => {
                        const tc = tagColorOf(t);
                        return (
                          <button
                            key={t}
                            onClick={() => setTagPanelTag(t)}
                            style={{
                              border: "none", borderRadius: 8, cursor: "pointer",
                              fontSize: 12, padding: "2px 9px", fontWeight: 700,
                              background: tint(tc, 0.15), color: tc,
                            }}
                          >
                            {t} <span style={{ opacity: 0.6, fontSize: 10 }}>{tagCounts[t]}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                      <button
                        title="タグ一覧へ戻る"
                        onClick={() => setTagPanelTag(null)}
                        style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 13, padding: 0, color: "#3E3A33" }}
                      >
                        ←
                      </button>
                      <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>タグ「{tagPanelTag}」の付箋</span>
                      <button
                        title={activeTag === tagPanelTag ? "強調を解除" : "ボード上で強調する"}
                        onClick={() => setActiveTag(activeTag === tagPanelTag ? null : tagPanelTag)}
                        style={{
                          border: "none", borderRadius: 8, cursor: "pointer",
                          fontSize: 10, padding: "2px 8px", fontWeight: 700,
                          background: activeTag === tagPanelTag ? tagColorOf(tagPanelTag) : tint(tagColorOf(tagPanelTag), 0.15),
                          color: activeTag === tagPanelTag ? "#FFFDF6" : tagColorOf(tagPanelTag),
                        }}
                      >
                        強調
                      </button>
                    </div>
                    <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
                      {taggedNotes.map((m) => {
                        const mc = COLORS[m.color] || COLORS[0];
                        const parent = m.parentId ? noteMap[m.parentId] : null;
                        return (
                          <button
                            key={m.id}
                            title="この付箋を表示"
                            onClick={() => { jumpTo(m.id); setTagPanelOpen(false); setTagPanelTag(null); }}
                            style={{
                              display: "flex", alignItems: "center", gap: 5,
                              textAlign: "left", border: "none",
                              background: mc.bg,
                              borderTop: `4px solid ${mc.edge}`,
                              borderRadius: 3,
                              fontSize: 11, color: "#3E3A33",
                              padding: "2px 6px 3px", cursor: "pointer",
                              overflow: "hidden",
                            }}
                          >
                            <span style={{ fontWeight: 700, fontSize: 10, color: "rgba(62,58,51,.65)", flexShrink: 0 }}>#{m.num}</span>
                            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                              {headingOf(m) ? headingOf(m).slice(0, 24) : "（無題）"}
                            </span>
                            {parent && (
                              <span style={{ fontSize: 9, color: "rgba(62,58,51,.55)", flexShrink: 0 }}>#{parent.num}内</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </div>

        {activeTag && (
          <button
            onClick={() => setActiveTag(null)}
            title="タグの強調を解除"
            style={{ border: "none", borderRadius: 8, background: tagColorOf(activeTag), color: "#FFFDF6", fontSize: 12, padding: "3px 10px", cursor: "pointer", fontWeight: 700 }}
          >
            タグ: {activeTag} ✕
          </button>
        )}

        {(zoneMode || selectMode) && (
          <span style={{ fontSize: 12, fontWeight: 700, color: "#FFF3A3" }}>
            {zoneMode ? "範囲をドラッグして領域を作る" : "範囲をドラッグして選択"}
            <button
              onClick={() => { setZoneMode(false); setSelectMode(false); }}
              style={{ border: "none", background: "transparent", color: "#FFF3A3", cursor: "pointer", fontSize: 12, padding: "0 4px" }}
            >
              ✕
            </button>
          </span>
        )}
        {connectFrom && (
          <span style={{ fontSize: 12, opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 }}>
            「{(connectingNote ? headingOf(connectingNote) : "") || "無題"}」とつなぐ相手をクリック
          </span>
        )}
        <div style={{ flex: 1 }} />
        <div data-sharemenu style={{ position: "relative" }}>
            <button
              onClick={() => setShareOpen((v) => !v)}
              title="スマホなどから付箋を受け取る"
              style={{
                border: `1px solid ${cloud ? "#8FBF7D" : "#8A857B"}`,
                borderRadius: 6,
                background: cloudItems.length > 0 ? "#D6F5C9" : "transparent",
                color: cloudItems.length > 0 ? "#3E3A33" : "#D8D3C8",
                fontSize: 12, padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap",
                fontWeight: cloudItems.length > 0 ? 700 : 400,
              }}
            >
              デバイス接続{cloudItems.length > 0 ? ` (${cloudItems.length})` : ""}
            </button>
            {shareOpen && (
              <div
                style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 100002,
                  background: "#FFFDF6", borderRadius: 8, boxShadow: "0 6px 20px rgba(40,35,20,.35)",
                  padding: 12, width: 260, maxWidth: "90vw", color: "#3E3A33",
                }}
              >
                {/* クラウド同期（どこからでも届く） */}
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
                    <strong style={{ fontSize: 13, flex: 1 }}>クラウド同期</strong>
                    {cloud && (
                      <span style={{ fontSize: 10, color: "#4C7A4C", fontWeight: 700 }}>● 設定済み</span>
                    )}
                  </div>
                  {!cloud ? (
                    <>
                      <div style={{ fontSize: 10.5, color: "#9C9587", lineHeight: 1.7, marginBottom: 6 }}>
                        設定すると、スマホで書いたものが外出先からでも届き、
                        別のパソコンとも同じボードを使えるようになります。
                      </div>
                      <button
                        onClick={() => { setSetupStep(0); setSetupMsg(null); setSetupOpen(true); setShareOpen(false); }}
                        style={{ width: "100%", border: "none", borderRadius: 5, background: "#3E3A33", color: "#F6F2E9", fontSize: 12, fontWeight: 700, padding: "8px 0", cursor: "pointer", marginBottom: 5 }}
                      >
                        かんたん設定をはじめる
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            const t = await navigator.clipboard.readText();
                            const d = JSON.parse(t);
                            if (d.projectId && d.apiKey && d.room) {
                              setCloudForm({ projectId: d.projectId, apiKey: d.apiKey, room: d.room });
                              setSetupStep(4);
                              setSetupMsg(null);
                              setSetupOpen(true);
                              setShareOpen(false);
                            } else setCloudMsg("設定の形式が違います");
                          } catch (e) { setCloudMsg("貼り付けできませんでした"); }
                        }}
                        style={{ width: "100%", border: "1px solid #C9C2B2", borderRadius: 5, background: "transparent", color: "#3E3A33", fontSize: 11, padding: "5px 0", cursor: "pointer" }}
                      >
                        他の端末の設定を貼り付ける
                      </button>
                      {cloudMsg && (
                        <div style={{ fontSize: 10.5, color: "#A23A2E", marginTop: 4 }}>{cloudMsg}</div>
                      )}
                    </>
                  ) : (
                    <>
                      <button
                        onClick={openPreview}
                        disabled={cloudItems.length === 0}
                        style={{
                          width: "100%", border: "none", borderRadius: 5, marginBottom: 4,
                          background: cloudItems.length > 0 ? "#4C7A4C" : "rgba(62,58,51,.13)",
                          color: cloudItems.length > 0 ? "#FFFDF6" : "#9C9587",
                          fontSize: 12, fontWeight: 700, padding: "7px 0", cursor: "pointer",
                        }}
                      >
                        {cloudItems.length > 0 ? `届いた付箋を見る（${cloudItems.length}件）` : "届いた付箋はありません"}
                      </button>
                      <div style={{ display: "flex", gap: 5 }}>
                        <button
                          onClick={() => checkCloud()}
                          style={{ flex: 1, border: "1px solid #C9C2B2", borderRadius: 5, background: "transparent", color: "#3E3A33", fontSize: 10.5, padding: "4px 0", cursor: "pointer" }}
                        >
                          今すぐ確認
                        </button>
                        <button
                          onClick={async () => {
                            const ok = await navigator.clipboard.writeText(JSON.stringify(cloud)).then(() => true).catch(() => false);
                            setCloudMsg(ok ? "設定をコピーしました（スマホで貼り付け）" : "コピーできませんでした");
                          }}
                          style={{ flex: 1, border: "1px solid #C9C2B2", borderRadius: 5, background: "transparent", color: "#3E3A33", fontSize: 10.5, padding: "4px 0", cursor: "pointer" }}
                        >
                          設定をコピー
                        </button>
                        <button
                          onClick={() => { setSetupStep(4); setSetupMsg(null); setSetupOpen(true); setShareOpen(false); }}
                          style={{ border: "1px solid #C9C2B2", borderRadius: 5, background: "transparent", color: "#3E3A33", fontSize: 10.5, padding: "4px 0", cursor: "pointer", flex: 1 }}
                        >
                          設定を見る
                        </button>
                        <button
                          onClick={() => { saveCloudConf(null); setCloud(null); setCloudItems([]); setCloudMsg(""); }}
                          style={{ border: "none", background: "transparent", color: "#B0483C", fontSize: 10.5, padding: "4px 6px", cursor: "pointer" }}
                        >
                          解除
                        </button>
                      </div>
                      {cloudMsg && (
                        <div style={{ fontSize: 10.5, color: "#6B665C", marginTop: 4 }}>{cloudMsg}</div>
                      )}
                    </>
                  )}
                </div>

                {/* パソコン同士でプロジェクトを共有する */}
                {cloud && (
                  <div style={{ borderTop: "1px solid #E4DFD2", marginTop: 10, paddingTop: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                      サーバーに保存
                    </div>
                    <div style={{ fontSize: 10.5, color: "#9C9587", lineHeight: 1.7, marginBottom: 6 }}>
                    </div>

                    {cloudShared.includes(currentProjectId) ? (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 10.5, color: "#4C7A4C", fontWeight: 700, marginBottom: 5 }}>
                          ● サーバーに保存しています
                        </div>
                        <div style={{ display: "flex", gap: 5 }}>
                          <button
                            onClick={() => pushProjectToCloud(currentProjectId)}
                            style={{ flex: 1, border: "1px solid #C9C2B2", borderRadius: 5, background: "transparent", color: "#3E3A33", fontSize: 11, padding: "5px 0", cursor: "pointer" }}
                          >
                            同期する
                          </button>
                          <button
                            onClick={() => unshareProject(currentProjectId)}
                            style={{ border: "none", background: "transparent", color: "#B0483C", fontSize: 10.5, padding: "5px 8px", cursor: "pointer" }}
                          >
                            サーバーに置かない
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => pushProjectToCloud(currentProjectId)}
                        style={{ width: "100%", border: "none", borderRadius: 5, background: "#4C7A4C", color: "#FFFDF6", fontSize: 11, fontWeight: 700, padding: "6px 0", cursor: "pointer", marginBottom: 6 }}
                      >
                        サーバーに保存する
                      </button>
                    )}

                    {cloudNewer && (
                      <div style={{ background: "#FFF3D6", borderRadius: 5, padding: "6px 8px", marginBottom: 6 }}>
                        <div style={{ fontSize: 10.5, color: "#8A6A1F", lineHeight: 1.6, marginBottom: 4 }}>
                          「{cloudNewer.device}」とこの端末の両方で変更されています。どちらを残しますか？
                        </div>
                        <div style={{ display: "flex", gap: 5 }}>
                          <button
                            onClick={() => pullProjectFromCloud(currentProjectId)}
                            style={{ flex: 1, border: "none", borderRadius: 5, background: "#8A6A1F", color: "#FFFDF6", fontSize: 10.5, fontWeight: 700, padding: "5px 0", cursor: "pointer" }}
                          >
                            サーバーの方
                          </button>
                          <button
                            onClick={() => keepLocalVersion(currentProjectId)}
                            style={{ flex: 1, border: "1px solid #8A6A1F", borderRadius: 5, background: "transparent", color: "#8A6A1F", fontSize: 10.5, fontWeight: 700, padding: "5px 0", cursor: "pointer" }}
                          >
                            この端末の方
                          </button>
                        </div>
                      </div>
                    )}

                    {cloudProjects.filter((x) => !allMetas.some((m) => m.id === x.id)).length > 0 && (
                      <>
                        <div style={{ fontSize: 10, color: "#9C9587", marginBottom: 3 }}>
                          サーバーにある、まだ開いていないプロジェクト
                        </div>
                        {cloudProjects.filter((x) => !allMetas.some((m) => m.id === x.id)).map((x) => (
                          <button
                            key={x.id}
                            onClick={() => pullProjectFromCloud(x.id)}
                            style={{
                              display: "block", width: "100%", textAlign: "left", border: "1px dashed #C9C2B2",
                              borderRadius: 5, background: "#fff", color: "#3E3A33",
                              fontSize: 11, padding: "4px 8px", cursor: "pointer", marginBottom: 3,
                            }}
                          >
                            {x.name}
                            <span style={{ fontSize: 9.5, color: "#9C9587", marginLeft: 5 }}>
                              {x.device} / {new Date(x.savedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </button>
                        ))}
                      </>
                    )}
                    {cloudProjMsg && (
                      <div style={{ fontSize: 10.5, color: "#6B665C", marginTop: 4 }}>{cloudProjMsg}</div>
                    )}
                  </div>
                )}

                {/* スマホでコピーした内容を貼り付けて取り込む */}
                <div style={{ borderTop: "1px solid #E4DFD2", marginTop: 10, paddingTop: 10 }}>
                  {!pasteOpen ? (
                    <button
                      onClick={() => setPasteOpen(true)}
                      style={{ width: "100%", border: "1px solid #C9C2B2", borderRadius: 6, background: "transparent", color: "#3E3A33", fontSize: 11, padding: "6px 0", cursor: "pointer" }}
                    >
                      貼り付けて取り込む
                    </button>
                  ) : (
                    <>
                      <div style={{ fontSize: 10.5, color: "#9C9587", marginBottom: 4, lineHeight: 1.6 }}>
                        スマホの「ためた分」→「データでコピー」を押し、ここに貼り付けてください。
                      </div>
                      <textarea
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        placeholder="ここに貼り付け"
                        rows={3}
                        style={{
                          width: "100%", boxSizing: "border-box", border: "1px solid #C9C2B2", borderRadius: 5,
                          fontSize: 11, padding: "6px 8px", fontFamily: "inherit", color: "#3E3A33",
                          background: "#fff", resize: "none", marginBottom: 6,
                        }}
                      />
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => { setPasteOpen(false); setPasteText(""); }}
                          style={{ flex: 1, border: "1px solid #C9C2B2", borderRadius: 5, background: "transparent", color: "#6B665C", fontSize: 11, padding: "5px 0", cursor: "pointer" }}
                        >
                          やめる
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              const t = await navigator.clipboard.readText();
                              if (t) setPasteText(t);
                            } catch (e) { /* 読めない環境もある */ }
                          }}
                          style={{ flex: 1, border: "1px solid #C9C2B2", borderRadius: 5, background: "transparent", color: "#3E3A33", fontSize: 11, padding: "5px 0", cursor: "pointer" }}
                        >
                          貼り付け
                        </button>
                        <button
                          onClick={importPasted}
                          style={{ flex: 1, border: "none", borderRadius: 5, background: "#4C7A4C", color: "#FFFDF6", fontSize: 11, fontWeight: 700, padding: "5px 0", cursor: "pointer" }}
                        >
                          取り込む
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
        </div>
        <button
          title="使い方"
          onClick={() => setHelpOpen(true)}
          style={{ background: "transparent", border: "1px solid #8A857B", color: "#D8D3C8", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
        >
          使い方
        </button>
        <button
          title="設定"
          onClick={() => setSettingsOpen(true)}
          style={{ background: "transparent", border: "1px solid #8A857B", color: "#D8D3C8", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}
        >
          設定
        </button>
        <button
          onClick={() => setExportOpen(true)}
          title="付箋の文章をテキストにまとめる"
          style={{ background: "transparent", border: "1px solid #8A857B", color: "#D8D3C8", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
        >
          書き出す
        </button>
        <button
          onClick={clearAll}
          title="このボードの付箋・線・文字・領域・手書き・画像をすべて消す"
          style={{ background: "transparent", border: "1px solid #8A857B", color: "#D8D3C8", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
        >
          空にする
        </button>
      </div>

      {/* ボードタブ */}
      <div className="board-tabs" style={{ display: "flex", alignItems: "flex-end", gap: 4, padding: "5px 12px 0", background: "#4A463E", overflowX: "auto", zIndex: 99999, flexShrink: 0 }}>
        {boards.map((b) => {
          const active = b.id === currentId;
          return (
            <div
              key={b.id}
              onClick={() => !active && switchBoard(b.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: active ? "5px 10px" : "4px 12px",
                background: active ? "#F6F2E9" : "#5C574D",
                color: active ? "#3E3A33" : "#CFC9BD",
                borderRadius: "8px 8px 0 0",
                cursor: active ? "default" : "pointer",
                whiteSpace: "nowrap", fontSize: 13,
                flexShrink: 0,
              }}
            >
              {active ? (
                <>
                  <input
                    value={b.title}
                    onChange={(e) => updateBoard((bb) => ({ ...bb, title: e.target.value }))}
                    placeholder="ボード名"
                    style={{
                      border: "none", background: "transparent", fontWeight: 700,
                      fontSize: 13, fontFamily: "inherit", color: "#3E3A33",
                      width: Math.max(4, b.title.length) + "em", maxWidth: 180, minWidth: 60,
                    }}
                  />
                  <button
                    title="このボードを削除"
                    onClick={removeBoard}
                    style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 12, padding: 0, color: "#8A857B" }}
                  >
                    ✕
                  </button>
                </>
              ) : (
                <span>{b.title || "（無題）"}</span>
              )}
            </div>
          );
        })}
        <button
          title="新しいボードを作る"
          onClick={addBoard}
          style={{
            border: "none", background: "transparent", color: "#CFC9BD",
            fontSize: 16, fontWeight: 700, cursor: "pointer", padding: "3px 10px", flexShrink: 0,
          }}
        >
          ＋
        </button>
      </div>

      {/* リストとボードを横並びに表示 */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

      {/* 付箋リスト（サイドパネル） */}
      {listOpen && (() => {
        const targetBoards = listScope === "project" ? boards : boards.filter((b) => b.id === currentId);
        const q = listQuery.trim().toLowerCase();
        const rows = [];
        for (const b of targetBoards) {
          const bMap = Object.fromEntries((b.notes || []).map((n) => [n.id, n]));
          for (const n of b.notes || []) {
            const head = headingOf(n);
            if (listTag && !(n.tags || []).includes(listTag)) continue;
            if (q && !(
              head.toLowerCase().includes(q) ||
              (n.text || "").toLowerCase().includes(q) ||
              (n.tags || []).some((t) => t.toLowerCase().includes(q)) ||
              `#${n.num}` === q || String(n.num) === q
            )) continue;
            rows.push({
              n, board: b, head,
              parent: n.parentId ? bMap[n.parentId] : null,
              zone: zoneOfIn(b, n), // どの領域の中にあるか
            });
          }
        }
        rows.sort((a, x) => a.n.num - x.n.num);
        // 絞り込み用のタグ候補
        const tagSet = new Set();
        for (const b of targetBoards) for (const n of b.notes || []) for (const t of n.tags || []) tagSet.add(t);
        const tagList = [...tagSet].sort((a, b) => a.localeCompare(b, "ja"));

        return (
          <div
            style={{
              width: 290, flexShrink: 0, background: "#EFEADF",
              borderRight: "1px solid #D9D2C2",
              display: "flex", flexDirection: "column", minHeight: 0,
            }}
          >
            {/* 検索 */}
            <div style={{ padding: "8px 10px 6px", borderBottom: "1px solid #D9D2C2" }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <input
                  value={listQuery}
                  placeholder="タイトル・本文・タグで検索"
                  onChange={(e) => setListQuery(e.target.value)}
                  style={{
                    flex: 1, minWidth: 0, border: "1px solid #C9C2B2", borderRadius: 5,
                    fontSize: 12, padding: "4px 7px", fontFamily: "inherit",
                    color: "#3E3A33", background: "#fff",
                  }}
                />
                <button
                  title="リストを閉じる"
                  onClick={() => setListOpen(false)}
                  style={{ border: "none", background: "transparent", cursor: "pointer", color: "#8A857B", fontSize: 14, padding: "0 2px" }}
                >
                  ✕
                </button>
              </div>
              <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid #C9C2B2" }}>
                <button
                  onClick={() => setListScope("board")}
                  style={{
                    flex: 1, border: "none", padding: "3px 0", fontSize: 11, cursor: "pointer",
                    background: listScope === "board" ? "#3E3A33" : "transparent",
                    color: listScope === "board" ? "#F6F2E9" : "#6B665C",
                    fontWeight: listScope === "board" ? 700 : 400,
                  }}
                >
                  このボード
                </button>
                <button
                  onClick={() => setListScope("project")}
                  style={{
                    flex: 1, border: "none", padding: "3px 0", fontSize: 11, cursor: "pointer",
                    background: listScope === "project" ? "#3E3A33" : "transparent",
                    color: listScope === "project" ? "#F6F2E9" : "#6B665C",
                    fontWeight: listScope === "project" ? 700 : 400,
                  }}
                >
                  全ボード
                </button>
              </div>
            </div>

            {/* タグ絞り込み */}
            {tagList.length > 0 && (
              <div style={{ padding: "6px 10px", borderBottom: "1px solid #D9D2C2", display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 92, overflowY: "auto" }}>
                {tagList.map((t) => {
                  const on = listTag === t;
                  const tc = tagColorOf(t);
                  return (
                    <button
                      key={t}
                      onClick={() => setListTag(on ? null : t)}
                      style={{
                        border: "none", borderRadius: 8, cursor: "pointer",
                        fontSize: 10, fontWeight: 700, padding: "1px 7px",
                        background: on ? tc : tint(tc, 0.15), color: on ? "#FFFDF6" : tc,
                      }}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            )}

            {/* 選んだものへの操作 */}
            {listPicked.length > 0 && (
              <div style={{ padding: "8px 10px", background: "rgba(61,111,180,.1)", borderBottom: "1px solid #D9D2C2" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#3E3A33", marginBottom: 6 }}>
                  {listPicked.length}枚を選択中
                </div>
                {!listActionOpen ? (
                  <div style={{ display: "flex", gap: 5 }}>
                    <button
                      onClick={() => setListActionOpen("copy")}
                      style={{ flex: 1, border: "1px solid #C9C2B2", borderRadius: 5, background: "#fff", color: "#3E3A33", fontSize: 11, padding: "5px 0", cursor: "pointer" }}
                    >
                      複製
                    </button>
                    <button
                      onClick={() => setListActionOpen("move")}
                      style={{ flex: 1, border: "1px solid #C9C2B2", borderRadius: 5, background: "#fff", color: "#3E3A33", fontSize: 11, padding: "5px 0", cursor: "pointer" }}
                    >
                      移動
                    </button>
                    <button
                      onClick={listDelete}
                      style={{ flex: 1, border: "1px solid #C6392B", borderRadius: 5, background: "#fff", color: "#C6392B", fontSize: 11, fontWeight: 700, padding: "5px 0", cursor: "pointer" }}
                    >
                      剥がす
                    </button>
                    <button
                      onClick={() => setListPicked([])}
                      style={{ border: "none", background: "transparent", color: "#6B665C", fontSize: 11, padding: "5px 6px", cursor: "pointer" }}
                    >
                      解除
                    </button>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 10.5, color: "#6B665C", marginBottom: 4 }}>
                      {listActionOpen === "copy" ? "複製先" : "移動先"}のボードを選んでください
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 130, overflowY: "auto" }}>
                      {boards.map((b) => (
                        <button
                          key={b.id}
                          onClick={() => (listActionOpen === "copy" ? listCopyTo(b.id) : listMoveTo(b.id))}
                          disabled={listActionOpen === "move" && b.id === currentId}
                          style={{
                            textAlign: "left", border: "1px solid #C9C2B2", borderRadius: 5,
                            background: listActionOpen === "move" && b.id === currentId ? "rgba(62,58,51,.06)" : "#fff",
                            color: listActionOpen === "move" && b.id === currentId ? "#9C9587" : "#3E3A33",
                            fontSize: 11, padding: "5px 8px",
                            cursor: listActionOpen === "move" && b.id === currentId ? "default" : "pointer",
                          }}
                        >
                          📄 {b.title || "（無題）"}
                          {b.id === currentId && "（今のボード）"}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setListActionOpen(null)}
                      style={{ width: "100%", border: "none", background: "transparent", color: "#6B665C", fontSize: 11, padding: "6px 0 0", cursor: "pointer" }}
                    >
                      やめる
                    </button>
                  </>
                )}
              </div>
            )}

            {/* 件数 */}
            <div style={{ padding: "5px 10px", fontSize: 11, color: "#8A857B", display: "flex", alignItems: "center" }}>
              <span>{rows.length}件</span>
              {(listQuery || listTag) && (
                <button
                  onClick={() => { setListQuery(""); setListTag(null); }}
                  style={{ marginLeft: "auto", border: "none", background: "transparent", color: "#8A857B", fontSize: 11, cursor: "pointer", padding: 0 }}
                >
                  絞り込みを解除
                </button>
              )}
            </div>

            {/* 一覧 */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
              {rows.length === 0 && (
                <span style={{ fontSize: 12, color: "#9C9587", padding: "8px 4px" }}>該当する付箋がありません</span>
              )}
              {rows.map(({ n, board: b, head, parent, zone }) => {
                const c = COLORS[n.color] || COLORS[0];
                const otherBoard = b.id !== currentId;
                const canPick = !otherBoard; // 今のボードの付箋だけまとめて操作できる
                const isPicked = listPicked.includes(n.id);
                return (
                  <div
                    key={n.id}
                    style={{
                      display: "flex", alignItems: "flex-start", gap: 6,
                      background: isPicked ? "rgba(61,111,180,.12)" : "#FFFDF6",
                      borderLeft: `5px solid ${c.edge}`,
                      borderRadius: "4px 6px 6px 4px", padding: "5px 8px",
                      boxShadow: "0 1px 3px rgba(60,50,30,.12)",
                    }}
                  >
                    {canPick && (
                      <input
                        type="checkbox"
                        checked={isPicked}
                        onChange={() =>
                          setListPicked((ps) => (ps.includes(n.id) ? ps.filter((x) => x !== n.id) : [...ps, n.id]))
                        }
                        style={{ width: 15, height: 15, flexShrink: 0, marginTop: 2, cursor: "pointer" }}
                      />
                    )}
                    <button
                      title={otherBoard ? `「${b.title}」の付箋を開く` : "この付箋へ移動"}
                      onClick={() => {
                        if (otherBoard) {
                          switchBoard(b.id);
                          setPendingJump(n.id);
                        } else {
                          jumpTo(n.id);
                        }
                      }}
                      style={{
                        flex: 1, minWidth: 0, textAlign: "left", border: "none",
                        background: "transparent", cursor: "pointer", padding: 0,
                      }}
                    >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(62,58,51,.55)", flexShrink: 0 }}>#{n.num}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: "#3E3A33", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {head || "（無題）"}
                      </span>
                    </div>
                    {(n.tags || []).length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 3 }}>
                        {(n.tags || []).slice(0, 4).map((t) => (
                          <span key={t} style={{ fontSize: 9.5, fontWeight: 700, borderRadius: 7, padding: "0 6px", background: tint(tagColorOf(t), 0.18), color: tagColorOf(t) }}>
                            {t}
                          </span>
                        ))}
                        {(n.tags || []).length > 4 && (
                          <span style={{ fontSize: 9.5, color: "#8A857B" }}>+{(n.tags || []).length - 4}</span>
                        )}
                      </div>
                    )}
                    {(parent || otherBoard || zone) && (
                      <div style={{ fontSize: 9.5, color: "#9C9587", marginTop: 3, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                        {otherBoard && <span>📄 {b.title || "無題"}</span>}
                        {zone && (
                          <span
                            title="この領域の中にあります"
                            style={{ borderRadius: 4, padding: "0 6px", background: tint(zone.color, 0.25), color: "#5A554B", fontWeight: 700 }}
                          >
                            ▭ {zone.label || "領域"}
                          </span>
                        )}
                        {parent && <span>#{parent.num} の中</span>}
                      </div>
                    )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ボード（広いキャンバスをスクロール＆ズームして使う） */}
      <div ref={scrollerRef} style={{ flex: 1, overflow: "auto", position: "relative" }}>
        <div style={{ width: CANVAS_W * zoom, height: CANVAS_H * zoom }}>
        <div
          ref={contentRef}
          onPointerDown={onBoardPointerDown}
          onPointerMove={onBoardPointerMove}
          onPointerUp={onBoardPointerUp}
          onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); }}
          onDrop={(e) => {
            if (!e.dataTransfer?.files?.length) return;
            e.preventDefault();
            const rect = contentRef.current.getBoundingClientRect();
            const zf = zoom || 1;
            addImageFiles(e.dataTransfer.files, { x: (e.clientX - rect.left) / zf - 120, y: (e.clientY - rect.top) / zf - 80 });
          }}
          onDoubleClick={(e) => {
            if (e.target !== contentRef.current) return;
            const rect = contentRef.current.getBoundingClientRect();
            const zf = zoom || 1;
            addNote((e.clientX - rect.left) / zf - 95, (e.clientY - rect.top) / zf - 40, null);
          }}
          style={{
            position: "relative",
            width: CANVAS_W, height: CANVAS_H,
            transform: `scale(${zoom})`,
            transformOrigin: "0 0",
            backgroundImage: gridMode
              ? `linear-gradient(#E2DBCB 1px, transparent 1px), linear-gradient(90deg, #E2DBCB 1px, transparent 1px)`
              : "radial-gradient(#D9D2C2 1.2px, transparent 1.2px)",
            backgroundSize: `${GRID}px ${GRID}px`,
            cursor: connectFrom ? "crosshair" : "default",
          }}
        >
          {/* 領域（背景色オブジェクト・付箋の下に敷かれる） */}
          {zones.map((zn) => (
            <div
              key={zn.id}
              style={{
                position: "absolute", left: zn.x, top: zn.y, width: zn.w, height: zn.h,
                background: tint(zn.color, 0.13),
                border: `2px solid ${tint(zn.color, 0.55)}`,
                borderRadius: 10,
                // 色メニューを開いている間だけ前面に出す（付箋の下に隠れないように）
                zIndex: zoneColorMenuFor === zn.id ? 100003 : 0,
                pointerEvents: "none", // 領域の中でも付箋追加や範囲選択ができるように
              }}
            >
              {/* 名前バー（ここだけ操作可能） */}
              <div
                style={{
                  position: "absolute", top: -2, left: -2,
                  display: "flex", alignItems: "center", gap: 4,
                  background: zn.color, borderRadius: "8px 0 8px 0",
                  padding: "2px 6px", pointerEvents: "auto", maxWidth: "90%",
                }}
              >
                <span
                  title="ドラッグで領域を移動"
                  onPointerDown={(e) => onZoneDragDown(e, zn)}
                  onPointerMove={onZoneDragMove}
                  onPointerUp={onZoneDragUp}
                  style={{ cursor: "grab", touchAction: "none", userSelect: "none", fontSize: 11, color: "#3E3A33", fontWeight: 700 }}
                >
                  ⠿
                </span>
                <input
                  value={zn.label || ""}
                  placeholder="領域名"
                  onChange={(e) => updateZone(zn.id, { label: e.target.value })}
                  style={{
                    border: "none", background: "transparent", fontFamily: "inherit",
                    fontSize: 12, fontWeight: 700, color: "#3E3A33",
                    width: Math.max(4, (zn.label || "").length + 1) + "em", maxWidth: 200, minWidth: 48,
                  }}
                />
                <button
                  data-zonemenu
                  title="領域の色を変える"
                  onClick={() => setZoneColorMenuFor(zoneColorMenuFor === zn.id ? null : zn.id)}
                  style={{ width: 13, height: 13, borderRadius: "50%", border: "1.5px solid rgba(62,58,51,.5)", background: "#FFFDF6", cursor: "pointer", padding: 0, flexShrink: 0 }}
                />
                <button
                  title="この領域を消す（付箋は残ります）"
                  onClick={() => removeZone(zn.id)}
                  style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 12, padding: 0, color: "#3E3A33" }}
                >
                  ✕
                </button>
                {zoneColorMenuFor === zn.id && (
                  <div
                    data-zonemenu
                    style={{
                      position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 100001,
                      background: "#FFFDF6", borderRadius: 8,
                      boxShadow: "0 5px 16px rgba(40,35,20,.3)",
                      padding: "6px 8px", display: "flex", gap: 6,
                    }}
                  >
                    {COLORS.map((col) => (
                      <button
                        key={col.name}
                        title={col.name}
                        onClick={() => { updateZone(zn.id, { color: col.edge }); setZoneColorMenuFor(null); }}
                        style={{
                          width: 18, height: 18, borderRadius: "50%",
                          border: zn.color === col.edge ? "2.5px solid #3E3A33" : "1px solid rgba(0,0,0,.2)",
                          background: col.edge, cursor: "pointer", padding: 0,
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
              {/* リサイズハンドル */}
              <div
                title="ドラッグで領域の大きさを変える"
                onPointerDown={(e) => onZoneResizeDown(e, zn)}
                onPointerMove={onZoneResizeMove}
                onPointerUp={onZoneResizeUp}
                style={{
                  position: "absolute", right: -2, bottom: -2,
                  width: 16, height: 16, pointerEvents: "auto",
                  cursor: "nwse-resize", touchAction: "none",
                  background: `linear-gradient(135deg, transparent 50%, ${zn.color} 50%)`,
                  borderRadius: "0 0 8px 0",
                }}
              />
            </div>
          ))}

          {/* 画像（領域の上・付箋の下） */}
          {images.map((im, imgIdx) => (
            <div
              key={im.id}
              className="bimg"
              onPointerDown={(e) => onImgDragDown(e, im)}
              onPointerMove={onImgDragMove}
              onPointerUp={onImgDragUp}
              style={{
                position: "absolute", left: im.x, top: im.y, width: im.w, height: im.h,
                zIndex: 1 + imgIdx, cursor: "grab", touchAction: "none",
                borderRadius: 4, overflow: "visible",
                boxShadow: "2px 4px 10px rgba(60,50,30,.25)",
              }}
            >
              <img
                src={im.src}
                alt=""
                draggable={false}
                style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 4, background: "#fff", display: "block", pointerEvents: "none" }}
              />
              <button
                className="bimg-del"
                title="この画像を消す"
                onClick={(e) => { e.stopPropagation(); removeImage(im.id); }}
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  position: "absolute", top: -9, right: -9,
                  width: 20, height: 20, borderRadius: "50%",
                  border: "none", background: "#B0483C", color: "#FFFDF6",
                  fontSize: 11, cursor: "pointer", padding: 0, lineHeight: "20px",
                }}
              >
                ✕
              </button>
              <div
                className="bimg-rs"
                title="ドラッグで大きさを変える（縦横比を保ちます）"
                onPointerDown={(e) => onImgResizeDown(e, im)}
                onPointerMove={onImgResizeMove}
                onPointerUp={onImgResizeUp}
                style={{
                  position: "absolute", right: -4, bottom: -4,
                  width: 18, height: 18, cursor: "nwse-resize", touchAction: "none",
                  background: "#3E3A33", borderRadius: "50%",
                  border: "2px solid #FFFDF6",
                }}
              />
            </div>
          ))}

          <svg width={CANVAS_W} height={CANVAS_H} style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 99998, overflow: "visible" }}>
            {renderEdges()}
          </svg>

          {selBox && (
            <div
              style={{
                position: "absolute",
                left: Math.min(selBox.x1, selBox.x2),
                top: Math.min(selBox.y1, selBox.y2),
                width: Math.abs(selBox.x2 - selBox.x1),
                height: Math.abs(selBox.y2 - selBox.y1),
                border: `1.5px dashed ${zoneMode ? "#4C7A4C" : "#3D6FB4"}`,
                background: zoneMode ? "rgba(76,122,76,.10)" : "rgba(61,111,180,.08)",
                borderRadius: zoneMode ? 10 : 0,
                zIndex: 99997,
                pointerEvents: "none",
              }}
            />
          )}

          {(byParent["root"] || []).map((n) => renderNote(n, 0))}

          {/* 手書きレイヤー */}
          {showStrokes && (
            <svg
              width={CANVAS_W}
              height={CANVAS_H}
              style={{ position: "absolute", inset: 0, zIndex: 110000, pointerEvents: "none" }}
            >
              {strokes.map((st) => (
                <path
                  key={st.id}
                  d={strokePath(st.pts)}
                  stroke={st.color}
                  strokeWidth={st.width}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {liveStroke && (
                <path
                  d={strokePath(liveStroke.pts)}
                  stroke={liveStroke.color}
                  strokeWidth={liveStroke.width}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.9"
                />
              )}
            </svg>
          )}

          {/* 手書きモード中の入力面（付箋の操作を止めて描画に専念する） */}
          {drawMode && (
            <div
              onPointerDown={onBoardPointerDown}
              onPointerMove={onBoardPointerMove}
              onPointerUp={onBoardPointerUp}
              style={{
                position: "absolute", inset: 0,
                width: CANVAS_W, height: CANVAS_H,
                zIndex: 115000,
                touchAction: penFingerDraw ? "none" : "pan-x pan-y",
                cursor: eraseMode ? "cell" : "crosshair",
              }}
            />
          )}

          {/* 線のメモ編集 */}
          {edgeMenu && (() => {
            const ed = edges.find((e) => e.id === edgeMenu.id);
            if (!ed) return null;
            return (
              <div
                data-edgemenu
                style={{
                  position: "absolute", left: edgeMenu.x, top: edgeMenu.y,
                  transform: "translate(-50%, -50%)", zIndex: 120000,
                  background: "#FFFDF6", borderRadius: 8,
                  boxShadow: "0 5px 16px rgba(40,35,20,.35)",
                  padding: 8, width: 210,
                }}
              >
                <input
                  autoFocus
                  value={ed.memo || ""}
                  placeholder="線にメモを書く"
                  onChange={(e) =>
                    setEdges((es) => es.map((x) => (x.id === ed.id ? { ...x, memo: e.target.value } : x)))
                  }
                  onKeyDown={(e) => { if (e.key === "Enter") setEdgeMenu(null); }}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    border: "1px solid #C9C2B2", borderRadius: 5,
                    fontSize: 12, padding: "4px 7px", fontFamily: "inherit",
                    color: "#3E3A33", background: "#fff", marginBottom: 6,
                  }}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => setEdgeMenu(null)}
                    style={{ flex: 1, border: "none", borderRadius: 5, background: "#3E3A33", color: "#F6F2E9", fontSize: 11, fontWeight: 700, padding: "4px 0", cursor: "pointer" }}
                  >
                    完了
                  </button>
                  <button
                    onClick={() => { removeEdge(ed.id); setEdgeMenu(null); }}
                    style={{ flex: 1, border: "none", borderRadius: 5, background: "#B0483C", color: "#FFFDF6", fontSize: 11, fontWeight: 700, padding: "4px 0", cursor: "pointer" }}
                  >
                    線を外す
                  </button>
                </div>
              </div>
            );
          })()}

          {/* ボード直書きの文字 */}
          {texts.map((t) => {
            const fs = TEXT_SIZES[t.size ?? 1] || TEXT_SIZES[1];
            const lines = (t.text || "").split("\n");
            const wCh = Math.max(4, ...lines.map((l) => l.length)) + 2;
            return (
              <div
                key={t.id}
                className="btext"
                style={{
                  position: "absolute", left: t.x, top: t.y, zIndex: t.z || 1,
                  outline: selectedTextIds.includes(t.id) ? "3px solid #3D6FB4" : "none",
                  outlineOffset: 2, borderRadius: 4,
                }}
              >
                <div
                  className="btext-tools"
                  style={{ position: "absolute", top: -22, left: 0, display: "flex", gap: 4, alignItems: "center" }}
                >
                  <span
                    title="ドラッグで移動"
                    onPointerDown={(e) => onTextDragDown(e, t)}
                    onPointerMove={onTextDragMove}
                    onPointerUp={onTextDragUp}
                    style={{
                      cursor: "grab", touchAction: "none", userSelect: "none",
                      background: "rgba(62,58,51,.85)", color: "#F6F2E9",
                      borderRadius: 4, fontSize: 11, padding: "1px 6px", lineHeight: 1.4,
                    }}
                  >
                    ⠿
                  </span>
                  <button
                    title="文字サイズを変える"
                    onClick={() => updateText(t.id, { size: ((t.size ?? 1) + 1) % TEXT_SIZES.length })}
                    style={{
                      border: "none", background: "rgba(62,58,51,.85)", color: "#F6F2E9",
                      borderRadius: 4, fontSize: 11, padding: "1px 6px", cursor: "pointer", lineHeight: 1.4,
                    }}
                  >
                    A{(t.size ?? 1) + 1}
                  </button>
                  <button
                    title="この文字を消す"
                    onClick={() => removeText(t.id)}
                    style={{
                      border: "none", background: "rgba(176,72,60,.9)", color: "#FFFDF6",
                      borderRadius: 4, fontSize: 11, padding: "1px 6px", cursor: "pointer", lineHeight: 1.4,
                    }}
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  value={t.text}
                  rows={Math.max(1, lines.length)}
                  placeholder="文字を入力"
                  onChange={(e) => updateText(t.id, { text: e.target.value })}
                  style={{
                    display: "block",
                    fontSize: fs, lineHeight: 1.5,
                    width: `${wCh}em`, maxWidth: 640,
                    background: "transparent", resize: "none",
                    fontFamily: "inherit", fontWeight: 700, color: "#3E3A33",
                    padding: "1px 4px", boxSizing: "content-box",
                  }}
                />
              </div>
            );
          })}

          {loaded && notes.length === 0 && (
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "60vh", display: "grid", placeItems: "center", pointerEvents: "none" }}>
              <p style={{ color: "#9C9587", fontSize: 15 }}>
                ダブルクリック、または「＋ 付箋を貼る」で最初の付箋を貼りましょう
              </p>
            </div>
          )}
        </div>
        </div>
      </div>

      </div>

      {/* 手書きツールバー */}
      {drawMode && (
        <div
          style={{
            position: "fixed", left: "50%", bottom: 18, transform: "translateX(-50%)",
            zIndex: 150000, background: "#3E3A33", color: "#F6F2E9",
            borderRadius: 10, boxShadow: "0 6px 18px rgba(30,25,15,.4)",
            display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", flexWrap: "wrap",
            maxWidth: "94vw",
          }}
        >
          {/* 色 */}
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              title="ペンの色"
              onClick={() => { setPenColor(c); setEraseMode(false); }}
              style={{
                width: 22, height: 22, borderRadius: "50%", background: c, cursor: "pointer", padding: 0,
                border: !eraseMode && penColor === c ? "3px solid #F6F2E9" : "1px solid rgba(255,255,255,.35)",
              }}
            />
          ))}
          <div style={{ width: 1, height: 20, background: "#6B665C" }} />
          {/* 太さ */}
          {PEN_WIDTHS.map((w, i) => (
            <button
              key={w}
              title={["細", "中", "太"][i]}
              onClick={() => { setPenWidth(w); setEraseMode(false); }}
              style={{
                width: 26, height: 22, borderRadius: 5, cursor: "pointer",
                border: "none", background: !eraseMode && penWidth === w ? "#F6F2E9" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <span style={{ display: "block", width: 16, height: w, borderRadius: w, background: !eraseMode && penWidth === w ? "#3E3A33" : "#D8D3C8" }} />
            </button>
          ))}
          <div style={{ width: 1, height: 20, background: "#6B665C" }} />
          <button
            title="消しゴム"
            onClick={() => setEraseMode((m) => !m)}
            style={{
              border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "4px 10px",
              background: eraseMode ? "#F6F2E9" : "transparent", color: eraseMode ? "#3E3A33" : "#D8D3C8",
            }}
          >
            消しゴム
          </button>
          {eraseMode && (
            <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid #8A857B" }}>
              <button
                title="なぞった部分だけを消す"
                onClick={() => setEraseKind("part")}
                style={{
                  border: "none", padding: "3px 8px", fontSize: 11, cursor: "pointer",
                  background: eraseKind === "part" ? "#F6F2E9" : "transparent",
                  color: eraseKind === "part" ? "#3E3A33" : "#D8D3C8",
                  fontWeight: eraseKind === "part" ? 700 : 400,
                }}
              >
                部分
              </button>
              <button
                title="触れた線をまるごと消す"
                onClick={() => setEraseKind("whole")}
                style={{
                  border: "none", padding: "3px 8px", fontSize: 11, cursor: "pointer",
                  background: eraseKind === "whole" ? "#F6F2E9" : "transparent",
                  color: eraseKind === "whole" ? "#3E3A33" : "#D8D3C8",
                  fontWeight: eraseKind === "whole" ? 700 : 400,
                }}
              >
                線ごと
              </button>
            </div>
          )}
          <button
            title="直前の線を取り消す"
            onClick={undoStroke}
            style={{ border: "none", borderRadius: 6, background: "transparent", color: "#D8D3C8", fontSize: 12, padding: "4px 8px", cursor: "pointer" }}
          >
            ↩︎
          </button>
          <button
            title="このボードの手書きをすべて消す"
            onClick={clearStrokes}
            style={{ border: "none", borderRadius: 6, background: "transparent", color: "#D8D3C8", fontSize: 12, padding: "4px 8px", cursor: "pointer" }}
          >
            全消し
          </button>
          <div style={{ width: 1, height: 20, background: "#6B665C" }} />
          <button
            title={penFingerDraw ? "指でも描く（タップでApple Pencilのみに切替）" : "Apple Pencilのみで描く（タップで指でも描く）"}
            onClick={() => setPenFingerDraw((v) => !v)}
            style={{ border: "1px solid #8A857B", borderRadius: 6, background: "transparent", color: "#D8D3C8", fontSize: 11, padding: "3px 8px", cursor: "pointer" }}
          >
            {penFingerDraw ? "指＋ペン" : "ペンのみ"}
          </button>
          <button
            onClick={() => { setDrawMode(false); setEraseMode(false); }}
            style={{ border: "none", borderRadius: 6, background: "#F6F2E9", color: "#3E3A33", fontSize: 12, fontWeight: 700, padding: "4px 12px", cursor: "pointer" }}
          >
            完了
          </button>
        </div>
      )}

      {/* 複数選択の操作バー（手書き中はツールバーが重なるため出さない） */}
      {!drawMode && selectedIds.length + selectedTextIds.length > 0 && (
        <div
          style={{
            position: "fixed", left: "50%", bottom: 18, transform: "translateX(-50%)",
            zIndex: 150000, background: "#3E3A33", color: "#F6F2E9",
            borderRadius: 10, boxShadow: "0 6px 18px rgba(30,25,15,.4)",
            display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700 }}>{selectedIds.length + selectedTextIds.length}個選択中</span>
          <button
            onClick={duplicateSelected}
            style={{ border: "none", borderRadius: 6, background: "#F6F2E9", color: "#3E3A33", fontSize: 12, fontWeight: 700, padding: "4px 10px", cursor: "pointer" }}
          >
            ⧉ 複製
          </button>
          <button
            onClick={() => setExportOpen(true)}
            style={{ border: "none", borderRadius: 6, background: "#F6F2E9", color: "#3E3A33", fontSize: 12, fontWeight: 700, padding: "4px 10px", cursor: "pointer" }}
          >
            📄 テキスト
          </button>
          <button
            onClick={deleteSelected}
            style={{ border: "none", borderRadius: 6, background: "#B0483C", color: "#FFFDF6", fontSize: 12, fontWeight: 700, padding: "4px 10px", cursor: "pointer" }}
          >
            ✕ 剥がす
          </button>
          <button
            onClick={() => { setSelectedIds([]); setSelectedTextIds([]); }}
            style={{ border: "1px solid #8A857B", borderRadius: 6, background: "transparent", color: "#D8D3C8", fontSize: 12, padding: "3px 10px", cursor: "pointer" }}
          >
            解除
          </button>
        </div>
      )}

      {/* 届いた付箋を確認して貼る */}
      {previewOpen && (() => {
        const all = cloudItems;
        return (
          <div
            onPointerDown={(e) => { if (e.target === e.currentTarget) setPreviewOpen(false); }}
            style={{ position: "fixed", inset: 0, zIndex: 200001, background: "rgba(40,35,25,.5)", display: "grid", placeItems: "center", padding: 16 }}
          >
            <div
              onPointerDown={(e) => e.stopPropagation()}
              style={{ background: "#FFFDF6", borderRadius: 10, width: "min(560px, 94vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 10px 30px rgba(30,25,15,.35)", color: "#3E3A33" }}
            >
              <div style={{ padding: "16px 20px 10px", borderBottom: "1px solid #E4DFD2" }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
                  <strong style={{ fontSize: 15, flex: 1 }}>届いた付箋</strong>
                  <button
                    onClick={() => setPreviewOpen(false)}
                    style={{ border: "none", background: "transparent", color: "#8A857B", fontSize: 16, cursor: "pointer", padding: 0 }}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11.5, color: "#9C9587", flex: 1 }}>
                    貼るものを選んでください（{previewPicked.length} / {all.length}）
                  </span>
                  <button
                    onClick={() => setPreviewPicked(previewPicked.length === all.length ? [] : all.map((x) => x._docId))}
                    style={{ border: "1px solid #C9C2B2", borderRadius: 14, background: "transparent", color: "#6B665C", fontSize: 11, padding: "3px 12px", cursor: "pointer" }}
                  >
                    {previewPicked.length === all.length ? "選択を解除" : "すべて選ぶ"}
                  </button>
                </div>
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px", display: "flex", flexDirection: "column", gap: 6 }}>
                {all.length === 0 && (
                  <p style={{ fontSize: 13, color: "#9C9587", textAlign: "center", padding: "24px 0" }}>
                    届いているものはありません
                  </p>
                )}
                {all.map((it) => {
                  const picked = previewPicked.includes(it._docId);
                  const ci = resolveColor(it);
                  const col = COLORS[ci] || COLORS[DEFAULT_COLOR];
                  const forOther = it.targetProjectId && it.targetProjectId !== currentProjectId;
                  return (
                    <label
                      key={it._docId}
                      style={{
                        display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer",
                        background: picked ? "#FFFDF6" : "rgba(62,58,51,.04)",
                        border: picked ? "1.5px solid #4C7A4C" : "1px solid #E4DFD2",
                        borderLeft: `5px solid ${col.edge}`,
                        borderRadius: 6, padding: "8px 10px",
                        opacity: picked ? 1 : 0.7,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={picked}
                        onChange={() =>
                          setPreviewPicked((ps) =>
                            ps.includes(it._docId) ? ps.filter((x) => x !== it._docId) : [...ps, it._docId]
                          )
                        }
                        style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0, cursor: "pointer" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {it.title && (
                          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2, overflowWrap: "anywhere" }}>{it.title}</div>
                        )}
                        <div style={{ fontSize: 12.5, lineHeight: 1.7, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "#3E3A33" }}>
                          {it.text || <span style={{ color: "#9C9587" }}>（本文なし）</span>}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5, alignItems: "center" }}>
                          {it.area && (
                            <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "1px 7px", background: tint(it.areaColor || "#C6C1B6", 0.3), color: "#5A554B" }}>
                              ▭ {it.area}
                            </span>
                          )}
                          {(it.tags || []).map((t) => (
                            <span key={t} style={{ fontSize: 10, fontWeight: 700, borderRadius: 7, padding: "1px 7px", background: tint(tagColorOf(t), 0.18), color: tagColorOf(t) }}>
                              {t}
                            </span>
                          ))}
                          {forOther && (
                            <span style={{ fontSize: 10, color: "#8A6A1F", background: "#FFF3D6", borderRadius: 4, padding: "1px 7px" }}>
                              「{it.targetProjectName || "別のプロジェクト"}」宛て
                            </span>
                          )}
                          {it.t && (
                            <span style={{ fontSize: 10, color: "#9C9587", marginLeft: "auto" }}>
                              {new Date(it.t).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div style={{ padding: "12px 20px 16px", borderTop: "1px solid #E4DFD2", display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  onClick={discardCloud}
                  disabled={previewPicked.length === 0}
                  style={{
                    border: "1px solid #C9C2B2", borderRadius: 6, background: "transparent",
                    color: previewPicked.length === 0 ? "#C9C2B2" : "#B0483C",
                    fontSize: 12, padding: "8px 14px", cursor: previewPicked.length === 0 ? "default" : "pointer",
                  }}
                >
                  貼らずに消す
                </button>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => setPreviewOpen(false)}
                  style={{ border: "1px solid #C9C2B2", borderRadius: 6, background: "transparent", color: "#3E3A33", fontSize: 13, padding: "8px 16px", cursor: "pointer" }}
                >
                  あとにする
                </button>
                <button
                  onClick={receiveCloud}
                  disabled={previewPicked.length === 0}
                  style={{
                    border: "none", borderRadius: 6,
                    background: previewPicked.length === 0 ? "#C9C2B2" : "#4C7A4C",
                    color: "#FFFDF6", fontSize: 13, fontWeight: 700, padding: "8px 20px",
                    cursor: previewPicked.length === 0 ? "default" : "pointer",
                  }}
                >
                  {previewPicked.length}件をこのボードに貼る
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 使い方 */}
      {helpOpen && (
        <div
          onPointerDown={(e) => { if (e.target === e.currentTarget) setHelpOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 200001, background: "rgba(40,35,25,.5)", display: "grid", placeItems: "center", padding: 16 }}
        >
          <div
            onPointerDown={(e) => e.stopPropagation()}
            style={{ background: "#FFFDF6", borderRadius: 10, width: "min(620px, 94vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 10px 30px rgba(30,25,15,.35)", color: "#3E3A33" }}
          >
            <div style={{ display: "flex", alignItems: "center", padding: "16px 20px 12px", borderBottom: "1px solid #E4DFD2" }}>
              <strong style={{ fontSize: 16, flex: 1 }}>使い方</strong>
              <span style={{ fontSize: 11, color: "#9C9587", marginRight: 12 }}>版 {APP_VERSION}</span>
              <button
                onClick={() => setHelpOpen(false)}
                style={{ border: "none", background: "#3E3A33", color: "#F6F2E9", borderRadius: 6, fontSize: 13, fontWeight: 700, padding: "7px 16px", cursor: "pointer" }}
              >
                閉じる
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 24px", fontSize: 13, lineHeight: 1.9 }}>
              <p style={{ margin: "0 0 18px", color: "#6B665C" }}>
                アイデアを付箋として貼り、つなぎ、まとまりを作りながら考えるための道具です。
                書いたものは自動で保存されるので、保存ボタンはありません。
              </p>

              {[
                {
                  t: "付箋を貼る・書く",
                  rows: [
                    ["貼る", "「＋ 追加」→「付箋」、または何もない場所をダブルクリック"],
                    ["動かす", "付箋の上のほう（ボタンのない余白）をドラッグ"],
                    ["大きさ", "右下の角をドラッグ"],
                    ["タイトル", "「T」ボタンで見出し欄を出せます。縮小したときここが表示されます"],
                    ["色", "左上の丸から。色の意味は設定にメモできます"],
                    ["消す", "✕ ボタン、または選んで Delete キー"],
                  ],
                },
                {
                  t: "整理する",
                  rows: [
                    ["つなぐ", "🔗 を押してから相手をクリック。線をクリックするとメモを書けます"],
                    ["中に入れる", "▸ を押すと付箋の中にボードが開きます（3段階まで）"],
                    ["囲む", "「＋ 追加」→「領域」でドラッグ。中の付箋ごと動かせます"],
                    ["タグ", "付箋下部の「＋タグ」から。色分けされ、あとで探しやすくなります"],
                    ["引用", "「❝引用」で他の付箋を検索して差し込めます。押すとそこへ飛べます"],
                  ],
                },
                {
                  t: "探す・見渡す",
                  rows: [
                    ["一覧", "左上の ☰ 。検索・タグで絞り込み、まとめて複製や移動もできます"],
                    ["拡大縮小", "ツールバーの −／＋、Ctrl＋ホイール"],
                    ["俯瞰", "縮小すると付箋が見出し表示に変わり、全体を見渡せます"],
                    ["タグで絞る", "「タグ一覧」から。選んだタグの付箋が浮かび上がります"],
                  ],
                },
                {
                  t: "まとめる・持ち出す",
                  rows: [
                    ["ボード", "下のタブで増やせます。用途ごとに分けられます"],
                    ["プロジェクト", "📁 から切り替え。ボードのまとまりです"],
                    ["文章にする", "「書き出す」でコピーまたはテキストfile保存"],
                    ["控えを取る", "📁 →「ファイルへ保存」。別のパソコンへ移すときにも使います"],
                    ["戻す", "📁 の「復元ポイント」から、少し前の状態に戻せます"],
                  ],
                },
                {
                  t: "他の機器と使う（任意）",
                  rows: [
                    ["用意", "「デバイス接続」→「かんたん設定をはじめる」。画面の案内どおりに進めます"],
                    ["スマホ", "外出先で書いたものが届きます。中身を見て、貼るものだけ選べます"],
                    ["別のパソコン", "同じボードを開けます。付箋の位置もそのままです"],
                  ],
                },
              ].map((sec) => (
                <div key={sec.t} style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, paddingBottom: 5, borderBottom: "2px solid #E4DFD2" }}>
                    {sec.t}
                  </div>
                  {sec.rows.map(([k, v]) => (
                    <div key={k} style={{ display: "flex", gap: 12, padding: "3px 0", alignItems: "baseline" }}>
                      <span style={{ width: 96, flexShrink: 0, fontSize: 12.5, fontWeight: 700, color: "#5A554B" }}>{k}</span>
                      <span style={{ flex: 1, fontSize: 12.5, color: "#3E3A33" }}>{v}</span>
                    </div>
                  ))}
                </div>
              ))}

              <div style={{ background: "rgba(62,58,51,.06)", borderRadius: 8, padding: "12px 14px", fontSize: 12.5, lineHeight: 1.9 }}>
                <b>困ったとき</b><br />
                ・画面が真っ白になった … 表示される案内から初期化できます（先に控えを取ってください）<br />
                ・動きが重い … 画像を減らすか、使っていないプロジェクトを整理してください<br />
                ・保存できないと出た … 📁 →「ファイルへ保存」で控えを取り、不要なものを消してください
              </div>
            </div>
          </div>
        </div>
      )}

      {/* かんたん設定（クラウドの用意） */}
      {setupOpen && (() => {
        const steps = [
          {
            t: "置き場所を作る",
            body: (
              <>
                <p style={{ margin: "0 0 10px" }}>
                  書いたものを預けておく場所を、Googleの無料サービス（Firebase）に用意します。
                  Googleアカウントがあれば、費用はかかりません。
                </p>
                <ol style={{ margin: "0 0 12px", paddingLeft: "1.3em" }}>
                  <li>下のボタンでFirebaseの画面を開く</li>
                  <li>「<b>プロジェクトを作成</b>」（または「プロジェクトを追加」）を押す</li>
                  <li>名前は何でもよい（例: ideaboard）</li>
                  <li>Googleアナリティクスは「<b>無効</b>」でよい</li>
                </ol>
                <button onClick={() => openLink("https://console.firebase.google.com/")} style={linkBtn}>
                  Firebaseの画面を開く
                </button>
              </>
            ),
          },
          {
            t: "データベースを作る",
            body: (
              <>
                <p style={{ margin: "0 0 10px" }}>作ったプロジェクトの中に、データの入れ物を作ります。</p>
                <ol style={{ margin: "0 0 12px", paddingLeft: "1.3em" }}>
                  <li>下のボタンで <b>Firestore</b> の画面を開く<br />
                    <span style={{ color: "#A23A2E" }}>※「Realtime Database」とは別のものです</span></li>
                  <li>「<b>データベースを作成</b>」を押す</li>
                  <li>場所（ロケーション）はそのままでよい</li>
                  <li>ルールの種類を聞かれたら「<b>本番環境モード</b>」を選ぶ<br />
                    <span style={{ color: "#9C9587", fontSize: 12 }}>あとの手順で設定し直すので、テストモードでも進められます</span></li>
                  <li>「作成」を押す</li>
                </ol>
                <button onClick={() => openLink(fbLink("firestore"))} style={linkBtn}>
                  Firestoreの画面を開く
                </button>
                <div style={{ fontSize: 11.5, color: "#9C9587", marginTop: 8, lineHeight: 1.7 }}>
                  ボタンで開けない場合は、左のメニューの「<b>Database と Storage</b>」を開き、
                  NoSQL のところにある「<b>Firestore</b>」を選んでください。
                </div>
              </>
            ),
          },
          {
            t: "使ってよいことを設定する",
            body: (
              <>
                <p style={{ margin: "0 0 10px" }}>
                  Firestoreの画面の上のほうにある「<b>ルール</b>」タブを開き、
                  <b>中身をすべて消してから</b>下の内容を貼り付けて「公開」を押してください。
                </p>
                <button onClick={() => openLink(fbLink("firestore/rules"))} style={{ ...linkBtn, marginBottom: 10 }}>
                  ルールの画面を開く
                </button>
                <pre style={{ background: "#F3EFE6", borderRadius: 6, padding: 10, fontSize: 10.5, lineHeight: 1.6, overflowX: "auto", margin: "0 0 8px" }}>
                  {FIRESTORE_RULES}
                </pre>
                <button
                  onClick={async () => {
                    const ok = await copyToClip(FIRESTORE_RULES);
                    setSetupMsg({ ok, step: "copy", message: ok ? "コピーしました。ルールの画面に貼り付けてください" : "コピーできませんでした" });
                  }}
                  style={linkBtn}
                >
                  この内容をコピーする
                </button>
              </>
            ),
          },
          {
            t: "ログインを許可する",
            body: (
              <>
                <p style={{ margin: "0 0 10px" }}>
                  アプリがデータベースを使えるように、名前を出さないログイン（匿名ログイン）を許可します。
                </p>
                <ol style={{ margin: "0 0 12px", paddingLeft: "1.3em" }}>
                  <li>下のボタンで <b>Authentication</b> の画面を開く</li>
                  <li>初めての場合は「<b>始める</b>」を押す</li>
                  <li>「<b>ログイン方法</b>」（Sign-in method）の一覧から「<b>匿名</b>」を選ぶ</li>
                  <li>スイッチを「<b>有効にする</b>」にして「保存」</li>
                </ol>
                <button onClick={() => openLink(fbLink("authentication/providers"))} style={linkBtn}>
                  ログイン方法の画面を開く
                </button>
                <div style={{ fontSize: 11.5, color: "#9C9587", marginTop: 8, lineHeight: 1.7 }}>
                  ボタンで開けない場合は、左のメニューの「<b>Authentication</b>」から入れます。
                </div>
              </>
            ),
          },
          {
            t: "アプリにつなぐ",
            body: (
              <>
                <p style={{ margin: "0 0 8px" }}>
                  「プロジェクトの設定」の<b>全般</b>を開き、次の2つを写してください。
                </p>
                <div style={{ background: "rgba(62,58,51,.06)", borderRadius: 6, padding: "9px 11px", marginBottom: 10, fontSize: 12.5, lineHeight: 1.8 }}>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>プロジェクトID</div>
                  <div style={{ color: "#6B665C", marginBottom: 8 }}>
                    画面の上のほう、「プロジェクト名」のすぐ下にあります（例: idea-board-c8568）。
                  </div>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>ウェブAPIキー</div>
                  <div style={{ color: "#6B665C" }}>
                    同じ画面を<b>下までスクロール</b>して「マイアプリ」へ。<br />
                    ・ウェブアプリがある場合 … それを選ぶと出る「SDK の設定と構成」の中の
                    <code style={{ background: "rgba(62,58,51,.1)", borderRadius: 3, padding: "0 4px" }}>apiKey</code> の値<br />
                    ・まだ無い場合 … 「<b>アプリの追加</b>」→「<b>&lt;/&gt;</b>」（ウェブ）を選び、
                    ニックネームを入れて登録（Hostingのチェックは不要）すると表示されます
                  </div>
                </div>
                <button onClick={() => openLink(fbLink("settings/general"))} style={{ ...linkBtn, marginBottom: 12 }}>
                  プロジェクトの設定を開く
                </button>
                {[
                  { k: "projectId", label: "プロジェクトID", ph: "例: ideaboard-1a2b3" },
                  { k: "apiKey", label: "APIキー", ph: "例: AIzaSy..." },
                  { k: "room", label: "合言葉（自動で作られます）", ph: "" },
                ].map((f) => (
                  <label key={f.k} style={{ display: "block", fontSize: 12, marginBottom: 8 }}>
                    {f.label}
                    <input
                      value={cloudForm[f.k]}
                      placeholder={f.ph}
                      onChange={(e) => setCloudForm((v) => ({ ...v, [f.k]: e.target.value }))}
                      style={{
                        width: "100%", boxSizing: "border-box", border: "1px solid #C9C2B2", borderRadius: 6,
                        fontSize: 13, padding: "7px 9px", fontFamily: "inherit", color: "#3E3A33",
                        background: "#fff", marginTop: 3,
                      }}
                    />
                  </label>
                ))}
                <button
                  onClick={() => setCloudForm((v) => ({ ...v, room: makeRoomKey() }))}
                  style={{ ...linkBtn, background: "transparent", color: "#6B665C", border: "1px solid #C9C2B2" }}
                >
                  合言葉を作り直す
                </button>
              </>
            ),
          },
        ];
        const cur = steps[setupStep];
        return (
          <div
            onPointerDown={(e) => { if (e.target === e.currentTarget) setSetupOpen(false); }}
            style={{ position: "fixed", inset: 0, zIndex: 200001, background: "rgba(40,35,25,.5)", display: "grid", placeItems: "center", padding: 16 }}
          >
            <div
              onPointerDown={(e) => e.stopPropagation()}
              style={{ background: "#FFFDF6", borderRadius: 10, width: "min(560px, 94vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 10px 30px rgba(30,25,15,.35)", color: "#3E3A33" }}
            >
              <div style={{ padding: "16px 20px 10px", borderBottom: "1px solid #E4DFD2" }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                  <strong style={{ fontSize: 15, flex: 1 }}>かんたん設定</strong>
                  <button
                    onClick={() => setSetupOpen(false)}
                    style={{ border: "none", background: "transparent", color: "#8A857B", fontSize: 16, cursor: "pointer", padding: 0 }}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {steps.map((st, i) => (
                    <div
                      key={i}
                      style={{
                        flex: 1, height: 4, borderRadius: 2,
                        background: i <= setupStep ? "#3E3A33" : "#E4DFD2",
                      }}
                    />
                  ))}
                </div>
                <div style={{ fontSize: 12, color: "#9C9587", marginTop: 6 }}>
                  手順 {setupStep + 1} / {steps.length}　{cur.t}
                </div>
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", fontSize: 13, lineHeight: 1.9 }}>
                {cur.body}
                {setupMsg && (
                  <div
                    style={{
                      marginTop: 12, borderRadius: 6, padding: "9px 11px", fontSize: 12, lineHeight: 1.7,
                      background: setupMsg.ok ? "rgba(76,122,76,.13)" : "#FFE2DE",
                      color: setupMsg.ok ? "#3E6B3E" : "#A23A2E",
                    }}
                  >
                    {setupMsg.message}
                    {!setupMsg.ok && setupMsg.step === "rules" && (
                      <button onClick={() => { setSetupStep(2); setSetupMsg(null); }} style={{ ...linkBtn, marginTop: 8 }}>
                        手順3に戻る
                      </button>
                    )}
                    {!setupMsg.ok && setupMsg.step === "auth" && (
                      <button onClick={() => { setSetupStep(3); setSetupMsg(null); }} style={{ ...linkBtn, marginTop: 8 }}>
                        手順4に戻る
                      </button>
                    )}
                    {!setupMsg.ok && setupMsg.step === "firestore" && (
                      <button onClick={() => { setSetupStep(1); setSetupMsg(null); }} style={{ ...linkBtn, marginTop: 8 }}>
                        手順2に戻る
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div style={{ padding: "12px 20px 16px", borderTop: "1px solid #E4DFD2", display: "flex", gap: 8 }}>
                <button
                  onClick={() => { setSetupStep((v) => Math.max(0, v - 1)); setSetupMsg(null); }}
                  disabled={setupStep === 0}
                  style={{
                    border: "1px solid #C9C2B2", borderRadius: 6, background: "transparent",
                    color: setupStep === 0 ? "#C9C2B2" : "#3E3A33",
                    fontSize: 13, padding: "9px 18px", cursor: setupStep === 0 ? "default" : "pointer",
                  }}
                >
                  戻る
                </button>
                <div style={{ flex: 1 }} />
                {setupStep < steps.length - 1 ? (
                  <button
                    onClick={() => { setSetupStep((v) => v + 1); setSetupMsg(null); }}
                    style={{ border: "none", borderRadius: 6, background: "#3E3A33", color: "#F6F2E9", fontSize: 13, fontWeight: 700, padding: "9px 24px", cursor: "pointer" }}
                  >
                    できた、次へ
                  </button>
                ) : setupMsg?.ok ? (
                  <button
                    onClick={() => setSetupOpen(false)}
                    style={{ border: "none", borderRadius: 6, background: "#4C7A4C", color: "#FFFDF6", fontSize: 13, fontWeight: 700, padding: "9px 24px", cursor: "pointer" }}
                  >
                    設定を終える
                  </button>
                ) : (
                  <button
                    onClick={runDiagnose}
                    disabled={setupBusy}
                    style={{
                      border: "none", borderRadius: 6,
                      background: setupBusy ? "#C9C2B2" : "#3E3A33",
                      color: "#F6F2E9", fontSize: 13, fontWeight: 700, padding: "9px 24px", cursor: "pointer",
                    }}
                  >
                    {setupBusy ? "確認中…" : "つないでみる"}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* テキストで書き出す */}
      {exportOpen && (() => {
        const targets = exportTargets();
        const text = buildText(targets);
        return (
          <div
            onPointerDown={(e) => { if (e.target === e.currentTarget) setExportOpen(false); }}
            style={{ position: "fixed", inset: 0, zIndex: 200000, background: "rgba(40,35,25,.45)", display: "grid", placeItems: "center", padding: 16 }}
          >
            <div
              onPointerDown={(e) => e.stopPropagation()}
              style={{ background: "#FFFDF6", borderRadius: 10, padding: "16px 18px", width: "min(600px, 94vw)", maxHeight: "86vh", display: "flex", flexDirection: "column", boxShadow: "0 10px 30px rgba(30,25,15,.35)", color: "#3E3A33" }}
            >
              <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                <strong style={{ fontSize: 15, flex: 1 }}>テキストで書き出す</strong>
                <span style={{ fontSize: 11, color: "#9C9587" }}>
                  {selectedIds.length > 0 ? `選択中の${targets.length}枚` : `このボードの${targets.length}枚`}
                </span>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 10 }}>
                {[
                  { key: "nest", label: "中の付箋も含める" },
                  { key: "tags", label: "タグを付ける" },
                  { key: "num", label: "番号を付ける" },
                ].map((o) => (
                  <label key={o.key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={!!exportOpts[o.key]}
                      onChange={(e) => setExportOpts((v) => ({ ...v, [o.key]: e.target.checked }))}
                      style={{ width: 14, height: 14, cursor: "pointer" }}
                    />
                    {o.label}
                  </label>
                ))}
              </div>

              <textarea
                readOnly
                value={text}
                style={{
                  flex: 1, minHeight: 240, width: "100%", boxSizing: "border-box",
                  border: "1px solid #C9C2B2", borderRadius: 6, background: "#fff",
                  fontSize: 13, lineHeight: 1.8, padding: "10px 12px",
                  fontFamily: "inherit", color: "#3E3A33", resize: "none", marginBottom: 12,
                }}
              />

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setExportOpen(false)}
                  style={{ border: "1px solid #C9C2B2", borderRadius: 6, background: "transparent", color: "#3E3A33", fontSize: 13, padding: "8px 16px", cursor: "pointer" }}
                >
                  閉じる
                </button>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => downloadText(text)}
                  style={{ border: "1px solid #C9C2B2", borderRadius: 6, background: "transparent", color: "#3E3A33", fontSize: 13, padding: "8px 16px", cursor: "pointer" }}
                >
                  ファイルに保存
                </button>
                <button
                  onClick={async () => { await copyText(text); setExportOpen(false); }}
                  style={{ border: "none", borderRadius: 6, background: "#3E3A33", color: "#F6F2E9", fontSize: 13, fontWeight: 700, padding: "8px 18px", cursor: "pointer" }}
                >
                  コピー
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 設定画面 */}
      {settingsOpen && (
        <div
          onPointerDown={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 200000, background: "rgba(40,35,25,.45)", display: "grid", placeItems: "center" }}
        >
          <div
            onPointerDown={(e) => e.stopPropagation()}
            style={{ background: "#FFFDF6", borderRadius: 10, padding: "18px 20px", width: "min(500px, 92vw)", maxHeight: "84vh", overflowY: "auto", boxShadow: "0 10px 30px rgba(30,25,15,.35)", color: "#3E3A33" }}
          >
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
              <strong style={{ fontSize: 15, flex: 1 }}>設定<span style={{ fontSize: 10.5, color: "#9C9587", fontWeight: 400, marginLeft: 8 }}>版 {APP_VERSION}</span></strong>
              <button
                onClick={() => { setSettings(DEFAULT_SETTINGS); setSettingsRev((v) => v + 1); }}
                style={{ border: "1px solid #C9C2B2", background: "transparent", color: "#3E3A33", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer", marginRight: 6 }}
              >
                既定に戻す
              </button>
              <button
                onClick={() => setSettingsOpen(false)}
                style={{ border: "none", background: "#3E3A33", color: "#F6F2E9", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                閉じる
              </button>
            </div>

            <div key={settingsRev}>
              {/* 数値設定 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px", marginBottom: 14 }}>
                {[
                  { key: "grid", label: "グリッド間隔 (px)", min: 8, max: 100 },
                  { key: "noteTagLimit", label: "付箋に表示するタグ数", min: 1, max: 10 },
                  { key: "overviewZoom", label: "見出し表示に切替わる倍率 (%)", min: 20, max: 100, pct: true },
                  { key: "canvasW", label: "キャンバス幅 (px)", min: 1000, max: 20000 },
                  { key: "canvasH", label: "キャンバス高さ (px)", min: 1000, max: 20000 },
                ].map((f) => (
                  <label key={f.key} style={{ fontSize: 12 }}>
                    {f.label}
                    <input
                      type="number"
                      min={f.min}
                      max={f.max}
                      defaultValue={f.pct ? Math.round((settings[f.key] ?? 0) * 100) : settings[f.key]}
                      onBlur={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (isNaN(v)) return;
                        const clamped = Math.min(f.max, Math.max(f.min, v));
                        updateSettings({ [f.key]: f.pct ? clamped / 100 : clamped });
                      }}
                      style={{ width: "100%", boxSizing: "border-box", border: "1px solid #C9C2B2", borderRadius: 5, fontSize: 13, padding: "4px 7px", fontFamily: "inherit", marginTop: 2, background: "#fff", color: "#3E3A33" }}
                    />
                  </label>
                ))}
              </div>

              <label style={{ fontSize: 12, display: "block", marginBottom: 14 }}>
                文字のサイズ3段階（カンマ区切り・px）
                <input
                  defaultValue={(settings.textSizes || []).join(", ")}
                  onBlur={(e) => {
                    const arr = e.target.value.split(/[、,]/).map((x) => parseInt(x.trim(), 10)).filter((x) => !isNaN(x) && x > 5).slice(0, 3);
                    if (arr.length === 3) updateSettings({ textSizes: arr });
                  }}
                  style={{ width: "100%", boxSizing: "border-box", border: "1px solid #C9C2B2", borderRadius: 5, fontSize: 13, padding: "4px 7px", fontFamily: "inherit", marginTop: 2, background: "#fff", color: "#3E3A33" }}
                />
              </label>

              {/* 色の使い分けメモ */}
              <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>色の使い分け</span>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={settings.showColorNotes !== false}
                    onChange={(e) => updateSettings({ showColorNotes: e.target.checked })}
                    style={{ width: 14, height: 14, cursor: "pointer" }}
                  />
                  色を選ぶときに表示する
                </label>
              </div>
              <div style={{ fontSize: 11, color: "#9C9587", marginBottom: 8 }}>
                それぞれの色をどう使うか書いておけます。上のチェックを外すと、色選びは丸だけの表示になります。
              </div>
              <div style={{ marginBottom: 16 }}>
                {COLORS.map((col, i) => (
                  <div key={col.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                    <span style={{ width: 20, height: 20, borderRadius: "50%", background: col.bg, border: `1px solid ${col.edge}`, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: "#9C9587", width: 52, flexShrink: 0 }}>{col.name}</span>
                    <input
                      defaultValue={(settings.colorNotes || [])[i] || ""}
                      placeholder="例: 決定事項 / 要検討 など"
                      onBlur={(e) => {
                        const notes = [...(settings.colorNotes || [])];
                        while (notes.length < COLORS.length) notes.push("");
                        notes[i] = e.target.value.trim();
                        updateSettings({ colorNotes: notes });
                      }}
                      style={{ flex: 1, minWidth: 0, border: "1px solid #C9C2B2", borderRadius: 5, fontSize: 12, padding: "4px 7px", fontFamily: "inherit", background: "#fff", color: "#3E3A33" }}
                    />
                  </div>
                ))}
              </div>

              {/* プリセットタグ */}
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>プリセットタグ</div>
              <div style={{ fontSize: 11, color: "#9C9587", marginBottom: 8 }}>
                タグは「、」または「,」区切り。編集後、欄の外をクリックすると確定します。<br />
                「俯瞰で優先」をONにしたカテゴリのタグが、縮小表示のときに優先して表示されます。
              </div>
              {cloud && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(76,122,76,.1)", borderRadius: 6, padding: "6px 9px", marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: "#3E6B3E", flex: 1, lineHeight: 1.6 }}>
                    タグはスマホや他のパソコンと共有されます。編集すると自動で反映されます。
                  </span>
                  <button
                    onClick={async () => {
                      setTagSyncMsg("読み込み中…");
                      await pullTags();
                      setTagSyncMsg("読み込みました");
                      setTimeout(() => setTagSyncMsg(""), 2500);
                    }}
                    style={{ border: "1px solid #C9C2B2", borderRadius: 5, background: "#fff", color: "#3E3A33", fontSize: 10.5, padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    読み直す
                  </button>
                </div>
              )}
              {tagSyncMsg && (
                <div style={{ fontSize: 10.5, color: "#6B665C", marginBottom: 8 }}>{tagSyncMsg}</div>
              )}
              <label style={{ fontSize: 12, display: "block", marginBottom: 10 }}>
                <span style={{ color: ALERT_TAG_COLOR, fontWeight: 700 }}>赤色で強調するタグ</span>（カテゴリの色より優先されます）
                <input
                  defaultValue={(settings.alertTags || []).join("、")}
                  placeholder="重要度高、優先度高、…"
                  onBlur={(e) => {
                    const alertTags = e.target.value.split(/[、,]/).map((x) => x.trim()).filter(Boolean);
                    updateSettings({ alertTags });
                  }}
                  style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${ALERT_TAG_COLOR}`, borderRadius: 5, fontSize: 12, padding: "4px 7px", fontFamily: "inherit", marginTop: 2, background: "#fff", color: "#3E3A33" }}
                />
              </label>
              {(settings.presetTags || []).map((cat, ci) => (
                <div key={ci} style={{ marginBottom: 10, padding: "8px 10px", background: "rgba(62,58,51,.05)", borderRadius: 6 }}>
                  <div style={{ display: "flex", gap: 6, marginBottom: 5 }}>
                    <input
                      type="color"
                      title="このカテゴリのタグ色"
                      defaultValue={cat.color || CATEGORY_FALLBACK[ci % CATEGORY_FALLBACK.length]}
                      onChange={(e) => {
                        const color = e.target.value;
                        setSettings((s) => ({
                          ...s,
                          presetTags: s.presetTags.map((c, i) => (i === ci ? { ...c, color } : c)),
                        }));
                      }}
                      style={{ width: 32, height: 29, padding: 1, border: "1px solid #C9C2B2", borderRadius: 5, background: "#fff", cursor: "pointer", flexShrink: 0 }}
                    />
                    <input
                      defaultValue={cat.name}
                      placeholder="カテゴリ名"
                      onBlur={(e) => {
                        const name = e.target.value.trim() || "カテゴリ";
                        setSettings((s) => ({
                          ...s,
                          presetTags: s.presetTags.map((c, i) => (i === ci ? { ...c, name } : c)),
                        }));
                      }}
                      style={{ flex: 1, minWidth: 0, border: "1px solid #C9C2B2", borderRadius: 5, fontSize: 13, fontWeight: 700, padding: "3px 7px", fontFamily: "inherit", background: "#fff", color: "#3E3A33" }}
                    />
                    <button
                      title={cat.overview !== false
                        ? "俯瞰（縮小表示）でこのカテゴリのタグを優先表示中。押すと優先しない"
                        : "俯瞰では表示を後回しにする設定。押すと優先表示する"}
                      onClick={() =>
                        setSettings((s) => ({
                          ...s,
                          presetTags: s.presetTags.map((c, i) => (i === ci ? { ...c, overview: c.overview === false } : c)),
                        }))
                      }
                      style={{
                        border: "none", borderRadius: 5, cursor: "pointer", fontSize: 10, fontWeight: 700,
                        padding: "3px 8px", whiteSpace: "nowrap",
                        background: cat.overview !== false ? "#3E3A33" : "rgba(62,58,51,.13)",
                        color: cat.overview !== false ? "#F6F2E9" : "#8A857B",
                      }}
                    >
                      俯瞰で優先
                    </button>
                    <button
                      title="このカテゴリを削除"
                      onClick={() => {
                        setSettings((s) => ({ ...s, presetTags: s.presetTags.filter((_, i) => i !== ci) }));
                        setSettingsRev((v) => v + 1);
                      }}
                      style={{ border: "none", background: "transparent", cursor: "pointer", color: "#B0483C", fontSize: 13, padding: "0 4px" }}
                    >
                      ✕
                    </button>
                  </div>
                  <input
                    defaultValue={(cat.tags || []).join("、")}
                    placeholder="タグ1、タグ2、…"
                    onBlur={(e) => {
                      const tags = e.target.value.split(/[、,]/).map((x) => x.trim()).filter(Boolean);
                      setSettings((s) => ({
                        ...s,
                        presetTags: s.presetTags.map((c, i) => (i === ci ? { ...c, tags } : c)),
                      }));
                    }}
                    style={{ width: "100%", boxSizing: "border-box", border: "1px solid #C9C2B2", borderRadius: 5, fontSize: 12, padding: "4px 7px", fontFamily: "inherit", background: "#fff", color: "#3E3A33" }}
                  />
                </div>
              ))}
              <button
                onClick={() => {
                  setSettings((s) => ({ ...s, presetTags: [...(s.presetTags || []), { name: `カテゴリ${(s.presetTags || []).length + 1}`, tags: [] }] }));
                  setSettingsRev((v) => v + 1);
                }}
                style={{ width: "100%", border: "1px dashed #C9C2B2", borderRadius: 6, background: "transparent", color: "#3E3A33", fontSize: 12, padding: "5px 0", cursor: "pointer" }}
              >
                ＋ カテゴリを追加
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 起動時のプロジェクト選択 */}
      {startOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200002, background: "rgba(40,35,25,.55)", display: "grid", placeItems: "center" }}>
          <div style={{ background: "#FFFDF6", borderRadius: 12, padding: "22px 24px", width: "min(420px, 92vw)", maxHeight: "84vh", overflowY: "auto", boxShadow: "0 12px 34px rgba(30,25,15,.4)", color: "#3E3A33" }}>
            <strong style={{ fontSize: 16, display: "block", marginBottom: 3 }}>IdeaBoard</strong>
            <div style={{ fontSize: 12, color: "#9C9587", marginBottom: 14 }}>
              開くプロジェクトを選んで「開く」を押してください（ダブルクリックでも開けます）
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14 }}>
              {allMetas.map((p) => {
                const chosen = startPick?.from === "local" && startPick.id === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setStartPick({ id: p.id, from: "local" })}
                    onDoubleClick={async () => { await switchProject(p.id); setStartOpen(false); }}
                    style={{
                      textAlign: "left", borderRadius: 8, cursor: "pointer",
                      border: chosen ? "2px solid #3E3A33" : "1px solid #E4DFD2",
                      background: chosen ? "rgba(62,58,51,.08)" : "#fff",
                      padding: chosen ? "8px 11px" : "9px 12px",
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{p.name || "（無題）"}</div>
                    <div style={{ fontSize: 11, color: "#9C9587", marginTop: 2 }}>
                      {p.boards}ボード / 付箋{p.notes}枚
                      {p.id === currentProjectId && "　前回開いていたもの"}
                    </div>
                  </button>
                );
              })}
            </div>

            {cloud && cloudProjects.filter((x) => !allMetas.some((m) => m.id === x.id)).length > 0 && (
              <>
                <div style={{ fontSize: 11, color: "#9C9587", marginBottom: 5 }}>別のパソコンで作られたプロジェクト</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14 }}>
                  {cloudProjects.filter((x) => !allMetas.some((m) => m.id === x.id)).map((x) => (
                    <button
                      key={x.id}
                      onClick={() => pullProjectFromCloud(x.id)}
                      style={{
                        textAlign: "left", borderRadius: 8, cursor: "pointer", background: "#fff",
                        border: "1px dashed #C9C2B2", padding: "9px 12px",
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{x.name}</div>
                      <div style={{ fontSize: 11, color: "#9C9587", marginTop: 2 }}>
                        ☁ {x.device} / {new Date(x.savedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {syncInfo.available && syncList.filter((x) => !allMetas.some((m) => m.id === x.id)).length > 0 && (
              <>
                <div style={{ fontSize: 11, color: "#9C9587", marginBottom: 5 }}>別のPCで作られたプロジェクト</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14 }}>
                  {syncList.filter((x) => !allMetas.some((m) => m.id === x.id)).map((x) => {
                    const chosen = startPick?.from === "sync" && startPick.id === x.id;
                    return (
                      <button
                        key={x.id}
                        onClick={() => setStartPick({ id: x.id, from: "sync" })}
                        onDoubleClick={() => { pullProject(x.id); setStartOpen(false); }}
                        style={{
                          textAlign: "left", borderRadius: 8, cursor: "pointer", background: "#fff",
                          border: chosen ? "2px solid #3E3A33" : "1px dashed #C9C2B2",
                          padding: chosen ? "8px 11px" : "9px 12px",
                        }}
                      >
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{x.name}</div>
                        <div style={{ fontSize: 11, color: "#9C9587", marginTop: 2 }}>
                          {x.boards}ボード / 付箋{x.notes}枚　{x.device}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <button
              onClick={async () => {
                if (!startPick) return;
                if (startPick.from === "sync") await pullProject(startPick.id);
                else await switchProject(startPick.id);
                setStartOpen(false);
              }}
              disabled={!startPick}
              style={{
                width: "100%", border: "none", borderRadius: 8,
                background: startPick ? "#3E3A33" : "#C9C2B2",
                color: "#F6F2E9", fontSize: 15, fontWeight: 700,
                padding: "12px 0", cursor: startPick ? "pointer" : "default", marginBottom: 10,
              }}
            >
              開く
            </button>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => { addProject(); setStartOpen(false); }}
                style={{ flex: 1, border: "1px solid #C9C2B2", borderRadius: 8, background: "transparent", color: "#3E3A33", fontSize: 13, padding: "9px 0", cursor: "pointer" }}
              >
                ＋ 新しく作る
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{ flex: 1, border: "1px solid #C9C2B2", borderRadius: 8, background: "transparent", color: "#3E3A33", fontSize: 13, padding: "9px 0", cursor: "pointer" }}
              >
                ファイルから開く
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 付箋を貼る前のプロパティ設定 */}
      {pendingNote && (
        <div
          onPointerDown={(e) => { if (e.target === e.currentTarget) setPendingNote(null); }}
          style={{ position: "fixed", inset: 0, zIndex: 200000, background: "rgba(40,35,25,.45)", display: "grid", placeItems: "center" }}
        >
          <div onPointerDown={(e) => e.stopPropagation()} style={{ background: "#FFFDF6", borderRadius: 10, padding: "16px 18px", width: "min(360px, 90vw)", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 10px 30px rgba(30,25,15,.35)", color: "#3E3A33" }}>
            <strong style={{ fontSize: 14, display: "block", marginBottom: 10 }}>付箋を貼る</strong>

            <div style={{ fontSize: 11, color: "#9C9587", marginBottom: 4 }}>色</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              {COLORS.map((col, i) => (
                <button
                  key={col.name}
                  title={(settings.colorNotes || [])[i] || col.name}
                  onClick={() => setPendingNote((p) => ({ ...p, color: i }))}
                  style={{
                    width: 26, height: 26, borderRadius: "50%",
                    border: pendingNote.color === i ? "3px solid #3E3A33" : "1px solid rgba(0,0,0,.2)",
                    background: col.bg, cursor: "pointer", padding: 0,
                  }}
                />
              ))}
            </div>
            {settings.showColorNotes !== false && (
              <div style={{ fontSize: 11, color: "#6B665C", minHeight: 17, marginBottom: 6 }}>
                {(settings.colorNotes || [])[pendingNote.color] || COLORS[pendingNote.color]?.name}
              </div>
            )}
            <div style={{ height: 6 }} />

            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={pendingNote.useTitle}
                onChange={(e) => setPendingNote((p) => ({ ...p, useTitle: e.target.checked }))}
                style={{ width: 15, height: 15, cursor: "pointer" }}
              />
              タイトルを付ける
            </label>
            {pendingNote.useTitle && (
              <input
                autoFocus
                value={pendingNote.title}
                placeholder="タイトル"
                onChange={(e) => setPendingNote((p) => ({ ...p, title: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") commitPendingNote(); }}
                style={{
                  width: "100%", boxSizing: "border-box", border: "1px solid #C9C2B2", borderRadius: 5,
                  fontSize: 13, fontWeight: 700, padding: "5px 8px", fontFamily: "inherit",
                  background: "#fff", color: "#3E3A33",
                }}
              />
            )}
            <div style={{ height: 12 }} />

            <div style={{ fontSize: 11, color: "#9C9587", marginBottom: 4 }}>タグ（任意・タップで付け外し）</div>
            <div style={{ maxHeight: 180, overflowY: "auto", marginBottom: 14 }}>
              {(settings.presetTags || []).map((cat, ci) => {
                const cc = cat.color || CATEGORY_FALLBACK[ci % CATEGORY_FALLBACK.length];
                return (
                  <div key={ci} style={{ marginBottom: 7 }}>
                    <div style={{ fontSize: 10, color: cc, fontWeight: 700, marginBottom: 3 }}>{cat.name}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {(cat.tags || []).map((t) => {
                        const has = pendingNote.tags.includes(t);
                        const tc = tagColorOf(t);
                        return (
                          <button
                            key={t}
                            onClick={() =>
                              setPendingNote((p) => ({
                                ...p,
                                tags: has ? p.tags.filter((x) => x !== t) : [...p.tags, t],
                              }))
                            }
                            style={{
                              border: "none", borderRadius: 8, cursor: "pointer",
                              fontSize: 11, fontWeight: 700, padding: "2px 8px",
                              background: has ? tc : tint(tc, 0.15), color: has ? "#FFFDF6" : tc,
                            }}
                          >
                            {t}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setPendingNote(null)}
                style={{ border: "1px solid #C9C2B2", background: "transparent", color: "#3E3A33", borderRadius: 6, padding: "6px 14px", fontSize: 13, cursor: "pointer" }}
              >
                やめる
              </button>
              <button
                onClick={commitPendingNote}
                style={{ border: "none", background: "#3E3A33", color: "#F6F2E9", borderRadius: 6, padding: "6px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                貼る
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 控えを残せず、上書きを止めた */}
      {keepFail && (
        <div
          style={{
            position: "fixed", left: "50%", top: 52, transform: "translateX(-50%)", zIndex: 200002,
            background: "#FBE3DF", borderRadius: 10, boxShadow: "0 6px 20px rgba(30,25,15,.35)",
            padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, maxWidth: "92vw", flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, color: "#A23A2E" }}>
            空き容量が足りず「{keepFail.name}」の控えを残せないため、上書きを止めました。
          </span>
          <button
            onClick={() => exportProject(projects.find((p) => p.id === keepFail.id))}
            style={{ border: "none", borderRadius: 6, background: "#A23A2E", color: "#FFFDF6", fontSize: 12, fontWeight: 700, padding: "5px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            ファイルへ保存
          </button>
          <button
            onClick={() => setKeepFail(null)}
            style={{ border: "none", background: "transparent", color: "#A23A2E", fontSize: 14, cursor: "pointer", padding: "0 4px" }}
          >
            ✕
          </button>
        </div>
      )}

      {/* サーバーとこの端末の両方で変更された（パネルを開いていなくても気づけるように） */}
      {syncConflict && syncConflict.id === currentProjectId && !shareOpen && (
        <div
          style={{
            position: "fixed", left: "50%", top: 52, transform: "translateX(-50%)", zIndex: 200001,
            background: "#FFF3D6", borderRadius: 10, boxShadow: "0 6px 20px rgba(30,25,15,.35)",
            padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, maxWidth: "92vw", flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, color: "#8A6A1F" }}>
            「{syncConflict.device}」とこの端末の両方で変更されています。どちらを残しますか？
          </span>
          <button
            onClick={() => pullProjectFromCloud(syncConflict.id)}
            style={{ border: "none", borderRadius: 6, background: "#8A6A1F", color: "#FFFDF6", fontSize: 12, fontWeight: 700, padding: "5px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            サーバーの方
          </button>
          <button
            onClick={() => keepLocalVersion(syncConflict.id)}
            style={{ border: "1px solid #8A6A1F", borderRadius: 6, background: "transparent", color: "#8A6A1F", fontSize: 12, fontWeight: 700, padding: "5px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            この端末の方
          </button>
        </div>
      )}

      {/* 他のPCでの更新を知らせる */}
      {syncNotice && (
        <div
          style={{
            position: "fixed", left: "50%", top: 88, transform: "translateX(-50%)", zIndex: 200001,
            background: "#FFFDF6", borderRadius: 10, boxShadow: "0 6px 20px rgba(30,25,15,.35)",
            padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, maxWidth: "92vw",
          }}
        >
          <span style={{ fontSize: 12, color: "#3E3A33" }}>{syncNotice.text}</span>
          <button
            onClick={() => pullProject(syncNotice.pid)}
            style={{ border: "none", borderRadius: 6, background: "#3E3A33", color: "#F6F2E9", fontSize: 12, fontWeight: 700, padding: "5px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            読み込む
          </button>
          <button
            onClick={async () => {
              // こちらの内容で上書きする
              syncMtime.current[syncNotice.pid] = syncNotice.mtime;
              await pushProject(syncNotice.pid);
              setSyncNotice(null);
            }}
            style={{ border: "1px solid #C9C2B2", borderRadius: 6, background: "transparent", color: "#3E3A33", fontSize: 12, padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            こちらを残す
          </button>
          <button
            onClick={() => setSyncNotice(null)}
            style={{ border: "none", background: "transparent", color: "#8A857B", fontSize: 13, cursor: "pointer", padding: 0 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* 画像取り込みのエラー */}
      {imgError && (
        <div style={{
          position: "fixed", left: "50%", top: 90, transform: "translateX(-50%)", zIndex: 200001,
          background: "#B0483C", color: "#FFFDF6", borderRadius: 8, padding: "8px 16px",
          fontSize: 13, boxShadow: "0 6px 18px rgba(30,25,15,.4)",
        }}>
          {imgError}
        </div>
      )}

      {/* 確認ダイアログ */}
      {confirmBox && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200000, background: "rgba(40,35,25,.45)", display: "grid", placeItems: "center" }}>
          <div style={{ background: "#FFFDF6", borderRadius: 10, padding: "18px 20px", width: "min(320px, 86vw)", boxShadow: "0 10px 30px rgba(30,25,15,.35)" }}>
            <p style={{ margin: "0 0 16px", fontSize: 14, color: "#3E3A33", lineHeight: 1.7 }}>{confirmBox.message}</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setConfirmBox(null)}
                style={{ border: "1px solid #C9C2B2", background: "transparent", color: "#3E3A33", borderRadius: 6, padding: "6px 14px", fontSize: 13, cursor: "pointer" }}
              >
                キャンセル
              </button>
              <button
                onClick={() => { confirmBox.action(); setConfirmBox(null); }}
                style={{ border: "none", background: "#B0483C", color: "#FFFDF6", borderRadius: 6, padding: "6px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                {confirmBox.okLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
