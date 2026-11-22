// Routed Wood, the joinery bench: groups the profile fields with one-line summaries, offers
// starting profiles, draws the board in cross-section from the form, and turns the layout
// starters into tiles. The profile form, its checks and Apply stay in routed-editor.js.
(function (root) {
  'use strict';
  const $ = id => document.getElementById(id);
  const GROUPS = [
    ['lanes', 'Lanes', ['laneCount', 'laneSpacingMm', 'innerClearanceMm', 'outerClearanceMm']],
    ['slot', 'Slot', ['slotWidthMm', 'slotDepthMm', 'minRadiusMm']],
    [
      'conductors',
      'Conductors',
      [
        'conductorWidthMm',
        'conductorGapMm',
        'recessDepthMm',
        'conductorThicknessMm',
        'adhesiveThicknessMm',
        'allowancePct',
      ],
    ],
    ['board', 'Board', ['boardThicknessMm']],
  ];
  // Starting points, not standards: everything stays editable before Apply.
  const PRESETS = [
    {
      id: 'home',
      name: 'Home 1:32',
      note: '2 lanes · braid',
      values: {
        laneCount: 2,
        laneSpacingMm: 100,
        innerClearanceMm: 100,
        outerClearanceMm: 100,
        slotWidthMm: 3.2,
        slotDepthMm: 8,
        minRadiusMm: 250,
        conductor: 'braid',
        conductorWidthMm: 6,
        conductorGapMm: 1,
        recessDepthMm: 0.8,
        boardThicknessMm: 12,
      },
    },
    {
      id: 'club',
      name: 'Club 1:32',
      note: '4 lanes · braid',
      values: {
        laneCount: 4,
        laneSpacingMm: 100,
        innerClearanceMm: 120,
        outerClearanceMm: 150,
        slotWidthMm: 3.2,
        slotDepthMm: 8,
        minRadiusMm: 300,
        conductor: 'braid',
        conductorWidthMm: 6,
        conductorGapMm: 1,
        recessDepthMm: 0.8,
        boardThicknessMm: 18,
      },
    },
    {
      id: 'tape',
      name: 'Tape 1:32',
      note: '2 lanes · copper tape',
      values: {
        laneCount: 2,
        laneSpacingMm: 100,
        innerClearanceMm: 100,
        outerClearanceMm: 100,
        slotWidthMm: 3.2,
        slotDepthMm: 8,
        minRadiusMm: 250,
        conductor: 'tape',
        conductorWidthMm: 6,
        conductorGapMm: 1,
        recessDepthMm: 0,
        boardThicknessMm: 12,
      },
    },
    {
      id: 'large',
      name: '1:24 club',
      note: '4 lanes · braid',
      values: {
        laneCount: 4,
        laneSpacingMm: 115,
        innerClearanceMm: 150,
        outerClearanceMm: 180,
        slotWidthMm: 3.5,
        slotDepthMm: 10,
        minRadiusMm: 400,
        conductor: 'braid',
        conductorWidthMm: 8,
        conductorGapMm: 1,
        recessDepthMm: 0.8,
        boardThicknessMm: 18,
      },
    },
  ];
  const num = (f, key) => Number(f[key]?.value);
  const trim = v => String(Math.round(v * 100) / 100);

  function summary(id, f) {
    if (id === 'lanes') {
      const n = num(f, 'laneCount');
      return n + (n === 1 ? ' lane' : ' lanes') + (n > 1 ? ' · ' + trim(num(f, 'laneSpacingMm')) + ' mm apart' : '');
    }
    if (id === 'slot') return trim(num(f, 'slotWidthMm')) + ' × ' + trim(num(f, 'slotDepthMm')) + ' mm';
    if (id === 'conductors')
      return (
        (f.conductor.value === 'tape' ? 'copper tape ' : 'recessed braid ') + trim(num(f, 'conductorWidthMm')) + ' mm'
      );
    return trim(num(f, 'boardThicknessMm')) + ' mm · ' + (f.constructionMode.value === 'table' ? 'tabletop' : 'pieces');
  }

  // The board cut across the lanes: slots, braid recesses or tape, clearances and thickness.
  function section(f) {
    // Drawn while typing, before the profile is checked: a lane count outside 1–8 (say a
    // mistyped 99999999) would otherwise build that many slots and run the page out of memory.
    const lanes = num(f, 'laneCount'),
      n = Number.isInteger(lanes) && lanes >= 1 && lanes <= 8 ? lanes : NaN,
      spacing = num(f, 'laneSpacingMm'),
      inner = num(f, 'innerClearanceMm'),
      outer = num(f, 'outerClearanceMm'),
      t = num(f, 'boardThicknessMm'),
      sw = num(f, 'slotWidthMm'),
      sd = Math.min(num(f, 'slotDepthMm'), t),
      cw = num(f, 'conductorWidthMm'),
      gap = num(f, 'conductorGapMm'),
      recess = num(f, 'recessDepthMm'),
      tape = f.conductor.value === 'tape',
      width = inner + spacing * (n - 1) + outer;
    if (![n, spacing, inner, outer, t, sw, sd, cw, gap, recess, width].every(Number.isFinite) || width <= 0 || t <= 0)
      return { svg: '<p class="rb-meta">Enter the profile to draw the board.</p>', scale: '' };
    const left = 30,
      top = 54,
      sx = 680 / width,
      sy = Math.max(sx, Math.min(110 / t, sx * 30)),
      X = mm => left + mm * sx,
      Y = mm => top + mm * sy,
      copper = '#c47a35',
      parts = [];
    parts.push(`<rect class="rb-wood" x="${X(0)}" y="${Y(0)}" width="${width * sx}" height="${t * sy}" rx="2"/>`);
    const centres = Array.from({ length: n }, (_, i) => inner + i * spacing);
    for (const c of centres) {
      parts.push(
        `<rect class="rb-cut" x="${X(c - sw / 2)}" y="${Y(0) - 1}" width="${Math.max(2, sw * sx)}" height="${sd * sy + 1}"/>`
      );
      for (const side of [-1, 1]) {
        const start = side < 0 ? c - sw / 2 - gap - cw : c + sw / 2 + gap;
        if (tape) parts.push(`<rect x="${X(start)}" y="${Y(0) - 3}" width="${cw * sx}" height="3" fill="${copper}"/>`);
        else if (recess > 0)
          parts.push(
            `<rect x="${X(start)}" y="${Y(0)}" width="${cw * sx}" height="${Math.max(2, recess * sy)}" fill="${copper}"/>`
          );
      }
    }
    // Spacing along the top.
    const marks = [0, ...centres, width];
    let dims = '';
    for (let i = 0; i < marks.length - 1; i++) {
      const a = X(marks[i]),
        b = X(marks[i + 1]);
      dims += `<path d="M${a} 24v12M${b} 24v12M${a} 30H${b}"/>`;
      if (b - a > 44)
        dims += `<text x="${(a + b) / 2}" y="20" text-anchor="middle">${trim(marks[i + 1] - marks[i])} mm</text>`;
    }
    const right = X(width) + 14;
    dims += `<path d="M${right - 5} ${Y(0)}h10M${right - 5} ${Y(t)}h10M${right} ${Y(0)}V${Y(t)}"/><text x="${right + 10}" y="${(Y(0) + Y(t)) / 2 + 4}">${trim(t)} mm</text>`;
    const notes = [
      `<path d="M${X(centres[0])} ${Y(sd) + 2}L${X(centres[0]) + 24} ${Y(t) + 30}"/><text x="${X(centres[0]) + 28}" y="${Y(t) + 34}">slot ${trim(sw)} × ${trim(sd)} mm</text>`,
    ];
    const last = centres[centres.length - 1] + sw / 2 + gap + cw / 2;
    notes.push(
      `<path d="M${X(last)} ${Y(0) + 2}L${X(last) + 24} ${Y(t) + 52}"/><text x="${X(last) + 28}" y="${Y(t) + 56}">${tape ? 'tape ' + trim(cw) + ' mm, on the surface' : 'braid ' + trim(cw) + ' × ' + trim(recess) + ' mm'}</text>`
    );
    const height = Y(t) + 66,
      ratio = sy / sx;
    return {
      svg: `<svg class="rb-section-svg" viewBox="0 0 800 ${Math.ceil(height)}" role="img" aria-label="The board in cross-section: ${n} slots, ${trim(t)} mm board">${parts.join('')}<g class="rb-dim">${dims}</g><g class="rb-note">${notes.join('')}</g></svg>`,
      scale: ratio > 1.2 ? 'depth drawn ×' + Math.round(ratio) + ' · width to scale' : 'to scale',
    };
  }

  function mount() {
    const form = $('routed-profile-form'),
      f = form.elements,
      groups = $('routed-groups');
    // Apply checks every field. One that is wrong inside a folded group could not be shown, so
    // Apply seemed to do nothing: unfold its group so the browser can point at it.
    form.addEventListener(
      'invalid',
      e => {
        const group = e.target.closest('details');
        if (group && !group.open) group.open = true;
      },
      true
    );
    // Fields into four folding groups, each with a one-line summary.
    for (const [id, title, keys] of GROUPS) {
      const box = document.createElement('details');
      box.className = 'rb-group';
      box.dataset.group = id;
      box.open = id === 'lanes' || id === 'slot';
      const head = document.createElement('summary'),
        name = document.createElement('b'),
        line = document.createElement('span');
      name.textContent = title;
      line.className = 'rb-summary';
      line.dataset.units = 'raw';
      head.append(name, line);
      box.append(head);
      for (const key of keys) {
        const label = f[key]?.closest('label');
        if (label) {
          label.classList.add('rb-field');
          box.append(label);
        }
      }
      for (const extra of form.querySelectorAll(`[data-group="${id}"]`)) box.append(extra);
      groups.append(box);
    }
    // Starting profiles.
    const presets = $('routed-presets');
    for (const p of PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rb-preset';
      b.dataset.preset = p.id;
      const name = document.createElement('b'),
        note = document.createElement('span');
      name.textContent = p.name;
      note.textContent = p.note;
      b.append(name, note);
      b.onclick = () => {
        for (const [key, value] of Object.entries(p.values)) if (f[key]) f[key].value = String(value);
        form.dispatchEvent(new Event('input', { bubbles: true }));
        $('routed-profile-error').textContent = '';
      };
      presets.append(b);
    }
    // Layout starters as tiles: the flowing example and FreeForm buttons are added by their editors.
    const start = $('rb-start'),
      tile = (id, title, text) => {
        const b = $(id);
        if (!b) return;
        b.className = 'rb-tile';
        b.replaceChildren();
        const t = document.createElement('b'),
          s = document.createElement('span');
        t.textContent = title;
        s.textContent = text;
        b.append(t, s);
        start.append(b);
      };
    tile('routed-new-layout', 'Empty table', 'place sections by hand');
    tile('routed-example', 'Routed oval', 'an example to change');
    tile('routed-flowing-example', 'Flowing circuit', 'an example with S-bends');
    tile('freeform-open', 'Draw it', 'one slot in FreeForm');
    tile('routed-add-section', '＋ One section', 'straight, corner or S-bend');
    for (const p of start.querySelectorAll(':scope > p')) p.remove();
    // Summaries, the drawing and which profile matches, on every change.
    const update = () => {
      for (const box of groups.children) box.querySelector('.rb-summary').textContent = summary(box.dataset.group, f);
      const drawn = section(f);
      $('rb-section').innerHTML = drawn.svg;
      $('rb-section-scale').textContent = drawn.scale;
      for (const b of presets.children) {
        const p = PRESETS.find(x => x.id === b.dataset.preset);
        b.setAttribute(
          'aria-pressed',
          String(Object.entries(p.values).every(([k, v]) => f[k] && String(f[k].value) === String(v)))
        );
      }
    };
    // Changed but not applied yet: say so beside Apply.
    const pending = document.createElement('p');
    pending.className = 'rb-pending';
    pending.id = 'rb-pending';
    pending.textContent = 'Not applied yet';
    pending.hidden = true;
    form.querySelector('button[type=submit]').before(pending);
    const changed = () => {
      pending.hidden = false;
      update();
    };
    form.addEventListener('input', changed);
    form.addEventListener('change', changed);
    form.addEventListener('submit', () => setTimeout(() => (pending.hidden = !$('routed-profile-error').textContent)));
    addEventListener('hashchange', () => {
      if (location.hash !== '#routed') return;
      setTimeout(() => {
        pending.hidden = true;
        update();
      });
    });
    update();
    return { update };
  }
  root.RoutedBench = { mount, section, PRESETS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
