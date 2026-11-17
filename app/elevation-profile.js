// Side view of a lane: track height against distance along the lap.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./elevation.js'));
  else root.ElevationProfile = factory(root.TrackElevation);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (H) {
  'use strict';

  // route: { lengthMm, sections: [{ pieceId, reverse, startMm, lengthMm }] } from the track network.
  // Returns { points: [[distanceMm, heightMm]], lengthMm, minMm, maxMm, steepestPct, hasHeights }.
  function build(route, items, defs) {
    const byId = new Map(items.map(p => [p.id, p]));
    const points = [];
    for (const s of route.sections) {
      const piece = byId.get(s.pieceId),
        def = piece && defs[piece.definitionId];
      if (!def) continue;
      const ref = def.geometry?.reference;
      if (def.parameters.type === 'freeform' && ref?.heightsMm?.length) {
        // FreeForm: heights sampled along the drawn slot, scaled to this lane's length.
        const total = ref.lengthMm || ref.distancesMm.at(-1) || 1;
        const samples = ref.distancesMm.map((d, i) => [d / total, ref.heightsMm[i]]);
        if (s.reverse) samples.reverse().forEach(q => (q[0] = 1 - q[0]));
        for (const [f, h] of samples) points.push([s.startMm + f * s.lengthMm, h]);
      } else {
        const e = H.settings(piece.elevation),
          [a, b] = s.reverse ? [e.endMm, e.startMm] : [e.startMm, e.endMm];
        points.push([s.startMm, a], [s.startMm + s.lengthMm, b]);
      }
    }
    points.sort((p, q) => p[0] - q[0]);
    const heights = points.map(p => p[1]);
    let steepest = 0;
    for (let i = 1; i < points.length; i++) {
      const run = points[i][0] - points[i - 1][0];
      if (run > 1) steepest = Math.max(steepest, Math.abs(points[i][1] - points[i - 1][1]) / run);
    }
    return {
      points,
      lengthMm: route.lengthMm,
      minMm: heights.length ? Math.min(...heights) : 0,
      maxMm: heights.length ? Math.max(...heights) : 0,
      steepestPct: steepest * 100,
      hasHeights: heights.some(h => Math.abs(h) > 0.01),
    };
  }

  // SVG chart of the profile. Text labels use mm/m so the Imperial setting can convert them.
  function svg(profile, { width = 320, height = 120 } = {}) {
    const pad = { l: 48, r: 8, t: 10, b: 20 },
      w = width - pad.l - pad.r,
      h = height - pad.t - pad.b,
      top = Math.max(profile.maxMm, 10),
      bottom = Math.min(profile.minMm, 0),
      x = d => pad.l + (d / Math.max(profile.lengthMm, 1)) * w,
      y = z => pad.t + h - ((z - bottom) / (top - bottom)) * h,
      line = profile.points.map(([d, z]) => `${x(d).toFixed(1)},${y(z).toFixed(1)}`).join(' ');
    const area = `${x(0).toFixed(1)},${y(bottom).toFixed(1)} ${line} ${x(profile.lengthMm).toFixed(1)},${y(bottom).toFixed(1)}`;
    return `<svg class="elevation-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Track height along the lap">
      <line class="ec-zero" x1="${pad.l}" x2="${width - pad.r}" y1="${y(0)}" y2="${y(0)}"/>
      <polygon class="ec-area" points="${area}"/>
      <polyline class="ec-line" points="${line}"/>
      <text class="ec-label" x="${pad.l - 4}" y="${y(top) + 4}" text-anchor="end">${Math.round(top)} mm</text>
      <text class="ec-label" x="${pad.l - 4}" y="${y(0) + 4}" text-anchor="end">0</text>
      <text class="ec-label" x="${pad.l}" y="${height - 4}">start</text>
      <text class="ec-label" x="${width - pad.r}" y="${height - 4}" text-anchor="end">${(profile.lengthMm / 1000).toFixed(2)} m</text>
    </svg>`;
  }

  return { build, svg };
});
