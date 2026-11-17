const test = require('node:test'),
  assert = require('node:assert/strict'),
  F = require('./core.js'),
  I = require('./integration.js'),
  CP = require('./custom-packs.js'),
  PL = F.PlasticLanes;
const straight = { type: 'straight', lengthMm: 600, widthMm: 400, laneCount: 4, laneSpacingMm: 90 },
  curve = { type: 'curve', innerRadiusMm: 400, angleDeg: 180, widthMm: 400, laneCount: 4, laneSpacingMm: 90 };
const def = p =>
  F.validateDefinition({
    id: 'custom:lane-test',
    name: 'Lane test',
    pack: 'My plastic pack',
    family: 'custom',
    parameters: p,
  });
const adjust = (p, mode = 'squeeze', spacingMm = 70, anchor = p.type === 'curve' ? 'inner' : 'centre') =>
  def({ ...p, laneAdjustment: { version: 1, mode, spacingMm, anchor } });
for (const p of [straight, curve])
  for (const mode of ['squeeze', 'spread'])
    test(`${p.type} ${mode}: only slot geometry changes, with tangent joins and midpoint peak`, () => {
      const old = def(p),
        input = structuredClone(p),
        d = adjust(p, mode, mode === 'spread' ? 105 : 70),
        g = d.geometry;
      assert.deepEqual(p, input);
      for (const field of ['outlineSvgPath', 'boundsMm', 'connectors', 'centrelineLengthMm'])
        assert.deepEqual(g[field], old.geometry[field]);
      const middle = [];
      for (const [i, l] of g.lanePaths.entries()) {
        assert.deepEqual(l.start, old.geometry.lanePaths[i].start);
        assert.deepEqual(l.end, old.geometry.lanePaths[i].end);
        const s = l.segments[0],
          m = s.referenceFractions.indexOf(0.5);
        assert.ok(m > 0);
        assert.ok(Math.abs(s.headingsDeg[0]) < 1e-8);
        assert.ok(Math.abs(s.headingsDeg.at(-1) - (p.angleDeg || 0)) < 1e-8);
        assert.equal(s.distancesMm.at(-1), l.lengthMm);
        assert.ok(s.points.length > 32);
        middle.push(p.type === 'straight' ? s.points[m][1] : Math.hypot(...s.points[m]) - p.innerRadiusMm);
        assert.ok(
          Math.abs(s.curvaturesPerMm[0] - (p.type === 'straight' ? 0 : 1 / (p.innerRadiusMm + PL.info(p).offsets[i]))) <
            1e-12
        );
      }
      for (let i = 1; i < middle.length; i++)
        assert.ok(Math.abs(middle[i] - middle[i - 1] - (mode === 'spread' ? 105 : 70)) < 1e-7);
      if (p.type === 'curve') assert.ok(Math.abs(middle[0] - PL.info(p).offsets[0]) < 1e-7);
      else assert.ok(Math.abs((middle[0] + middle.at(-1)) / 2 - p.widthMm / 2) < 1e-7);
    });
test('uneven slots remain proportional and adjusted definitions are idempotent', () => {
  const p = { type: 'straight', lengthMm: 700, widthMm: 300, laneOffsetsMm: [40, 100, 250] },
    d = adjust(p, 'squeeze', 70);
  assert.deepEqual(def(d.parameters), d);
  const v = d.geometry.lanePaths.map(l => {
    const s = l.segments[0];
    return s.points[s.referenceFractions.indexOf(0.5)][1];
  });
  assert.ok(Math.abs((v[1] - v[0]) / (v[2] - v[1]) - 60 / 150) < 1e-9);
});
test('invalid, unsupported, outside-road and overlapping lane changes fail clearly', () => {
  const good = { version: 1, mode: 'spread', spacingMm: 110, anchor: 'centre' };
  for (const bad of [
    null,
    [],
    { ...good, version: 99 },
    { ...good, spacingMm: NaN },
    { ...good, spacingMm: '110' },
    { ...good, unexpected: true },
    { ...good, anchor: 'wrong' },
    { ...good, mode: 'squeeze' },
  ])
    assert.throws(() => def({ ...straight, laneAdjustment: bad }));
  assert.throws(() => adjust(straight, 'spread', 200), /leave the road/);
  assert.throws(() => adjust(straight, 'squeeze', 7), /room between/);
  assert.throws(() => adjust({ ...straight, lengthMm: 10 }, 'squeeze', 40), /fold|too close/);
  for (const p of [
    { ...straight, laneCount: 1 },
    { type: 'straight-border', widthMm: 80, lengthMm: 100, side: 'outer' },
    { ...straight, laneCount: 2, laneChange: 'both', switchStartMm: 50, switchEndMm: 500 },
  ])
    assert.throws(() => def({ ...p, laneAdjustment: good }));
  assert.throws(() => adjust(straight, 'squeeze', 80, 'inner'), /centre/);
});
test('corner spread keeps the inner lane round, mirrored world routes retain the same length', () => {
  const d = adjust(curve, 'spread', 105),
    r = d.geometry.lanePaths[0].segments[0],
    radius = curve.innerRadiusMm + PL.info(curve).offsets[0];
  for (const p of r.points) assert.ok(Math.abs(Math.hypot(...p) - radius) < 1e-5);
  const p = { ...F.pose(d), x: 150, angle: 32, flip: true },
    net = F.worldSegments({ sections: [{ pieceId: p.id, laneIndex: 0, reverse: true }] }, [p], { [d.id]: d });
  assert.equal(net[0].lengthMm, r.lengthMm);
  assert.deepEqual(net[0].points[0], F.point(d.geometry.lanePaths[0].end, p));
  assert.ok(net[0].curvaturesPerMm.every(k => k > 0));
});
test('layout round trip, route identity, timing offset and reverse animation use adjusted slots', () => {
  const raw = structuredClone(require('../integration/slotforge-timing/fixtures/01-closed-oval.slotforge.json')),
    before = I.prepare(raw),
    old = raw.definitions.find(d => d.parameters.type === 'straight'),
    piece = raw.pieces.find(p => p.definitionId === old.id),
    variant = { ...adjust(old.parameters, 'squeeze', 80), family: old.family };
  raw.definitions.push(variant);
  piece.definitionId = variant.id;
  const state = I.importLayout(raw).state;
  state.startFinish = { pieceId: piece.id, fraction: 0.37 };
  const out = I.prepare(raw, state);
  assert.equal(out.integration.contractVersion, I.PLASTIC_CONTRACT);
  assert.equal(out.version, 1);
  assert.deepEqual(
    out.track.lanes.map(r => r.id),
    before.track.lanes.map(r => r.id)
  );
  assert.ok(out.track.lanes.every((r, i) => r.lengthMm > before.track.lanes[i].lengthMm));
  assert.notEqual(out.design.revision, before.design.revision);
  const imported = I.importLayout(out),
    again = I.prepare(out, imported.state);
  assert.deepEqual(again.preparedGeometry, out.preparedGeometry);
  assert.deepEqual(again.track, out.track);
  const model = F.validateLayout(out),
    net = I.network(model.pieces, model.definitions);
  for (const route of net.routes) {
    const offset = I.offsets(net, state.startFinish).find(o => o.routeId === route.id).offsetMm,
      q = I.atTravel(route, 0, offset),
      reverse = I.atTravel(route, 0, offset, -1);
    assert.ok(Number.isFinite(q.x) && Number.isFinite(reverse.curvature));
    assert.ok(Math.abs(q.x - reverse.x) < 1e-9);
    assert.ok(I.travelPlan(route, F.presets.Balanced, offset, -1));
  }
});
test('custom pack/library and old pack compatibility', () => {
  const d = adjust(straight),
    lib = CP.empty();
  lib.packs[0].pieces.push(d);
  const raw = CP.serialize(lib),
    pack = CP.exportPack(lib.packs[0]);
  assert.equal(raw.version, 4);
  assert.equal(pack.version, 3);
  assert.deepEqual(CP.read(raw).packs[0].pieces[0].parameters, d.parameters);
  assert.deepEqual(CP.importPack(pack, CP.empty()).pieces[0].geometry, d.geometry);
  lib.packs[0].pieces = [def(straight)];
  assert.equal(CP.serialize(lib).version, 2);
  assert.equal(CP.exportPack(lib.packs[0]).version, 1);
});
test('cached geometry never shares mutable paths with another definition', () => {
  const a = adjust(curve),
    expected = structuredClone(a.geometry);
  a.geometry.lanePaths[0].segments[0].points[0][0] = 999;
  a.geometry.connectors[0].position[0] = 999;
  assert.deepEqual(adjust(curve).geometry, expected);
});
