// Crash and interruption tests: a separate process saves, imports or migrates while it is killed
// at a random moment (on Windows, TerminateProcess: no clean-up code runs). Circuit must then
// open again with nothing lost or half-written: the workspace is either exactly the last save
// that was reported done or exactly one save further, the file passes SQLite's integrity check,
// its size count matches its rows, and the original JSON from before the SQLite move is untouched.
//
// CIRCUIT_CRASH_ROUNDS=60 node app/storage-crash.test.cjs runs more kills.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  { spawn } = require('node:child_process'),
  { DatabaseSync } = require('node:sqlite');
const store = require('./sqlite-store.cjs'),
  I = require('./integration.js'),
  CP = require('./custom-packs.js'),
  DL = require('./design-library.js'),
  Legacy = require('./legacy-disk-store.cjs').DiskStore;
const fixtures = ['01-closed-oval', '02-reflected-oval', '03-open-layout', '04-lane-changer'].map(name =>
  I.prepare(require(`../integration/slotforge-timing/fixtures/${name}.slotforge.json`), undefined, false)
);

// Child: save forever, printing the workspace revision after every save that returned.
async function child(dir, mode) {
  const call = (method, ...args) => store.run(dir, method, args);
  let n = 0;
  const say = async () => {
    const db = new DatabaseSync(path.join(dir, 'workspace.sqlite'), { readOnly: true });
    try {
      process.stdout.write(
        'done ' + JSON.parse(db.prepare("SELECT value FROM meta WHERE key='workspace'").get().value).revision + '\n'
      );
    } finally {
      db.close();
    }
  };
  if (mode === 'migrate') {
    process.stdout.write('start\n');
    await call('init');
    process.stdout.write('migrated\n');
    return;
  }
  await call('init');
  await say();
  for (;;) {
    n++;
    const list = await call('summaries'),
      roll = n % 7;
    if (roll === 0 && list.length) {
      const r = list[n % list.length];
      await call('remove', r.id, r.revision);
    } else if (roll === 1 && list.length) {
      const r = await call('get', list[n % list.length].id);
      await call('putDesign', DL.prepare(r.layout, 'Edited ' + n), r.revision);
    } else if (roll === 2) {
      // A big import: one transaction with many rows.
      await call('importBundle', {
        format: 'slotforge.workspace-transfer',
        version: 1,
        current: null,
        customLibrary: CP.serialize(CP.empty()),
        designs: Array.from({ length: 40 }, (_, i) => DL.prepare(fixtures[i % 4], `Import ${n}.${i}`, true)),
      });
    } else if (roll === 3) {
      const old = await call('packs'),
        data = CP.read(old?.data);
      data.packs[0].name = 'Pack ' + n;
      await call('putPacks', CP.serialize(data), old?.revision || null);
    } else if (roll === 4) {
      const old = await call('current');
      await call('putCurrent', DL.prepare(fixtures[n % 4], 'Current ' + n, true), old?.revision || null);
    } else if (roll === 5 && (await call('trash')).length) {
      const t = (await call('trash'))[0];
      await call('restore', t.id, t.deletedAt);
    } else await call('putDesign', DL.prepare(fixtures[n % 4], 'Track ' + n, true), null);
    await say();
  }
}
if (process.argv[2] === 'child') {
  child(process.argv[3], process.argv[4]).catch(e => {
    process.stderr.write(e.stack + '\n');
    process.exit(3);
  });
  return;
}

const test = require('node:test'),
  assert = require('node:assert/strict');
const ROUNDS = Number(process.env.CIRCUIT_CRASH_ROUNDS || 12);

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'circuit-crash-'));
  t.after(() => {
    store.release(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
// Runs the child until it has printed `after` lines plus a random extra moment, then kills it.
function runAndKill(dir, mode, { after = 1, extraMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [__filename, 'child', dir, mode], { stdio: ['ignore', 'pipe', 'pipe'] }),
      lines = [];
    let buffer = '',
      errors = '',
      timer = null,
      killed = false;
    const kill = () => {
      if (killed) return;
      killed = true;
      p.kill('SIGKILL');
    };
    p.stdout.on('data', d => {
      buffer += d;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        lines.push(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
      }
      if (lines.length >= after && !timer) timer = setTimeout(kill, extraMs);
    });
    p.stderr.on('data', d => (errors += d));
    p.on('error', reject);
    p.on('exit', code => {
      clearTimeout(timer);
      // Lines written just before the kill still count: the parent saw them, so the save returned.
      if (buffer.trim()) lines.push(buffer.trim());
      if (!killed && code !== 0) return reject(Error(`child stopped by itself (${code}): ${errors}`));
      resolve({ lines, killed });
    });
    // Safety net: a child that never reaches the kill point.
    setTimeout(kill, 60000).unref();
  });
}
function inspect(dir) {
  const db = new DatabaseSync(path.join(dir, 'workspace.sqlite'));
  try {
    const value = key => JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get(key).value);
    return {
      integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
      revision: value('workspace').revision,
      bytes: Number(value('bytes')),
      counted: db.prepare('SELECT coalesce(sum(length(CAST(json AS BLOB))),0) n FROM records').get().n,
      lastBefore: (() => {
        const h = db.prepare('SELECT changes FROM history ORDER BY seq DESC LIMIT 1').get();
        return h ? JSON.parse(h.changes).workspace.revision : null;
      })(),
    };
  } finally {
    db.close();
  }
}

test(`Killing Circuit in the middle of saves never loses a finished save or leaves half of one (${ROUNDS} kills)`, async t => {
  const dir = temp(t);
  let lastDone = null,
    oneFurther = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const { lines } = await runAndKill(dir, 'save', {
        after: 1 + (round % 4),
        extraMs: Math.floor(Math.random() * 120),
      }),
      done = lines.filter(l => l.startsWith('done ')).map(l => l.slice(5));
    if (done.length) lastDone = done[done.length - 1];
    // Opening again must work: rolls back the interrupted transaction and checks the file.
    store.release(dir);
    await store.run(dir, 'init', []);
    const read = await store.run(dir, 'read', []);
    store.release(dir);
    const s = inspect(dir);
    assert.equal(s.integrity, 'ok', `round ${round}: integrity`);
    assert.equal(s.bytes, s.counted, `round ${round}: size count matches the rows`);
    if (s.revision !== lastDone) {
      // The save in flight finished before the kill but after its last report: exactly one further.
      assert.equal(s.lastBefore, lastDone, `round ${round}: the workspace is the last reported save or one further`);
      oneFurther++;
      lastDone = s.revision;
    }
    assert.equal(read.revision, s.revision);
    for (const r of read.designs) assert.ok(r.layout?.design?.id === r.id, 'every track is whole');
    // A kill while SQLite removes its journal can leave an empty, harmless one; the next save
    // must still work and clear it.
    const journal = path.join(dir, 'workspace.sqlite-journal');
    if (fs.existsSync(journal)) {
      const left = fs.statSync(journal).size;
      const r = await store.run(dir, 'putDesign', [DL.prepare(fixtures[0], 'After crash ' + round, true), null]);
      store.release(dir);
      assert.ok(r.revision);
      assert.ok(
        !fs.existsSync(journal),
        `round ${round}: a ${left}-byte journal left by the kill is cleared by the next save`
      );
      lastDone = inspect(dir).revision;
    }
  }
  t.diagnostic(`${oneFurther} of ${ROUNDS} kills landed after a commit and before its report`);
});

test('Killing Circuit while it moves an old JSON workspace into SQLite keeps the JSON and a later start finishes the move', async t => {
  const rounds = Math.max(4, Math.round(ROUNDS / 2));
  let interrupted = 0;
  for (let round = 0; round < rounds; round++) {
    const dir = temp(t),
      old = await new Legacy(dir).init();
    await old.importBundle({
      format: 'slotforge.workspace-transfer',
      version: 1,
      current: null,
      customLibrary: CP.serialize(CP.empty()),
      designs: Array.from({ length: 120 }, (_, i) => DL.prepare(fixtures[i % 4], 'Legacy ' + i, true)),
    });
    const before = await old.read(),
      bytes = fs.readFileSync(old.file);
    const { lines } = await runAndKill(dir, 'migrate', { after: 1, extraMs: 10 + round * 25 });
    if (!lines.includes('migrated')) interrupted++;
    assert.deepEqual(fs.readFileSync(old.file), bytes, 'the original JSON is untouched');
    // The next start either finds a complete database or makes one; a stale lock does not block it.
    await store.run(dir, 'init', []);
    const read = await store.run(dir, 'read', []);
    store.release(dir);
    assert.deepEqual(read.designs, before.designs, 'every track arrived exactly once');
    assert.equal(inspect(dir).integrity, 'ok');
    assert.deepEqual(
      fs.readdirSync(dir).filter(n => n.startsWith('.sqlite-migration-')),
      [],
      'no half-built migration copy is left behind'
    );
    assert.ok(!fs.existsSync(path.join(dir, '.write-lock')), 'the write lock was released');
  }
  t.diagnostic(`${interrupted} of ${rounds} kills landed before the move finished`);
  assert.ok(interrupted > 0, 'at least one kill interrupted the move');
});

test('A lock left by a crash is recovered even when Windows has given its process number to another program', async t => {
  const dir = temp(t);
  await store.run(dir, 'init', []);
  // A live process of a different program stands in for the reused number.
  const other =
    process.platform === 'win32'
      ? spawn('ping', ['-n', '30', '127.0.0.1'], { stdio: 'ignore', windowsHide: true })
      : spawn('sleep', ['30'], { stdio: 'ignore' });
  t.after(() => other.kill());
  await new Promise(r => setTimeout(r, 300));
  const lock = path.join(dir, '.write-lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: other.pid, program: 'SlotForgeCircuit.exe', token: 'crashed' }));
  const started = Date.now();
  await store.run(dir, 'init', []);
  assert.ok(Date.now() - started < 5000, 'no long wait');
  assert.ok(!fs.existsSync(lock));
});

test('A lock held by a running copy of the same program still keeps a second start out', async t => {
  const dir = temp(t);
  await store.run(dir, 'init', []);
  const lock = path.join(dir, '.write-lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, program: path.basename(process.execPath), token: 'held' }));
  await assert.rejects(store.run(dir, 'init', []), /Another SlotForge window is writing files/);
  assert.ok(fs.existsSync(lock), 'the running copy keeps its lock');
  fs.rmSync(lock);
});

test('The write lock is complete the moment it exists, and drives without hard links still lock', async t => {
  const dir = temp(t),
    fsp = require('node:fs/promises'),
    link = fsp.link;
  const legacy = new Legacy(dir);
  fs.mkdirSync(dir, { recursive: true });
  const release = await legacy.lock();
  const value = JSON.parse(fs.readFileSync(path.join(dir, '.write-lock'), 'utf8'));
  assert.equal(value.pid, process.pid);
  assert.equal(value.program, path.basename(process.execPath));
  await release();
  assert.deepEqual(fs.readdirSync(dir), [], 'no lock and no prepared lock file left');
  // FAT and exFAT have no hard links.
  fsp.link = async () => {
    throw Object.assign(Error('operation not permitted'), { code: 'EPERM' });
  };
  t.after(() => (fsp.link = link));
  const again = await legacy.lock();
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.write-lock'), 'utf8')).pid, process.pid);
  await again();
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('A new workspace on a drive without hard links (FAT or exFAT USB stick) still opens', async t => {
  const dir = temp(t),
    linkSync = fs.linkSync;
  fs.linkSync = () => {
    throw Object.assign(Error('operation not permitted'), { code: 'EPERM' });
  };
  t.after(() => (fs.linkSync = linkSync));
  await store.run(dir, 'init', []);
  const saved = await store.run(dir, 'putDesign', [DL.prepare(fixtures[0], 'On a USB stick', true), null]);
  store.release(dir);
  assert.equal((await store.run(dir, 'get', [saved.id])).layout.title, 'On a USB stick');
  assert.deepEqual(
    fs.readdirSync(dir).filter(n => n.endsWith('.tmp')),
    []
  );
});
