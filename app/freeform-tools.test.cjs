const test = require('node:test'),
  assert = require('node:assert/strict'),
  F = require('./core.js'),
  A = require('./freeform-tools.js'),
  I = require('./integration.js'),
  FF = F.FreeForm;
const setup = () => {
  const profile = F.Routed.settings({ laneCount: 3, laneSpacingMm: 90, constructionMode: 'table' });
  return { profile, model: FF.oval(profile) };
};
test('one spacing envelope crosses multiple spans without resetting at each join', () => {
  const { profile, model } = setup(),
    out = A.spacing(model, profile, model.nodes[0].id, model.nodes[2].id, { mode: 'squeeze', spacingMm: 70 }),
    d = FF.definition(out.model, profile);
  assert.ok(d.geometry.valid);
  assert.deepEqual(out.model.nodes[0].squeeze.domain, [0, 0.5]);
  assert.deepEqual(out.model.nodes[1].squeeze.domain, [0.5, 1]);
  assert.equal(model.nodes[0].squeeze, undefined);
  const raw = I.prepare({
    format: 'slotforge.layout',
    version: 1,
    title: 'Stretch',
    definitions: [d],
    pieces: [F.pose(d)],
  });
  assert.equal(raw.integration.contractVersion, I.STRETCH_CONTRACT);
  assert.deepEqual(I.prepare(raw).preparedGeometry, raw.preparedGeometry);
});
test('asymmetric peak and finite transition are continuous across the closing seam', () => {
  const { profile, model } = setup(),
    out = A.spacing(model, profile, model.nodes[3].id, model.nodes[1].id, {
      mode: 'spread',
      spacingMm: 105,
      peak: 0.4,
      transition: 0.3,
    }),
    d = FF.definition(out.model, profile);
  assert.ok(d.geometry.valid);
  assert.equal(out.model.nodes[3].squeeze.domain[0], 0);
  assert.equal(out.model.nodes[0].squeeze.domain[1], 1);
  assert.equal(out.model.nodes[1].squeeze, undefined);
  assert.throws(
    () =>
      A.spacing(model, profile, model.nodes[0].id, model.nodes[1].id, {
        mode: 'squeeze',
        spacingMm: 70,
        peak: 0.1,
        transition: 0.2,
      }),
    /Transition/
  );
});
test('stretch operations respect anchor locks and reject empty/reversed open ranges', () => {
  const { profile, model } = setup();
  model.nodes[1].locked = true;
  assert.throws(
    () => A.spacing(model, profile, model.nodes[0].id, model.nodes[2].id, { mode: 'squeeze', spacingMm: 70 }),
    /Unlock/
  );
  assert.throws(() => A.smooth(model, [model.nodes[1].id]), /Unlock/);
  model.closed = false;
  assert.throws(() => A.span(model, model.nodes[3].id, model.nodes[0].id), /Finish/);
  assert.throws(() => A.span(model, model.nodes[0].id, model.nodes[0].id), /distinct/);
});
test('smoothing selected joins retains anchor positions and untouched handles', () => {
  const { model } = setup();
  model.nodes[1].in = [-100, -50];
  const old = structuredClone(model),
    m = A.smooth(model, [model.nodes[1].id]);
  for (let i = 0; i < m.nodes.length; i++) {
    assert.deepEqual(m.nodes[i].p, old.nodes[i].p);
    if (i !== 1) assert.deepEqual(m.nodes[i], old.nodes[i]);
  }
  const n = m.nodes[1];
  assert.ok(Math.abs(n.in[0] * n.out[1] - n.in[1] * n.out[0]) < 1e-8);
});
test('FreeForm ramp adds shape-preserving subdivisions and exact terminal heights', () => {
  const { model, profile } = setup(),
    out = A.ramp(model, profile, model.nodes[0].id, model.nodes[2].id, 0, 120),
    before = FF.definition(model, profile),
    after = FF.definition(out.model, profile);
  assert.ok(out.model.nodes.length > model.nodes.length);
  assert.equal(out.model.nodes.find(n => n.id === model.nodes[2].id).heightMm, 120);
  assert.ok(out.maxGradientPct > 0);
  assert.ok(Math.abs(before.geometry.reference.lengthMm - after.geometry.reference.lengthMm) < 0.1);
});
test('routed oval converts to a closed editable circuit with explicit approximation', () => {
  const m = F.validateLayout(
      require('../integration/slotforge-timing/routed-examples/closed-routed-oval.slotforge.json')
    ),
    before = structuredClone(m),
    out = A.convert(m.pieces, m.definitions);
  assert.ok(out.definition.geometry.valid && out.model.closed);
  assert.equal(out.model.laneCount, 2);
  assert.ok(out.model.nodes.length <= 96);
  assert.ok(out.maxErrorMm < 0.1);
  assert.equal(JSON.stringify(m), JSON.stringify(before));
  const original = F.routes(m.pieces, m.definitions)
      .routes.map(r => r.lengthMm)
      .sort((a, b) => a - b),
    converted = out.definition.geometry.lanePaths.map(l => l.lengthMm).sort((a, b) => a - b);
  for (let i = 0; i < 2; i++) assert.ok(Math.abs(original[i] - converted[i]) < 0.3);
});
test('ramp remaps the timing mark through every exact split without moving it', () => {
  const { model, profile } = setup(),
    mark = { nodeId: model.nodes[0].id, t: 0.72 },
    point = F.Routed.Spline.evaluate(FF.controls(model, 0), mark.t).p,
    out = A.ramp(model, profile, model.nodes[0].id, model.nodes[2].id, 0, 80),
    mapped = A.remapMark(mark, out.splits),
    index = out.model.nodes.findIndex(n => n.id === mapped.nodeId),
    after = F.Routed.Spline.evaluate(FF.controls(out.model, index), mapped.t).p;
  assert.ok(F.dist(point, after) < 1e-6);
  assert.equal(mark.t, 0.72);
});
test('continuous spacing preserves slot tangents across converted straight-to-arc joins', () => {
  const raw = F.validateLayout(
      require('../integration/slotforge-timing/routed-examples/closed-routed-oval.slotforge.json')
    ),
    c = A.convert(raw.pieces, raw.definitions),
    out = A.spacing(c.model, c.profile, c.model.nodes[0].id, c.model.nodes[2].id, {
      mode: 'squeeze',
      spacingMm: 70,
      peak: 0.6,
      transition: 0.4,
    });
  assert.ok(FF.definition(out.model, c.profile).geometry.valid);
  assert.equal(out.model.nodes[0].squeeze.envelope.stops.length, 1);
});
test('conversion preserves deck/headroom settings and rejects inconsistent construction', () => {
  const m = F.validateLayout(
    require('../integration/slotforge-timing/routed-examples/closed-routed-oval.slotforge.json')
  );
  m.pieces.forEach(
    p => (p.elevation = { ...F.Elevation.settings(), startMm: 100, endMm: 100, thicknessMm: 18, clearanceMm: 70 })
  );
  const c = A.convert(m.pieces, m.definitions);
  assert.equal(c.model.elevation.thicknessMm, 18);
  assert.equal(c.model.elevation.clearanceMm, 70);
  assert.ok(c.model.nodes.every(n => n.heightMm === 100));
  m.pieces[0].elevation.thicknessMm = 20;
  assert.throws(() => A.convert(m.pieces, m.definitions), /deck thickness/);
});
test('continuous spacing rejects malformed envelope metadata instead of normalizing it away', () => {
  for (const envelope of [
    { peak: 0.5, transition: 0.5, stops: [0.7, 0.3] },
    { peak: 0.5, transition: 0.5, stops: [NaN] },
    { peak: 0.5, transition: 0.5, stops: [0] },
    { peak: 0.5, transition: 0.5, unknown: true },
  ])
    assert.throws(() => FF.squeeze({ version: 3, mode: 'squeeze', spacingMm: 70, domain: [0, 1], envelope }, 2));
  const { model, profile } = setup(),
    out = A.spacing(model, profile, model.nodes[0].id, model.nodes[2].id, { mode: 'spread', spacingMm: 100 }),
    d = FF.definition(out.model, profile),
    raw = I.prepare({ format: 'slotforge.layout', version: 1, definitions: [d], pieces: [F.pose(d)] });
  raw.integration.contractVersion = '1.0.0-draft.999';
  assert.throws(() => I.importLayout(raw), /contract/);
});
test('continuous envelopes export regenerated slot paths to SVG and DXF without tracing images', () => {
  const CAD = require('./cad-export.js'),
    { model, profile } = setup(),
    changed = A.spacing(model, profile, model.nodes[0].id, model.nodes[2].id, { mode: 'squeeze', spacingMm: 70 }),
    d = FF.definition(changed.model, profile),
    raw = {
      format: 'slotforge.layout',
      version: 1,
      title: 'CAD stretch',
      definitions: [d],
      pieces: [F.pose(d)],
      workspace: {
        planning: {
          version: 1,
          measurements: [],
          owned: {},
          reference: {
            image: 'data:image/png;base64,iVBORw0KGgo=',
            x: 0,
            y: 0,
            widthMm: 1000,
            heightMm: 1000,
            angle: 0,
            opacity: 0.5,
            visible: true,
          },
        },
      },
    },
    svg = CAD.svg(raw),
    dxf = CAD.dxf(raw);
  assert.match(svg, /SLOT_CENTRES/);
  assert.doesNotMatch(svg, /<image|NaN|Infinity/);
  assert.match(dxf, /LWPOLYLINE/);
  assert.doesNotMatch(dxf, /NaN|Infinity/);
  assert.deepEqual(CAD.build(raw).paths, CAD.build(I.prepare(raw)).paths);
});
