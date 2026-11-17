(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./core.js'), require('./routed-checks.js'));
  else root.DesignTools = factory(root.Forge, root.RoutedChecks);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F, RC) {
  'use strict';
  const clone = v => structuredClone(v),
    distance = F.dist,
    add = (a, b) => a.map((v, i) => v + b[i]),
    sub = (a, b) => a.map((v, i) => v - b[i]),
    mul = (p, t) => p.map(v => v * t),
    unit = p => mul(p, 1 / (Math.hypot(...p) || 1));
  function expanded(items, ids) {
    const chosen = new Set(ids),
      groups = new Set(items.filter(p => chosen.has(p.id) && p.groupId).map(p => p.groupId));
    return items.filter(p => chosen.has(p.id) || groups.has(p.groupId)).map(p => p.id);
  }
  function editable(items, ids) {
    if (items.some(p => ids.includes(p.id) && p.locked)) throw Error('Unlock the selected pieces before editing them.');
  }
  function group(items, ids, remove = false) {
    editable(items, ids);
    if (!remove && ids.length < 2) throw Error('Select at least two pieces to group.');
    const groupId = F.uid();
    return items.map(p => {
      if (!ids.includes(p.id)) return p;
      const q = { ...p };
      if (remove) delete q.groupId;
      else q.groupId = groupId;
      return q;
    });
  }
  const inventoryKey = d => (d.sku ? d.family + '|sku:' + d.sku : d.id);
  function inventory(items, defs, owned = {}) {
    const map = new Map();
    for (const p of items) {
      const d = defs[p.definitionId],
        key = inventoryKey(d);
      if (!map.has(key))
        map.set(key, {
          key,
          name: d.name,
          pack: d.pack,
          sku: d.sku || '',
          used: 0,
          owned: owned[key] ?? 0,
          pieceIds: [],
        });
      const row = map.get(key);
      row.used++;
      row.pieceIds.push(p.id);
    }
    return [...map.values()].map(r => ({ ...r, missing: Math.max(0, r.used - r.owned) }));
  }
  function shoppingCSV(rows) {
    const q = s =>
      '"' +
      String(s)
        .replace(/^(\s*[=+@-])/, "'$1")
        .replaceAll('"', '""') +
      '"';
    return (
      '\uFEFF' +
      [
        ['Piece', 'Pack', 'Product code', 'Used', 'Owned', 'Missing'],
        ...rows.filter(r => r.missing).map(r => [r.name, r.pack, r.sku, r.used, r.owned, r.missing]),
      ]
        .map(r => r.map(q).join(','))
        .join('\r\n')
    );
  }
  function catalogueDefinition(d, defs) {
    const merged = F.mergeDefinitions({ [d.id]: d }, [F.pose(d)], defs);
    Object.assign(defs, merged.definitions);
    return defs[merged.pieces[0].definitionId];
  }
  function replace(items, defs, id, replacement, end = 0) {
    const old = items.find(p => p.id === id);
    if (!old) throw Error('Select a piece to replace.');
    editable(items, [id]);
    const target = F.ports(old, defs)[end];
    if (!target || !replacement || replacement.geometry?.connectors.length !== 2)
      throw Error('Replacement needs two road connectors.');
    const nd = { ...defs },
      d = catalogueDefinition(F.validateDefinition(replacement), nd),
      pose = F.join({ ...old, definitionId: d.id }, d, end, { ...target, angle: F.wrap(target.angle + 180) }),
      port = F.ports(pose, nd)[end];
    if (!F.compatible(port, target) || !F.slotsMatch(port, target, 0.15))
      throw Error('The replacement has different connectors or lane spacing.');
    const next = items.map(p => (p.id === id ? pose : p)),
      other = F.ports(old, defs)[1 - end],
      newOther = F.ports(pose, nd)[1 - end];
    return {
      items: next,
      definitions: nd,
      gapMm: distance(other.position, newOther.position),
      angleDeg: Math.abs(F.wrap(other.angle - newOther.angle)),
    };
  }
  function gapSuggestions(items, defs, start, end, candidates, { depth = 4, budget = 4000 } = {}) {
    if (!start || !end || (start.pieceId === end.pieceId && start.index === end.index))
      throw Error('Choose two different open ends.');
    if (Math.abs(start.heightMm - end.heightMm) > 0.15)
      throw Error('Match the open-end heights before searching for a flat connection.');
    const nd = { ...defs },
      pool = candidates
        .filter(
          d =>
            ['straight', 'curve'].includes(d.parameters?.type) &&
            !d.parameters.routed &&
            !d.parameters.laneChange &&
            d.geometry?.connectors.length === 2 &&
            F.compatible(F.ports(F.pose(d), { [d.id]: d })[0], start)
        )
        .slice(0, 120)
        .map(d => catalogueDefinition(d, nd)),
      found = [],
      queue = [{ placed: [], port: start }];
    let visited = 0;
    while (queue.length && visited < budget) {
      const current = queue.shift();
      for (const d of pool)
        for (const flip of d.mirror ? [false, true] : [false]) {
          if (++visited > budget) break;
          let p = F.pose(d);
          if (start.heightMm)
            p.elevation = { ...F.Elevation.settings(undefined), startMm: start.heightMm, endMm: start.heightMm };
          p.flip = flip;
          const incoming = F.ports(p, nd)[0];
          if (!F.compatible(incoming, current.port)) continue;
          p = F.join(p, d, 0, current.port);
          const [a, b] = F.ports(p, nd);
          if (!F.slotsMatch(a, current.port, 0.15)) continue;
          const placed = [...current.placed, p],
            gap = distance(b.position, end.position),
            angle = Math.abs(Math.abs(F.wrap(b.angle - end.angle)) - 180);
          if (
            gap < 0.15 &&
            angle < 0.1 &&
            F.compatible(b, end) &&
            F.slotsMatch(b, end, 0.15) &&
            Math.abs(b.heightMm - end.heightMm) < 0.15
          ) {
            found.push({ items: placed, gapMm: gap, angleDeg: angle, definitions: nd });
            if (found.length >= 8) return { found, visited, limited: true };
          } else if (
            placed.length < depth &&
            queue.length < budget &&
            gap < distance(start.position, end.position) + 3000
          )
            queue.push({ placed, port: b });
        }
    }
    return { found, visited, limited: visited >= budget };
  }
  function chain(items, defs, ids) {
    const subset = items.filter(p => ids.includes(p.id));
    if (!subset.length) throw Error('Select a connected stretch.');
    const net = F.connections(subset, defs);
    if (net.ambiguous.size || ![0, 2].includes(net.open.length))
      throw Error('Select one unbranched connected stretch.');
    const first = net.open[0] || F.ports(subset[0], defs)[0],
      order = [],
      seen = new Set();
    let id = first.pieceId,
      entry = first.index;
    while (!seen.has(id)) {
      seen.add(id);
      const p = subset.find(p => p.id === id);
      order.push({ p, entry, d: defs[p.definitionId] });
      const link = net.links.get(id + ':' + (1 - entry));
      if (!link) break;
      id = link.pieceId;
      entry = link.index;
    }
    if (order.length !== subset.length) throw Error('The selection contains separate stretches.');
    return { order, closed: net.open.length === 0 };
  }
  function ramp(items, defs, ids, start, end) {
    editable(items, ids);
    if (![start, end].every(v => Number.isFinite(v) && v >= -5000 && v <= 5000))
      throw Error('Heights must be within ±5,000 mm.');
    const { order, closed } = chain(items, defs, ids);
    if (closed && start !== end) throw Error('Choose an open stretch for a ramp.');
    const lengths = order.map(q => q.d.geometry.centrelineLengthMm),
      total = lengths.reduce((a, b) => a + b, 0);
    if (!total) throw Error('This selection has no calculated road length.');
    let pos = 0;
    const next = new Map(),
      smooth = t => t * t * (3 - 2 * t);
    for (const [i, { p, entry, d }] of order.entries()) {
      const a = start + (end - start) * smooth(pos / total);
      pos += lengths[i];
      const b = start + (end - start) * smooth(pos / total);
      next.set(p.id, {
        ...p,
        elevation: {
          ...F.Elevation.settings(p.elevation, d.parameters.routed?.boardThicknessMm || 10),
          startMm: entry ? b : a,
          endMm: entry ? a : b,
        },
      });
    }
    return {
      items: items.map(p => next.get(p.id) || p),
      maxGradientPct: Math.max(
        ...order.map(({ p, d }) => {
          const e = next.get(p.id).elevation;
          return (Math.abs(e.endMm - e.startMm) / d.geometry.centrelineLengthMm) * 100;
        })
      ),
      lengthMm: total,
    };
  }
  function issues(items, defs, table) {
    const out = [];
    for (const p of F.connections(items, defs).open)
      out.push({
        code: 'open-end',
        message:
          'Open end ' +
          (p.index ? 'B' : 'A') +
          ' — ' +
          defs[p.pieceId ? items.find(i => i.id === p.pieceId).definitionId : ''].name,
        point: p.position,
        pieceIds: [p.pieceId],
      });
    out.push(...F.Elevation.checks(items, defs, F));
    if (items.some(p => defs[p.definitionId].parameters.routed && defs[p.definitionId].parameters.type !== 'freeform'))
      out.push(...RC.checks(items, defs, table));
    for (const p of items) {
      const d = defs[p.definitionId];
      if (d.parameters.type === 'freeform')
        out.push(
          ...F.FreeForm.check(d, table, p).map(i => {
            const node = d.parameters.freeform.nodes.find(n => n.id === i.nodeId);
            return { ...i, ...(!i.point && node ? { point: F.point(node.p, p) } : {}), pieceIds: [p.id] };
          })
        );
    }
    return out;
  }
  function sample(items, defs, step = 25) {
    const total = items.reduce(
      (sum, p) =>
        sum +
        (defs[p.definitionId].geometry.lanePaths.length
          ? defs[p.definitionId].geometry.lanePaths
          : defs[p.definitionId].geometry.previewLanes || []
        ).reduce((n, l) => n + l.lengthMm, 0),
      0
    );
    step = Math.max(step, total / 12000);
    const out = [];
    for (const p of items) {
      const d = defs[p.definitionId],
        paths = d.geometry.lanePaths.length ? d.geometry.lanePaths : d.geometry.previewLanes || [];
      for (let i = 0; i < paths.length; i++) {
        const lane = paths[i],
          segments = F.worldSegments({ sections: [{ pieceId: p.id, laneIndex: i, reverse: false }] }, [p], {
            [d.id]: { ...d, geometry: { ...d.geometry, lanePaths: paths } },
          });
        for (const s of segments) {
          const len = s.lengthMm ?? lane.lengthMm,
            n = Math.min(800, Math.max(2, Math.ceil(len / step))),
            pts = [];
          for (let j = 0; j <= n; j++) {
            const t = j / n;
            let q;
            if (s.type === 'polyline') q = F.Routed.Spline.at(s, len * t);
            else if (s.type === 'line')
              q = {
                x: s.from[0] + (s.to[0] - s.from[0]) * t,
                y: s.from[1] + (s.to[1] - s.from[1]) * t,
                heading: (Math.atan2(s.to[1] - s.from[1], s.to[0] - s.from[0]) * 180) / Math.PI,
                curvature: 0,
              };
            else if (s.type === 'arc') {
              const a = F.rad(s.startAngleDeg + s.sweepDeg * t);
              q = {
                x: s.center[0] + s.radiusMm * Math.cos(a),
                y: s.center[1] + s.radiusMm * Math.sin(a),
                heading: F.deg(a) + Math.sign(s.sweepDeg) * 90,
                curvature: Math.sign(s.sweepDeg) / s.radiusMm,
              };
            }
            if (q) {
              let z = F.Elevation.at(F.Elevation.settings(p.elevation, d.parameters.routed?.boardThicknessMm || 10), t);
              if (s.type === 'polyline') {
                const ds = s.distancesMm;
                let lo = 0,
                  hi = ds.length - 1;
                while (hi - lo > 1) {
                  const mid = (lo + hi) >> 1;
                  if (ds[mid] <= len * t) lo = mid;
                  else hi = mid;
                }
                const f = (len * t - ds[lo]) / (ds[hi] - ds[lo] || 1);
                if (d.geometry.reference?.heightsMm?.length === ds.length) {
                  const zs = d.geometry.reference.heightsMm;
                  z = zs[lo] + (zs[hi] - zs[lo]) * f;
                } else if (d.geometry.parametersT?.length === ds.length) {
                  const ts = d.geometry.parametersT;
                  z = F.Elevation.at(
                    F.Elevation.settings(p.elevation, d.parameters.routed?.boardThicknessMm || 10),
                    ts[lo] + (ts[hi] - ts[lo]) * f
                  );
                }
              }
              pts.push({ ...q, heightMm: z });
            }
          }
          out.push({ pieceId: p.id, lane: i, points: pts });
        }
      }
    }
    return out;
  }
  function overlay(
    items,
    defs,
    { curvature = false, envelope = false, widthMm = 56, lengthMm = 141, driftMm = 0 } = {}
  ) {
    if (!curvature && !envelope) return '';
    let out = '';
    for (const lane of sample(items, defs)) {
      for (let i = 1; i < lane.points.length; i++) {
        const a = lane.points[i - 1],
          b = lane.points[i],
          r = Math.abs(b.curvature) > 1e-9 ? 1 / Math.abs(b.curvature) : Infinity,
          color = r < 150 ? '#e5484d' : r < 300 ? '#ef963d' : r < 600 ? '#cfbf44' : r < 1200 ? '#4ab891' : '#579bd4';
        if (curvature)
          out += `<path d="M ${a.x} ${a.y} L ${b.x} ${b.y}" stroke="${color}" stroke-width="9" fill="none"/>`;
        if (envelope && i % 3 === 0)
          out += `<rect x="${-lengthMm / 2}" y="${-widthMm / 2 - driftMm}" width="${lengthMm}" height="${widthMm + 2 * driftMm}" transform="translate(${b.x} ${b.y}) rotate(${b.heading})" fill="#bd81ed" fill-opacity=".08" stroke="#bd81ed" stroke-opacity=".5" stroke-width="1"/>`;
      }
    }
    return out;
  }
  function clearance(items, defs, table, size, drift = 0) {
    if (
      ![size.widthMm, size.lengthMm].every(v => Number.isFinite(v) && v > 0 && v <= 5000) ||
      !Number.isFinite(drift) ||
      drift < 0 ||
      drift > 300
    )
      throw Error('Use valid car dimensions and a drift allowance from 0 to 300 mm.');
    const lanes = sample(items, defs, Math.max(10, size.lengthMm / 6)),
      issues = [],
      reported = new Set(),
      grid = new Map(),
      cell = Math.hypot(size.lengthMm, size.widthMm + 2 * drift),
      routes = new Map(),
      net = F.routes(items, defs);
    let comparisons = 0,
      count = 0;
    for (const route of net.routes) for (const s of route.sections) routes.set(s.pieceId + ':' + s.laneIndex, route.id);
    for (const lane of lanes) {
      const p = items.find(p => p.id === lane.pieceId),
        d = defs[p.definitionId],
        e = F.Elevation.settings(
          d.parameters.freeform?.elevation || p.elevation,
          d.parameters.routed?.boardThicknessMm || 10
        );
      for (let i = 0; i < lane.points.length; i += 2) {
        if (++count > 20000)
          return [
            ...issues,
            {
              code: 'car-budget',
              message: 'Car envelope review reached its sampling budget. Review a smaller selection.',
            },
          ];
        const q = lane.points[i],
          a = F.rad(q.heading),
          c = Math.cos(a),
          s = Math.sin(a),
          w = size.widthMm / 2 + drift,
          l = size.lengthMm / 2,
          corners = [
            [-l, -w],
            [l, -w],
            [l, w],
            [-l, w],
          ].map(([x, y]) => [q.x + x * c - y * s, q.y + x * s + y * c]);
        if (table?.kind === 'table' && !F.Routed.Table.fits(table, corners, true) && !reported.has('table:' + p.id)) {
          reported.add('table:' + p.id);
          issues.push({
            code: 'car-table',
            pieceIds: [p.id],
            point: [q.x, q.y],
            message: 'Approximate car body envelope reaches outside the table.',
          });
        }
        const rec = {
            route: routes.get(p.id + ':' + lane.lane),
            lane: lane.lane,
            pieceId: p.id,
            p: [q.x, q.y],
            z: q.heightMm,
            corners,
            e,
          },
          x = Math.floor(q.x / cell),
          y = Math.floor(q.y / cell);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (const other of grid.get(x + dx + ',' + (y + dy)) || []) {
              if (++comparisons > 300000)
                return [
                  ...issues,
                  {
                    code: 'car-budget',
                    message: 'Car envelope review reached its sampling budget. Review a smaller selection.',
                  },
                ];
              if (
                (rec.route && rec.route === other.route) ||
                (!rec.route && rec.pieceId === other.pieceId && rec.lane === other.lane)
              )
                continue;
              if (distance(rec.p, other.p) > cell) continue;
              // A joined continuation is not a neighbouring lane, including on open layouts.
              if (
                !rec.route &&
                rec.pieceId !== other.pieceId &&
                Math.abs(F.wrap(q.heading - other.heading)) < 30 &&
                distance(rec.p, other.p) < size.lengthMm
              ) {
                const cross = Math.abs((other.p[0] - q.x) * s - (other.p[1] - q.y) * c);
                if (cross < 1) continue;
              }
              const gap = Math.abs(rec.z - other.z) - (rec.z >= other.z ? rec.e.thicknessMm : other.e.thicknessMm);
              if (gap >= Math.max(rec.e.clearanceMm, other.e.clearanceMm)) continue;
              const key = [rec.pieceId, other.pieceId].sort().join(':');
              if (!reported.has(key) && polyOverlap(rec.corners, other.corners)) {
                reported.add(key);
                issues.push({
                  code: 'car-lanes',
                  pieceIds: [...new Set([rec.pieceId, other.pieceId])],
                  point: rec.p,
                  message: 'Sampled car envelopes overlap. Check neighbouring lanes and crossings here.',
                });
              }
            }
        rec.heading = q.heading;
        const key = x + ',' + y;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(rec);
      }
    }
    return issues;
  }
  function polyOverlap(a, b) {
    for (const polygon of [a, b])
      for (let i = 0; i < polygon.length; i++) {
        const q = sub(polygon[(i + 1) % polygon.length], polygon[i]),
          n = [-q[1], q[0]],
          pa = a.map(p => p[0] * n[0] + p[1] * n[1]),
          pb = b.map(p => p[0] * n[0] + p[1] * n[1]);
        if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
      }
    return true;
  }
  return {
    expanded,
    editable,
    group,
    inventoryKey,
    inventory,
    shoppingCSV,
    replace,
    gapSuggestions,
    chain,
    ramp,
    issues,
    sample,
    overlay,
    clearance,
  };
});
