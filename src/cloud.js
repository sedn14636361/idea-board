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

// Firestore の1件あたりの上限は約1MB。余裕を見てこの大きさで判断する
const SIZE_LIMIT = 900 * 1024;

// 画像はデータが大きいので、収まらないときは外して保存する
const stripImages = (project) => ({
  ...project,
  boards: (project.boards || []).map((b) => ({ ...b, images: [] })),
});

export async function projectPush(conf, project, device) {
  const token = await signIn(conf);
  let body = JSON.stringify(project);
  let dropped = false;
  if (body.length > SIZE_LIMIT) {
    body = JSON.stringify(stripImages(project));
    dropped = true;
  }
  if (body.length > SIZE_LIMIT) {
    return { ok: false, tooBig: true };
  }
  const r = await fetch(`${projUrl(conf)}?documentId=${encodeURIComponent(project.id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      fields: {
        payload: { stringValue: body },
        name: { stringValue: project.name || "" },
        device: { stringValue: device || "" },
        savedAt: { integerValue: String(Date.now()) },
      },
    }),
  });
  // 同じIDが既にある場合は上書きする
  if (r.status === 409) {
    const r2 = await fetch(`${projUrl(conf)}/${encodeURIComponent(project.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        fields: {
          payload: { stringValue: body },
          name: { stringValue: project.name || "" },
          device: { stringValue: device || "" },
          savedAt: { integerValue: String(Date.now()) },
        },
      }),
    });
    return { ok: r2.ok, dropped };
  }
  return { ok: r.ok, dropped };
}

// 一覧（中身は取らず、名前と更新時刻だけ）
export async function projectList(conf) {
  const token = await signIn(conf);
  const r = await fetch(`${projUrl(conf)}?pageSize=100&mask.fieldPaths=name&mask.fieldPaths=device&mask.fieldPaths=savedAt`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return [];
  const d = await r.json();
  return (d.documents || [])
    .filter((doc) => !doc.name.split("/").pop().startsWith("__")) // タグ表などは一覧に出さない
    .map((doc) => ({
    id: doc.name.split("/").pop(),
    name: doc.fields?.name?.stringValue || "（無題）",
    device: doc.fields?.device?.stringValue || "",
    savedAt: Number(doc.fields?.savedAt?.integerValue || 0),
  })).sort((a, b) => b.savedAt - a.savedAt);
}

export async function projectPull(conf, id) {
  const token = await signIn(conf);
  const r = await fetch(`${projUrl(conf)}/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const d = await r.json();
  try {
    return {
      project: JSON.parse(d.fields?.payload?.stringValue || "{}"),
      device: d.fields?.device?.stringValue || "",
      savedAt: Number(d.fields?.savedAt?.integerValue || 0),
    };
  } catch (e) {
    return null;
  }
}

export async function projectRemove(conf, id) {
  const token = await signIn(conf);
  await fetch(`${projUrl(conf)}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}

// ============================================================
// 設定の診断（どこでつまずいているかを調べる）
// ============================================================

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
