/**
 * updater.js — MyVault Auto-Updater
 * Checks GitHub for a new version.json on launch.
 * Downloads and replaces updated files, then prompts restart.
 */

const { dialog, BrowserWindow } = require('electron');
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const VERSION_URL = 'https://raw.githubusercontent.com/zerkoperzok-sys/myvault-releases/main/version.json';
const APP_DIR     = __dirname; // F:\MyVault-App\
const LOCAL_VER_FILE = path.join(APP_DIR, 'version.json');

// ── Helpers ───────────────────────────────────────────────────────────
function fetchText(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 8000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchText(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const tmp = destPath + '.tmp';
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => {
          // Rename tmp → final (atomic-ish)
          try {
            if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
            fs.renameSync(tmp, destPath);
            resolve();
          } catch(e) { reject(e); }
        });
      });
      out.on('error', (e) => { fs.unlink(tmp, () => {}); reject(e); });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function compareVersions(a, b) {
  // Returns true if b is newer than a
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pb[i]||0) > (pa[i]||0)) return true;
    if ((pb[i]||0) < (pa[i]||0)) return false;
  }
  return false;
}

function getLocalVersion() {
  try {
    if (fs.existsSync(LOCAL_VER_FILE)) {
      const v = JSON.parse(fs.readFileSync(LOCAL_VER_FILE, 'utf8'));
      return v.version || '0.0.0';
    }
  } catch(e) {}
  return '0.0.0';
}

// ── Main check ────────────────────────────────────────────────────────
async function checkForUpdates(mainWindow, silent = false) {
  try {
    console.log('[Updater] Checking for updates...');
    const raw    = await fetchText(VERSION_URL);
    const remote = JSON.parse(raw);
    const local  = getLocalVersion();

    console.log(`[Updater] Local: ${local} | Remote: ${remote.version}`);

    if (!compareVersions(local, remote.version)) {
      console.log('[Updater] Already up to date.');
      if (!silent) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'MyVault',
          message: `✅ You're up to date! (v${local})`,
          buttons: ['OK'],
        });
      }
      return;
    }

    // New version available — ask user
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'MyVault Update Available',
      message: `New version v${remote.version} is available!\n\nCurrent: v${local}`,
      detail: remote.notes || '',
      buttons: ['Update Now', 'Later'],
      defaultId: 0,
    });

    if (response !== 0) return; // user clicked Later

    // Download all updated files
    mainWindow.webContents.send('update-progress', { status: 'downloading', version: remote.version });

    const files = Object.entries(remote.files || {});
    let done = 0;

    for (const [filename, url] of files) {
      const destPath = path.join(APP_DIR, filename);
      console.log(`[Updater] Downloading ${filename}...`);
      try {
        await downloadFile(url, destPath);
        done++;
        mainWindow.webContents.send('update-progress', {
          status: 'downloading',
          file: filename,
          done,
          total: files.length,
        });
      } catch(e) {
        console.error(`[Updater] Failed to download ${filename}:`, e.message);
      }
    }

    // Save new version.json
    fs.writeFileSync(LOCAL_VER_FILE, JSON.stringify(remote, null, 2));

    // Done — prompt restart
    const { response: restartRes } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Complete',
      message: `✅ MyVault updated to v${remote.version}!`,
      detail: 'Restart the app to apply the update.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    });

    if (restartRes === 0) {
      const { app } = require('electron');
      app.relaunch();
      app.quit();
    }

  } catch(e) {
    console.error('[Updater] Check failed:', e.message);
    if (!silent) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Update Check Failed',
        message: 'Could not check for updates.',
        detail: e.message,
        buttons: ['OK'],
      });
    }
  }
}

module.exports = { checkForUpdates, getLocalVersion };
