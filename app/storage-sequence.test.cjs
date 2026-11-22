// Random sequences of library actions against the SQLite workspace. After every step the quick
// views (summaries, pages, single tracks, the Bin) must agree with the full read, the backup
// export and a simple model of what the user did; a refused action must change nothing; the
// "previous save" export must rebuild exactly the state before the last change; and reopening
// the workspace must give back the same data.
//
// CIRCUIT_SEQUENCE_STEPS=5000 CIRCUIT_SEQUENCE_SEED=123 node app/storage-sequence.test.cjs
// runs a longer or a repeated sequence. A failure prints the seed and the steps that led to it.
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  { DatabaseSync } = require('node:sqlite');
const store = require('./sqlite-store.cjs'),
  I = require('./integration.js'),
  CP = require('./custom-packs.js'),
  DL = require('./design-library.js');

const STEPS = Number(process.env.CIRCUIT_SEQUENCE_STEPS || 80),
  SEEDS = process.env.CIRCUIT_SEQUENCE_SEED ? [Number(process.env.CIRCUIT_SEQUENCE_SEED)] : [1, 2];
const fixtures = ['01-closed-oval', '02-reflected-oval', '03-open-layout', '04-lane-changer'].map(name =>
  I.prepare(require(`../integration/slotforge-timing/fixtures/${name}.slotforge.json`), undefined, false)
);
const canon = I.canonical;

function random(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 2 ** 32;
  };
}

async function sequence(seed, steps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'circuit-sequence-')),
    rnd = random(seed),
    pick = list => list[Math.floor(rnd() * list.length)],
    call = (method, ...args) => store.run(dir, method, args),
    log = [];
  // What the user should see: tracks by id (revision, title, star) and the Bin's entries.
  const model = { designs: new Map(), trash: [], current: null, packs: null };
  let titles = 0;
  const title = () =>
    pick(['Oval', 'Club layout', 'Garage', 'Figure eight', 'Bridge test', '100% _wild\\']) + ' ' + ++titles;

  async function snapshot() {
    const full = await call('read'),
      bundle = await call('exportBundle');
    delete bundle.createdAt;
    return { full, bundle, history: (await call('history'))[0]?.seq || 0 };
  }
  const sortedDesigns = bundle => bundle.designs.map(canon).sort();

  async function verify(before, deep = true) {
    const { full, bundle, history } = await snapshot();
    // Full read against the model.
    assert.deepEqual(full.designs.map(r => r.id).sort(), [...model.designs.keys()].sort(), 'tracks in the library');
    for (const r of full.designs) {
      const m = model.designs.get(r.id);
      assert.equal(r.revision, m.revision, 'revision of ' + r.id);
      assert.equal(r.layout.title, m.title, 'title of ' + r.id);
      assert.equal(!!r.favourite, m.favourite, 'star of ' + r.id);
    }
    assert.deepEqual(
      full.trash.map(r => r.id + '@' + r.deletedAt),
      model.trash.map(r => r.id + '@' + r.deletedAt),
      'Bin contents'
    );
    assert.equal(full.current?.revision || null, model.current, 'current revision');
    assert.equal(full.packs?.revision || null, model.packs, 'packs revision');
    // The quick views agree with the full read.
    const summaries = await call('summaries');
    assert.deepEqual(
      summaries.map(s => s.id).sort(),
      full.designs.map(r => r.id).sort(),
      'summaries list the same tracks'
    );
    const byId = new Map(full.designs.map(r => [r.id, r]));
    // Rebuilding every summary is the slow part, so it runs on every fifth step and at the end.
    if (deep) for (const s of summaries) assert.deepEqual(s, DL.summarize(byId.get(s.id)), 'summary of ' + s.id);
    const ordered = [...full.designs].sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
    );
    assert.deepEqual(
      summaries.map(s => s.id),
      ordered.map(r => r.id),
      'summaries newest first'
    );
    const list = await call('list');
    assert.deepEqual(
      list.map(r => r.id),
      ordered.map(r => r.id),
      'list matches summaries order'
    );
    for (const query of ['', 'oval', '%', '_', '\\', 'nothing matches this']) {
      const want = summaries.filter(s => s.title.toLowerCase().includes(query.toLowerCase()));
      let offset = 0,
        seen = [];
      for (;;) {
        const p = await call('page', { query, offset, limit: 7 });
        assert.equal(p.total, want.length, `page total for "${query}"`);
        seen.push(...p.items.map(s => s.id));
        offset += 7;
        if (offset >= p.total) break;
      }
      assert.deepEqual(
        seen,
        want.map(s => s.id),
        `pages for "${query}"`
      );
    }
    if (full.designs.length) {
      const r = pick(full.designs),
        got = await call('get', r.id);
      assert.equal(got.revision, r.revision);
      assert.equal(canon(got.layout), canon(L().cleanLayout(structuredClone(r.layout))));
      const pic = await call('preview', r.id);
      assert.equal(pic.revision, r.revision, 'preview revision');
    }
    const bin = await call('trash');
    assert.deepEqual(
      bin.map(r => r.id + '@' + r.deletedAt),
      [...model.trash].reverse().map(r => r.id + '@' + r.deletedAt),
      'Bin view newest first'
    );
    // The backup export matches the full read.
    assert.deepEqual(sortedDesigns(bundle), full.designs.map(r => canon(r.layout)).sort(), 'export holds every track');
    assert.equal(canon(bundle.current), canon(full.current?.data || null), 'export holds the current layout');
    // The previous-save export rebuilds the state before the last change.
    if (before && history > before.history) {
      const previous = await call('previousBundle');
      delete previous.createdAt;
      assert.deepEqual(sortedDesigns(previous), sortedDesigns(before.bundle), 'previous save: tracks');
      assert.equal(canon(previous.current), canon(before.bundle.current), 'previous save: current');
      assert.equal(canon(previous.customLibrary), canon(before.bundle.customLibrary), 'previous save: packs');
    }
    return { full, bundle, history };
  }

  function database(fn) {
    store.release(dir);
    const db = new DatabaseSync(path.join(dir, 'workspace.sqlite'));
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }
  function checkFile() {
    database(db => {
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      const counted = db.prepare('SELECT coalesce(sum(length(CAST(json AS BLOB))),0) n FROM records').get().n,
        bytes = Number(JSON.parse(db.prepare("SELECT value FROM meta WHERE key='bytes'").get().value));
      assert.equal(bytes, counted, 'workspace size count matches the stored rows');
      assert.ok(db.prepare('SELECT count(*) n FROM history').get().n <= 20, 'history keeps at most 20 saves');
      assert.ok(db.prepare('SELECT count(*) n FROM previews').get().n <= 128, 'at most 128 cached pictures');
      for (const row of db.prepare('SELECT id,revision FROM previews').all()) {
        const r = db.prepare("SELECT json FROM records WHERE kind='design' AND id=?").get(row.id);
        if (r) assert.equal(JSON.parse(r.json).revision, row.revision, 'cached picture belongs to the saved revision');
      }
    });
  }

  // Each action returns true when it should have changed something, and throws on a wrong answer.
  const actions = {
    async add() {
      const layout = DL.prepare(pick(fixtures), title(), true),
        r = await call('putDesign', layout, null);
      model.designs.set(r.id, { revision: r.revision, title: layout.title, favourite: false });
    },
    async edit() {
      if (!model.designs.size) return this.add();
      const id = pick([...model.designs.keys()]),
        m = model.designs.get(id),
        saved = await call('get', id),
        name = title(),
        r = await call('putDesign', DL.prepare(saved.layout, name), m.revision);
      assert.equal(r.id, id);
      assert.equal(!!r.favourite, m.favourite, 'an edit keeps the star');
      Object.assign(m, { revision: r.revision, title: name });
    },
    async staleEdit() {
      if (!model.designs.size) return false;
      const id = pick([...model.designs.keys()]),
        saved = await call('get', id);
      await assert.rejects(call('putDesign', DL.prepare(saved.layout, title()), 'not-the-saved-revision'), {
        status: 409,
      });
      return false;
    },
    async star() {
      if (!model.designs.size) return false;
      const id = pick([...model.designs.keys()]),
        m = model.designs.get(id),
        on = rnd() < 0.6;
      await call('favourite', id, on);
      const changed = m.favourite !== on;
      m.favourite = on;
      return changed;
    },
    async remove() {
      if (!model.designs.size) return false;
      const id = pick([...model.designs.keys()]),
        m = model.designs.get(id);
      await call('remove', id, m.revision);
      model.designs.delete(id);
      const binned = (await call('trash'))[0];
      assert.equal(binned.id, id);
      model.trash = [...model.trash, { id, deletedAt: binned.deletedAt }].slice(-20);
    },
    async staleRemove() {
      if (!model.designs.size) return false;
      await assert.rejects(call('remove', pick([...model.designs.keys()]), 'old'), { status: 409 });
      return false;
    },
    async removeMissing() {
      await assert.rejects(call('remove', 'no-such-track', null), { status: 404 });
      return false;
    },
    async restore() {
      if (!model.trash.length) return false;
      const entry = pick(model.trash),
        clash = model.designs.has(entry.id),
        before = (await call('read')).trash.find(r => r.id === entry.id && r.deletedAt === entry.deletedAt),
        back = await call('restore', entry.id, entry.deletedAt);
      if (clash) {
        assert.notEqual(back.id, entry.id, 'a restored copy gets its own id when the old id is in use');
        assert.ok(back.layout.title.endsWith(' (restored)'));
      } else assert.equal(back.id, entry.id);
      model.trash = model.trash.filter(t => t !== entry);
      model.designs.set(back.id, { revision: back.revision, title: back.layout.title, favourite: !!before.favourite });
    },
    async restoreMissing() {
      await assert.rejects(call('restore', 'no-such-track', 'never'), { status: 404 });
      return false;
    },
    async purgeOne() {
      if (!model.trash.length) return false;
      const entry = pick(model.trash),
        result = await call('purge', entry.id, entry.deletedAt);
      assert.equal(result.removed, 1);
      model.trash = model.trash.filter(t => t !== entry);
    },
    async purgeAll() {
      const result = await call('purge', null, null);
      assert.equal(result.removed, model.trash.length);
      const changed = model.trash.length > 0;
      model.trash = [];
      return changed;
    },
    async current() {
      const base = model.designs.size && rnd() < 0.5 ? await call('get', pick([...model.designs.keys()])) : null,
        layout = base ? base.layout : DL.prepare(pick(fixtures), title(), true),
        source = base && rnd() < 0.7 ? { id: base.id, revision: base.revision } : null,
        old = await call('current'),
        r = await call('putCurrent', layout, model.current, source);
      const changed = !old || old.revision !== r.revision;
      model.current = r.revision;
      return changed;
    },
    async currentAgain() {
      // Autosave with nothing changed writes nothing.
      const old = await call('current');
      if (!old) return false;
      const r = await call('putCurrent', old.data, 'whatever', old.librarySource || null);
      assert.equal(r.revision, old.revision);
      return false;
    },
    async staleCurrent() {
      if (!model.current) return false;
      await assert.rejects(call('putCurrent', DL.prepare(pick(fixtures), title(), true), 'old', null), {
        status: 409,
      });
      return false;
    },
    async packs() {
      const old = await call('packs'),
        data = CP.read(old?.data);
      const roll = rnd();
      if (roll < 0.4) data.packs[0].name = 'Pack ' + ++titles;
      else if (roll < 0.7 || data.packs.length < 2)
        data.packs.push({
          id: 'custom-pack-' + ++titles,
          name: 'Set ' + titles,
          inLibrary: rnd() < 0.5,
          pieces: [],
          curveFamily: {
            type: 'curve',
            innerRadiusMm: 200,
            widthMm: 200,
            angleDeg: 45,
            laneCount: 2,
            laneSpacingMm: 100,
          },
        });
      else data.packs.pop();
      const r = await call('putPacks', CP.serialize(data), model.packs);
      const changed = r.revision !== old?.revision;
      model.packs = r.revision;
      return changed;
    },
    async importOwn() {
      // A backup imported into the workspace it came from adds nothing the second time.
      const bundle = await call('exportBundle'),
        first = await call('importBundle', bundle);
      await this.resync();
      const again = await call('importBundle', bundle);
      assert.deepEqual([again.tracksAdded, again.packsAdded], [0, 0], 'importing the same backup twice adds nothing');
      return first.tracksAdded + first.packsAdded > 0;
    },
    async importNew() {
      const designs = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () =>
          DL.prepare(pick(fixtures), title(), true)
        ),
        bundle = {
          format: 'slotforge.workspace-transfer',
          version: 1,
          current: null,
          customLibrary: CP.serialize(CP.empty()),
          designs,
        },
        result = await call('importBundle', bundle);
      assert.equal(result.tracksAdded, designs.length);
      await this.resync();
    },
    async badImport() {
      await assert.rejects(call('importBundle', { format: 'something-else' }), { status: 400 });
      return false;
    },
    async reopen() {
      const before = await call('read');
      checkFile();
      await call('init');
      assert.deepEqual(await call('read'), before, 'reopening gives back the same workspace');
      return false;
    },
    // After an import the new rows come from the store; take their revisions into the model.
    async resync() {
      const full = await call('read');
      for (const r of full.designs)
        if (!model.designs.has(r.id))
          model.designs.set(r.id, { revision: r.revision, title: r.layout.title, favourite: !!r.favourite });
      model.packs = full.packs?.revision || null;
    },
  };
  const weights = {
    add: 8,
    edit: 6,
    staleEdit: 2,
    star: 4,
    remove: 4,
    staleRemove: 1,
    removeMissing: 1,
    restore: 3,
    restoreMissing: 1,
    purgeOne: 1,
    purgeAll: 0.5,
    current: 4,
    currentAgain: 2,
    staleCurrent: 1,
    packs: 2,
    importOwn: 1,
    importNew: 1,
    badImport: 1,
    reopen: 1,
  };
  const bag = Object.entries(weights).flatMap(([name, w]) => Array(Math.round(w * 2)).fill(name));
  try {
    await call('init');
    let state = await verify(null);
    for (let step = 0; step < steps; step++) {
      const name = pick(bag);
      log.push(name);
      const changed = (await actions[name].call(actions)) !== false;
      const next = await verify(state, step % 5 === 4 || step === steps - 1);
      if (!changed)
        assert.equal(canon(next.full), canon(state.full), `"${name}" changed nothing, so the workspace is unchanged`);
      state = next;
    }
    checkFile();
  } catch (e) {
    e.message = `seed ${seed}, step ${log.length}: ${log.slice(-12).join(' → ')}\n${e.message}`;
    throw e;
  } finally {
    store.release(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const L = () => require('./legacy-disk-store.cjs');

for (const seed of SEEDS)
  test(`Random library actions keep every view of the workspace in step (seed ${seed}, ${STEPS} steps)`, () =>
    sequence(seed, STEPS));
