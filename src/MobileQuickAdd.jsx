import { useState, useEffect, useRef } from "react";
import {
  loadCloudConf, saveCloudConf, cloudTest, cloudPush, loadCloudDraft, saveCloudDraft, projectList,
  tagsPush, tagsPull,
} from "./cloud.js";
import { APP_VERSION } from "./version.js";

// ホーム画面のアイコンから開いたか（この開き方では設定が保持されないことがある）
const isStandalone = () =>
  (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
  (typeof navigator !== "undefined" && navigator.standalone === true);

// 本体アプリと同じ配色・タグ設定
const COLORS = [
  { name: "レモン", bg: "#FFF3A3", edge: "#E8D96A" },
  { name: "さくら", bg: "#FFD6E0", edge: "#F0A8BC" },
  { name: "そら", bg: "#CDEBFF", edge: "#93C9EE" },
  { name: "わかば", bg: "#D6F5C9", edge: "#A3D98F" },
  { name: "ふじ", bg: "#E6DBFF", edge: "#C3AEEE" },
  { name: "グレー", bg: "#EDEBE6", edge: "#C6C1B6" },
];
const DEFAULT_COLOR = COLORS.length - 1;

const CATALOG_KEY = "idea-board-tag-catalog";
const AREAS_KEY = "idea-board-areas";
const TARGET_KEY = "idea-board-target";
// 領域の色（PC版の付箋の色と同じ並び）
const AREA_COLORS = ["#E8D96A", "#F0A8BC", "#93C9EE", "#A3D98F", "#C3AEEE", "#C6C1B6"];
const DEFAULT_TAGS = [
  { name: "シーン", color: "#4A78B0", tags: ["起", "承", "転", "結", "メイン", "サブ", "深掘り", "描写", "伏線1", "伏線2"] },
  { name: "設定", color: "#7A5FA8", tags: ["キャラクター", "世界観", "ギミック"] },
  { name: "アイデア", color: "#C77E3C", tags: ["重要度高", "重要度中", "重要度低", "実装", "未実装"] },
  { name: "その他", color: "#4C7A4C", tags: ["済", "未", "優先度高", "優先度中", "優先度低"] },
];
const DEFAULT_ALERT_TAGS = ["重要度高", "優先度高", "未", "未実装"];
const CAT_COLORS = ["#4A78B0", "#7A5FA8", "#C77E3C", "#4C7A4C", "#B0483C", "#3E8E8E"];
const ALERT_COLOR = "#C6392B";
const FREE_COLOR = "#6B665C";
const STORAGE_KEY = "idea-board-inbox";
// PC版と同じ数字にしておく。色やタグの定義を変えたら両方を上げる。
const DATA_VERSION = 3;

const tint = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const tagColorOfIn = (catalog, t, alertTags = DEFAULT_ALERT_TAGS) => {
  if ((alertTags || []).includes(t)) return ALERT_COLOR;
  for (let i = 0; i < catalog.length; i++) {
    if ((catalog[i].tags || []).includes(t)) return catalog[i].color || CAT_COLORS[i % CAT_COLORS.length];
  }
  return FREE_COLOR;
};

export default function MobileQuickAdd() {
  const [items, setItems] = useState([]);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [useTitle, setUseTitle] = useState(false);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [tags, setTags] = useState([]);
  const [tab, setTab] = useState("write"); // write | list
  const [toast, setToast] = useState(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [offlineReady, setOfflineReady] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false); // クラウド同期をやめる確認
  const [helpOpen, setHelpOpen] = useState(false);
  const [listFilter, setListFilter] = useState("unsent"); // "unsent"（まだ送っていない）か "all"（全部）
  const [cloud, setCloud] = useState(null);             // クラウド同期の設定
  const [cloudForm, setCloudForm] = useState({ projectId: "", apiKey: "", room: "" });
  const [cloudMsg, setCloudMsg] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [unsent, setUnsent] = useState([]);              // まだ送れていないもののID
  const [areas, setAreas] = useState([]);               // まとめ先（PCで領域になる）
  const [area, setArea] = useState("");                 // いま選んでいるまとめ先
  const [newArea, setNewArea] = useState("");
  const [areaEditOpen, setAreaEditOpen] = useState(false);
  const [picked, setPicked] = useState([]);   // 選んだ付箋のID
  const [projects, setProjects] = useState([]);     // クラウドにあるプロジェクト
  const [target, setTarget] = useState(null);       // 送り先 {id, name}
  const [targetOpen, setTargetOpen] = useState(false);
  const standalone = isStandalone();           // ホーム画面から開いたか
  const [catalog, setCatalog] = useState(DEFAULT_TAGS);  // タグ表（編集できる）
  const [alertTags, setAlertTags] = useState(DEFAULT_ALERT_TAGS); // 赤で目立たせるタグ
  const tagsLoaded = useRef(false);
  const tagsSaved = useRef("");
  const [tagEditOpen, setTagEditOpen] = useState(false);
  const [newTag, setNewTag] = useState({ cat: 0, name: "" });
  const [newCat, setNewCat] = useState("");
  const [loaded, setLoaded] = useState(false);
  const areaRef = useRef(null);

  // 端末内に保存したものを読み戻す
  useEffect(() => {
    const read = (key) => {
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : null;
      } catch (e) {
        return null;
      }
    };
    const its = read(STORAGE_KEY);
    if (Array.isArray(its)) setItems(its);
    const cat = read(CATALOG_KEY);
    if (Array.isArray(cat) && cat.length > 0) setCatalog(cat);
    const ar = read(AREAS_KEY);
    if (Array.isArray(ar)) setAreas(ar);
    const tg = read(TARGET_KEY);
    if (tg && tg.id) setTarget(tg);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch (e) {}
  }, [items, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog)); } catch (e) {}
  }, [catalog, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(AREAS_KEY, JSON.stringify(areas)); } catch (e) {}
  }, [areas, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try {
      if (target) localStorage.setItem(TARGET_KEY, JSON.stringify(target));
      else localStorage.removeItem(TARGET_KEY);
    } catch (e) {}
  }, [target, loaded]);

  // タグ表はクラウドにあるものを正とし、開くたびに読み直す
  const pullTags = async (conf = cloud) => {
    if (!conf) return;
    try {
      const r = await tagsPull(conf);
      if (r) {
        setCatalog(r.presetTags);
        if (r.alertTags.length > 0) setAlertTags(r.alertTags);
        tagsSaved.current = JSON.stringify({ presetTags: r.presetTags, alertTags: r.alertTags });
      } else {
        const data = { presetTags: catalog, alertTags };
        await tagsPush(conf, data);
        tagsSaved.current = JSON.stringify(data);
      }
    } catch (e) { /* つながらないときは端末のものを使う */ }
    tagsLoaded.current = true;
  };

  useEffect(() => {
    if (!cloud || !cloudUsable) return;
    tagsLoaded.current = false;
    pullTags();
  }, [cloud]);

  // タグを変えたらクラウドにも反映する
  useEffect(() => {
    if (!cloud || !cloudUsable || !loaded || !tagsLoaded.current) return;
    const data = { presetTags: catalog, alertTags };
    const body = JSON.stringify(data);
    if (body === tagsSaved.current) return;
    const t = setTimeout(async () => {
      const ok = await tagsPush(cloud, data).catch(() => false);
      if (ok) tagsSaved.current = body;
    }, 3000);
    return () => clearTimeout(t);
  }, [catalog, alertTags, cloud, loaded]);

  // パソコンで共有しているプロジェクトの一覧をもらう
  const refreshProjects = async (conf = cloud) => {
    if (!conf) return;
    try {
      const list = await projectList(conf);
      setProjects(list);
      if (target && !list.some((p) => p.id === target.id)) setTarget(null);
    } catch (e) { /* つながらないときは何もしない */ }
  };

  useEffect(() => {
    if (cloud && cloudUsable) refreshProjects();
  }, [cloud]);

  // まとめ先の追加・削除・色変更
  const addArea = () => {
    const name = newArea.trim();
    if (!name || areas.some((a) => a.name === name)) { setNewArea(""); return; }
    setAreas((as) => [...as, { name, color: AREA_COLORS[as.length % AREA_COLORS.length] }]);
    setNewArea("");
    setArea(name);
  };
  const removeArea = (name) => {
    setAreas((as) => as.filter((a) => a.name !== name));
    if (area === name) setArea("");
  };
  const cycleAreaColor = (name) =>
    setAreas((as) =>
      as.map((a) => {
        if (a.name !== name) return a;
        const i = AREA_COLORS.indexOf(a.color);
        return { ...a, color: AREA_COLORS[(i + 1) % AREA_COLORS.length] };
      })
    );
  const moveArea = (i, d) =>
    setAreas((as) => {
      const t = as[i + d];
      if (!t) return as;
      const n = [...as];
      n[i + d] = n[i];
      n[i] = t;
      return n;
    });
  const areaColorOf = (name) => areas.find((a) => a.name === name)?.color || "#C6C1B6";

  const tagColorOf = (t) => tagColorOfIn(catalog, t, alertTags);

  // タグ表の編集
  const addCategory = () => {
    const name = newCat.trim();
    if (!name) return;
    setCatalog((c) => [...c, { name, color: CAT_COLORS[c.length % CAT_COLORS.length], tags: [] }]);
    setNewCat("");
    say(`「${name}」を追加しました`);
  };
  const removeCategory = (ci) => setCatalog((c) => c.filter((_, i) => i !== ci));
  const moveCategory = (ci, d) =>
    setCatalog((c) => {
      const t = c[ci + d];
      if (!t) return c;
      const n = [...c];
      n[ci + d] = n[ci];
      n[ci] = t;
      return n;
    });
  const renameCategory = (ci, name) =>
    setCatalog((c) => c.map((x, i) => (i === ci ? { ...x, name } : x)));
  const addTagToCat = () => {
    const name = newTag.name.trim();
    if (!name) return;
    setCatalog((c) =>
      c.map((x, i) => (i === newTag.cat ? { ...x, tags: [...new Set([...x.tags, name])] } : x))
    );
    setNewTag((v) => ({ ...v, name: "" }));
    say(`タグ「${name}」を追加しました`);
  };
  const removeTagFromCat = (ci, t) =>
    setCatalog((c) => c.map((x, i) => (i === ci ? { ...x, tags: x.tags.filter((y) => y !== t) } : x)));
  const moveTag = (ci, ti, d) =>
    setCatalog((c) =>
      c.map((x, i) => {
        if (i !== ci) return x;
        const t = x.tags[ti + d];
        if (t === undefined) return x;
        const n = [...x.tags];
        n[ti + d] = n[ti];
        n[ti] = t;
        return { ...x, tags: n };
      })
    );

  // クラウド設定の読み込み。他の読み込みと分けて、確実に復元されるようにする
  useEffect(() => {
    const c = loadCloudConf();
    if (c) {
      setCloud(c);
      setCloudForm(c);
      return;
    }
    const d = loadCloudDraft();
    if (d) setCloudForm(d);
  }, []);

  // 入力した内容はその場で控えておく（確認が通る前に閉じても消えない）
  useEffect(() => {
    if (cloudForm.projectId || cloudForm.apiKey || cloudForm.room) saveCloudDraft(cloudForm);
  }, [cloudForm]);

  // 電波が無くても開ける状態かどうか（httpsで開いていないと使えない）
  useEffect(() => {
    const secure = location.protocol === "https:" || location.hostname === "localhost";
    if (!("serviceWorker" in navigator) || !secure) { setOfflineReady(false); return; }
    const check = () =>
      navigator.serviceWorker.getRegistration()
        .then((r) => setOfflineReady(!!(r && (r.active || navigator.serviceWorker.controller))))
        .catch(() => setOfflineReady(false));
    check();
    const t = setTimeout(check, 4000);
    return () => clearTimeout(t);
  }, []);

  const say = (m) => {
    setToast(m);
    setTimeout(() => setToast(null), 1800);
  };

  const add = () => {
    if (!text.trim() && !title.trim()) return;
    const item = {
      id: Date.now() + "", t: Date.now(),
      title: useTitle ? title.trim() : "", text: text.trim(), color, tags, area,
      targetProjectId: target?.id || "", targetProjectName: target?.name || "",
    };
    setItems((is) => [...is, item]); // 下に足していく（この順番でパソコンに並ぶ）
    // クラウド同期を設定していれば、その場でPCへ送る（失敗しても手元には残る）
    if (cloud && cloudUsable) {
      setUnsent((u) => [...u, item.id]);
      pushToCloud([item]);
    }
    setText("");
    setTitle("");
    setTags([]);
    setColor(DEFAULT_COLOR);
    setUseTitle(false);
    // まとめ先は続けて使うことが多いので残しておく
    say("追加しました");
    areaRef.current?.focus();
  };

  const remove = (id) => {
    setItems((is) => is.filter((i) => i.id !== id));
    setPicked((p) => p.filter((x) => x !== id));
  };

  // --- 選ぶ ---
  const togglePick = (id) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const pickAll = () => setPicked(items.map((i) => i.id));
  const pickNone = () => setPicked([]);
  // 選んでいなければ全部が対象
  const targetItems = () => (picked.length > 0 ? items.filter((i) => picked.includes(i.id)) : items);

  const removePicked = () => {
    setItems((is) => is.filter((i) => !picked.includes(i.id)));
    setPicked([]);
    say("選んだものを消しました");
  };

  // --- 並び替え（この順番でパソコンに取り込まれる） ---
  const moveItem = (id, d) =>
    setItems((is) => {
      const i = is.findIndex((x) => x.id === id);
      if (i < 0 || !is[i + d]) return is;
      const n = [...is];
      const t = n[i + d];
      n[i + d] = n[i];
      n[i] = t;
      return n;
    });

  // --- 書き出し ---
  const toText = () =>
    targetItems()
      .map((i) => {
        const head = i.title ? `【${i.title}】` : "";
        const tg = i.tags.length ? ` #${i.tags.join(" #")}` : "";
        const ar = i.area ? `（${i.area}）` : "";
        return `${ar}${head}${i.text}${tg}`;
      })
      .join("\n---\n");

  // CSVは Excel などで開けるよう、引用符とBOMを付ける
  const toCsv = () => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["順番", "まとめ先", "タイトル", "本文", "タグ", "色", "作成日時"]];
    targetItems().forEach((i, n) => {
      rows.push([
        n + 1,
        i.area || "",
        i.title || "",
        i.text || "",
        (i.tags || []).join(" / "),
        COLORS[i.color]?.name || "",
        new Date(i.t).toLocaleString("ja-JP"),
      ]);
    });
    return "\uFEFF" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  };

  const shareCsv = async () => {
    const csv = toCsv();
    const name = `ideaboard_${new Date().toISOString().slice(0, 10)}.csv`;
    // ファイルとして共有できる端末ではそれを使う
    try {
      const file = new File([csv], name, { type: "text/csv" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "IdeaBoard" });
        return;
      }
    } catch (e) { /* 共有できない場合は下へ */ }
    try {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      say("CSVを保存しました");
    } catch (e) {
      copyOut(csv, "CSVをコピーしました");
    }
  };


  const copyOut = async (payload, msg) => {
    try {
      await navigator.clipboard.writeText(payload);
      say(msg);
    } catch (e) {
      say("コピーできませんでした");
    }
  };

  const share = async () => {
    const payload = toText();
    if (!payload) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "IdeaBoard の下書き", text: payload });
        return;
      } catch (e) {
        /* キャンセル時は何もしない */
      }
    }
    copyOut(payload, "コピーしました");
  };

  // --- クラウド同期（出先でもPCに届く） ---
  // 送る形に整える（色やカテゴリも一緒に渡す）
  const toPayload = (i) => ({
    ...i,
    colorName: COLORS[i.color]?.name,
    colorBg: COLORS[i.color]?.bg,
    // まとめ先を指定していればそれを、なければタグのカテゴリをまとまりの手がかりにする
    area: i.area || "",
    areaColor: i.area ? areaColorOf(i.area) : "",
    // どのプロジェクト宛てか（パソコン側で選ぶときの目印になる）
    targetProjectId: i.targetProjectId || target?.id || "",
    targetProjectName: i.targetProjectName || target?.name || "",
    category: (catalog.find((c) => (c.tags || []).some((t) => (i.tags || []).includes(t))) || {}).name || "",
    dataVersion: DATA_VERSION,
    tagCatalog: catalog,
  });

  const cloudUsable = !standalone; // ホーム画面アプリでは設定が消えるため使わない

  const pushToCloud = async (list) => {
    if (!cloud || !cloudUsable || !list || list.length === 0) return false;
    try {
      await cloudPush(cloud, list.map(toPayload));
      setUnsent((u) => u.filter((id) => !list.some((x) => x.id === id)));
      return true;
    } catch (e) {
      setUnsent((u) => [...new Set([...u, ...list.map((x) => x.id)])]);
      return false;
    }
  };

  // まだ送れていないものをまとめて送り直す
  const retryUnsent = async () => {
    if (!cloud || unsent.length === 0) return;
    setSyncing(true);
    const list = items.filter((i) => unsent.includes(i.id));
    const ok = await pushToCloud(list);
    setSyncing(false);
    say(ok ? "PCへ送りました" : "まだ送れません（電波を確認してください）");
  };

  // 通信が戻ったら自動で送り直す
  useEffect(() => {
    if (!cloud) return;
    const onOnline = () => { retryUnsent(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [cloud, unsent, items]);

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
      setCloudMsg(stored ? "つながりました（設定を保存しました）" : "つながりましたが、設定を保存できませんでした");
    } catch (e) {
      setCloudMsg(String(e.message || e));
    }
  };

  const clearAll = () => {
    setItems([]);
    setConfirmClear(false);
    say("アイデアボックスを空にしました");
  };


  const c = COLORS[color];

  return (
    <div
      style={{
        position: "fixed", inset: 0, display: "flex", flexDirection: "column",
        background: "#F6F2E9", color: "#3E3A33",
        fontFamily: "'Zen Maru Gothic','Hiragino Maru Gothic ProN',sans-serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700&display=swap');
        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box }
        textarea:focus, input:focus { outline: none }
        button { font-family: inherit }
      `}</style>

      {/* ヘッダー */}
      <div style={{ background: "#3E3A33", color: "#F6F2E9", padding: "calc(10px + var(--safe-t, 0px)) 14px 10px", display: "flex", alignItems: "center", gap: 10 }}>
        <strong style={{ fontSize: 15, flex: 1 }}>アイデアボックス</strong>
        {cloud && cloudUsable ? (
          <span style={{ fontSize: 11, opacity: 0.85 }}>
            {unsent.length > 0 ? `○ 未送信${unsent.length}` : "● 同期中"}
          </span>
        ) : null}
        <button
          onClick={() => setHelpOpen(true)}
          title="使い方"
          style={{
            border: "1px solid rgba(246,242,233,.5)", borderRadius: "50%",
            width: 22, height: 22, background: "transparent", color: "#F6F2E9",
            fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0, flexShrink: 0,
          }}
        >
          i
        </button>
        <button
          onClick={() => setSetupOpen(true)}
          title="設定"
          style={{ border: "none", background: "transparent", color: "#F6F2E9", fontSize: 17, cursor: "pointer", padding: "0 2px" }}
        >
          ⚙
        </button>
      </div>

      {/* タブ */}
      <div style={{ display: "flex", background: "#4A463E" }}>
        {[
          ["write", "書く"],
          ["list", `ためた分 (${items.length})`],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              flex: 1, border: "none", padding: "11px 0", fontSize: 13.5, cursor: "pointer",
              background: tab === k ? "#F6F2E9" : "transparent",
              color: tab === k ? "#3E3A33" : "#CFC9BD",
              fontWeight: tab === k ? 700 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 書く */}
      {tab === "write" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          <div
            style={{
              background: c.bg, borderTop: `10px solid ${c.edge}`, borderRadius: 6,
              boxShadow: "2px 4px 10px rgba(60,50,30,.18)", padding: "10px 12px 12px", marginBottom: 14,
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 8 }}>
              <input type="checkbox" checked={useTitle} onChange={(e) => setUseTitle(e.target.checked)} style={{ width: 16, height: 16 }} />
              タイトルを付ける
            </label>
            {useTitle && (
              <input
                value={title}
                placeholder="タイトル"
                onChange={(e) => setTitle(e.target.value)}
                style={{
                  width: "100%", border: "none", borderBottom: "1px solid rgba(62,58,51,.25)",
                  background: "transparent", fontSize: 15, fontWeight: 700, padding: "4px 2px 6px",
                  marginBottom: 8, fontFamily: "inherit", color: "#3E3A33",
                }}
              />
            )}
            <textarea
              ref={areaRef}
              value={text}
              placeholder="アイデアを書く"
              onChange={(e) => setText(e.target.value)}
              rows={6}
              style={{
                width: "100%", border: "none", background: "transparent", resize: "none",
                fontSize: 16, lineHeight: 1.7, fontFamily: "inherit", color: "#3E3A33",
              }}
            />
          </div>

          {/* 送り先のプロジェクト */}
          {cloud && cloudUsable && (
            <div
              onClick={() => { setTargetOpen(true); refreshProjects(); }}
              style={{
                display: "flex", alignItems: "center", gap: 8, marginBottom: 14,
                border: "1px solid #C9C2B2", borderRadius: 10, padding: "9px 12px",
                background: "#FFFDF6", cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 11, color: "#9C9587", flexShrink: 0 }}>送り先</span>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {target ? target.name : "指定なし"}
              </span>
              <span style={{ fontSize: 11, color: "#6B665C" }}>変更</span>
            </div>
          )}

          {/* まとめ先（PCで領域になる） */}
          <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: "#9C9587", flex: 1 }}>まとめ先（PCで囲みになります）</span>
            <button
              onClick={() => setAreaEditOpen(true)}
              style={{ border: "1px solid #C9C2B2", borderRadius: 14, background: "transparent", color: "#6B665C", fontSize: 11, padding: "3px 12px", cursor: "pointer" }}
            >
              編集
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
            <button
              onClick={() => setArea("")}
              style={{
                border: "none", borderRadius: 14, padding: "6px 14px", fontSize: 13, cursor: "pointer",
                fontWeight: 700,
                background: area === "" ? "#3E3A33" : "rgba(62,58,51,.1)",
                color: area === "" ? "#F6F2E9" : "#6B665C",
              }}
            >
              なし
            </button>
            {areas.map((a) => (
              <button
                key={a.name}
                onClick={() => setArea(a.name)}
                style={{
                  border: `2px solid ${a.color}`, borderRadius: 14, padding: "5px 13px", fontSize: 13,
                  cursor: "pointer", fontWeight: 700,
                  background: area === a.name ? a.color : "transparent",
                  color: area === a.name ? "#3E3A33" : "#6B665C",
                }}
              >
                {a.name}
              </button>
            ))}
            {areas.length === 0 && (
              <span style={{ fontSize: 11, color: "#9C9587", alignSelf: "center" }}>
                「編集」から作れます（例: 第1章／キャラ案）
              </span>
            )}
          </div>

          {/* 色 */}
          <div style={{ fontSize: 11, color: "#9C9587", marginBottom: 6 }}>色</div>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            {COLORS.map((col, i) => (
              <button
                key={col.name}
                onClick={() => setColor(i)}
                style={{
                  width: 34, height: 34, borderRadius: "50%", background: col.bg, padding: 0, cursor: "pointer",
                  border: color === i ? "3px solid #3E3A33" : "1px solid rgba(0,0,0,.15)",
                }}
              />
            ))}
          </div>

          {/* タグ */}
          <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: "#9C9587", flex: 1 }}>タグ</span>
            <button
              onClick={() => setTagEditOpen(true)}
              style={{ border: "1px solid #C9C2B2", borderRadius: 14, background: "transparent", color: "#6B665C", fontSize: 11, padding: "3px 12px", cursor: "pointer" }}
            >
              タグを編集
            </button>
          </div>
          {catalog.map((cat) => (
            <div key={cat.name} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: cat.color, marginBottom: 4 }}>{cat.name}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {cat.tags.map((t) => {
                  const on = tags.includes(t);
                  const tc = tagColorOf(t);
                  return (
                    <button
                      key={t}
                      onClick={() => setTags((ts) => (on ? ts.filter((x) => x !== t) : [...ts, t]))}
                      style={{
                        border: "none", borderRadius: 14, padding: "6px 12px", fontSize: 13, cursor: "pointer",
                        fontWeight: 700, background: on ? tc : tint(tc, 0.15), color: on ? "#FFFDF6" : tc,
                      }}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div style={{ height: 80 }} />
        </div>
      )}

      {/* ためた分 */}
      {tab === "list" && (() => {
        // クラウド同期を使っているときは「まだ送っていないもの」と「これまで全部」を分けて見られる
        const shown = cloud && cloudUsable && listFilter === "unsent"
          ? items.filter((i) => unsent.includes(i.id))
          : items;
        return (
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {cloud && cloudUsable && (
            <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid #C9C2B2", marginBottom: 12 }}>
              <button
                onClick={() => { setListFilter("unsent"); setPicked([]); }}
                style={{
                  flex: 1, border: "none", padding: "8px 0", fontSize: 12.5, cursor: "pointer",
                  background: listFilter === "unsent" ? "#3E3A33" : "transparent",
                  color: listFilter === "unsent" ? "#F6F2E9" : "#6B665C",
                  fontWeight: listFilter === "unsent" ? 700 : 400,
                }}
              >
                まだ送っていない（{unsent.length}）
              </button>
              <button
                onClick={() => { setListFilter("all"); setPicked([]); }}
                style={{
                  flex: 1, border: "none", padding: "8px 0", fontSize: 12.5, cursor: "pointer",
                  background: listFilter === "all" ? "#3E3A33" : "transparent",
                  color: listFilter === "all" ? "#F6F2E9" : "#6B665C",
                  fontWeight: listFilter === "all" ? 700 : 400,
                }}
              >
                これまで全部（{items.length}）
              </button>
            </div>
          )}
          {shown.length === 0 && (
            <p style={{ color: "#9C9587", fontSize: 14, textAlign: "center", marginTop: 40 }}>
              {items.length === 0
                ? "まだありません。「書く」から追加してください"
                : "まだ送っていないものはありません"}
            </p>
          )}
          {shown.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "#6B665C", flex: 1 }}>
                {picked.length > 0 ? `${picked.length}件を選択中` : "上から順にパソコンへ並びます"}
              </span>
              <button
                onClick={picked.length === shown.length ? pickNone : () => setPicked(shown.map((i) => i.id))}
                style={{ border: "1px solid #C9C2B2", borderRadius: 14, background: "transparent", color: "#6B665C", fontSize: 11, padding: "4px 12px", cursor: "pointer" }}
              >
                {picked.length === shown.length ? "選択を解除" : "すべて選ぶ"}
              </button>
              {picked.length > 0 && (
                <button
                  onClick={removePicked}
                  style={{ border: "1px solid #C6392B", borderRadius: 14, background: "transparent", color: "#C6392B", fontSize: 11, fontWeight: 700, padding: "4px 12px", cursor: "pointer" }}
                >
                  消す
                </button>
              )}
            </div>
          )}
          {shown.map((i) => {
            const col = COLORS[i.color] || COLORS[DEFAULT_COLOR];
            const notSent = unsent.includes(i.id);
            return (
              <div
                key={i.id}
                style={{
                  background: col.bg, borderTop: `6px solid ${col.edge}`, borderRadius: 5,
                  boxShadow: "1px 3px 7px rgba(60,50,30,.16)", padding: "8px 10px 10px", marginBottom: 10,
                  overflow: "hidden", maxWidth: "100%",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={picked.includes(i.id)}
                    onChange={() => togglePick(i.id)}
                    style={{ width: 20, height: 20, flexShrink: 0, marginTop: 2, cursor: "pointer" }}
                  />
                  <div style={{ flex: 1 }}>
                    {i.title && (
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                        {i.title}
                      </div>
                    )}
                    <div style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                      {i.text}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
                    <button
                      onClick={() => moveItem(i.id, -1)}
                      title="上へ"
                      style={{ border: "none", background: "transparent", color: "rgba(62,58,51,.55)", fontSize: 14, cursor: "pointer", padding: "0 4px" }}
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveItem(i.id, 1)}
                      title="下へ"
                      style={{ border: "none", background: "transparent", color: "rgba(62,58,51,.55)", fontSize: 14, cursor: "pointer", padding: "0 4px" }}
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => remove(i.id)}
                      style={{ border: "none", background: "transparent", color: "rgba(62,58,51,.5)", fontSize: 14, cursor: "pointer", padding: "0 4px" }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {i.targetProjectName && (
                  <div style={{ fontSize: 10, color: "#6B665C", marginTop: 5 }}>
                    → {i.targetProjectName}
                  </div>
                )}
                {i.area && (
                  <div style={{ marginTop: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "1px 7px", background: areaColorOf(i.area), color: "#3E3A33" }}>
                      {i.area}
                    </span>
                  </div>
                )}
                {i.tags.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                    {i.tags.map((t) => (
                      <span key={t} style={{ fontSize: 10, fontWeight: 700, borderRadius: 8, padding: "1px 7px", background: "rgba(255,253,246,.85)", color: tagColorOf(t) }}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 10, color: "rgba(62,58,51,.45)", marginTop: 5, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>{new Date(i.t).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  {cloud && cloudUsable && (
                    notSent
                      ? <span style={{ color: "#A23A2E", fontWeight: 700 }}>未送信</span>
                      : <span style={{ color: "#3E6B3E" }}>送信済み</span>
                  )}
                </div>
              </div>
            );
          })}
          {items.length > 0 && (
            <>
              {cloud && !cloudUsable ? (
                <div style={{ background: "#FFF3D6", color: "#8A6A1F", borderRadius: 10, padding: "10px 12px", marginTop: 16, fontSize: 11.5, lineHeight: 1.8 }}>
                  ホーム画面から開いた場合、設定を覚えておけないためクラウド同期は使えません。<br />
                  下の「CSVで出力」または「共有・コピー」でパソコンへ渡してください。
                </div>
              ) : cloud && cloudUsable ? (
                unsent.length > 0 ? (
                  <button
                    onClick={retryUnsent}
                    disabled={syncing}
                    style={{
                      width: "100%", border: "none", borderRadius: 10, marginTop: 16,
                      background: syncing ? "#C9C2B2" : "#3E3A33", color: "#F6F2E9",
                      fontSize: 15, fontWeight: 700, padding: "14px 0", cursor: "pointer",
                    }}
                  >
                    {syncing ? "送信中…" : `PCへ送る（未送信 ${unsent.length}件）`}
                  </button>
                ) : (
                  <div style={{ background: "rgba(76,122,76,.12)", color: "#3E6B3E", borderRadius: 10, padding: "10px 12px", marginTop: 16, fontSize: 12, lineHeight: 1.7, textAlign: "center" }}>
                    すべてPCへ送信済みです。<br />
                    PCの「デバイス接続」から取り込めます。
                  </div>
                )
              ) : null}
              <div style={{ fontSize: 11, color: "#9C9587", marginTop: 14, marginBottom: 6 }}>
                {picked.length > 0 ? `選んだ${picked.length}件を書き出す` : `すべて（${items.length}件）を書き出す`}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={share}
                  style={{ flex: 1, border: "1px solid #C9C2B2", borderRadius: 8, background: "transparent", color: "#3E3A33", fontSize: 13, padding: "11px 0", cursor: "pointer" }}
                >
                  共有・コピー
                </button>
                <button
                  onClick={shareCsv}
                  style={{ flex: 1, border: "1px solid #C9C2B2", borderRadius: 8, background: "transparent", color: "#3E3A33", fontSize: 13, padding: "11px 0", cursor: "pointer" }}
                >
                  CSVで出力
                </button>
              </div>
              <button
                onClick={() => setConfirmClear(true)}
                style={{
                  width: "100%", border: "1.5px solid #C6392B", borderRadius: 8, marginTop: 14,
                  background: "rgba(198,57,43,.08)", color: "#C6392B",
                  fontSize: 13, fontWeight: 700, padding: "11px 0", cursor: "pointer",
                }}
              >
                アイデアボックスを空にする
              </button>
              <div style={{ height: "calc(60px + var(--safe-b, 0px))" }} />
            </>
          )}
        </div>
        );
      })()}

      {/* 追加ボタン（書くタブのみ） */}
      {tab === "write" && (
        <div style={{ position: "absolute", left: 14, right: 14, bottom: 16 }}>
          <button
            onClick={add}
            disabled={!text.trim() && !title.trim()}
            style={{
              width: "100%", border: "none", borderRadius: 12,
              background: text.trim() || title.trim() ? "#3E3A33" : "#C9C2B2",
              color: "#F6F2E9", fontSize: 16, fontWeight: 700, padding: "15px 0",
              cursor: "pointer", boxShadow: "0 4px 14px rgba(30,25,15,.3)",
            }}
          >
            ＋ アイデアボックスに入れる
          </button>
        </div>
      )}

      {/* 送り先のプロジェクトを選ぶ */}
      {targetOpen && (
        <div
          onPointerDown={(e) => { if (e.target === e.currentTarget) setTargetOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 205, background: "rgba(40,35,25,.5)", display: "flex", alignItems: "flex-end" }}
        >
          <div style={{ background: "#FFFDF6", borderRadius: "14px 14px 0 0", width: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column", paddingBottom: "var(--safe-b, 0px)" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "14px 16px 8px" }}>
              <strong style={{ fontSize: 15, flex: 1 }}>送り先のプロジェクト</strong>
              <button
                onClick={() => setTargetOpen(false)}
                style={{ border: "none", background: "#3E3A33", color: "#F6F2E9", borderRadius: 8, fontSize: 13, fontWeight: 700, padding: "7px 16px", cursor: "pointer" }}
              >
                閉じる
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
              <p style={{ fontSize: 11.5, color: "#6B665C", lineHeight: 1.8, margin: "0 0 12px" }}>
                ここで選んだプロジェクトを開いているとき、パソコン側で最初から選ばれた状態になります。
                指定しなくても送れます。
              </p>

              <button
                onClick={() => { setTarget(null); setTargetOpen(false); }}
                style={{
                  display: "block", width: "100%", textAlign: "left", cursor: "pointer",
                  border: !target ? "2px solid #3E3A33" : "1px solid #E4DFD2",
                  background: !target ? "rgba(62,58,51,.07)" : "#fff",
                  borderRadius: 10, padding: "11px 13px", marginBottom: 6,
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700 }}>指定なし</div>
                <div style={{ fontSize: 11, color: "#9C9587", marginTop: 2 }}>どのプロジェクトでも取り込めます</div>
              </button>

              {projects.map((p) => {
                const on = target?.id === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => { setTarget({ id: p.id, name: p.name }); setTargetOpen(false); }}
                    style={{
                      display: "block", width: "100%", textAlign: "left", cursor: "pointer",
                      border: on ? "2px solid #3E3A33" : "1px solid #E4DFD2",
                      background: on ? "rgba(62,58,51,.07)" : "#fff",
                      borderRadius: 10, padding: "11px 13px", marginBottom: 6,
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "#9C9587", marginTop: 2 }}>
                      {p.device} / {new Date(p.savedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </button>
                );
              })}

              {projects.length === 0 && (
                <div style={{ background: "rgba(62,58,51,.05)", borderRadius: 10, padding: "12px 14px", fontSize: 11.5, color: "#6B665C", lineHeight: 1.8 }}>
                  まだ見つかりません。<br />
                  パソコン側で「デバイス接続」→「<b>このプロジェクトを共有する</b>」を押すと、ここに出てきます。
                </div>
              )}

              <button
                onClick={() => refreshProjects()}
                style={{ width: "100%", border: "1px solid #C9C2B2", borderRadius: 8, background: "transparent", color: "#3E3A33", fontSize: 12, padding: "9px 0", cursor: "pointer", marginTop: 8 }}
              >
                一覧を読み直す
              </button>
            </div>
          </div>
        </div>
      )}

      {/* まとめ先の編集 */}
      {areaEditOpen && (
        <div
          onPointerDown={(e) => { if (e.target === e.currentTarget) setAreaEditOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(40,35,25,.5)", display: "flex", alignItems: "flex-end" }}
        >
          <div style={{ background: "#FFFDF6", borderRadius: "14px 14px 0 0", width: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column", paddingBottom: "var(--safe-b, 0px)" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "14px 16px 8px" }}>
              <strong style={{ fontSize: 15, flex: 1 }}>まとめ先</strong>
              <button
                onClick={() => setAreaEditOpen(false)}
                style={{ border: "none", background: "#3E3A33", color: "#F6F2E9", borderRadius: 8, fontSize: 13, fontWeight: 700, padding: "7px 16px", cursor: "pointer" }}
              >
                完了
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
              <p style={{ fontSize: 11.5, color: "#6B665C", lineHeight: 1.7, margin: "0 0 10px" }}>
                ここで作った区分ごとに、PCでは<b>色付きの囲み（領域）</b>が作られ、その中に付箋が並びます。
                色をタップすると変えられます。
              </p>

              <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                <input
                  value={newArea}
                  onChange={(e) => setNewArea(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addArea(); }}
                  placeholder="例: 第1章 / キャラ案"
                  style={{ flex: 1, minWidth: 0, border: "1px solid #C9C2B2", borderRadius: 8, background: "#fff", fontSize: 14, padding: "9px 10px", fontFamily: "inherit", color: "#3E3A33" }}
                />
                <button
                  onClick={addArea}
                  style={{ border: "none", borderRadius: 8, background: "#4C7A4C", color: "#FFFDF6", fontSize: 13, fontWeight: 700, padding: "9px 16px", cursor: "pointer" }}
                >
                  追加
                </button>
              </div>

              {areas.length === 0 && (
                <div style={{ fontSize: 12, color: "#9C9587", textAlign: "center", padding: "20px 0" }}>
                  まだありません
                </div>
              )}
              {areas.map((a, i) => (
                <div key={a.name} style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid #E4DFD2", borderRadius: 10, padding: "8px 10px", marginBottom: 6 }}>
                  <button
                    onClick={() => cycleAreaColor(a.name)}
                    title="色を変える"
                    style={{ width: 22, height: 22, borderRadius: 5, background: a.color, border: "1px solid rgba(0,0,0,.15)", cursor: "pointer", flexShrink: 0, padding: 0 }}
                  />
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{a.name}</span>
                  <button onClick={() => moveArea(i, -1)} disabled={i === 0}
                    style={{ border: "none", background: "transparent", color: i === 0 ? "#D9D2C2" : "#6B665C", fontSize: 15, cursor: "pointer", padding: "2px 8px" }}>↑</button>
                  <button onClick={() => moveArea(i, 1)} disabled={i === areas.length - 1}
                    style={{ border: "none", background: "transparent", color: i === areas.length - 1 ? "#D9D2C2" : "#6B665C", fontSize: 15, cursor: "pointer", padding: "2px 8px" }}>↓</button>
                  <button onClick={() => removeArea(a.name)}
                    style={{ border: "none", background: "transparent", color: "#B0483C", fontSize: 14, cursor: "pointer", padding: "2px 8px" }}>✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* タグの編集 */}
      {tagEditOpen && (
        <div
          onPointerDown={(e) => { if (e.target === e.currentTarget) setTagEditOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(40,35,25,.5)", display: "flex", alignItems: "flex-end" }}
        >
          <div
            style={{
              background: "#FFFDF6", borderRadius: "14px 14px 0 0", width: "100%",
              maxHeight: "88vh", display: "flex", flexDirection: "column",
              paddingBottom: "var(--safe-b, 0px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", padding: "14px 16px 8px" }}>
              <strong style={{ fontSize: 15, flex: 1 }}>タグを編集</strong>
              <button
                onClick={() => setTagEditOpen(false)}
                style={{ border: "none", background: "#3E3A33", color: "#F6F2E9", borderRadius: 8, fontSize: 13, fontWeight: 700, padding: "7px 16px", cursor: "pointer" }}
              >
                完了
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
              {cloud && cloudUsable && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(76,122,76,.1)", borderRadius: 10, padding: "9px 11px", marginBottom: 12 }}>
                  <span style={{ flex: 1, fontSize: 11, color: "#3E6B3E", lineHeight: 1.7 }}>
                    タグはパソコンと共有されます。ここで変えると向こうにも反映されます。
                  </span>
                  <button
                    onClick={() => { pullTags(); say("読み直しました"); }}
                    style={{ border: "1px solid #C9C2B2", borderRadius: 8, background: "#fff", color: "#3E3A33", fontSize: 11, padding: "6px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    読み直す
                  </button>
                </div>
              )}

              {/* タグを足す */}
              <div style={{ background: "rgba(62,58,51,.05)", borderRadius: 10, padding: 10, marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "#6B665C", marginBottom: 6 }}>タグを足す</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <select
                    value={newTag.cat}
                    onChange={(e) => setNewTag((v) => ({ ...v, cat: Number(e.target.value) }))}
                    style={{ border: "1px solid #C9C2B2", borderRadius: 8, background: "#fff", fontSize: 13, padding: "8px 6px", fontFamily: "inherit", color: "#3E3A33", maxWidth: 120 }}
                  >
                    {catalog.map((c, i) => (
                      <option key={i} value={i}>{c.name}</option>
                    ))}
                  </select>
                  <input
                    value={newTag.name}
                    onChange={(e) => setNewTag((v) => ({ ...v, name: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") addTagToCat(); }}
                    placeholder="新しいタグ"
                    style={{ flex: 1, minWidth: 0, border: "1px solid #C9C2B2", borderRadius: 8, background: "#fff", fontSize: 14, padding: "8px 10px", fontFamily: "inherit", color: "#3E3A33" }}
                  />
                  <button
                    onClick={addTagToCat}
                    style={{ border: "none", borderRadius: 8, background: "#4C7A4C", color: "#FFFDF6", fontSize: 13, fontWeight: 700, padding: "8px 14px", cursor: "pointer" }}
                  >
                    追加
                  </button>
                </div>
              </div>

              {/* カテゴリごとの一覧 */}
              {catalog.map((cat, ci) => {
                const cc = cat.color || CAT_COLORS[ci % CAT_COLORS.length];
                return (
                  <div key={ci} style={{ border: `1px solid ${tint(cc, 0.35)}`, borderRadius: 10, padding: 10, marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      <span style={{ width: 12, height: 12, borderRadius: 3, background: cc, flexShrink: 0 }} />
                      <input
                        value={cat.name}
                        onChange={(e) => renameCategory(ci, e.target.value)}
                        style={{ flex: 1, minWidth: 0, border: "none", borderBottom: "1px solid transparent", background: "transparent", fontSize: 14, fontWeight: 700, color: "#3E3A33", fontFamily: "inherit", padding: "2px 0" }}
                      />
                      <button onClick={() => moveCategory(ci, -1)} disabled={ci === 0}
                        style={{ border: "none", background: "transparent", color: ci === 0 ? "#D9D2C2" : "#6B665C", fontSize: 15, cursor: "pointer", padding: "2px 6px" }}>↑</button>
                      <button onClick={() => moveCategory(ci, 1)} disabled={ci === catalog.length - 1}
                        style={{ border: "none", background: "transparent", color: ci === catalog.length - 1 ? "#D9D2C2" : "#6B665C", fontSize: 15, cursor: "pointer", padding: "2px 6px" }}>↓</button>
                      <button onClick={() => removeCategory(ci)}
                        style={{ border: "none", background: "transparent", color: "#B0483C", fontSize: 14, cursor: "pointer", padding: "2px 6px" }}>✕</button>
                    </div>
                    {cat.tags.length === 0 && (
                      <div style={{ fontSize: 11, color: "#9C9587" }}>タグがありません</div>
                    )}
                    {cat.tags.map((t, ti) => (
                      <div key={t} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 0" }}>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: tagColorOf(t) }}>{t}</span>
                        <button onClick={() => moveTag(ci, ti, -1)} disabled={ti === 0}
                          style={{ border: "none", background: "transparent", color: ti === 0 ? "#D9D2C2" : "#6B665C", fontSize: 14, cursor: "pointer", padding: "2px 8px" }}>↑</button>
                        <button onClick={() => moveTag(ci, ti, 1)} disabled={ti === cat.tags.length - 1}
                          style={{ border: "none", background: "transparent", color: ti === cat.tags.length - 1 ? "#D9D2C2" : "#6B665C", fontSize: 14, cursor: "pointer", padding: "2px 8px" }}>↓</button>
                        <button onClick={() => removeTagFromCat(ci, t)}
                          style={{ border: "none", background: "transparent", color: "#B0483C", fontSize: 13, cursor: "pointer", padding: "2px 8px" }}>✕</button>
                      </div>
                    ))}
                  </div>
                );
              })}

              {/* カテゴリを足す */}
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <input
                  value={newCat}
                  onChange={(e) => setNewCat(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addCategory(); }}
                  placeholder="新しいカテゴリ"
                  style={{ flex: 1, minWidth: 0, border: "1px dashed #C9C2B2", borderRadius: 8, background: "transparent", fontSize: 14, padding: "9px 10px", fontFamily: "inherit", color: "#3E3A33" }}
                />
                <button
                  onClick={addCategory}
                  style={{ border: "1px solid #C9C2B2", borderRadius: 8, background: "transparent", color: "#3E3A33", fontSize: 13, padding: "9px 14px", cursor: "pointer" }}
                >
                  追加
                </button>
              </div>

              <button
                onClick={() => { setCatalog(DEFAULT_TAGS); say("最初の状態に戻しました"); }}
                style={{ width: "100%", border: "none", background: "transparent", color: "#8A857B", fontSize: 11, padding: "14px 0 4px", cursor: "pointer" }}
              >
                タグを最初の状態に戻す
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 設定 */}
      {setupOpen && (
        <div
          onPointerDown={(e) => { if (e.target === e.currentTarget) setSetupOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(40,35,25,.5)", display: "grid", placeItems: "center", padding: 16, overflowY: "auto" }}
        >
          <div style={{ background: "#FFFDF6", borderRadius: 12, padding: "18px 18px 16px", width: "100%", maxWidth: 360, boxShadow: "0 10px 30px rgba(30,25,15,.35)" }}>
            <div
              style={{
                fontSize: 11.5, borderRadius: 6, padding: "8px 10px", marginBottom: 14, lineHeight: 1.7,
                background: offlineReady ? "rgba(76,122,76,.13)" : "rgba(198,57,43,.1)",
                color: offlineReady ? "#3E6B3E" : "#A23A2E",
              }}
            >
              {offlineReady
                ? "● 電波が無くても開けます"
                : "○ この開き方では、電波が無いときに開けません。https で始まるアドレス（Netlifyなど）で開き、ホーム画面に追加し直してください。"}
            </div>

            <div style={{ fontSize: 10.5, color: "#9C9587", textAlign: "right", marginBottom: 8 }}>版 {APP_VERSION}</div>
            <strong style={{ fontSize: 14, display: "block", marginBottom: 4 }}>クラウド同期</strong>
            <p style={{ fontSize: 11.5, color: "#6B665C", lineHeight: 1.7, margin: "0 0 8px" }}>
              設定すると、どこで書いてもPCに届きます（Wi-Fiが違っても大丈夫）。
              PC側の「デバイス接続」に出る3つの値を入れてください。
            </p>
            {!cloudUsable && (
              <div style={{ background: "#FFF3D6", color: "#8A6A1F", borderRadius: 8, padding: "8px 10px", fontSize: 11.5, lineHeight: 1.7, marginBottom: 8 }}>
                ホーム画面から開いた場合、設定を覚えておけないためクラウド同期は使えません。
                書いたものは「CSVで出力」「共有・コピー」でパソコンへ渡してください。
              </div>
            )}
            {cloud && cloudUsable && (
              <div style={{ background: "rgba(76,122,76,.12)", color: "#3E6B3E", borderRadius: 8, padding: "8px 10px", fontSize: 11.5, lineHeight: 1.7, marginBottom: 8 }}>
                ● 設定済み（合言葉: {cloud.room}）<br />
                この端末に保存されているので、次に開いたときも入力は不要です。
              </div>
            )}
            {cloudUsable && ["projectId", "apiKey", "room"].map((k) => (
              <input
                key={k}
                value={cloudForm[k]}
                onChange={(e) => setCloudForm((v) => ({ ...v, [k]: e.target.value }))}
                placeholder={k === "projectId" ? "プロジェクトID" : k === "apiKey" ? "APIキー" : "合言葉"}
                autoCapitalize="off"
                autoCorrect="off"
                style={{
                  width: "100%", boxSizing: "border-box", border: "1px solid #C9C2B2", borderRadius: 8,
                  background: "#fff", fontSize: 13, padding: "9px 10px", fontFamily: "inherit",
                  color: "#3E3A33", marginBottom: 6,
                }}
              />
            ))}
            {cloudMsg && (
              <div style={{ fontSize: 11.5, color: cloudMsg === "つながりました" ? "#3E6B3E" : "#A23A2E", marginBottom: 6 }}>
                {cloudMsg}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <button
                onClick={saveCloud}
                style={{ flex: 1, border: "none", borderRadius: 8, background: "#3E3A33", color: "#F6F2E9", fontSize: 13, fontWeight: 700, padding: "10px 0", cursor: "pointer" }}
              >
                保存して確認
              </button>
              <button
                onClick={async () => {
                  try {
                    const t = await navigator.clipboard.readText();
                    const d = JSON.parse(t);
                    if (d.projectId && d.apiKey && d.room) {
                      setCloudForm({ projectId: d.projectId, apiKey: d.apiKey, room: d.room });
                      setCloudMsg("貼り付けました。「保存して確認」を押してください");
                    } else setCloudMsg("設定の形式が違います");
                  } catch (e) { setCloudMsg("貼り付けできませんでした"); }
                }}
                style={{ flex: 1, border: "1px solid #C9C2B2", borderRadius: 8, background: "transparent", color: "#3E3A33", fontSize: 12, padding: "10px 0", cursor: "pointer" }}
              >
                設定を貼り付け
              </button>
            </div>
            {cloud && (
              <button
                onClick={() => setConfirmStop(true)}
                style={{ width: "100%", border: "none", background: "transparent", color: "#B0483C", fontSize: 11, padding: "6px 0 10px", cursor: "pointer" }}
              >
                クラウド同期をやめる
              </button>
            )}

            <button
              onClick={() => setSetupOpen(false)}
              style={{ width: "100%", border: "none", background: "transparent", color: "#6B665C", fontSize: 13, padding: "14px 0 2px", cursor: "pointer" }}
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* 使い方 */}
      {helpOpen && (
        <div
          onPointerDown={(e) => { if (e.target === e.currentTarget) setHelpOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 210, background: "rgba(40,35,25,.55)", display: "flex", alignItems: "flex-end" }}
        >
          <div style={{ background: "#FFFDF6", borderRadius: "14px 14px 0 0", width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column", paddingBottom: "var(--safe-b, 0px)" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "14px 16px 8px", borderBottom: "1px solid #E4DFD2" }}>
              <strong style={{ fontSize: 15, flex: 1 }}>使い方</strong>
              <span style={{ fontSize: 10.5, color: "#9C9587", marginRight: 10 }}>版 {APP_VERSION}</span>
              <button
                onClick={() => setHelpOpen(false)}
                style={{ border: "none", background: "#3E3A33", color: "#F6F2E9", borderRadius: 8, fontSize: 13, fontWeight: 700, padding: "7px 16px", cursor: "pointer" }}
              >
                閉じる
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 20px", fontSize: 13, lineHeight: 1.9, color: "#3E3A33" }}>
              <p style={{ margin: "0 0 16px", color: "#6B665C" }}>
                思いついたことをその場で書き留めて、あとでパソコンのボードに貼るためのアプリです。
              </p>

              {[
                {
                  t: "書く",
                  b: [
                    "「書く」タブで文章を入力し、下の大きなボタンでアイデアボックスに入れます。",
                    "**タイトル**にチェックを入れると、見出しを付けられます。パソコンでは一覧の見出しに使われます。",
                    "**送り先**を選ぶと、そのプロジェクトを開いているパソコンで、最初から選ばれた状態で出てきます。指定しなくても送れます。",
                    "**まとめ先**を選ぶと、パソコンでその名前の囲みが作られ、中に付箋が並びます（例: 第1章／キャラ案）。一度選ぶと次の付箋にも引き継がれます。",
                    "**色**と**タグ**は、あとで分類するための目印です。どちらも付けなくてかまいません。",
                  ],
                },
                {
                  t: "ためた分を見る・整える",
                  b: [
                    "「ためた分」タブに、書いたものが上から順に並びます。**この順番のままパソコンに取り込まれます。**",
                    "右の **↑↓** で順番を入れ替えられます。",
                    "左のチェックを付けると、**選んだものだけ**を送る・書き出す・消すことができます。何も選ばなければ全部が対象です。",
                  ],
                },
                {
                  t: "パソコンへ送る",
                  b: [
                    "**クラウド同期**を設定していれば、書いた時点で自動的にパソコンへ送られます。電波が無いときは端末に残り、つながったときにまとめて送られます。",
                    "設定していない場合や、ホーム画面のアイコンから開いている場合は、**共有・コピー**や**CSVで出力**でパソコンに渡してください。",
                    "パソコン側では「デバイス接続」を開き、**届いたものを見てから選んで貼ります**（いらないものは貼らずに消せます）。",
                  ],
                },
                {
                  t: "書き出す",
                  b: [
                    "**共有・コピー**… 文章としてまとめます。メモアプリやメールに貼れます。",
                    "**CSVで出力**… 表計算ソフトで開ける形にします。順番・まとめ先・タイトル・本文・タグ・色・日時が入ります。",
                  ],
                },
                {
                  t: "タグとまとめ先を増やす",
                  b: [
                    "「タグを編集」から、タグやカテゴリを自由に足せます。並び替えもできます。",
                    "ここで増やしたタグは、パソコンに取り込むときに**自動で追加**されます。",
                    "「まとめ先」も同じように足せます。色を決めておくと、パソコンの囲みもその色になります。",
                  ],
                },
                {
                  t: "困ったとき",
                  b: [
                    "**ホーム画面から開くとクラウド同期が使えません**… この開き方では設定を覚えておけないためです。CSVや共有で渡してください。",
                    "**電波が無い場所でも使えます**… 書いたものは端末に残ります。消えることはありません。",
                    "**アイデアボックスを空にすると戻せません**… 送る前に消さないよう気をつけてください。",
                  ],
                },
              ].map((sec) => (
                <div key={sec.t} style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, paddingBottom: 4, borderBottom: "2px solid #E4DFD2" }}>
                    {sec.t}
                  </div>
                  {sec.b.map((line, i) => (
                    <p key={i} style={{ margin: "0 0 8px", fontSize: 12.5, lineHeight: 1.9 }}>
                      {line.split("**").map((part, j) =>
                        j % 2 === 1 ? <b key={j}>{part}</b> : <span key={j}>{part}</span>
                      )}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* クラウド同期をやめる確認 */}
      {confirmStop && (
        <div
          onPointerDown={(e) => { if (e.target === e.currentTarget) setConfirmStop(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 220, background: "rgba(40,35,25,.5)", display: "grid", placeItems: "center", padding: 20 }}
        >
          <div style={{ background: "#FFFDF6", borderRadius: 12, padding: 18, width: "100%", maxWidth: 320, boxShadow: "0 10px 30px rgba(30,25,15,.35)" }}>
            <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700 }}>クラウド同期をやめますか？</p>
            <p style={{ margin: "0 0 16px", fontSize: 12, color: "#6B665C", lineHeight: 1.8 }}>
              これ以降、書いたものはパソコンへ自動で送られなくなります。
              アイデアボックスの中身は消えません。<br />
              もう一度使うときは、設定を入れ直す必要があります。
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setConfirmStop(false)}
                style={{ flex: 1, border: "1px solid #C9C2B2", borderRadius: 8, background: "transparent", color: "#3E3A33", fontSize: 14, padding: "11px 0", cursor: "pointer" }}
              >
                やめない
              </button>
              <button
                onClick={() => {
                  saveCloudConf(null);
                  setCloud(null);
                  setCloudMsg("同期をやめました");
                  setConfirmStop(false);
                }}
                style={{ flex: 1, border: "none", borderRadius: 8, background: "#C6392B", color: "#FFFDF6", fontSize: 14, fontWeight: 700, padding: "11px 0", cursor: "pointer" }}
              >
                やめる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 空にする確認 */}
      {confirmClear && (
        <div
          onPointerDown={(e) => { if (e.target === e.currentTarget) setConfirmClear(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 201, background: "rgba(40,35,25,.5)", display: "grid", placeItems: "center", padding: 20 }}
        >
          <div style={{ background: "#FFFDF6", borderRadius: 12, padding: "18px", width: "100%", maxWidth: 320, boxShadow: "0 10px 30px rgba(30,25,15,.35)" }}>
            <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700 }}>アイデアボックスを空にしますか？</p>
            <p style={{ margin: "0 0 16px", fontSize: 12, color: "#6B665C", lineHeight: 1.7 }}>
              溜めた{items.length}件がすべて消えます。PCへ送っていない分は戻せません。
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setConfirmClear(false)}
                style={{ flex: 1, border: "1px solid #C9C2B2", borderRadius: 8, background: "transparent", color: "#3E3A33", fontSize: 14, padding: "11px 0", cursor: "pointer" }}
              >
                やめる
              </button>
              <button
                onClick={clearAll}
                style={{ flex: 1, border: "none", borderRadius: 8, background: "#C6392B", color: "#FFFDF6", fontSize: 14, fontWeight: 700, padding: "11px 0", cursor: "pointer" }}
              >
                空にする
              </button>
            </div>
          </div>
        </div>
      )}

      {/* トースト */}
      {toast && (
        <div
          style={{
            position: "fixed", left: "50%", bottom: 90, transform: "translateX(-50%)",
            background: "rgba(62,58,51,.92)", color: "#F6F2E9", fontSize: 13,
            padding: "9px 18px", borderRadius: 20, zIndex: 100,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
