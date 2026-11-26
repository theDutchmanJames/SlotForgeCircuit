// Power panel in the Track Builder inspector, and the power marks drawn on the track.
// The calculations live in power.js (TrackPower); this file only shows them and edits the marks.
(function (root) {
  'use strict';
  const $ = id => document.getElementById(id);
  const P = root.TrackPower;
  const esc = s =>
    String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const len = mm =>
    root.Units?.system?.() === 'imperial' ? root.Units.inches(mm) : (mm / 1000).toFixed(mm < 10000 ? 2 : 1) + ' m';
  const laneName = id => 'Lane ' + (String(id).match(/\d+$/)?.[0] || id);
  const KIND = {
    plastic: 'plastic track',
    braid: 'routed wood with braid',
    tape: 'routed wood with copper tape',
  };

  // host: { power(), analysis(), selected(), update(next, message), focus(pieceIds), print(), say(text) }
  function init(host) {
    const body = $('power-body'),
      badge = $('power-badge');
    if (!body) return { render() {} };

    function number(input) {
      const v = input.value.trim();
      if (v === '') return null;
      const n = Number(v.replace(',', '.'));
      return Number.isFinite(n) ? n : NaN;
    }
    function setRules() {
      const a = host.analysis(),
        metres = number($('power-metres')),
        joints = $('power-joints') ? number($('power-joints')) : null;
      const note = $('power-rules-error');
      try {
        if (metres === null || Number.isNaN(metres)) throw Error('Enter the most metres between two feeds.');
        if (Number.isNaN(joints)) throw Error('Enter a whole number of joints, or leave it empty.');
        const rules = { maxMetres: metres, maxJoints: joints === null ? null : Math.round(joints) },
          same = rules.maxMetres === a.usual.maxMetres && rules.maxJoints === a.usual.maxJoints,
          next = { ...host.power() };
        if (same) delete next.rules;
        else next.rules = rules;
        P.settings(next);
        note.textContent = '';
        host.update(next, 'Power tap limits updated.');
      } catch (e) {
        note.textContent = e.message;
      }
    }

    function render() {
      const a = host.analysis(),
        s = host.power(),
        sel = host.selected();
      // Redrawing the panel keeps the field you are typing in, and the open test sheet.
      const active = document.activeElement,
        keep = body.contains(active)
          ? active.id
            ? '#' + active.id
            : active.dataset.point
              ? `[data-lane="${active.dataset.lane}"][data-point="${active.dataset.point}"]`
              : null
          : null,
        sheetOpen = $('power-test')?.open,
        limitsOpen = $('power-limits')?.open;
      badge.textContent =
        a.state === 'problems'
          ? a.problems.length + ' too long'
          : a.state === 'ok'
            ? 'OK'
            : a.state === 'nobase'
              ? 'No base'
              : 'Not set';
      badge.classList.toggle('has-issues', a.state === 'problems');
      const plastic = a.kind === 'plastic' || !a.kind;
      const feeds = (a.feeds || [])
        .map(
          f =>
            `<li><button type="button" class="power-mark ${f.role}" data-focus="${esc(f.pieceId)}">${f.label}</button><span>${
              f.role === 'base' ? 'Power base' : 'Power tap'
            } · ${esc(f.name)}</span><button type="button" class="power-remove" data-remove="${esc(
              f.pieceId
            )}" aria-label="Remove ${f.label}" title="Remove">×</button></li>`
        )
        .join('');
      const stretches = (a.stretches || [])
        .map(x => {
          const why = x.reasons
            .map(r => (r === 'metres' ? `over ${a.rules.maxMetres} m` : `over ${a.rules.maxJoints} joints`))
            .join(' and ');
          return `<li class="${x.tooLong ? 'bad' : 'ok'}"><button type="button" class="linklike" data-stretch="${esc(
            x.from.pieceId
          )}">${x.from.label} → ${x.to.label}</button> · ${len(x.worst.mm)} · ${x.joints} ${
            x.joints === 1 ? 'joint' : 'joints'
          }${x.tooLong ? ` <strong>${why}</strong>` : ''}</li>`;
        })
        .join('');
      const role = sel ? P.role(s, sel) : null,
        canMark = ['ok', 'problems', 'none', 'nobase'].includes(a.state);
      body.innerHTML = `
        <p class="fine power-summary" id="power-summary">${esc(a.message)}</p>
        ${
          canMark
            ? `<div class="power-actions">
          <button type="button" class="btn small" id="power-set-base" ${!sel || role === 'base' ? 'disabled' : ''}>Power base on selected piece</button>
          <button type="button" class="btn small" id="power-set-tap" ${!sel || role === 'tap' ? 'disabled' : ''}>Power tap on selected piece</button>
          ${role ? `<button type="button" class="btn small quiet" id="power-clear">Remove from selected piece</button>` : ''}
        </div>`
            : ''
        }
        ${feeds ? `<ul class="power-feeds" id="power-feeds">${feeds}</ul>` : ''}
        ${stretches ? `<h4 class="power-head">Between feeds</h4><ul class="ts-issues power-stretches" id="power-stretches">${stretches}</ul>` : ''}
        ${
          a.suggestions?.length
            ? `<button type="button" class="btn small" id="power-suggest">Add ${a.suggestions.length} suggested ${
                a.suggestions.length === 1 ? 'tap' : 'taps'
              }</button>`
            : ''
        }
        ${
          a.kind && a.kind !== 'freeform'
            ? `<details class="inspector-subfolder" id="power-limits" ${s.rules ? 'open' : ''}>
        <summary>Limits: ${a.rules.maxMetres} m${a.rules.maxJoints ? ' · ' + a.rules.maxJoints + ' joints' : ''} (${s.rules ? 'your own' : 'usual for ' + KIND[a.kind]})</summary>
        <div class="power-rules">
          <label class="field">Most metres between feeds<input id="power-metres" type="number" min="0.5" max="200" step="0.5" value="${a.rules.maxMetres}" data-units="raw" /></label>
          ${
            plastic
              ? `<label class="field">Most joints between feeds<input id="power-joints" type="number" min="1" max="500" step="1" placeholder="No limit" value="${a.rules.maxJoints ?? ''}" /></label>`
              : ''
          }
          <p class="field-error" id="power-rules-error" role="alert"></p>
          ${s.rules ? `<button type="button" class="btn small quiet" id="power-usual">Use the usual limits</button>` : ''}
        </div></details>`
            : ''
        }
        ${a.stretches?.length ? sheet(a, s) : ''}
        <details class="inspector-subfolder">
          <summary>About these limits</summary>
          <p class="fine">Rules of thumb from slot car guides, not measurements. Plastic track: a feed at least every 5–10 m,
          and every 12–15 joints, because every joint loses some power. Routed wood: braid carries one feed about 30 m round
          a lap; copper tape needs about five times as many feeds. The test sheet is the real check: at any point a lane
          should stay within 1 V of the power base while a car is running (BSCRA track standard).</p>
        </details>`;
      wire(a);
      if (sheetOpen && $('power-test')) $('power-test').open = true;
      if (limitsOpen && $('power-limits')) $('power-limits').open = true;
      if (keep) body.querySelector(keep)?.focus({ preventScroll: true });
    }

    function sheet(a, s) {
      const results = P.results(a, s),
        lanes = results
          .map(lane => {
            const rows = lane.rows
              .map(
                r =>
                  `<tr class="${r.ok === false ? 'bad' : r.ok ? 'ok' : ''}"><th scope="row"><button type="button" class="linklike" data-focus="${esc(
                    r.stretch.test.pieceId
                  )}">${r.stretch.test.label}</button></th><td>${len(r.stretch.test.afterBaseMm)}</td><td><input type="number" step="0.1" min="0" max="60" inputmode="decimal" aria-label="${laneName(
                    lane.lane
                  )} ${r.stretch.test.label} volts" data-lane="${esc(lane.lane)}" data-point="${esc(
                    r.stretch.test.pieceId
                  )}" value="${r.volts ?? ''}" data-units="raw" /></td><td>${
                    r.ok === null ? '' : r.ok ? 'OK' : `−${r.drop.toFixed(1)} V`
                  }</td></tr>`
              )
              .join('');
            return `<table class="power-sheet"><caption>${laneName(lane.lane)}</caption>
              <thead><tr><th>Point</th><th>After base</th><th>Volts</th><th></th></tr></thead>
              <tbody><tr><th scope="row">B</th><td>0</td><td><input type="number" step="0.1" min="0" max="60" inputmode="decimal" aria-label="${laneName(
                lane.lane
              )} power base volts" data-lane="${esc(lane.lane)}" data-point="base" value="${lane.base ?? ''}" data-units="raw" /></td><td></td></tr>${rows}</tbody></table>`;
          })
          .join('');
      return `<details class="inspector-subfolder" id="power-test" ${s.readings ? 'open' : ''}>
        <summary>Test sheet</summary>
        <p class="fine">Set the controller to full with a car running on the lane. Measure across that lane's rails at the
        power base (B), then at each point P: the place farthest from any feed. More than 1 V below B means a bad joint or a
        missing tap.</p>
        ${lanes}
        <button type="button" class="btn small" id="power-print">Save a PDF with the test sheet</button>
      </details>`;
    }

    function wire(a) {
      const mark = role => {
        const id = host.selected();
        if (!id) return;
        host.update(
          P.mark(host.power(), id, role),
          role === 'base' ? 'Power base set.' : role === 'tap' ? 'Power tap added.' : 'Power mark removed.'
        );
      };
      $('power-set-base') && ($('power-set-base').onclick = () => mark('base'));
      $('power-set-tap') && ($('power-set-tap').onclick = () => mark('tap'));
      $('power-clear') && ($('power-clear').onclick = () => mark(null));
      $('power-suggest') &&
        ($('power-suggest').onclick = () => {
          const ids = host.analysis().suggestions;
          host.update(
            ids.reduce((s, id) => P.mark(s, id, 'tap'), host.power()),
            ids.length === 1 ? '1 power tap added.' : ids.length + ' power taps added.'
          );
        });
      $('power-usual') &&
        ($('power-usual').onclick = () => {
          const next = { ...host.power() };
          delete next.rules;
          host.update(next, 'Usual power tap limits restored.');
        });
      for (const id of ['power-metres', 'power-joints']) if ($(id)) $(id).onchange = setRules;
      $('power-print') && ($('power-print').onclick = () => host.print());
      body
        .querySelectorAll('[data-remove]')
        .forEach(
          b => (b.onclick = () => host.update(P.mark(host.power(), b.dataset.remove, null), 'Power mark removed.'))
        );
      body.querySelectorAll('[data-focus]').forEach(b => (b.onclick = () => host.focus([b.dataset.focus])));
      body.querySelectorAll('[data-stretch]').forEach(
        b =>
          (b.onclick = () => {
            const x = a.stretches.find(x => x.from.pieceId === b.dataset.stretch);
            host.focus([x.from.pieceId, x.to.pieceId, x.test.pieceId]);
          })
      );
      body.querySelectorAll('.power-sheet input').forEach(
        input =>
          (input.onchange = () => {
            const v = number(input);
            if (Number.isNaN(v) || (v !== null && (v < 0 || v > 60))) {
              input.setCustomValidity('Enter volts between 0 and 60.');
              input.reportValidity();
              return;
            }
            input.setCustomValidity('');
            host.update(P.reading(host.power(), input.dataset.lane, input.dataset.point, v), null, true);
          })
      );
    }

    return { render };
  }
  root.PowerUI = { init };
})(typeof globalThis !== 'undefined' ? globalThis : this);
