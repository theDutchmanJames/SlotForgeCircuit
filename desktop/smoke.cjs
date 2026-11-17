'use strict';
// Desktop smoke test: start Circuit with a throwaway portable data folder and
// check the window loads, connects to disk storage and shuts down cleanly.
// Usage: node desktop/smoke.cjs [path-to-built-executable]
// Without an argument it runs the source tree with the installed Electron.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const target = process.argv[2] ? path.resolve(process.argv[2]) : require('electron');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'circuit-smoke-'));
const result = path.join(work, 'result.json');
const data = path.join(work, 'SlotForge Circuit Data');
const args = process.argv[2] ? [`--portable-data-dir=${data}`] : [root, `--portable-data-dir=${data}`];
const env = { ...process.env, SLOTFORGE_DESKTOP_SMOKE: result };
delete env.ELECTRON_RUN_AS_NODE;

const run = spawnSync(target, args, { env, timeout: 90000, stdio: 'inherit' });
if (run.error) throw run.error;
const report = JSON.parse(fs.readFileSync(result, 'utf8'));
const problems = [];
if (!report.page?.storage?.startsWith('Storage: disk'))
  problems.push(`storage label was ${JSON.stringify(report.page?.storage)}`);
if (!report.page?.desktop) problems.push('desktop preload flag missing');
if (report.page?.stop !== 'Quit Circuit') problems.push('Stop button not relabelled');
if (!(report.page?.packs > 5)) problems.push('track pack list did not load');
if (report.errors.length) problems.push('console errors: ' + report.errors.join(' | '));
if (!fs.existsSync(path.join(data, 'workspace', 'workspace.sqlite'))) problems.push('workspace.sqlite was not created');
if (run.status !== 0) problems.push(`exit code ${run.status}`);
console.log(
  JSON.stringify({ target: path.basename(target), ...report.page, mode: report.mode, version: report.version }, null, 1)
);
fs.rmSync(work, { recursive: true, force: true });
if (problems.length) {
  console.error('Desktop smoke test FAILED:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('Desktop smoke test passed.');
