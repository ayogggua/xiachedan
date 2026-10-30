const { app, BrowserWindow, ipcMain, Menu, clipboard, dialog, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { MenuBar } = require('./menu-bar.cjs');

app.setName('虾扯蛋');
// 保留原应用的数据目录，升级后继续使用已有空间、身份和聊天记录。
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), '邻聊'));
let window, localServer, menuBar, activeOrigin, configPath, quitting = false;
let config = {};
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function saveConfig() {
  fs.writeFileSync(configPath + '.tmp', JSON.stringify(config), { mode: 0o600 });
  fs.renameSync(configPath + '.tmp', configPath);
}

async function openAddress(address, check = true) {
  const { validateAddress } = await import('../shared/invitation.js');
  const origin = validateAddress(address);
  if (check) {
    let response;
    try { response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5000), redirect: 'error' }); }
    catch { throw new Error('无法连接，请检查地址、网络和对方 Mac 上的虾扯蛋是否正在运行'); }
    const result = await response.json();
    if (!response.ok || result.app !== 'linliao') throw new Error('这个地址没有运行虾扯蛋');
  }
  activeOrigin = origin;
  menuBar?.resetSpace();
  config.server = origin;
  saveConfig();
  await window.loadURL(origin === localServer.address ? localServer.setupUrl : origin);
}

function createWindow() {
  window = new BrowserWindow({
    width: 1260, height: 830, minWidth: 800, minHeight: 650,
    title: '虾扯蛋', backgroundColor: '#fcfbf9', titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 17, y: 13 }, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false, backgroundThrottling: false },
  });
  window.once('ready-to-show', () => menuBar.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('will-navigate', (event, target) => { try { if (new URL(target).origin !== activeOrigin) event.preventDefault(); } catch { event.preventDefault(); } });
  window.on('close', event => { if (!quitting && process.platform === 'darwin') { event.preventDefault(); window.hide(); } });
  window.on('closed', () => { window = null; });
  return window;
}

function requireTrusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || new URL(event.senderFrame.url).origin !== activeOrigin) throw new Error('请求来源无效');
}

if (gotLock) {
  app.on('second-instance', () => menuBar?.show());
  app.whenReady().then(async () => {
    configPath = path.join(app.getPath('userData'), 'desktop.json');
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
    const { startServer } = await import(pathToFileURL(path.join(__dirname, '../server/index.js')).href);
    const options = { dataDir: path.join(app.getPath('userData'), 'space'), port: 4318 };
    try { localServer = await startServer(options); }
    catch (error) { if (error.code === 'EADDRINUSE') localServer = await startServer({ ...options, port: 0 }); else throw error; }
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    let connecting = false;
    ipcMain.handle('chat:connect', async (event, invitation, identity) => {
      requireTrusted(event);
      if (connecting) throw new Error('正在连接空间，请稍候');
      connecting = true;
      try {
        const { connectToInvitation } = await import('./connect.mjs');
        const origin = await connectToInvitation(invitation, identity, (url, options) => session.defaultSession.fetch(url, options));
        await openAddress(origin, false);
        return true;
      } finally { connecting = false; }
    });
    ipcMain.handle('chat:home', async event => { requireTrusted(event); await openAddress(localServer.address, false); return true; });
    ipcMain.handle('chat:copy', (event, text) => { requireTrusted(event); if (typeof text !== 'string' || text.length > 100000) throw new Error('复制内容过长'); clipboard.writeText(text); return true; });
    ipcMain.handle('chat:ready', (event, privateMode) => { requireTrusted(event); return menuBar.ready(privateMode); });
    ipcMain.handle('chat:desktop-state', event => { requireTrusted(event); return menuBar.state(); });
    ipcMain.handle('chat:settings', (event, value) => { requireTrusted(event); return menuBar.settings(value); });
    ipcMain.handle('chat:activity', (event, value) => { requireTrusted(event); return menuBar.activity(value); });
    ipcMain.handle('chat:message', (event, value) => { requireTrusted(event); return menuBar.message(value); });
    ipcMain.handle('chat:recalled', (event, value) => { requireTrusted(event); return menuBar.recalled(value); });
    ipcMain.handle('chat:history-cleared', event => { requireTrusted(event); menuBar.clearNotifications(); menuBar.unread.clear(); menuBar.render(); return true; });
    ipcMain.handle('chat:test-notification', event => { requireTrusted(event); return menuBar.testNotification(); });
    ipcMain.handle('chat:notification-settings', event => { requireTrusted(event); return menuBar.openNotificationSettings(); });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '虾扯蛋', submenu: [{ label: '关于虾扯蛋', role: 'about' }, { type: 'separator' }, { label: '显示虾扯蛋', click: () => menuBar.show() }, { label: '返回本机空间', click: () => openAddress(localServer.address, false) }, { type: 'separator' }, { role: 'hide', label: '隐藏虾扯蛋' }, { role: 'hideOthers', label: '隐藏其他应用' }, { role: 'unhide', label: '显示全部' }, { type: 'separator' }, { role: 'quit', label: '退出虾扯蛋' }] },
      { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
      { label: '显示', submenu: [{ role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { type: 'separator' }, { role: 'togglefullscreen', label: '切换全屏' }] },
      { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放' }, { role: 'close', label: '关闭窗口' }] },
    ]));
    if (process.platform === 'darwin') await app.dock.show();
    createWindow();
    menuBar = new MenuBar({ window, getConfig: () => config,
      updateConfig: patch => { Object.assign(config, patch); saveConfig(); },
      home: () => openAddress(localServer.address, false), quit: () => app.quit() });
    try { await openAddress(config.server || localServer.address, Boolean(config.server)); }
    catch { await openAddress(localServer.address, false); }
  }).catch(error => { console.error('虾扯蛋启动失败', error); dialog.showErrorBox('虾扯蛋无法启动', error.message); app.quit(); });
  app.on('activate', () => menuBar?.show());
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', event => {
    if (quitting) return;
    quitting = true;
    menuBar?.destroy();
    if (localServer) { event.preventDefault(); localServer.close().finally(() => app.exit(0)); }
  });
}
