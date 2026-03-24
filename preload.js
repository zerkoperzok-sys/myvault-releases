const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mvApp', {
  isApp: true,

  // ── Notifications ─────────────────────────────────────────────────
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),

  // ── Vault data ────────────────────────────────────────────────────
  saveData: (json) => ipcRenderer.invoke('save-data', json),
  loadData: ()     => ipcRenderer.invoke('load-data'),

  // ── Images ────────────────────────────────────────────────────────
  saveImage:   (id, dataUrl) => ipcRenderer.invoke('save-image',   { id, dataUrl }),
  loadImage:   (id)          => ipcRenderer.invoke('load-image',   { id }),
  deleteImage: (id)          => ipcRenderer.invoke('delete-image', { id }),
  listImages:  ()            => ipcRenderer.invoke('list-images'),

  // ── External links ────────────────────────────────────────────────
  openUrl:        (url) => ipcRenderer.invoke('open-url', url),
  launchProtocol: (url) => ipcRenderer.invoke('launch-protocol', url),

  // ── Tray ──────────────────────────────────────────────────────────
  updateTrayAiring: (shows) => ipcRenderer.invoke('update-tray-airing', shows),

  // ── Backups ───────────────────────────────────────────────────────
  listBackups:   ()         => ipcRenderer.invoke('list-backups'),
  restoreBackup: (filename) => ipcRenderer.invoke('restore-backup', filename),

  // ── App info ──────────────────────────────────────────────────────
  getVersion: () => ipcRenderer.invoke('get-version'),
  getPaths:   () => ipcRenderer.invoke('get-paths'),

  // ── Updates ───────────────────────────────────────────────────────
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (e, data) => cb(data)),

  // ── Protocol URL listener ─────────────────────────────────────────
  onProtocolUrl: (cb) => ipcRenderer.on('protocol-url', (e, url) => cb(url)),

  // ── Quick-add from overlay → main window ─────────────────────────
  onQuickAddAnime: (cb) => ipcRenderer.on('quick-add-anime', (e, data) => cb(data)),
});
