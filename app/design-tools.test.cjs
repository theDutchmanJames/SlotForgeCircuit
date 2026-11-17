const test = require('node:test'),
  assert = require('node:assert/strict'),
  F = require('./core.js'),
  T = require('./design-tools.js'),
  I = require('./integration.js'),
  D = require('./track-drawing.js');
const fixture = () =>
  structuredClone(require('../integration/slotforge-timing/fixtures/01-closed-oval.slotforge.json'));
test('planning measurements, groups, locks and inventory survive layout round trips', () => {
  const raw = fixture();
  raw.pieces[0].locked = true;
  raw.pieces[0].groupId = raw.pieces[1].groupId = 'group-1';
  raw.workspace = {
    planning: {
      version: 1,
      measurements: [{ id: 'measure-1', a: [0, 0], b: [300, 400], label: 'Door clearance', print: true }],
      owned: { part: 12 },
    },
  };
  const out = I.prepare(raw),
    back = I.prepare(out, I.importLayout(out).state);
  assert.deepEqual(out, back);
  assert.equal(back.pieces[0].locked, true);
  assert.equal(F.Planning.measurement(raw.workspace.planning.measurements[0]).lengthMm, 500);
  assert.match(D.pdfDiagram(out).svg, /Door clearance/);
  assert.deepEqual(
    T.expanded(back.pieces, [back.pieces[0].id]),
    back.pieces.slice(0, 2).map(p => p.id)
  );
  assert.throws(() => T.group(back.pieces, [back.pieces[0].id, back.pieces[1].id]), /Unlock/);
});
test('planning validation rejects malformed metadata and unsafe reference URLs', () => {
  const base = F.Planning.validate();
  for (const value of [
    false,
    [],
    { ...base, version: 99 },
    { ...base, owned: { x: -1 } },
    { ...base, measurements: [{ id: 'x', a: [NaN, 0], b: [0, 0], label: '', print: true }] },
    { ...base, reference: { image: 'javascript:alert(1)' } },
  ])
    assert.throws(() => F.Planning.validate(value));
  const raw = fixture();
  raw.pieces[0].locked = 'yes';
  assert.throws(() => I.prepare(raw), /lock/);
});
test('inventory counts manufacturer SKU variants and produces missing-only CSV', () => {
  const raw = fixture(),
    model = F.validateLayout(raw),
    rows = T.inventory(model.pieces, model.definitions),
    first = rows[0],
    withOwned = T.inventory(model.pieces, model.definitions, { [first.key]: first.used + 2 });
  assert.equal(withOwned[0].missing, 0);
  assert.equal(
    rows.reduce((n, r) => n + r.used, 0),
    raw.pieces.length
  );
  assert.ok(!T.shoppingCSV(withOwned).includes('"' + first.sku + '"'));
  assert.match(T.shoppingCSV([{ name: '=BAD', pack: 'Pack', sku: 'X', used: 2, owned: 0, missing: 2 }]), /'=BAD/);
});
test('replacement preserves the chosen endpoint, reports other-end movement and retains the source', () => {
  const m = F.validateLayout(fixture()),
    p = m.pieces.find(p => m.definitions[p.definitionId].parameters.type === 'straight'),
    d = m.definitions[p.definitionId],
    short = F.validateDefinition({
      ...d,
      id: 'custom:short',
      parameters: { ...d.parameters, lengthMm: d.parameters.lengthMm / 2 },
    }),
    before = structuredClone(m);
  for (const end of [0, 1]) {
    const out = T.replace(m.pieces, m.definitions, p.id, short, end),
      q = out.items.find(q => q.id === p.id);
    assert.ok(F.dist(F.ports(q, out.definitions)[end].position, F.ports(p, m.definitions)[end].position) < 1e-6);
    assert.ok(Math.abs(out.gapMm - d.parameters.lengthMm / 2) < 1e-6);
  }
  assert.equal(JSON.stringify(m), JSON.stringify(before));
});
test('gap assistant finds a fixed catalogue piece without stretching it', () => {
  const m = F.validateLayout(fixture()),
    p = m.pieces.find(p => m.definitions[p.definitionId].parameters.type === 'straight'),
    items = m.pieces.filter(q => q.id !== p.id),
    ports = F.connections(items, m.definitions).open,
    out = T.gapSuggestions(items, m.definitions, ports[0], ports[1], Object.values(m.definitions), {
      depth: 2,
      budget: 500,
    });
  assert.ok(out.found.length);
  const fit = out.found[0];
  assert.equal(F.routes([...items, ...fit.items], fit.definitions).closed, true);
  assert.equal(fit.items.length, 1);
});
test('piece ramps match adjoining heights and leave horizontal placements unchanged', () => {
  const m = F.validateLayout(fixture()),
    ids = m.pieces.slice(0, 3).map(p => p.id),
    out = T.ramp(m.pieces, m.definitions, ids, 0, 120),
    ramped = out.items.filter(p => ids.includes(p.id));
  assert.ok(out.maxGradientPct > 0);
  for (const p of ramped) {
    const old = m.pieces.find(q => q.id === p.id);
    for (const key of ['x', 'y', 'angle', 'flip']) assert.equal(p[key], old[key]);
  }
  const ports = ramped.flatMap(p => F.ports(p, m.definitions));
  for (let i = 0; i < ports.length; i++)
    for (let j = 0; j < i; j++)
      if (F.dist(ports[i].position, ports[j].position) < 0.1)
        assert.ok(Math.abs(ports[i].heightMm - ports[j].heightMm) < 0.1);
  assert.throws(
    () =>
      T.ramp(
        m.pieces,
        m.definitions,
        m.pieces.map(p => p.id),
        0,
        100
      ),
    /open stretch/
  );
});
test('curvature and car envelopes are view geometry without mutations', () => {
  const m = F.validateLayout(fixture()),
    before = structuredClone(m);
  assert.match(T.overlay(m.pieces, m.definitions, { curvature: true }), /stroke=/);
  assert.match(T.overlay(m.pieces, m.definitions, { envelope: true }), /<rect/);
  assert.equal(JSON.stringify(m), JSON.stringify(before));
  const issues = T.issues(m.pieces.slice(1), m.definitions, null);
  assert.ok(issues.some(i => i.code === 'open-end' && i.point && i.pieceIds.length));
});
test('replacement and gap search isolate conflicting catalogue definition IDs', () => {
  const m = F.validateLayout(fixture()),
    p = m.pieces.find(p => m.definitions[p.definitionId].parameters.type === 'straight'),
    original = m.definitions[p.definitionId],
    different = F.validateDefinition({
      ...original,
      parameters: { ...original.parameters, lengthMm: original.parameters.lengthMm / 2 },
    }),
    out = T.replace(m.pieces, m.definitions, p.id, different);
  assert.notEqual(out.items.find(q => q.id === p.id).definitionId, p.definitionId);
  assert.deepEqual(out.definitions[p.definitionId].parameters, original.parameters);
});
test('gap search filters incompatible packs before its catalogue limit and preserves raised endpoints', () => {
  const m = F.validateLayout(fixture()),
    p = m.pieces.find(p => m.definitions[p.definitionId].parameters.type === 'straight'),
    d = m.definitions[p.definitionId],
    items = m.pieces
      .filter(q => q.id !== p.id)
      .map(q => ({ ...q, elevation: { ...F.Elevation.settings(), startMm: 100, endMm: 100 } })),
    ports = F.connections(items, m.definitions).open,
    candidates = [...Array.from({ length: 130 }, (_, i) => ({ ...d, id: 'other:' + i, family: 'other' })), d],
    out = T.gapSuggestions(items, m.definitions, ...ports, candidates, { depth: 1, budget: 500 });
  assert.ok(out.found.length);
  assert.equal(out.found[0].items[0].elevation.startMm, 100);
  assert.throws(
    () => T.gapSuggestions(items, m.definitions, ports[0], { ...ports[1], heightMm: 0 }, candidates),
    /heights/
  );
});
test('car clearance finds neighbouring conflicts but allows sufficient bridge separation', () => {
  const d = F.validateDefinition({
      id: 'custom:road',
      name: 'Road',
      pack: 'Test',
      family: 'custom',
      parameters: { type: 'straight', lengthMm: 400, widthMm: 200, laneCount: 2, laneSpacingMm: 90 },
    }),
    p = F.pose(d),
    defs = { [d.id]: d };
  assert.ok(T.clearance([p], defs, null, { widthMm: 100, lengthMm: 140 }).some(i => i.code === 'car-lanes'));
  assert.ok(!T.clearance([p], defs, null, { widthMm: 50, lengthMm: 140 }).length);
  assert.throws(() => T.clearance([p], defs, null, { widthMm: 50, lengthMm: 140 }, -1), /drift/);
  const upper = { ...p, id: F.uid(), angle: 90, elevation: { ...F.Elevation.settings(), startMm: 150, endMm: 150 } };
  assert.ok(!T.clearance([p, upper], defs, null, { widthMm: 50, lengthMm: 140 }).length);
});
test('PDF bounds include dimensions away from the road', () => {
  const raw = fixture();
  raw.workspace = {
    planning: {
      version: 1,
      owned: {},
      measurements: [{ id: 'outside', a: [-5000, -4000], b: [-4000, -4000], label: 'Room', print: true }],
    },
  };
  const svg = D.pdfDiagram(raw).svg,
    view = svg
      .match(/viewBox="([^"]+)"/)[1]
      .split(' ')
      .map(Number);
  assert.ok(view[0] < -5000 && view[1] < -4000);
});
