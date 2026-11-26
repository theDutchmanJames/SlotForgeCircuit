// Power taps: where the power base and extra feed wires join the track, and whether every
// stretch between two feeds stays within the usual limits. Rules of thumb, not measurements:
//  - plastic track: a feed at least every 10 m, and every 15 joints (joints lose more than rail);
//  - routed wood with braid: one feed powers about 30 m; copper tape needs about five times as many.
// The test sheet is the real check: at any point a lane should stay within 1 V of the power base
// while a car is drawing power (BSCRA track standard). Pure data and calculations: no DOM.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrackPower = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const RULES = Object.freeze({
    plastic: Object.freeze({ maxMetres: 10, maxJoints: 15 }),
    braid: Object.freeze({ maxMetres: 30, maxJoints: null }),
    tape: Object.freeze({ maxMetres: 6, maxJoints: null }),
  });
  const MAX_DROP = 1; // volts below the power base reading
  const ID = /^[\w-]{1,100}$/,
    LANE = /^[\w-]{1,40}$/;
  const volts = v => Number.isFinite(v) && v >= 0 && v <= 60;

  function empty() {
    return { version: 1, base: null, taps: [] };
  }
  // Validates saved power data; anything unknown is refused, like the other workspace parts.
  function settings(raw) {
    if (raw === undefined || raw === null) return empty();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 1)
      throw Error('Unsupported power tap data.');
    if (Object.keys(raw).some(k => !['version', 'base', 'taps', 'rules', 'readings'].includes(k)))
      throw Error('Unsupported power tap data.');
    if (raw.base !== null && raw.base !== undefined && (typeof raw.base !== 'string' || !ID.test(raw.base)))
      throw Error('Invalid power base piece.');
    const taps = raw.taps ?? [];
    if (!Array.isArray(taps) || taps.length > 200 || taps.some(t => typeof t !== 'string' || !ID.test(t)))
      throw Error('Invalid power taps.');
    const out = { version: 1, base: raw.base || null, taps: [...new Set(taps)].filter(t => t !== raw.base) };
    if (raw.rules !== undefined) {
      const r = raw.rules;
      if (
        !r ||
        typeof r !== 'object' ||
        Array.isArray(r) ||
        Object.keys(r).some(k => !['maxMetres', 'maxJoints'].includes(k))
      )
        throw Error('Invalid power tap rules.');
      if (!Number.isFinite(r.maxMetres) || r.maxMetres < 0.5 || r.maxMetres > 200)
        throw Error('Power taps: enter between 0.5 and 200 m.');
      if (r.maxJoints !== null && (!Number.isInteger(r.maxJoints) || r.maxJoints < 1 || r.maxJoints > 500))
        throw Error('Power taps: enter between 1 and 500 joints, or leave it empty.');
      out.rules = { maxMetres: r.maxMetres, maxJoints: r.maxJoints };
    }
    if (raw.readings !== undefined) {
      const lanes = raw.readings;
      if (!lanes || typeof lanes !== 'object' || Array.isArray(lanes) || Object.keys(lanes).length > 8)
        throw Error('Invalid power readings.');
      out.readings = {};
      for (const [lane, r] of Object.entries(lanes)) {
        if (!LANE.test(lane) || !r || typeof r !== 'object' || Array.isArray(r)) throw Error('Invalid power readings.');
        if (Object.keys(r).some(k => !['base', 'points'].includes(k))) throw Error('Invalid power readings.');
        const entry = {};
        if (r.base !== undefined) {
          if (!volts(r.base)) throw Error('Readings must be between 0 and 60 V.');
          entry.base = r.base;
        }
        if (r.points !== undefined) {
          if (
            !r.points ||
            typeof r.points !== 'object' ||
            Array.isArray(r.points) ||
            Object.keys(r.points).length > 400
          )
            throw Error('Invalid power readings.');
          entry.points = {};
          for (const [id, v] of Object.entries(r.points)) {
            if (!ID.test(id) || !volts(v)) throw Error('Readings must be between 0 and 60 V.');
            entry.points[id] = v;
          }
        }
        out.readings[lane] = entry;
      }
    }
    return out;
  }
  // Drops feeds and readings for pieces that are no longer on the track.
  function prune(raw, pieceIds) {
    const s = settings(raw),
      has = new Set(pieceIds),
      out = { version: 1, base: has.has(s.base) ? s.base : null, taps: s.taps.filter(t => has.has(t)) };
    if (s.rules) out.rules = s.rules;
    if (s.readings) {
      out.readings = {};
      for (const [lane, r] of Object.entries(s.readings)) {
        const points = Object.fromEntries(Object.entries(r.points || {}).filter(([id]) => has.has(id)));
        out.readings[lane] = {
          ...(r.base !== undefined ? { base: r.base } : {}),
          ...(Object.keys(points).length ? { points } : {}),
        };
      }
    }
    return out;
  }
  function used(s) {
    return !!(s.base || s.taps.length || s.rules || s.readings);
  }

  // What the track is made of decides the usual limits.
  function kind(items, defs) {
    if (!items.length) return null;
    const params = items.map(p => defs[p.definitionId]?.parameters || {});
    if (params.some(q => q.type === 'freeform')) return 'freeform';
    const routed = params.find(q => q.routed);
    if (routed) return routed.routed.conductor === 'tape' ? 'tape' : 'braid';
    return 'plastic';
  }
  function rules(s, k) {
    return s.rules || RULES[k] || RULES.plastic;
  }

  // Marks or unmarks a piece. role: 'base' | 'tap' | null.
  function mark(raw, pieceId, role) {
    const s = settings(raw),
      out = { ...s, taps: s.taps.filter(t => t !== pieceId) };
    if (s.base === pieceId) out.base = null;
    if (role === 'base') {
      if (s.base && s.base !== pieceId) out.taps = [...out.taps, s.base]; // the old base becomes a tap
      out.base = pieceId;
    } else if (role === 'tap') out.taps = [...out.taps, pieceId];
    return settings(out);
  }
  function role(s, pieceId) {
    return s.base === pieceId ? 'base' : s.taps.includes(pieceId) ? 'tap' : null;
  }

  // net: the result of Forge.routes / Integration.network. Returns every stretch between two feeds.
  function analyse(net, items, defs, raw) {
    const s = settings(raw),
      k = kind(items, defs),
      limit = rules(s, k),
      base = { kind: k, rules: limit, usual: RULES[k] || RULES.plastic, settings: s };
    if (!items.length) return { ...base, state: 'empty', message: 'Place track pieces first.' };
    if (k === 'freeform')
      return {
        ...base,
        state: 'unsupported',
        message: 'Power taps work on track pieces and Routed Wood sections. FreeForm circuits are not supported yet.',
      };
    if (!net?.closed || !net.routes?.length)
      return { ...base, state: 'open', message: 'Join the track into one closed loop to check its power.' };
    // Lanes are named by their place (lane-1, lane-2 …): route ids change whenever a piece is added.
    const lanes = net.routes.map((r, i) => ({ ...r, id: 'lane-' + (i + 1) })),
      order = lanes[0].sections.map(x => x.pieceId),
      at = new Map(order.map((id, i) => [id, i])),
      n = order.length,
      name = id => defs[items.find(p => p.id === id)?.definitionId]?.name || 'piece';
    const feeds = [];
    if (s.base && at.has(s.base)) feeds.push({ pieceId: s.base, role: 'base', index: at.get(s.base) });
    s.taps
      .filter(t => at.has(t))
      .sort((a, b) => at.get(a) - at.get(b))
      .forEach(t => feeds.push({ pieceId: t, role: 'tap', index: at.get(t) }));
    // Labels: B for the power base, then T1, T2 … in driving order starting after the base.
    const start = feeds.find(f => f.role === 'base')?.index ?? feeds[0]?.index ?? 0,
      ahead = i => (i - start + n) % n;
    feeds.sort((a, b) => ahead(a.index) - ahead(b.index));
    let t = 0;
    for (const f of feeds) {
      f.label = f.role === 'base' ? 'B' : 'T' + ++t;
      f.name = name(f.pieceId);
    }
    if (!feeds.length)
      return {
        ...base,
        state: 'none',
        feeds,
        stretches: [],
        suggestions: [],
        lanes: lanes.map(r => ({ id: r.id, lengthMm: r.lengthMm })),
        message: 'Mark where the power base joins the track: right-click a piece and choose Power base here.',
      };
    const centre = (lane, i) => lane.sections[i].startMm + lane.sections[i].lengthMm / 2,
      pieceAt = (lane, d) => {
        d = ((d % lane.lengthMm) + lane.lengthMm) % lane.lengthMm;
        let i = lane.sections.findIndex(x => d < x.startMm + x.lengthMm);
        return i < 0 ? n - 1 : i;
      };
    const taken = new Set(feeds.map(f => f.pieceId)),
      stretches = [],
      suggestions = [];
    let p = 0;
    for (let f = 0; f < feeds.length; f++) {
      const a = feeds[f],
        b = feeds[(f + 1) % feeds.length],
        joints = (b.index - a.index + n) % n || n,
        perLane = lanes.map(lane => {
          const mm = (centre(lane, b.index) - centre(lane, a.index) + lane.lengthMm) % lane.lengthMm || lane.lengthMm;
          return { id: lane.id, mm };
        }),
        worst = perLane.reduce((x, y) => (y.mm > x.mm ? y : x)),
        reasons = [];
      if (worst.mm > limit.maxMetres * 1000 + 0.5) reasons.push('metres');
      if (limit.maxJoints && joints > limit.maxJoints) reasons.push('joints');
      // The farthest point from both feeds is half way: that is where the test reading goes.
      const lane0 = lanes[0],
        span = perLane[0].mm,
        from = centre(lane0, a.index),
        testIndex = pieceAt(lane0, from + span / 2),
        test = order[testIndex];
      const stretch = {
        from: a,
        to: b,
        joints,
        lanes: perLane,
        worst,
        tooLong: reasons.length > 0,
        reasons,
        test: { pieceId: test, label: 'P' + ++p, name: name(test), afterBaseMm: ahead(testIndex) },
      };
      if (stretch.tooLong) {
        const parts = Math.max(
          Math.ceil(worst.mm / (limit.maxMetres * 1000)),
          limit.maxJoints ? Math.ceil(joints / limit.maxJoints) : 1,
          2
        );
        for (let i = 1; i < parts; i++) {
          let idx = pieceAt(lane0, from + (span * i) / parts);
          // Prefer a straight beside the ideal piece: wires are easier to fit there.
          const straight = [idx, (idx + 1) % n, (idx - 1 + n) % n].find(
            j =>
              defs[items.find(q => q.id === order[j])?.definitionId]?.parameters?.type === 'straight' &&
              !taken.has(order[j])
          );
          if (straight !== undefined) idx = straight;
          if (!taken.has(order[idx])) {
            taken.add(order[idx]);
            suggestions.push(order[idx]);
          }
        }
      }
      stretches.push(stretch);
    }
    // Distance after the power base along lane 1, for the test sheet.
    for (const x of stretches) {
      const lane0 = lanes[0],
        startMm = centre(lane0, start),
        i = order.indexOf(x.test.pieceId);
      x.test.afterBaseMm = (centre(lane0, i) - startMm + lane0.lengthMm) % lane0.lengthMm;
    }
    const problems = stretches.filter(x => x.tooLong);
    return {
      ...base,
      state: problems.length ? 'problems' : s.base && at.has(s.base) ? 'ok' : 'nobase',
      feeds,
      stretches,
      problems,
      suggestions,
      lanes: lanes.map(r => ({ id: r.id, lengthMm: r.lengthMm })),
      message: problems.length
        ? problems.length === 1
          ? '1 stretch is longer than the usual limit.'
          : problems.length + ' stretches are longer than the usual limit.'
        : s.base && at.has(s.base)
          ? 'Every stretch is within the limit.'
          : 'Every stretch is within the limit. Mark which feed is the power base.',
    };
  }

  // Compares test readings with the power base reading of the same lane.
  function results(analysis, raw) {
    const s = settings(raw),
      out = [];
    for (const lane of analysis.lanes || []) {
      const r = s.readings?.[lane.id] || {},
        rows = (analysis.stretches || []).map(x => {
          const v = r.points?.[x.test.pieceId],
            drop = r.base !== undefined && v !== undefined ? r.base - v : null;
          return { stretch: x, volts: v ?? null, drop, ok: drop === null ? null : drop <= MAX_DROP + 1e-9 };
        });
      out.push({ lane: lane.id, base: r.base ?? null, rows });
    }
    return out;
  }
  function reading(raw, laneId, pointId, value) {
    const s = settings(raw),
      readings = structuredClone(s.readings || {}),
      lane = (readings[laneId] ||= {});
    if (pointId === 'base') {
      if (value === null) delete lane.base;
      else lane.base = value;
    } else {
      lane.points ||= {};
      if (value === null) delete lane.points[pointId];
      else lane.points[pointId] = value;
      if (!Object.keys(lane.points).length) delete lane.points;
    }
    if (!Object.keys(lane).length) delete readings[laneId];
    const out = { ...s, readings };
    if (!Object.keys(readings).length) delete out.readings;
    return settings(out);
  }

  // Where to draw the marks. at(route, d) gives {x, y} (Forge.at); net is the same network the
  // analysis was made from. Feeds and test points sit between the lanes, in the middle of the piece.
  function marks(analysis, net, at) {
    const out = { feeds: [], points: [], weak: [] };
    if (!analysis?.stretches?.length || !net?.closed) return out;
    const routes = net.routes,
      centre = (lane, id) => {
        const s = lane.sections.find(x => x.pieceId === id);
        return s ? s.startMm + s.lengthMm / 2 : null;
      },
      place = id => {
        const pts = routes.map(r => (centre(r, id) === null ? null : at(r, centre(r, id)))).filter(Boolean);
        return pts.length
          ? [pts.reduce((s, q) => s + q.x, 0) / pts.length, pts.reduce((s, q) => s + q.y, 0) / pts.length]
          : null;
      };
    // A too-long stretch is one band down the middle of the track, as wide as the lanes.
    for (const x of analysis.problems || []) {
      const parts = routes.map(lane => {
        const a = centre(lane, x.from.pieceId),
          b = centre(lane, x.to.pieceId);
        return a === null || b === null
          ? null
          : { lane, a, span: (b - a + lane.lengthMm) % lane.lengthMm || lane.lengthMm };
      });
      if (parts.some(p => !p)) continue;
      const steps = Math.max(2, Math.ceil(parts[0].span / 40)),
        pts = Array.from({ length: steps + 1 }, (_, i) => {
          const qs = parts.map(p => at(p.lane, p.a + (p.span * i) / steps));
          return [qs.reduce((s, q) => s + q.x, 0) / qs.length, qs.reduce((s, q) => s + q.y, 0) / qs.length];
        });
      const first = parts.map(p => at(p.lane, p.a)),
        width = first.length > 1 ? Math.hypot(first[0].x - first.at(-1).x, first[0].y - first.at(-1).y) + 40 : 40;
      out.weak.push({ points: pts, width });
    }
    for (const x of analysis.stretches) {
      const q = place(x.test.pieceId);
      if (q) out.points.push({ label: x.test.label, x: q[0], y: q[1] });
    }
    for (const f of analysis.feeds) {
      const q = place(f.pieceId);
      if (q) out.feeds.push({ label: f.label, role: f.role, x: q[0], y: q[1] });
    }
    return out;
  }
  // The marks as SVG, with their colours written in, so the same drawing works on screen and on paper.
  // size scales the labels (1 = 24 mm circles), so they stay readable when zoomed out.
  function svg(m, size = 1) {
    const n = v => v.toFixed(1),
      s = Number.isFinite(size) && size > 0 ? size.toFixed(3) : 1,
      font = 'font-family="system-ui, sans-serif" font-weight="700" font-size="22" text-anchor="middle" fill="#20242b"';
    return (
      m.weak
        .map(
          w =>
            `<polyline points="${w.points.map(p => n(p[0]) + ',' + n(p[1])).join(' ')}" fill="none" stroke="#ffb020" stroke-opacity="0.3" stroke-width="${n(w.width)}" stroke-linecap="round" stroke-linejoin="round"/>`
        )
        .join('') +
      m.points
        .map(
          p =>
            `<g transform="translate(${n(p.x)} ${n(p.y)}) scale(${s})"><rect x="-21" y="-13" width="42" height="26" rx="13" fill="#fff" stroke="#20242b" stroke-width="3"/><text y="7" ${font}>${p.label}</text></g>`
        )
        .join('') +
      m.feeds
        .map(
          f =>
            `<g transform="translate(${n(f.x)} ${n(f.y)}) scale(${s})"><circle r="24" fill="${f.role === 'base' ? '#f2994a' : '#f2c94c'}" stroke="#20242b" stroke-width="4"/><text y="8" ${font}>${f.label}</text></g>`
        )
        .join('')
    );
  }

  return {
    RULES,
    MAX_DROP,
    empty,
    settings,
    prune,
    used,
    kind,
    rules,
    mark,
    role,
    analyse,
    results,
    reading,
    marks,
    svg,
  };
});
