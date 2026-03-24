const {
  app, BrowserWindow, Notification, ipcMain,
  shell, nativeImage, Tray, Menu, globalShortcut
} = require('electron');
const path    = require('path');
const fs      = require('fs');
const updater = require('./updater');

// ── Paths ────────────────────────────────────────────────────────────
const USER_DATA  = app.getPath('userData');
const IMG_DIR    = path.join(USER_DATA, 'images');
const DATA_FILE  = path.join(USER_DATA, 'vault.json');
const BACKUP_DIR = path.join(USER_DATA, 'backups');

for (const dir of [IMG_DIR, BACKUP_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Protocol ─────────────────────────────────────────────────────────
if (process.defaultApp) {
  if (process.argv.length >= 2)
    app.setAsDefaultProtocolClient('myvault', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('myvault');
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

let mainWindow   = null;
let quickAddWin  = null;
let tray         = null;

// ── Main window ──────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800,
    minWidth: 900, minHeight: 600,
    title: 'MyVault',
    backgroundColor: '#0d0d18',
    show: false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webSecurity:      false,
    },
  });

  const htmlPath = path.join(__dirname, 'organizer.html');
  const files    = fs.existsSync(htmlPath) ? [htmlPath] : fs.readdirSync(__dirname).filter(f => f.endsWith('.html')).map(f => path.join(__dirname, f));
  if (files.length) mainWindow.loadURL('file:///' + files[0].replace(/\\/g, '/'));

  mainWindow.once('ready-to-show', () => mainWindow.show());
  setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show(); }, 3000);

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── Quick-add overlay ────────────────────────────────────────────────
function openQuickAdd() {
  if (quickAddWin && !quickAddWin.isDestroyed()) {
    quickAddWin.focus();
    return;
  }
  quickAddWin = new BrowserWindow({
    width: 480, height: 520,
    resizable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload-quickadd.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webSecurity:      false,
    },
  });

  quickAddWin.loadURL('file:///' + path.join(__dirname, 'quick-add.html').replace(/\\/g, '/'));
  quickAddWin.once('ready-to-show', () => {
    quickAddWin.show();
    quickAddWin.focus();
  });
  quickAddWin.on('blur', () => {
    // Close when focus leaves
    if (quickAddWin && !quickAddWin.isDestroyed()) quickAddWin.close();
  });
  quickAddWin.on('closed', () => { quickAddWin = null; });
}

// ── Tray ─────────────────────────────────────────────────────────────
function buildTrayMenu(airingToday = []) {
  const airingItems = airingToday.length
    ? airingToday.slice(0, 5).map(s => ({
        label: `📺 ${s.title} — Ep ${s.episode}`,
        enabled: false,
      }))
    : [{ label: 'No episodes airing today', enabled: false }];

  return Menu.buildFromTemplate([
    { label: 'MyVault', enabled: false },
    { type: 'separator' },
    ...airingItems,
    { type: 'separator' },
    { label: '⚡ Quick Add (Win+Shift+A)', click: openQuickAdd },
    { label: '📖 Open MyVault (Win+Shift+M)', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('MyVault');
  tray.setContextMenu(buildTrayMenu());
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

// ── Global shortcuts ─────────────────────────────────────────────────
function registerShortcuts() {
  // Win+Shift+M — open/focus MyVault
  globalShortcut.register('Super+Shift+M', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });

  // Win+Shift+A — quick-add overlay
  globalShortcut.register('Super+Shift+A', () => {
    openQuickAdd();
  });
}

// ── Daily backup ─────────────────────────────────────────────────────
function scheduleDailyBackup() {
  // Run backup check once on launch, then every hour
  doBackupIfNeeded();
  setInterval(doBackupIfNeeded, 60 * 60 * 1000);
}

function doBackupIfNeeded() {
  if (!fs.existsSync(DATA_FILE)) return;

  const today     = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  const backupFile = path.join(BACKUP_DIR, `vault-backup-${today}.json`);

  // Only backup once per day
  if (fs.existsSync(backupFile)) return;

  try {
    fs.copyFileSync(DATA_FILE, backupFile);
    console.log('[MyVault] Daily backup saved:', backupFile);

    // Keep only last 30 backups
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('vault-backup-'))
      .sort()
      .reverse();
    backups.slice(30).forEach(f => {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
    });
  } catch(e) {
    console.error('[MyVault] Backup failed:', e.message);
  }
}

// ── App events ───────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  createTray();
  registerShortcuts();
  scheduleDailyBackup();
  // Check for updates silently 5 seconds after launch
  setTimeout(() => checkForUpdates(true), 5000);
});

app.on('second-instance', (e, argv) => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  const url = argv.find(a => a.startsWith('myvault://'));
  if (url && mainWindow) mainWindow.webContents.send('protocol-url', url);
});

app.on('open-url', (e, url) => {
  e.preventDefault();
  if (mainWindow) mainWindow.webContents.send('protocol-url', url);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') app.quit();
});

// ── IPC: Notifications ───────────────────────────────────────────────
ipcMain.handle('notify', (e, { title, body }) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title,
    body,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    silent: false,
  });
  n.on('click', () => { mainWindow.show(); mainWindow.focus(); });
  n.show();
});

// ── IPC: Vault data ──────────────────────────────────────────────────
ipcMain.handle('save-data', (e, json) => {
  try {
    fs.writeFileSync(DATA_FILE, json, 'utf8');
    // Trigger backup check after save
    doBackupIfNeeded();
    return { ok: true };
  } catch(err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('load-data', () => {
  try {
    if (!fs.existsSync(DATA_FILE)) return { ok: true, data: null };
    return { ok: true, data: fs.readFileSync(DATA_FILE, 'utf8') };
  } catch(err) { return { ok: false, error: err.message }; }
});

// ── IPC: Images ──────────────────────────────────────────────────────
ipcMain.handle('save-image', (e, { id, dataUrl }) => {
  try {
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const ext    = dataUrl.includes('png') ? 'png' : 'jpg';
    const file   = path.join(IMG_DIR, `${id}.${ext}`);
    fs.writeFileSync(file, Buffer.from(base64, 'base64'));
    return { ok: true, path: 'file:///' + file.replace(/\\/g, '/') };
  } catch(err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('load-image', (e, { id }) => {
  try {
    for (const ext of ['jpg', 'png', 'webp']) {
      const file = path.join(IMG_DIR, `${id}.${ext}`);
      if (fs.existsSync(file)) {
        const buf = fs.readFileSync(file);
        return { ok: true, dataUrl: `data:image/${ext};base64,${buf.toString('base64')}` };
      }
    }
    return { ok: true, dataUrl: null };
  } catch(err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('delete-image', (e, { id }) => {
  try {
    for (const ext of ['jpg', 'png', 'webp']) {
      const file = path.join(IMG_DIR, `${id}.${ext}`);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    return { ok: true };
  } catch(err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('list-images', () => {
  try {
    return { ok: true, ids: fs.readdirSync(IMG_DIR).map(f => f.replace(/\.\w+$/, '')) };
  } catch(err) { return { ok: false, ids: [] }; }
});

// ── IPC: Quick-add (from overlay → main window) ──────────────────────
ipcMain.handle('quick-add-anime', (e, animeData) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('quick-add-anime', animeData);
  }
  return { ok: true };
});

ipcMain.handle('close-quick-add', () => {
  if (quickAddWin && !quickAddWin.isDestroyed()) quickAddWin.close();
});

// ── IPC: Tray update (renderer sends airing data) ────────────────────
ipcMain.handle('update-tray-airing', (e, shows) => {
  if (tray) tray.setContextMenu(buildTrayMenu(shows));
});

// ── IPC: Backup list ─────────────────────────────────────────────────
ipcMain.handle('list-backups', () => {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('vault-backup-'))
      .sort().reverse()
      .slice(0, 10);
    return { ok: true, files };
  } catch(e) { return { ok: true, files: [] }; }
});

ipcMain.handle('restore-backup', (e, filename) => {
  try {
    const src = path.join(BACKUP_DIR, filename);
    const data = fs.readFileSync(src, 'utf8');
    fs.writeFileSync(DATA_FILE, data, 'utf8');
    return { ok: true, data };
  } catch(err) { return { ok: false, error: err.message }; }
});

// ── IPC: Misc ────────────────────────────────────────────────────────
ipcMain.handle('open-url',        (e, url) => shell.openExternal(url));
ipcMain.handle('launch-protocol', (e, url) => shell.openExternal(url));
ipcMain.handle('get-version',     ()       => updater.getLocalVersion() || app.getVersion());
ipcMain.handle('get-paths',       ()       => ({ userData: USER_DATA, imgDir: IMG_DIR, dataFile: DATA_FILE, backupDir: BACKUP_DIR }));

// ── Update helpers ────────────────────────────────────────────────────
function checkForUpdates(silent = false) {
  if (mainWindow) updater.checkForUpdates(mainWindow, silent);
}

// Manual check from renderer (e.g. settings button)
ipcMain.handle('check-updates', () => checkForUpdates(false));

