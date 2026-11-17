'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolve, legacyHome, macBundle } = require('./data-location.cjs');

const win = { platform: 'win32', user: 'C:\\Users\\Ann', argv: [] };
const mac = { platform: 'darwin', user: '/Users/ann', argv: [], env: {} };
const linux = { platform: 'linux', user: '/home/ann', argv: [], env: {} };

// Installed copies reuse the browser installer's data folder.
let r = resolve({
  ...win,
  env: { LOCALAPPDATA: 'C:\\Users\\Ann\\AppData\\Local' },
  execPath: 'C:\\Users\\Ann\\AppData\\Local\\Programs\\SlotForge Circuit\\SlotForgeCircuit.exe',
});
assert.equal(r.mode, 'installed');
assert.equal(r.workspace, 'C:\\Users\\Ann\\AppData\\Local\\SlotForgeTrackBuilder\\data');
assert.equal(r.profile, null);

r = resolve({ ...mac, execPath: '/Applications/SlotForge Circuit.app/Contents/MacOS/SlotForge Circuit' });
assert.equal(r.mode, 'installed');
assert.equal(r.workspace, '/Users/ann/Library/Application Support/SlotForgeTrackBuilder/data');
r = resolve({ ...mac, execPath: '/Users/ann/Applications/SlotForge Circuit.app/Contents/MacOS/SlotForge Circuit' });
assert.equal(r.mode, 'installed');

r = resolve({ ...linux, execPath: '/opt/SlotForge Circuit/SlotForgeCircuit' });
assert.equal(r.mode, 'installed');
assert.equal(r.workspace, '/home/ann/.local/share/SlotForgeTrackBuilder/data');
r = resolve({ ...linux, env: { XDG_DATA_HOME: '/data/ann' }, execPath: '/opt/x/SlotForgeCircuit' });
assert.equal(r.workspace, '/data/ann/SlotForgeTrackBuilder/data');

// Matches the browser launcher's own definition on this machine.
assert.equal(path.join(legacyHome(), 'data'), path.join(require('../app/legacy-disk-store.cjs').home(), 'data'));

// Portable copies keep data beside the program.
r = resolve({ ...win, env: { PORTABLE_EXECUTABLE_DIR: 'E:\\Tools' }, execPath: 'C:\\Temp\\x\\SlotForgeCircuit.exe' });
assert.equal(r.mode, 'portable');
assert.equal(r.workspace, 'E:\\Tools\\SlotForge Circuit Data\\workspace');
assert.equal(r.profile, 'E:\\Tools\\SlotForge Circuit Data\\app-profile');

r = resolve({
  ...linux,
  env: { APPIMAGE: '/media/usb/SlotForgeCircuit.AppImage' },
  execPath: '/tmp/.mount_x/SlotForgeCircuit',
});
assert.equal(r.mode, 'portable');
assert.equal(r.workspace, '/media/usb/SlotForge Circuit Data/workspace');

r = resolve({ ...mac, execPath: '/Volumes/USB/Circuit/SlotForge Circuit.app/Contents/MacOS/SlotForge Circuit' });
assert.equal(r.mode, 'portable');
assert.equal(r.workspace, '/Volumes/USB/Circuit/SlotForge Circuit Data/workspace');
assert.equal(r.problem, null);

// macOS places that cannot hold data get a clear message instead.
r = resolve({
  ...mac,
  execPath: '/private/var/folders/x/AppTranslocation/ABC/d/SlotForge Circuit.app/Contents/MacOS/SlotForge Circuit',
});
assert.match(r.problem, /temporary read-only copy/);
r = resolve({
  ...mac,
  execPath: '/Volumes/SlotForge Circuit 0.3.27/SlotForge Circuit.app/Contents/MacOS/SlotForge Circuit',
});
assert.match(r.problem, /disk image/);

// Explicit overrides.
r = resolve({ ...win, env: { PORTABLE_EXECUTABLE_DIR: 'E:\\Tools' }, argv: ['x', '--portable-data-dir=D:\\Test'] });
assert.equal(r.workspace, 'D:\\Test\\workspace');
r = resolve({ ...linux, env: { SLOTFORGE_DATA_DIR: '/srv/circuit' } });
assert.equal(r.mode, 'custom');
assert.equal(r.workspace, '/srv/circuit');
// Running from source (npm start) behaves like an installed copy.
r = resolve({ ...win, env: { LOCALAPPDATA: 'C:\\L', PORTABLE_EXECUTABLE_DIR: 'E:\\Tools' }, packaged: false });
assert.equal(r.mode, 'installed');

assert.equal(macBundle('/Applications/A.app/Contents/MacOS/A'), '/Applications/A.app');
assert.equal(macBundle('/usr/bin/node'), null);

// The desktop package version must match the app version shown in Circuit.
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
assert.equal(
  pkg.version,
  require('../app/integration.js').VERSION,
  'package.json version must equal VERSION in app/integration.js'
);

console.log('data-location tests passed');
