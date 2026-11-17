(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./core.js'), require('./design-tools.js'));
  else root.FreeFormTools = factory(root.Forge, root.DesignTools);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F, T) {
  'use strict';
  const FF = F.FreeForm,
    S = F.Routed.Spline,
    clone = v => structuredClone(v),
    sub = (a, b) => a.map((v, i) => v - b[i]),
    add = (a, b) => a.map((v, i) => v + b[i]),
    mul = (a, t) => a.map(v => v * t),
    len = p => Math.hypot(...p),
    unit = p => mul(p, 1 / (len(p) || 1));
  function span(model, start, end) {
    const first = model.nodes.findIndex(n => n.id === start),
      last = model.nodes.findIndex(n => n.id === end);
    if (first < 0 || last < 0 || first === last) throw Error('Choose distinct start and finish anchors.');
    const indices = [];
    for (let i = first; i !== last; i = (i + 1) % model.nodes.length) {
      if (!model.closed && i === model.nodes.length - 1) throw Error('Finish must follow start on an open drawing.');
      if (model.nodes[i].locked || model.nodes[(i + 1) % model.nodes.length].locked)
        throw Error('Unlock the selected stretch anchors first.');
      indices.push(i);
      if (indices.length >= model.nodes.length) throw Error('Invalid selected stretch.');
    }
    return indices;
  }
  function spacing(model, profile, start, end, { mode, spacingMm, peak = 0.5, transition = 0.5 }) {
    if (model.laneCount < 2) throw Error('Generate at least two lanes before adjusting spacing.');
    const m = clone(model),
      indices = span(m, start, end),
      lengths = indices.map(i => S.arcMeasure(FF.controls(m, i)).length),
      total = lengths.reduce((a, b) => a + b, 0);
    if (
      !Number.isFinite(peak) ||
      peak < 0.05 ||
      peak > 0.95 ||
      !Number.isFinite(transition) ||
      transition <= 0 ||
      transition > Math.min(peak, 1 - peak)
    )
      throw Error('Transition must fit on both sides of the peak.');
    let accumulated = 0;
    const stops = lengths.slice(0, -1).map(l => (accumulated += l) / total);
    let at = 0;
    for (const [n, i] of indices.entries()) {
      const lo = at / total;
      at += lengths[n];
      m.nodes[i].squeeze = {
        version: 3,
        mode,
        spacingMm,
        domain: [lo, at / total],
        envelope: { peak, transition, stops },
      };
    }
    FF.parameters(m, profile);
    const d = FF.definition(m, profile);
    if (!d.geometry.valid) throw Error(d.geometry.issues.map(i => i.message).join(' '));
    return { model: m, lengthMm: total };
  }
  function smooth(model, ids) {
    const m = clone(model);
    if (!ids.length) throw Error('Select the joins to smooth.');
    for (const id of ids) {
      const i = m.nodes.findIndex(n => n.id === id),
        n = m.nodes[i];
      if (!n) continue;
      if (n.locked) throw Error('Unlock selected anchors first.');
      if (!m.closed && (i === 0 || i === m.nodes.length - 1)) continue;
      const prev = m.nodes[(i + m.nodes.length - 1) % m.nodes.length],
        next = m.nodes[(i + 1) % m.nodes.length],
        v = unit(sub(next.p, prev.p));
      if (!len(v)) throw Error('Coincident neighbours cannot define a tangent.');
      n.in = mul(v, -Math.min(len(n.in) || F.dist(prev.p, n.p) / 3, F.dist(prev.p, n.p) / 2));
      n.out = mul(v, Math.min(len(n.out) || F.dist(next.p, n.p) / 3, F.dist(next.p, n.p) / 2));
      n.mode = 'smooth';
    }
    return FF.validate(m);
  }
  function ramp(model, profile, start, end, z0, z1) {
    if (![z0, z1].every(z => Number.isFinite(z) && Math.abs(z) <= 5000))
      throw Error('Heights must be within ±5,000 mm.');
    let m = clone(model),
      indices = span(m, start, end);
    const splits = [];
    const ids = indices.map(i => m.nodes[i].id);
    for (const id of ids) {
      let i = m.nodes.findIndex(n => n.id === id),
        remaining = S.arcMeasure(FF.controls(m, i)).length;
      while (remaining > 250) {
        if (m.nodes.length >= FF.MAX)
          throw Error('Ramp smoothing needs more anchors than this drawing allows. Use a shorter stretch.');
        const arc = S.arcMeasure(FF.controls(m, i)),
          t = arc.parameter(250),
          nodeId = m.nodes[i].id,
          split = FF.split(m, i, t);
        splits.push({ nodeId, t, newNodeId: split.nodeId });
        m = split.model;
        i = m.nodes.findIndex(n => n.id === split.nodeId);
        remaining = S.arcMeasure(FF.controls(m, i)).length;
      }
    }
    indices = span(m, start, end);
    const lengths = indices.map(i => S.arcMeasure(FF.controls(m, i)).length),
      total = lengths.reduce((a, b) => a + b, 0);
    let distance = 0;
    const ease = t => t * t * (3 - 2 * t);
    for (const [j, i] of indices.entries()) {
      m.nodes[i].heightMm = z0 + (z1 - z0) * ease(distance / total);
      distance += lengths[j];
      m.nodes[(i + 1) % m.nodes.length].heightMm = z0 + (z1 - z0) * ease(distance / total);
    }
    let max = 0;
    for (const i of indices) {
      const c = FF.controls(m, i),
        dz = m.nodes[(i + 1) % m.nodes.length].heightMm - m.nodes[i].heightMm;
      for (let j = 0; j <= 32; j++) {
        const q = S.evaluate(c, j / 32),
          v = [
            3 * (1 - j / 32) ** 2 * (c[1][0] - c[0][0]) +
              6 * (1 - j / 32) * (j / 32) * (c[2][0] - c[1][0]) +
              3 * (j / 32) ** 2 * (c[3][0] - c[2][0]),
            3 * (1 - j / 32) ** 2 * (c[1][1] - c[0][1]) +
              6 * (1 - j / 32) * (j / 32) * (c[2][1] - c[1][1]) +
              3 * (j / 32) ** 2 * (c[3][1] - c[2][1]),
          ];
        max = Math.max(max, (Math.abs(dz) / (len(v) || 0.000001)) * 100);
      }
    }
    return { model: FF.validate(m), splits, maxGradientPct: max, lengthMm: total };
  }
  function fitPolyline(s, tolerance = 0.1) {
    const out = [];
    function fit(lo, hi, depth) {
      const points = s.points,
        a = points[lo],
        b = points[hi],
        t0 = F.rad(s.headingsDeg[lo]),
        t1 = F.rad(s.headingsDeg[hi]),
        u = [Math.cos(t0), Math.sin(t0)],
        v = [-Math.cos(t1), -Math.sin(t1)],
        L = s.distancesMm[hi] - s.distancesMm[lo];
      if (L < 0.01) throw Error('A section is too short to convert.');
      let aa = 0,
        bb = 0,
        ab = 0,
        ra = 0,
        rb = 0;
      for (let i = lo + 1; i < hi; i++) {
        const t = (s.distancesMm[i] - s.distancesMm[lo]) / L,
          A = 3 * (1 - t) ** 2 * t,
          B = 3 * (1 - t) * t * t,
          base = add(mul(a, (1 - t) ** 3 + A), mul(b, t ** 3 + B)),
          r = sub(points[i], base);
        aa += A * A;
        bb += B * B;
        ab += A * B * (u[0] * v[0] + u[1] * v[1]);
        ra += A * (r[0] * u[0] + r[1] * u[1]);
        rb += B * (r[0] * v[0] + r[1] * v[1]);
      }
      const det = aa * bb - ab * ab,
        x = det > 1e-12 ? (ra * bb - rb * ab) / det : L / 3,
        y = det > 1e-12 ? (rb * aa - ra * ab) / det : L / 3,
        c = [a, add(a, mul(u, x)), add(b, mul(v, y)), b];
      let error = 0;
      if (x > 0 && y > 0)
        for (let i = lo; i <= hi; i++) {
          const t = (s.distancesMm[i] - s.distancesMm[lo]) / L;
          error = Math.max(error, F.dist(S.evaluate(c, t).p, points[i]));
        }
      if (x <= 0 || y <= 0 || error > tolerance) {
        if (depth > 14 || hi - lo < 3) throw Error('Cannot fit this slot within the conversion tolerance.');
        const mid = Math.floor((lo + hi) / 2);
        fit(lo, mid, depth + 1);
        fit(mid, hi, depth + 1);
      } else out.push({ c, start: s.distancesMm[lo] / s.lengthMm, end: s.distancesMm[hi] / s.lengthMm, error });
    }
    fit(0, s.points.length - 1, 0);
    return out;
  }
  function convert(items, defs) {
    const roads = items.filter(p => defs[p.definitionId].geometry.lanePaths.length);
    if (!roads.length || roads.length !== items.length)
      throw Error(
        'Convert a layout containing routed road sections only. Remove separate borders or reference pictures first.'
      );
    T.editable(
      items,
      items.map(p => p.id)
    );
    const { order, closed } = T.chain(
        items,
        defs,
        items.map(p => p.id)
      ),
      base = order[0].d.parameters.routed;
    if (
      !base ||
      order.some(
        ({ d }) =>
          !d.parameters.routed || d.parameters.type === 'freeform' || d.parameters.squeeze || d.parameters.foldOverride
      )
    )
      throw Error(
        'Conversion supports ordinary routed sections. Reset local spacing and fold overrides before converting.'
      );
    const keys = Object.keys(base).filter(
      k => !['constructionMode', 'innerClearanceMm', 'outerClearanceMm'].includes(k)
    );
    if (order.some(({ d }) => keys.some(k => d.parameters.routed[k] !== base[k])))
      throw Error('Sections must share lane spacing and construction settings before conversion.');
    const elevation = F.Elevation.settings(order[0].p.elevation, base.boardThicknessMm);
    if (
      order.some(({ p, d }) => {
        const e = F.Elevation.settings(p.elevation, d.parameters.routed.boardThicknessMm);
        return e.thicknessMm !== elevation.thicknessMm || e.clearanceMm !== elevation.clearanceMm;
      })
    )
      throw Error('Sections must share deck thickness and required headroom before conversion.');
    const m = FF.empty(base.laneCount);
    m.closed = closed;
    m.elevation = { ...elevation, startMm: 0, endMm: 0 };
    const profile = F.Routed.settings({ ...base, constructionMode: 'table' });
    let lane = 0,
      lastEnd = null,
      firstHeight = null,
      maxError = 0,
      oldLengthMm = 0;
    const curves = [];
    for (const { p, entry, d } of order) {
      const port = F.ports(p, defs)[entry];
      if (lastEnd) {
        lane = port.lanes.findIndex(q => F.dist(q, lastEnd) < 0.15);
        if (lane < 0) throw Error('Slots do not match at a connection.');
      }
      const seg = F.worldSegments({ sections: [{ pieceId: p.id, laneIndex: lane, reverse: !!entry }] }, [p], defs)[0],
        e = F.Elevation.settings(p.elevation, profile.boardThicknessMm),
        z0 = entry ? e.endMm : e.startMm,
        z1 = entry ? e.startMm : e.endMm;
      oldLengthMm += seg.lengthMm || d.geometry.lanePaths[lane].lengthMm;
      let fitted = [];
      if (seg.type === 'line') {
        const delta = sub(seg.to, seg.from);
        fitted = [
          {
            c: [seg.from, add(seg.from, mul(delta, 1 / 3)), add(seg.from, mul(delta, 2 / 3)), seg.to],
            start: 0,
            end: 1,
            error: 0,
          },
        ];
      } else if (seg.type === 'arc') {
        const count = Math.ceil(Math.abs(seg.sweepDeg) / 45);
        for (let i = 0; i < count; i++) {
          const a = F.rad(seg.startAngleDeg + (seg.sweepDeg * i) / count),
            b = F.rad(seg.startAngleDeg + (seg.sweepDeg * (i + 1)) / count),
            k = (4 / 3) * Math.tan((b - a) / 4),
            r = seg.radiusMm,
            p0 = add(seg.center, [r * Math.cos(a), r * Math.sin(a)]),
            p3 = add(seg.center, [r * Math.cos(b), r * Math.sin(b)]),
            c = [
              p0,
              add(p0, [-r * Math.sin(a) * k, r * Math.cos(a) * k]),
              sub(p3, [-r * Math.sin(b) * k, r * Math.cos(b) * k]),
              p3,
            ];
          fitted.push({ c, start: i / count, end: (i + 1) / count, error: r * 0.000005 });
        }
      } else fitted = fitPolyline(seg);
      if (!curves.length) {
        const c = fitted[0].c,
          forward = sub(c[1], c[0]),
          other = port.lanes[lane === 0 ? 1 : 0];
        if (base.laneCount > 1) {
          const v = sub(other, port.lanes[lane]);
          m.side = Math.sign(forward[0] * v[1] - forward[1] * v[0]) || 1;
        }
        firstHeight = z0;
      }
      if (curves.length && Math.abs(curves.at(-1).z1 - z0) > 0.15)
        throw Error('Match heights at joins before conversion.');
      for (const f of fitted) {
        curves.push({ ...f, z0: z0 + (z1 - z0) * f.start, z1: z0 + (z1 - z0) * f.end });
        maxError = Math.max(maxError, f.error);
      }
      lastEnd = F.ports(p, defs)[1 - entry].lanes[lane];
    }
    if (curves.length + (closed ? 0 : 1) > FF.MAX)
      throw Error('The converted track needs more than 96 anchors. Simplify it first.');
    if (closed && Math.abs(curves.at(-1).z1 - firstHeight) > 0.15) throw Error('Match the closing heights first.');
    for (let i = 0; i < curves.length; i++) {
      const c = curves[i].c,
        prev = curves[(i + curves.length - 1) % curves.length].c;
      m.nodes.push({
        id: FF.uid(),
        p: c[0],
        in: i || closed ? sub(prev[2], c[0]) : [0, 0],
        out: sub(c[1], c[0]),
        mode: 'manual',
        locked: false,
        heightMm: curves[i].z0,
      });
    }
    if (!closed) {
      const c = curves.at(-1).c;
      m.nodes.push({
        id: FF.uid(),
        p: c[3],
        in: sub(c[2], c[3]),
        out: [0, 0],
        mode: 'manual',
        locked: false,
        heightMm: curves.at(-1).z1,
      });
    }
    const model = FF.validate(m),
      definition = FF.definition(model, profile);
    return { model, profile, definition, maxErrorMm: maxError, oldLengthMm };
  }
  function remapMark(mark, splits = []) {
    let result = mark ? clone(mark) : null;
    for (const split of splits)
      if (result?.nodeId === split.nodeId)
        result =
          result.t <= split.t
            ? { nodeId: result.nodeId, t: result.t / split.t }
            : { nodeId: split.newNodeId, t: (result.t - split.t) / (1 - split.t) };
    return result;
  }
  return { span, spacing, smooth, ramp, convert, fitPolyline, remapMark };
});
