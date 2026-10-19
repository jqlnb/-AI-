const { app, BrowserWindow, Notification, ipcMain, shell, Tray, Menu } = require('electron');
const path = require('node:path');

let tray;
let quitting = false;
let closeNoticeShown = false;

function createWindow() {
  const win = new BrowserWindow({ width: 1420, height: 920, minWidth: 980, minHeight: 680, title: '智能化 AI 日程学习助手', icon: path.join(__dirname, '..', 'assets', 'app.ico'), backgroundColor: '#f6f7fb', show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  win.once('ready-to-show', () => win.show());
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
    if (!closeNoticeShown && Notification.isSupported()) {
      closeNoticeShown = true;
      new Notification({ title: '应用仍在后台运行', body: '提醒会继续工作。需要完全退出时，请在系统托盘图标菜单中选择“退出应用”。' }).show();
    }
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) shell.openExternal(url); return { action: 'deny' }; });
  return win;
}

function showWindow() {
  const win = BrowserWindow.getAllWindows()[0] || createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

app.whenReady().then(() => {
  ipcMain.handle('notify', (_event, payload) => { if (Notification.isSupported()) new Notification({ title: payload.title || '学习提醒', body: payload.body || '有一项任务需要关注', silent: payload.silent === true }).show(); });
  createWindow();
  tray = new Tray(path.join(__dirname, '..', 'assets', 'app.ico'));
  tray.setToolTip('智能化 AI 日程学习助手 · 提醒正在后台运行');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开主界面', click: showWindow },
    { type: 'separator' },
    { label: '退出应用', click: () => app.quit() },
  ]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  app.on('activate', showWindow);
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {});
