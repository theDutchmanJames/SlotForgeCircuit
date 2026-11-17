'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTrackFiles, TRACK } = require('./track-files.cjs');

// Track file names the desktop app accepts.
for (const name of ['Club.slotforge', 'Club.slotforge.json', 'club.SLOTFORGE', 'export.json'])
  assert.ok(TRACK.test(name), name);
for (const name of ['Club.slotforge.txt', 'notes.txt', 'picture.png', 'slotforge']) assert.ok(!TRACK.test(name), name);

// Command-line arguments: only existing track files are opened; switches and folders are ignored.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'circuit-track-files-'));
const real = path.join(dir, 'Oval.slotforge');
fs.writeFileSync(real, '{}');
const fake = {
  app: { getPath: () => dir, addRecentDocument() {}, clearRecentDocuments() {} },
  dialog: {},
  ipcMain: { on() {}, handle() {} },
  getWindow: () => null,
  log() {},
};
const files = createTrackFiles(fake);
assert.deepEqual(files.fromArgs(['--portable-data-dir=x', dir, real, path.join(dir, 'missing.slotforge')]), [real]);

// Remembering a file puts it first, without duplicates, and keeps the folder for the next dialog.
files.remember(real);
files.remember(real);
const saved = JSON.parse(fs.readFileSync(path.join(dir, 'recent-files.json'), 'utf8'));
assert.deepEqual(saved.recent, [real]);
assert.equal(saved.lastFolder, dir);

fs.rmSync(dir, { recursive: true, force: true });
console.log('track-files tests passed');
