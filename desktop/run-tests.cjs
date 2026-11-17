'use strict';
// Runs every automated test file: app, installer and desktop shell.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = ['app', 'installer', 'desktop'].flatMap(dir =>
  fs
    .readdirSync(path.join(root, dir))
    .filter(name => name.endsWith('.test.cjs'))
    .map(name => path.join(dir, name))
);
const failed = [];
for (const file of files) {
  const run = spawnSync(process.execPath, [file], { cwd: root, encoding: 'utf8' });
  if (run.status !== 0) {
    failed.push(file);
    console.error(`FAIL ${file}\n${(run.stderr || run.stdout).slice(0, 2000)}`);
  }
}
console.log(`${files.length - failed.length}/${files.length} test files passed.`);
if (failed.length) process.exit(1);
