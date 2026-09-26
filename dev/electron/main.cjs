const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const path = require("path");
const sync = require("./sync.cjs");

const isMac = process.platform === "darwin";

// デスクトップ版では Service Worker を使わない（file:// での読み込みを妨げるため）
app.commandLine.appendSwitch("disable-features", "ServiceWorkerPaymentApps");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 700,
    minHeight: 500,
    title: "IdeaBoard",
    backgroundColor: "#F6F2E9", // 読み込み中に白く光らないように
    // macらしい見た目にする（信号機ボタンは残す）
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  if (isMac) {
    // macでは標準メニューを残す（消すと ⌘C / ⌘V / ⌘Q などが効かなくなる）
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: "appMenu" },
        { role: "editMenu" },
        {
          label: "表示",
          submenu: [
            { role: "reload" },
            { role: "togglefullscreen" },
            { role: "toggleDevTools" },
          ],
        },
        { role: "windowMenu" },
      ])
    );
  } else {
    Menu.setApplicationMenu(null);
  }

  // 画面が真っ白になったときに原因を追えるようにする
  win.webContents.on("before-input-event", (e, input) => {
    if (input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i")) {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });
  win.webContents.on("did-fail-load", (_e, code, desc) => {
    console.error("読み込みに失敗しました", code, desc);
    win.webContents.openDevTools();
  });

  // Service Worker の掃除は index.html 側で行うため、ここでは実行しない
  // （毎回 clearStorageData を呼ぶと起動が遅くなる）

  const indexPath = path.join(__dirname, "../dist/index.html");
  if (!require("fs").existsSync(indexPath)) {
    // ビルド結果が無い場合ははっきり伝える（npm run build のやり忘れ・ビルド失敗）
    win.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          "<body style='font-family:sans-serif;padding:2em;line-height:1.8'>" +
            "<h2>アプリ本体（dist）が見つかりません</h2>" +
            "<p>ビルドが失敗している可能性があります。<br>" +
            "コマンドプロンプトで <b>npm run build</b> を実行し、エラーが出ていないか確認してください。</p></body>"
        )
    );
    return;
  }
  win.loadFile(indexPath);
}

// 設定の案内から、ブラウザでFirebaseの画面を開く
ipcMain.handle("open:external", (e, url) => {
  if (typeof url === "string" && /^https:\/\//.test(url)) shell.openExternal(url);
});

// 同期フォルダ（他のPCと共有する）
ipcMain.handle("sync:status", () => sync.status());
ipcMain.handle("sync:choose", (e) => sync.choose(BrowserWindow.fromWebContents(e.sender)));
ipcMain.handle("sync:clear", () => sync.clear());
ipcMain.handle("sync:list", () => sync.list());
ipcMain.handle("sync:read", (e, id) => sync.read(id));
ipcMain.handle("sync:write", (e, id, project, baseMtime) => sync.write(id, project, baseMtime));
ipcMain.handle("sync:remove", (e, id) => sync.remove(id));

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
