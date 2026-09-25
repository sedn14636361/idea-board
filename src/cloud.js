// 受信箱をクラウド（Firebase Firestore）経由でやり取りする。
// ライブラリは使わず、通信だけで完結させている。
// 設定は {projectId, apiKey, room} の3つ。room は「どの受信箱を使うか」の合言葉。

const CONF_KEY = "idea-board-cloud";

export const loadCloudConf = () => {
  try {
    const raw = localStorage.getItem(CONF_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    return c && c.projectId && c.apiKey && c.room ? c : null;
  } catch (e) {
    return null;
  }
};

export const saveCloudConf = (c) => {
  try {
    if (!c) localStorage.removeItem(CONF_KEY);
    else localStorage.setItem(CONF_KEY, JSON.stringify(c));
    return true;
  } catch (e) {
    return false; // 保存できない設定（プライベートブラウズ等）
  }
};

// 入力途中の内容。確認が通る前でも消えないように別に持っておく
const DRAFT_KEY = "idea-board-cloud-draft";
export const loadCloudDraft = () => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
};
export const saveCloudDraft = (c) => {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(c));
  } catch (e) { /* 保存できなくても入力は続けられる */ }
};

// 匿名のログイン情報。1時間で切れるので、必要になったら取り直す。
let auth = { token: null, refresh: null, until: 0 };

async function signIn(conf) {
  const now = Date.now();
  if (auth.token && auth.until > now + 60000) return auth.token;

  // 期限が近いだけなら、更新用の合言葉で取り直す
  if (auth.refresh) {
    try {
      const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${conf.apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: auth.refresh }),
      });
      const d = await r.json();
      if (d.id_token) {
        auth = { token: d.id_token, refresh: d.refresh_token, until: now + 3300000 };
        return auth.token;
      }
    } catch (e) { /* だめなら下で作り直す */ }
  }

  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${conf.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const d = await r.json();
  if (!d.idToken) throw new Error(d.error?.message || "ログインできませんでした");
  auth = { token: d.idToken, refresh: d.refreshToken, until: now + 3300000 };
  return auth.token;
}

const docsUrl = (conf) =>
  `https://firestore.googleapis.com/v1/projects/${conf.projectId}/databases/(default)/documents/inbox/${conf.room}/items`;

// 設定が正しいか試す
export async function cloudTest(conf) {
  const token = await signIn(conf);
  const r = await fetch(`${docsUrl(conf)}?pageSize=1`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error?.message || `接続できませんでした (${r.status})`);
  }
  return true;
}

// 付箋をクラウドに置く
export async function cloudPush(conf, items) {
  if (!items || items.length === 0) return 0;
  const token = await signIn(conf);
  let n = 0;
  for (const it of items) {
    const id = String(it.id || Date.now() + Math.random()).replace(/[^\w-]/g, "");
    const r = await fetch(`${docsUrl(conf)}?documentId=${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      // 中身はまとめて1つの文字列にしておく（形式の変換で悩まないため）
      body: JSON.stringify({ fields: { payload: { stringValue: JSON.stringify(it) } } }),
    });
    if (r.ok || r.status === 409) n++; // 409 は同じものを送り直した場合
  }
  return n;
}

// クラウドにある付箋を取り出す
export async function cloudList(conf) {
  const token = await signIn(conf);
  const out = [];
  let pageToken = "";
  for (let i = 0; i < 10; i++) {
    const url = `${docsUrl(conf)}?pageSize=100${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) break;
    const d = await r.json();
    for (const doc of d.documents || []) {
      try {
        const item = JSON.parse(doc.fields?.payload?.stringValue || "{}");
        item._docId = doc.name.split("/").pop();
        out.push(item);
      } catch (e) { /* 壊れたものは飛ばす */ }
    }
    if (!d.nextPageToken) break;
    pageToken = d.nextPageToken;
  }
  return out;
}

// 取り込んだものをクラウドから消す
export async function cloudRemove(conf, docIds) {
  if (!docIds || docIds.length === 0) return;
  const token = await signIn(conf);
  for (const id of docIds) {
    await fetch(`${docsUrl(conf)}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
}

// ============================================================
// プロジェクトの共有（パソコン同士で同じボードを開くため）
// ============================================================

const projUrl = (conf) =>
  `https://firestore.googleapis.com/v1/projects/${conf.projectId}/databases/(default)/documents/projects/${conf.room}/items`;

// ============================================================
// 分割保存（サーバーを保存先の本体にするための土台）
// ------------------------------------------------------------
// Firestore は1件あたり約1MB(バイト)まで。プロジェクトを丸ごと1件に入れると
// すぐ超えるので、**ボードごとに分け、さらに大きければ細切れ**にして保存する。
//   {projectId}                     … 目次（名前・更新時刻・ボードの一覧）。一覧に出るのはこれだけ
//   __b_{projectId}_{boardId}_{i}   … ボードの中身の i 番目のかけら
// 目次以外は "__" で始まるので、projectList には出てこない。
// ============================================================

// **文字数ではなくバイト数で測る**。日本語は1文字3バイトになるので、
// 文字数で判断すると実際の3倍近い大きさのものを「収まる」と誤判定する。
const byteLen = (s) => {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
};

// 1つのかけらの大きさ。1MBの上限に対して、他の項目のぶんの余裕を見ている
const CHUNK = 700 * 1024;

// 文字の切れ目を壊さずにバイト数で切り分ける
export function splitByBytes(str, max = CHUNK) {
  const out = [];
  let buf = "", n = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    const w = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (n + w > max && buf) { out.push(buf); buf = ""; n = 0; }
    buf += ch; n += w;
  }
  if (buf || out.length === 0) out.push(buf);
  return out;
}

// 中身が変わったかどうかの判定だけに使う、軽い指紋
export function hashOf(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (((h << 5) + h) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36) + "-" + str.length.toString(36);
}

const partId = (pid, bid, i) => `__b_${pid}_${bid}_${i}`;

// サーバーの目次から「前回どのボードを何かけらで、どの指紋で保存したか」を読む
const headPrev = async (conf, token, pid) => {
  const r = await fetch(`${projUrl(conf)}/${encodeURIComponent(pid)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return { __parts: {} };
  const d = await r.json();
  if (d.fields?.shape?.stringValue !== "split") return { __parts: {} };
  try {
    const meta = JSON.parse(d.fields.meta.stringValue);
    const prev = { __parts: {} };
    for (const m of meta.boards || []) {
      prev.__parts[m.id] = m.parts;
      if (m.h) prev[m.id] = m.h;
    }
    return prev;
  } catch (e) { return { __parts: {} }; }
};

const putDoc = async (conf, token, id, fields) => {
  const url = `${projUrl(conf)}/${encodeURIComponent(id)}`;
  // PATCH は無ければ作ってくれるので、作成と更新を分けなくてよい
  const r = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields }),
  });
  return r.ok;
};

const getDoc = async (conf, token, id) => {
  const r = await fetch(`${projUrl(conf)}/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  return await r.json();
};

const delDoc = async (conf, token, id) => {
  await fetch(`${projUrl(conf)}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
};

// プロジェクトを分割して保存する。
// prev に前回の指紋を渡すと、**中身が変わったボードだけ**書き込む。
// 返り値の hashes を次回の prev に渡す。
export async function projectPushSplit(conf, project, device, prev = {}) {
  const token = await signIn(conf);
  // 前回の記録が無い（再起動した直後など）ときは、サーバーの目次から復元する。
  // こうしないと、変わっていないボードまで送り直し、消したボードのかけらがサーバーに取り残される。
  if (!prev.__parts) prev = await headPrev(conf, token, project.id);
  const boards = project.boards || [];
  const hashes = {};
  const metaBoards = [];

  for (const b of boards) {
    const body = JSON.stringify(b);
    const h = hashOf(body);
    hashes[b.id] = h;
    const parts = splitByBytes(body);
    metaBoards.push({ id: b.id, parts: parts.length, h });

    if (prev[b.id] === h) continue;              // 変わっていないので書かない
    for (let i = 0; i < parts.length; i++) {
      const ok = await putDoc(conf, token, partId(project.id, b.id, i), {
        part: { stringValue: parts[i] },
      });
      if (!ok) return { ok: false };
    }
    // 前より短くなったとき、余ったかけらを消す
    const before = (prev.__parts && prev.__parts[b.id]) || 0;
    for (let i = parts.length; i < before; i++) await delDoc(conf, token, partId(project.id, b.id, i));
  }

  // 消えたボードのかけらを片づける
  for (const [bid, cnt] of Object.entries((prev.__parts || {}))) {
    if (boards.some((b) => b.id === bid)) continue;
    for (let i = 0; i < cnt; i++) await delDoc(conf, token, partId(project.id, bid, i));
  }

  const savedAt = Date.now();
  const ok = await putDoc(conf, token, project.id, {
    shape: { stringValue: "split" },
    meta: { stringValue: JSON.stringify({ currentBoardId: project.currentBoardId, boards: metaBoards }) },
    name: { stringValue: project.name || "" },
    device: { stringValue: device || "" },
    savedAt: { integerValue: String(savedAt) },
  });
  hashes.__parts = Object.fromEntries(metaBoards.map((m) => [m.id, m.parts]));
  return { ok, hashes, savedAt };
}

// 目次の更新時刻だけを取る。無ければ null（1回の読み取りで済む）
export async function projectHead(conf, id) {
  const token = await signIn(conf);
  const r = await fetch(
    `${projUrl(conf)}/${encodeURIComponent(id)}?mask.fieldPaths=savedAt&mask.fieldPaths=device`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("head " + r.status);   // 電波が無いなど。「無い」とは区別する
  const d = await r.json();
  return { savedAt: Number(d.fields?.savedAt?.integerValue || 0), device: d.fields?.device?.stringValue || "" };
}

// 分割保存されたプロジェクトを組み立てて返す。
// 旧形式（payload に丸ごと）で保存されているものもそのまま読める。
export async function projectPullSplit(conf, id) {
  const token = await signIn(conf);
  const head = await getDoc(conf, token, id);
  if (!head) return null;
  const f = head.fields || {};
  const savedAt = Number(f.savedAt?.integerValue || 0);
  const device = f.device?.stringValue || "";

  // 旧形式
  if (f.payload?.stringValue) {
    try {
      return { project: JSON.parse(f.payload.stringValue), savedAt, device, shape: "whole" };
    } catch (e) { return null; }
  }
  if (f.shape?.stringValue !== "split") return null;

  let meta;
  try { meta = JSON.parse(f.meta?.stringValue || "{}"); } catch (e) { return null; }

  const boards = [];
  const parts = {};
  for (const m of meta.boards || []) {
    const got = await Promise.all(
      Array.from({ length: m.parts }, (_, i) => getDoc(conf, token, partId(id, m.id, i)))
    );
    if (got.some((g) => !g)) return null;        // 欠けているなら組み立てない
    const body = got.map((g) => g.fields?.part?.stringValue || "").join("");
    try { boards.push(JSON.parse(body)); } catch (e) { return null; }
    parts[m.id] = m.parts;
  }

  const hashes = Object.fromEntries(boards.map((b) => [b.id, hashOf(JSON.stringify(b))]));
  hashes.__parts = parts;
  return {
    project: { id, name: f.name?.stringValue || "", boards, currentBoardId: meta.currentBoardId },
    savedAt, device, shape: "split", hashes,
  };
}

// 分割保存されたプロジェクトを、かけらごと消す
export async function projectRemoveSplit(conf, id, partsByBoard) {
  const token = await signIn(conf);
  // かけらの数が分からないときは目次から知る（消し残しを出さないため）
  if (!partsByBoard || Object.keys(partsByBoard).length === 0) partsByBoard = (await headPrev(conf, token, id)).__parts;
  for (const [bid, cnt] of Object.entries(partsByBoard)) {
    for (let i = 0; i < cnt; i++) await delDoc(conf, token, partId(id, bid, i));
  }
  await delDoc(conf, token, id);
  return true;
}

// 一覧（中身は取らず、名前と更新時刻だけ）。
// **最後のページまで読む**。分割保存のかけらも同じ場所にあり、名前が "__" で始まるので並び順で先に来る。
// 1ページで打ち切ると、かけらが100件を超えたときプロジェクト本体が一覧からこぼれ、
// 「サーバーに無い」と取り違えて上書きしてしまう。
// **失敗は例外にする**（空の一覧を返すと「サーバーに何も無い」と取り違える）。
export async function projectList(conf) {
  const token = await signIn(conf);
  const docs = [];
  let pageToken = "";
  for (let n = 0; n < 1000; n++) {
    const r = await fetch(
      `${projUrl(conf)}?pageSize=100&mask.fieldPaths=name&mask.fieldPaths=device&mask.fieldPaths=savedAt` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""),
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!r.ok) throw new Error("list " + r.status);
    const d = await r.json();
    docs.push(...(d.documents || []));
    if (!d.nextPageToken) break;
    pageToken = d.nextPageToken;
  }
  return docs
    .filter((doc) => !doc.name.split("/").pop().startsWith("__")) // タグ表やかけらは一覧に出さない
    .map((doc) => ({
      id: doc.name.split("/").pop(),
      name: doc.fields?.name?.stringValue || "（無題）",
      device: doc.fields?.device?.stringValue || "",
      savedAt: Number(doc.fields?.savedAt?.integerValue || 0),
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export const FIRESTORE_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /inbox/{room}/items/{item} {
      allow read, write: if request.auth != null;
    }
    match /projects/{room}/items/{item} {
      allow read, write: if request.auth != null;
    }
  }
}`;

// 返り値: { ok, step, message }
// step は、どこを直せばよいかの目印
export async function cloudDiagnose(conf) {
  if (!conf.projectId) return { ok: false, step: "input", message: "プロジェクトIDを入れてください" };
  if (!conf.apiKey) return { ok: false, step: "input", message: "APIキーを入れてください" };
  if (!conf.room) return { ok: false, step: "input", message: "合言葉を入れてください" };

  // 1) 匿名ログインができるか
  let token;
  try {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${conf.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    const d = await r.json();
    if (!d.idToken) {
      const msg = d.error?.message || "";
      if (/API_KEY|API key not valid|INVALID_ARGUMENT/i.test(msg)) {
        return { ok: false, step: "key", message: "APIキーが違うようです。プロジェクトの設定から取り直してください。" };
      }
      if (/ADMIN_ONLY_OPERATION|OPERATION_NOT_ALLOWED|CONFIGURATION_NOT_FOUND/i.test(msg)) {
        return { ok: false, step: "auth", message: "匿名ログインが有効になっていません。手順4を見直してください。" };
      }
      return { ok: false, step: "auth", message: `ログインできませんでした（${msg}）` };
    }
    token = d.idToken;
  } catch (e) {
    return { ok: false, step: "net", message: "インターネットにつながっていないようです。" };
  }

  // 2) データの置き場所が使えるか
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${conf.projectId}/databases/(default)/documents/inbox/${conf.room}/items?pageSize=1`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) return { ok: true, step: "done", message: "つながりました" };
    const d = await r.json().catch(() => ({}));
    const msg = d.error?.message || "";
    const status = d.error?.status || "";
    if (status === "PERMISSION_DENIED" || /Missing or insufficient permissions/i.test(msg)) {
      return { ok: false, step: "rules", message: "ルールが設定されていません。手順3のルールを貼り直してください。" };
    }
    if (status === "NOT_FOUND" || r.status === 404) {
      return { ok: false, step: "firestore", message: "データの置き場所が見つかりません。プロジェクトIDを確認するか、手順2をやり直してください。" };
    }
    return { ok: false, step: "other", message: `つながりませんでした（${msg || r.status}）` };
  } catch (e) {
    return { ok: false, step: "net", message: "インターネットにつながっていないようです。" };
  }
}

// 合言葉を自動で作る（推測されにくい文字列）
export const makeRoomKey = () => {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 20; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

// ============================================================
// タグ表の共有（どの端末でも同じタグを使えるように）
// ============================================================

// プロジェクトと同じ置き場所を使う。id を "__" で始めて、
// プロジェクト一覧には出ないようにしている。
const TAGS_DOC = "__tags";

export async function tagsPush(conf, data) {
  const token = await signIn(conf);
  const body = JSON.stringify({
    fields: {
      payload: { stringValue: JSON.stringify(data) },
      savedAt: { integerValue: String(Date.now()) },
    },
  });
  const url = `${projUrl(conf)}/${TAGS_DOC}`;
  // 既にあれば書き換え、無ければ作る
  const r = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body,
  });
  if (r.ok) return true;
  const r2 = await fetch(`${projUrl(conf)}?documentId=${TAGS_DOC}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body,
  });
  return r2.ok;
}

export async function tagsPull(conf) {
  const token = await signIn(conf);
  const r = await fetch(`${projUrl(conf)}/${TAGS_DOC}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  try {
    const d = await r.json();
    const data = JSON.parse(d.fields?.payload?.stringValue || "null");
    if (!data || !Array.isArray(data.presetTags)) return null;
    return {
      presetTags: data.presetTags,
      alertTags: Array.isArray(data.alertTags) ? data.alertTags : [],
      savedAt: Number(d.fields?.savedAt?.integerValue || 0),
    };
  } catch (e) {
    return null;
  }
}
