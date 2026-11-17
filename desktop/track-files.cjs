'use strict';
// Track files on the desktop: open from the OS (double-click, Open with, Dock),
// native Open/Save dialogs, and a recent-files list.
//
// Track files are JSON. ".slotforge" is the desktop file type that Windows,
// macOS and Linux can associate with Circuit (they match only the last
// extension, so ".slotforge.json" counts as plain JSON there). Both open fine.
const fs = require('node:fs');
const path = require('node:path');

const TRACK = /\.slotforge(\.json)?$|\.json$/i;
const MAX_BYTES = 5 * 1024 * 1024; // Same limit as the app's own import.
const MAX_RECENT = 8;

function createTrackFiles({ app, dialog, ipcMain, getWindow, log, automated = false }) {
  const store = path.join(app.getPath('userData'), 'recent-files.json');
  let state = { recent: [], lastFolder: null };
  try {
    const saved = JSON.parse(fs.readFileSync(store, 'utf8'));
    if (Array.isArray(saved.recent)) state.recent = saved.recent.filter(p => typeof p === 'string');
    if (typeof saved.lastFolder === 'string') state.lastFolder = saved.lastFolder;
  } catch {}
  const persist = () => {
    try {
      fs.mkdirSync(path.dirname(store), { recursive: true });
      fs.writeFileSync(store, JSON.stringify(state, null, 2));
    } catch (e) {
      log('Could not save recent files: ' + e.message);
    }
  };
  function remember(file) {
    const full = path.resolve(file);
    state.recent = [full, ...state.recent.filter(p => p.toLowerCase() !== full.toLowerCase())].slice(0, MAX_RECENT);
    state.lastFolder = path.dirname(full);
    persist();
    try {
      if (/\.slotforge$/i.test(full)) app.addRecentDocument(full); // Jump list / Dock menu
    } catch {}
  }
  function read(file) {
    const full = path.resolve(file),
      size = fs.statSync(full).size;
    if (size > MAX_BYTES) throw Error('Choose a track file smaller than 5 MB.');
    return { name: path.basename(full), path: full, text: fs.readFileSync(full, 'utf8') };
  }

  // Files can arrive before the page is ready; hand them over once it asks.
  let ready = false;
  const queue = [];
  function deliver(file) {
    let payload;
    try {
      payload = read(file);
      remember(file);
    } catch (e) {
      payload = { name: path.basename(String(file)), error: 'Could not open this file: ' + e.message };
    }
    const win = getWindow();
    if (ready && win) {
      win.webContents.send('track:open', payload);
      if (win.isMinimized()) win.restore();
      win.focus();
    } else queue.push(payload);
  }
  // Track files named on a command line (Windows/Linux double-click or "Open with").
  function fromArgs(argv) {
    return argv.filter(a => !a.startsWith('-') && TRACK.test(a) && fs.existsSync(a));
  }

  ipcMain.on('track:ready', event => {
    ready = true;
    while (queue.length) event.sender.send('track:open', queue.shift());
  });
  ipcMain.handle('track:open-dialog', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Open track file',
      defaultPath: state.lastFolder || app.getPath('documents'),
      properties: ['openFile'],
      filters: [
        { name: 'SlotForge track', extensions: ['slotforge', 'json'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    try {
      const payload = read(result.filePaths[0]);
      remember(result.filePaths[0]);
      return payload;
    } catch (e) {
      return { error: 'Could not open this file: ' + e.message };
    }
  });
  ipcMain.handle('track:recent', () => {
    state.recent = state.recent.filter(p => fs.existsSync(p));
    return state.recent.map(p => ({ path: p, name: path.basename(p), folder: path.dirname(p) }));
  });
  ipcMain.handle('track:open-recent', (_e, file) => {
    if (!state.recent.includes(file)) return { error: 'That file is no longer in the recent list.' };
    try {
      const payload = read(file);
      remember(file);
      return payload;
    } catch (e) {
      state.recent = state.recent.filter(p => p !== file);
      persist();
      return { error: 'Could not open this file: ' + e.message };
    }
  });
  ipcMain.handle('track:clear-recent', () => {
    state.recent = [];
    persist();
    try {
      app.clearRecentDocuments();
    } catch {}
    return [];
  });

  // Saving: every download gets a native Save dialog that starts in the last folder.
  // Track files default to ".slotforge" (double-click to open) with ".slotforge.json" for SlotForge Timing.
  function handleDownloads(session) {
    session.on('will-download', (_event, item) => {
      const name = item.getFilename(),
        track = /\.slotforge\.json$/i.test(name),
        ext = path.extname(name).slice(1).toLowerCase(),
        folder = state.lastFolder || app.getPath('documents');
      if (automated) {
        // Interface tests save into a throwaway folder without a dialog.
        item.setSavePath(path.join(app.getPath('temp'), 'circuit-ui-' + Date.now() + '-' + name));
      } else {
        item.setSaveDialogOptions({
          title: track ? 'Save track file' : 'Save ' + ext.toUpperCase() + ' file',
          defaultPath: path.join(folder, track ? name.replace(/\.slotforge\.json$/i, '.slotforge') : name),
          filters: track
            ? [
                { name: 'SlotForge track', extensions: ['slotforge'] },
                { name: 'Track JSON for SlotForge Timing', extensions: ['json'] },
              ]
            : [
                { name: ext.toUpperCase() + ' file', extensions: [ext] },
                { name: 'All files', extensions: ['*'] },
              ],
        });
      }
      item.once('done', (_e, done) => {
        if (done !== 'completed') return;
        const saved = item.getSavePath();
        if (!saved) return;
        if (track || /\.slotforge$/i.test(saved)) remember(saved);
        else {
          state.lastFolder = path.dirname(saved);
          persist();
        }
      });
    });
  }

  return { deliver, fromArgs, handleDownloads, remember };
}

module.exports = { createTrackFiles, TRACK };
