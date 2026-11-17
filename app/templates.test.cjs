const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  F = require('./core.js'),
  G = require('../track-packs/tools/geometry.cjs'),
  T = require('./templates.js');

// Load the built-in catalogue the way the app does.
const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'catalogue.js'), 'utf8'), context);
const packs = context.window.TRACK_PACKS,
  defs = {};
for (const pack of packs)
  for (const d of pack.pieces) if (d.parameters) defs[d.id] = { ...d, geometry: G.derive(d.parameters) };

test('Every pack with standard straights and curves gets templates that close exactly', () => {
  let checked = 0;
  for (const pack of packs) {
    for (const template of T.forPack(pack, defs)) {
      const items = T.place(template.definitionIds, defs, F);
      const joins = F.connections(items, defs);
      assert.equal(joins.open.length, 0, `${pack.name} · ${template.name} has open ends`);
      const network = require('./integration.js').network(items, defs);
      assert.ok(network.closed, `${pack.name} · ${template.name} is not a closed circuit: ${network.reason}`);
      checked++;
    }
  }
  assert.ok(checked >= 25, `only ${checked} templates were checked`);
});

test('Templates use the pack’s standard straight and its R2 curve', () => {
  const carrera = packs.find(p => /Carrera Evolution/.test(p.name)),
    parts = T.standardPieces(carrera, defs);
  assert.match(parts.straight.name, /Standard straight/);
  assert.match(parts.curve.name, /R2/);
  assert.match(parts.wideCurve.name, /R3/);
});

test('Packs without placeable pieces offer no templates instead of broken ones', () => {
  for (const pack of packs.filter(p => !p.pieces.some(d => d.parameters && !d.parameters.planning)))
    assert.deepEqual(T.forPack(pack, defs), []);
});
