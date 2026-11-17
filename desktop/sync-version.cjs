'use strict';
// The app version is set in one place: VERSION in app/integration.js.
// This copies it into package.json (used by the desktop builds).
// Run: npm run version:sync  (the desktop build script also runs it).
const fs = require('node:fs');
const path = require('node:path');

function sync() {
  const file = path.join(__dirname, '..', 'package.json');
  const text = fs.readFileSync(file, 'utf8');
  const version = require('../app/integration.js').VERSION;
  const current = JSON.parse(text).version;
  if (current === version) return { version, changed: false };
  fs.writeFileSync(file, text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`));
  return { version, changed: true, previous: current };
}

if (require.main === module) {
  const result = sync();
  console.log(
    result.changed
      ? `package.json version updated ${result.previous} → ${result.version}`
      : `package.json already at ${result.version}`
  );
}
module.exports = { sync };
