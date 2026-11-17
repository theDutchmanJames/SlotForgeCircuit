'use strict';
// Starts Circuit from the source tree in interface-test mode with a throwaway
// data folder, then prints the result of every test in desktop/ui-tests.cjs.
// Usage: npm run test:ui            (all tests)
//        npm run test:ui -- resize  (only tests whose name contains "resize")
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'circuit-ui-'));
const result = path.join(work, 'result.json');
const env = { ...process.env, SLOTFORGE_UI_TESTS: result };
if (process.argv[2]) env.SLOTFORGE_UI_ONLY = process.argv[2];
delete env.ELECTRON_RUN_AS_NODE;

const run = spawnSync(require('electron'), [root, `--portable-data-dir=${path.join(work, 'data')}`], {
  env,
  timeout: 300000,
  stdio: ['ignore', 'ignore', 'pipe'],
  encoding: 'utf8',
});
let report;
try {
  report = JSON.parse(fs.readFileSync(result, 'utf8'));
} catch {
  console.error('The app did not produce interface test results.\n' + (run.stderr || run.error?.message || ''));
  process.exit(1);
}
fs.rmSync(work, { recursive: true, force: true });
if (report.crashed) {
  console.error('Interface test runner crashed:\n' + report.crashed);
  process.exit(1);
}
for (const r of report.results)
  console.log(`${r.ok ? '✔' : '✖'} ${r.name}${r.ok ? ` (${r.ms} ms)` : `\n    ${r.error}`}`);
const failed = report.results.filter(r => !r.ok).length;
console.log(`\n${report.results.length - failed}/${report.results.length} interface tests passed.`);
if (failed) process.exit(1);
