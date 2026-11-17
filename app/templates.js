// Starting layouts for plastic track packs. Each template is built from the
// pack's own standard straight and curves, so it closes exactly in that system.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrackTemplates = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SPECIAL = /grid|pit|adapter|single|start|personal|counter|chicane|cross|lap|sensor|bridge|banked|jump/i;
  const divides = (whole, part) => part > 0 && Math.abs(whole / part - Math.round(whole / part)) < 1e-6;

  // The pack's everyday pieces: its standard straight and curve families by radius.
  function standardPieces(pack, defs) {
    const usable = pack.pieces
      .map(d => defs[d.id])
      .filter(
        d =>
          d?.geometry?.lanePaths?.length &&
          d.parameters &&
          !d.parameters.planning &&
          !d.parameters.laneChange &&
          !d.parameters.routed &&
          !SPECIAL.test(d.name)
      );
    const straights = usable.filter(d => d.parameters.type === 'straight');
    const laneCounts = straights.map(d => d.parameters.laneCount);
    const lanes = laneCounts.includes(2) ? 2 : laneCounts.sort((a, b) => b - a)[0];
    const sameLanes = d => d.parameters.laneCount === lanes;
    const straight =
      straights.filter(sameLanes).find(d => /standard/i.test(d.name)) ||
      straights.filter(sameLanes).sort((a, b) => b.parameters.lengthMm - a.parameters.lengthMm)[0];
    const curves = usable.filter(
      d => d.parameters.type === 'curve' && sameLanes(d) && divides(90, d.parameters.angleDeg)
    );
    const radii = [...new Set(curves.map(d => d.parameters.innerRadiusMm))].sort((a, b) => a - b);
    // Largest angle per radius means fewest pieces per corner.
    const family = radius =>
      curves
        .filter(d => d.parameters.innerRadiusMm === radius)
        .sort((a, b) => b.parameters.angleDeg - a.parameters.angleDeg)[0] || null;
    const named = n => curves.find(d => new RegExp(`\\bR${n}\\b`).test(d.name))?.parameters.innerRadiusMm;
    const r2 = named(2) ?? radii[1] ?? radii[0],
      r3 = named(3) ?? radii[radii.indexOf(r2) + 1];
    return { straight, curve: r2 !== undefined ? family(r2) : null, wideCurve: r3 !== undefined ? family(r3) : null };
  }

  const repeat = (d, n) => Array(Math.max(0, Math.round(n))).fill(d);
  const turn = (curve, degrees) => repeat(curve, degrees / curve.parameters.angleDeg);

  const KINDS = [
    {
      id: 'compact-oval',
      name: 'Compact oval',
      text: 'Two straights on each side. Fits a small table.',
      sequence: ({ straight: s, curve: c }) => [...repeat(s, 2), ...turn(c, 180), ...repeat(s, 2), ...turn(c, 180)],
    },
    {
      id: 'long-oval',
      name: 'Long oval',
      text: 'Five straights per side for top speed and braking.',
      sequence: ({ straight: s, curve: c }) => [...repeat(s, 5), ...turn(c, 180), ...repeat(s, 5), ...turn(c, 180)],
    },
    {
      id: 'club-rectangle',
      name: 'Club rectangle',
      text: 'Four corners and two short straights, like a club circuit.',
      sequence: ({ straight: s, curve: c }) => [
        ...repeat(s, 4),
        ...turn(c, 90),
        ...repeat(s, 2),
        ...turn(c, 90),
        ...repeat(s, 4),
        ...turn(c, 90),
        ...repeat(s, 2),
        ...turn(c, 90),
      ],
    },
    {
      id: 'wide-oval',
      name: 'Wide oval',
      text: 'Wider curves for faster cornering.',
      needsWide: true,
      sequence: ({ straight: s, wideCurve: c }) => [...repeat(s, 3), ...turn(c, 180), ...repeat(s, 3), ...turn(c, 180)],
    },
  ];

  // Templates available for a pack: [{ id, name, text, definitionIds }].
  function forPack(pack, defs) {
    const parts = standardPieces(pack, defs);
    if (!parts.straight || !parts.curve) return [];
    return KINDS.filter(k => !k.needsWide || parts.wideCurve).map(k => ({
      id: k.id,
      name: k.name,
      text: k.text,
      definitionIds: k.sequence(parts).map(d => d.id),
    }));
  }

  // Places the pieces end to end, each joined to the previous piece's far end.
  function place(definitionIds, defs, F) {
    const items = [];
    let last = null;
    for (const id of definitionIds) {
      const d = defs[id];
      let p = F.pose(d, 0, 0);
      if (last) p = F.join(p, d, 0, F.ports(last, defs)[1]);
      items.push(p);
      last = p;
    }
    return items;
  }

  return { forPack, place, standardPieces, KINDS };
});
