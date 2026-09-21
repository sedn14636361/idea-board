// 同期フォルダ（OneDrive / Dropbox / iCloud など）にプロジェクトを読み書きする。
// クラウドサービス側がPC間の転送を担当するので、こちらは「ただのファイル読み書き」に徹する。
const fs = require("fs");
const path = require("path");
const os = require("os");
const { dialog, app } = require("electron");

const CONF = () => path.join(app.getPath("userData"), "sync-config.json");
const EXT = ".ideaboard.json";

function loadConf() {
  try {
    return JSON.parse(fs.readFileSync(CONF(), "utf8"));
  } catch (e) {
    return { folder: null };
  }
}
function saveConf(c) {
  try {
    fs.writeFileSync(CONF(), JSON.stringify(c));
  } catch (e) { /* 保存できなくても動作は続ける */ }
}

let conf = null;
const getConf = () => (conf = conf || loadConf());

function status() {
  const c = getConf();
  const ok = !!c.folder && fs.existsSync(c.folder);
  return { folder: c.folder || null, available: ok, device: os.hostname() };
}

async function choose(win) {
  const r = await dialog.showOpenDialog(win, {
    title: "同期フォルダを選ぶ（OneDrive や Dropbox の中がおすすめ）",
    properties: ["openDirectory", "createDirectory"],
  });
  if (r.canceled || !r.filePaths[0]) return status();
  conf = { folder: r.filePaths[0] };
  saveConf(conf);
  return status();
}

function clear() {
  conf = { folder: null };
  saveConf(conf);
  return status();
}

const fileOf = (id) => path.join(getConf().folder, id + EXT);

// 一覧の結果を覚えておき、ファイルが変わったときだけ読み直す
// （クラウド上のファイルを毎回全部開くと、とても時間がかかるため）
const listCache = new Map(); // ファイル名 -> { mtime, size, meta }

function list() {
  const c = getConf();
  if (!c.folder || !fs.existsSync(c.folder)) return [];
  const out = [];
  for (const f of fs.readdirSync(c.folder)) {
    if (!f.endsWith(EXT)) continue;
    const full = path.join(c.folder, f);
    try {
      const st = fs.statSync(full);
      const hit = listCache.get(f);
      if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) {
        out.push(hit.meta); // 前回から変わっていないので読み直さない
        continue;
      }
      const data = JSON.parse(fs.readFileSync(full, "utf8"));
      const p = data.project || data;
      const meta = {
        id: p.id || f.replace(EXT, ""),
        name: p.name || "（無題）",
        boards: (p.boards || []).length,
        notes: (p.boards || []).reduce((a, b) => a + (b.notes || []).length, 0),
        mtime: st.mtimeMs,
        device: data.device || "",
      };
      listCache.set(f, { mtime: st.mtimeMs, size: st.size, meta });
      out.push(meta);
    } catch (e) { /* 壊れたファイルは無視する */ }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function read(id) {
  try {
    const full = fileOf(id);
    const st = fs.statSync(full);
    const data = JSON.parse(fs.readFileSync(full, "utf8"));
    return { ok: true, project: data.project || data, mtime: st.mtimeMs };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// baseMtime: 最後に読み書きした時刻。ファイルがそれより新しければ他端末が更新している
function write(id, project, baseMtime) {
  const c = getConf();
  if (!c.folder) return { ok: false, error: "同期フォルダが未設定です" };
  try {
    if (!fs.existsSync(c.folder)) fs.mkdirSync(c.folder, { recursive: true });
    const full = fileOf(id);
    if (fs.existsSync(full) && baseMtime) {
      const st = fs.statSync(full);
      // 1秒の誤差は同期サービス側の丸めとみなす
      if (st.mtimeMs - baseMtime > 1000) {
        return { ok: false, conflict: true, mtime: st.mtimeMs };
      }
    }
    const body = JSON.stringify({ project, device: os.hostname(), savedAt: Date.now() });
    const tmp = full + ".tmp";
    fs.writeFileSync(tmp, body);      // 一旦別名で書いてから置き換える（壊れたファイルを残さない）
    fs.renameSync(tmp, full);
    return { ok: true, mtime: fs.statSync(full).mtimeMs };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

function remove(id) {
  try {
    fs.unlinkSync(fileOf(id));
    return { ok: true };
  } catch (e) {
    return { ok: false };
  }
}

module.exports = { status, choose, clear, list, read, write, remove };
