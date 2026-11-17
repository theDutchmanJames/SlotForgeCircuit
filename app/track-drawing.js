(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./core.js'), require('./track-exports.js'));
  else root.TrackDrawing = factory(root.Forge, root.TrackExports);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F, XM) {
  'use strict';
  const G = F.G,
    NS = 'http://www.w3.org/2000/svg';
  function transform(p) {
    return `translate(${p.x} ${p.y}) rotate(${p.angle}) scale(1 ${p.flip ? -1 : 1})`;
  }
  const drawBody = F.drawBody;
  function measurementBounds(bounds, planning) {
    let [x, y, w, h] = bounds,
      x2 = x + w,
      y2 = y + h;
    for (const m of planning?.measurements || [])
      if (m.print)
        for (const p of [m.a, m.b]) {
          x = Math.min(x, p[0] - 100);
          y = Math.min(y, p[1] - 60);
          x2 = Math.max(x2, p[0] + 100);
          y2 = Math.max(y2, p[1] + 60);
        }
    return [x, y, x2 - x, y2 - y];
  }
  function pdfDiagram(raw) {
    const model = XM.build(raw),
      table = model.routed.sections || model.routed.planningSections ? model.layout.workspace?.spaceGuide : null,
      b = measurementBounds(F.Routed.tableBounds(model.summary.bounds, table), model.layout.workspace?.planning),
      limit = 2400,
      pad = 30,
      scale = (limit - pad * 2) / Math.max(b[2], b[3], 1),
      width = Math.max(1, Math.ceil(b[2] * scale + pad * 2)),
      height = Math.max(1, Math.ceil(b[3] * scale + pad * 2));
    const scene =
      F.Routed.drawTable(table, true) +
      model.pieces
        .map(p => `<g transform="${transform(p)}">${drawBody(model.definitions[p.definitionId], true)}</g>`)
        .join('') +
      F.Planning.draw(model.layout.workspace?.planning, true);
    return {
      width,
      height,
      svg: `<svg xmlns="${NS}" width="${width}" height="${height}" viewBox="${b[0] - pad / scale} ${b[1] - pad / scale} ${width / scale} ${height / scale}">${scene}</svg>`,
    };
  }
  return { body: drawBody, pdfDiagram };
});
