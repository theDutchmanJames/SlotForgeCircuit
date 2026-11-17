const test = require('node:test'),
  assert = require('node:assert/strict'),
  P = require('./elevation-profile.js');

const flat = { parameters: { type: 'straight' }, geometry: {} };
const defs = { s: flat };

test('Piece heights become a profile in driving order, including reversed pieces', () => {
  const items = [
    { id: 'a', definitionId: 's', elevation: { version: 1, startMm: 0, endMm: 50, thicknessMm: 10, clearanceMm: 50 } },
    { id: 'b', definitionId: 's', elevation: { version: 1, startMm: 0, endMm: 50, thicknessMm: 10, clearanceMm: 50 } },
    { id: 'c', definitionId: 's' },
  ];
  const route = {
    lengthMm: 3000,
    sections: [
      { pieceId: 'a', reverse: false, startMm: 0, lengthMm: 1000 },
      { pieceId: 'b', reverse: true, startMm: 1000, lengthMm: 1000 },
      { pieceId: 'c', reverse: false, startMm: 2000, lengthMm: 1000 },
    ],
  };
  const p = P.build(route, items, defs);
  assert.deepEqual(p.points, [
    [0, 0],
    [1000, 50],
    [1000, 50],
    [2000, 0],
    [2000, 0],
    [3000, 0],
  ]);
  assert.equal(p.maxMm, 50);
  assert.ok(Math.abs(p.steepestPct - 5) < 1e-9); // 50 mm over 1000 mm
  assert.equal(p.hasHeights, true);
});

test('A flat layout reports no heights', () => {
  const p = P.build(
    { lengthMm: 1000, sections: [{ pieceId: 'c', reverse: false, startMm: 0, lengthMm: 1000 }] },
    [{ id: 'c', definitionId: 's' }],
    defs
  );
  assert.equal(p.hasHeights, false);
  assert.equal(p.steepestPct, 0);
});

test('FreeForm heights are scaled from the drawn slot onto the lane', () => {
  const ff = {
    parameters: { type: 'freeform' },
    geometry: { reference: { lengthMm: 200, distancesMm: [0, 100, 200], heightsMm: [0, 120, 0] } },
  };
  const p = P.build(
    { lengthMm: 400, sections: [{ pieceId: 'f', reverse: false, startMm: 0, lengthMm: 400 }] },
    [{ id: 'f', definitionId: 'f' }],
    { f: ff }
  );
  assert.deepEqual(p.points, [
    [0, 0],
    [200, 120],
    [400, 0],
  ]);
  assert.match(P.svg(p), /<svg[\s\S]*120 mm[\s\S]*0\.40 m/);
});
