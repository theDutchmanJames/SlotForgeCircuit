'use strict';
// Runs in the sandboxed page before the app scripts. It adjusts wording that
// refers to the browser launcher and offers a few file actions (open dialog,
// recent files, files opened from the OS). It exposes no general file access.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'slotforgeDesktop',
  Object.freeze({
    desktop: true,
    platform: process.platform,
    // Native Open dialog; resolves to { name, text, path } or { error } or null when cancelled.
    openTrackDialog: () => ipcRenderer.invoke('track:open-dialog'),
    recentFiles: () => ipcRenderer.invoke('track:recent'),
    openRecent: file => ipcRenderer.invoke('track:open-recent', String(file)),
    clearRecent: () => ipcRenderer.invoke('track:clear-recent'),
    // Called with { name, text, path } or { error } when a file is opened from the OS.
    onOpenFile: callback => {
      ipcRenderer.on('track:open', (_event, payload) => callback(payload));
      ipcRenderer.send('track:ready');
    },
    // Update check (Settings → Updates and the update notice); resolves to { ok, value } or { error }.
    updateCheck: (action, payload) => ipcRenderer.invoke('update:action', String(action), payload),
    onUpdateChange: callback => ipcRenderer.on('update:changed', () => callback()),
  })
);

window.addEventListener('DOMContentLoaded', () => {
  for (const id of ['storage-stop', 'upgrade-stop']) {
    const button = document.getElementById(id);
    if (button) button.textContent = 'Quit Circuit';
  }
});
