const test = require('node:test'),
  assert = require('node:assert/strict'),
  path = require('node:path');
const handler = require('./serve.cjs').createHandler(path.resolve(__dirname, '..'));
async function request(url, method = 'GET', headers = {}) {
  const result = {};
  await handler(
    { url, method, headers: { host: '127.0.0.1:8173', ...headers } },
    {
      writeHead(status, headers) {
        result.status = status;
        result.headers = headers;
        return this;
      },
      end(data) {
        result.data = data;
        return this;
      },
    }
  );
  return result;
}
test('Local server serves app and HEAD with correct MIME and no caching', async () => {
  const r = await request('/app/');
  assert.equal(r.status, 200);
  assert.match(r.data.toString(), /SlotForge Circuit/);
  assert.match(r.headers['Content-Type'], /text\/html/);
  assert.equal(r.headers['Cache-Control'], 'no-store');
  const h = await request('/app/', 'HEAD');
  assert.equal(h.status, 200);
  assert.equal(h.data, undefined);
});
test('Local server rejects remote hosts, cross-origin reads and writes', async () => {
  assert.equal((await request('/app/', 'GET', { host: 'attacker.example:8173' })).status, 403);
  assert.equal((await request('/app/', 'GET', { origin: 'https://example.com' })).status, 403);
  assert.equal((await request('/app/', 'POST')).status, 405);
  assert.equal((await request('/app/', 'GET', { host: 'localhost:8173' })).status, 200);
});
test('Local server rejects malformed, hidden and escaping paths', async () => {
  for (const url of ['/app/%ZZ', '/app/%00x', '/app/file.txt:stream']) assert.equal((await request(url)).status, 400);
  for (const url of ['/.git/config', '/.codex/settings.json', '/..%2f..%2fprivate.txt'])
    assert.equal((await request(url)).status, 403);
  assert.equal((await request('/app/serve.cjs')).status, 404);
  assert.equal((await request('/does-not-exist.json')).status, 404);
});
test(
  'Local server serves files when its folder is given as a Windows 8.3 short path',
  { skip: process.platform !== 'win32' },
  async t => {
    // The portable desktop app runs from %TEMP%, which is often a short path such as C:\Users\LONGNA~1\...
    const fs = require('node:fs'),
      os = require('node:os'),
      { execFileSync } = require('node:child_process');
    const long = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'circuit-long-folder-name-'));
    try {
      fs.mkdirSync(path.join(long, 'app'));
      fs.writeFileSync(path.join(long, 'app', 'index.html'), '<title>SlotForge Circuit</title>');
      const short = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:CIRCUIT_LONG).ShortPath',
        ],
        { encoding: 'utf8', env: { ...process.env, CIRCUIT_LONG: long } }
      ).trim();
      if (!short || short.toLowerCase() === long.toLowerCase())
        return t.skip('8.3 short names are not available on this drive.');
      const shortHandler = require('./serve.cjs').createHandler(short),
        result = {};
      await shortHandler(
        { url: '/app/', method: 'GET', headers: { host: '127.0.0.1:8173' } },
        {
          writeHead(status) {
            result.status = status;
            return this;
          },
          end(data) {
            result.data = data;
            return this;
          },
        }
      );
      assert.equal(result.status, 200);
      assert.match(String(result.data), /SlotForge Circuit/);
    } finally {
      fs.rmSync(long, { recursive: true, force: true });
    }
  }
);
