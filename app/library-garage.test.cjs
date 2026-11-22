// Track Library (the Garage): card facts in the summaries, the favourite star, and the Bin.
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  { DatabaseSync } = require('node:sqlite');
const { DiskStore } = require('./disk-store.cjs'),
  I = require('./integration.js'),
  DL = require('./design-library.js');
const raw = (title = 'Garage oval') =>
  I.prepare({ ...require('../integration/slotforge-timing/fixtures/01-closed-oval.slotforge.json'), title });
async function store(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'circuit-garage-')),
    s = new DiskStore(path.join(root, 'data'));
  t.after(async () => {
    await s.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  await s.init();
  return { s, root };
}

test('Summaries carry the card facts: kind, systems, lap length and footprint', () => {
  const layout = raw(),
    summary = DL.summarize({ id: 'a', revision: 'r', updatedAt: '2026-11-20T10:00:00Z', layout });
  assert.equal(summary.v, DL.SUMMARY_VERSION);
  assert.equal(summary.kind, 'sectional');
  assert.ok(Array.isArray(summary.systems));
  assert.ok(summary.laneCount >= 1);
  assert.ok(summary.lapMm > 1000, 'lap ' + summary.lapMm);
  const lanes = layout.track.lanes.map(l => l.lengthMm);
  assert.ok(summary.lapMm >= Math.min(...lanes) - 1 && summary.lapMm <= Math.max(...lanes) + 1);
  assert.equal(summary.sizeMm.length, 2);
  assert.ok(summary.sizeMm.every(v => v > 100));
  assert.equal(summary.favourite, false);
});

test('A star survives saving the track again and does not change its revision', async t => {
  const { s } = await store(t),
    saved = await s.putDesign(raw(), null);
  await s.favourite(saved.id, true);
  let row = (await s.summaries())[0];
  assert.equal(row.favourite, true);
  assert.equal(row.revision, saved.revision, 'the star must not look like an edit');
  const again = await s.putDesign({ ...raw(), design: saved.layout.design }, saved.revision);
  row = (await s.summaries())[0];
  assert.equal(row.favourite, true);
  assert.equal(row.revision, again.revision);
  await s.favourite(saved.id, false);
  assert.equal((await s.summaries())[0].favourite, false);
});

test('Deleting moves a track to the Bin; it can be restored or deleted for good', async t => {
  const { s } = await store(t),
    a = await s.putDesign(raw('Kept'), null),
    b = await s.putDesign(raw('Binned'), null);
  await s.remove(b.id, b.revision);
  let bin = await s.trash();
  assert.equal(bin.length, 1);
  assert.equal(bin[0].title, 'Binned');
  assert.ok(bin[0].deletedAt);
  assert.equal(bin[0].kind, 'sectional');
  const back = await s.restore(bin[0].id, bin[0].deletedAt);
  assert.equal(back.layout.title, 'Binned');
  assert.deepEqual((await s.summaries()).map(r => r.title).sort(), ['Binned', 'Kept']);
  assert.equal((await s.trash()).length, 0);
  await assert.rejects(s.restore(bin[0].id, bin[0].deletedAt), /no longer in the Bin/);
  await s.remove(back.id, back.revision);
  await s.remove(a.id, a.revision);
  bin = await s.trash();
  assert.equal(bin.length, 2);
  assert.equal((await s.purge(bin[0].id, bin[0].deletedAt)).removed, 1);
  assert.equal((await s.trash()).length, 1);
  assert.equal((await s.purge(null)).removed, 1);
  assert.equal((await s.trash()).length, 0);
});

test('A restored track whose id was saved again comes back as a copy', async t => {
  const { s } = await store(t),
    a = await s.putDesign(raw('Twin'), null);
  await s.remove(a.id, a.revision);
  await s.putDesign(a.layout, null); // the same design saved again from the builder
  const [binned] = await s.trash(),
    back = await s.restore(binned.id, binned.deletedAt);
  assert.notEqual(back.id, a.id);
  assert.equal(back.layout.title, 'Twin (restored)');
  assert.equal((await s.summaries()).length, 2);
});

test('Older summaries are filled in with the card facts when the library is read', async t => {
  const { s, root } = await store(t),
    saved = await s.putDesign(raw(), null);
  await s.close();
  const db = new DatabaseSync(path.join(root, 'data', 'workspace.sqlite'));
  db.prepare("UPDATE records SET summary=? WHERE kind='design'").run(
    JSON.stringify({ id: saved.id, revision: saved.revision, updatedAt: saved.updatedAt, title: 'Garage oval' })
  );
  db.close();
  const reopened = new DiskStore(path.join(root, 'data'));
  t.after(() => reopened.close());
  await reopened.init();
  const [row] = await reopened.summaries();
  assert.equal(row.v, DL.SUMMARY_VERSION);
  assert.ok(row.lapMm > 0);
  assert.equal(row.revision, saved.revision);
});
