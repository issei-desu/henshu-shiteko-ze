const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

const APP_URL = 'https://issei-desu.github.io/henshu-shiteko-ze/';

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    autoHideMenuBar: false,
    title: 'Multi-Track Chroma Video Editor',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // F5 や Ctrl+R でのリロードができるようにシンプルなメニューを設定
  const template = [
    {
      label: '操作',
      submenu: [
        {
          label: '最新版に再読み込み (リロード)',
          accelerator: 'CmdOrCtrl+R',
          click: () => win.reload()
        },
        {
          label: '強力に再読み込み (キャッシュクリア)',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => win.webContents.reloadIgnoringCache()
        },
        { type: 'separator' },
        {
          label: '終了',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: '表示',
      submenu: [
        { role: 'togglefullscreen', label: '全画面表示切り替え' },
        { role: 'zoomIn', label: '拡大' },
        { role: 'zoomOut', label: '縮小' },
        { role: 'resetZoom', label: '拡大率をリセット' }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Web上のアプリをロード
  win.loadURL(APP_URL).catch(err => {
    console.error('URLの読み込みに失敗しました:', err);
    // 接続できない場合はローカルのファイルをフォールバック表示
    win.loadFile(path.join(__dirname, 'index.html'));
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
