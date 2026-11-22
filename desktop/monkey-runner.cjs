'use strict';
// Random-click run on a COPY of a Track Library: starts Circuit from the source tree, lets
// desktop/monkey.cjs click, type and drag at random, and writes what went wrong.
//
//   node desktop/monkey-runner.cjs --minutes 60 --from "C:\path\to\SlotForge Circuit Data\workspace"
//   node desktop/monkey-runner.cjs --minutes 5            (an empty workspace)
//   --seed 123 repeats a run; --show shows the window; --out report.json chooses the report file.
//
// The library is copied with SQLite's own online copy (VACUUM INTO), which is safe while Circuit
// is open on it; the original is only read.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const arg = name => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? null : process.argv[i + 1];
};
const minutes = Number(arg('minutes') || 5),
  from = arg('from'),
  out = path.resolve(arg('out') || path.join(root, 'dist', 'monkey-report.json'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'circuit-monkey-')),
  workspace = path.join(work, 'data', 'workspace'),
  result = path.join(work, 'result.json');
fs.mkdirSync(workspace, { recursive: true });
if (from) {
  const source = path.join(path.resolve(from), 'workspace.sqlite');
  if (!fs.existsSync(source)) throw Error('No workspace.sqlite in ' + from);
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${path.join(workspace, 'workspace.sqlite').replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  const db2 = new DatabaseSync(path.join(workspace, 'workspace.sqlite'), { readOnly: true });
  console.log(
    `Copied ${db2.prepare("SELECT count(*) n FROM records WHERE kind='design'").get().n} tracks from ${from}`
  );
  db2.close();
}
// --tracks N adds N sample tracks to the copy, so the Track Library and Print Shop have something to show.
const extra = Number(arg('tracks') || 0);
if (extra > 0) {
  const store = require('../app/sqlite-store.cjs'),
    I = require('../app/integration.js'),
    CP = require('../app/custom-packs.js'),
    DL = require('../app/design-library.js'),
    names = ['01-closed-oval', '02-reflected-oval', '03-open-layout', '04-lane-changer'],
    fixtures = names.map(n => I.prepare(require(`../integration/slotforge-timing/fixtures/${n}.slotforge.json`)));
  (async () => {
    await store.run(workspace, 'init', []);
    const added = await store.run(workspace, 'importBundle', [
      {
        format: 'slotforge.workspace-transfer',
        version: 1,
        current: null,
        customLibrary: CP.serialize(CP.empty()),
        designs: Array.from({ length: extra }, (_, i) => DL.prepare(fixtures[i % 4], `Sample track ${i + 1}`, true)),
      },
    ]);
    store.release(workspace);
    console.log(`Added ${added.tracksAdded} sample tracks to the copy`);
    start();
  })();
} else start();

function start() {
  const env = {
    ...process.env,
    SLOTFORGE_UI_TESTS: result,
    SLOTFORGE_MONKEY: '1',
    SLOTFORGE_MONKEY_MINUTES: String(minutes),
  };
  if (arg('seed')) env.SLOTFORGE_MONKEY_SEED = arg('seed');
  delete env.ELECTRON_RUN_AS_NODE;
  console.log(`Random-click run for ${minutes} min in ${work} …`);
  const started = Date.now();
  const run = spawnSync(require('electron'), [root, `--portable-data-dir=${path.join(work, 'data')}`], {
    env,
    timeout: (minutes + 5) * 60000,
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf8',
  });
  let report;
  try {
    report = JSON.parse(fs.readFileSync(result, 'utf8'));
  } catch {
    console.error('The app did not produce a report.\n' + (run.stderr || run.error?.message || ''));
    process.exit(1);
  }
  if (report.crashed) {
    console.error('The run itself crashed:\n' + report.crashed);
    process.exit(1);
  }
  const m = report.monkey;
  if (m.partial)
    console.log(`The run stopped early, after ${m.stats.steps} steps. Last steps: ${m.recent.join(' | ')}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(m, null, 2));
  // Downloads made during the run went to the temp folder as circuit-ui-<time>-<name> files
  // (interface-test mode); remove only those files from this run, never folders of other runs.
  for (const name of fs.readdirSync(os.tmpdir())) {
    const at = /^circuit-ui-(\d{13})-/.exec(name),
      full = path.join(os.tmpdir(), name);
    if (at && Number(at[1]) >= started)
      try {
        if (fs.lstatSync(full).isFile()) fs.rmSync(full);
      } catch {}
  }
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`Seed ${m.seed}: ${JSON.stringify(m.stats)}`);
  const problems = m.found.filter(f => f.kind !== 'note');
  for (const f of m.found)
    console.log(
      `\n[${f.kind}] ×${f.count} first at step ${f.step} (${f.section || '?'})\n  ${f.message}\n  after: ${f.before.slice(-5).join(' | ')}`
    );
  console.log(`\n${problems.length} distinct problems. Report: ${out}`);
}
