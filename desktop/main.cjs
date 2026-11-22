'use strict';
// SlotForge Circuit desktop shell.
// Runs the same loopback-only server and SQLite workspace as the browser
// launcher (app/serve.cjs, app/disk-store.cjs) and shows it in its own window.
const { app, BrowserWindow, Menu, dialog, shell, session, ipcMain, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const location = require('./data-location.cjs');
const { createTrackFiles } = require('./track-files.cjs');
const { UpdateCheck } = require('./update-check.cjs');

const ROOT = path.resolve(__dirname, '..');
const PREFERRED_PORT = 8173; // Same range as the browser launcher, so each detects the other.
const PORT_COUNT = 20;
const HEALTH_APP = 'SlotForgeTrackBuilder';

const where = location.resolve({ packaged: app.isPackaged });
if (where.profile) app.setPath('userData', where.profile);
app.setAppUserModelId('nl.slotforge.circuit');

function log(message) {
  try {
    fs.mkdirSync(path.dirname(where.log), { recursive: true });
    try {
      if (fs.statSync(where.log).size > 256 * 1024) fs.renameSync(where.log, where.log + '.previous');
    } catch {}
    fs.appendFileSync(where.log, `${new Date().toISOString()} ${message}\n`);
  } catch {}
}

function fail(title, message) {
  log(`${title}: ${message}`);
  if (process.env.SLOTFORGE_DESKTOP_SMOKE)
    fs.writeFileSync(process.env.SLOTFORGE_DESKTOP_SMOKE, JSON.stringify({ failed: title, message }));
  else dialog.showErrorBox(title, message);
  app.exit(1);
}

// Only one window per data folder. The profile path makes this lock per folder,
// so a portable copy and an installed copy can run side by side.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let server = null;
  let shutdown = null;
  let origin = null;
  const automated = !!(process.env.SLOTFORGE_DESKTOP_SMOKE || process.env.SLOTFORGE_UI_TESTS);
  const trackFiles = createTrackFiles({ app, dialog, ipcMain, getWindow: () => win, log, automated });
  // "A new version is available": installed and portable apps ask GitHub once, a few seconds
  // after start; a newer version opens a window with What's new, Skip and Download. Development
  // copies, automated runs and SLOTFORGE_NO_UPDATE_CHECK only check when asked in Settings.
  const updateCheck = new UpdateCheck({
    profile: app.getPath('userData'),
    current: app.getVersion(),
    homepage: require('../package.json').homepage,
    fetch: (url, init) => net.fetch(url, init),
    automatic: app.isPackaged && !automated && !process.env.SLOTFORGE_NO_UPDATE_CHECK,
    // Which file replaces this copy: the portable app and an AppImage say so through these.
    edition: {
      platform: process.platform,
      arch: process.arch,
      portable: !!process.env.PORTABLE_EXECUTABLE_FILE,
      appImage: !!process.env.APPIMAGE,
    },
    downloads: app.getPath('downloads'),
    onChange: () => {
      if (win && !win.isDestroyed()) win.webContents.send('update:changed');
    },
  });
  let updateTimer = setTimeout(() => void updateCheck.startupCheck(), 5 * 1000);
  updateTimer.unref();
  ipcMain.handle('update:action', async (event, action, payload) => {
    // Only Circuit's own page may ask.
    try {
      if (new URL(event.senderFrame?.url || '').origin !== origin) return { error: 'Unknown page.' };
    } catch {
      return { error: 'Unknown page.' };
    }
    try {
      if (action === 'status') return { ok: true, value: updateCheck.status() };
      if (action === 'check') return { ok: true, value: await updateCheck.check() };
      if (action === 'enable') return { ok: true, value: updateCheck.setEnabled(payload?.enabled) };
      if (action === 'skip') return { ok: true, value: updateCheck.skip(payload?.version) };
      if (action === 'download') {
        // Not awaited: progress and the result reach the window through update:changed.
        updateCheck.startDownload().catch(() => {});
        return { ok: true, value: updateCheck.status() };
      }
      if (action === 'cancel') return { ok: true, value: updateCheck.cancelDownload() };
      if (action === 'show') {
        shell.showItemInFolder(updateCheck.downloadedFile());
        return { ok: true, value: { shown: true } };
      }
      if (action === 'open') {
        await shell.openExternal(updateCheck.releaseUrl());
        return { ok: true, value: { opened: true } };
      }
      throw Error('Unknown update action.');
    } catch (e) {
      return { error: e.message, code: e.code };
    }
  });
  // macOS hands over files (Finder double-click, Dock) through this event, possibly before start-up.
  app.on('open-file', (event, file) => {
    event.preventDefault();
    trackFiles.deliver(file);
  });

  const close = () => {
    if (!shutdown) {
      clearTimeout(updateTimer);
      updateCheck.stop();
      shutdown = (async () => {
        try {
          if (server?.options.startup) await server.options.startup.close();
          else await server?.store.close();
        } catch (e) {
          log('Storage close failed: ' + e.message);
        }
        await new Promise(resolve => {
          if (!server) return resolve();
          server.http.close(() => resolve());
          server.http.closeAllConnections();
        });
      })();
    }
    return shutdown;
  };

  app.on('second-instance', (_event, argv) => {
    // Windows/Linux: opening a track file while Circuit runs starts a second instance with the file.
    trackFiles.fromArgs(argv.slice(1)).forEach(trackFiles.deliver);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on('before-quit', event => {
    if (shutdown?.done) return;
    event.preventDefault();
    close().finally(() => {
      shutdown.done = true;
      app.quit();
    });
  });
  app.on('window-all-closed', () => app.quit());

  // Refuse to share a data folder with a browser-launched helper that is still running.
  async function otherHelper(instanceId) {
    const probes = Array.from({ length: PORT_COUNT }, async (_, i) => {
      try {
        const response = await fetch(`http://127.0.0.1:${PREFERRED_PORT + i}/api/health`, {
          signal: AbortSignal.timeout(800),
        });
        const health = await response.json();
        return health.app === HEALTH_APP && health.instanceId === instanceId ? PREFERRED_PORT + i : null;
      } catch {
        return null;
      }
    });
    return (await Promise.all(probes)).find(Boolean) || null;
  }

  async function start() {
    if (where.problem) return fail('SlotForge Circuit cannot start here', where.problem);
    try {
      fs.mkdirSync(where.workspace, { recursive: true });
      fs.accessSync(where.workspace, fs.constants.W_OK);
    } catch (e) {
      return fail(
        'SlotForge Circuit cannot save here',
        `Circuit could not create its data folder:\n${where.workspace}\n\n${e.message}\n\n` +
          (where.mode === 'portable'
            ? 'Move the portable app to a folder you can write to, such as Documents or a USB drive.'
            : 'Check the folder permissions and try again.')
      );
    }
    log(`Starting ${app.getVersion()} (${where.mode}) with data in ${where.workspace}`);

    const { DiskStore } = require(path.join(ROOT, 'app/disk-store.cjs'));
    const { createHandler } = require(path.join(ROOT, 'app/serve.cjs'));
    const { createStorageStartup } = require(path.join(ROOT, 'app/storage-startup.cjs'));
    const store = new DiskStore(where.workspace);
    const instanceId = crypto.createHash('sha256').update(store.directory).digest('hex');

    const busy = await otherHelper(instanceId);
    if (busy) {
      return fail(
        'Circuit is already running in a browser',
        `The browser version of SlotForge Circuit is still using this data folder (port ${busy}).\n\n` +
          'In that browser tab, open Storage (bottom right) and choose "Stop local app", then start the desktop app again.\n\nNo saved work was changed.'
      );
    }

    const startup = createStorageStartup(store);
    if (!startup) await store.init();
    const buildId = `desktop-${app.getVersion()}`;
    let listening = null;
    for (let i = 0; i <= PORT_COUNT && !listening; i++) {
      const port = i === PORT_COUNT ? 0 : PREFERRED_PORT + i; // Fall back to any free port.
      const options = { store, port, buildId, startup };
      const instance = http.createServer(createHandler(ROOT, options));
      try {
        await new Promise((resolve, reject) => {
          instance.once('error', reject);
          instance.listen(port, '127.0.0.1', resolve);
        });
        options.port = instance.address().port;
        options.onQuit = () => app.quit(); // Storage > Stop local app closes the desktop app.
        listening = { http: instance, options, store };
      } catch (e) {
        if (e.code !== 'EADDRINUSE') {
          await store.close();
          throw e;
        }
      }
    }
    server = listening;
    origin = `http://127.0.0.1:${server.options.port}`;
    log(`Serving ${origin}/app/`);
    openWindow();
  }

  function openWindow() {
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((_wc, permission, callback) =>
      callback(permission === 'clipboard-sanitized-write')
    );
    win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: 'SlotForge Circuit',
      backgroundColor: '#15181c',
      icon: path.join(ROOT, 'app', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    const sameOrigin = url => {
      try {
        return new URL(url).origin === origin;
      } catch {
        return false;
      }
    };
    const external = url => {
      try {
        const u = new URL(url);
        if (['https:', 'http:', 'mailto:'].includes(u.protocol)) shell.openExternal(url);
      } catch {}
    };
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (sameOrigin(url))
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            webPreferences: { sandbox: true, contextIsolation: true },
          },
        };
      external(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
      if (!sameOrigin(url)) {
        event.preventDefault();
        external(url);
      }
    });
    // Windows the page opens (a track-pack gallery, the licence notices) stay pages to read. A link
    // in one back into the app shows that section in the main window and closes the extra window,
    // so there is never a second copy of the app editing the same workspace.
    win.webContents.on('did-create-window', child => {
      child.setSize(1200, 860);
      child.center();
      const intoApp = url => {
        try {
          const u = new URL(url);
          return u.origin === origin && /^\/app\/(index\.html)?$/.test(u.pathname) ? u.hash || '#builder' : null;
        } catch {
          return null;
        }
      };
      child.webContents.on('will-navigate', (event, url) => {
        const hash = intoApp(url);
        if (hash) {
          event.preventDefault();
          win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`).catch(() => {});
          if (win.isMinimized()) win.restore();
          win.focus();
          child.close();
        } else if (!sameOrigin(url)) {
          event.preventDefault();
          external(url);
        }
      });
      child.webContents.setWindowOpenHandler(({ url }) => {
        if (sameOrigin(url) && !intoApp(url)) child.loadURL(url);
        else if (!sameOrigin(url)) external(url);
        return { action: 'deny' };
      });
    });
    win.webContents.on('render-process-gone', (_e, details) => log('Renderer stopped: ' + details.reason));
    // The page asks to stay when there are unsaved changes. Browsers show a prompt for this;
    // Electron would silently keep the window open, so ask here instead.
    // Closing the window right after an edit: the page still has a save waiting (Circuit saves once
    // editing pauses). Let it finish, then close again; only changes that still cannot be saved ask.
    let closing = false,
      closeRetried = false;
    win.on('close', () => {
      closing = true;
    });
    win.webContents.on('will-prevent-unload', event => {
      if (automated) return event.preventDefault();
      const wasClosing = closing;
      closing = false;
      if (wasClosing && !closeRetried) {
        closeRetried = true;
        win.webContents
          .executeJavaScript(
            'window.LocalWorkspace ? LocalWorkspace.flush().then(() => true, () => false) : true',
            true
          )
          .catch(() => false)
          .then(() => {
            if (win && !win.isDestroyed()) win.close();
          });
        return;
      }
      closeRetried = false;
      const choice = dialog.showMessageBoxSync(win, {
        type: 'question',
        buttons: ['Leave without saving', 'Stay'],
        defaultId: 1,
        cancelId: 1,
        title: 'Unsaved changes',
        message: 'You have changes that are not saved yet.',
        detail: 'A FreeForm drawing or a save may still be in progress. Leave anyway?',
      });
      if (choice === 0) event.preventDefault();
    });
    win.once('ready-to-show', () => {
      if (!automated) win.show();
    });
    win.on('closed', () => {
      win = null;
    });
    if (process.env.SLOTFORGE_DESKTOP_SMOKE) smoke(process.env.SLOTFORGE_DESKTOP_SMOKE);
    else if (process.env.SLOTFORGE_UI_TESTS)
      // Interface tests (desktop/ui-tests.cjs) are only present in the source tree, not in builds.
      win.webContents.once('did-finish-load', () =>
        require('./ui-tests.cjs')
          .run(win, { app, where, origin, trackFiles, updateCheck })
          .then(result => fs.writeFileSync(process.env.SLOTFORGE_UI_TESTS, JSON.stringify(result, null, 2)))
          .catch(e => fs.writeFileSync(process.env.SLOTFORGE_UI_TESTS, JSON.stringify({ crashed: e.stack })))
          .finally(() => app.quit())
      );
    trackFiles.handleDownloads(ses);
    // A track file used to start Circuit (double-click or "Open with") opens once the page is ready.
    trackFiles.fromArgs(process.argv.slice(1)).forEach(trackFiles.deliver);
    win.loadURL(`${origin}/app/`);
  }

  // Automated check used by desktop/smoke.cjs: report what the page shows, then quit.
  function smoke(resultFile) {
    const errors = [];
    win.webContents.on('console-message', event => {
      if (event.level === 'error') errors.push(event.message);
    });
    win.webContents.once('did-finish-load', async () => {
      let page = null;
      for (let i = 0; i < 60 && !(page?.storage || '').startsWith('Storage: disk'); i++) {
        await new Promise(r => setTimeout(r, 250));
        page = await win.webContents
          .executeJavaScript(
            `({href: location.href, ready: document.readyState, title: document.title, storage: document.getElementById('storage-open')?.textContent, stop: document.getElementById('storage-stop')?.textContent, desktop: !!window.slotforgeDesktop, packs: document.querySelectorAll('#pack option').length})`
          )
          .catch(e => ({ error: e.message }));
      }
      fs.writeFileSync(
        resultFile,
        JSON.stringify(
          { mode: where.mode, workspace: where.workspace, origin, version: app.getVersion(), page, errors },
          null,
          2
        )
      );
      app.quit();
    });
  }

  function menu() {
    const mac = process.platform === 'darwin';
    const template = [
      ...(mac ? [{ role: 'appMenu' }] : [{ label: 'File', submenu: [{ role: 'quit' }] }]),
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          { role: 'toggleDevTools' },
        ],
      },
      { role: 'windowMenu' },
      {
        label: 'Help',
        submenu: [
          {
            label: 'Keyboard shortcuts',
            accelerator: 'Shift+/',
            registerAccelerator: false, // The page handles "?" itself; this only shows the hint.
            click: () => win?.webContents.executeJavaScript('window.CircuitHelp?.shortcuts(); 0'),
          },
          {
            label: 'Welcome screen',
            click: () => win?.webContents.executeJavaScript("document.getElementById('help-welcome')?.click(); 0"),
          },
          { type: 'separator' },
          {
            label: 'SlotForge Circuit on GitHub',
            click: () => shell.openExternal('https://github.com/theDutchmanJames/SlotForgeCircuit'),
          },
          {
            label: 'Report a problem',
            click: () => shell.openExternal('https://github.com/theDutchmanJames/SlotForgeCircuit/issues'),
          },
          { type: 'separator' },
          { label: 'Show data folder', click: () => shell.openPath(where.workspace) },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  app
    .whenReady()
    .then(() => {
      menu();
      return start();
    })
    .catch(e => fail('SlotForge Circuit could not start', (e.stack || e.message) + `\n\nDetails: ${where.log}`));
}
