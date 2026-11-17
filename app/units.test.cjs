const test = require('node:test'),
  assert = require('node:assert/strict'),
  U = require('./units.js');

test('Imperial readouts convert millimetres, metres, sizes, ranges and speeds', () => {
  const cases = {
    '300 mm piece width': '11.8 in piece width',
    'Slot 3.2 mm': 'Slot 0.126 in',
    'Track centreline 5.21 m': 'Track centreline 17 ft 1.1 in',
    'Footprint 2235 × 1200 mm': 'Footprint 7 ft 4 in × 3 ft 11.2 in',
    '4,500 × 1,800 mm car': '14 ft 9.2 in × 5 ft 10.9 in car',
    'Squeeze 100 → 80 → 100 mm': 'Squeeze 3.94 in → 3.15 in → 3.94 in',
    'Top speed 1.8 m/s': 'Top speed 5.9 ft/s',
    'Braking 2.5 m/s²': 'Braking 8.2 ft/s²',
    '-12 mm': '-0.472 in',
  };
  for (const [metric, imperial] of Object.entries(cases)) assert.equal(U.convertText(metric), imperial, metric);
});

test('Text without metric measurements is left exactly as it was', () => {
  for (const s of ['Ratio 1:32', 'R2 / 30° curve', '30 min', 'Physical sizes in mm', '18 pieces', 'Lane 2', ''])
    assert.equal(U.convertText(s), s);
  assert.equal(U.convertText(null), null);
});

test('Below a metre lengths stay in inches; from a metre they use feet and inches', () => {
  assert.equal(U.inches(304.8), '12.0 in');
  assert.equal(U.inches(1219.19), '4 ft'); // 3 ft 11.99 in rounds up to the next foot
  assert.equal(U.inches(1066.8), '3 ft 6 in');
  assert.equal(U.inches(1000), '3 ft 3.4 in');
  assert.equal(U.inches(25.4), '1.00 in');
});
