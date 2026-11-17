(function (root) {
  'use strict';
  const F = root.Forge,
    T = root.DesignTools,
    $ = id => document.getElementById(id),
    node = (tag, text, cls) => {
      const e = document.createElement(tag);
      if (text) e.textContent = text;
      if (cls) e.className = cls;
      return e;
    };
  function init(h) {
    const section = node('section', null, 'inspector-section');
    const folder = node('details', null, 'inspector-folder');
    folder.id = 'planning-tools';
    folder.append(node('summary', 'Planning tools'));
    const content = node('div', null, 'planning-tools-content');
    folder.append(content);
    section.append(folder);
    $('inspector-selection').after(section);
    const action = (name, fn, host = content) => {
      const b = node('button', name, 'btn small');
      if (/^(Apply|Save|Add this|Download)/.test(name)) b.classList.add('primary');
      b.type = 'button';
      b.onclick = () => {
        try {
          fn();
        } catch (e) {
          if (dialog?.open) {
            let note = dialog.querySelector('[role=alert]');
            if (!note) {
              note = node('p');
              note.setAttribute('role', 'alert');
              dialog.append(note);
            }
            note.textContent = e.message;
          }
          h.message(e.message, true);
        }
      };
      host.append(b);
      return b;
    };
    let measuring = false,
      first = null,
      focusPoint = null,
      curvature = false,
      envelope = false,
      driftMm = 0;
    const measureButton = action('Measure distance / angle', () => {
      measuring = !measuring;
      first = null;
      measureButton.setAttribute('aria-pressed', String(measuring));
      h.message(measuring ? 'Click two points on the canvas. Escape cancels.' : 'Measurement cancelled.');
    });
    measureButton.id = 'measure-tool';
    const measureList = action('Saved measurements…', measurements);
    action('Reference image…', reference);
    action('Find problems…', problems);
    action('Owned pieces / shopping list…', inventory);
    action('Curvature colours', () => {
      curvature = !curvature;
      h.render();
    }).id = 'curvature-tool';
    action('Car clearance envelope…', carEnvelope);
    action('Gap assistant…', gap);
    action('Convert routed layout to FreeForm…', () => h.convert());
    content.append(
      node(
        'p',
        'For continuous spacing and smooth joins on routed sections, convert the layout to FreeForm first. Conversion has a preview and can be undone.',
        'fine'
      )
    );
    const legend = node(
      'p',
      'Slot radius: red <150 · orange <300 · yellow <600 · green <1,200 · blue ≥1,200 mm. Straight slots are blue.',
      'fine'
    );
    legend.hidden = true;
    content.append(legend);
    const selectionFolder = node('details', null, 'selection-tools');
    selectionFolder.append(node('summary', 'Group, lock, replace & ramp'));
    const selectionHost = node('div', null, 'planning-tools-content');
    selectionFolder.append(selectionHost);
    document.querySelector('.inspector-actions').after(selectionFolder);
    action(
      'Group',
      () => {
        const s = h.get();
        h.commit({ items: T.group(s.items, s.defs ? T.expanded(s.items, s.selected) : s.selected) });
      },
      selectionHost
    ).id = 'group-pieces';
    action(
      'Ungroup',
      () => {
        const s = h.get();
        h.commit({ items: T.group(s.items, T.expanded(s.items, s.selected), true) });
      },
      selectionHost
    );
    action(
      'Lock / Unlock',
      () => {
        const s = h.get(),
          ids = T.expanded(s.items, s.selected),
          lock = !s.items.filter(p => ids.includes(p.id)).every(p => p.locked);
        h.commit({ items: s.items.map(p => (ids.includes(p.id) ? { ...p, locked: lock } : p)), allowLocks: true });
      },
      selectionHost
    ).id = 'lock-pieces';
    action('Replace piece…', replacement, selectionHost);
    action('Ramp across selection…', ramp, selectionHost);
    const dialog = node('dialog');
    dialog.id = 'design-tool-dialog';
    dialog.className = 'design-tool-dialog';
    document.body.append(dialog);
    function open(title) {
      dialog.replaceChildren();
      const top = node('div', null, 'dialog-heading');
      top.append(node('h2', title));
      action('×', () => dialog.close(), top);
      dialog.append(top);
      const body = node('div', null, 'design-tool-body');
      dialog.append(body);
      dialog.showModal();
      return body;
    }
    function field(host, label, type = 'number', value = '') {
      const lab = node('label', label, 'field'),
        input = node(type === 'select' ? 'select' : 'input');
      if (type !== 'select') input.type = type;
      input.value = value;
      lab.append(input);
      host.append(lab);
      return input;
    }
    function options(select, values) {
      for (const [value, label] of values) {
        const o = node('option', label);
        o.value = value;
        select.append(o);
      }
    }
    function result(body) {
      const p = node('p', '', 'fine');
      p.setAttribute('role', 'status');
      body.append(p);
      return p;
    }
    function savePlanning(next) {
      h.commit({ planning: F.Planning.validate(next) });
    }
    function measurements() {
      const body = open('Saved measurements'),
        s = h.get();
      body.append(
        node(
          'p',
          'Measurements are fixed drawing coordinates. Check “PDF” to include a dimension in the report.',
          'fine'
        )
      );
      for (const m of s.planning.measurements) {
        const row = node('div', null, 'tool-row');
        body.append(row);
        const q = F.Planning.measurement(m);
        row.append(node('span', `${m.label || 'Distance'}: ${q.lengthMm.toFixed(1)} mm · ${q.angleDeg.toFixed(1)}°`));
        const label = field(row, 'Label', 'text', m.label),
          print = field(row, 'PDF', 'checkbox');
        print.checked = m.print;
        action(
          'Save',
          () => {
            const next = clone(h.get().planning),
              p = next.measurements.find(p => p.id === m.id);
            if (!p) return;
            p.label = label.value;
            p.print = print.checked;
            savePlanning(next);
          },
          row
        );
        action(
          'Find',
          () => {
            dialog.close();
            h.focus({ point: m.a });
          },
          row
        );
        action(
          'Delete',
          () => {
            const next = clone(h.get().planning);
            next.measurements = next.measurements.filter(p => p.id !== m.id);
            savePlanning(next);
            measurements();
          },
          row
        );
      }
      if (!s.planning.measurements.length)
        body.append(node('p', 'Choose Measure distance / angle, then click two points.'));
    }
    async function reference(access = h) {
      const body = open('Calibrated reference image'),
        s = access.get();
      const saveReference = next => access.commit({ planning: F.Planning.validate(next) });
      let loading = 0;
      let image = s.planning.reference?.image,
        ratio = s.planning.reference ? s.planning.reference.heightMm / s.planning.reference.widthMm : 1;
      body.append(
        node(
          'p',
          'Import a photo or floor plan. Calibrate its full image width, or measure a known feature in pixels. The image is locked behind the track. It is saved with the design but excluded from PDF/CAD.',
          'fine'
        )
      );
      const file = field(body, 'Image (PNG or JPEG)', 'file');
      file.accept = 'image/png,image/jpeg';
      const preview = node('canvas');
      preview.width = 500;
      preview.height = 280;
      preview.style.width = 'auto';
      preview.style.maxWidth = '100%';
      preview.style.height = 'auto';
      preview.style.maxHeight = '280px';
      preview.style.alignSelf = 'center';
      body.append(preview);
      let pixels = null,
        pick = [];
      const note = result(body),
        known = field(body, 'Known distance between two clicked image points · mm', 'number', 1000),
        width = field(body, 'Full image width · mm', 'number', s.planning.reference?.widthMm || 3000),
        x = field(body, 'X · mm', 'number', s.planning.reference?.x || 0),
        y = field(body, 'Y · mm', 'number', s.planning.reference?.y || 0),
        angle = field(body, 'Rotation · degrees', 'number', s.planning.reference?.angle || 0),
        opacity = field(body, 'Opacity · 0.05–1', 'number', s.planning.reference?.opacity || 0.35);
      opacity.step = 0.05;
      async function load(data) {
        const token = ++loading,
          img = new Image();
        img.src = data;
        await img.decode();
        if (token !== loading || !dialog.open || !body.isConnected) return;
        ratio = img.height / img.width;
        const canvas = document.createElement('canvas'),
          scale = Math.min(1, 1400 / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        image = canvas.toDataURL('image/jpeg', 0.85);
        pixels = canvas;
        preview.height = Math.max(1, Math.round(preview.width * ratio));
        preview.getContext('2d').drawImage(canvas, 0, 0, preview.width, preview.height);
        pick = [];
        note.textContent = 'Click two points on a known feature to calibrate, or enter the full image width.';
      }
      file.onchange = async () => {
        try {
          const f = file.files[0];
          if (!f) return;
          if (f.size > 20000000) throw Error('Choose an image smaller than 20 MB.');
          image = null;
          pixels = null;
          note.textContent = 'Loading image…';
          const url = URL.createObjectURL(f);
          try {
            await load(url);
          } finally {
            URL.revokeObjectURL(url);
          }
        } catch (e) {
          note.textContent = e.message;
        }
      };
      if (image) load(image).catch(e => (note.textContent = e.message));
      function calibrate() {
        if (!pixels) return;
        const ctx = preview.getContext('2d');
        ctx.clearRect(0, 0, preview.width, preview.height);
        ctx.drawImage(pixels, 0, 0, preview.width, preview.height);
        ctx.fillStyle = '#ed4149';
        for (const p of pick) {
          ctx.beginPath();
          ctx.arc(p[0], p[1], 4, 0, Math.PI * 2);
          ctx.fill();
        }
        if (pick.length === 2) {
          const px = F.dist(...pick);
          if (px < 1 || !Number.isFinite(+known.value) || +known.value <= 0) {
            note.textContent = 'Choose distinct points and a positive real distance.';
            return;
          }
          width.value = ((+known.value / px) * preview.width).toFixed(2);
          note.textContent = 'Calibrated from ' + +known.value + ' mm. Apply to retain this size.';
        } else note.textContent = 'First point marked. Click the other end of the known distance.';
      }
      known.oninput = calibrate;
      preview.onclick = e => {
        if (!pixels) return;
        const b = preview.getBoundingClientRect();
        if (pick.length === 2) pick = [];
        pick.push([
          ((e.clientX - b.left) / b.width) * preview.width,
          ((e.clientY - b.top) / b.height) * preview.height,
        ]);
        calibrate();
      };
      action(
        'Apply image',
        () => {
          if (!image) throw Error('Choose an image first.');
          const next = clone(access.get().planning);
          next.reference = {
            image,
            x: +x.value,
            y: +y.value,
            widthMm: +width.value,
            heightMm: +width.value * ratio,
            angle: +angle.value,
            opacity: +opacity.value,
            visible: true,
          };
          saveReference(next);
          dialog.close();
        },
        body
      );
      action(
        'Show / hide',
        () => {
          const next = clone(access.get().planning);
          if (next.reference) {
            next.reference.visible = !next.reference.visible;
            saveReference(next);
          }
        },
        body
      );
      action(
        'Remove image',
        () => {
          const next = clone(access.get().planning);
          delete next.reference;
          saveReference(next);
          dialog.close();
        },
        body
      );
    }
    function locate(issue) {
      focusPoint = issue.point || null;
      dialog.close();
      h.focus(issue);
    }
    function problems() {
      const s = h.get(),
        body = open('Find problems'),
        list = T.issues(s.items, s.defs, s.table);
      body.append(
        node(
          'p',
          'Click a check to find its location. Checks without a unique point frame the affected pieces.',
          'fine'
        )
      );
      for (const issue of list) action(issue.message, () => locate(issue), body);
      if (!list.length) body.append(node('p', 'No issues found by the current checks.'));
    }
    function inventory() {
      const body = open('Owned pieces & shopping list'),
        s = h.get(),
        rows = T.inventory(s.items, s.defs, s.planning.owned);
      body.append(node('p', 'Quantities belong to this design and are included in its saved file.', 'fine'));
      for (const row of rows) {
        const line = node('div', null, 'tool-row');
        body.append(line);
        action(
          row.name,
          () => {
            dialog.close();
            h.focus({ pieceIds: row.pieceIds });
          },
          line
        );
        line.append(node('span', 'Used: ' + row.used));
        const owned = field(line, 'Owned', 'number', row.owned);
        owned.min = 0;
        owned.step = 1;
        const missing = node('span', 'Missing: ' + row.missing);
        line.append(missing);
        owned.onchange = () => {
          try {
            const next = clone(h.get().planning);
            next.owned[row.key] = Number(owned.value);
            savePlanning(next);
            missing.textContent = 'Missing: ' + Math.max(0, row.used - Number(owned.value));
          } catch (e) {
            h.message(e.message, true);
          }
        };
      }
      action(
        'Download shopping CSV',
        () =>
          h.download(
            'Shopping-list.csv',
            T.shoppingCSV(T.inventory(h.get().items, h.get().defs, h.get().planning.owned))
          ),
        body
      );
    }
    function preview(body, proposal) {
      let svg = body.querySelector('.tool-preview');
      if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('tool-preview');
        body.append(svg);
      }
      const b = F.bounds(proposal.items, proposal.definitions);
      svg.setAttribute('viewBox', [b[0] - 50, b[1] - 50, b[2] + 100, b[3] + 100].join(' '));
      svg.innerHTML = proposal.items
        .map(
          p =>
            `<g transform="translate(${p.x} ${p.y}) rotate(${p.angle}) scale(1 ${p.flip ? -1 : 1})">${F.drawBody(proposal.definitions[p.definitionId])}</g>`
        )
        .join('');
    }
    function replacement() {
      const s = h.get();
      if (s.selected.length !== 1) throw Error('Select one road piece.');
      T.editable(s.items, s.selected);
      const body = open('Replace selected piece'),
        choice = field(body, 'Replacement', 'select'),
        end = field(body, 'Keep connection', 'select');
      options(end, [
        [0, 'End A'],
        [1, 'End B'],
      ]);
      const candidates = s.packs.flatMap(p => p.pieces).filter(d => d.geometry?.connectors.length === 2);
      options(
        choice,
        candidates.map(d => [d.id, d.pack + ' — ' + d.name])
      );
      let proposed = null;
      const message = result(body),
        run = () => {
          try {
            proposed = T.replace(
              s.items,
              s.defs,
              s.selected[0],
              candidates.find(d => d.id === choice.value),
              +end.value
            );
            message.textContent =
              'Other end moves ' +
              proposed.gapMm.toFixed(1) +
              ' mm; direction changes ' +
              proposed.angleDeg.toFixed(1) +
              '°. Neighbours stay in place.';
            preview(body, proposed);
          } catch (e) {
            proposed = null;
            message.textContent = e.message;
          }
        };
      choice.onchange = end.onchange = run;
      run();
      action(
        'Apply replacement',
        () => {
          if (!proposed) throw Error('Choose a compatible replacement.');
          h.commit(proposed, s.token);
          dialog.close();
        },
        body
      );
    }
    function gap() {
      const s = h.get(),
        body = open('Gap assistant'),
        ports = F.connections(s.items, s.defs).open;
      if (ports.length < 2) {
        body.append(node('p', 'At least two open road ends are needed.'));
        return;
      }
      const a = field(body, 'From open end', 'select'),
        b = field(body, 'To open end', 'select'),
        choices = ports.map((p, i) => [
          i,
          s.defs[s.items.find(q => q.id === p.pieceId).definitionId].name +
            ' · ' +
            p.pieceId.slice(0, 6) +
            ' ' +
            (p.index ? 'B' : 'A'),
        ]);
      options(a, choices);
      options(b, choices);
      b.value = '1';
      const summary = result(body),
        results = node('div');
      body.append(results);
      const info = () =>
        (summary.textContent =
          'Gap ' +
          F.dist(ports[+a.value].position, ports[+b.value].position).toFixed(1) +
          ' mm · direction mismatch ' +
          Math.abs(Math.abs(F.wrap(ports[+a.value].angle - ports[+b.value].angle)) - 180).toFixed(1) +
          '°');
      a.onchange = b.onchange = info;
      info();
      action(
        'Search up to 4 catalogue pieces',
        () => {
          results.replaceChildren();
          const out = T.gapSuggestions(
            s.items,
            s.defs,
            ports[+a.value],
            ports[+b.value],
            s.packs.flatMap(p => p.pieces)
          );
          summary.textContent =
            out.found.length +
            ' fit(s). ' +
            (out.limited
              ? 'Bounded search; further combinations may exist.'
              : 'Fixed dimensions; endpoint fit only. Review overlaps and physical clearance.');
          for (const found of out.found)
            action(
              found.items.map(p => found.definitions[p.definitionId].name).join(' + '),
              () => {
                if (s.items.length + found.items.length > 500) throw Error('The 500-piece limit would be exceeded.');
                const proposal = { items: [...s.items, ...found.items], definitions: found.definitions };
                preview(results, proposal);
                results.querySelector('[data-gap-apply]')?.remove();
                const apply = action(
                  'Add this connection',
                  () => {
                    h.commit(proposal, s.token);
                    dialog.close();
                  },
                  results
                );
                apply.dataset.gapApply = 'true';
              },
              results
            );
        },
        body
      );
    }
    function ramp() {
      const s = h.get();
      T.editable(s.items, s.selected);
      const ordered = T.chain(s.items, s.defs, s.selected).order,
        first = ordered[0],
        port = F.ports(first.p, s.defs)[first.entry];
      const body = open('Ramp across selected stretch');
      body.append(
        node(
          'p',
          'Starting at ' +
            first.d.name +
            ' — end ' +
            (first.entry ? 'B' : 'A') +
            ' (' +
            port.position.map(v => v.toFixed(0)).join(', ') +
            ' mm).',
          'fine'
        )
      );
      action(
        'Locate ramp start',
        () => {
          h.focus({ point: port.position, pieceIds: [first.p.id] });
        },
        body
      );
      const start = field(body, 'Starting height · mm', 'number', 0),
        end = field(body, 'Finishing height · mm', 'number', 100),
        note = result(body);
      let proposed;
      action(
        'Preview ramp',
        () => {
          proposed = T.ramp(s.items, s.defs, s.selected, +start.value, +end.value);
          note.textContent =
            'Stretch ' +
            proposed.lengthMm.toFixed(0) +
            ' mm. Steepest piece: ' +
            proposed.maxGradientPct.toFixed(1) +
            '%. Heights blend along the stretch; individual pieces remain straight ramps. Review bridge checks after applying.';
        },
        body
      );
      action(
        'Apply ramp',
        () => {
          if (!proposed) throw Error('Preview the ramp first.');
          h.commit({ items: proposed.items }, s.token);
          dialog.close();
        },
        body
      );
      start.oninput = end.oninput = () => {
        proposed = null;
        note.textContent = 'Preview the changed heights before applying.';
      };
    }
    function carEnvelope() {
      const body = open('Car clearance envelope'),
        s = h.get(),
        size = F.PreviewCar.dimensions(s.car),
        extra = field(body, 'Extra lateral drift allowance · mm', 'number', driftMm);
      body.append(
        node(
          'p',
          `Car: ${size.lengthMm} × ${size.widthMm} mm. Change actual dimensions in Tune profile. Rectangles are centred on the slot: a sampled planning aid, not a vehicle-dynamics or collision simulation.`,
          'fine'
        )
      );
      action(
        'Show / update envelope',
        () => {
          if (!Number.isFinite(+extra.value) || +extra.value < 0 || +extra.value > 300)
            throw Error('Drift allowance must be 0–300 mm.');
          driftMm = +extra.value;
          envelope = true;
          h.render();
        },
        body
      );
      action(
        'Hide envelope',
        () => {
          envelope = false;
          h.render();
        },
        body
      );
      const list = node('div');
      body.append(list);
      action(
        'Check selected pieces (or entire layout)',
        () => {
          list.replaceChildren();
          const selected = s.items.filter(p => s.selected.includes(p.id)),
            issues = T.clearance(selected.length ? selected : s.items, s.defs, s.table, size, +extra.value);
          for (const issue of issues) action(issue.message, () => locate(issue), list);
          if (!issues.length)
            list.append(
              node(
                'p',
                'No conflicts in the sampled checks. Check car overhang and real clearances before construction.'
              )
            );
        },
        body
      );
    }
    const canvas = $('canvas');
    canvas.addEventListener(
      'pointerdown',
      e => {
        if (!measuring || e.button !== 0) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const p = h.world(e);
        if (!first) {
          first = p;
          h.message('Choose the second measurement point.');
        } else {
          const next = clone(h.get().planning);
          next.measurements.push({ id: F.uid(), a: first, b: p, label: '', print: false });
          try {
            savePlanning(next);
          } catch (err) {
            h.message(err.message, true);
          }
          first = null;
          measuring = false;
          measureButton.setAttribute('aria-pressed', 'false');
          h.message('Measurement saved. Open Saved measurements to label it or include it in PDF.');
        }
      },
      true
    );
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && measuring) {
        measuring = false;
        first = null;
        measureButton.setAttribute('aria-pressed', 'false');
        h.message('Measurement cancelled.');
      }
    });
    const drawn = {};
    return {
      render() {
        const s = h.get(true);
        // Rewrite the layers only when their content changed (the reference image can be large).
        const setLayer = (id, html) => {
          if (drawn[id] !== html) $(id).innerHTML = drawn[id] = html;
        };
        setLayer('reference-layer', F.Planning.image(s.planning));
        const size = F.PreviewCar.dimensions(s.car);
        setLayer(
          'design-overlay',
          F.Planning.draw(s.planning) +
            T.overlay(s.items, s.defs, { curvature, envelope, ...size, driftMm }) +
            (focusPoint
              ? `<circle cx="${focusPoint[0]}" cy="${focusPoint[1]}" r="30" fill="none" stroke="#ed4149" stroke-width="4"/>`
              : '')
        );
        $('curvature-tool').setAttribute('aria-pressed', String(curvature));
        legend.hidden = !curvature;
        selectionFolder.hidden = !s.selected.length;
        for (const b of selectionHost.querySelectorAll('button')) b.disabled = !s.selected.length;
      },
      problems,
      referenceFor: reference,
    };
  }
  const clone = v => structuredClone(v);
  root.DesignToolsUI = { init };
})(window);
