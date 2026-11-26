const test = require('node:test'),
  assert = require('node:assert/strict'),
  F = require('./core.js'),
  P = require('./power.js');
const def = (id, parameters) => F.validateDefinition({ id, name: id, family: 'test', parameters });
const straight = def('test:straight', {
    type: 'straight',
    lengthMm: 345,
    widthMm: 200,
    laneCount: 2,
    laneSpacingMm: 100,
  }),
  curve = def('test:curve', {
    type: 'curve',
    innerRadiusMm: 400,
    widthMm: 200,
    laneCount: 2,
    laneSpacingMm: 100,
    angleDeg: 30,
  });
const defs = { [straight.id]: straight, [curve.id]: curve };
// 3 straights, 6 curves, 3 straights, 6 curves: 18 joints, lanes about 4.9 m and 5.5 m.
function oval(repeat = 1) {
  const items = [],
    seq = [];
  for (let r = 0; r < repeat; r++) seq.push(...Array(3).fill(straight));
  seq.push(...Array(6).fill(curve));
  for (let r = 0; r < repeat; r++) seq.push(...Array(3).fill(straight));
  seq.push(...Array(6).fill(curve));
  for (const d of seq) {
    let p = F.pose(d);
    if (items.length) p = F.join(p, d, 0, F.ports(items.at(-1), defs)[1]);
    items.push(p);
  }
  return items;
}

test('plastic track: a single feed on an 18-joint oval is past the 15-joint rule, and one tap halfway fixes it', () => {
  const items = oval(),
    net = F.routes(items, defs),
    power = P.mark(undefined, items[1].id, 'base');
  const a = P.analyse(net, items, defs, power);
  assert.equal(a.kind, 'plastic');
  assert.deepEqual(a.rules, { maxMetres: 10, maxJoints: 15 });
  assert.equal(a.state, 'problems');
  assert.equal(a.stretches.length, 1);
  assert.equal(a.stretches[0].joints, 18);
  assert.deepEqual(a.stretches[0].reasons, ['joints'], 'about 5.5 m is within 10 m; the joints are not');
  assert.ok(
    Math.abs(a.stretches[0].worst.mm - Math.max(...net.routes.map(r => r.lengthMm))) < 1e-6,
    'the outer lane counts'
  );
  assert.equal(a.suggestions.length, 1);
  const at = items.findIndex(p => p.id === a.suggestions[0]);
  assert.ok(at >= 9 && at <= 11, 'the suggested tap is on the far straight, half way round');
  assert.equal(defs[items[at].definitionId].parameters.type, 'straight');
  // Following the suggestion clears it, and the test points sit half way between the feeds.
  const fixed = P.analyse(net, items, defs, P.mark(power, a.suggestions[0], 'tap'));
  assert.equal(fixed.state, 'ok');
  assert.deepEqual(
    fixed.feeds.map(f => f.label),
    ['B', 'T1']
  );
  assert.equal(fixed.stretches.length, 2);
  assert.ok(fixed.stretches.every(x => x.joints <= 15 && !x.tooLong));
  assert.equal(
    fixed.stretches.map(x => x.joints).reduce((s, v) => s + v),
    18,
    'the stretches cover the lap once'
  );
  assert.deepEqual(
    fixed.stretches.map(x => x.test.label),
    ['P1', 'P2']
  );
});

test('the metre rule, routed conductors and custom limits', () => {
  const items = oval(10), // long straights: about 25 m per lap, 58 joints
    net = F.routes(items, defs),
    power = P.mark(undefined, items[0].id, 'base');
  const a = P.analyse(net, items, defs, power);
  assert.deepEqual(a.stretches[0].reasons, ['metres', 'joints']);
  assert.ok(a.suggestions.length >= 3, 'enough taps for both rules: ' + a.suggestions.length);
  const after = P.analyse(
    net,
    items,
    defs,
    a.suggestions.reduce((s, id) => P.mark(s, id, 'tap'), power)
  );
  assert.equal(after.state, 'ok', 'adding every suggestion clears every stretch');
  // A custom limit replaces the usual one; joints can be switched off.
  const custom = P.analyse(net, items, defs, { ...power, rules: { maxMetres: 30, maxJoints: null } });
  assert.equal(custom.state, 'ok');
  // Routed Wood: no joint rule; braid about 30 m, copper tape much less.
  const routed = q => ({ ...q, parameters: { ...q.parameters, routed: { conductor: 'tape' } } });
  const tapeDefs = { [straight.id]: routed(straight), [curve.id]: routed(curve) };
  assert.equal(P.kind(items, tapeDefs), 'tape');
  assert.deepEqual(P.analyse(net, items, tapeDefs, power).rules, { maxMetres: 6, maxJoints: null });
});

test('open tracks, no feeds and removed pieces', () => {
  const items = oval(),
    open = items.slice(0, -1);
  assert.equal(P.analyse(F.routes(open, defs), open, defs, undefined).state, 'open');
  const none = P.analyse(F.routes(items, defs), items, defs, undefined);
  assert.equal(none.state, 'none');
  assert.match(none.message, /Power base here/);
  // Only taps: checked, but asks which one is the power base.
  const taps = P.analyse(
    F.routes(items, defs),
    items,
    defs,
    P.mark(P.mark(undefined, items[0].id, 'tap'), items[9].id, 'tap')
  );
  assert.equal(taps.state, 'nobase');
  // A deleted piece's tap and readings are dropped when saving.
  let s = P.mark(P.mark(undefined, items[0].id, 'base'), items[9].id, 'tap');
  s = P.reading(s, 'lane-1', items[4].id, 11.2);
  const kept = P.prune(
    s,
    items.filter((_, i) => i !== 9 && i !== 4).map(p => p.id)
  );
  assert.deepEqual(kept.taps, []);
  assert.equal(kept.base, items[0].id);
  assert.deepEqual(kept.readings, { 'lane-1': {} });
});

test('marking: one power base; a new base turns the old one into a tap; unmarking removes it', () => {
  let s = P.mark(undefined, 'a', 'base');
  s = P.mark(s, 'b', 'tap');
  s = P.mark(s, 'c', 'base');
  assert.equal(s.base, 'c');
  assert.deepEqual(s.taps.sort(), ['a', 'b']);
  assert.equal(P.role(s, 'a'), 'tap');
  s = P.mark(s, 'c', null);
  assert.equal(s.base, null);
  assert.equal(P.role(s, 'c'), null);
  s = P.mark(s, 'a', 'base');
  assert.deepEqual(s.taps, ['b'], 'a tap made the base is no longer a tap');
});

test('test sheet: a reading more than 1 V below the power base is flagged', () => {
  const items = oval(),
    net = F.routes(items, defs);
  let s = P.mark(P.mark(undefined, items[1].id, 'base'), items[10].id, 'tap');
  const a = P.analyse(net, items, defs, s),
    [p1, p2] = a.stretches.map(x => x.test.pieceId);
  s = P.reading(s, 'lane-1', 'base', 12);
  s = P.reading(s, 'lane-1', p1, 11.4);
  s = P.reading(s, 'lane-1', p2, 10.8);
  const [lane1, lane2] = P.results(a, s);
  assert.equal(lane1.base, 12);
  assert.deepEqual(
    lane1.rows.map(r => r.ok),
    [true, false]
  );
  assert.ok(Math.abs(lane1.rows[1].drop - 1.2) < 1e-9);
  assert.deepEqual(
    lane2.rows.map(r => r.ok),
    [null, null],
    'no readings yet'
  );
  // Clearing a reading removes it again.
  s = P.reading(s, 'lane-1', p2, null);
  assert.equal(P.results(a, s)[0].rows[1].volts, null);
});

test('saved power data is checked like the rest of the workspace', () => {
  assert.deepEqual(P.settings(undefined), { version: 1, base: null, taps: [] });
  for (const bad of [
    { version: 2 },
    { version: 1, extra: true },
    { version: 1, taps: ['bad id!'] },
    { version: 1, rules: { maxMetres: 0, maxJoints: null } },
    { version: 1, rules: { maxMetres: 10, maxJoints: 2.5 } },
    { version: 1, readings: { 'lane-1': { base: 99 } } },
    { version: 1, readings: { 'lane-1': { points: { a: -1 } } } },
  ])
    assert.throws(() => P.settings(bad), undefined, JSON.stringify(bad));
  // Duplicate taps, and a tap that is also the base, are cleaned up.
  assert.deepEqual(P.settings({ version: 1, base: 'a', taps: ['a', 'b', 'b'] }).taps, ['b']);
  // validateLayout keeps it in the workspace.
  const items = oval(),
    raw = {
      format: 'slotforge.layout',
      version: 1,
      title: 't',
      pieces: items,
      definitions: Object.values(defs),
      workspace: { power: { version: 1, base: items[0].id, taps: [items[9].id] } },
    };
  assert.deepEqual(F.validateLayout(raw).workspace.power, { version: 1, base: items[0].id, taps: [items[9].id] });
  assert.throws(() => F.validateLayout({ ...raw, workspace: { power: { version: 1, base: 'x y' } } }));
});

test('marks for the track picture: feeds, test points and the too-long stretch on every lane', () => {
  const items = oval(),
    net = F.routes(items, defs),
    power = P.mark(undefined, items[1].id, 'base'),
    a = P.analyse(net, items, defs, power),
    m = P.marks(a, net, F.at);
  assert.deepEqual(
    m.feeds.map(f => f.label),
    ['B']
  );
  assert.deepEqual(
    m.points.map(p => p.label),
    ['P1']
  );
  assert.equal(m.weak.length, 1, 'one band down the middle of the track');
  assert.ok(m.weak[0].width > 100 && m.weak[0].width < 200, 'as wide as the lanes: ' + m.weak[0].width);
  // B sits on its piece, between the lanes.
  const piece = items[1],
    b = m.feeds[0];
  assert.ok(
    Math.hypot(
      b.x - (piece.x + 172.5 * Math.cos((piece.angle * Math.PI) / 180)),
      b.y - (piece.y + 172.5 * Math.sin((piece.angle * Math.PI) / 180))
    ) < 120
  );
  const svg = P.svg(m);
  assert.match(svg, />B<\/text>/);
  assert.match(svg, />P1<\/text>/);
  assert.equal(
    P.svg(
      P.marks(
        P.analyse(F.routes(items.slice(1), defs), items.slice(1), defs, power),
        F.routes(items.slice(1), defs),
        F.at
      )
    ),
    '',
    'nothing on an open track'
  );
});
