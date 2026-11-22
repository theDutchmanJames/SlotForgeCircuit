(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlanningData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const finite = (v, min, max) => Number.isFinite(v) && v >= min && v <= max,
    point = p => Array.isArray(p) && p.length === 2 && p.every(v => finite(v, -1000000, 1000000));
  function validate(raw) {
    if (raw == null) return { version: 1, measurements: [], owned: {} };
    if (
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      raw.version !== 1 ||
      Object.keys(raw).some(k => !['version', 'measurements', 'owned', 'reference'].includes(k))
    )
      throw Error('Unsupported planning tools data.');
    if (!Array.isArray(raw.measurements) || raw.measurements.length > 100)
      throw Error('At most 100 measurements are supported.');
    const ids = new Set(),
      measurements = raw.measurements.map(m => {
        if (
          !m ||
          typeof m.id !== 'string' ||
          !/^[-\w]{1,100}$/.test(m.id) ||
          ids.has(m.id) ||
          !point(m.a) ||
          !point(m.b) ||
          typeof m.label !== 'string' ||
          m.label.length > 100 ||
          typeof m.print !== 'boolean'
        )
          throw Error('Invalid measurement.');
        ids.add(m.id);
        return { id: m.id, a: m.a.slice(), b: m.b.slice(), label: m.label, print: m.print };
      });
    if (!raw.owned || typeof raw.owned !== 'object' || Array.isArray(raw.owned) || Object.keys(raw.owned).length > 2000)
      throw Error('Invalid owned-pieces inventory.');
    const owned = Object.create(null);
    for (const [k, v] of Object.entries(raw.owned)) {
      if (k.length > 250 || !Number.isInteger(v) || v < 0 || v > 100000)
        throw Error('Owned quantities must be whole numbers from 0 to 100,000.');
      owned[k] = v;
    }
    let reference;
    if (raw.reference != null) {
      const r = raw.reference;
      if (
        !r ||
        typeof r.image !== 'string' ||
        r.image.length > 2000000 ||
        !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(r.image) ||
        !point([r.x, r.y]) ||
        !finite(r.widthMm, 1, 50000) ||
        !finite(r.heightMm, 1, 50000) ||
        !finite(r.opacity, 0.05, 1) ||
        !finite(r.angle, -360, 360) ||
        typeof r.visible !== 'boolean'
      )
        throw Error('Invalid reference image or calibration.');
      reference = {
        image: r.image,
        x: r.x,
        y: r.y,
        widthMm: r.widthMm,
        heightMm: r.heightMm,
        opacity: r.opacity,
        angle: r.angle,
        visible: r.visible,
      };
    }
    return { version: 1, measurements, owned, ...(reference ? { reference } : {}) };
  }
  function measurement(m) {
    const dx = m.b[0] - m.a[0],
      dy = m.b[1] - m.a[1];
    return { lengthMm: Math.hypot(dx, dy), angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI, dx, dy };
  }
  function draw(data, print = false) {
    return (data?.measurements || [])
      .filter(m => !print || m.print)
      .map(m => {
        const q = measurement(m),
          esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
          text = (m.label ? m.label + ' · ' : '') + q.lengthMm.toFixed(1) + ' mm · ' + q.angleDeg.toFixed(1) + '°',
          color = print ? '#222' : '#38b9e8';
        return `<g pointer-events="none"><path d="M ${m.a} L ${m.b}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/><circle cx="${m.a[0]}" cy="${m.a[1]}" r="5" fill="${color}"/><circle cx="${m.b[0]}" cy="${m.b[1]}" r="5" fill="${color}"/><text x="${(m.a[0] + m.b[0]) / 2}" y="${(m.a[1] + m.b[1]) / 2 - 15}" text-anchor="middle" font-size="24" fill="${color}">${esc(text)}</text></g>`;
      })
      .join('');
  }
  function image(data) {
    const r = data?.reference;
    if (!r?.visible) return '';
    return `<image href="${r.image}" x="0" y="0" width="${r.widthMm}" height="${r.heightMm}" opacity="${r.opacity}" transform="translate(${r.x} ${r.y}) rotate(${r.angle})" pointer-events="none"/>`;
  }
  // Undo snapshots: a reference picture can be 2 MB, so each one is kept once here and the
  // snapshot text holds a short token in its place. Equal pictures give equal tokens, so
  // comparing two snapshots still tells whether anything changed.
  const pictures = new Map(),
    tokens = new Map();
  function snapshotText(value) {
    return JSON.stringify(value, (key, v) => {
      if (key !== 'image' || typeof v !== 'string' || !v.startsWith('data:image/')) return v;
      let token = tokens.get(v);
      if (!token) {
        token = 'picture:' + tokens.size;
        tokens.set(v, token);
        pictures.set(token, v);
      }
      return token;
    });
  }
  function snapshotValue(text) {
    return JSON.parse(text, (key, v) =>
      key === 'image' && typeof v === 'string' && pictures.has(v) ? pictures.get(v) : v
    );
  }
  return { validate, measurement, draw, image, snapshotText, snapshotValue };
});
