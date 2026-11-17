const test = require('node:test'),
  assert = require('node:assert/strict'),
  F = require('./core.js');

test('Lap time adds up distance over speed along the lane', () => {
  const steady = F.lapTime(() => 1000, 2000);
  assert.ok(Math.abs(steady.seconds - 2) < 1e-9);
  assert.equal(steady.topMmS, 1000);
  // First half at half speed (2 s), second half at full speed (1 s).
  const mixed = F.lapTime(d => (d < 1000 ? 500 : 1000), 2000);
  assert.ok(Math.abs(mixed.seconds - 3) < 1e-9);
  assert.ok(Math.abs(mixed.averageMmS - 2000 / 3) < 1e-6);
});

test('Lap time refuses impossible speed plans instead of returning a number', () => {
  assert.equal(
    F.lapTime(() => 0, 1000),
    null
  );
  assert.equal(
    F.lapTime(() => NaN, 1000),
    null
  );
  assert.equal(
    F.lapTime(() => 1000, 0),
    null
  );
  assert.equal(F.lapTime(null, 1000), null);
});

test('A faster Tune profile gives a shorter lap on the same speed plan model', () => {
  // 1 m of straight at top speed, then 1 m of bend at cornering speed.
  const plan = profile => d => (d < 1000 ? profile.speed : profile.speed * profile.corner);
  const slow = F.lapTime(plan(F.presets.Relaxed), 2000),
    fast = F.lapTime(plan(F.presets.Aggressive), 2000);
  assert.ok(fast.seconds < slow.seconds);
});
