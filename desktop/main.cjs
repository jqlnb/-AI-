const { app, BrowserWindow, Notification, ipcMain, shell } = require('electron');
const path = require('node:path');

function createWindow() {
  const win = new BrowserWindow({ width: 1420, height: 920, minWidth: 980, minHeight: 680, title: '智能化 AI 日程学习助手', icon: path.join(__dirname, '..', 'assets', 'app.ico'), backgroundColor: '#f6f7fb', show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) shell.openExternal(url); return { action: 'deny' }; });
}
app.whenReady().then(() => { ipcMain.handle('notify', (_event, payload) => { if (Notification.isSupported()) new Notification({ title: payload.title || '学习提醒', body: payload.body || '有一项任务需要关注' }).show(); }); createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
