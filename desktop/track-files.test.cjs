'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createTrackFiles, TRACK } = require('./track-files.cjs');

// A stand-in for Electron: records what Circuit sends to the window and lets a test answer dialogs.
function desktop(t, { automated = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'circuit-track-files-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sent = [],
    handlers = {},
    listeners = {},
    recentDocs = [],
    win = {
      minimized: false,
      focused: 0,
      webContents: { send: (channel, payload) => sent.push({ channel, payload }) },
      isMinimized() {
        return this.minimized;
      },
      restore() {
        this.minimized = false;
      },
      focus() {
        this.focused++;
      },
    };
  const env = {
    dir,
    sent,
    win,
    recentDocs,
    window: null,
    dialogAnswer: { canceled: true, filePaths: [] },
    logged: [],
    app: {
      getPath: name => (name === 'temp' ? path.join(dir, 'temp') : dir),
      addRecentDocument: file => recentDocs.push(file),
      clearRecentDocuments: () => recentDocs.splice(0),
    },
  };
  env.make = () =>
    createTrackFiles({
      app: env.app,
      dialog: { showOpenDialog: async (_w, options) => ((env.lastDialog = options), env.dialogAnswer) },
      ipcMain: {
        on: (channel, fn) => (listeners[channel] = fn),
        handle: (channel, fn) => (handlers[channel] = fn),
      },
      getWindow: () => env.window,
      log: message => env.logged.push(message),
      automated,
    });
  env.invoke = async (channel, ...args) => handlers[channel]({}, ...args);
  env.ready = () => listeners['track:ready']({ sender: win.webContents });
  env.file = (name, text = '{"title":"' + name + '"}') => {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
    return full;
  };
  env.recent = () => JSON.parse(fs.readFileSync(path.join(dir, 'recent-files.json'), 'utf8'));
  return env;
}

test('track file names the desktop app accepts', () => {
  for (const name of ['Club.slotforge', 'Club.slotforge.json', 'club.SLOTFORGE', 'export.json'])
    assert.ok(TRACK.test(name), name);
  for (const name of ['Club.slotforge.txt', 'notes.txt', 'picture.png', 'slotforge'])
    assert.ok(!TRACK.test(name), name);
});

test('command-line arguments: only existing track files are opened; switches and folders are ignored', t => {
  const env = desktop(t),
    real = env.file('Oval.slotforge'),
    files = env.make();
  assert.deepEqual(files.fromArgs(['--portable-data-dir=x', env.dir, real, path.join(env.dir, 'missing.slotforge')]), [
    real,
  ]);
});

test('recent files: newest first, no duplicates whatever the case, at most 8, kept for the next start', t => {
  const env = desktop(t),
    files = env.make(),
    paths = Array.from({ length: 10 }, (_, i) => env.file(`Track ${i}.slotforge`));
  for (const p of paths) files.remember(p);
  files.remember(paths[9].toUpperCase());
  const saved = env.recent();
  assert.equal(saved.recent.length, 8);
  assert.equal(
    saved.recent[0],
    path.resolve(paths[9].toUpperCase()),
    'the same file in another case is not listed twice'
  );
  assert.ok(!saved.recent.includes(paths[9]));
  assert.ok(!saved.recent.includes(paths[0]) && !saved.recent.includes(paths[1]), 'the oldest drop off');
  assert.equal(saved.lastFolder.toLowerCase(), env.dir.toLowerCase());
  assert.equal(env.recentDocs.length, 11, 'every .slotforge file goes to the jump list');
  // A new start reads the list back.
  env.make();
  return env.invoke('track:recent').then(list => assert.equal(list.length, 8));
});

test('a damaged recent-files list is ignored, and one that cannot be saved does not stop Circuit', async t => {
  const env = desktop(t);
  fs.writeFileSync(path.join(env.dir, 'recent-files.json'), '{ not json');
  const files = env.make();
  assert.deepEqual(await env.invoke('track:recent'), []);
  fs.rmSync(path.join(env.dir, 'recent-files.json'));
  fs.mkdirSync(path.join(env.dir, 'recent-files.json')); // a folder in the way: writing fails
  files.remember(env.file('Oval.slotforge'));
  assert.match(env.logged[0], /Could not save recent files/);
  const list = await env.invoke('track:recent');
  assert.equal(list[0].name, 'Oval.slotforge', 'the list still works for this session');
});

test('a file opened before the window is ready is handed over when it asks, then focuses the window', t => {
  const env = desktop(t),
    files = env.make(),
    first = env.file('First.slotforge'),
    second = env.file('Second.slotforge');
  files.deliver(first);
  env.window = env.win;
  files.deliver(second); // window exists, but the page has not said it is ready
  assert.equal(env.sent.length, 0);
  env.ready();
  assert.deepEqual(
    env.sent.map(s => s.payload.name),
    ['First.slotforge', 'Second.slotforge']
  );
  assert.equal(env.sent[0].payload.text, '{"title":"First.slotforge"}');
  env.win.minimized = true;
  files.deliver(first);
  assert.equal(env.sent.length, 3);
  assert.equal(env.win.minimized, false, 'a minimised window comes back');
  assert.equal(env.win.focused, 1);
});

test('files too big or unreadable arrive as a clear message instead of a crash', t => {
  const env = desktop(t),
    files = env.make(),
    big = env.file('Huge.slotforge', 'x'.repeat(5 * 1024 * 1024 + 1));
  env.window = env.win;
  env.ready();
  files.deliver(big);
  files.deliver(path.join(env.dir, 'Gone.slotforge'));
  assert.match(env.sent[0].payload.error, /smaller than 5 MB/);
  assert.equal(env.sent[0].payload.text, undefined);
  assert.match(env.sent[1].payload.error, /Could not open this file/);
  assert.ok(!fs.existsSync(path.join(env.dir, 'recent-files.json')), 'a failed file is not remembered');
});

test('the Open dialog starts in the last folder and returns the file, nothing when cancelled', async t => {
  const env = desktop(t),
    files = env.make(),
    file = env.file('Club/Oval.slotforge');
  assert.equal(await env.invoke('track:open-dialog'), null);
  assert.equal(env.lastDialog.defaultPath, env.dir, 'no last folder yet: Documents');
  env.dialogAnswer = { canceled: false, filePaths: [file] };
  const opened = await env.invoke('track:open-dialog');
  assert.equal(opened.name, 'Oval.slotforge');
  assert.equal(opened.path, file);
  await env.invoke('track:open-dialog');
  assert.equal(env.lastDialog.defaultPath, path.dirname(file), 'the next dialog starts where the file was');
  env.dialogAnswer = { canceled: false, filePaths: [path.join(env.dir, 'Missing.slotforge')] };
  assert.match((await env.invoke('track:open-dialog')).error, /Could not open/);
  assert.equal(files.fromArgs([file]).length, 1);
});

test('recent files: missing ones drop off, only listed ones open, and Clear empties the jump list', async t => {
  const env = desktop(t),
    files = env.make(),
    keep = env.file('Keep.slotforge'),
    gone = env.file('Gone.slotforge'),
    later = env.file('Later.slotforge');
  for (const f of [keep, gone, later]) files.remember(f);
  fs.rmSync(gone);
  assert.deepEqual(
    (await env.invoke('track:recent')).map(r => r.name),
    ['Later.slotforge', 'Keep.slotforge']
  );
  assert.match(
    (await env.invoke('track:open-recent', env.file('Other.slotforge'))).error,
    /no longer in the recent list/
  );
  assert.equal((await env.invoke('track:open-recent', keep)).name, 'Keep.slotforge');
  fs.rmSync(later);
  assert.match((await env.invoke('track:open-recent', later)).error, /Could not open/);
  assert.ok(!env.recent().recent.includes(later), 'a file that failed to open leaves the list');
  assert.deepEqual(await env.invoke('track:clear-recent'), []);
  assert.deepEqual(env.recent().recent, []);
  assert.deepEqual(env.recentDocs, []);
});

test('downloads: track files are offered as .slotforge in the last folder; other files keep their type', t => {
  const env = desktop(t),
    files = env.make(),
    session = new EventEmitter();
  files.handleDownloads(session);
  const download = (name, savedAs, state = 'completed') => {
    const item = new EventEmitter();
    Object.assign(item, {
      getFilename: () => name,
      setSaveDialogOptions: o => (item.options = o),
      setSavePath: p => (item.path = p),
      getSavePath: () => savedAs,
    });
    session.emit('will-download', {}, item);
    item.emit('done', {}, state);
    return item;
  };
  const track = download('Club Oval.slotforge.json', path.join(env.dir, 'Club', 'Club Oval.slotforge'));
  assert.equal(track.options.title, 'Save track file');
  assert.equal(track.options.defaultPath, path.join(env.dir, 'Club Oval.slotforge'));
  assert.deepEqual(track.options.filters[0].extensions, ['slotforge']);
  assert.equal(env.recent().recent[0], path.join(env.dir, 'Club', 'Club Oval.slotforge'));
  const pdf = download('Report.pdf', path.join(env.dir, 'Prints', 'Report.pdf'));
  assert.equal(pdf.options.title, 'Save PDF file');
  assert.equal(pdf.options.defaultPath, path.join(env.dir, 'Club', 'Report.pdf'), 'starts in the last folder');
  assert.equal(env.recent().lastFolder, path.join(env.dir, 'Prints'));
  assert.equal(env.recent().recent.length, 1, 'a PDF is not a recent track');
  download('Other.slotforge.json', path.join(env.dir, 'x.slotforge'), 'cancelled');
  download('Other.slotforge.json', '');
  assert.equal(env.recent().recent.length, 1, 'cancelled or unsaved downloads are not remembered');
});

test('interface tests save downloads into a throwaway folder without a dialog', t => {
  const env = desktop(t, { automated: true }),
    files = env.make(),
    session = new EventEmitter();
  files.handleDownloads(session);
  const item = new EventEmitter();
  Object.assign(item, {
    getFilename: () => 'Oval.slotforge.json',
    setSaveDialogOptions: () => assert.fail('no dialog in tests'),
    setSavePath: p => (item.path = p),
    getSavePath: () => item.path,
  });
  session.emit('will-download', {}, item);
  assert.ok(item.path.startsWith(path.join(env.dir, 'temp', 'circuit-ui-')));
  assert.ok(item.path.endsWith('-Oval.slotforge.json'));
});
