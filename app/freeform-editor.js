(function (root) {
  'use strict';
  function init(h) {
    const F = root.Forge,
      FF = F.FreeForm,
      R = F.Routed,
      $ = id => document.getElementById(id),
      NS = 'http://www.w3.org/2000/svg';
    const entry = document.createElement('button');
    entry.id = 'freeform-open';
    entry.className = 'btn';
    entry.textContent = 'FreeForm Drawing';
    $('routed-add-section').after(entry);
    const intro = document.createElement('p');
    intro.className = 'fine';
    intro.textContent = 'FreeForm: draw one continuous slot on your table, then generate the other lanes around it.';
    entry.after(intro);
    const editButton = document.createElement('button');
    editButton.id = 'edit-freeform';
    editButton.className = 'btn small';
    editButton.textContent = 'Edit FreeForm…';
    editButton.hidden = true;
    document.querySelector('.canvas-top').append(editButton);
    let editorActive = false,
      baseKey = null,
      cleanSnapshot = null;
    const builderKey = () => {
      const s = h.get();
      return JSON.stringify([
        s.title,
        s.table,
        s.settings,
        s.state,
        s.planning,
        s.items.map(p => [p, s.defs[p.definitionId].parameters]),
      ]);
    };
    const dialog = document.createElement('section');
    dialog.id = 'freeform-dialog';
    // Pit Board (as in the Track Builder): the name and its facts, the checks, the drawing modes and
    // tools in one bar; Undo / Redo, Cancel and the one main answer on the right.
    dialog.innerHTML = `<div class="ff-header pitboard"><div class="pb-name"><label class="title-label"><span class="track-name-label">FreeForm drawing · track name</span><input id="ff-name" maxlength="100" aria-label="Track name"></label><span id="ff-facts" class="pb-facts" aria-live="polite"></span></div><button type="button" id="ff-status" class="ff-checks-pill" aria-label="View track checks"></button><div class="toolbar pb-tools ff-toolbar" role="toolbar" aria-label="Drawing tools"><div class="ff-modes" role="group" aria-label="Drawing mode"><button type="button" id="ff-draw" title="Draw: click to add points, drag to bend (D)">Draw</button><button type="button" id="ff-edit" title="Edit: drag points and their handles (E)">Edit</button><button type="button" id="ff-insert" title="Insert: click the slot to add a point (I)">Insert</button></div><div class="pb-grp ff-shape"><span class="pb-gl">Shape</span><button class="btn" id="ff-close" title="Join the last point to the first">Close loop</button><button class="btn" id="ff-reopen" title="Open the loop to draw on">Reopen loop</button></div><button type="button" class="btn toggle" id="ff-snap" aria-pressed="false" title="Snap points to a 10 mm grid while drawing and dragging">Snap 10 mm</button></div><div class="spacer"></div><button class="btn ghost icon" id="ff-undo" title="Undo (Ctrl+Z)" aria-label="Undo">↶</button><button class="btn ghost icon" id="ff-redo" title="Redo (Ctrl+Y)" aria-label="Redo">↷</button><div class="menu-anchor"><button type="button" class="btn ghost icon" id="ff-history" title="Undo history" aria-label="Undo history" aria-haspopup="menu" aria-expanded="false" aria-controls="ff-history-menu">▾</button><div id="ff-history-menu" class="menu-popover undo-menu" role="menu" aria-labelledby="ff-history" hidden></div></div><button class="btn" id="ff-cancel">Cancel</button><button class="btn primary" id="ff-apply" title="Save the drawing and use it in the Track Builder">Use in builder</button></div>
 <p id="ff-context-note" class="fine" role="status" hidden></p>
 <div class="ff-body"><aside class="ff-settings" aria-label="FreeForm settings">
 <div class="ff-sidebar-heading">
 <div class="ff-tabs ff-rail" role="tablist" aria-label="FreeForm settings" aria-orientation="vertical">${[
   ['points', 'Point', '<circle cx="12" cy="12" r="3"/><path d="M3 12h5M16 12h5M12 3v5M12 16v5"/>'],
   ['lanes', 'Lanes', '<path d="M6 3c0 6 4 6 4 18M12 3c0 6 4 6 4 18M18 3c0 6 4 6 4 18" transform="translate(-3 0)"/>'],
   ['table', 'Table and routing', '<rect x="3" y="6" width="18" height="10" rx="1.5"/><path d="M6 16v4M18 16v4"/>'],
   [
     'checks',
     'Checks and lane lengths',
     '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>',
   ],
 ]
   .map(
     ([id, label, icon]) =>
       '<button type="button" id="ff-tab-' +
       id +
       '" role="tab" aria-controls="ff-panel-' +
       id +
       '" aria-selected="' +
       (id === 'points') +
       '" tabindex="' +
       (id === 'points' ? 0 : -1) +
       '" aria-label="' +
       label +
       '" title="' +
       label +
       '"><svg class="bl-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
       icon +
       '</svg>' +
       (id === 'checks' ? '<span id="ff-checks-badge" class="ff-rail-badge" hidden></span>' : '') +
       '</button>'
   )
   .join(
     ''
   )}</div><button type="button" class="ff-rail-hide" id="ff-hide-settings" title="Hide the settings (H)" aria-label="Hide the settings"><svg class="bl-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/><path d="m9 10 2 2-2 2"/></svg></button></div>
 <div class="ff-panel-scroll">
 <section id="ff-panel-points" role="tabpanel" aria-labelledby="ff-tab-points" tabindex="0">
 <h3>Shape your drawing</h3><p id="ff-point-intro" class="fine">Draw on the canvas, then choose a point to adjust its shape, height or following stretch.</p>
 <div class="ff-point-nav"><button type="button" class="btn ghost sm icon" id="ff-prev-point" aria-label="Previous point" title="Previous point">‹</button><select id="ff-anchor-choice" aria-label="Selected point"></select><button type="button" class="btn ghost sm icon" id="ff-next-point" aria-label="Next point" title="Next point">›</button></div>
 <p id="ff-point-label" class="ff-context" aria-live="polite"></p>
 <div id="ff-point-controls" hidden>
 <div class="form-grid ff-point-grid"><label>X · mm<input id="ff-x" type="number" step="any"></label><label>Y · mm<input id="ff-y" type="number" step="any"></label><label title="Surface height above the table (zero is table level). Height changes gradually between points; bridge clearance is in Table.">Height · mm<input id="ff-height" type="number" min="-5000" max="5000" step="any"></label></div><button class="btn small" id="ff-position" hidden>Set position</button><button class="btn small" id="ff-set-height" hidden>Apply height</button><p id="ff-origin" class="fine" hidden></p>
 <div class="ff-actions ff-point-actions"><button class="btn small" id="ff-smooth" title="Let Circuit bend this point smoothly">Smooth</button><button class="btn small" id="ff-straight" title="Straighten the stretch to the next point">Straight</button><button class="btn small" id="ff-lock">Lock</button><button class="btn small danger" id="ff-delete">Delete</button></div>
 <label class="check"><input id="ff-linked" type="checkbox"> Keep handles aligned</label>
 <details><summary>Exact handle offsets · mm</summary><div class="form-grid">${[
   ['in-x', 'Incoming X'],
   ['in-y', 'Incoming Y'],
   ['out-x', 'Outgoing X'],
   ['out-y', 'Outgoing Y'],
 ]
   .map(([k, label]) => '<label>' + label + '<input id="ff-' + k + '" type="number" step="any"></label>')
   .join('')}</div><button class="btn small" id="ff-handles">Set handles</button></details>
 <details><summary>Lane spacing — next stretch</summary><p class="fine">Squeeze lanes closer or spread them apart toward the midpoint, then return to normal spacing at the end. Your drawn lane stays fixed.</p><div class="ff-seg" id="ff-squeeze-seg" role="group" aria-label="Lane spacing from this point"><button type="button" data-squeeze="normal">Normal</button><button type="button" data-squeeze="squeeze">Squeeze</button><button type="button" data-squeeze="spread">Spread</button></div><label class="field" hidden>Adjustment<select id="ff-squeeze-mode"><option value="squeeze">Squeeze — bring lanes closer</option><option value="spread">Spread — move lanes apart</option></select></label><p id="ff-squeeze-note" class="ff-context"></p><label class="field">Target spacing at midpoint · mm<input id="ff-squeeze-spacing" type="number" min="1" max="300" step="any"></label><div class="ff-actions"><button class="btn small" id="ff-squeeze-apply">Apply spacing</button><button class="btn small" id="ff-squeeze-remove">Reset this stretch</button></div></details>
 </div></section>
 <section id="ff-panel-lanes" role="tabpanel" aria-labelledby="ff-tab-lanes" tabindex="0" hidden>
 <h3>Build your lanes</h3><p class="fine">Start with one drawn lane. Add lanes alongside it when you’re ready.</p>
 <div class="form-grid"><label>Total lanes<span class="ff-stepper"><button type="button" id="ff-count-down" aria-label="One lane fewer">−</button><input id="ff-count" type="number" min="1" max="8" step="1"><button type="button" id="ff-count-up" aria-label="One lane more">＋</button></span></label><label>Your drawn lane<select id="ff-reference"></select></label></div><label class="field">Normal lane spacing · mm<input id="ff-spacing" type="number" min="10" max="300" step="any"></label><div class="field ff-side-field"><span>Higher lane numbers go</span><div class="ff-seg" id="ff-side-seg" role="group" aria-label="Higher lane numbers go"><button type="button" data-side="-1">Left</button><button type="button" data-side="1">Right</button></div><select id="ff-side" hidden aria-hidden="true" tabindex="-1"><option value="1">Right of drawing direction</option><option value="-1">Left of drawing direction</option></select><small>of the drawing direction</small></div><p class="fine">The blue lane stays in place. The arrow on it shows drawing direction.</p><button class="btn ff-wide" id="ff-generate">Apply lane settings</button>
 <details><summary>Numbering &amp; lane spacing</summary><p class="fine">Reverse labels without moving the lanes.</p><button class="btn small" id="ff-reverse">Reverse numbering</button><p class="fine">To squeeze or spread a stretch, select its start point in Points. Restore normal spacing everywhere below.</p><button class="btn small" id="ff-squeeze-all">Reset all lane spacing</button></details></section>
 <section id="ff-panel-table" role="tabpanel" aria-labelledby="ff-tab-table" tabindex="0" hidden>
 <h3>Table &amp; construction</h3><p class="fine">Set the space available for your circuit.</p><div class="form-grid"><label>Table length · mm<input id="ff-table-length" type="number" min="10" max="50000"></label><label>Table width · mm<input id="ff-table-width" type="number" min="10" max="50000"></label></div><div id="ff-table-shape"></div>
 <details><summary>Routing dimensions</summary><p class="fine">Set edge clearances, board and slot dimensions for your build.</p><div id="ff-profile" class="form-grid"></div><label class="field">Conductors<select id="ff-conductor"><option value="braid">Recessed braid</option><option value="tape">Surface copper tape</option></select></label></details><button class="btn ff-wide" id="ff-construction">Apply table &amp; routing settings</button>
 <details><summary>Bridge clearance</summary><div class="form-grid"><label>Deck thickness · mm<input id="ff-deck" type="number" min="0.1" max="500" step="any"></label><label>Required clearance · mm<input id="ff-clearance" type="number" min="0" max="1000" step="any"></label></div><p class="fine">Measured from the lower driving surface to the upper deck underside. Set point heights in Points.</p><button class="btn small" id="ff-elevation-settings">Apply clearance settings</button><p class="fine">Lengths are measured in plan view. Ramp shape and buildability are not checked.</p></details></section>
 <section id="ff-panel-checks" role="tabpanel" aria-labelledby="ff-tab-checks" tabindex="0" hidden><h3>Lane lengths</h3><div id="ff-lengths"></div><h3>Track checks</h3><p class="fine">Review your layout before using it in the builder.</p><p id="ff-check-summary" class="ff-context"></p><ul id="ff-issues" aria-live="polite"></ul><div id="ff-elevation" class="elevation-profile"></div><details><summary>Saving your drawing</summary><p class="fine">Save &amp; use in builder applies your drawing. Then choose Save to Track Library in the builder to keep it.</p><p class="fine">Your draft stays here while you visit other editor pages. Save before reloading or opening the Track Packs catalogue. Cancel discards this editing session.</p></details></section>
 </div><div class="ff-sidebar-footer"><p id="ff-error" class="error" role="alert"></p></div></aside>
 <div class="ff-stage"><svg id="ff-canvas" tabindex="0" aria-label="FreeForm canvas. Draw or edit anchors and their direction handles."><defs><pattern id="ff-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 H 0 V 50" fill="none" stroke="var(--line)" stroke-width=".7"/></pattern></defs><rect id="ff-background" fill="url(#ff-grid)"/><g id="ff-scene"></g><path id="ff-ghost" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="8 5"/><g id="ff-nodes"></g></svg><div id="ff-start" class="ff-start-card" hidden><h3>Draw your first slot</h3><p data-condensed="true">Click the table to place points, drag while clicking to bend, and click the first point to close the loop. Or start from a shape.</p><div class="ff-start-actions"><button class="btn" id="ff-oval">Oval</button><button class="btn" id="ff-eight" title="A figure eight with a bridge over the crossing">Figure eight</button><button class="btn" id="ff-start-reference" title="Trace over a picture or plan of your table">Reference image…</button></div></div><div class="ff-canvas-bottom"><p id="ff-help">Click to add smooth points; drag to set direction handles. Click the first point or Close loop to finish. Space + drag pans; wheel zooms.</p><div class="zoom-controls ff-zoom"><button class="btn square" id="ff-zoom-out" aria-label="Zoom out">−</button><span id="ff-zoom-level">100%</span><button class="btn square" id="ff-zoom-in" aria-label="Zoom in">＋</button><button class="btn" id="ff-fit">Fit table</button><button class="btn" id="ff-fit-selection" title="Zoom to the selected points (F)" aria-label="Zoom to selection"><svg class="bl-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg></button><button class="btn square" id="ff-canvas-only" title="Full canvas: hide the settings (H)" aria-label="Full canvas" aria-pressed="false"><svg class="bl-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button></div></div><button type="button" class="edge-tab edge-right" id="ff-show-settings" aria-label="Show the settings" title="Show the settings" hidden>‹</button></div></div>`;
    // Use the same folder shell as the Track Builder catalogue.
    for (const folder of dialog.querySelectorAll('.ff-settings details')) {
      folder.classList.add('catalogue-folder');
      const contents = document.createElement('div');
      contents.className = 'ff-folder-content';
      for (const child of [...folder.childNodes]) if (child.nodeName !== 'SUMMARY') contents.append(child);
      folder.append(contents);
    }
    $('freeform-view').append(dialog);
    const panelNames = ['points', 'lanes', 'table', 'checks'];
    function showPanel(name, focus = false) {
      for (const key of panelNames) {
        const active = key === name,
          tab = $('ff-tab-' + key);
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        $('ff-panel-' + key).hidden = !active;
        if (active && focus) tab.focus();
      }
      dialog.querySelector('.ff-panel-scroll').scrollTop = 0;
    }
    for (const [i, name] of panelNames.entries()) {
      const tab = $('ff-tab-' + name);
      tab.onclick = () => showPanel(name);
      tab.onkeydown = e => {
        const next =
          e.key === 'ArrowRight'
            ? (i + 1) % 4
            : e.key === 'ArrowLeft'
              ? (i + 3) % 4
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? 3
                  : null;
        if (next !== null) {
          e.preventDefault();
          showPanel(panelNames[next], true);
        }
      };
    }
    $('ff-status').onclick = () => showPanel('checks', true);
    const tableHost = $('ff-table-shape');
    const tableShape = root.TableShapeEditor.init(
      'ff-base',
      tableHost,
      () => ({ lengthMm: Number($('ff-table-length').value), widthMm: Number($('ff-table-width').value) }),
      {
        setSize: s => {
          $('ff-table-length').value = s.lengthMm;
          $('ff-table-width').value = s.widthMm;
        },
        boardMode: active => {
          for (const id of ['ff-table-length', 'ff-table-width']) $(id).readOnly = active;
        },
        track: () =>
          model
            ? '<g transform="translate(' +
              -table.x +
              ' ' +
              -table.y +
              ')">' +
              FF.draw(FF.definition(model, profile)) +
              '</g>'
            : '',
      }
    );
    for (const id of ['ff-table-length', 'ff-table-width']) $(id).addEventListener('input', tableShape.render);
    const fields = [
      ['innerClearanceMm', 'Lane 1 table clearance', 10, 1000],
      ['outerClearanceMm', 'Last lane table clearance', 10, 1000],
      ['minRadiusMm', 'Preferred slot radius', 10, 3000],
      ['boardThicknessMm', 'Board thickness', 3, 50],
      ['slotWidthMm', 'Slot width', 0.5, 10],
      ['slotDepthMm', 'Slot depth', 1, 30],
      ['conductorWidthMm', 'Conductor width', 1, 20],
      ['conductorGapMm', 'Conductor gap', 0, 15],
      ['conductorThicknessMm', 'Conductor thickness', 0.01, 5],
      ['adhesiveThicknessMm', 'Adhesive thickness', 0, 3],
      ['recessDepthMm', 'Braid recess depth', 0, 8],
      ['allowancePct', 'Conductor allowance · %', 0, 100],
    ];
    for (const [key, label, min, max] of fields) {
      const l = document.createElement('label');
      l.textContent = label + (key === 'allowancePct' ? '' : ' · mm');
      const input = document.createElement('input');
      Object.assign(input, { id: 'ff-profile-' + key, type: 'number', min, max, step: 'any' });
      l.append(input);
      $('ff-profile').append(l);
    }
    let planning = F.Planning.validate(),
      advanced = null;
    let editorOffset = [0, 0],
      model = null,
      profile = null,
      table = null,
      source = null,
      mark = null,
      selected = null,
      selectedIds = [],
      lastDrawDown = null,
      mode = 'draw',
      view = { x: 0, y: 0, w: 3400, h: 2000 },
      gesture = null,
      dragFrame = 0,
      referenceLayer = null,
      space = false,
      history = [],
      future = [],
      draft = null,
      pendingSqueeze = null;
    // Snap to grid: points land on a 10 mm grid while drawing and dragging (remembered).
    let snapOn = false;
    try {
      snapOn = localStorage.getItem('slotforge.ff-snap.v1') === 'true';
    } catch {}
    const SNAP_MM = 10,
      snap = p => (snapOn ? p.map(v => Math.round(v / SNAP_MM) * SNAP_MM) : p);
    const svg = $('ff-canvas'),
      create = (tag, attrs, parent) => {
        const el = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        parent?.append(el);
        return el;
      },
      node = () => model.nodes.find(n => n.id === selected),
      snapshot = () =>
        F.Planning.snapshotText({
          model,
          planning,
          profile,
          table,
          mark,
          selected,
          selectedIds,
          mode,
          name: $('ff-name').value,
        });
    window.addEventListener('beforeunload', e => {
      if (editorActive && documentSnapshot() !== cleanSnapshot) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    function documentSnapshot() {
      return JSON.stringify({ model, planning, profile, table, mark, name: $('ff-name').value });
    }
    function error(e) {
      $('ff-error').textContent = e.message || String(e);
    }
    function restore(raw) {
      const s = F.Planning.snapshotValue(raw);
      ({ model, profile, table, mark, selected } = s);
      planning = F.Planning.validate(s.planning);
      mode = s.mode || 'edit';
      selectedIds = s.selectedIds || [];
      $('ff-name').value = s.name;
      fill();
      render();
    }
    function changed(before) {
      if (snapshot() === before) return;
      history.push(before);
      if (history.length > 80) history.shift();
      future = [];
    }
    function act(fn) {
      const before = snapshot();
      try {
        fn();
        $('ff-error').textContent = '';
        fill();
        render();
        changed(before);
        renderTools();
      } catch (e) {
        restore(before);
        error(e);
      }
    }
    function refs() {
      const old = $('ff-reference').value || String(model.referenceLane),
        count = Number($('ff-count').value);
      $('ff-reference').replaceChildren();
      if (!Number.isInteger(count) || count < 1 || count > 8) return;
      for (let i = 1; i <= count; i++) {
        const o = document.createElement('option');
        o.value = i;
        o.textContent = 'Lane ' + i;
        $('ff-reference').append(o);
      }
      $('ff-reference').value = String(Math.min(count, Number(old) || 1));
    }
    function fill() {
      if (!model) return;
      $('ff-origin').hidden = !editorOffset.some(Boolean);
      $('ff-origin').textContent =
        'Editing origin: ' +
        editorOffset.map(v => Number(v.toFixed(1))).join(', ') +
        ' mm in the builder. Point coordinates below are relative to this origin.';
      const elevation = F.Elevation.settings(model.elevation, profile.boardThicknessMm);
      $('ff-deck').value = elevation.thicknessMm;
      $('ff-clearance').value = elevation.clearanceMm;
      $('ff-count').value = model.laneCount;
      refs();
      $('ff-reference').value = model.referenceLane;
      $('ff-side').value = model.side;
      for (const b of $('ff-side-seg').querySelectorAll('button'))
        b.setAttribute('aria-pressed', String(b.dataset.side === String(model.side)));
      $('ff-spacing').value = profile.laneSpacingMm;
      $('ff-table-length').value = table.lengthMm;
      $('ff-table-width').value = table.widthMm;
      for (const [key] of fields) $('ff-profile-' + key).value = profile[key];
      $('ff-conductor').value = profile.conductor;
      tableShape.fill(table);
    }
    function chooseTool(tool) {
      mode = tool;
      renderTools();
      $('ff-ghost').setAttribute('d', '');
    }
    function renderTools() {
      for (const key of ['draw', 'edit', 'insert']) $('ff-' + key).setAttribute('aria-pressed', String(mode === key));
      $('ff-close').disabled = model.closed || model.nodes.length < 3;
      $('ff-reopen').disabled = !model.closed;
      // One button for the loop: Close loop while open, Reopen loop once closed.
      $('ff-close').hidden = model.closed;
      $('ff-reopen').hidden = !model.closed;
      $('ff-draw').disabled = model.closed;
      $('ff-undo').disabled = !history.length;
      $('ff-redo').disabled = !future.length;
      $('ff-help').textContent =
        mode === 'draw'
          ? 'Click to add smooth points; drag to set direction handles. Click the first point or Close loop to finish. Space + drag pans; wheel zooms.'
          : mode === 'insert'
            ? 'Click a curve to insert an anchor without changing its shape. Space + drag pans; wheel zooms.'
            : 'Drag anchors or coloured handles. Shift-click selects several points. Space + drag pans; wheel zooms. Escape cancels a drag.';
    }
    function render() {
      if (!model) return;
      draft = FF.definition(model, profile);
      const g = draft.geometry,
        scene = $('ff-scene'),
        handles = $('ff-nodes'),
        u = view.w / Math.max(1, svg.clientWidth);
      scene.replaceChildren();
      handles.replaceChildren();
      // The reference picture can be a large image: keep its parsed node and only re-attach it,
      // so a drag does not decode the image again on every move.
      const markup = F.Planning.image(planning);
      if (!referenceLayer || referenceLayer.markup !== markup) {
        referenceLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        referenceLayer.innerHTML = markup;
        referenceLayer.markup = markup;
      }
      referenceLayer.setAttribute('transform', 'translate(' + -editorOffset[0] + ' ' + -editorOffset[1] + ')');
      scene.append(referenceLayer);
      create(
        'path',
        { d: R.Table.path(table), fill: '#dbc8a6', opacity: '.5', stroke: '#a38c66', 'stroke-width': 2 * u },
        scene
      );
      if (table.shape?.type === 'boards')
        create(
          'path',
          {
            d: R.Table.boardPath(table),
            fill: 'none',
            stroke: '#a38c66',
            'stroke-width': u,
            'stroke-dasharray': 5 * u + ' ' + 4 * u,
          },
          scene
        );
      const label = create(
        'text',
        { x: table.x + 12 * u, y: table.y + 22 * u, fill: 'var(--ink)', 'font-size': 12 * u },
        scene
      );
      label.textContent = R.Table.description(table);
      const body = create('g', {}, scene);
      body.innerHTML = FF.draw(draft);
      const planningLayer = create(
        'g',
        { transform: 'translate(' + -editorOffset[0] + ' ' + -editorOffset[1] + ')', 'pointer-events': 'none' },
        scene
      );
      planningLayer.innerHTML = F.Planning.draw(planning);
      if (advanced) create('g', { 'pointer-events': 'none' }, scene).innerHTML = advanced.render(draft);
      if (g.referenceSvgPath)
        create(
          'path',
          {
            d: g.referenceSvgPath,
            fill: 'none',
            stroke: '#399bc7',
            'stroke-width': 2 * u,
            'stroke-dasharray': 6 * u + ' ' + 4 * u,
            'pointer-events': 'none',
          },
          scene
        );
      if (model.nodes.length > 1) {
        try {
          const q = R.Spline.evaluate(FF.controls(model, 0), 0.2);
          create(
            'path',
            {
              d: 'M -8 -5 L 5 0 L -8 5',
              transform: 'translate(' + q.p + ') rotate(' + q.heading + ') scale(' + u + ')',
              fill: 'none',
              stroke: '#399bc7',
              'stroke-width': 2,
            },
            scene
          );
        } catch {}
      }
      for (const [lane, i] of g.lanePaths.map((l, i) => [l, i])) {
        const seg = lane.segments[0],
          q = R.Spline.at(seg, R.Spline.distanceAtFraction(seg, 0.12));
        const text = create(
          'text',
          {
            x: q.x + 5 * u,
            y: q.y - 7 * u,
            fill: i + 1 === model.referenceLane ? '#168dbb' : 'var(--ink)',
            stroke: 'var(--panel)',
            'stroke-width': 3 * u,
            'paint-order': 'stroke',
            'font-size': 13 * u,
            'font-weight': 700,
          },
          scene
        );
        text.textContent = 'L' + (i + 1) + (i + 1 === model.referenceLane ? ' · drawn' : '');
      }
      for (const [n, i] of model.nodes.map((n, i) => [n, i])) {
        if (n.id === selected)
          for (const key of ['in', 'out']) {
            const p = [n.p[0] + n[key][0], n.p[1] + n[key][1]];
            create(
              'line',
              { x1: n.p[0], y1: n.p[1], x2: p[0], y2: p[1], stroke: 'var(--muted)', 'stroke-width': u },
              handles
            );
            create(
              'circle',
              {
                cx: p[0],
                cy: p[1],
                r: 5 * u,
                fill: key === 'in' ? '#3da1d2' : '#e65062',
                stroke: 'var(--panel)',
                'stroke-width': u,
                'data-node': n.id,
                'data-handle': key,
              },
              handles
            );
          }
        if (n.heightMm !== undefined) {
          const z = create(
            'text',
            {
              x: n.p[0] + 9 * u,
              y:
                n.p[1] -
                (10 +
                  14 *
                    model.nodes.slice(0, i).filter(a => Math.hypot(a.p[0] - n.p[0], a.p[1] - n.p[1]) < 20 * u).length) *
                  u,
              fill: 'var(--ink)',
              'font-size': 12 * u,
              'pointer-events': 'none',
            },
            handles
          );
          z.textContent = Number(n.heightMm.toFixed(1)) + ' mm';
        }
        const dot = create(
          'circle',
          {
            cx: n.p[0],
            cy: n.p[1],
            r: (selectedIds.includes(n.id) ? 7 : 5) * u,
            fill: n.locked ? '#d7aa4d' : selectedIds.includes(n.id) ? 'var(--accent)' : '#399bc7',
            stroke: 'var(--panel)',
            'stroke-width': 1.5 * u,
            'data-node': n.id,
            tabindex: 0,
            role: 'button',
            'aria-label': 'Anchor ' + (i + 1) + (n.locked ? ' locked' : ''),
          },
          handles
        );
        dot.addEventListener('keydown', e => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
          e.preventDefault();
          selected = n.id;
          selectedIds = [n.id];
          if (n.locked) return;
          act(() => {
            const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key],
              step = e.shiftKey ? 10 : 1;
            node().p = node().p.map((v, k) => Math.max(-50000, Math.min(50000, v + delta[k] * step)));
            model = FF.automatic(model);
          });
          [...handles.querySelectorAll('[data-node]')]
            .find(el => el.dataset.node === n.id && !el.dataset.handle)
            ?.focus({ preventScroll: true });
        });
      }
      for (const issue of (g.warnings || []).filter(i => i.code === 'overpass' && i.point)) {
        create(
          'circle',
          {
            cx: issue.point[0],
            cy: issue.point[1],
            r: 12 * u,
            fill: 'none',
            stroke: '#238447',
            'stroke-width': 2 * u,
            'pointer-events': 'none',
          },
          scene
        );
      }
      $('ff-anchor-choice').replaceChildren();
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'Choose a point…';
      $('ff-anchor-choice').append(blank);
      model.nodes.forEach((n, i) => {
        const o = document.createElement('option');
        o.value = n.id;
        o.textContent = 'Point ' + (i + 1) + ' · ' + Number((n.heightMm || 0).toFixed(1)) + ' mm';
        $('ff-anchor-choice').append(o);
      });
      $('ff-anchor-choice').value = selected || '';
      const n = node();
      const hasNext = !!n && (model.closed || model.nodes.indexOf(n) < model.nodes.length - 1);
      $('ff-squeeze-apply').disabled = !hasNext || n.locked || model.laneCount < 2;
      $('ff-squeeze-remove').disabled = !n?.squeeze || n.locked;
      $('ff-squeeze-all').disabled = !model.nodes.some(n => n.squeeze);
      const spacingKey = JSON.stringify([selected, model.id, n?.squeeze, profile.laneSpacingMm, model.laneCount]);
      if ($('ff-squeeze-mode').dataset.key !== spacingKey) {
        $('ff-squeeze-mode').dataset.key = spacingKey;
        $('ff-squeeze-mode').value = n?.squeeze?.mode === 'spread' ? 'spread' : 'squeeze';
        $('ff-squeeze-spacing').value =
          n?.squeeze?.spacingMm ??
          Math.max(
            2 * (profile.slotWidthMm / 2 + profile.conductorGapMm + profile.conductorWidthMm) + 1,
            profile.laneSpacingMm * 0.8
          );
      }
      $('ff-squeeze-mode').disabled = !hasNext || !!n?.locked || model.laneCount < 2;
      $('ff-squeeze-note').textContent =
        model.laneCount < 2
          ? 'Add at least two lanes in Lanes to adjust spacing.'
          : !hasNext
            ? 'This is the last point of an open path. Choose a point with a following stretch.'
            : n.locked
              ? 'Unlock this point to change its spacing.'
              : n.squeeze
                ? 'Target spacing: ' + n.squeeze.spacingMm + ' mm. Normal spacing: ' + profile.laneSpacingMm + ' mm.'
                : 'Normal spacing: ' + profile.laneSpacingMm + ' mm. Applies from this point to the next.';
      $('ff-point-controls').hidden = !n;
      $('ff-point-intro').hidden = !!n;
      $('ff-point-label').hidden = !!n && selectedIds.length <= 1 && !n.locked;
      $('ff-point-label').textContent = n
        ? (selectedIds.length > 1
            ? selectedIds.length + ' points selected · editing Point ' + (model.nodes.indexOf(n) + 1)
            : 'Point ' + (model.nodes.indexOf(n) + 1)) + (n.locked ? ' · Locked' : '')
        : 'Click a point on the canvas or choose one above. Draw adds new points; Edit points moves them.';
      for (const key of [
        'height',
        'set-height',
        'position',
        'linked',
        'smooth',
        'straight',
        'delete',
        'lock',
        'handles',
        'x',
        'y',
        'in-x',
        'in-y',
        'out-x',
        'out-y',
      ])
        $('ff-' + key).disabled = !n || (n.locked && key !== 'lock');
      if (!n) for (const key of ['height', 'x', 'y', 'in-x', 'in-y', 'out-x', 'out-y']) $('ff-' + key).value = '';
      if (n) {
        $('ff-height').value = n.heightMm || 0;
        $('ff-x').value = Number(n.p[0].toFixed(4));
        $('ff-y').value = Number(n.p[1].toFixed(4));
        $('ff-linked').checked = n.mode !== 'manual';
        for (const dir of ['in', 'out'])
          for (let i = 0; i < 2; i++) $('ff-' + dir + '-' + (i ? 'y' : 'x')).value = Number(n[dir][i].toFixed(4));
      }
      $('ff-straight').disabled = !hasNext || !!n?.locked;
      // Lane spacing from this point: Normal, Squeeze or Spread (the choice shows its fields).
      const spacingNow = n?.squeeze ? (n.squeeze.mode === 'spread' ? 'spread' : 'squeeze') : 'normal',
        spacingShown = pendingSqueeze || spacingNow;
      for (const b of $('ff-squeeze-seg').querySelectorAll('button')) {
        b.setAttribute('aria-pressed', String(b.dataset.squeeze === spacingShown));
        b.disabled = !hasNext || !!n?.locked || model.laneCount < 2;
      }
      for (const id of ['ff-squeeze-spacing', 'ff-squeeze-apply'])
        ($(id).closest('label') || $(id)).hidden = spacingShown === 'normal';
      $('ff-squeeze-remove').hidden = true;
      $('ff-prev-point').disabled = $('ff-next-point').disabled = !model.nodes.length;
      $('ff-squeeze-spacing').disabled = !hasNext || !!n?.locked || model.laneCount < 2;
      $('ff-lock').textContent = n?.locked ? 'Unlock' : 'Lock';
      $('ff-delete').textContent = selectedIds.length > 1 ? 'Delete ' + selectedIds.length : 'Delete';
      $('ff-status').textContent = g.closed ? 'Closed circuit' : g.valid ? 'Open draft' : 'Draft needs attention';
      // Side view of the drawn slot's heights.
      const ref = draft?.geometry?.reference,
        side = ref?.heightsMm?.length
          ? window.ElevationProfile?.build(
              {
                lengthMm: ref.lengthMm,
                sections: [{ pieceId: 'ff', reverse: false, startMm: 0, lengthMm: ref.lengthMm }],
              },
              [{ id: 'ff', definitionId: draft.id }],
              { [draft.id]: draft }
            )
          : null;
      $('ff-elevation').innerHTML = side?.hasHeights
        ? '<h3>Side view</h3>' +
          window.ElevationProfile.svg(side) +
          '<p class="fine">Highest ' +
          Math.round(side.maxMm) +
          ' mm · steepest ' +
          side.steepestPct.toFixed(1) +
          '%' +
          (side.steepestPct > 10 ? ' — steeper than 10% can be hard for some cars to climb.' : '') +
          '</p>'
        : '';
      $('ff-lengths').replaceChildren();
      for (const [lane, i] of g.lanePaths.map((l, i) => [l, i])) {
        const p = document.createElement('p');
        p.className = 'fine';
        p.textContent =
          'Lane ' + (i + 1) + ': ' + (lane.lengthMm / 1000).toFixed(3) + ' m' + (model.closed ? '' : ' · open path');
        $('ff-lengths').append(p);
      }
      const checks = FF.check(draft, table);
      $('ff-check-summary').textContent = checks.length
        ? checks.length + ' check' + (checks.length === 1 ? '' : 's') + ' to review.'
        : 'No issues found in the current checks.';
      $('ff-checks-badge').hidden = !checks.length;
      $('ff-checks-badge').textContent = checks.length || '';
      $('ff-tab-checks').title =
        'Checks and lane lengths' + (checks.length ? ' · ' + checks.length + ' to review' : '');
      $('ff-status').textContent =
        (g.closed ? 'Closed circuit' : g.valid ? 'Open draft' : 'Draft needs attention') +
        (checks.length ? ' · ' + checks.length + ' to review' : g.closed ? ' · no issues' : '');
      $('ff-status').dataset.state = checks.length ? 'warn' : g.closed ? 'good' : 'draft';
      // A drawing that has barely started is not a problem yet: say what to do next.
      const starting = model.nodes.length < 2;
      $('ff-status').classList.toggle('ff-status-start', starting);
      if (starting) {
        $('ff-status').textContent = model.nodes.length
          ? 'Click to add the next point'
          : 'Click on the table to place your first point';
        $('ff-status').dataset.state = 'start';
        $('ff-checks-badge').hidden = true;
      }
      $('ff-start').hidden = model.nodes.length > 0;
      // Facts under the name, as in the Track Builder: points, loop, drawn lane length, lanes.
      const drawn = g.lanePaths[(model.referenceLane || 1) - 1] || g.lanePaths[0];
      $('ff-facts').textContent = model.nodes.length
        ? [
            model.nodes.length + (model.nodes.length === 1 ? ' point' : ' points'),
            model.closed ? 'closed' : 'open',
            drawn ? (drawn.lengthMm / 1000).toFixed(2) + ' m' : null,
            model.laneCount + (model.laneCount === 1 ? ' lane' : ' lanes'),
          ]
            .filter(Boolean)
            .join(' · ')
        : 'No points yet';
      $('ff-facts').title = g.lanePaths
        .map((l, i) => 'Lane ' + (i + 1) + ': ' + (l.lengthMm / 1000).toFixed(3) + ' m')
        .join('\n');
      $('ff-issues').replaceChildren();
      for (const issue of checks) {
        const li = document.createElement('li');
        const find = document.createElement('button');
        find.className = 'btn small';
        find.textContent = issue.message;
        find.onclick = () => focusIssue(issue);
        li.append(find);
        $('ff-issues').append(li);
      }
      renderTools();
      renderGuide(g, checks);
    }
    function updateView() {
      const r = svg.getBoundingClientRect();
      view.h = (view.w * (r.height || 600)) / (r.width || 800);
      svg.setAttribute('viewBox', [view.x, view.y, view.w, view.h].join(' '));
      for (const [k, v] of Object.entries({ x: view.x, y: view.y, width: view.w, height: view.h }))
        $('ff-background').setAttribute(k, v);
      $('ff-zoom-level').textContent = Math.round((100 * 1000) / view.w) + '%';
    }
    function fit() {
      const b = draft?.geometry.boundsMm || [0, 0, 0, 0],
        x = Math.min(table.x, b[0]),
        y = Math.min(table.y, b[1]),
        w = Math.max(table.x + table.lengthMm, b[0] + b[2]) - x,
        hh = Math.max(table.y + table.widthMm, b[1] + b[3]) - y,
        r = svg.getBoundingClientRect();
      view.w = Math.max(w + 200, ((hh + 200) * (r.width || 800)) / (r.height || 600));
      view.x = x + w / 2 - view.w / 2;
      updateView();
      view.y = y + hh / 2 - view.h / 2;
      updateView();
      render();
    }
    const world = e => {
      const r = svg.getBoundingClientRect();
      return [view.x + ((e.clientX - r.left) / r.width) * view.w, view.y + ((e.clientY - r.top) / r.height) * view.h];
    };
    function open(existing) {
      const state = h.get();
      if (existing?.locked) throw Error('Unlock this FreeForm circuit before editing.');
      planning = F.Planning.validate(state.planning);
      source = existing || null;
      const d = source ? state.defs[source.definitionId] : null;
      profile = R.settings({
        ...(d?.parameters.routed || state.settings),
        ...(!d ? { laneCount: 1 } : {}),
        constructionMode: 'table',
      });
      const frame = d
        ? FF.editingFrame(d.parameters.freeform, source)
        : {
            model: FF.empty(profile.laneCount),
            offset:
              state.table && [state.table.x, state.table.y].some(v => Math.abs(v) > 40000)
                ? [state.table.x, state.table.y]
                : [0, 0],
          };
      model = frame.model;
      editorOffset = frame.offset;
      selected = null;
      selectedIds = [];
      mode = model.closed ? 'edit' : 'draw';
      table = cloneTable(state.table);
      table.x -= editorOffset[0];
      table.y -= editorOffset[1];
      baseKey = builderKey();
      mark =
        d && state.state.startFinish?.pieceId === source.id ? FF.locate(d, state.state.startFinish.fraction) : null;
      history = [];
      future = [];
      $('ff-name').value = d ? state.title : 'My FreeForm circuit';
      $('ff-error').textContent = '';
      fill();
      cleanSnapshot = documentSnapshot();
      editorActive = true;
      showPanel('points');
      render();
      fit();
    }
    function cloneTable(t) {
      return t
        ? { ...t, kind: 'table', locked: true }
        : { x: 0, y: 0, lengthMm: 3000, widthMm: 1800, kind: 'table', locked: true };
    }
    function enter() {
      const changedBuilder = editorActive && builderKey() !== baseKey,
        dirty = editorActive && documentSnapshot() !== cleanSnapshot;
      const note = $('ff-context-note');
      note.hidden = !(changedBuilder && dirty);
      note.textContent =
        changedBuilder && dirty
          ? 'The builder track has changed. Your unsaved FreeForm draft is kept here. Save it to replace the builder track, or Cancel and reopen FreeForm to edit the current track.'
          : '';
      if (editorActive && (!changedBuilder || dirty)) {
        updateView();
        render();
        return;
      }
      const s = h.get(),
        p = s.items.length === 1 && s.defs[s.items[0].definitionId].parameters.type === FF.TYPE ? s.items[0] : null;
      try {
        open(p);
      } catch (e) {
        editorActive = false;
        h.message(e.message, true);
        location.hash = 'builder';
      }
    }
    function launch() {
      location.hash = 'freeform';
      enter();
    }
    entry.onclick = launch;
    editButton.onclick = launch;
    $('ff-cancel').onclick = () => {
      finish(true);
      editorActive = false;
      location.hash = 'builder';
    };
    dialog.addEventListener('cancel', e => {
      e.preventDefault();
      if (gesture) finish(true);
      else chooseTool('edit');
    });
    $('ff-apply').onclick = () => {
      try {
        finish(false);
        const name = $('ff-name').value.trim();
        if (!name || name.length > 100) throw Error('Enter a track name.');
        F.validateSpaceGuide(table);
        FF.validate(model);
        const commit = useSource => {
          h.apply(
            model,
            profile,
            { ...table, x: table.x + editorOffset[0], y: table.y + editorOffset[1] },
            name,
            useSource,
            useSource ? mark : null,
            editorOffset,
            planning
          );
          editorActive = false;
          location.hash = 'builder';
        };
        if (!source || builderKey() !== baseKey) h.start(() => commit(null));
        else commit(source);
      } catch (e) {
        error(e);
      }
    };
    for (const tool of ['draw', 'edit', 'insert']) $('ff-' + tool).onclick = () => chooseTool(tool);
    $('ff-close').onclick = () =>
      act(() => {
        model = FF.close(model);
        mode = 'edit';
      });
    $('ff-reopen').onclick = () =>
      act(() => {
        model = { ...model, closed: false };
        model = FF.automatic(model);
        mode = 'draw';
      });
    $('ff-count').oninput = refs;
    $('ff-generate').onclick = () =>
      act(() => {
        model = FF.configure(
          model,
          Number($('ff-count').value),
          Number($('ff-reference').value),
          Number($('ff-side').value)
        );
        const spacing = number('ff-spacing');
        profile = R.settings({ ...profile, laneCount: model.laneCount, laneSpacingMm: spacing });
      });
    $('ff-elevation-settings').onclick = () =>
      act(() => {
        model.elevation = F.Elevation.settings({
          version: 1,
          startMm: 0,
          endMm: 0,
          thicknessMm: number('ff-deck'),
          clearanceMm: number('ff-clearance'),
        });
      });
    $('ff-anchor-choice').onchange = () => {
      selected = $('ff-anchor-choice').value || null;
      selectedIds = selected ? [selected] : [];
      render();
    };
    $('ff-set-height').onclick = () =>
      act(() => {
        const value = F.Elevation.height(number('ff-height')),
          ids = new Set(selectedIds.length ? selectedIds : [selected]);
        if (model.nodes.some(n => ids.has(n.id) && n.locked))
          throw Error('Unlock selected points before changing height.');
        for (const n of model.nodes) if (ids.has(n.id)) n.heightMm = value;
      });
    $('ff-squeeze-mode').onchange = () => {
      $('ff-squeeze-spacing').value =
        $('ff-squeeze-mode').value === 'spread'
          ? Math.min(300, profile.laneSpacingMm * 1.2)
          : Math.max(
              2 * (profile.slotWidthMm / 2 + profile.conductorGapMm + profile.conductorWidthMm) + 1,
              profile.laneSpacingMm * 0.8
            );
    };
    $('ff-squeeze-apply').onclick = () =>
      act(() => {
        const n = node();
        n.squeeze = FF.squeeze(
          {
            ...($('ff-squeeze-mode').value === 'spread' ? { version: 2, mode: 'spread' } : { version: 1 }),
            spacingMm: number('ff-squeeze-spacing'),
            domain: [0, 1],
          },
          model.laneCount
        );
        FF.parameters(model, profile);
      });
    $('ff-squeeze-remove').onclick = () =>
      act(() => {
        delete node().squeeze;
      });
    $('ff-squeeze-all').onclick = () =>
      act(() => {
        if (model.nodes.some(n => n.locked && n.squeeze)) throw Error('Unlock anchors with adjusted spacing first.');
        for (const n of model.nodes) delete n.squeeze;
      });
    $('ff-reverse').onclick = () =>
      act(() => {
        model = FF.reverseNumbers(model);
      });
    $('ff-construction').onclick = () =>
      act(() => {
        profile = R.settings({
          ...profile,
          ...Object.fromEntries(fields.map(([key]) => [key, number('ff-profile-' + key)])),
          conductor: $('ff-conductor').value,
        });
        const next = { ...table, lengthMm: number('ff-table-length'), widthMm: number('ff-table-width') };
        delete next.shape;
        const shape = tableShape.read();
        table = F.validateSpaceGuide({ ...next, ...(shape ? { shape } : {}) });
      });
    function number(id) {
      const value = $(id).value.trim();
      if (value === '') throw Error('Enter a number for ' + id.replace('ff-', '') + '.');
      return Number(value);
    }
    $('ff-oval').onclick = () =>
      act(() => {
        model = FF.oval(profile);
        mark = null;
        selected = null;
        selectedIds = [];
        mode = 'edit';
      });
    $('ff-eight').onclick = () =>
      act(() => {
        model = FF.figureEight(profile, table);
        mark = null;
        selected = null;
        selectedIds = [];
        mode = 'edit';
      });
    $('ff-fit').onclick = fit;
    function undo() {
      if (!history.length) return;
      future.push(snapshot());
      restore(history.pop());
    }
    function redo() {
      if (!future.length) return;
      history.push(snapshot());
      restore(future.pop());
    }
    $('ff-undo').onclick = undo;
    $('ff-redo').onclick = redo;
    $('ff-position').onclick = () =>
      act(() => {
        const n = node();
        n.p = [number('ff-x'), number('ff-y')];
        FF.validate(model);
        model = FF.automatic(model);
      });
    $('ff-smooth').onclick = () =>
      act(() => {
        node().mode = 'auto';
        model = FF.automatic(model);
      });
    $('ff-linked').onchange = () =>
      act(() => {
        const n = node();
        n.mode = $('ff-linked').checked ? 'smooth' : 'manual';
        if (n.mode === 'smooth') {
          const v = n.out,
            len = Math.hypot(...v) || 1,
            other = Math.hypot(...n.in);
          n.in = v.map(c => (-c / len) * other);
        }
      });
    $('ff-lock').onclick = () =>
      act(() => {
        node().locked = !node().locked;
      });
    $('ff-delete').onclick = () =>
      act(() => {
        const ids = new Set(selectedIds.length ? selectedIds : [selected]);
        if (model.nodes.some(n => ids.has(n.id) && n.locked))
          throw Error('Unlock selected points before deleting them.');
        const affected = new Set();
        model.nodes.forEach((n, i) => {
          if (ids.has(n.id)) {
            affected.add(n.id);
            affected.add(model.nodes[(i + model.nodes.length - 1) % model.nodes.length].id);
          }
        });
        if (mark && affected.has(mark.nodeId)) {
          mark = null;
          h.message('The timing stretch was deleted. Set start/finish again after applying.');
        }
        for (let i = model.nodes.length - 1; i >= 0; i--) if (ids.has(model.nodes[i].id)) model = FF.remove(model, i);
        selected = null;
        selectedIds = [];
      });
    $('ff-straight').onclick = () =>
      act(() => {
        const a = node(),
          i = model.nodes.indexOf(a),
          b = model.nodes[(i + 1) % model.nodes.length];
        if (!b || (!model.closed && i === model.nodes.length - 1))
          throw Error('Choose a point with a following stretch.');
        if (b.locked) throw Error('Unlock the next point first.');
        const v = b.p.map((c, k) => (c - a.p[k]) / 3);
        a.out = v;
        b.in = v.map(c => -c);
        a.mode = b.mode = 'manual';
      });
    $('ff-handles').onclick = () =>
      act(() => {
        const n = node();
        n.in = [number('ff-in-x'), number('ff-in-y')];
        n.out = [number('ff-out-x'), number('ff-out-y')];
        n.mode = 'manual';
        FF.validate(model);
      });
    function nearest(pos) {
      let best = null;
      for (let i = 0; i < model.nodes.length - (model.closed ? 0 : 1); i++) {
        const c = FF.controls(model, i);
        for (let j = 1; j < 64; j++) {
          const t = j / 64,
            u = 1 - t,
            p = [0, 1].map(
              k => u ** 3 * c[0][k] + 3 * u * u * t * c[1][k] + 3 * u * t * t * c[2][k] + t ** 3 * c[3][k]
            ),
            d = Math.hypot(p[0] - pos[0], p[1] - pos[1]);
          if (!best || d < best.d) best = { index: i, t, d };
        }
      }
      return best;
    }
    svg.addEventListener('pointerdown', e => {
      if (gesture || ![0, 1].includes(e.button)) return;
      svg.focus({ preventScroll: true });
      const pos = world(e),
        target = e.target.closest('[data-node]'),
        id = target?.dataset.node,
        handle = target?.dataset.handle;
      if (space || e.button === 1) {
        gesture = { type: 'pan', start: pos, client: [e.clientX, e.clientY], view: { ...view } };
      } else if (id && mode === 'draw' && id === model.nodes[0]?.id && model.nodes.length >= 3 && !handle) {
        act(() => {
          model = FF.close(model);
          mode = 'edit';
        });
        return;
      } else if (id) {
        if (e.shiftKey && !handle) {
          selectedIds = selectedIds.includes(id) ? selectedIds.filter(v => v !== id) : [...selectedIds, id];
          selected = selectedIds.includes(id) ? id : selectedIds.at(-1) || null;
          render();
          return;
        }
        selected = id;
        if (!selectedIds.includes(id)) selectedIds = [id];
        render();
        if (node().locked || (!handle && model.nodes.some(n => selectedIds.includes(n.id) && n.locked))) {
          error('Unlock selected points before moving them.');
          return;
        }
        gesture = {
          type: handle ? 'handle' : 'point',
          handle,
          before: snapshot(),
          start: pos,
          original: structuredClone(node()),
          originals: model.nodes.filter(n => selectedIds.includes(n.id)).map(n => structuredClone(n)),
        };
      } else if (mode === 'insert') {
        act(() => {
          const hit = nearest(pos);
          if (!hit || hit.d > (view.w / svg.clientWidth) * 24) throw Error('Click closer to the blue reference slot.');
          const result = FF.split(model, hit.index, hit.t);
          if (mark?.nodeId === model.nodes[hit.index].id) {
            if (mark.t <= hit.t) mark.t /= hit.t;
            else mark = { nodeId: result.nodeId, t: (mark.t - hit.t) / (1 - hit.t) };
          }
          model = result.model;
          selected = result.nodeId;
          selectedIds = [selected];
          mode = 'edit';
        });
        return;
      } else if (mode === 'draw' && !model.closed) {
        if (
          e.detail > 1 ||
          (lastDrawDown &&
            e.timeStamp - lastDrawDown.time < 350 &&
            Math.hypot(e.clientX - lastDrawDown.x, e.clientY - lastDrawDown.y) < 4)
        ) {
          chooseTool('edit');
          return;
        }
        lastDrawDown = { time: e.timeStamp, x: e.clientX, y: e.clientY };
        const before = snapshot();
        try {
          model = FF.append(model, snap(pos));
          selected = model.nodes.at(-1).id;
          selectedIds = [selected];
          gesture = { type: 'draw', before, start: pos, original: structuredClone(node()) };
          render();
        } catch (error) {
          error && h.message(error.message, true);
          return;
        }
      } else {
        selected = null;
        selectedIds = [];
        render();
        return;
      }
      gesture.pointerId = e.pointerId;
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    svg.addEventListener('pointermove', e => {
      const pos = world(e);
      if (!gesture) {
        if (mode === 'draw' && model.nodes.length && !model.closed) {
          const n = model.nodes.at(-1),
            c = [n.p[0] + n.out[0], n.p[1] + n.out[1]];
          $('ff-ghost').setAttribute('d', 'M ' + n.p + ' C ' + c + ' ' + pos + ' ' + pos);
        }
        return;
      }
      if (gesture.pointerId !== e.pointerId) return;
      if (gesture.type === 'pan') {
        const r = svg.getBoundingClientRect();
        view.x = gesture.view.x - ((e.clientX - gesture.client[0]) / r.width) * view.w;
        view.y = gesture.view.y - ((e.clientY - gesture.client[1]) / r.height) * view.h;
        updateView();
        return;
      }
      const n = node();
      if (!n) return;
      try {
        if (gesture.type === 'point') {
          const delta = pos.map((v, i) => v - gesture.start[i]);
          for (const old of gesture.originals) {
            const target = model.nodes.find(n => n.id === old.id);
            target.p = snap(old.p.map((v, i) => Math.max(-50000, Math.min(50000, v + delta[i]))));
          }
          model = FF.automatic(model);
        } else if (gesture.type === 'handle' || gesture.type === 'draw') {
          if (
            gesture.type === 'draw' &&
            Math.hypot(pos[0] - gesture.start[0], pos[1] - gesture.start[1]) < (view.w / svg.clientWidth) * 3
          )
            return;
          const key = gesture.handle || 'out',
            other = key === 'in' ? 'out' : 'in',
            v = pos.map((c, i) => Math.max(-50000, Math.min(50000, c - n.p[i]))),
            len = Math.hypot(...v),
            oldLen = gesture.type === 'draw' ? len : Math.hypot(...n[other]);
          n[key] = v;
          if (n.mode !== 'manual' || gesture.type === 'draw') {
            n[other] = v.map(c => (-c / (len || 1)) * oldLen);
            n.mode = 'smooth';
          }
        }
        // At most one redraw per frame while dragging; finish() draws the final state.
        if (!dragFrame)
          dragFrame = requestAnimationFrame(() => {
            dragFrame = 0;
            if (!gesture) return;
            try {
              render();
            } catch (e) {
              finish(true);
              error(e);
            }
          });
      } catch (e) {
        finish(true);
        error(e);
      }
    });
    function finish(cancel = false) {
      if (dragFrame) cancelAnimationFrame(dragFrame);
      dragFrame = 0;
      if (!gesture) return;
      const g = gesture;
      gesture = null;
      if (g.type !== 'pan') {
        if (cancel) restore(g.before);
        else {
          changed(g.before);
          render();
        }
      }
      if (svg.hasPointerCapture(g.pointerId)) svg.releasePointerCapture(g.pointerId);
    }
    svg.addEventListener('pointerup', () => finish());
    svg.addEventListener('pointercancel', () => finish(true));
    svg.addEventListener('lostpointercapture', () => finish(true));
    svg.addEventListener('dblclick', () => chooseTool('edit'));
    svg.addEventListener(
      'wheel',
      e => {
        e.preventDefault();
        if (gesture) return;
        const p = world(e),
          a = (p[0] - view.x) / view.w,
          b = (p[1] - view.y) / view.h;
        view.w = Math.max(300, Math.min(100000, view.w * Math.exp(Math.sign(e.deltaY) * 0.12)));
        updateView();
        view.x = p[0] - a * view.w;
        view.y = p[1] - b * view.h;
        updateView();
        render();
      },
      { passive: false }
    );
    dialog.addEventListener('keydown', e => {
      if (e.target.closest('input,select,textarea,button,summary')) return;
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const key = e.key.toLowerCase();
        const tool = { d: 'draw', e: 'edit', i: 'insert' }[key];
        if (tool && !(tool === 'draw' && model.closed)) {
          e.preventDefault();
          return chooseTool(tool);
        }
        if (key === 'f') {
          e.preventDefault();
          return fitSelection();
        }
        if (key === 'h') {
          e.preventDefault();
          return toggleSettings();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectedIds = model.nodes.map(n => n.id);
        selected = selectedIds.at(-1) || null;
        render();
        return;
      }
      if (e.code === 'Space') {
        space = true;
        e.preventDefault();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (gesture) finish(true);
        else chooseTool('edit');
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (gesture) finish(true);
        else if (e.shiftKey) redo();
        else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
      if (e.key === 'Delete' && node() && !node().locked) {
        e.preventDefault();
        $('ff-delete').click();
      }
    });
    root.addEventListener('keyup', e => {
      if (e.code === 'Space') space = false;
    });
    root.addEventListener('blur', () => {
      space = false;
      finish(true);
    });
    root.addEventListener('resize', () => {
      if (editorActive && location.hash === '#freeform') {
        updateView();
        render();
      }
    });

    function focusIssue(issue) {
      const n = model.nodes.find(n => n.id === issue.nodeId),
        p = issue.point || n?.p;
      if (n) {
        selected = n.id;
        selectedIds = [n.id];
      }
      if (p) {
        view.w = 800;
        view.x = p[0] - 400;
        view.y = p[1] - 300;
        updateView();
        render();
      } else fit();
    }
    advanced = root.FreeFormToolsUI.init({
      get: () => ({ model, profile, table, selected, selectedIds, car: h.get().car }),
      error,
      world,
      focus: focusIssue,
      render,
      reference: () =>
        h.reference({
          get: () => ({ planning }),
          commit: next =>
            act(() => {
              planning = F.Planning.validate(next.planning);
            }),
        }),
      measure: (a, b) =>
        act(() => {
          planning.measurements.push({
            id: F.uid(),
            a: a.map((v, i) => v + editorOffset[i]),
            b: b.map((v, i) => v + editorOffset[i]),
            label: '',
            print: false,
          });
          planning = F.Planning.validate(planning);
        }),
      apply: (next, token, splits = []) => {
        if (JSON.stringify(model) !== token) throw Error('The drawing changed. Preview again.');
        const validated = FF.validate(next);
        act(() => {
          model = validated;
          mark = root.FreeFormTools.remapMark(mark, splits);
        });
      },
    });

    // ---------------------------------------------------------------- layout and new tools
    // Stretch and Smooth join the Shape group; the View & measure menu becomes Tools, with the
    // whole-drawing moves and new starts; the curvature key floats over the canvas.
    {
      const shape = dialog.querySelector('.ff-shape');
      const stretch = $('ff-stretch-tools'),
        smoothJoins = $('ff-smooth-selection');
      if (stretch) {
        stretch.textContent = 'Stretch…';
        stretch.title = 'Stretch lane spacing or build a ramp along a stretch';
        shape.append(stretch);
      }
      if (smoothJoins) {
        smoothJoins.textContent = 'Smooth joins…';
        smoothJoins.title = 'Smooth the joins between the selected points';
        shape.append(smoothJoins);
      }
      const toolbar = dialog.querySelector('.ff-toolbar');
      toolbar.append($('ff-snap'));
      const menu = dialog.querySelector('.ff-design-menu');
      if (menu) {
        toolbar.append(menu);
        const summaryEl = menu.querySelector('summary');
        summaryEl.textContent = 'Tools';
        summaryEl.id = 'ff-tools-menu';
        const host = menu.querySelector('div');
        const label = text => {
          const p = document.createElement('p');
          p.className = 'menu-label';
          p.textContent = text;
          return p;
        };
        const item = (text, fn, title) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn';
          b.textContent = text;
          if (title) b.title = title;
          b.onclick = () => {
            menu.open = false;
            fn();
          };
          return b;
        };
        host.prepend(label('View and measure'));
        host.append(
          label('Whole drawing'),
          item('Mirror left to right', () => transform('mirror')),
          item('Rotate 90°', () => transform('rotate')),
          item('Centre on the table', () => transform('centre')),
          label('Start again from'),
          item('Oval', () => $('ff-oval').click(), 'Replaces the drawing; Undo brings it back'),
          item('Figure eight', () => $('ff-eight').click(), 'Replaces the drawing; Undo brings it back')
        );
        for (const b of host.querySelectorAll('button')) b.addEventListener('click', () => (menu.open = false));
      }
      const legend = dialog.querySelector('.ff-curvature-legend');
      if (legend) dialog.querySelector('.ff-stage').append(legend);
      $('ff-start-reference').onclick = () =>
        [...dialog.querySelectorAll('.ff-design-menu button')]
          .find(b => /Reference image/.test(b.textContent))
          ?.click();
    }
    // Moves the whole drawing: mirror (lanes follow), a quarter turn, or the centre of the table.
    function transform(kind) {
      act(() => {
        if (!model.nodes.length) throw Error('Draw or start a shape first.');
        if (model.nodes.some(n => n.locked)) throw Error('Unlock all points before moving the whole drawing.');
        const b = FF.definition(model, profile).geometry.boundsMm,
          c = [b[0] + b[2] / 2, b[1] + b[3] / 2],
          shift = [table.x + table.lengthMm / 2 - c[0], table.y + table.widthMm / 2 - c[1]];
        for (const n of model.nodes) {
          if (kind === 'mirror') {
            n.p = [2 * c[0] - n.p[0], n.p[1]];
            n.in = [-n.in[0], n.in[1]];
            n.out = [-n.out[0], n.out[1]];
          } else if (kind === 'rotate') {
            const d = [n.p[0] - c[0], n.p[1] - c[1]];
            n.p = [c[0] - d[1], c[1] + d[0]];
            n.in = [-n.in[1], n.in[0]];
            n.out = [-n.out[1], n.out[0]];
          } else n.p = [n.p[0] + shift[0], n.p[1] + shift[1]];
        }
        // A mirror image turns left into right: the lanes stay on the same side of the picture.
        if (kind === 'mirror') model.side = -model.side;
        model = FF.automatic(model);
        FF.validate(model);
      });
    }
    function zoomBy(factor) {
      const c = [view.x + view.w / 2, view.y + view.h / 2];
      view.w = Math.max(300, Math.min(100000, view.w * factor));
      updateView();
      view.x = c[0] - view.w / 2;
      view.y = c[1] - view.h / 2;
      updateView();
      render();
    }
    // Zoom to selection (F): the selected points and their handles; nothing selected fits the table.
    function fitSelection() {
      const chosen = model.nodes.filter(n => selectedIds.includes(n.id) || n.id === selected);
      if (!chosen.length) return fit();
      const xs = chosen.flatMap(n => [n.p[0], n.p[0] + n.in[0], n.p[0] + n.out[0]]),
        ys = chosen.flatMap(n => [n.p[1], n.p[1] + n.in[1], n.p[1] + n.out[1]]),
        x = Math.min(...xs),
        y = Math.min(...ys),
        w = Math.max(...xs) - x,
        hh = Math.max(...ys) - y,
        r = svg.getBoundingClientRect();
      view.w = Math.max(w + 400, ((hh + 400) * (r.width || 800)) / (r.height || 600), 600);
      view.x = x + w / 2 - view.w / 2;
      updateView();
      view.y = y + hh / 2 - view.h / 2;
      updateView();
      render();
    }
    // Full canvas (H): the settings fold away; the edge tab or H brings them back.
    let settingsHidden = false;
    try {
      // The guided sketch keeps the canvas full width; All settings (H) shows the panel.
      settingsHidden = localStorage.getItem('slotforge.ff-settings-hidden.v1') !== 'false';
    } catch {}
    function showSettings(hidden) {
      settingsHidden = hidden;
      dialog.classList.toggle('ff-canvas-only', hidden);
      $('ff-canvas-only').setAttribute('aria-pressed', String(hidden));
      $('ff-show-settings').hidden = !hidden;
      try {
        localStorage.setItem('slotforge.ff-settings-hidden.v1', String(hidden));
      } catch {}
      if (editorActive) {
        updateView();
        render();
      }
    }
    const toggleSettings = () => showSettings(!settingsHidden);
    $('ff-canvas-only').onclick = toggleSettings;
    $('ff-hide-settings').onclick = () => showSettings(true);
    $('ff-show-settings').onclick = () => showSettings(false);
    showSettings(settingsHidden);
    $('ff-zoom-in').onclick = () => zoomBy(0.8);
    $('ff-zoom-out').onclick = () => zoomBy(1.25);
    $('ff-fit-selection').onclick = fitSelection;
    // Snap 10 mm.
    const showSnap = () => $('ff-snap').setAttribute('aria-pressed', String(snapOn));
    $('ff-snap').onclick = () => {
      snapOn = !snapOn;
      showSnap();
      try {
        localStorage.setItem('slotforge.ff-snap.v1', String(snapOn));
      } catch {}
    };
    showSnap();
    // ---------------------------------------------------------------- The guided sketch
    // Five steps along the top of the canvas (Draw · Close · Lanes · Heights · Check & use) and a
    // drawer at the bottom with the current step's few controls. The drawer drives the same fields
    // and buttons as the settings panel, which stays one click away (All settings).
    var guide = {
      step: null,
      visited: new Set(),
      steps: [
        ['draw', 'Draw the line'],
        ['close', 'Close the loop'],
        ['lanes', 'Lanes'],
        ['heights', 'Heights'],
        ['check', 'Check & use'],
      ],
    };
    {
      const stage = dialog.querySelector('.ff-stage'),
        bar = document.createElement('div'),
        drawer = document.createElement('div');
      bar.id = 'ff-steps';
      bar.className = 'ff-steps';
      bar.setAttribute('role', 'tablist');
      bar.setAttribute('aria-label', 'Steps');
      guide.steps.forEach(([key, label], i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.id = 'ff-step-' + key;
        b.className = 'ff-step';
        b.setAttribute('role', 'tab');
        b.dataset.step = key;
        const n = document.createElement('i');
        n.textContent = String(i + 1);
        n.setAttribute('aria-hidden', 'true');
        b.append(n, label);
        bar.append(b);
      });
      drawer.id = 'ff-drawer';
      drawer.className = 'ff-drawer';
      drawer.setAttribute('role', 'tabpanel');
      drawer.innerHTML = `
        <div class="ffd-body" id="ffd-body"></div>
        <div class="ffd-nav">
          <button type="button" class="btn quiet" id="ffd-settings" title="Show every setting (H)">All settings</button>
          <button type="button" class="btn" id="ffd-back">← Back</button>
          <button type="button" class="btn ffd-next" id="ffd-next">Next →</button>
        </div>`;
      stage.append(bar, drawer);
      bar.onclick = e => {
        const b = e.target.closest('[data-step]');
        if (b) goStep(b.dataset.step);
      };
      $('ffd-back').onclick = () => goStep(guide.steps[Math.max(0, stepIndex() - 1)][0]);
      $('ffd-next').onclick = () => {
        if (guide.step === 'check') return $('ff-apply').click();
        goStep(guide.steps[Math.min(guide.steps.length - 1, stepIndex() + 1)][0]);
      };
      $('ffd-settings').onclick = () => showSettings(!settingsHidden);
    }
    function stepIndex() {
      return guide.steps.findIndex(([k]) => k === guide.step);
    }
    function stepDone(key, checks) {
      if (key === 'draw') return model.nodes.length >= 3;
      if (key === 'close') return model.closed;
      if (key === 'lanes') return model.closed && (model.laneCount > 1 || guide.visited.has('lanes'));
      if (key === 'heights')
        return (
          model.closed && (model.nodes.some(n => Math.abs(n.heightMm || 0) > 0.01) || guide.visited.has('heights'))
        );
      return model.closed && !checks.length;
    }
    function firstOpenStep(checks) {
      return (guide.steps.find(([k]) => !stepDone(k, checks)) || guide.steps[guide.steps.length - 1])[0];
    }
    function goStep(key) {
      guide.step = key;
      guide.visited.add(key);
      if (key === 'draw' && !model.closed) chooseTool('draw');
      else if (key !== 'draw' && mode === 'draw' && model.closed) chooseTool('edit');
      if (key === 'heights' && !selected && model.nodes.length) {
        selected = model.nodes[0].id;
      }
      render();
    }
    // A small builder for the drawer's controls.
    function gEl(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    function gField(label, ...content) {
      const box = gEl('div', 'ffd-field');
      box.append(gEl('span', 'ffd-label', label), ...content);
      return box;
    }
    function gButton(label, run, cls = 'btn') {
      const b = gEl('button', cls, label);
      b.type = 'button';
      b.onclick = run;
      return b;
    }
    const regenerate = () => $('ff-generate').click();
    function renderGuide(g, checks) {
      if (!guide || !$('ff-drawer')) return;
      if (!guide.step) guide.step = firstOpenStep(checks);
      for (const [key] of guide.steps) {
        const b = $('ff-step-' + key),
          done = stepDone(key, checks);
        b.classList.toggle('done', done && key !== guide.step);
        b.setAttribute('aria-selected', String(key === guide.step));
        b.querySelector('i').textContent =
          done && key !== guide.step ? '✓' : String(guide.steps.findIndex(([k]) => k === key) + 1);
      }
      $('ff-drawer').setAttribute('aria-labelledby', 'ff-step-' + guide.step);
      $('ffd-back').disabled = stepIndex() === 0;
      $('ffd-next').textContent =
        guide.step === 'check' ? 'Use in builder' : 'Next: ' + guide.steps[stepIndex() + 1][1] + ' →';
      $('ffd-next').disabled = guide.step === 'check' && !model.closed;
      $('ffd-settings').setAttribute('aria-pressed', String(!settingsHidden));
      // render() runs on every pointer move while dragging: rebuild the drawer only when
      // something it shows has changed.
      const node = model.nodes.find(n => n.id === selected),
        key = JSON.stringify([
          guide.step,
          model.nodes.length,
          model.closed,
          model.laneCount,
          settingsHidden,
          checks.length,
          guide.step === 'draw' ? $('ff-snap').getAttribute('aria-pressed') : 0,
          guide.step === 'close' ? $('ff-facts').textContent : 0,
          guide.step === 'lanes'
            ? [$('ff-spacing').value, $('ff-side').value, g.lanePaths.map(l => Math.round(l.lengthMm / 10))]
            : 0,
          guide.step === 'heights' ? [selected, node?.heightMm || 0, $('ff-elevation').innerHTML.length] : 0,
          guide.step === 'check' ? [$('ff-check-summary').textContent, $('ff-issues').textContent] : 0,
          [...guide.visited].join(),
        ]);
      if (key === guide.key) return;
      guide.key = key;
      const body = $('ffd-body');
      body.replaceChildren();
      const say = text => body.append(gEl('p', 'ffd-text', text));
      if (guide.step === 'draw') {
        say(
          model.closed
            ? 'The line is drawn and closed. Use Edit to move points, or Insert to add one.'
            : 'Click the table to place points; drag while clicking to bend the line. ' +
                (model.nodes.length
                  ? model.nodes.length + (model.nodes.length === 1 ? ' point so far.' : ' points so far.')
                  : '')
        );
        // Starting shapes are on the start card (and in Tools once there are points).
        const snap = gButton(
          'Snap 10 mm',
          () => {
            $('ff-snap').click();
            render();
          },
          'btn ffd-toggle'
        );
        snap.setAttribute('aria-pressed', $('ff-snap').getAttribute('aria-pressed'));
        body.append(gField('Placing', snap));
      } else if (guide.step === 'close') {
        if (model.closed) {
          say('The loop is closed: ' + $('ff-facts').textContent + '.');
          const row = gEl('div', 'ffd-row');
          row.append(gButton('Reopen loop', () => $('ff-reopen').click()));
          const smooth = $('ff-smooth-selection');
          if (smooth) row.append(gButton('Smooth joins…', () => smooth.click()));
          body.append(gField('Shape', row));
        } else {
          say(
            model.nodes.length < 3
              ? 'Place at least three points first, then close the loop.'
              : 'Click the first point on the canvas, or close the loop here.'
          );
          const close = gButton('Close loop', () => $('ff-close').click());
          close.disabled = model.nodes.length < 3;
          body.append(close);
        }
      } else if (guide.step === 'lanes') {
        const stepper = gEl('div', 'ffd-stepper'),
          count = gEl('b', null, String(model.laneCount));
        const down = gButton(
            '−',
            () => {
              $('ff-count-down').click();
              regenerate();
            },
            'ffd-step-btn'
          ),
          up = gButton(
            '＋',
            () => {
              $('ff-count-up').click();
              regenerate();
            },
            'ffd-step-btn'
          );
        down.setAttribute('aria-label', 'One lane fewer');
        up.setAttribute('aria-label', 'One lane more');
        down.disabled = model.laneCount <= 1;
        up.disabled = model.laneCount >= 8;
        stepper.append(down, count, up);
        body.append(gField('Lanes', stepper));
        const range = gEl('input', 'ffd-range'),
          value = gEl('b', 'ffd-value', $('ff-spacing').value + ' mm'),
          spacing = gEl('div', 'ffd-row');
        Object.assign(range, { type: 'range', min: '40', max: '200', step: '1', value: $('ff-spacing').value });
        range.setAttribute('aria-label', 'Lane spacing in mm');
        range.oninput = () => (value.textContent = range.value + ' mm');
        range.onchange = () => {
          $('ff-spacing').value = range.value;
          regenerate();
        };
        spacing.append(range, value);
        body.append(gField('Spacing', spacing));
        const side = gEl('div', 'ffd-seg');
        for (const [v, label] of [
          ['-1', 'Left'],
          ['1', 'Right'],
        ]) {
          const b = gButton(
            label,
            () => {
              $('ff-side-seg').querySelector(`[data-side="${v}"]`)?.click();
              regenerate();
            },
            'btn sm'
          );
          b.setAttribute('aria-pressed', String($('ff-side').value === v));
          side.append(b);
        }
        body.append(gField('New lanes go', side));
        const laps = gEl('div', 'ffd-laps');
        laps.dataset.units = 'raw';
        g.lanePaths.forEach((l, i) => {
          const s = gEl('span', 'ffd-lap');
          s.style.setProperty(
            '--lane',
            ['#3b82f6', '#e5484d', '#f5a524', '#30a46c', '#8e4ec6', '#12a594', '#e93d82', '#8d8d8d'][i % 8]
          );
          s.textContent = 'L' + (i + 1) + ' ' + (l.lengthMm / 1000).toFixed(2) + ' m';
          laps.append(s);
        });
        body.append(gField('Lap per lane', laps));
      } else if (guide.step === 'heights') {
        if (!model.nodes.length) say('Draw the line first.');
        else {
          const at = Math.max(
              0,
              model.nodes.findIndex(n => n.id === selected)
            ),
            node = model.nodes[at],
            pick = gEl('div', 'ffd-stepper');
          const prev = gButton('‹', () => $('ff-prev-point').click(), 'ffd-step-btn'),
            next = gButton('›', () => $('ff-next-point').click(), 'ffd-step-btn');
          prev.setAttribute('aria-label', 'Previous point');
          next.setAttribute('aria-label', 'Next point');
          pick.append(prev, gEl('b', null, 'P' + (at + 1) + ' of ' + model.nodes.length), next);
          body.append(gField('Point', pick));
          const height = gEl('input', 'ffd-number');
          Object.assign(height, { type: 'number', step: 'any', value: String(node.heightMm || 0), id: 'ffd-height' });
          height.setAttribute('aria-label', 'Height of this point in mm');
          height.onchange = () => {
            $('ff-height').value = height.value;
            $('ff-set-height').click();
          };
          const row = gEl('div', 'ffd-row');
          row.append(height, gEl('span', 'ffd-unit', 'mm above the table'));
          body.append(gField('Height', row));
          const side = gEl('div', 'ffd-side');
          side.innerHTML = $('ff-elevation').innerHTML;
          if (side.innerHTML.trim()) body.append(gField('Side view', side));
          else say('Every point is at table level. Raise a point to build a climb or a bridge.');
        }
      } else {
        say($('ff-check-summary').textContent || 'Close the loop to check it.');
        const list = gEl('div', 'ffd-row');
        [...$('ff-issues').querySelectorAll('button')]
          .slice(0, 3)
          .forEach(b => list.append(gButton(b.textContent, () => b.click(), 'btn sm ffd-issue')));
        if (list.children.length) body.append(list);
        say('When it looks right, Use in builder places the circuit in the Track Builder.');
      }
    }
    // Points: step with ‹ ›; X, Y and Height apply when you leave the field or press Enter.
    const step = by => {
      if (!model.nodes.length) return;
      // With nothing selected, › starts at the first point and ‹ at the last.
      const at = model.nodes.findIndex(n => n.id === selected),
        from = at < 0 ? (by > 0 ? -1 : model.nodes.length) : at,
        i = (from + by + model.nodes.length) % model.nodes.length;
      selected = model.nodes[i].id;
      selectedIds = [selected];
      render();
    };
    $('ff-prev-point').onclick = () => step(-1);
    $('ff-next-point').onclick = () => step(1);
    for (const id of ['ff-x', 'ff-y']) $(id).addEventListener('change', () => $('ff-position').click());
    $('ff-height').addEventListener('change', () => $('ff-set-height').click());
    // Lane spacing from this point.
    for (const b of $('ff-squeeze-seg').querySelectorAll('button'))
      b.onclick = () => {
        const want = b.dataset.squeeze;
        if (want === 'normal') {
          pendingSqueeze = null;
          if (node()?.squeeze) $('ff-squeeze-remove').click();
          else render();
          return;
        }
        pendingSqueeze = want;
        $('ff-squeeze-mode').value = want;
        $('ff-squeeze-mode').dispatchEvent(new Event('change'));
        render();
      };
    $('ff-squeeze-apply').addEventListener('click', () => (pendingSqueeze = null));
    // Lanes: − / + and Left / Right.
    const countBy = by => {
      const next = Math.max(1, Math.min(8, (Number($('ff-count').value) || 1) + by));
      $('ff-count').value = next;
      refs();
    };
    $('ff-count-down').onclick = () => countBy(-1);
    $('ff-count-up').onclick = () => countBy(1);
    for (const b of $('ff-side-seg').querySelectorAll('button'))
      b.onclick = () => {
        $('ff-side').value = b.dataset.side;
        for (const o of $('ff-side-seg').querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
      };
    // Undo history: the last steps in words; choosing one undoes back to before it.
    function describeStep(a, b) {
      let x, y;
      try {
        x = JSON.parse(a);
        y = JSON.parse(b);
      } catch {
        return 'Change';
      }
      const m = x.model,
        n = y.model,
        points = k => k + (k === 1 ? ' point' : ' points');
      if (!m || !n) return 'Change';
      if (n.nodes.length > m.nodes.length) return 'Added ' + points(n.nodes.length - m.nodes.length);
      if (n.nodes.length < m.nodes.length) return 'Removed ' + points(m.nodes.length - n.nodes.length);
      if (m.closed !== n.closed) return n.closed ? 'Closed the loop' : 'Reopened the loop';
      if (m.laneCount !== n.laneCount) return 'Set ' + n.laneCount + (n.laneCount === 1 ? ' lane' : ' lanes');
      const was = new Map(m.nodes.map(p => [p.id, p]));
      const count = test => n.nodes.filter(p => was.get(p.id) && test(was.get(p.id), p)).length;
      const moved = count((o, p) => o.p[0] !== p.p[0] || o.p[1] !== p.p[1]);
      if (moved) return 'Moved ' + points(moved);
      if (count((o, p) => (o.heightMm || 0) !== (p.heightMm || 0))) return 'Changed a height';
      if (count((o, p) => JSON.stringify(o.squeeze) !== JSON.stringify(p.squeeze))) return 'Changed lane spacing';
      if (count((o, p) => !!o.locked !== !!p.locked)) return 'Locked or unlocked a point';
      if (count((o, p) => JSON.stringify([o.in, o.out, o.mode]) !== JSON.stringify([p.in, p.out, p.mode])))
        return 'Changed a bend';
      if (JSON.stringify(x.table) !== JSON.stringify(y.table)) return 'Changed the table';
      if (JSON.stringify(x.profile) !== JSON.stringify(y.profile)) return 'Changed routing settings';
      if (x.name !== y.name) return 'Renamed the track';
      if (JSON.stringify(x.planning) !== JSON.stringify(y.planning)) return 'Changed measurements or pictures';
      return 'Changed settings';
    }
    $('ff-history').addEventListener('click', () => {
      const list = $('ff-history-menu');
      list.replaceChildren();
      const steps = Math.min(history.length, 15);
      const head = document.createElement('p');
      head.className = 'menu-label';
      head.textContent = steps ? 'Undo back to before' : 'Nothing to undo';
      list.append(head);
      for (let k = 1; k <= steps; k++) {
        const i = history.length - k;
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.textContent = describeStep(history[i], k === 1 ? snapshot() : history[i + 1]);
        b.onclick = () => {
          list.hidden = true;
          $('ff-history').setAttribute('aria-expanded', 'false');
          for (let n = 0; n < k; n++) undo();
        };
        list.append(b);
      }
    });
    root.Menus?.attach($('ff-history'), $('ff-history-menu'));

    const summary = document.createElement('div');
    summary.className = 'ff-builder-summary';
    const label = document.createElement('p'),
      button = document.createElement('button');
    button.className = 'btn';
    button.textContent = 'Edit FreeForm';
    button.onclick = launch;
    summary.append(label, button);
    document.querySelector('.catalogue-panel').append(summary);
    const api = {
      render() {
        const s = h.get(),
          p = s.items.find(p => s.defs[p.definitionId].parameters.type === FF.TYPE),
          d = p && s.defs[p.definitionId];
        editButton.hidden = !p;
        summary.hidden = !p;
        document.body.dataset.freeform = String(!!p);
        if (p) {
          document.querySelector('.catalogue-panel h2').textContent = 'FreeForm circuit';
          label.textContent =
            d.parameters.freeform.nodes.length +
            ' anchors · ' +
            d.parameters.freeform.laneCount +
            (d.parameters.freeform.laneCount === 1 ? ' lane · ' : ' lanes · ') +
            (d.geometry.closed ? 'Closed circuit' : 'Editable draft');
          $('duplicate').disabled = true;
        }
      },
      open: launch,
      enter,
    };
    api.render();
    return api;
  }
  root.FreeFormEditor = { init };
})(window);
