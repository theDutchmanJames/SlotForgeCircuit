// Runs only in the storage worker. Geometry stays portable JSON; library queries
// read small indexed summaries instead of reconstructing unrelated designs.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite'),
  L = require('./legacy-disk-store.cjs'),
  CP = require('./custom-packs.js'),
  DL = require('./design-library.js'),
  I = require('./integration.js');
const FORMAT = 1,
  APP = 0x53464349,
  MAX_DATA = 200 * 1024 * 1024,
  MAX_TRACKS = 5000;
const uid = () => crypto.randomUUID(),
  json = JSON.stringify,
  parse = JSON.parse;
function fail(message, status = 400) {
  throw Object.assign(Error(message), { status });
}
// Compiled statements, kept per open database. Compiling the same few checks again took about
// two thirds of a small request; a statement is finished together with its database.
const compiled = new WeakMap();
function sql(db, text) {
  let statements = compiled.get(db);
  if (!statements) compiled.set(db, (statements = new Map()));
  let statement = statements.get(text);
  if (!statement) statements.set(text, (statement = db.prepare(text)));
  return statement;
}
function summary(r) {
  return DL.summarize(r);
}
// Older workspaces keep v1 summaries: fill in the new card facts once, without touching the
// designs themselves (the summary column is not part of the workspace size or history).
// Once per workspace per start: rows written afterwards always carry the current summary.
const upgradedSummaries = new Set();
function upgradeSummaries(db, file) {
  if (upgradedSummaries.has(file)) return;
  const stale = sql(
    db,
    "SELECT id,json FROM records WHERE kind='design' AND (summary IS NULL OR json_extract(summary,'$.v') IS NOT ?)"
  ).all(DL.SUMMARY_VERSION);
  if (!stale.length) return void upgradedSummaries.add(file);
  db.exec('BEGIN IMMEDIATE');
  try {
    const update = sql(db, "UPDATE records SET summary=? WHERE kind='design' AND id=?");
    for (const row of stale) update.run(json(summary(parse(row.json))), row.id);
    db.exec('COMMIT');
    upgradedSummaries.add(file);
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    throw e;
  }
}
function schema(db) {
  db.exec(`PRAGMA application_id=${APP}; PRAGMA user_version=${FORMAT};
 CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
 CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',updated TEXT NOT NULL DEFAULT '',summary TEXT,PRIMARY KEY(kind,id)) STRICT;
 CREATE INDEX design_order ON records(kind,updated DESC,id);
 CREATE TABLE previews(id TEXT PRIMARY KEY,revision TEXT NOT NULL,svg TEXT NOT NULL) STRICT;
 CREATE TABLE history(seq INTEGER PRIMARY KEY AUTOINCREMENT,created TEXT NOT NULL,changes TEXT NOT NULL) STRICT;
 INSERT INTO meta VALUES('bytes','0');
 CREATE TRIGGER bytes_insert AFTER INSERT ON records BEGIN UPDATE meta SET value=CAST(CAST(value AS INTEGER)+length(CAST(new.json AS BLOB)) AS TEXT) WHERE key='bytes'; END;
 CREATE TRIGGER bytes_update AFTER UPDATE OF json ON records BEGIN UPDATE meta SET value=CAST(CAST(value AS INTEGER)+length(CAST(new.json AS BLOB))-length(CAST(old.json AS BLOB)) AS TEXT) WHERE key='bytes'; END;
 CREATE TRIGGER bytes_delete AFTER DELETE ON records BEGIN UPDATE meta SET value=CAST(CAST(value AS INTEGER)-length(CAST(old.json AS BLOB)) AS TEXT) WHERE key='bytes'; END;`);
}
function connect(file, reading = false) {
  if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())
    fail('SQLite file is not a regular file. Original retained.', 500);
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL;');
    return checkDatabase(db, reading);
  } catch (e) {
    db.close();
    throw e;
  }
}
// The cheap checks run on every request, also on a kept-open connection, so a file changed
// by another program is still refused. They share one read transaction: on its own each read
// locks and unlocks the file, which on Windows cost more than the reads themselves.
// With `reading` the transaction stays open for the request's own reads (run() ends it).
function checkDatabase(db, reading = false) {
  db.exec('BEGIN');
  let ok = false;
  try {
    if (
      sql(db, 'PRAGMA application_id').get().application_id !== APP ||
      sql(db, 'PRAGMA user_version').get().user_version !== FORMAT
    )
      fail('Unsupported or damaged Circuit database. Original retained.', 500);
    const head = sql(db, "SELECT value FROM meta WHERE key='workspace'").get();
    if (!head) fail('Incomplete Circuit database. Original retained.', 500);
    const value = parse(head.value);
    if (value.format !== 'slotforge.disk-workspace' || value.version !== 1 || typeof value.revision !== 'string')
      fail('Invalid workspace metadata. Original retained.', 500);
    const count = meta(db, 'bytes');
    if (!Number.isSafeInteger(count) || count < 0) fail('Invalid workspace size metadata. Original retained.', 500);
    ok = true;
  } finally {
    if (!ok || !reading)
      try {
        db.exec(ok ? 'COMMIT' : 'ROLLBACK');
      } catch {}
  }
  return db;
}
// One connection per workspace file, kept open while requests are queued: opening the file,
// setting it up and reading its schema took about as long as a small request itself. The worker
// releases it as soon as its queue is empty (release()), so an idle app never holds the file
// open (Windows could not then move or delete the data folder). It is opened again when the
// file on disk is a different file, and dropped after any error.
const connections = new Map();
function connection(file, reading = false) {
  const stat = fs.lstatSync(file, { bigint: true }),
    id = stat.dev + ':' + stat.ino,
    kept = connections.get(file);
  if (kept && kept.id === id && stat.isFile() && !stat.isSymbolicLink()) {
    try {
      return checkDatabase(kept.db, reading);
    } catch (e) {
      forget(file);
      throw e;
    }
  }
  forget(file);
  const db = connect(file, reading);
  connections.set(file, { db, id });
  return db;
}
function forget(file) {
  const kept = connections.get(file);
  if (!kept) return;
  connections.delete(file);
  try {
    kept.db.close();
  } catch {}
}
function record(db, kind, id = '') {
  const row = sql(db, 'SELECT json FROM records WHERE kind=? AND id=?').get(kind, id);
  return row ? parse(row.json) : null;
}
function meta(db, key) {
  const row = sql(db, 'SELECT value FROM meta WHERE key=?').get(key);
  return row ? parse(row.value) : null;
}
function setMeta(db, key, value) {
  sql(db, 'INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, json(value));
}
function write(db, kind, id, value, changes, { keepPreview = false } = {}) {
  const old = sql(db, 'SELECT json FROM records WHERE kind=? AND id=?').get(kind, id)?.json ?? null,
    text = value === null ? null : json(value);
  if (old === text) return false;
  if (changes) changes.push({ kind, id, before: old });
  if (text === null) sql(db, 'DELETE FROM records WHERE kind=? AND id=?').run(kind, id);
  else {
    const s = kind === 'design' ? summary(value) : null;
    sql(
      db,
      'INSERT INTO records(kind,id,json,title,updated,summary) VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json,title=excluded.title,updated=excluded.updated,summary=excluded.summary'
    ).run(kind, id, text, s?.title.toLowerCase() || '', s?.updatedAt || '', s ? json(s) : null);
  }
  // A star does not change the drawing, so it keeps the cached preview.
  if (kind === 'design' && !keepPreview) sql(db, 'DELETE FROM previews WHERE id=?').run(id);
  return true;
}
function assemblePacks(get) {
  const head = get('packs');
  if (!head) return null;
  const { order, ...rest } = head;
  return {
    ...rest,
    data: {
      ...head.data,
      packs: order.map(id => {
        const p = get('pack', id);
        if (!p) fail('Missing track pack. Original retained.', 500);
        const { pieceOrder, ...body } = p;
        return {
          ...body,
          pieces: pieceOrder.map(key => {
            const piece = get('piece', key);
            if (!piece) fail('Missing custom piece. Original retained.', 500);
            return piece;
          }),
        };
      }),
    },
  };
}
// All packs and pieces in two queries, instead of one query per pack and per piece.
function getPacks(db) {
  const head = record(db, 'packs');
  if (!head) return null;
  const rows = { pack: new Map(), piece: new Map() };
  for (const row of sql(db, "SELECT kind,id,json FROM records WHERE kind IN ('pack','piece')").all())
    rows[row.kind].set(row.id, row.json);
  return assemblePacks((kind, id = '') => {
    if (kind === 'packs') return head;
    const text = rows[kind]?.get(id);
    return text === undefined ? null : parse(text);
  });
}
function writePacks(db, r, changes) {
  const keep = { pack: new Set(), piece: new Set() };
  if (r) {
    for (const p of r.data.packs) {
      keep.pack.add(p.id);
      const { pieces, ...body } = p;
      write(db, 'pack', p.id, { ...body, pieceOrder: pieces.map(d => d.id) }, changes);
      for (const d of pieces) {
        keep.piece.add(d.id);
        write(db, 'piece', d.id, d, changes);
      }
    }
    const { packs, ...data } = r.data;
    write(db, 'packs', '', { ...r, data, order: packs.map(p => p.id) }, changes);
  } else write(db, 'packs', '', null, changes);
  for (const kind of ['pack', 'piece'])
    for (const row of sql(db, 'SELECT id FROM records WHERE kind=?').all(kind))
      if (!keep[kind].has(row.id)) write(db, kind, row.id, null, changes);
}
function read(db) {
  return {
    ...meta(db, 'workspace'),
    current: record(db, 'current'),
    packs: getPacks(db),
    designs: sql(db, "SELECT json FROM records WHERE kind='design' ORDER BY rowid")
      .all()
      .map(r => parse(r.json)),
    trash: record(db, 'trash') || [],
  };
}
function seed(db, state) {
  const { current, packs, designs, trash, ...head } = state;
  setMeta(db, 'workspace', head);
  write(db, 'current', '', current);
  writePacks(db, packs);
  for (const r of designs) write(db, 'design', r.id, r);
  write(db, 'trash', '', trash);
}
function same(a, b) {
  return I.canonical(a) === I.canonical(b);
}
const legacyChecks = new Map();
function legacyStamp(directory) {
  const file = path.join(directory, 'workspace.json');
  if (!fs.existsSync(file)) return null;
  const s = fs.lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink() || s.size > L.MAX)
    fail('The preserved JSON workspace is invalid. Original retained.', 500);
  return { size: s.size, mtime: s.mtimeMs, ctime: s.ctimeMs, ino: s.ino };
}
function legacyDigest(directory) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(directory, 'workspace.json')))
    .digest('hex');
}
function ensureLegacyDigest(db, directory) {
  if (sql(db, "SELECT 1 FROM meta WHERE key='legacyDigest'").get()) return;
  // Compatibility with the first, unreleased SQLite implementation: only bless
  // an original file whose old stamp still matches. Never approve changed data.
  const old = meta(db, 'legacyStamp'),
    now = legacyStamp(directory);
  if (old && (!now || old.size !== now.size || old.mtime !== now.mtime))
    fail('The preserved JSON needs verification before this database can be upgraded. Original retained.', 500);
  if (!old && now) fail('An older Circuit copy created a JSON workspace. Keep both copies for recovery.', 409);
  setMeta(db, 'legacyDigest', now ? legacyDigest(directory) : null);
}
function guardLegacy(db, directory) {
  const expected = meta(db, 'legacyDigest'),
    stamp = legacyStamp(directory);
  // SQLite is self-contained. Removing an old recovery copy does not erase or
  // invalidate the live data; a new/changed JSON copy still needs investigation.
  if (!stamp) {
    legacyChecks.delete(directory);
    return;
  }
  const cached = legacyChecks.get(directory);
  if (cached?.digest === expected && same(cached.stamp, stamp)) return;
  if (!expected || legacyDigest(directory) !== expected)
    fail(
      'The preserved JSON workspace changed after migration, possibly from an older Circuit copy. Stop both copies and keep the data folder for recovery. SQLite was not overwritten.',
      409
    );
  legacyChecks.set(directory, { stamp, digest: expected });
  while (legacyChecks.size > 16) legacyChecks.delete(legacyChecks.keys().next().value);
}

async function init(directory) {
  let migrationResult = null;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink()) fail('The data directory must not be a symbolic link.', 500);
  const file = path.join(directory, 'workspace.sqlite'),
    marker = path.join(directory, 'sqlite-storage.json'),
    legacy = new L.DiskStore(directory),
    release = await legacy.lock();
  try {
    // A migration copy only exists while a start holds this lock. One still here was left by a
    // start that was killed part-way, so it is never published and can go.
    // The same for a lock file that a killed start had prepared but not yet put in place (a
    // start still waiting for the lock keeps its own, so only old ones go).
    for (const name of fs.readdirSync(directory))
      if (/^\.sqlite-migration-[-\w]+\.tmp(-journal|-wal|-shm)?$/.test(name))
        fs.rmSync(path.join(directory, name), { force: true });
      else if (/^\.write-lock-[-\w]+\.tmp$/.test(name))
        try {
          if (Date.now() - fs.statSync(path.join(directory, name)).mtimeMs > 60000)
            fs.rmSync(path.join(directory, name), { force: true });
        } catch {}
    if (fs.existsSync(file)) {
      const db = connect(file);
      try {
        db.exec('BEGIN IMMEDIATE');
        ensureLegacyDigest(db, directory);
        guardLegacy(db, directory);
        db.exec('COMMIT');
        if (sql(db, 'PRAGMA quick_check').get().quick_check !== 'ok')
          fail('SQLite integrity check failed. Original retained.', 500);
      } finally {
        db.close();
      }
    } else {
      if (fs.existsSync(marker))
        fail('The SQLite workspace is missing. Restore a backup; the older JSON was not reopened.', 500);
      const sourceDigest = legacyStamp(directory) ? legacyDigest(directory) : null;
      const state = await legacy.read(); // validates every legacy layout and pack before publication
      const temp = path.join(directory, '.sqlite-migration-' + uid() + '.tmp');
      let db;
      try {
        db = new DatabaseSync(temp);
        fs.chmodSync(temp, 0o600);
        db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
        schema(db);
        seed(db, state);
        setMeta(db, 'legacyStamp', legacyStamp(directory));
        setMeta(db, 'legacyDigest', sourceDigest);
        if (!same(read(db), state)) fail('Migration verification failed. Original JSON retained.', 500);
        db.exec('COMMIT');
        if (sql(db, 'PRAGMA integrity_check').get().integrity_check !== 'ok')
          fail('Migration integrity check failed.', 500);
        db.close();
        db = null;
        const verified = connect(temp);
        try {
          if (!same(read(verified), state))
            fail('Committed migration verification failed. Original JSON retained.', 500);
        } finally {
          verified.close();
        }
        if (sourceDigest !== (legacyStamp(directory) ? legacyDigest(directory) : null))
          fail(
            'The JSON workspace changed during migration. Original retained; retry after stopping other copies.',
            409
          );
        // Exclusive publication: never replace another process's database.
        try {
          fs.linkSync(temp, file);
          fs.unlinkSync(temp);
        } catch (e) {
          // FAT and exFAT drives (a portable copy on a USB stick) have no hard links. This start
          // holds the write lock, so no other Circuit can publish meanwhile: move it into place.
          if (!['EPERM', 'ENOTSUP', 'ENOSYS', 'EINVAL', 'EXDEV'].includes(e.code) || fs.existsSync(file)) throw e;
          fs.renameSync(temp, file);
        }
        migrationResult = {
          migrated: sourceDigest !== null,
          tracks: state.designs.length,
          packs: state.packs?.data.packs.length || 0,
          pieces: state.packs?.data.packs.reduce((n, p) => n + p.pieces.length, 0) || 0,
          current: !!state.current,
        };
        try {
          const fd = fs.openSync(directory, 'r');
          try {
            fs.fsyncSync(fd);
          } finally {
            fs.closeSync(fd);
          }
        } catch {}
      } finally {
        if (db) db.close();
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
      }
    }
    fs.writeFileSync(marker, json({ format: 'slotforge.sqlite-storage', version: FORMAT }) + '\n', { mode: 0o600 });
    fs.writeFileSync(
      path.join(directory, 'ABOUT-YOUR-DATA.txt'),
      'SlotForge Circuit data\nworkspace.sqlite is the active database. Stop Circuit before copying the data folder.\nUse Storage > Download workspace backup for a portable JSON backup while running.\nThe database keeps the last 20 changed-record transactions for recovery.\nworkspace.json and backups/ are unchanged migration-time recovery copies, NOT current backups.\nDo not delete SQLite or run an older app against this folder to roll back.\n',
      { mode: 0o600 }
    );
  } finally {
    await release();
  }
  return migrationResult;
}
function check(r, expected) {
  if ((r?.revision || null) !== (expected ?? null))
    fail('This file changed in another window. Reload before saving, or export your current work as JSON.', 409);
}
function trimTrash(db, changes) {
  const bytes = Number(meta(db, 'bytes'));
  if (bytes <= MAX_DATA) return;
  const old = record(db, 'trash') || [];
  let count = 0,
    freed = 0;
  while (count < old.length && bytes - freed > MAX_DATA) {
    freed += Buffer.byteLength(json(old[count])) + (old.length - count > 1 ? 1 : 0);
    count++;
  }
  if (count) write(db, 'trash', '', old.slice(count), changes);
}
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const changes = [],
      before = meta(db, 'workspace'),
      value = fn(changes);
    if (changes.length) {
      trimTrash(db, changes);
      if (Number(meta(db, 'bytes')) > MAX_DATA)
        fail('The workspace exceeds 200 MiB. Export or remove unused library entries.');
      setMeta(db, 'workspace', { ...before, revision: uid() });
      sql(db, 'INSERT INTO history(created,changes) VALUES(?,?)').run(
        new Date().toISOString(),
        json({ workspace: before, rows: changes })
      );
      db.exec('DELETE FROM history WHERE seq NOT IN (SELECT seq FROM history ORDER BY seq DESC LIMIT 20)');
      while (
        sql(db, 'SELECT coalesce(sum(octet_length(changes)),0) AS size FROM history').get().size >
        50 * 1024 * 1024
      )
        db.exec('DELETE FROM history WHERE seq=(SELECT min(seq) FROM history)');
    }
    db.exec('COMMIT');
    return value;
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    throw e;
  }
}
function transfer(s) {
  if (s.current) L.cleanLayout(s.current.data);
  if (s.packs) CP.read(s.packs.data);
  for (const r of s.designs) L.cleanLayout(r.layout);
  return {
    format: 'slotforge.workspace-transfer',
    version: 1,
    createdAt: new Date().toISOString(),
    current: s.current?.data || null,
    customLibrary: s.packs?.data || CP.serialize(CP.empty()),
    designs: s.designs.map(r => r.layout),
  };
}
function options(o = {}) {
  const offset = Number(o.offset ?? 0),
    limit = Number(o.limit ?? 24),
    query = String(o.query ?? '');
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    query.length > 100
  )
    fail('Invalid library page.');
  return { offset, limit, query };
}
// SQLite's own errors (a damaged or unreadable file) get the recovery advice, also when they
// come from opening the file rather than from a request.
function storageError(e) {
  if (e.code?.startsWith('ERR_SQLITE') || /database.*(malformed|encrypted)|not a database/i.test(e.message))
    return Object.assign(
      Error('Cannot read or write the SQLite workspace. Original retained; restore a verified backup. ' + e.message),
      { status: 500 }
    );
  return e;
}
async function run(directory, method, args) {
  const file = path.join(directory, 'workspace.sqlite');
  if (method === 'init') {
    forget(file);
    return init(directory).catch(e => {
      throw storageError(e);
    });
  }
  const reading = [
    'read',
    'current',
    'packs',
    'list',
    'summaries',
    'page',
    'get',
    'exportBundle',
    'previousBundle',
    'history',
    'trash',
  ].includes(method);
  // A read keeps the transaction the checks opened (one file lock instead of two), unless the
  // library summaries still need their one-time upgrade, which writes first.
  const upgrade = (method === 'summaries' || method === 'page') && !upgradedSummaries.has(file);
  let db;
  try {
    db = connection(file, reading && !upgrade);
  } catch (e) {
    throw storageError(e);
  }
  let failed = false;
  try {
    if (upgrade) upgradeSummaries(db, file);
    if (reading && !db.isTransaction) db.exec('BEGIN');
    guardLegacy(db, directory);
    if (method === 'read') return read(db);
    if (method === 'current') {
      const r = record(db, 'current');
      if (r) {
        L.cleanLayout(r.data);
        DL.validateSource(r.librarySource, r.data.design.id);
      }
      return r;
    }
    if (method === 'packs') {
      const r = getPacks(db);
      if (r) CP.read(r.data);
      return r;
    }
    if (method === 'list')
      return sql(db, "SELECT json FROM records WHERE kind='design' ORDER BY updated DESC,id")
        .all()
        .map(r => parse(r.json));
    if (method === 'summaries')
      return sql(db, "SELECT summary FROM records WHERE kind='design' ORDER BY updated DESC,id")
        .all()
        .map(r => parse(r.summary));
    if (method === 'page') {
      const { offset, limit, query } = options(args[0]),
        match = '%' + query.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%',
        where = "kind='design' AND title LIKE ? ESCAPE '\\'";
      return {
        items: sql(db, 'SELECT summary FROM records WHERE ' + where + ' ORDER BY updated DESC,id LIMIT ? OFFSET ?')
          .all(match, limit, offset)
          .map(r => parse(r.summary)),
        total: sql(db, 'SELECT count(*) AS n FROM records WHERE ' + where).get(match).n,
        offset,
        limit,
      };
    }
    if (method === 'get' || method === 'preview') {
      const r = record(db, 'design', args[0]);
      if (!r) fail('This track is no longer in the library.', 404);
      if (method === 'get') {
        L.cleanLayout(r.layout);
        return r;
      }
      const cached = sql(db, 'SELECT svg FROM previews WHERE id=? AND revision=?').get(r.id, r.revision);
      if (cached) return { svg: cached.svg, revision: r.revision };
      const clean = L.cleanLayout(r.layout),
        svg = clean.pieces.length ? I.picture(clean, { maxDimension: 600 }).svg : '';
      if (Buffer.byteLength(svg) <= 2 * 1024 * 1024) {
        sql(
          db,
          'INSERT INTO previews VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,svg=excluded.svg'
        ).run(r.id, r.revision, svg);
        db.exec('DELETE FROM previews WHERE rowid NOT IN (SELECT rowid FROM previews ORDER BY rowid DESC LIMIT 128)');
        while (sql(db, 'SELECT coalesce(sum(octet_length(svg)),0) n FROM previews').get().n > 32 * 1024 * 1024)
          db.exec('DELETE FROM previews WHERE rowid=(SELECT min(rowid) FROM previews)');
      }
      return { svg, revision: r.revision };
    }
    if (method === 'exportBundle') return transfer(read(db));
    if (method === 'previousBundle') {
      const h = sql(db, 'SELECT changes FROM history ORDER BY seq DESC LIMIT 1').get();
      if (!h) fail('No previous save is available.');
      const change = parse(h.changes),
        rows = new Map(
          sql(db, 'SELECT kind,id,json FROM records ORDER BY rowid')
            .all()
            .map(r => [json([r.kind, r.id]), r.json])
        );
      for (const row of [...change.rows].reverse()) {
        const key = json([row.kind, row.id]);
        if (row.before === null) rows.delete(key);
        else rows.set(key, row.before);
      }
      const get = (kind, id = '') => {
        const value = rows.get(json([kind, id]));
        return value === undefined ? null : parse(value);
      };
      return transfer({
        ...change.workspace,
        current: get('current'),
        packs: assemblePacks(get),
        designs: [...rows].filter(([key]) => parse(key)[0] === 'design').map(([, value]) => parse(value)),
        trash: get('trash') || [],
      });
    }
    if (method === 'history') return sql(db, 'SELECT seq,created FROM history ORDER BY seq DESC').all();
    if (method === 'putCurrent') {
      const data = L.cleanLayout(args[0]),
        source = DL.validateSource(args[2], data.design.id);
      return transaction(db, c => {
        const old = record(db, 'current');
        if (old && same(old.data, data) && same(old.librarySource || null, source)) return old;
        check(old, args[1]);
        const r = {
          revision: uid(),
          updatedAt: new Date().toISOString(),
          data,
          ...(source ? { librarySource: source } : {}),
        };
        write(db, 'current', '', r, c);
        return r;
      });
    }
    if (method === 'putPacks') {
      const data = CP.serialize(CP.read(args[0]));
      return transaction(db, c => {
        const old = getPacks(db);
        if (old && same(old.data, data)) return old;
        check(old, args[1]);
        const r = { revision: uid(), updatedAt: new Date().toISOString(), data };
        writePacks(db, r, c);
        return r;
      });
    }
    if (method === 'putDesign') {
      const layout = L.cleanLayout(args[0]),
        id = layout.design.id;
      return transaction(db, c => {
        const old = record(db, 'design', id);
        check(old, args[1]);
        if (!old && sql(db, "SELECT count(*) n FROM records WHERE kind='design'").get().n >= MAX_TRACKS)
          fail('The Track Library supports 5,000 saved tracks.');
        const r = {
          id,
          revision: uid(),
          updatedAt: new Date().toISOString(),
          layout,
          ...(old?.favourite ? { favourite: true } : {}),
        };
        write(db, 'design', id, r, c);
        return r;
      });
    }
    if (method === 'favourite')
      return transaction(db, c => {
        const r = record(db, 'design', args[0]);
        if (!r) fail('This track is no longer in the library.', 404);
        const { favourite, ...rest } = r;
        write(db, 'design', r.id, args[1] ? { ...rest, favourite: true } : rest, c, { keepPreview: true });
        return { favourite: !!args[1] };
      });
    if (method === 'trash')
      return (record(db, 'trash') || []).map(r => ({ ...summary(r), deletedAt: r.deletedAt })).reverse();
    if (method === 'restore')
      return transaction(db, c => {
        const trash = record(db, 'trash') || [],
          at = trash.findIndex(r => r.id === args[0] && r.deletedAt === args[1]);
        if (at < 0) fail('This track is no longer in the Bin.', 404);
        const { deletedAt, ...r } = trash[at];
        if (sql(db, "SELECT count(*) n FROM records WHERE kind='design'").get().n >= MAX_TRACKS)
          fail('The Track Library supports 5,000 saved tracks.');
        // A track saved again under the same id since it was deleted: the restored one becomes a copy.
        const layout = record(db, 'design', r.id)
            ? DL.prepare(r.layout, r.layout.title.slice(0, 89) + ' (restored)', true)
            : L.cleanLayout(r.layout),
          back = { ...r, id: layout.design.id, revision: uid(), updatedAt: new Date().toISOString(), layout };
        write(db, 'design', back.id, back, c);
        write(
          db,
          'trash',
          '',
          trash.filter((_, i) => i !== at),
          c
        );
        return back;
      });
    if (method === 'purge')
      return transaction(db, c => {
        const trash = record(db, 'trash') || [],
          keep = args[0] == null ? [] : trash.filter(r => !(r.id === args[0] && r.deletedAt === args[1]));
        write(db, 'trash', '', keep, c);
        return { removed: trash.length - keep.length };
      });
    if (method === 'remove')
      return transaction(db, c => {
        const r = record(db, 'design', args[0]);
        if (!r) fail('This track is no longer in the library.', 404);
        check(r, args[1]);
        write(
          db,
          'trash',
          '',
          [...(record(db, 'trash') || []), { ...r, deletedAt: new Date().toISOString() }].slice(-20),
          c
        );
        write(db, 'design', r.id, null, c);
        return { removed: true };
      });
    if (method === 'importBundle') {
      const raw = args[0];
      if (
        raw?.format !== 'slotforge.workspace-transfer' ||
        raw.version !== 1 ||
        !Array.isArray(raw.designs) ||
        raw.designs.length > MAX_TRACKS
      )
        fail('Choose a SlotForge workspace-transfer JSON file.');
      const layouts = raw.designs.map(L.cleanLayout),
        current = raw.current ? L.cleanLayout(raw.current) : null,
        packs = CP.read(raw.customLibrary);
      return transaction(db, c => {
        let added = 0,
          skipped = 0,
          packCount = 0;
        const existing = sql(db, "SELECT json FROM records WHERE kind='design'")
            .all()
            .map(r => parse(r.json)),
          signatures = new Set(existing.map(r => r.importSignature || L.layoutSignature(r.layout))),
          ids = new Set(existing.map(r => r.id));
        for (const layout of [...layouts, ...(current ? [current] : [])]) {
          const signature = L.layoutSignature(layout);
          if (signatures.has(signature)) {
            skipped++;
            continue;
          }
          if (ids.size >= MAX_TRACKS) fail('Import would exceed 5,000 saved tracks. No changes were written.');
          const value = ids.has(layout.design.id)
            ? DL.prepare(layout, layout.title.slice(0, 89) + ' (imported)', true)
            : layout;
          write(
            db,
            'design',
            value.design.id,
            {
              id: value.design.id,
              revision: uid(),
              updatedAt: new Date().toISOString(),
              layout: value,
              importSignature: signature,
            },
            c
          );
          ids.add(value.design.id);
          signatures.add(signature);
          added++;
        }
        const target = CP.read(getPacks(db)?.data);
        for (const p of packs.packs) {
          const pack = CP.exportPack(p);
          if (target.packs.some(t => L.packSignature(CP.exportPack(t)) === L.packSignature(pack))) continue;
          target.packs.push({ ...CP.importPack(pack, target), inLibrary: p.inLibrary });
          packCount++;
        }
        if (packCount)
          writePacks(db, { revision: uid(), updatedAt: new Date().toISOString(), data: CP.serialize(target) }, c);
        return { tracksAdded: added, tracksSkipped: skipped, packsAdded: packCount };
      });
    }
    fail('Unknown storage operation.');
  } catch (e) {
    failed = true;
    throw storageError(e);
  } finally {
    // Never leave a transaction open on the kept connection.
    try {
      db.exec('ROLLBACK');
    } catch {}
    if (failed) forget(file);
  }
}
function release(directory) {
  forget(path.join(directory, 'workspace.sqlite'));
}
module.exports = { run, release, MAX_DATA, MAX_TRACKS };
