(async () => {
  'use strict';
  const F = window.Forge,
    I = window.SlotForgeIntegration,
    CP = window.CustomPacks,
    CF = window.CatalogueFolders,
    DL = window.DesignLibrary,
    XM = window.TrackExports,
    RA = window.ReferenceArtwork,
    G = F.G,
    $ = id => document.getElementById(id),
    E = G.attrs,
    NS = 'http://www.w3.org/2000/svg',
    STORAGE = 'slotforge.editor.v1',
    CUSTOM = 'slotforge.custom.v1';
  // The version shown in the header comes from integration.js, the single source.
  for (const el of document.querySelectorAll('.sf-version')) el.textContent = 'v' + I.VERSION;
  const DS = window.LocalWorkspace;
  await DS.init();
  if (DS.startupFailed) return;
  DL.setBackend(DS.disk ? DS : null);
  const defs = Object.create(null),
    packs = window.TRACK_PACKS;
  for (const pack of packs)
    for (const d of pack.pieces) if (d.parameters) defs[d.id] = { ...d, geometry: G.derive(d.parameters) };
  // Track sheet and piece-list tabs (declared early: the first catalogue() runs during start-up).
  const LANE_COLOURS = ['#e5484d', '#3b82f6', '#f5a524', '#30a46c', '#8e4ec6', '#12a594', '#e93d82', '#8d8d8d'],
    TAB_NAMES = { 'Digital pieces': 'Digital' };
  let trackSheetTab = 'overview',
    trackSheetDirty = true,
    catalogueTab = 'Straights';
  try {
    catalogueTab = localStorage.getItem('slotforge.catalogue-tab.v1') || 'Straights';
  } catch {}
  let colourByPiece = false,
    pieceColourModel = window.PieceColours.build([]);
  try {
    colourByPiece = localStorage.getItem('slotforge.piece-colours.v1') === 'true';
  } catch {}
  // Pit Board saved state: green tick when saved, yellow dot while saving, amber when it failed.
  // state: 'clean' (saved), 'busy' (saving) or 'error' (not saved); the caller says which.
  function saveState(state, text) {
    const el = document.getElementById('save-state');
    el.textContent = text;
    el.dataset.state = state;
  }
  let exportChoice = 'current',
    exportMenuGeneration = 0,
    exportSourceGeneration = 0;
  let planning = F.Planning.validate(),
    designToolsUI = null;
  // Power base and feed wires on this track (power.js), and the latest check of them.
  let power = F.Power.empty(),
    powerCheck = null,
    powerUI = null;
  let previewCar = F.PreviewCar.settings(),
    routedState = F.Routed.workspace(),
    routedUI = null;
  const routedPack = F.Routed.pack(routedState.settings);
  packs.push(routedPack);
  let cadUI = null,
    freeformUI = null,
    elevationUI = null,
    exportCadAvailable = false,
    exportTrackAvailable = false;
  let guideOrigin = null,
    spaceGuide = null,
    librarySource = null,
    deleteDesignRevision = null;
  const referenceRequests = RA.requestGuard();
  let referenceChoice = null,
    referenceEditingId = null,
    referenceQueue = Promise.resolve(),
    libraryRender = 0,
    designSaveGeneration = 0,
    designSaveBusy = false,
    deleteDesignId = null;
  const folderState = {};
  try {
    Object.assign(folderState, JSON.parse(localStorage.getItem('slotforge.catalogue-folders.v1') || '{}'));
  } catch {}
  let selectedIds = new Set(),
    mirrorNew = false,
    integrationState = I.newState();
  let customPieceSelection = new Set(),
    customSelectionPack = null,
    deletePackPieces = null,
    deletePackBusy = false,
    browserPackBaseline;
  let customLibrary = CP.empty(),
    customs = [],
    items = [],
    selected = null,
    title = 'Club circuit',
    profile = { ...F.presets.Balanced },
    history = [],
    future = [],
    view = { x: -300, y: -600, w: 3500, h: 2300 },
    network = { closed: false, routes: [] },
    snapEnabled = true,
    playing = false,
    carDistances = [],
    speedPlans = [],
    lastTime = 0,
    drag = null,
    space = false,
    storageAvailable = true,
    browserPackUnsaved = false,
    toastTimer,
    confirmAction = null;
  const svg = (tag, attrs = {}, parent) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (parent) parent.append(el);
    return el;
  };
  const say = (message, error = false) => {
    $('toast').textContent = message;
    $('toast').hidden = false;
    $('toast').style.borderColor = error ? '#e5484d' : '#657184';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($('toast').hidden = true), 5500);
    $('status').textContent = message;
  };
  const current = () => items.find(p => p.id === selected),
    defOf = p => defs[p.definitionId],
    meters = n => (n / 1000).toFixed(2) + ' m';
  const selection = () => items.filter(p => selectedIds.has(p.id));
  function setSelection(ids, primary) {
    selectedIds = new Set(window.DesignTools.expanded(items, [...ids]));
    selected = selectedIds.has(primary) ? primary : [...selectedIds].at(-1) || null;
    $('status').textContent = selectedIds.size ? selectedIds.size + ' pieces selected' : 'Ready';
  }
  function rememberMirror(value) {
    mirrorNew = !!value;
    $('mirror-new').checked = mirrorNew;
    try {
      localStorage.setItem('slotforge.mirror-new.v1', JSON.stringify(mirrorNew));
    } catch {}
  }
  function snapshot() {
    return F.Planning.snapshotText({
      items,
      planning,
      previewCar,
      power,
      routedState,
      spaceGuide,
      librarySource,
      title,
      selected,
      selectedIds: [...selectedIds],
      mirrorNew,
      profile,
      integrationState,
    });
  }
  function checkpoint() {
    history.push(snapshot());
    if (history.length > 80) history.shift();
    future = [];
  }
  function restore(s) {
    const p = F.Planning.snapshotValue(s);
    librarySource = librarySource?.id === p.integrationState?.designId ? librarySource : p.librarySource || null;
    items = p.items;
    planning = F.Planning.validate(p.planning);
    previewCar = F.PreviewCar.settings(p.previewCar);
    power = F.Power.settings(p.power);
    routedState = F.Routed.workspace(p.routedState);
    syncRoutedPack();
    spaceGuide = F.validateSpaceGuide(p.spaceGuide);
    title = p.title;
    setSelection(p.selectedIds || (p.selected ? [p.selected] : []), p.selected);
    rememberMirror(p.mirrorNew);
    profile = p.profile;
    integrationState = p.integrationState || I.newState();
    stop();
    $('track-name').value = title;
    updateSliders();
    updateCarControls();
    refresh();
  }
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
  // Edits are saved once editing pauses briefly, not after every change: preparing a save
  // takes several milliseconds on a large track and each save writes the whole layout.
  // Quitting, exporting, backups and closing the window save a waiting change first.
  const SAVE_DELAY = 400;
  let saveTimer = 0;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNow, SAVE_DELAY);
    saveState('busy', DS.disk ? 'Saving to disk…' : 'Saving…');
  }
  DS.deferred?.({ pending: () => !!saveTimer, run: persistNow });
  window.addEventListener('pagehide', () => saveTimer && persistNow());
  function persistNow() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    try {
      const raw = layout(false);
      if (DS.disk) {
        saveState('busy', 'Saving to disk…');
        DS.putCurrent(raw, librarySource)
          .then(() => {
            storageAvailable = true;
            saveState('clean', 'Saved to disk');
          })
          .catch(e => {
            storageAvailable = false;
            saveState('error', 'Not saved to disk');
            say(e.message + ' Export JSON to keep these changes.', true);
          });
      } else {
        localStorage.setItem(STORAGE, JSON.stringify({ ...raw, editorState: { librarySource } }));
        storageAvailable = true;
        saveState('clean', 'Saved in browser');
      }
    } catch (e) {
      saveState('error', 'Saving unavailable');
      storageAvailable = false;
      say(e.message, true);
    }
  }
  function backupStorage(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) localStorage.setItem(key + '.recovery', raw);
    } catch {}
  }
  function activePack() {
    return customLibrary.packs.find(p => p.id === customLibrary.activePackId) || customLibrary.packs[0];
  }
  function allPacks() {
    return [...packs, ...customLibrary.packs];
  }
  function writeBrowserPacks(data) {
    const value = JSON.stringify(data);
    localStorage.setItem(CP.STORAGE, value);
    browserPackBaseline = value;
  }
  async function saveRoutedDefinition(d, flip, packId, packName) {
    const saved = CP.addRouted(customLibrary, d, { packId, packName, flip }),
      data = CP.serialize(saved.library);
    if (DS.disk) await DS.putPacks(data);
    else writeBrowserPacks(data);
    customLibrary = saved.library;
    customs = customLibrary.packs.flatMap(p => p.pieces);
    defs[saved.definition.id] = saved.definition;
    populatePacks();
    renderPackControls();
    renderCustomLibrary();
    renderTrackPacks();
    catalogue();
    return { definition: saved.definition, packId: saved.pack.id, packName: saved.pack.name };
  }
  function paletteBounds(d) {
    const b = d.geometry.boundsMm;
    return d.catalogueFlip ? [b[0], -b[1] - b[3], b[2], b[3]] : b;
  }
  function paletteBody(d) {
    const body = drawBody(d);
    return d.catalogueFlip ? '<g transform="scale(1,-1)">' + body + '</g>' : body;
  }
  async function persistCustom() {
    customs = customLibrary.packs.flatMap(p => p.pieces);
    populatePacks();
    renderPackControls();
    renderCustomLibrary();
    renderTrackPacks();
    catalogue();
    try {
      const data = CP.serialize(customLibrary);
      if (DS.disk) {
        saveState('busy', 'Saving packs to disk…');
        await DS.putPacks(data);
        saveState('clean', 'Saved to disk');
      } else {
        writeBrowserPacks(data);
        browserPackUnsaved = false;
      }
      return true;
    } catch (e) {
      if (!DS.disk) browserPackUnsaved = true;
      saveState('error', 'Packs not saved');
      say('Track packs were not saved: ' + e.message + ' Export a pack file to keep your changes.', true);
      return false;
    }
  }

  function exportDefinition(d) {
    return {
      id: d.id,
      name: d.name,
      sku: d.sku,
      pack: d.pack,
      family: d.family,
      parameters: d.parameters,
      color: d.color,
      status: d.status,
      mirror: d.mirror,
      ...(d.referenceImage ? { referenceImage: d.referenceImage } : {}),
    };
  }
  function layout(withRoutes = true) {
    const used = [...new Set(items.map(p => p.definitionId))];
    return I.prepare(
      {
        format: 'slotforge.layout',
        version: 1,
        title,
        pieces: items,
        definitions: used.map(id => exportDefinition(defs[id])),
        profile,
        workspace: {
          planning,
          previewCar,
          routed: routedState,
          ...(spaceGuide ? { spaceGuide } : {}),
          ...(F.Power.used(power) ? { power } : {}),
        },
      },
      integrationState,
      withRoutes
    );
  }

  function timingOffset(id) {
    return I.offsets(network, integrationState.startFinish).find(s => s.routeId === id)?.offsetMm || 0;
  }
  function renderTimingLine() {
    const layer = $('timing-line');
    layer.replaceChildren();
    const ref = integrationState.startFinish,
      p = items.find(p => p.id === ref?.pieceId);
    if (!p) return;
    const d = defOf(p),
      q = d.parameters;
    if (!d.geometry.lanePaths.length) return;
    const local =
      q.type === 'freeform'
        ? F.FreeForm.crossSection(d, ref.fraction)
        : q.type === 'routed-spline'
          ? F.Routed.Spline.crossSection(q, d.geometry, ref.fraction)
          : q.type === 'straight'
            ? [
                [q.lengthMm * ref.fraction, 0],
                [q.lengthMm * ref.fraction, q.widthMm],
              ]
            : [
                G.pt(q.innerRadiusMm, F.rad(q.angleDeg * ref.fraction)),
                G.pt(q.innerRadiusMm + q.widthMm, F.rad(q.angleDeg * ref.fraction)),
              ];
    if (!local) return;
    const [a, b] = local.map(v => F.point(v, p));
    svg('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: '#fff', 'stroke-width': 10 }, layer);
    svg(
      'line',
      { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: '#20242b', 'stroke-width': 10, 'stroke-dasharray': '10 10' },
      layer
    );
    const label = svg('text', { x: a[0], y: a[1] - 18, fill: '#fff', 'font-size': 20 }, layer);
    label.textContent = 'START / FINISH';
  }
  // Power base, taps, test points and too-long stretches, drawn from the last power check.
  function renderPower() {
    if (!powerUI) return;
    const layer = $('power-layer');
    // Labels about 13 px across at any zoom, never smaller than 24 mm on the track.
    layer.innerHTML = F.Power.used(power)
      ? F.Power.svg(F.Power.marks(powerCheck, network, F.at), Math.max(1, portRadius() / 7.5))
      : '';
  }
  function updateTimingControls() {
    const ref = integrationState.startFinish,
      p = items.find(p => p.id === ref?.pieceId);
    $('timing-section').textContent = p
      ? defOf(p).name + ' · ' + (ref.fraction * 100).toFixed(1) + '%'
      : ref
        ? 'Timing section removed — choose another.'
        : 'Select a road piece, then set the timing line.';
    $('timing-badge').textContent = p ? 'Set' : ref ? 'Choose piece' : 'Not set';
    $('timing-badge').classList.toggle('has-issues', !!ref && !p);
    $('timing-position').disabled = !p;
    $('timing-position').value = ref ? ref.fraction * 100 : 50;
    $('travel-direction').value = integrationState.direction;
    $('timing-lanes').replaceChildren();
    for (const [r, i] of network.routes.map((r, i) => [r, i])) {
      const label = document.createElement('label');
      label.className = 'field';
      label.textContent = 'Lane ' + (i + 1) + ' display name';
      const input = document.createElement('input');
      input.maxLength = 100;
      input.value = integrationState.routeLabels[r.id] || 'Lane ' + (i + 1);
      input.onchange = () => {
        checkpoint();
        integrationState.routeLabels[r.id] = input.value.trim() || 'Lane ' + (i + 1);
        updateInspector();
        persist();
      };
      label.append(input);
      $('timing-lanes').append(label);
    }
    const messages = I.compatibility(items, defs, network, ref).issues.map(i => i.message);
    if (integrationState.requiresLaneRemap)
      messages.unshift('Route topology has changed. Reconfirm lane mapping in SlotForge Timing.');
    if (document.body.dataset.section !== 'export' && $('timing-compatibility'))
      $('timing-compatibility').textContent = messages.join(' ');
  }
  function editTiming(fn) {
    checkpoint();
    stop();
    fn();
    carDistances = [];
    refresh();
  }
  async function pictureBlob(raw) {
    const view = typeof shopView === 'object' ? shopView : { borders: true, size: 'large', background: 'transparent' },
      picture = I.picture(raw, {
        borders: view.borders,
        maxDimension: { small: 800, poster: 2048 }[view.size] || 1600,
      }),
      url = URL.createObjectURL(new Blob([picture.svg], { type: 'image/svg+xml' }));
    let blob;
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = picture.width;
      canvas.height = picture.height;
      const context = canvas.getContext('2d');
      if (view.background !== 'transparent') {
        context.fillStyle = view.background === 'dark' ? '#15171c' : '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(image, 0, 0);
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    } finally {
      URL.revokeObjectURL(url);
    }
    if (!blob || blob.size > 5 * 1024 * 1024) throw Error('Picture exceeds the 5 MiB limit. Choose a smaller size.');
    return { blob, width: picture.width, height: picture.height };
  }
  async function exportPNG(raw = layout(false)) {
    const { blob } = await pictureBlob(raw);
    download(XM.filename(raw.title) + '.png', blob, 'image/png');
    say('Track picture saved.');
  }
  function download(name, text, type = 'application/json') {
    const a = document.createElement('a'),
      url = URL.createObjectURL(new Blob([text], { type }));
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadTrack(raw) {
    const file = XM.portableJSON(raw);
    download(XM.filename(raw.title) + '.slotforge.json', file.text);
    say(
      '“' +
        raw.title +
        '” exported as a track file (.slotforge.json). Use Import track JSON to open it in Circuit.' +
        (file.geometryIncluded ? '' : ' Compact file: slot geometry regenerates from the embedded definitions.')
    );
  }
  function save() {
    try {
      downloadTrack(layout());
    } catch (e) {
      say(e.message, true);
    }
  }
  function confirmReplace(fn) {
    if (!items.length) {
      fn();
      return;
    }
    confirmAction = fn;
    $('confirm-dialog').showModal();
  }
  function applyImport(raw, source = null) {
    const result = I.importLayout(raw);
    const merged = F.mergeDefinitions(result.definitions, result.pieces, defs);
    Object.assign(defs, merged.definitions);
    checkpoint();
    librarySource = source;
    items = merged.pieces;
    planning = F.Planning.validate(result.workspace?.planning);
    previewCar = F.PreviewCar.settings(result.workspace?.previewCar);
    power = F.Power.settings(result.workspace?.power);
    routedState = F.Routed.workspace(result.workspace?.routed);
    syncRoutedPack();
    if (items.length && items.every(p => defOf(p).parameters.routed)) $('pack').value = F.Routed.ID;
    spaceGuide = result.workspace?.spaceGuide || null;
    title = result.title;
    profile = result.profile;
    integrationState = result.state;
    setSelection([]);
    $('track-name').value = title;
    stop();
    updateSliders();
    updateCarControls();
    refresh();
    fit();
    location.hash = 'builder';
    routeSection();
    say(source ? 'Saved track opened.' : 'Track imported. Choose Save to Library to keep a named copy.');
  }
  const drawBody = (d, print = false) =>
    d.parameters.routed
      ? F.Routed.draw(d, print, routedState.display)
      : window.TrackDrawing.body(
          !print && colourByPiece && pieceColourModel.colour(d) ? { ...d, color: pieceColourModel.colour(d) } : d,
          print
        );
  // The colour model and its legend only change when the pieces, packs or setting change.
  let colourInputs = [],
    colourLegendKey = null;
  function updatePieceColours() {
    const inputs = [...allPacks().flatMap(p => p.pieces), ...items.map(defOf)];
    if (inputs.length !== colourInputs.length || inputs.some((d, i) => d !== colourInputs[i])) {
      pieceColourModel = window.PieceColours.build(inputs);
      colourInputs = inputs;
      colourLegendKey = null;
    }
    const legendKey = colourByPiece + '|' + $('pack').value;
    if (legendKey === colourLegendKey) return;
    colourLegendKey = legendKey;
    $('piece-colours').setAttribute('aria-pressed', String(colourByPiece));
    // A Toggle Chip: the tick and aria-pressed show whether it is on.
    $('piece-colours').textContent = 'Colour pieces by size';
    $('piece-colour-key').hidden = !colourByPiece;
    const pack = allPacks().find(p => p.id === $('pack').value);
    $('piece-colour-legend').replaceChildren();
    if (colourByPiece) {
      for (const entry of pieceColourModel.legend(pack?.pieces || [])) {
        const row = document.createElement('div');
        row.className = 'piece-colour-row';
        const swatch = document.createElement('i');
        swatch.style.background = entry.color;
        row.append(swatch, document.createTextNode(entry.label));
        $('piece-colour-legend').append(row);
      }
      if (!$('piece-colour-legend').children.length)
        $('piece-colour-legend').textContent = 'No straight or circular road sizes in this pack.';
    }
  }
  $('piece-colours').onclick = () => {
    colourByPiece = !colourByPiece;
    try {
      localStorage.setItem('slotforge.piece-colours.v1', String(colourByPiece));
    } catch {}
    catalogue();
    renderCanvas();
  };
  function transform(p) {
    return `translate(${p.x} ${p.y}) rotate(${p.angle}) scale(1 ${p.flip ? -1 : 1})`;
  }
  function guideSize(g) {
    return Number(g.lengthMm.toFixed(1)) + ' × ' + Number(g.widthMm.toFixed(1)) + ' mm';
  }
  function renderSpaceGuide() {
    const layer = $('space-guide-layer');
    layer.replaceChildren();
    $('space-guide-lock').hidden = !spaceGuide;
    $('space-guide-edit').textContent = spaceGuide
      ? spaceGuide.kind === 'table'
        ? 'Table…'
        : 'Space guide…'
      : '＋ Space guide';
    if (!spaceGuide) return;
    const g = spaceGuide,
      u = view.w / Math.max(1, $('canvas').clientWidth);
    layer.setAttribute('pointer-events', g.locked ? 'none' : 'auto');
    layer.classList.toggle('locked', g.locked);
    $('space-guide-lock').textContent = g.locked ? 'Unlock guide' : 'Lock guide';
    $('space-guide-lock').setAttribute('aria-pressed', String(g.locked));
    svg(
      'path',
      {
        d: F.Routed.Table.path(g),
        class: 'space-guide-area' + (g.kind === 'table' ? ' space-guide-table' : ''),
        'data-guide': 'move',
      },
      layer
    );
    if (g.shape?.type === 'boards')
      svg(
        'path',
        {
          d: F.Routed.Table.boardPath(g),
          fill: 'none',
          stroke: '#a38c66',
          'stroke-width': 1,
          'stroke-dasharray': '5 4',
          'vector-effect': 'non-scaling-stroke',
          'pointer-events': 'none',
        },
        layer
      );
    const label = svg(
      'text',
      { x: g.x + 10 * u, y: g.y + 22 * u, 'font-size': 12 * u, 'pointer-events': 'none', class: 'space-guide-label' },
      layer
    );
    label.textContent =
      (g.kind === 'table' ? 'Table · ' : 'Available space · ') +
      guideSize(g) +
      (g.shape?.type === 'boards' ? ' · ' + g.shape.boards.length + ' boards' : g.shape ? ' · L shape' : '') +
      (g.locked ? ' · Locked' : '');
    if (!g.locked && g.shape?.type !== 'boards')
      svg(
        'rect',
        {
          x: g.x + g.lengthMm - 7 * u,
          y: g.y + g.widthMm - 7 * u,
          width: 14 * u,
          height: 14 * u,
          class: 'space-guide-handle',
          'data-guide': 'resize',
        },
        layer
      );
  }
  function openSpaceGuide() {
    finishDrag(true);
    const g = spaceGuide || { lengthMm: 3000, widthMm: 1500, locked: false };
    guideOrigin = {
      x: spaceGuide?.x ?? view.x + view.w / 2 - g.lengthMm / 2,
      y: spaceGuide?.y ?? view.y + view.h / 2 - g.widthMm / 2,
    };
    $('guide-length').value = g.lengthMm;
    $('guide-width').value = g.widthMm;
    $('guide-lock').checked = g.locked;
    $('guide-kind').value = g.kind || 'guide';
    $('guide-scale').value = 100;
    $('guide-error').textContent = '';
    $('guide-remove').hidden = !spaceGuide;
    guideShape.fill(g);
    $('space-guide-dialog').showModal();
  }
  const guideShapeHost = document.createElement('div');
  $('guide-scale').closest('.guide-scale-row').before(guideShapeHost);
  const guideShape = window.TableShapeEditor.init(
    'guide-base',
    guideShapeHost,
    () => ({ lengthMm: Number($('guide-length').value), widthMm: Number($('guide-width').value) }),
    {
      setSize: s => {
        $('guide-length').value = s.lengthMm;
        $('guide-width').value = s.widthMm;
        $('guide-kind').value = 'table';
      },
      boardMode: active => {
        for (const id of ['guide-length', 'guide-width']) $(id).readOnly = active;
      },
      track: () =>
        '<g transform="translate(' +
        -(guideOrigin?.x ?? 0) +
        ' ' +
        -(guideOrigin?.y ?? 0) +
        ')">' +
        items.map(p => '<g transform="' + transform(p) + '">' + drawBody(defOf(p)) + '</g>').join('') +
        '</g>',
    }
  );
  for (const id of ['guide-length', 'guide-width']) $(id).addEventListener('input', guideShape.render);
  $('space-guide-edit').onclick = openSpaceGuide;
  $('space-guide-lock').onclick = () => {
    if (!spaceGuide) return;
    finishDrag(true);
    checkpoint();
    spaceGuide = { ...spaceGuide, locked: !spaceGuide.locked };
    refresh();
    say(
      spaceGuide.locked
        ? 'Space guide locked. Build freely over it.'
        : 'Space guide unlocked. Drag its area or resize handle.'
    );
  };
  $('guide-apply-scale').onclick = () => {
    const before = [$('guide-length').value, $('guide-width').value];
    try {
      const factor = Number($('guide-scale').value) / 100;
      if (!Number.isFinite(factor) || factor <= 0) throw Error('Enter a positive scale percentage.');
      const g = F.validateSpaceGuide({
        x: 0,
        y: 0,
        lengthMm: Number($('guide-length').value) * factor,
        widthMm: Number($('guide-width').value) * factor,
        locked: false,
      });
      $('guide-length').value = g.lengthMm;
      $('guide-width').value = g.widthMm;
      guideShape.scale(factor);
      $('guide-scale').value = 100;
      $('guide-error').textContent = '';
    } catch (e) {
      [$('guide-length').value, $('guide-width').value] = before;
      guideShape.render();
      $('guide-error').textContent = e.message;
    }
  };
  $('space-guide-form').onsubmit = e => {
    e.preventDefault();
    try {
      const lengthMm = Number($('guide-length').value),
        widthMm = Number($('guide-width').value),
        g = F.validateSpaceGuide({
          x: guideOrigin?.x ?? 0,
          y: guideOrigin?.y ?? 0,
          lengthMm,
          widthMm,
          kind: $('guide-kind').value,
          locked: $('guide-lock').checked,
          ...(guideShape.read() ? { shape: guideShape.read() } : {}),
        });
      checkpoint();
      spaceGuide = g;
      refresh();
      fit();
      $('space-guide-dialog').close();
      say('Available space: ' + guideSize(g) + (g.locked ? ' · Locked' : ''));
    } catch (error) {
      $('guide-error').textContent = error.message;
    }
  };
  $('guide-remove').onclick = () => {
    checkpoint();
    spaceGuide = null;
    refresh();
    $('space-guide-dialog').close();
    say('Space guide removed. Undo restores it.');
  };
  function renderSnapGuide(guide) {
    const layer = $('snap-guide');
    layer.replaceChildren();
    if (guide)
      svg(
        'path',
        {
          d: guide.d,
          transform: transform(guide.pose),
          fill: 'none',
          stroke: '#76d9f2',
          'stroke-width': 3,
          'stroke-dasharray': '8 5',
          'vector-effect': 'non-scaling-stroke',
        },
        layer
      );
  }
  // Pieces keep their SVG between redraws. A piece is drawn again only when its definition or
  // look changes; a move just updates its transform, and selection adds or removes the outline.
  const pieceNodes = new Map();
  function renderPieces() {
    const routedLook = JSON.stringify(routedState?.display ?? null),
      nodes = [],
      seen = new Set();
    for (const p of items) {
      const d = defOf(p),
        tf = transform(p),
        selected = selectedIds.has(p.id),
        look = (colourByPiece ? pieceColourModel.colour(d) || '' : '') + '|' + (d.parameters.routed ? routedLook : '');
      let n = pieceNodes.get(p.id);
      if (!n || n.def !== d || n.look !== look) {
        const group = svg('g', { 'data-id': p.id, class: 'piece', transform: tf });
        group.innerHTML = drawBody(d);
        const tip = svg('title', {}, group);
        tip.textContent = d.name;
        n = { group, def: d, look, tf, selected: false };
        pieceNodes.set(p.id, n);
      } else if (n.tf !== tf) {
        n.group.setAttribute('transform', tf);
        n.tf = tf;
      }
      if (n.selected !== selected) {
        if (selected)
          n.group.insertBefore(
            svg('path', { d: d.geometry.outlineSvgPath, class: 'selected-outline' }),
            n.group.querySelector(':scope > title')
          );
        else n.group.querySelector(':scope > .selected-outline')?.remove();
        n.selected = selected;
      }
      nodes.push(n.group);
      seen.add(p.id);
    }
    for (const id of pieceNodes.keys()) if (!seen.has(id)) pieceNodes.delete(id);
    const layer = $('roads'),
      current = layer.children;
    if (current.length !== nodes.length || nodes.some((g, i) => current[i] !== g)) layer.replaceChildren(...nodes);
  }
  function renderCanvas(guide = null) {
    updatePieceColours();
    renderSnapGuide(guide);
    renderSpaceGuide();
    renderPieces();
    renderTimingLine();
    renderPower();
    const con = F.connections(items, defs),
      portFragment = document.createDocumentFragment(),
      radius = portRadius();
    for (const port of con.open) {
      const c = svg('circle', {
        cx: port.position[0],
        cy: port.position[1],
        r: radius,
        fill: selectedIds.has(port.pieceId) ? '#f0bd6b' : '#83919d',
        stroke: '#171b21',
        'stroke-width': 1,
        class: 'port',
      });
      portFragment.append(c);
    }
    $('ports').replaceChildren(portFragment);
    $('canvas-empty').hidden = items.length > 0 || !!spaceGuide;
    if (designToolsUI) designToolsUI.render();
  }
  // Connector dots keep the same size on screen at every zoom level.
  const portRadius = () => (4 * view.w) / Math.max(1, $('canvas').clientWidth);
  // Zooming and panning only move the view: the pieces themselves are not redrawn.
  function updateView() {
    const r = $('canvas').getBoundingClientRect();
    view.h = (view.w * (r.height || 650)) / (r.width || 1000);
    $('canvas').setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    const radius = portRadius();
    for (const dot of $('ports').children) dot.setAttribute('r', radius);
    for (const [k, v] of Object.entries({ x: view.x, y: view.y, width: view.w, height: view.h }))
      $('grid-bg').setAttribute(k, v);
    $('zoom-level').textContent = Math.round((100 * 1000) / view.w) + '%';
    renderSpaceGuide();
    renderPower(); // power labels keep their size on screen
  }
  let fitPending = false;
  function fit() {
    // While the builder is hidden the canvas has no size; fit again once it is shown.
    const size = $('canvas').getBoundingClientRect();
    fitPending = !size.width || !size.height;
    let b = F.bounds(items, defs);
    if (spaceGuide) {
      const g = spaceGuide,
        minX = items.length ? Math.min(b[0], g.x) : g.x,
        minY = items.length ? Math.min(b[1], g.y) : g.y,
        maxX = items.length ? Math.max(b[0] + b[2], g.x + g.lengthMm) : g.x + g.lengthMm,
        maxY = items.length ? Math.max(b[1] + b[3], g.y + g.widthMm) : g.y + g.widthMm;
      b = [minX, minY, maxX - minX, maxY - minY];
    }
    fitTo(b);
  }
  // Shows the box b = [x, y, width, height] in the canvas with a margin.
  function fitTo(b) {
    const r = $('canvas').getBoundingClientRect(),
      ratio = (r.width || 1000) / (r.height || 650);
    view.w = Math.max(b[2] + 300, (b[3] + 340) * ratio, 500);
    view.h = view.w / ratio;
    view.x = b[0] + b[2] / 2 - view.w / 2;
    view.y = b[1] + b[3] / 2 - view.h / 2;
    updateView();
    renderCanvas();
  }
  // Zoom to selection (F): the selected pieces fill the view; with nothing selected, the whole track.
  function fitSelection() {
    const group = selection();
    if (!group.length) return fit();
    fitTo(F.bounds(group, defs));
  }
  function zoom(factor, atPoint) {
    const center = atPoint || [view.x + view.w / 2, view.y + view.h / 2],
      u = (center[0] - view.x) / view.w,
      v = (center[1] - view.y) / view.h,
      ratio = view.h / view.w;
    view.w = Math.max(250, Math.min(50000, view.w * factor));
    view.h = view.w * ratio;
    view.x = center[0] - view.w * u;
    view.y = center[1] - view.h * v;
    updateView();
  }
  function world(event) {
    const r = $('canvas').getBoundingClientRect();
    return [
      view.x + ((event.clientX - r.left) / r.width) * view.w,
      view.y + ((event.clientY - r.top) / r.height) * view.h,
    ];
  }
  function inventory() {
    const map = new Map();
    for (const p of items) {
      const d = defOf(p);
      if (!map.has(d.id)) map.set(d.id, { d, count: 0 });
      map.get(d.id).count++;
    }
    return [...map.values()];
  }
  function routedCatalogueDefinition(d) {
    const clone = F.validateDefinition({ ...d, id: 'routed:' + F.uid() }),
      signature = v => JSON.stringify({ ...exportDefinition(v), id: '' }),
      key = signature(clone),
      existing = Object.values(defs).find(v => v.parameters.routed && signature(v) === key);
    if (existing) return existing;
    defs[clone.id] = clone;
    return clone;
  }
  function summary() {
    const roads = items.filter(p => defOf(p).geometry.lanePaths.length && !defOf(p).parameters.foldOverride),
      length = roads.reduce((sum, p) => sum + defOf(p).geometry.centrelineLengthMm, 0);
    return {
      planning: items.filter(p => !!defOf(p).parameters.planning || defOf(p).parameters.foldOverride).length,
      roads: roads.length,
      borders: items.filter(p => defOf(p).parameters.type.endsWith('border')).length,
      references: items.filter(p => defOf(p).parameters.type === 'reference' || defOf(p).parameters.foldOverride)
        .length,
      length,
      bounds: F.bounds(items, defs),
    };
  }
  function updateInspector() {
    powerUI?.render();
    $('builder-cad').hidden = !items.some(p => defOf(p).parameters.routed);
    const s = summary();
    const ff = items.find(p => defOf(p).parameters.type === 'freeform'),
      invalidFreeform = ff && !defOf(ff).geometry.valid;
    $('length-total').nextElementSibling.textContent = ff ? 'Reference slot' : 'Track centreline';
    $('piece-total').textContent = ff ? 1 : s.roads + s.planning;
    $('road-total-label').textContent = ff
      ? 'FreeForm circuit'
      : s.planning
        ? 'Road pieces · includes estimates'
        : 'Road pieces';
    $('border-total').textContent = s.borders;
    $('reference-total').textContent = s.references - s.planning;
    $('length-total').classList.toggle('unknown-length', !!s.planning);
    $('length-total').textContent = invalidFreeform
      ? 'Not calculated'
      : s.planning
        ? s.roads
          ? meters(s.length) + ' + unknown'
          : 'Not calculated'
        : meters(s.length);
    $('footprint').textContent = items.length
      ? `${Math.ceil(s.bounds[2] - 1e-6)} × ${Math.ceil(s.bounds[3] - 1e-6)} mm`
      : '—';
    $('lane-lengths').replaceChildren();
    if (network.closed)
      for (const [r, i] of network.routes.map((r, i) => [r, i])) {
        const row = document.createElement('div');
        row.className = 'lane-row';
        row.innerHTML = `<span><i class="lane-dot"></i>${E(integrationState.routeLabels[r.id] || 'Lane ' + (i + 1))}</span><strong>${meters(r.lengthMm)}</strong>`;
        $('lane-lengths').append(row);
      }
    else {
      const p = document.createElement('p');
      p.className = 'fine';
      p.textContent = s.planning
        ? 'Visual planning uses approximate connection points. Guide slots and lap lengths are not calculated for these pieces.'
        : 'Per-lane circuit lengths appear when the track is connected into one loop.';
      $('lane-lengths').append(p);
    }
    // Pit Board facts: the track at a glance under its name, always in view. Hovering shows each lane.
    {
      const n = Number($('piece-total').textContent) || 0,
        lanes = network.closed ? network.routes.length : 0;
      $('track-facts').textContent = items.length
        ? [
            ff ? 'FreeForm circuit' : `${n} ${n === 1 ? 'piece' : 'pieces'}`,
            $('length-total').textContent,
            $('footprint').textContent,
            lanes ? `${lanes} ${lanes === 1 ? 'lane' : 'lanes'}` : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : 'No pieces yet';
      $('track-facts').title = network.closed
        ? network.routes
            .map((r, i) => `${integrationState.routeLabels[r.id] || 'Lane ' + (i + 1)}: ${meters(r.lengthMm)}`)
            .join('\n')
        : '';
    }
    const group = selection(),
      p = current();
    $('adjust-plastic-lanes').hidden = group.length !== 1 || !F.PlasticLanes.supported(p && defOf(p).parameters);
    $('layer-order').disabled = !group.length || group.length === items.length;
    $('selection-empty').hidden = !!p;
    $('selection').hidden = !p;
    for (const id of ['rotate', 'mirror', 'duplicate', 'delete']) $(id).disabled = !p;
    if (p) {
      const d = defOf(p);
      $('selection-name').textContent = d.name;
      $('selection-code').textContent = `${d.pack} · ${d.sku || 'Custom piece'}`;
      for (const [k, id] of [
        ['x', 'pos-x'],
        ['y', 'pos-y'],
        ['angle', 'pos-angle'],
      ])
        if (document.activeElement !== $(id)) $(id).value = Number(p[k].toFixed(2));
      const q = d.parameters;
      $('selection-details').textContent =
        `${q.foldOverride ? 'Planning-only fold override' : q.planning ? 'Visual planning · approximate magnetic ends' : q.type === 'reference' ? 'Reference picture · approximate display size' : d.status === 'user-defined' ? 'User-defined' : 'Nominal'} · ${q.type === 'reference' ? q.lengthMm + ' × ' + q.widthMm + ' mm display box' : q.widthMm + ' mm wide'}${q.laneCount ? ' · ' + q.laneCount + ' lanes' : ''}${q.laneSpacingMm ? ' · ' + q.laneSpacingMm + ' mm slot spacing' : ''}${p.flip ? ' · reflected' : ''}${q.laneChange ? ' · lane changer · straight-through preview' : ''}`;
      $('mirror').disabled = group.some(p => !defOf(p).mirror);
      if (group.length > 1) {
        $('selection-name').textContent = group.length + ' pieces selected';
        $('selection-code').textContent = 'Drag any selected piece to move the whole selection.';
        $('selection-details').textContent = 'Rotate, mirror, duplicate and delete apply to all selected pieces.';
      }
      $('add-borders').hidden = $('add-borders').disabled = !group.some(p =>
        ['straight', 'curve'].includes(defOf(p).parameters.type)
      );
      document.querySelector('.position-grid').hidden = group.length > 1;
      $('custom-from').hidden = group.length > 1 || d.parameters.type === 'reference';
      $('reference-resize').hidden = group.length > 1 || d.parameters.type !== 'reference';
    }
    const locked = group.some(p => p.locked);
    $('selection-badge').textContent = group.length ? group.length + ' selected' + (locked ? ' · Locked' : '') : 'None';
    for (const id of ['rotate', 'mirror', 'delete', 'pos-x', 'pos-y', 'pos-angle', 'layer-order'])
      if (locked) $(id).disabled = true;
    for (const id of ['pos-x', 'pos-y', 'pos-angle']) if (!locked) $(id).disabled = false;
    $('inspector-selection').classList.toggle('has-selection', !!p);
    $('position-folder').hidden = group.length > 1;
    $('parts-badge').textContent = String(items.length);
    $('inventory').replaceChildren();
    for (const { d, count } of inventory()) {
      const row = document.createElement('div');
      row.className = 'inventory-row';
      const name = document.createElement('span');
      name.textContent = d.name;
      const code = document.createElement('small');
      code.textContent =
        (d.sku || d.pack) +
        (d.parameters.foldOverride
          ? ' · Planning-only fold override'
          : d.parameters.planning
            ? ' · Visual estimate'
            : d.parameters.type === 'reference'
              ? ' · Reference'
              : '');
      name.append(code);
      const n = document.createElement('b');
      n.textContent = count;
      row.append(name, n);
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.title = 'Find these pieces on the track';
      const locate = () => focusIssue({ pieceIds: items.filter(p => p.definitionId === d.id).map(p => p.id) });
      row.onclick = locate;
      row.onkeydown = e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          locate();
        }
      };
      $('inventory').append(row);
    }
    if (!items.length) $('inventory').textContent = 'Your parts will appear here.';
    if (routedUI) routedUI.render();
    if (freeformUI) freeformUI.render();
    if (elevationUI) elevationUI.render();
    $('undo').disabled = !history.length;
    $('redo').disabled = !future.length;
  }
  function refresh(saveLocal = true) {
    network = I.network(items, defs);
    integrationState = I.reconcile(integrationState, network);
    if (!network.closed) stop();
    powerCheck = F.Power.analyse(network, items, defs, power);
    const visual = items.some(p => defOf(p).parameters.planning || defOf(p).parameters.foldOverride),
      known = items.some(p => defOf(p).geometry.lanePaths.length),
      visualEnds = visual
        ? F.connections(
            items.filter(p => defOf(p).parameters.planning),
            defs
          ).open.length
        : 0;
    $('connection-state').textContent = items.some(p => defOf(p).parameters.foldOverride)
      ? 'Planning-only fold override'
      : visual && !known
        ? 'Visual layout · ' + (visualEnds ? visualEnds + ' open ends' : 'ends aligned')
        : network.closed
          ? '● Closed circuit'
          : network.openEnds
            ? `${network.openEnds} open ends`
            : items.length
              ? 'Separate circuits'
              : 'Start a circuit';
    $('connection-state').classList.toggle('open', !network.closed);
    $('measurement-basis').textContent = visual
      ? 'Approximate planning · mm'
      : items.some(p => defOf(p).parameters.routed)
        ? 'Routed dimensions · mm'
        : 'Nominal dimensions · mm';
    $('play').disabled = !network.closed;
    $('play').title = network.reason;
    $('preview-message').textContent =
      visual && !known
        ? 'Approximate visual layout · PDF and parts list available · no slot simulation'
        : network.closed
          ? items.some(p => defOf(p).parameters.laneChange)
            ? 'Straight-through preview · lane switching not simulated'
            : 'One car per lane · slot-following demonstration'
          : network.reason;
    renderCanvas();
    updateInspector();
    updateTimingControls();
    if (playing) rebuildMotion();
    renderLapTimes();
    renderElevationProfile();
    renderTrackSheet();
    if (saveLocal) persist();
  }
  // Lap time per lane from the Tune profile (same speed plan as Live Preview).
  let lapTimer = null;
  function renderLapTimes() {
    clearTimeout(lapTimer);
    lapTimer = setTimeout(() => {
      const box = $('lap-times');
      if (!box) return;
      box.replaceChildren();
      const note = text => {
        const p = document.createElement('p');
        p.className = 'fine';
        p.textContent = text;
        box.append(p);
      };
      if (!network.closed || !network.routes.length) return note('Close the circuit to see lap times.');
      const laps = network.routes.map((r, i) => ({
        label: integrationState.routeLabels?.[r.id] || 'Lane ' + (i + 1),
        lap: F.lapTime(I.travelPlan(r, profile, timingOffset(r.id), integrationState.direction), r.lengthMm),
      }));
      if (laps.some(l => !l.lap)) return note('Lap times are not available for this layout.');
      const fastest = Math.min(...laps.map(l => l.lap.seconds));
      const table = document.createElement('div');
      table.className = 'lap-table';
      for (const { label, lap } of laps) {
        const row = document.createElement('div');
        row.className = 'lap-row' + (lap.seconds === fastest && laps.length > 1 ? ' fastest' : '');
        const diff = lap.seconds - fastest;
        row.innerHTML = `<span class="lap-lane"></span><strong>${lap.seconds.toFixed(2)} s</strong><span class="lap-diff">${
          diff > 0.005 ? '+' + diff.toFixed(2) + ' s' : laps.length > 1 ? 'fastest' : ''
        }</span><span class="lap-speed">avg ${(lap.averageMmS / 1000).toFixed(2)} m/s</span>`;
        row.querySelector('.lap-lane').textContent = label;
        table.append(row);
      }
      box.append(table);
    }, 60);
  }
  // Side view of lane 1: height against distance, inside Heights & bridges.
  // ---------------------------------------------------------------- Track sheet (the inspector's first section)
  // Lap per lane, heights along the lap and checks at a glance; parts against what you own.
  function renderTrackSheet() {
    if (!$('track-sheet')) return;
    // Hidden (another inspector section, the builder not shown): catch up when it appears.
    if (!$('track-sheet').offsetParent) {
      trackSheetDirty = true;
      return;
    }
    trackSheetDirty = false;
    for (const t of ['overview', 'parts']) {
      $('ts-tab-' + t).setAttribute('aria-selected', String(t === trackSheetTab));
      $('ts-' + t).hidden = t !== trackSheetTab;
    }
    // Lap per lane.
    const lanes = $('ts-lanes'),
      note = $('ts-lane-note');
    lanes.replaceChildren();
    note.textContent = '';
    note.className = 'ts-note';
    if (network.closed && network.routes.length) {
      const lengths = network.routes.map(r => r.lengthMm),
        longest = Math.max(...lengths),
        shortest = Math.min(...lengths);
      network.routes.forEach((r, i) => {
        const row = document.createElement('div'),
          name = document.createElement('span'),
          bar = document.createElement('span'),
          fill = document.createElement('i'),
          value = document.createElement('b');
        row.className = 'ts-lane';
        name.textContent = integrationState.routeLabels[r.id] || 'Lane ' + (i + 1);
        bar.className = 'ts-bar';
        fill.style.width = ((r.lengthMm / longest) * 100).toFixed(1) + '%';
        fill.style.background = LANE_COLOURS[i % LANE_COLOURS.length];
        bar.append(fill);
        value.textContent = meters(r.lengthMm);
        row.append(name, bar, value);
        lanes.append(row);
      });
      const diff = longest - shortest;
      if (lengths.length > 1 && diff > Math.max(20, longest * 0.01)) {
        const a = lengths.indexOf(longest),
          label = i => integrationState.routeLabels[network.routes[i].id] || 'Lane ' + (i + 1);
        note.textContent =
          label(a) +
          ' is ' +
          meters(diff) +
          ' longer than ' +
          label(lengths.indexOf(shortest)) +
          '. A crossover would even the lanes out.';
        note.classList.add('warn');
      } else if (lengths.length > 1) note.textContent = 'The lanes are within 1% of each other.';
    } else
      note.textContent = items.length
        ? 'Lap lengths appear when the track is joined into one loop.'
        : 'Add pieces to see each lane’s lap.';
    // Heights along the lap (lane 1).
    const heights = $('ts-heights'),
      route = network.closed ? network.routes[0] : null,
      profile = route && window.ElevationProfile.build(route, items, defs);
    if (profile?.hasHeights)
      heights.innerHTML =
        window.ElevationProfile.svg(profile, { width: 300, height: 90 }) +
        `<p class="ts-note">Highest ${Math.round(profile.maxMm)} mm · steepest ${profile.steepestPct.toFixed(1)}%</p>`;
    else
      heights.innerHTML = `<p class="ts-note">${route ? 'Flat: every piece is at table level.' : 'Join the track into one loop to see its heights.'}</p>`;
    // Checks.
    const issues = items.length ? I.compatibility(items, defs, network, integrationState.startFinish).issues : [],
      checks = $('ts-checks');
    checks.replaceChildren();
    const list = document.createElement('ul');
    list.className = 'ts-issues';
    if (items.length && !network.closed) {
      const li = document.createElement('li');
      li.textContent = 'The track is not one closed loop yet.';
      list.append(li);
    }
    // Power: only once the track has power marks, so tracks that don't use them are left alone.
    if (F.Power.used(power) && powerCheck?.state === 'problems') {
      const li = document.createElement('li');
      li.textContent = 'Power: ' + powerCheck.message.charAt(0).toLowerCase() + powerCheck.message.slice(1);
      list.append(li);
    }
    for (const issue of issues.slice(0, 3)) {
      const li = document.createElement('li');
      li.textContent = issue.message;
      list.append(li);
    }
    if (!list.children.length) {
      const li = document.createElement('li');
      li.className = 'ok';
      li.textContent = items.length ? 'Nothing to check right now.' : 'Nothing placed yet.';
      list.append(li);
    }
    checks.append(list);
    $('ts-tab-overview').textContent = 'Overview';
    // Parts against what you own.
    const rows = window.DesignTools.inventory(items, defs, planning.owned || {}),
      table = $('ts-parts-table');
    table.replaceChildren();
    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'ts-note';
      p.textContent = 'Add pieces to see what the track needs.';
      table.append(p);
    } else {
      const head = document.createElement('div');
      head.className = 'ts-part ts-part-head';
      for (const t of ['Piece', 'Need', 'Own', ''])
        head.append(Object.assign(document.createElement('span'), { textContent: t }));
      table.append(head);
      for (const row of rows) {
        const line = document.createElement('div'),
          name = document.createElement('span'),
          need = document.createElement('b'),
          own = document.createElement('input'),
          state = document.createElement('b');
        line.className = 'ts-part';
        name.className = 'ts-part-name';
        name.textContent = row.name;
        if (row.sku) name.append(Object.assign(document.createElement('small'), { textContent: row.sku }));
        need.textContent = row.used;
        own.type = 'number';
        own.min = '0';
        own.max = '100000';
        own.step = '1';
        own.value = String(row.owned);
        own.className = 'ts-own';
        own.setAttribute('aria-label', 'How many ' + row.name + ' you own');
        own.onchange = () => {
          // Kept to what the saved plan accepts (0–100,000), so a mistyped number is not an error.
          const n = Math.min(100000, Math.max(0, Math.floor(Number(own.value) || 0)));
          checkpoint();
          planning = F.Planning.validate({ ...planning, owned: { ...(planning.owned || {}), [row.key]: n } });
          persist();
          renderTrackSheet();
        };
        state.className = row.missing ? 'ts-buy' : 'ts-have';
        state.textContent = row.missing ? 'buy ' + row.missing : '✓';
        line.append(name, need, own, state);
        table.append(line);
      }
    }
    const short = rows.filter(r => r.missing),
      pieces = short.reduce((n, r) => n + r.missing, 0);
    $('ts-parts-summary').textContent = !rows.length
      ? ''
      : short.length
        ? 'To buy: ' +
          pieces +
          (pieces === 1 ? ' piece' : ' pieces') +
          ' of ' +
          short.length +
          (short.length === 1 ? ' kind.' : ' kinds.')
        : 'You own everything this track needs.';
    $('ts-copy-list').disabled = $('ts-save-list').disabled = !short.length;
    $('ts-tab-parts').textContent = short.length ? 'Parts · buy ' + pieces : 'Parts';
  }
  function trackSheetShopping() {
    return window.DesignTools.inventory(items, defs, planning.owned || {}).filter(r => r.missing);
  }

  // ---------------------------------------------------------------- Piece list: the pack card, options and folder tabs
  function renderPackCard() {
    const p = allPacks().find(x => x.id === $('pack').value) || packs[0];
    if (!p || !$('pack-card')) return;
    const mark = wbMark(p);
    mark.classList.add('lb-mark');
    mark.id = 'pack-card-mark';
    $('pack-card-mark').replaceWith(mark);
    $('pack-card-name').textContent = p.name;
    const n = p.pieces.filter(d => d.geometry || d.referencePlan).length;
    $('pack-card-facts').textContent = [
      p.id === F.Routed.ID ? 'Routed wood' : customLibrary.packs.includes(p) ? 'Your pack' : p.modelScale,
      n + (n === 1 ? ' piece' : ' pieces'),
    ]
      .filter(Boolean)
      .join(' · ');
    $('pack-card').title = $('pack-info').textContent;
    $('pack-card').setAttribute('aria-label', 'Track pack: ' + p.name + '. Choose another pack');
    const menu = $('pack-menu');
    menu.replaceChildren();
    for (const [label, list] of [
      ['Built-in', packs],
      ['Your packs', customLibrary.packs],
    ]) {
      if (!list.length) continue;
      const heading = document.createElement('p');
      heading.className = 'menu-label';
      heading.textContent = label;
      menu.append(heading);
      for (const q of list) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.className = 'lb-pack-item';
        if (q === p) b.setAttribute('aria-current', 'true');
        const m = wbMark(q);
        m.classList.add('lb-mark', 'small');
        b.append(m, document.createTextNode(q.name + (q.inLibrary === false ? ' (draft)' : '')));
        b.onclick = () => {
          $('pack').value = q.id;
          $('pack').onchange();
        };
        menu.append(b);
      }
    }
  }
  function updateFilterBadge() {
    const n = [$('buildable').checked, $('search-all').checked, $('mirror-new').checked, colourByPiece].filter(
        Boolean
      ).length,
      badge = $('catalogue-filter-count');
    badge.textContent = String(n);
    badge.hidden = !n;
  }
  function renderCatalogueTabs(list, active) {
    const host = $('catalogue-tabs');
    host.replaceChildren(
      ...list.map(f => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.dataset.folder = f.name;
        b.setAttribute('aria-selected', String(f.name === active));
        b.title = f.name + ' · ' + f.pieces.length;
        b.append(
          TAB_NAMES[f.name] || f.name,
          Object.assign(document.createElement('span'), { textContent: f.pieces.length })
        );
        return b;
      })
    );
    host.hidden = list.length < 2;
  }

  function renderElevationProfile() {
    let box = $('elevation-profile');
    if (!box) {
      const body = $('height-folder')?.querySelector('.inspector-folder-body');
      if (!body) return;
      box = document.createElement('div');
      box.id = 'elevation-profile';
      box.className = 'elevation-profile';
      body.append(box);
    }
    const route = network.closed ? network.routes[0] : null,
      profileData = route && window.ElevationProfile.build(route, items, defs);
    if (!profileData?.hasHeights) {
      box.innerHTML = `<p class="fine">${
        route
          ? 'All track is at table level. Set heights on pieces to see a side view of the lap.'
          : 'Close the circuit to see a side view of its heights.'
      }</p>`;
      return;
    }
    const steep = profileData.steepestPct > 10;
    box.innerHTML = `<h3>Side view · lane 1</h3>${window.ElevationProfile.svg(profileData)}<p class="fine">Highest ${Math.round(
      profileData.maxMm
    )} mm · steepest ${profileData.steepestPct.toFixed(1)}%${
      steep ? ' — steeper than 10% can be hard for some cars to climb.' : ''
    }</p>`;
    box.classList.toggle('steep', steep);
  }
  function select(id) {
    setSelection(id ? [id] : []);
    renderCanvas();
    updateInspector();
  }
  function add(def, reflected = CP.preferredFlip(def, mirrorNew)) {
    if (items.some(p => defOf(p).parameters.type === 'freeform')) {
      say('FreeForm is one complete circuit. Use New track to begin a piece-based design.', true);
      return false;
    }
    if (items.length >= 500) {
      say('This first iteration supports up to 500 placed pieces.', true);
      return false;
    }
    checkpoint();
    stop();
    let p = F.pose(def, view.x + view.w / 2, view.y + view.h / 2),
      net = F.connections(items, defs);
    p.flip = !!def.mirror && reflected;
    const preferred = net.open.filter(c => c.pieceId === selected).sort((a, b) => b.index - a.index),
      rest = net.open.filter(c => c.pieceId !== selected).reverse();
    const candidate = F.ports(p, defs)[0];
    let attached = false;
    if (candidate && snapEnabled) {
      for (const target of [...preferred, ...rest]) {
        if (!F.compatible(candidate, target) || Math.abs(candidate.heightMm - target.heightMm) >= 0.15) continue;
        const targetPiece = items.find(item => item.id === target.pieceId),
          joined = window.RoutedChecks.joinStraight(
            p,
            def,
            0,
            { ...target, placement: targetPiece, definitionId: targetPiece?.definitionId },
            defs
          ),
          jp = F.ports(joined, defs)[0];
        if (!F.slotsMatch(jp, target, 0.1)) continue;
        p = joined;
        attached = true;
        break;
      }
    }
    if (!attached) {
      const b = def.geometry.boundsMm;
      p.x -= b[0] + b[2] / 2;
      p.y -= (b[1] + b[3] / 2) * (p.flip ? -1 : 1);
    }
    items.push(p);
    setSelection([p.id]);
    refresh();
    say(
      attached
        ? 'Piece connected. Drag to reposition, or add the next piece.'
        : def.parameters.type.endsWith('border')
          ? 'Border added. Position it beside the road; borders move freely.'
          : 'Piece added at the centre of the view.'
    );
    return true;
  }
  function populatePacks() {
    const prev = $('pack').value;
    $('pack').replaceChildren();
    for (const p of allPacks()) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name + (p.inLibrary === false ? ' (draft)' : '');
      $('pack').append(o);
    }
    $('pack').value = allPacks().some(p => p.id === prev) ? prev : packs[0].id;
    const family = $('custom-family').value;
    $('custom-family').replaceChildren();
    for (const p of [{ id: 'custom', name: 'Custom / unbranded' }, ...packs]) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      $('custom-family').append(o);
    }
    $('custom-family').value = family || 'custom';
  }

  function showPackInfo() {
    const p = allPacks().find(p => p.id === $('pack').value);
    if (!p) return;
    if (p.trackSystem === 'routed') {
      $('pack-info').textContent = 'Routed wood · editable slot dimensions · mm';
      return;
    }
    const nominal = p.pieces.filter(d => d.geometry).length;
    const text = [
      p.modelScale ? 'Model scale ' + p.modelScale : '',
      p.trackSystem === 'slotless'
        ? 'Slotless · approximate visual planning'
        : nominal
          ? 'Physical sizes in mm · nominal geometry'
          : 'Reference artwork only',
      p.id === 'slotforge.fleischmann-auto-rallye'
        ? '90 mm slot spacing assumed'
        : p.id === 'slotforge.afx-racing'
          ? 'Modern Tomy connectors'
          : '',
    ]
      .filter(Boolean)
      .join(' · ');
    $('pack-info').textContent = text;
    $('pack-info').title = p.planningNote || '';
  }
  // Recently used pieces, per pack: the Recent row above the catalogue.
  let recentPieces = {};
  try {
    const saved = JSON.parse(localStorage.getItem('slotforge.recent-pieces.v1'));
    if (saved && typeof saved === 'object')
      for (const [k, v] of Object.entries(saved))
        if (Array.isArray(v)) recentPieces[k] = v.filter(x => typeof x === 'string').slice(0, 6);
  } catch {}
  function rememberPiece(packId, id) {
    recentPieces = {
      ...recentPieces,
      [packId]: [id, ...(recentPieces[packId] || []).filter(x => x !== id)].slice(0, 6),
    };
    try {
      localStorage.setItem('slotforge.recent-pieces.v1', JSON.stringify(recentPieces));
    } catch {}
  }
  // A click on a piece in the catalogue (or the Recent row): add it, or plan with its artwork.
  function place(d, pack) {
    if (d.geometry) {
      if (d.parameters.routed && pack.id === F.Routed.ID) {
        if (items.length >= 500) {
          say('This first iteration supports up to 500 placed pieces.', true);
          return;
        }
        add(routedCatalogueDefinition(d), CP.preferredFlip(d, mirrorNew));
      } else add(d);
    } else if (d.referencePlan) {
      const intendedDesign = integrationState.designId;
      referenceQueue = referenceQueue.then(() =>
        integrationState.designId === intendedDesign ? placeReference(d, { automatic: true }) : undefined
      );
    } else openReference(d);
    rememberPiece(pack.id, d.id);
    if (!$('search').value.trim()) catalogue();
  }
  function pieceThumb(d) {
    if (d.asset && !(colourByPiece && window.PieceColours.eligible(d))) {
      const img = document.createElement('img');
      img.src = d.asset;
      img.alt = '';
      img.loading = 'lazy';
      return img;
    }
    const image = svg('svg', {
      viewBox: paletteBounds(d)
        .map((v, i) => (i < 2 ? v - 15 : v + 30))
        .join(' '),
    });
    image.innerHTML = paletteBody(d);
    return image;
  }
  function catalogue() {
    updatePieceColours();
    if (routedUI) routedUI.render();
    showPackInfo();
    renderPackCard();
    updateFilterBadge();
    const pack = allPacks().find(p => p.id === $('pack').value) || packs[0],
      query = $('search').value.trim().toLowerCase(),
      only = $('buildable').checked;
    const matches = d =>
      (!only || d.geometry || d.referencePlan) && (!query || (d.name + ' ' + d.sku).toLowerCase().includes(query));
    const list = pack.pieces.filter(matches);
    // All packs: the search looks through every pack (not the routed templates), one folder per pack.
    const everywhere = query && $('search-all').checked;
    const folders = everywhere
      ? allPacks()
          .filter(p => p.id !== F.Routed.ID)
          .map(p => ({ name: p.name, pieces: p.pieces.filter(matches), pack: p }))
          .filter(f => f.pieces.length)
      : CF.group(list).map(f => ({ ...f, pack }));
    const found = folders.reduce((n, f) => n + f.pieces.length, 0);
    // Without a search, one folder at a time behind tabs; a search shows every folder that matches.
    const tabbed = !query,
      tabs = tabbed ? folders.filter(f => f.pieces.length) : [],
      tab = tabs.find(f => f.name === catalogueTab) || tabs[0] || null;
    renderCatalogueTabs(tabs, tab?.name);
    $('catalogue-count').textContent = everywhere
      ? `${found} pieces · ${folders.length} ${folders.length === 1 ? 'pack' : 'packs'}`
      : list.length + ' pieces';
    $('catalogue').replaceChildren();
    const recent = query
      ? []
      : (recentPieces[pack.id] || [])
          .map(id => list.find(d => d.id === id))
          .filter(Boolean)
          .slice(0, 6);
    if (recent.length) {
      const row = document.createElement('div');
      row.className = 'recent-pieces';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', 'Recently used pieces');
      const label = document.createElement('span');
      label.className = 'recent-label';
      label.textContent = 'Recent';
      row.append(label);
      for (const d of recent) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'recent-piece';
        b.title = 'Add ' + d.name + (d.sku ? ' · ' + d.sku : '');
        b.setAttribute('aria-label', 'Add ' + d.name);
        b.append(pieceThumb(d));
        b.onclick = () => place(d, pack);
        row.append(b);
      }
      $('catalogue').append(row);
    }
    for (const folder of folders) {
      if (query && !folder.pieces.length) continue;
      if (tabbed && tab && folder !== tab) continue;
      const details = document.createElement('details');
      details.className = 'catalogue-folder' + (tabbed ? ' lb-flat' : '');
      const key = folder.pack.id + ':' + folder.name;
      details.open = tabbed || (query ? !!folder.pieces.length : (folderState[key] ?? folder.name === 'Straights'));
      const heading = document.createElement('summary');
      heading.textContent = folder.name;
      const count = document.createElement('span');
      count.textContent = folder.pieces.length;
      heading.append(count);
      details.append(heading);
      details.ontoggle = () => {
        if (query || tabbed || !details.isConnected) return;
        folderState[key] = details.open;
        try {
          localStorage.setItem('slotforge.catalogue-folders.v1', JSON.stringify(folderState));
        } catch {}
      };
      const contents = document.createElement('div');
      contents.className = 'folder-pieces';
      details.append(contents);
      $('catalogue').append(details);
      if (!folder.pieces.length) {
        const empty = document.createElement('p');
        empty.className = 'fine';
        empty.textContent = only
          ? 'No buildable pieces here. Turn off Buildable only to see reference items.'
          : 'No pieces in this folder.';
        contents.append(empty);
      }
      for (const d of folder.pieces) {
        const button = document.createElement('button');
        button.className = 'piece-card';
        button.title = d.geometry
          ? 'Add ' + d.name
          : d.referencePlan
            ? 'Add visual planning piece · approximate'
            : 'Plan with reference artwork';
        button.append(pieceThumb(d));
        const words = document.createElement('span'),
          name = document.createElement('strong'),
          small = document.createElement('small');
        name.textContent = d.name;
        small.textContent =
          (d.sku ? d.sku + ' · ' : '') +
          (d.geometry
            ? d.parameters.foldOverride
              ? 'Planning-only fold override'
              : d.status === 'user-defined'
                ? 'Your dimensions'
                : 'Nominal'
            : d.referencePlan
              ? 'Visual planning · approximate'
              : 'Reference · planning options');
        if (!d.geometry) small.className = 'reference';
        words.append(name, small);
        button.append(words);
        button.onclick = () => place(d, folder.pack);
        contents.append(button);
      }
    }
    if (!(everywhere ? found : list.length)) {
      const n = document.createElement('div');
      n.className = 'no-results';
      n.textContent = customLibrary.packs.some(p => p.id === $('pack').value)
        ? 'This pack is empty. Choose ＋ beside the pack to add its first piece.'
        : only
          ? 'No buildable pieces match. Turn off “Buildable only” to see reference artwork.'
          : 'No matching pieces.';
      $('catalogue').append(n);
    }
  }
  function openReference(source, piece = null) {
    referenceRequests.cancel();
    const preset = source.parameters
      ? packs
          .flatMap(p => p.pieces)
          .find(d => d.family === source.family && d.sku === source.sku && d.name === source.name)
      : null;
    if (!source.referencePlan && preset?.referencePlan) source = { ...source, referencePlan: preset.referencePlan };
    referenceChoice = source;
    referenceEditingId = piece?.id || null;
    const q = source.parameters?.planning || source.referencePlan,
      display = source.parameters || {},
      measure = source.referenceDimensions || {};
    $('reference-name').textContent = source.name;
    const preview = $('reference-image'),
      imageSource = source.referenceImage || source.asset;
    preview.onload = null;
    preview.hidden = !imageSource;
    if (imageSource) preview.src = imageSource;
    else preview.removeAttribute('src');
    $('reference-notes').textContent = (source.notes || []).join(' ');
    $('reference-error').textContent = '';
    $('reference-place').disabled = false;
    $('reference-place').textContent = piece ? 'Apply planning settings' : 'Place in layout';
    $('reference-width').value = display.lengthMm || 350;
    $('reference-height').value = display.widthMm || 200;
    $('reference-snap').checked =
      !!q ||
      (!source.parameters &&
        /straight|curve|chicane|crossover|narrow/i.test(source.name) &&
        !/support|guardrail|pillar|controller/i.test(source.name));
    $('reference-shape').value = q?.type || (/curve|bend|hairpin/i.test(source.name) ? 'curve' : 'straight');
    $('reference-road-width').value = q?.widthMm || measure.widthMm || measure.roadWidthMm || 200;
    $('reference-length').value = q?.lengthMm || measure.lengthMm || measure.roadLengthMm || display.lengthMm || 350;
    $('reference-radius').value = q?.innerRadiusMm || measure.innerRadiusMm || 300;
    $('reference-angle').value = q?.angleDeg || measure.angleDeg || 45;
    $('reference-image').onload = () => {
      const image = $('reference-image');
      if (!display.lengthMm && image.naturalWidth && image.naturalHeight)
        $('reference-height').value = +((350 * image.naturalHeight) / image.naturalWidth).toFixed(1);
    };
    updateReferenceForm();
    $('reference-dialog').showModal();
  }
  function updateReferenceForm() {
    const active = $('reference-snap').checked,
      curve = $('reference-shape').value === 'curve';
    $('reference-display-fields').hidden = active;
    $('reference-planning-fields').hidden = !active;
    $('reference-length-field').hidden = curve;
    $('reference-radius-field').hidden = !curve;
    $('reference-angle-field').hidden = !curve;
  }
  function referenceFormPlan(source) {
    if (!$('reference-snap').checked) return null;
    const previous = source.parameters?.planning || source.referencePlan;
    return F.validatePlanning({
      type: $('reference-shape').value,
      widthMm: Number($('reference-road-width').value),
      lengthMm: Number($('reference-length').value),
      innerRadiusMm: Number($('reference-radius').value),
      angleDeg: Number($('reference-angle').value),
      reflectX: previous?.reflectX || false,
      artworkPaddingMm: previous?.artworkPaddingMm || 0,
    });
  }
  function referenceCanvas(image) {
    const canvas = document.createElement('canvas'),
      ratio = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  const referenceImageAdapter = {
    load: async source => {
      const image = new Image();
      image.src = source;
      await image.decode();
      return image;
    },
    capture: image => referenceCanvas(image).toDataURL('image/png'),
    pixels: image => {
      const canvas = referenceCanvas(image);
      return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    },
    encode: image => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d'),
        pixels = ctx.createImageData(image.width, image.height);
      pixels.data.set(image.data);
      ctx.putImageData(pixels, 0, 0);
      return canvas.toDataURL('image/png');
    },
  };
  async function placeReference(source = referenceChoice, { automatic = false } = {}) {
    if (!source) return;
    const editingId = automatic ? null : referenceEditingId,
      designId = integrationState.designId,
      button = $('reference-place'),
      token = automatic ? null : referenceRequests.begin();
    const active = () =>
      integrationState.designId === designId &&
      (automatic || (referenceRequests.current(token) && $('reference-dialog').open));
    if (!automatic) button.disabled = true;
    try {
      const planning = automatic ? F.validatePlanning(source.referencePlan) : referenceFormPlan(source),
        size = planning
          ? F.planningSize(planning)
          : { lengthMm: Number($('reference-width').value), widthMm: Number($('reference-height').value) },
        mirror = source.parameters ? source.mirror : source.referenceMirror;
      let d = F.validateDefinition({
        id: 'reference:' + F.uid(),
        name: source.name,
        sku: source.sku,
        pack: source.pack,
        family: source.family,
        color: source.color,
        parameters: { type: 'reference', ...size, ...(planning ? { planning } : {}) },
        mirror: mirror !== false,
      });
      const referenceImage = await RA.prepare(source, planning, referenceImageAdapter, active);
      if (!active()) return;
      d = F.validateDefinition({ ...d, ...(referenceImage ? { referenceImage } : {}) });
      d =
        Object.values(defs).find(
          existing =>
            existing.parameters.type === 'reference' &&
            existing.name === d.name &&
            existing.sku === d.sku &&
            existing.family === d.family &&
            existing.pack === d.pack &&
            existing.mirror === d.mirror &&
            I.canonical(existing.parameters) === I.canonical(d.parameters) &&
            existing.referenceImage === d.referenceImage
        ) || d;
      if (editingId) {
        const placed = items.find(p => p.id === editingId);
        if (!placed) throw Error('This piece was removed.');
        if (placed.locked) throw Error('Unlock this piece before editing it.');
        checkpoint();
        defs[d.id] = d;
        placed.definitionId = d.id;
        stop();
        refresh();
      } else {
        defs[d.id] = d;
        add(d);
      }
      if (!automatic) $('reference-dialog').close();
      say(
        planning
          ? 'Visual planning piece ' +
              (editingId ? 'updated.' : 'added.') +
              ' Approximate ends snap; PDF includes its quantity. Slot lengths are not calculated.'
          : 'Reference picture placed. Edit its planning settings to enable approximate snapping.'
      );
    } catch (e) {
      if (!active()) return;
      if (!automatic) $('reference-error').textContent = e.message;
      say('Could not place reference: ' + e.message, true);
    } finally {
      if (!automatic && referenceRequests.current(token) && $('reference-dialog').open) button.disabled = false;
    }
  }
  function selectionLocked() {
    if (selection().some(p => p.locked)) {
      say('Unlock the selected pieces before editing them.', true);
      return true;
    }
    return false;
  }
  function modify(fn) {
    const p = current();
    if (!p || selectionLocked()) return;
    checkpoint();
    stop();
    fn(p);
    refresh();
  }
  function replaceGroup(group) {
    const changed = new Map(group.map(p => [p.id, p]));
    items = items.map(p => changed.get(p.id) || p);
  }
  function arrangeSelection(position) {
    if (!selectedIds.size || !['front', 'back'].includes(position) || selectionLocked()) return;
    const ordered = F.arrange(items, selectedIds, position);
    if (ordered.every((p, i) => p === items[i])) {
      say(position === 'front' ? 'Selection is already at the front.' : 'Selection is already at the back.');
      return;
    }
    checkpoint();
    items = ordered;
    refresh();
    say(position === 'front' ? 'Selection brought to front.' : 'Selection sent to back.');
  }
  // How far Rotate and R turn the selection (the field beside Rotate), 15° unless changed.
  let rotateStep = 15;
  try {
    const saved = Number(localStorage.getItem('slotforge.rotate-step.v1'));
    if (saved >= 0.1 && saved <= 180) rotateStep = saved;
  } catch {}
  function rotate(sign = 1) {
    const group = selection();
    if (!group.length || selectionLocked()) return;
    checkpoint();
    stop();
    const b = F.bounds(group, defs),
      center = [b[0] + b[2] / 2, b[1] + b[3] / 2];
    replaceGroup(
      F.repositionGroup(
        group,
        { x: center[0], y: center[1], angle: 0, flip: false },
        { x: center[0], y: center[1], angle: rotateStep * sign, flip: false }
      )
    );
    refresh();
  }
  function mirror() {
    const p = current(),
      group = selection();
    if (selectionLocked() || !p || group.some(p => !defOf(p).mirror)) return;
    checkpoint();
    stop();
    const d = defOf(p),
      anchor = d.geometry.connectors[0]?.position || [
        d.geometry.boundsMm[0] + d.geometry.boundsMm[2] / 2,
        d.geometry.boundsMm[1] + d.geometry.boundsMm[3] / 2,
      ],
      before = F.point(anchor, p),
      target = { ...p, flip: !p.flip },
      after = F.point(anchor, target);
    target.x += before[0] - after[0];
    target.y += before[1] - after[1];
    replaceGroup(F.repositionGroup(group, p, target));
    rememberMirror(target.flip !== !!d.catalogueFlip);
    refresh();
  }
  function duplicate() {
    if (items.some(p => defOf(p).parameters.type === 'freeform')) {
      say('Use Save to Library as a new copy to duplicate a FreeForm design.');
      return;
    }
    const group = selection();
    if (!group.length) return;
    if (items.length + group.length > 500) {
      say('The layout limit is 500 pieces.', true);
      return;
    }
    checkpoint();
    stop();
    const groups = new Map();
    const copies = group.map(p => {
      if (p.groupId && !groups.has(p.groupId)) groups.set(p.groupId, F.uid());
      return {
        ...p,
        id: F.uid(),
        locked: false,
        ...(p.groupId ? { groupId: groups.get(p.groupId) } : {}),
        x: p.x + 120,
        y: p.y + 120,
      };
    });
    items.push(...copies);
    setSelection(copies.map(p => p.id));
    refresh();
  }
  function remove() {
    if (!selectedIds.size || selectionLocked()) return;
    checkpoint();
    stop();
    items = items.filter(p => !selectedIds.has(p.id));
    setSelection([]);
    refresh();
  }
  function example() {
    checkpoint();
    stop();
    librarySource = null;
    integrationState = I.newState();
    planning = F.Planning.validate();
    power = F.Power.empty();
    spaceGuide = null;
    routedState = F.Routed.workspace();
    syncRoutedPack();
    items = [];
    const seq = [
      ...Array(3).fill('carrera:20509'),
      ...Array(6).fill('carrera:20572'),
      ...Array(3).fill('carrera:20509'),
      ...Array(6).fill('carrera:20572'),
    ];
    let last;
    for (const id of seq) {
      const d = defs[id];
      let p = F.pose(d, 0, 0);
      if (last) p = F.join(p, d, 0, F.ports(last, defs)[1]);
      items.push(p);
      last = p;
    }
    title = 'Club circuit';
    $('track-name').value = title;
    setSelection([]);
    profile = { ...F.presets.Balanced };
    updateSliders();
    updateCarControls();
    refresh();
    fit();
  }
  function newTrack() {
    checkpoint();
    stop();
    librarySource = null;
    integrationState = I.newState();
    planning = F.Planning.validate();
    power = F.Power.empty();
    spaceGuide = null;
    routedState = F.Routed.workspace();
    syncRoutedPack();
    items = [];
    setSelection([]);
    title = 'Untitled circuit';
    $('track-name').value = title;
    refresh();
    fit();
  }
  // ---------------------------------------------------------------- templates
  function loadTemplate(template, pack) {
    newTrack();
    items = window.TrackTemplates.place(template.definitionIds, defs, F);
    title = template.name + ' · ' + pack.name;
    $('track-name').value = title;
    refresh();
    fit();
    say(`${template.name} loaded from ${pack.name}. Change it as you like, then Save to Library.`);
  }
  function templatePreview(definitionIds) {
    const placed = window.TrackTemplates.place(definitionIds, defs, F),
      b = F.bounds(placed, defs),
      pad = Math.max(b[2], b[3]) * 0.06;
    const body = placed
      .map(
        p =>
          `<g transform="translate(${p.x} ${p.y}) rotate(${p.angle}) scale(1 ${p.flip ? -1 : 1})">${F.drawBody(defOf(p), true)}</g>`
      )
      .join('');
    return `<svg viewBox="${b[0] - pad} ${b[1] - pad} ${b[2] + pad * 2} ${b[3] + pad * 2}" aria-hidden="true">${body}</svg>`;
  }
  function openTemplates() {
    const dialog = $('template-dialog'),
      select = $('template-pack'),
      grid = $('template-grid');
    const plastic = packs.filter(p => p.id !== F.Routed.ID);
    select.replaceChildren(...plastic.map(p => new Option(p.name, p.id)));
    select.value = plastic.some(p => p.id === $('pack').value) ? $('pack').value : plastic[0].id;
    const render = () => {
      const pack = plastic.find(p => p.id === select.value),
        list = window.TrackTemplates.forPack(pack, defs);
      grid.replaceChildren();
      if (!list.length) {
        const p = document.createElement('p');
        p.className = 'fine';
        p.textContent = `${pack.name} has reference artwork only, so it has no ready-made layouts. Choose another pack.`;
        grid.append(p);
      }
      for (const template of list) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'template-card';
        card.innerHTML = `<span class="template-art">${templatePreview(template.definitionIds)}</span><strong></strong><span></span>`;
        card.querySelector('strong').textContent = template.name;
        card.querySelector('span:last-child').textContent = `${template.text} ${template.definitionIds.length} pieces.`;
        card.onclick = () => {
          dialog.close();
          confirmReplace(() => loadTemplate(template, pack));
        };
        grid.append(card);
      }
      const eight = document.createElement('button');
      eight.type = 'button';
      eight.className = 'template-card';
      eight.innerHTML =
        '<span class="template-art template-art-text" aria-hidden="true">∞</span><strong>Figure eight with bridge</strong><span>A FreeForm drawing for routed wood: one crossing passes over the other.</span>';
      eight.onclick = () => {
        dialog.close();
        // Open FreeForm first (it restores its saved draft), then start the figure eight.
        location.hash = 'freeform';
        routeSection();
        $('ff-eight').click();
      };
      grid.append(eight);
    };
    select.onchange = render;
    render();
    dialog.showModal();
  }
  $('open-template').hidden = false;
  $('open-template').onclick = openTemplates;

  function rebuildMotion() {
    // One car per lane.
    speedPlans = network.routes.map(r => I.travelPlan(r, profile, timingOffset(r.id), integrationState.direction));
  }
  // Lane 1 red and lane 2 blue as before, then a clearly different colour per lane.
  const CAR_COLOURS = ['#ec6167', '#66b4e7', '#5cc46a', '#f2c94c', '#f2994a', '#a77ce8', '#4fd1c5', '#f07cb8'];
  const motion = F.animationLoop(requestAnimationFrame, cancelAnimationFrame, frame);
  function stop() {
    motion.stop();
    playing = false;
    $('play').textContent = '▶ Live preview';
    $('cars').replaceChildren();
    lastTime = 0;
  }
  function togglePlay() {
    if (playing) {
      stop();
      return;
    }
    if (!network.closed) return;
    playing = true;
    rebuildMotion();
    $('play').textContent = 'Ⅱ Pause preview';
    lastTime = 0;
    motion.start();
  }
  function frame(t) {
    if (!playing) return;
    const dt = lastTime ? Math.min(0.05, (t - lastTime) / 1000) : 0;
    lastTime = t;
    const factor = Number($('playback').value);
    const body = [];
    for (const [i, r] of network.routes.entries()) {
      if (!speedPlans[i]) continue; // Lanes changed while playing: the next start picks them up.
      carDistances[i] = ((carDistances[i] || 0) + speedPlans[i](carDistances[i] || 0) * dt * factor) % r.lengthMm;
      const q = I.atTravel(r, carDistances[i], timingOffset(r.id), integrationState.direction),
        drift = Math.sign(q.curvature) * profile.drift * Math.min(1, Math.abs(q.curvature) * 350);
      body.push(
        `<g class="car" transform="translate(${q.x} ${q.y}) rotate(${q.heading})"><g transform="rotate(${drift})">${F.PreviewCar.draw(previewCar, CAR_COLOURS[i % CAR_COLOURS.length])}</g><circle r="2" fill="white"/></g>`
      );
    }
    $('cars').innerHTML = body.join('');
  }
  const sliderSpecs = [
    ['speed', 'Top speed', 200, 3000, 50, v => (v / 1000).toFixed(2) + ' m/s'],
    ['acceleration', 'Acceleration', 100, 4000, 100, v => (v / 1000).toFixed(1) + ' m/s²'],
    ['brake', 'Braking', 100, 5000, 100, v => (v / 1000).toFixed(1) + ' m/s²'],
    ['corner', 'Cornering speed', 0.2, 0.95, 0.01, v => Math.round(v * 100) + '%'],
    ['drift', 'Visual drift', 0, 30, 1, v => v + '°'],
  ];
  function updateCarControls() {
    const s = previewCar,
      d = F.PreviewCar.dimensions(s),
      custom = s.scale === 'custom';
    $('preview-car-scale').value = s.scale;
    for (const [key, id] of [
      ['lengthMm', 'preview-car-length'],
      ['widthMm', 'preview-car-width'],
    ]) {
      $(id).value = Number(d[key].toFixed(6));
      $(id).disabled = !custom;
    }
    $('preview-car-apply').hidden = !custom;
    $('preview-car-error').textContent = '';
    $('preview-car-size').textContent = d.lengthMm.toFixed(2) + ' × ' + d.widthMm.toFixed(2) + ' mm · length × width';
  }
  function setCarSize(raw) {
    try {
      const next = F.PreviewCar.settings(raw);
      if (JSON.stringify(next) !== JSON.stringify(previewCar)) {
        checkpoint();
        previewCar = next;
        updateInspector();
        persist();
      }
      updateCarControls();
    } catch (e) {
      $('preview-car-error').textContent = e.message;
    }
  }
  $('preview-car-scale').onchange = () => {
    const scale = $('preview-car-scale').value;
    setCarSize(
      scale === 'custom' ? { version: 1, scale, ...F.PreviewCar.dimensions(previewCar) } : { version: 1, scale }
    );
  };
  $('preview-car-apply').onclick = () =>
    setCarSize({
      version: 1,
      scale: 'custom',
      lengthMm: $('preview-car-length').value.trim() === '' ? NaN : Number($('preview-car-length').value),
      widthMm: $('preview-car-width').value.trim() === '' ? NaN : Number($('preview-car-width').value),
    });
  for (const id of ['preview-car-length', 'preview-car-width'])
    $(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('preview-car-apply').click();
      }
    });

  function updateSliders() {
    for (const [k, , min, max, step, label] of sliderSpecs) {
      if ($('tune-' + k)) {
        $('tune-' + k).value = profile[k];
        $('value-' + k).textContent = label(profile[k]);
      }
    }
    $('preset').value =
      Object.keys(F.presets).find(k => JSON.stringify(F.presets[k]) === JSON.stringify(profile)) || 'Custom';
    renderLapTimes();
  }
  function initSliders() {
    for (const [k, name, min, max, step, label] of sliderSpecs) {
      const lab = document.createElement('label');
      lab.className = 'slider-label';
      lab.htmlFor = 'tune-' + k;
      lab.append(document.createTextNode(name));
      const output = document.createElement('output');
      output.id = 'value-' + k;
      lab.append(output);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = min;
      input.max = max;
      input.step = step;
      input.id = 'tune-' + k;
      input.setAttribute('aria-label', name);
      input.oninput = () => {
        profile[k] = Number(input.value);
        updateSliders();
        if (playing) rebuildMotion();
        persist();
      };
      $('sliders').append(lab, input);
    }
    updateSliders();
  }
  let customDraft = null,
    customToBuilder = false,
    customSlotOffsets = null;
  const plasticCustomHost = document.createElement('div');
  $('piece-form').querySelector('[name=family]').closest('label').after(plasticCustomHost);
  const plasticCustomFields = window.PlasticLanesUI.fields(plasticCustomHost, updateCustom);
  const plasticUI = window.PlasticLanesUI.init({
    packs: () => customLibrary.packs,
    apply: async (draft, packId, token) => {
      const placement = items.find(p => p.id === token.pieceId);
      window.DesignTools.editable(items, [token.pieceId]);
      if (integrationState.designId !== token.designId || placement?.definitionId !== token.definitionId)
        throw Error('The selected piece has changed. Reopen Lane spacing.');
      let d = F.validateDefinition({ ...draft, id: 'custom:' + F.uid() });
      if (packId) {
        const next = CP.read(CP.serialize(customLibrary)),
          pack = next.packs.find(p => p.id === packId);
        if (!pack) throw Error('Choose an existing custom pack.');
        if (next.packs.reduce((n, p) => n + p.pieces.length, 0) >= 500)
          throw Error('The custom library supports up to 500 pieces.');
        d = { ...d, pack: pack.name };
        pack.pieces.push(d);
        pack.inLibrary = true;
        next.activePackId = pack.id;
        const data = CP.serialize(next);
        if (DS.disk) await DS.putPacks(data);
        else writeBrowserPacks(data);
        customLibrary = next;
        customs = next.packs.flatMap(p => p.pieces);
        populatePacks();
        renderPackControls();
        renderCustomLibrary();
        renderTrackPacks();
      }
      if (
        integrationState.designId !== token.designId ||
        !items.includes(placement) ||
        placement.definitionId !== token.definitionId
      )
        throw Error('The layout changed while saving. The pack variant was kept; reopen Lane spacing to apply it.');
      checkpoint();
      stop();
      defs[d.id] = d;
      placement.definitionId = d.id;
      refresh();
      catalogue();
      say(
        'Lane spacing updated. Road outline and connections kept in place.' + (packId ? ' Variant saved to pack.' : '')
      );
    },
  });
  $('adjust-plastic-lanes').onclick = () => {
    const p = current();
    if (p && selection().length === 1 && F.PlasticLanes.supported(defOf(p).parameters))
      plasticUI.open(defOf(p), { pieceId: p.id, definitionId: p.definitionId, designId: integrationState.designId });
  };
  function familyDraft() {
    const f = $('piece-form').elements;
    return CP.curveParameters({
      innerRadiusMm: Number(f.baseRadiusMm.value),
      widthMm: Number(f.widthMm.value),
      angleDeg: Number(f.angleDeg.value),
      laneCount: Number(f.laneCount.value),
      laneSpacingMm: Number(f.laneSpacingMm.value),
    });
  }
  function matchingCurve() {
    const f = $('piece-form').elements;
    return !customSlotOffsets && f.type.value === 'curve' && f.curveMode.value === 'family';
  }
  function updateCurveHelper() {
    const f = $('piece-form').elements,
      matching = matchingCurve();
    $('curve-helper').hidden = f.type.value !== 'curve';
    $('curve-family-fields').hidden = !matching;
    f.baseRadiusMm.disabled = !matching;
    f.radiusNumber.disabled = !matching;
    f.innerRadiusMm.readOnly = matching;
    f.curveMode.disabled = !!customSlotOffsets;
    $('curve-family-preview').hidden = !matching;
    if (!matching) return;
    const base = familyDraft(),
      selected = Number(f.radiusNumber.value),
      p = CP.curveParameters(base, selected);
    f.innerRadiusMm.value = p.innerRadiusMm;
    if (/^My (straight|curve)$/.test(f.name.value) || /^R[1-8] curve ·/.test(f.name.value))
      f.name.value = 'R' + selected + ' curve · ' + p.angleDeg + '°';
    const count = Math.max(4, selected),
      rows = [],
      paths = [],
      extent = base.innerRadiusMm + count * base.widthMm;
    for (let n = 1; n <= count; n++) {
      const r = base.innerRadiusMm + (n - 1) * base.widthMm,
        shape = G.derive({ ...base, innerRadiusMm: r, angleDeg: 90 });
      paths.push(G.path(shape.outlineSvgPath, n === selected ? '#e5484d' : '#303a46', '#9da9b8', 2));
      paths.push(
        `<text x="${(r + base.widthMm / 2) * 0.707}" y="${-(r + base.widthMm / 2) * 0.707}" fill="white" text-anchor="middle" font-size="${extent / 28}">R${n}</text>`
      );
      rows.push(
        `<tr${n === selected ? ' class="active"' : ''}><td>R${n}</td><td>${+r.toFixed(2)}</td><td>${+(r + base.widthMm).toFixed(2)}</td></tr>`
      );
    }
    $('curve-family-diagram').setAttribute('viewBox', `-20 ${-extent - 20} ${extent + 40} ${extent + 40}`);
    $('curve-family-diagram').innerHTML = paths.join('');
    $('curve-family-table').innerHTML =
      '<table><thead><tr><th>Radius</th><th>Inner edge · mm</th><th>Outer edge · mm</th></tr></thead><tbody>' +
      rows.join('') +
      '</tbody></table>';
    const gap = base.widthMm - (base.laneCount - 1) * base.laneSpacingMm,
      whole = 360 / base.angleDeg;
    $('curve-family-note').textContent =
      `Nesting diagram shows 90° for clarity. Selected piece: ${base.angleDeg}°; ${Number.isInteger(whole) ? whole + ' pieces make a full circle' : 'this angle does not divide a full circle evenly'}. Slots across the join between radii: ${+gap.toFixed(2)} mm${Math.abs(gap - base.laneSpacingMm) > 0.01 ? ' (different from the ' + base.laneSpacingMm + ' mm spacing within a piece)' : ''}. Settings are remembered for this pack. Existing pieces keep their dimensions.`;
  }
  function formDraft() {
    const f = $('piece-form').elements,
      isSwitch = f.type.value.startsWith('lane-'),
      p = { type: isSwitch ? 'straight' : f.type.value, widthMm: Number(f.widthMm.value) };
    if (isSwitch) {
      p.laneChange = f.type.value.slice(5);
      p.switchStartMm = Number(f.switchStartMm.value);
      p.switchEndMm = Number(f.switchEndMm.value);
    }
    if (p.type.startsWith('straight')) p.lengthMm = Number(f.lengthMm.value);
    else {
      p.innerRadiusMm = Number(f.innerRadiusMm.value);
      p.angleDeg = Number(f.angleDeg.value);
    }
    if (p.type.endsWith('border')) p.side = f.side.value;
    else if (customSlotOffsets) p.laneOffsetsMm = [...customSlotOffsets];
    else {
      p.laneCount = isSwitch ? 2 : Number(f.laneCount.value);
      p.laneSpacingMm = Number(f.laneSpacingMm.value);
    }
    const laneAdjustment = plasticCustomFields.read(p);
    if (laneAdjustment) p.laneAdjustment = laneAdjustment;
    return F.validateDefinition({
      id: 'custom:preview',
      name: f.name.value,
      pack: activePack().name,
      family: f.family.value,
      parameters: p,
      color: f.color.value,
      status: 'user-defined',
    });
  }
  function updateCustom() {
    const f = $('piece-form').elements,
      curve = f.type.value.startsWith('curve'),
      border = f.type.value.endsWith('border'),
      isSwitch = f.type.value.startsWith('lane-');
    if (isSwitch) f.laneCount.value = 2;
    for (const [field, show] of [
      ['length', !curve],
      ['radius', curve],
      ['angle', curve],
      ['lanes', !border && !isSwitch && !customSlotOffsets],
      ['spacing', !border && !customSlotOffsets],
      ['side', border],
      ['switch-start', isSwitch],
      ['switch-end', isSwitch],
    ]) {
      const el = document.querySelector(`[data-field="${field}"]`);
      el.hidden = !show;
      for (const input of el.querySelectorAll('input,select')) input.disabled = !show;
    }
    $('measured-slots').hidden = !customSlotOffsets || border;
    $('measured-slots-note').textContent = customSlotOffsets
      ? 'Preserved slot positions from the road edge: ' + customSlotOffsets.join(' / ') + ' mm.'
      : '';
    try {
      updateCurveHelper();
      customDraft = formDraft();
      const b = customDraft.geometry.boundsMm;
      $('custom-preview').setAttribute('viewBox', `${b[0] - 25} ${b[1] - 25} ${b[2] + 50} ${b[3] + 50}`);
      $('custom-preview').innerHTML = window.TrackDrawing.body(customDraft);
      $('custom-summary').textContent = customDraft.geometry.lanePaths.length
        ? 'Slot lengths: ' + customDraft.geometry.lanePaths.map(l => l.lengthMm.toFixed(1) + ' mm').join(' / ')
        : 'Border footprint only. Adds no road or lane length.';
      if (customDraft.geometry.alternateLanePaths) {
        $('custom-summary').textContent +=
          ' · Change routes: ' +
          customDraft.geometry.alternateLanePaths.map(r => r.lengthMm.toFixed(1) + ' mm').join(' / ') +
          '. Preview and circuit totals use the straight-through lanes. These curves approximate your measured switch.';
      }
      $('custom-error').textContent = '';
      $('create-piece').disabled = false;
    } catch (e) {
      customDraft = null;
      $('custom-error').textContent = e.message;
      $('custom-summary').textContent = 'Adjust the measurements to create a valid piece.';
      $('custom-preview').replaceChildren();
      $('create-piece').disabled = true;
    }
  }
  function openCustom(from) {
    customSlotOffsets = from?.parameters.laneOffsetsMm ? [...from.parameters.laneOffsetsMm] : null;
    customToBuilder = document.body.dataset.section === 'builder';
    $('create-piece').textContent = customToBuilder ? 'Create & add to track' : 'Add piece to pack';
    $('piece-pack-name').textContent = 'Adding to ' + activePack().name;
    const form = $('piece-form');
    form.reset();
    plasticCustomFields.set(from?.parameters.laneAdjustment);
    const f = form.elements;
    if (!from && activePack().curveFamily) {
      const base = activePack().curveFamily;
      for (const key of ['widthMm', 'angleDeg', 'laneCount', 'laneSpacingMm']) f[key].value = base[key];
      f.baseRadiusMm.value = base.innerRadiusMm;
    }
    if (from) {
      f.curveMode.value = 'independent';
      f.name.value = from.name.slice(0, 91) + ' — custom';
      for (const [k, v] of Object.entries(from.parameters)) if (f[k]) f[k].value = v;
      if (from.parameters.laneChange) f.type.value = 'lane-' + from.parameters.laneChange;
      if (customSlotOffsets) {
        f.laneCount.value = customSlotOffsets.length;
        f.laneSpacingMm.value =
          customSlotOffsets.length > 1
            ? (customSlotOffsets.at(-1) - customSlotOffsets[0]) / (customSlotOffsets.length - 1)
            : 100;
      }
      if (![...f.family.options].some(o => o.value === from.family)) {
        const o = document.createElement('option');
        o.value = from.family;
        o.textContent = 'Imported connectors: ' + from.family;
        f.family.append(o);
      }
      f.family.value = from.family;
      f.color.value = from.color;
    } else f.family.value = 'custom';
    if (document.body.dataset.section === 'packs') dockPieceForm();
    else $('piece-dialog').showModal();
    updateCustom();
  }
  function createCustom(e) {
    e.preventDefault();
    updateCustom();
    if (!customDraft) return;
    if (customs.length >= 500) {
      say('The custom library supports up to 500 pieces.', true);
      return;
    }
    const d = { ...customDraft, id: 'custom:' + F.uid() };
    if (matchingCurve()) activePack().curveFamily = familyDraft();
    activePack().pieces.push(d);
    defs[d.id] = d;
    persistCustom();
    $('piece-dialog').close();
    if (wbEditing()) {
      wbView.pack = activePack().id;
      wbView.piece = d.id;
      undockPieceForm();
    }
    if (customToBuilder) {
      $('pack').value = activePack().id;
      $('search').value = '';
      catalogue();
      location.hash = 'builder';
      routeSection();
      updateView();
      add(d);
    } else {
      renderCustomLibrary();
      say(d.name + ' added to ' + activePack().name + '.');
    }
  }
  async function importPack(raw) {
    if (raw?.format === 'slotforge.layout')
      throw Error('This is a complete track. Use Import track JSON under Import & Export → Tracks.');
    const p = CP.importPack(raw, customLibrary);
    wbView.pack = p.id; // the Track Packs workbench shows the new pack
    wbView.piece = '';
    customLibrary.packs.push(p);
    customLibrary.activePackId = p.id;
    for (const d of p.pieces) defs[d.id] = d;
    const saving = persistCustom();
    $('pack').value = p.id;
    $('search').value = '';
    catalogue();
    if (document.body.dataset.section === 'export') {
      exportChoice = 'pack:' + p.id;
      populateExportTracks();
    }
    if (await saving)
      say(
        p.name + ' imported as one pack with ' + p.pieces.length + ' ' + (p.pieces.length === 1 ? 'piece.' : 'pieces.')
      );
  }
  function populateExportSelect(id, preferred) {
    const el = $(id),
      old = preferred || el.value || activePack().id;
    el.replaceChildren();
    for (const p of allPacks()) {
      const n = p.pieces.filter(d => d.parameters).length,
        o = document.createElement('option');
      o.value = p.id;
      o.textContent =
        p.name +
        ' · ' +
        n +
        ' ' +
        (n === 1 ? 'piece' : 'pieces') +
        (n < p.pieces.length ? ' (supported definitions only)' : '');
      o.disabled = !n;
      el.append(o);
    }
    el.value = allPacks().some(p => p.id === old) ? old : activePack().id;
  }
  function updateExportNote(id, note, button) {
    const p = allPacks().find(p => p.id === $(id).value),
      count = p?.pieces.filter(d => d.parameters).length || 0,
      excluded = (p?.pieces.length || 0) - count;
    $(note).textContent =
      count +
      ' ' +
      (count === 1 ? 'piece definition will be exported.' : 'piece definitions will be exported together.') +
      (excluded ? ' ' + excluded + ' reference-only items have no parametric geometry and are excluded.' : '');
    $(button).disabled = !count;
  }
  function exportPack(preferred) {
    const id =
      typeof preferred === 'string'
        ? preferred
        : document.body.dataset.section === 'builder'
          ? $('pack').value
          : activePack().id;
    populateExportSelect('pack-export-choice', id);
    updateExportNote('pack-export-choice', 'pack-export-note', 'pack-export-download');
    $('pack-export-dialog').showModal();
  }
  function downloadPack(id) {
    try {
      const p = allPacks().find(p => p.id === id);
      if (!p) throw Error('Choose a pack to export.');
      const out = CP.exportPack(p);
      if (!out.pieces.length) throw Error('Add a piece to this pack before exporting.');
      const safe = p.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 90) || 'Track-pack';
      const text = JSON.stringify(out, null, 2);
      if (new TextEncoder().encode(text).length > 5 * 1024 * 1024)
        throw Error(
          'This pack exceeds the 5 MiB import limit. Split its pieces into smaller packs before sharing. Use Storage to download a full workspace backup.'
        );
      download(safe + '.track-pack.json', text);
      say(p.name + ' exported with ' + out.pieces.length + ' ' + (out.pieces.length === 1 ? 'piece.' : 'pieces.'));
    } catch (e) {
      say(e.message, true);
    }
  }

  function readFile(input, fn) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      say('Choose a JSON file smaller than 5 MB.', true);
      return;
    }
    file
      .text()
      .then(t => fn(JSON.parse(t)))
      .catch(e => say('Could not import: ' + e.message, true));
  }
  function exportCSV(raw = layout(false)) {
    const model = XM.build(raw);
    download(XM.filename(model.title) + '-parts.csv', XM.csv(model), 'text/csv;charset=utf-8');
  }
  let pdfSnapshot = null,
    pdfBusy = false;
  const pdfDiagram = window.TrackDrawing.pdfDiagram;
  function openPdfReport(raw = layout()) {
    try {
      stop();
      const model = XM.build(raw);
      if (!model.pieces.length) throw Error('Add pieces before exporting a PDF.');
      pdfSnapshot = model.layout;
      $('pdf-track-name').textContent = model.title;
      $('pdf-track-details').textContent =
        model.pieces.length +
        ' placed pieces · ' +
        (model.summary.invalidFreeform
          ? 'Draft needs attention · lengths not calculated'
          : model.summary.planning
            ? 'approximate visual layout'
            : meters(model.summary.length) + (model.summary.freeform ? ' reference slot' : ' track centreline'));
      $('pdf-preview').innerHTML = pdfDiagram(model.layout).svg;
      $('pdf-error').textContent = '';
      $('pdf-dialog').showModal();
    } catch (e) {
      say(e.message, true);
    }
  }
  async function downloadPDF() {
    if (pdfBusy || !pdfSnapshot) return;
    pdfBusy = true;
    const buttons = [...$('pdf-dialog').querySelectorAll('button')];
    buttons.forEach(b => (b.disabled = true));
    $('pdf-orientation').disabled = true;
    $('pdf-error').textContent = '';
    $('pdf-download').textContent = 'Generating PDF…';
    try {
      const result = await makePdf(pdfSnapshot, $('pdf-orientation').value);
      download(XM.filename(result.title) + '.pdf', result.bytes, 'application/pdf');
      $('pdf-dialog').close();
      say('PDF downloaded: ' + result.title + ' · ' + result.pages + ' ' + (result.pages === 1 ? 'page' : 'pages'));
    } catch (e) {
      $('pdf-error').textContent = 'Could not generate the PDF: ' + e.message;
    } finally {
      pdfBusy = false;
      buttons.forEach(b => (b.disabled = false));
      $('pdf-orientation').disabled = false;
      $('pdf-download').textContent = 'Download PDF';
    }
  }
  $('pdf-download').onclick = downloadPDF;
  $('pdf-dialog').addEventListener('cancel', e => {
    if (pdfBusy) e.preventDefault();
  });
  // Empty canvas draws a selection marquee. Space or middle-button drag pans.
  // Right-click menu: piece actions on a piece, view actions on empty canvas.
  $('canvas').addEventListener('contextmenu', e => {
    e.preventDefault();
    if (drag) return;
    const mod = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl',
      id = e.target.closest('[data-id]')?.getAttribute('data-id');
    const openFolder = folderId => {
      $('tab-layout').click();
      window.BuilderLayout?.reveal(folderId); // the inspector rail shows that folder's section
      const folder = $(folderId);
      if (!folder) return;
      folder.open = true;
      folder.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      folder.querySelector('summary')?.focus({ preventScroll: true });
    };
    if (id && items.some(p => p.id === id)) {
      if (!selectedIds.has(id)) select(id);
      const chosen = selection(),
        many = chosen.length > 1,
        locked = chosen.every(p => p.locked);
      Menus.context(
        e.clientX,
        e.clientY,
        [
          { label: many ? `Rotate ${chosen.length} pieces` : 'Rotate', shortcut: 'R', action: () => rotate(1) },
          { label: 'Rotate back', shortcut: 'Shift R', action: () => rotate(-1) },
          { label: 'Mirror', shortcut: 'M', action: mirror },
          { label: 'Duplicate', shortcut: mod + ' D', action: duplicate },
          'separator',
          {
            label: 'Add borders…',
            disabled: $('add-borders').hidden || $('add-borders').disabled,
            action: () => $('add-borders').click(),
          },
          { label: 'Heights & bridges…', disabled: !$('height-folder'), action: () => openFolder('height-folder') },
          ...(() => {
            // Power marks go on one piece at a time.
            const role = many ? null : F.Power.role(power, id),
              free = defOf(chosen[0]).parameters.type === 'freeform';
            return [
              {
                label: role === 'base' ? 'Remove power base' : 'Power base here',
                disabled: many || free,
                action: () => markPower(id, role === 'base' ? null : 'base'),
              },
              {
                label: role === 'tap' ? 'Remove power tap' : 'Power tap here',
                disabled: many || free,
                action: () => markPower(id, role === 'tap' ? null : 'tap'),
              },
            ];
          })(),
          {
            label: locked ? 'Unlock' : 'Lock in place',
            disabled: !$('lock-pieces'),
            action: () => $('lock-pieces').click(),
          },
          'separator',
          { label: many ? `Delete ${chosen.length} pieces` : 'Delete', shortcut: 'Del', danger: true, action: remove },
        ],
        'Piece actions'
      );
    } else {
      Menus.context(
        e.clientX,
        e.clientY,
        [
          { label: 'Fit track to view', action: fit },
          {
            label: 'Select all pieces',
            shortcut: mod + ' A',
            disabled: !items.length,
            action: () => {
              setSelection(items.map(p => p.id));
              renderCanvas();
              updateInspector();
            },
          },
          { label: 'Zoom in', action: () => zoom(0.8) },
          { label: 'Zoom out', action: () => zoom(1.25) },
          'separator',
          { label: spaceGuide ? 'Edit space guide…' : 'Add a space guide…', action: openSpaceGuide },
          { label: 'Keyboard shortcuts', shortcut: '?', action: () => CircuitHelp.shortcuts() },
        ],
        'Canvas actions'
      );
    }
  });
  $('canvas').addEventListener('pointerdown', e => {
    if (drag || (e.button !== 0 && e.button !== 1)) return;
    $('canvas').focus({ preventScroll: true });
    if (e.target.closest('.car')) return;
    const pos = world(e),
      id = e.target.closest('[data-id]')?.getAttribute('data-id');
    if (space || e.button === 1) {
      drag = { type: 'pan', startClient: [e.clientX, e.clientY], view: { ...view } };
    } else if (!spaceGuide?.locked && e.target.closest('[data-guide]')) {
      stop();
      drag = {
        type: 'guide',
        resize: e.target.closest('[data-guide]').dataset.guide === 'resize',
        start: pos,
        original: { ...spaceGuide },
        snapshot: snapshot(),
        moved: false,
      };
    } else if (id) {
      if (e.shiftKey) {
        const ids = new Set(selectedIds);
        const related = window.DesignTools.expanded(items, [id]);
        if (ids.has(id)) related.forEach(k => ids.delete(k));
        else related.forEach(k => ids.add(k));
        setSelection(ids, id);
        renderCanvas();
        updateInspector();
        return;
      }
      if (!selectedIds.has(id)) select(id);
      else {
        selected = id;
        updateInspector();
      }
      if (selectionLocked()) return;
      stop();
      drag = {
        type: 'piece',
        id,
        start: pos,
        originals: selection().map(p => ({ ...p })),
        snapshot: snapshot(),
        moved: false,
      };
    } else {
      const previous = [...selectedIds],
        previousPrimary = selected;
      if (!e.shiftKey) select(null);
      drag = {
        type: 'select',
        start: pos,
        startClient: [e.clientX, e.clientY],
        base: e.shiftKey ? previous : [],
        previous,
        previousPrimary,
        moved: false,
      };
    }
    drag.pointerId = e.pointerId;
    $('canvas').setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  // Pointer moves are handled at most once per screen frame; the latest position wins.
  let pendingMove = null,
    moveFrame = 0;
  $('canvas').addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    pendingMove = e;
    if (!moveFrame) moveFrame = requestAnimationFrame(flushMove);
  });
  function flushMove() {
    cancelAnimationFrame(moveFrame);
    moveFrame = 0;
    const e = pendingMove;
    pendingMove = null;
    if (e && drag && e.pointerId === drag.pointerId) dragMove(e);
  }
  // While pieces are dragged only they are redrawn; the connector dots show the open ends of
  // the pieces standing still plus those of the moving selection. Drop redraws everything.
  function renderDragFrame(guide, openPorts) {
    renderSnapGuide(guide);
    renderPieces();
    renderTimingLine();
    $('power-layer').replaceChildren(); // power marks follow the track once the pieces are dropped
    const radius = portRadius(),
      fragment = document.createDocumentFragment();
    for (const port of openPorts)
      svg(
        'circle',
        {
          cx: port.position[0],
          cy: port.position[1],
          r: radius,
          fill: selectedIds.has(port.pieceId) ? '#f0bd6b' : '#83919d',
          stroke: '#171b21',
          'stroke-width': 1,
          class: 'port',
        },
        fragment
      );
    $('ports').replaceChildren(fragment);
  }
  function dragMove(e) {
    if (drag.type === 'pan') {
      const r = $('canvas').getBoundingClientRect();
      view.x = drag.view.x - ((e.clientX - drag.startClient[0]) / r.width) * view.w;
      view.y = drag.view.y - ((e.clientY - drag.startClient[1]) / r.height) * view.h;
      updateView();
      return;
    }
    const pos = world(e);
    if (drag.type === 'guide') {
      const dx = pos[0] - drag.start[0],
        dy = pos[1] - drag.start[1];
      if (!drag.moved && Math.hypot(dx, dy) < 1) return;
      spaceGuide = drag.resize
        ? F.resizeSpaceGuide(drag.original, dx, dy, e.shiftKey)
        : F.moveSpaceGuide(drag.original, dx, dy);
      drag.moved = true;
      renderSpaceGuide();
      $('status').textContent = 'Available space: ' + guideSize(spaceGuide);
      return;
    }
    if (drag.type === 'select') {
      if (!drag.moved && Math.hypot(e.clientX - drag.startClient[0], e.clientY - drag.startClient[1]) < 3) return;
      drag.moved = true;
      const hits = items.filter(p => F.inSelectionBox(p, defOf(p), drag.start, pos)).map(p => p.id),
        chosen = [...drag.base, ...hits],
        key = chosen.join(',');
      // Redraw only when the set changes; the inspector follows once, when the box is let go.
      if (key !== drag.hitKey) {
        drag.hitKey = key;
        setSelection(chosen);
        renderCanvas();
      }
      const box = $('selection-box');
      box.hidden = false;
      box.style.display = 'block';
      for (const [k, v] of Object.entries({
        x: Math.min(pos[0], drag.start[0]),
        y: Math.min(pos[1], drag.start[1]),
        width: Math.abs(pos[0] - drag.start[0]),
        height: Math.abs(pos[1] - drag.start[1]),
      }))
        box.setAttribute(k, v);
      $('status').textContent = selectedIds.size + ' pieces selected';
      return;
    }
    const dx = pos[0] - drag.start[0],
      dy = pos[1] - drag.start[1];
    if (Math.hypot(dx, dy) < 1 && !drag.moved) return;
    drag.moved = true;
    let moved = drag.originals.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })),
      snapped = null;
    if (snapEnabled && !e.shiftKey) {
      const remaining = items.filter(p => !selectedIds.has(p.id)),
        open = F.connections(moved, defs).open,
        targets = F.connections(remaining, defs).open;
      for (const candidate of moved) {
        const allowed = open.filter(p => p.pieceId === candidate.id).map(p => p.index);
        const result = F.snap(
          candidate,
          remaining,
          defs,
          Math.min(100, (view.w / $('canvas').clientWidth) * 22),
          allowed,
          targets
        );
        if (
          result &&
          (!snapped || result.score < snapped.score) &&
          (result.kind === 'side' ||
            allowed.some(i => F.dist(F.ports(result.pose, defs)[i].position, result.target.position) < 0.15))
        )
          snapped = { ...result, original: candidate };
      }
    }
    if (snapped) moved = F.repositionGroup(moved, snapped.original, snapped.pose);
    replaceGroup(moved);
    const movedIds = new Set(moved.map(p => p.id));
    drag.targets ??= F.connections(
      items.filter(p => !movedIds.has(p.id)),
      defs
    ).open;
    renderDragFrame(snapped?.guide, [...drag.targets, ...F.connections(moved, defs).open]);
    $('status').textContent = snapped
      ? snapped.kind === 'side'
        ? 'Road sides aligned · release to place'
        : 'Connector aligned · release to place'
      : 'Moving selection · hold Shift to disable snapping';
  }
  function finishDrag(cancel = false) {
    if (!drag) return;
    if (cancel) {
      cancelAnimationFrame(moveFrame);
      moveFrame = 0;
      pendingMove = null;
    } else flushMove();
    if (drag.type === 'guide' && drag.moved) {
      if (cancel) spaceGuide = drag.original;
      else {
        history.push(drag.snapshot);
        if (history.length > 80) history.shift();
        future = [];
      }
      refresh();
      $('status').textContent = cancel ? 'Guide change cancelled' : 'Space guide updated';
    }
    if (drag.type === 'piece' && drag.moved) {
      if (cancel) replaceGroup(drag.originals);
      else {
        history.push(drag.snapshot);
        if (history.length > 80) history.shift();
        future = [];
      }
      refresh();
      $('status').textContent = cancel ? 'Move cancelled' : selectedIds.size + ' pieces placed';
    }
    if (drag.type === 'select') {
      $('selection-box').style.display = 'none';
      if (cancel) {
        setSelection(drag.previous, drag.previousPrimary);
        renderCanvas();
        updateInspector();
      } else {
        if (drag.moved) updateInspector();
        $('status').textContent = selectedIds.size ? selectedIds.size + ' pieces selected' : 'Ready';
      }
    }
    const pointerId = drag.pointerId;
    drag = null;
    if ($('canvas').hasPointerCapture(pointerId)) $('canvas').releasePointerCapture(pointerId);
    if (routedUI) routedUI.render();
  }
  $('canvas').addEventListener('pointerup', e => {
    if (e.pointerId === drag?.pointerId) finishDrag();
  });
  $('canvas').addEventListener('pointercancel', e => {
    if (e.pointerId === drag?.pointerId) finishDrag(true);
  });
  $('canvas').addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      if (drag) return;
      zoom(Math.exp(Math.sign(e.deltaY) * 0.12), world(e));
    },
    { passive: false }
  );
  document.addEventListener('keydown', e => {
    if (
      document.body.dataset.section !== 'builder' ||
      document.querySelector('dialog[open]') ||
      Menus.isOpen() ||
      e.target.closest('input,select,textarea,[contenteditable="true"]')
    )
      return;
    if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      space = true;
      e.preventDefault();
      return;
    }
    const action = F.shortcut(e);
    if (!action) return;
    e.preventDefault();
    if (drag) {
      if (action === 'escape') finishDrag(true);
      return;
    }
    const actions = {
      selectAll: () => {
        setSelection(items.map(p => p.id));
        renderCanvas();
        updateInspector();
      },
      undo,
      redo,
      duplicate,
      save,
      rotate,
      rotateBack: () => rotate(-1),
      fitSelection,
      toggleSidebars: () => window.BuilderLayout?.toggleSidebars(),
      mirror,
      remove,
      escape: () => select(null),
      open: openTrackFile,
      newTrack: () => confirmReplace(newTrack),
    };
    actions[action]();
  });
  document.addEventListener('keyup', e => {
    if (e.code === 'Space') space = false;
  });
  window.addEventListener('blur', () => {
    space = false;
    finishDrag(true);
  });
  $('layer-order').onchange = () => {
    const position = $('layer-order').value;
    $('layer-order').value = '';
    arrangeSelection(position);
  };
  $('undo').onclick = undo;
  $('redo').onclick = redo;
  // Undo history: the last steps in words; choosing one undoes back to before it.
  function describeStep(a, b) {
    let x, y;
    try {
      x = JSON.parse(a);
      y = JSON.parse(b);
    } catch {
      return 'Change';
    }
    const was = new Map(x.items.map(p => [p.id, p])),
      now = new Set(y.items.map(p => p.id));
    const pieces = k => `${k} ${k === 1 ? 'piece' : 'pieces'}`;
    const added = y.items.filter(p => !was.has(p.id)).length,
      removed = x.items.filter(p => !now.has(p.id)).length;
    if (added && removed) return `Replaced ${pieces(removed)}`;
    if (added) return `Added ${pieces(added)}`;
    if (removed) return `Removed ${pieces(removed)}`;
    let mirrored = 0,
      turned = 0,
      moved = 0,
      changed = 0;
    for (const p of y.items) {
      const q = was.get(p.id);
      if (!!q.flip !== !!p.flip) mirrored++;
      else if (q.angle !== p.angle) turned++;
      else if (q.x !== p.x || q.y !== p.y) moved++;
      else if (JSON.stringify(q) !== JSON.stringify(p)) changed++;
    }
    if (mirrored) return `Mirrored ${pieces(mirrored)}`;
    if (turned) return `Rotated ${pieces(turned)}`;
    if (moved) return `Moved ${pieces(moved)}`;
    if (changed) return `Changed ${pieces(changed)}`;
    if (x.title !== y.title) return 'Renamed the track';
    return 'Changed settings';
  }
  $('undo-history').addEventListener('click', () => {
    const menu = $('undo-menu');
    menu.replaceChildren();
    const steps = Math.min(history.length, 15);
    if (!steps) {
      const none = document.createElement('p');
      none.className = 'menu-label';
      none.textContent = 'Nothing to undo';
      menu.append(none);
      return;
    }
    const head = document.createElement('p');
    head.className = 'menu-label';
    head.textContent = 'Undo back to before';
    menu.append(head);
    for (let k = 1; k <= steps; k++) {
      const i = history.length - k,
        after = k === 1 ? snapshot() : history[i + 1];
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.textContent = describeStep(history[i], after);
      item.onclick = () => {
        for (let n = 0; n < k; n++) undo();
        say(k === 1 ? 'Undone: ' + item.textContent + '.' : `Undid ${k} steps.`);
      };
      menu.append(item);
    }
  });
  Menus.attach($('undo-history'), $('undo-menu'));
  $('undo-menu').addEventListener('click', e => {
    if (e.target.closest('[role="menuitem"]')) {
      $('undo-menu').hidden = true;
      $('undo-history').setAttribute('aria-expanded', 'false');
    }
  });
  $('fit-selection').onclick = fitSelection;
  $('rotate-step').value = String(rotateStep);
  $('rotate-step').onchange = () => {
    const v = Number($('rotate-step').value);
    if (!(v >= 0.1 && v <= 180)) {
      say('Enter a rotation step from 0.1° to 180°.', true);
      $('rotate-step').value = String(rotateStep);
      return;
    }
    rotateStep = v;
    try {
      localStorage.setItem('slotforge.rotate-step.v1', String(v));
    } catch {}
    $('rotate').title = `Rotate ${v}° (R); Shift+R rotates back`;
  };
  $('rotate').title = `Rotate ${rotateStep}° (R); Shift+R rotates back`;
  $('search-all').onchange = catalogue;
  $('rotate').onclick = e => rotate(e.shiftKey ? -1 : 1);
  $('mirror').onclick = mirror;
  $('duplicate').onclick = duplicate;
  $('delete').onclick = remove;
  $('snap').onclick = () => {
    snapEnabled = !snapEnabled;
    $('snap').setAttribute('aria-pressed', snapEnabled);
    $('snap').textContent = snapEnabled ? 'Snap on' : 'Snap off';
  };
  $('zoom-in').onclick = () => zoom(0.8);
  $('zoom-out').onclick = () => zoom(1.25);
  $('fit').onclick = fit;
  // Follow canvas size changes (window resize, panels opening, first layout):
  // keep the view centred, and re-fit when the track is no longer on screen.
  let canvasSize = null;
  new ResizeObserver(() => {
    const r = $('canvas').getBoundingClientRect();
    if (!r.width || !r.height) {
      canvasSize = null; // Hidden: treat the next time it is shown as a first layout.
      return;
    }
    if (fitPending) {
      canvasSize = [r.width, r.height];
      return fit();
    }
    const firstLayout = !canvasSize;
    if (canvasSize && Math.abs(canvasSize[0] - r.width) < 1 && Math.abs(canvasSize[1] - r.height) < 1) return;
    canvasSize = [r.width, r.height];
    const cx = view.x + view.w / 2,
      cy = view.y + view.h / 2;
    updateView();
    view.x = cx - view.w / 2;
    view.y = cy - view.h / 2;
    updateView();
    if (!items.length) return;
    const b = F.bounds(items, defs),
      visible = b[0] + b[2] > view.x && b[0] < view.x + view.w && b[1] + b[3] > view.y && b[1] < view.y + view.h,
      fits = b[0] >= view.x && b[1] >= view.y && b[0] + b[2] <= view.x + view.w && b[1] + b[3] <= view.y + view.h;
    if (!visible || (firstLayout && !fits)) fit();
  }).observe($('canvas'));
  $('save').onclick = save;
  $('builder-pdf').onclick = () => openPdfReport(layout());
  $('builder-cad').onclick = () => cadUI.open(layout());
  $('csv').onclick = () => exportCSV();
  $('new').onclick = () => confirmReplace(newTrack);
  $('demo').onclick = () => confirmReplace(example);
  $('empty-demo').onclick = example;
  $('play').onclick = togglePlay;
  $('restart').onclick = () => {
    carDistances = [];
    if (!playing && network.closed) togglePlay();
  };
  $('mirror-new').onchange = () => rememberMirror($('mirror-new').checked);
  $('pack').onchange = () => {
    const chosen = allPacks().find(p => p.id === $('pack').value);
    if (chosen && !chosen.pieces.some(d => d.geometry || d.referencePlan)) $('buildable').checked = false;
    if (customLibrary.packs.some(p => p.id === $('pack').value)) {
      customLibrary.activePackId = $('pack').value;
      persistCustom();
    }
    catalogue();
  };
  $('search').oninput = catalogue;
  $('buildable').onchange = catalogue;
  // The pack card opens the pack list; the options button opens the piece-list options.
  Menus.attach($('pack-card'), $('pack-menu'));
  {
    const button = $('catalogue-filter'),
      menu = $('catalogue-filter-menu'),
      close = focus => {
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        if (focus) button.focus();
      };
    button.onclick = e => {
      e.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      if (open) menu.querySelector('input, button')?.focus();
    };
    document.addEventListener('pointerdown', e => {
      if (!menu.hidden && !menu.contains(e.target) && !button.contains(e.target)) close(false);
    });
    menu.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    });
    $('mirror-new').addEventListener('change', updateFilterBadge);
  }
  $('catalogue-tabs').onclick = e => {
    const b = e.target.closest('[data-folder]');
    if (!b) return;
    catalogueTab = b.dataset.folder;
    try {
      localStorage.setItem('slotforge.catalogue-tab.v1', catalogueTab);
    } catch {}
    catalogue();
    $('catalogue-tabs').querySelector('[aria-selected="true"]')?.focus();
  };
  // The track sheet: it skips its work while hidden and catches up when it is shown.
  // On the next frame: redrawing inside the observer resizes the sheet again, which the
  // browser reports as a "ResizeObserver loop" error.
  new ResizeObserver(() => {
    if (trackSheetDirty && $('track-sheet').offsetParent)
      requestAnimationFrame(() => trackSheetDirty && $('track-sheet').offsetParent && renderTrackSheet());
  }).observe($('track-sheet'));
  for (const t of ['overview', 'parts'])
    $('ts-tab-' + t).onclick = () => {
      trackSheetTab = t;
      renderTrackSheet();
    };
  $('ts-edit-heights').onclick = () => BuilderLayout.rail()?.select('heights', true);
  $('ts-find-problems').onclick = () =>
    [...document.querySelectorAll('#tools-menu [role=menuitem]')]
      .find(b => /^Find problems/.test(b.textContent))
      ?.click();
  $('ts-copy-list').onclick = async () => {
    const list = trackSheetShopping()
      .map(r => r.missing + ' × ' + r.name + (r.sku ? ' (' + r.sku + ')' : ''))
      .join('\n');
    try {
      await navigator.clipboard.writeText(title + ' · shopping list\n' + list);
      say('Shopping list copied.');
    } catch (e) {
      say('Could not copy the list: ' + e.message, true);
    }
  };
  $('ts-save-list').onclick = () =>
    download(
      XM.filename(title) + '-shopping-list.csv',
      window.DesignTools.shoppingCSV(window.DesignTools.inventory(items, defs, planning.owned || {})),
      'text/csv;charset=utf-8'
    );
  $('custom').onclick = () => {
    if (
      $('pack').value === F.Routed.ID ||
      customLibrary.packs.some(
        p => p.id === $('pack').value && p.pieces.length && p.pieces.every(d => d.parameters.routed)
      )
    ) {
      $('routed-new-section').click();
      return;
    }
    if (customLibrary.packs.some(p => p.id === $('pack').value)) customLibrary.activePackId = $('pack').value;
    openCustom();
  };
  $('custom-from').onclick = () => current() && openCustom(defOf(current()));
  $('piece-form').oninput = updateCustom;
  $('piece-form').onchange = e => {
    if (e.target.name === 'type' && e.target.value.startsWith('lane-')) {
      const f = $('piece-form').elements;
      f.switchStartMm.value = Number(f.lengthMm.value) * 0.2;
      f.switchEndMm.value = Number(f.lengthMm.value) * 0.8;
      if (f.name.value === 'My straight') f.name.value = 'My lane changer';
    }
    updateCustom();
  };
  $('piece-form').onsubmit = createCustom;
  $('uniform-slots').onclick = () => {
    customSlotOffsets = null;
    updateCustom();
  };
  Menus.attach($('file-menu-button'), $('file-menu'));
  $('pack-file').onchange = () => readFile($('pack-file'), importPack);
  // ---------------------------------------------------------------- opening track files
  // One path for every way a track file arrives: Open buttons, Ctrl+O, recent files,
  // and (desktop) files double-clicked in the operating system.
  function importTrack(raw) {
    if (raw?.format === 'slotforge.custom-pack')
      throw Error('This is a track pack. Use Import pack JSON under Import & Export → Track Packs.');
    I.importLayout(raw);
    confirmReplace(() => {
      try {
        applyImport(raw);
      } catch (e) {
        say(e.message, true);
      }
    });
  }
  function importTrackFile(file) {
    if (!file) return;
    if (file.error) return say(file.error, true);
    try {
      importTrack(JSON.parse(file.text));
      location.hash = 'builder';
    } catch (e) {
      say('Could not open ' + (file.name || 'this file') + ': ' + e.message, true);
    }
  }
  const desktop = window.slotforgeDesktop;
  async function openTrackFile() {
    if (desktop?.openTrackDialog) importTrackFile(await desktop.openTrackDialog());
    else $('layout-file').click();
  }
  async function renderRecentFiles() {
    const box = $('recent-files');
    if (!desktop?.recentFiles) return;
    const list = await desktop.recentFiles();
    box.replaceChildren();
    box.hidden = !list.length;
    if (!list.length) return;
    const label = document.createElement('div');
    label.className = 'menu-label';
    label.textContent = 'Recent';
    box.append(label);
    for (const file of list.slice(0, 6)) {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.textContent = file.name;
      item.title = file.path;
      item.onclick = async () => importTrackFile(await desktop.openRecent(file.path));
      box.append(item);
    }
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.setAttribute('role', 'menuitem');
    clear.className = 'menu-quiet';
    clear.textContent = 'Clear recent files';
    clear.onclick = () => desktop.clearRecent();
    box.append(clear, document.createElement('hr'));
  }
  $('open').onclick = openTrackFile;
  $('file-menu-button').addEventListener('click', renderRecentFiles);
  desktop?.onOpenFile?.(importTrackFile);
  $('layout-file').onchange = () => readFile($('layout-file'), importTrack);
  $('track-name').onchange = () => {
    checkpoint();
    title = $('track-name').value.trim() || 'Untitled circuit';
    $('track-name').value = title;
    updateInspector();
    persist();
  };
  for (const [k, id] of [
    ['x', 'pos-x'],
    ['y', 'pos-y'],
    ['angle', 'pos-angle'],
  ])
    $(id).onchange = () => {
      const v = $(id).value.trim() === '' ? NaN : Number($(id).value);
      if (!Number.isFinite(v) || Math.abs(v) > 1000000) {
        say('Enter a finite coordinate within ±1,000,000.', true);
        if (current()) $(id).value = current()[k];
        updateInspector();
        return;
      }
      modify(p => (p[k] = k === 'angle' ? F.wrap(v) : v));
    };
  for (const id of ['layout', 'tune'])
    $('tab-' + id).onclick = () => {
      for (const n of ['layout', 'tune']) {
        $('tab-' + n).setAttribute('aria-selected', id === n);
        $('tab-' + n).tabIndex = id === n ? 0 : -1;
        $(n + '-panel').hidden = id !== n;
      }
    };
  document.querySelector('.inspector-tabs').addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const id =
      e.key === 'Home'
        ? 'layout'
        : e.key === 'End'
          ? 'tune'
          : document.activeElement.id === 'tab-layout'
            ? 'tune'
            : 'layout';
    $('tab-' + id).click();
    $('tab-' + id).focus();
  });
  $('preset').onchange = () => {
    if (F.presets[$('preset').value]) {
      profile = { ...F.presets[$('preset').value] };
      updateSliders();
      if (playing) rebuildMotion();
      persist();
    }
  };
  document.querySelectorAll('[data-close]').forEach(b => (b.onclick = () => $(b.dataset.close).close()));
  $('confirm-cancel').onclick = () => $('confirm-dialog').close();
  $('confirm-save').onclick = save;
  $('confirm-go').onclick = () => {
    $('confirm-dialog').close();
    confirmAction?.();
    confirmAction = null;
  };
  new ResizeObserver(() => updateView()).observe($('canvas'));
  try {
    rememberMirror(JSON.parse(localStorage.getItem('slotforge.mirror-new.v1')) === true);
  } catch {
    rememberMirror(false);
  }
  populatePacks();
  initSliders();
  updateCarControls();
  try {
    const saved = localStorage.getItem(CP.STORAGE),
      legacy = localStorage.getItem(CUSTOM);
    browserPackBaseline = saved;
    customLibrary = CP.read(
      DS.disk ? DS.packs : saved !== null ? JSON.parse(saved) : legacy !== null ? JSON.parse(legacy) : null
    );
    customs = customLibrary.packs.flatMap(p => p.pieces);
    if (customs.some(d => defs[d.id])) throw Error('Saved piece IDs collide with installed packs.');
    for (const d of customs) defs[d.id] = d;
    const requested = new URLSearchParams(location.search).get('pack');
    if (customLibrary.packs.some(p => p.id === requested)) customLibrary.activePackId = requested;
    if (requested) {
      const url = new URL(location.href);
      url.searchParams.delete('pack');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      if (DS.disk) await DS.putPacks(CP.serialize(customLibrary));
      else writeBrowserPacks(CP.serialize(customLibrary));
    }
  } catch {
    backupStorage(CP.STORAGE);
    backupStorage(CUSTOM);
    customLibrary = CP.empty();
    customs = [];
    say('Saved pack library could not be loaded. Original data was retained for recovery.', true);
  }
  populatePacks();
  renderPackControls();
  let loaded = false;
  try {
    const raw = DS.disk ? DS.current : localStorage.getItem(STORAGE);
    if (raw) {
      const input = DS.disk ? raw : JSON.parse(raw),
        saved = I.importLayout(input);
      try {
        librarySource = DL.validateSource(
          DS.disk ? DS.currentSource : input.editorState?.librarySource,
          saved.state.designId
        );
      } catch {
        librarySource = null;
      }
      const merged = F.mergeDefinitions(saved.definitions, saved.pieces, defs);
      Object.assign(defs, merged.definitions);
      items = merged.pieces;
      planning = F.Planning.validate(saved.workspace?.planning);
      previewCar = F.PreviewCar.settings(saved.workspace?.previewCar);
      power = F.Power.settings(saved.workspace?.power);
      routedState = F.Routed.workspace(saved.workspace?.routed);
      syncRoutedPack();
      spaceGuide = saved.workspace?.spaceGuide || null;
      title = saved.title;
      profile = saved.profile;
      integrationState = saved.state;
      $('track-name').value = title;
      loaded = true;
    }
  } catch {
    backupStorage(STORAGE);
    say('Saved layout could not be restored. Starting with the example.', true);
  }
  catalogue();
  updateSliders();
  updateCarControls();
  updateView();
  if (loaded) {
    // Just read from storage: nothing to save until something changes.
    refresh(false);
    saveState('clean', DS.disk ? 'Saved to disk' : 'Saved in browser');
    fit();
  } else {
    example();
    history = [];
    future = [];
    updateInspector();
  }

  let borderPlan = null;
  function previewBorders() {
    const roads = selection().filter(p => ['straight', 'curve'].includes(defOf(p).parameters.type)),
      side = $('border-sides').value;
    borderPlan = F.planBorders(roads, items, defs, side === 'both' ? ['inner', 'outer'] : [side]);
    $('borders-selection').textContent = roads.length + ' selected road pieces';
    $('border-side-help').textContent =
      borderPlan.sideMode === 'circuit'
        ? 'Inside and outside follow the connected circuit, including straights, bends and mirrored pieces.'
        : 'Open or unsupported circuits have no unique inside. Sides follow a connected bend; isolated straights use local right as inside and local left as outside. Use Both sides when unsure.';
    $('borders-summary').textContent = borderPlan.overflow
      ? 'These borders would exceed the 500-piece layout limit. Select fewer road pieces.'
      : borderPlan.added.length +
        ' border pieces will be added.' +
        (borderPlan.duplicates ? ' ' + borderPlan.duplicates + ' already placed sections skipped.' : '');
    $('borders-missing').replaceChildren();
    for (const missing of borderPlan.missing.slice(0, 10)) {
      const li = document.createElement('li');
      li.textContent =
        missing.name + ' — no matching ' + (missing.side === 'inner' ? 'inside' : 'outside') + ' border geometry';
      $('borders-missing').append(li);
    }
    if (borderPlan.missing.length > 10) {
      const li = document.createElement('li');
      li.textContent = 'And ' + (borderPlan.missing.length - 10) + ' more unmatched edges.';
      $('borders-missing').append(li);
    }
    $('place-borders').disabled = borderPlan.overflow || !borderPlan.added.length;
  }
  $('add-borders').onclick = () => {
    previewBorders();
    $('borders-dialog').showModal();
  };
  $('border-sides').onchange = previewBorders;
  $('place-borders').onclick = () => {
    previewBorders();
    if (borderPlan.overflow || !borderPlan.added.length) return;
    checkpoint();
    stop();
    const count = borderPlan.added.length,
      ids = [...selectedIds, ...borderPlan.added.map(p => p.id)];
    items.push(...borderPlan.added);
    setSelection(ids, selected);
    $('borders-dialog').close();
    refresh();
    say(count + ' borders added. Road and borders are selected together.');
  };

  function renderPackControls() {}
  async function saveToLibrary(p = activePack()) {
    try {
      p.name = CP.name(p.name);
      p.pieces = p.pieces.map(d => ({ ...d, pack: p.name }));
      for (const d of p.pieces) defs[d.id] = d;
      p.inLibrary = true;
      if (await persistCustom()) say(p.name + ' saved to Track Pack Library with ' + p.pieces.length + ' pieces.');
    } catch (e) {
      say(e.message, true);
    }
  }
  // ---------------------------------------------------------------- Track Packs: the Workbench
  // Packs as tabs; the pack's pieces on the left; the chosen piece drawn large with its size in the
  // middle; its facts and actions on the right. In your own packs the piece editor opens in place.
  const WB_VIEW = 'slotforge.workbench.v1';
  const wbView = (() => {
    try {
      const v = JSON.parse(localStorage.getItem(WB_VIEW) || '{}') || {};
      return { pack: typeof v.pack === 'string' ? v.pack : '', piece: typeof v.piece === 'string' ? v.piece : '' };
    } catch {
      return { pack: '', piece: '' };
    }
  })();
  function keepWbView() {
    try {
      localStorage.setItem(WB_VIEW, JSON.stringify(wbView));
    } catch {}
  }
  function wbEl(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }
  function wbOwn(p) {
    return customLibrary.packs.includes(p);
  }
  function wbPack() {
    const all = allPacks();
    return all.find(p => p.id === wbView.pack) || all.find(p => p.id === $('pack').value) || all[0];
  }
  function wbMark(p) {
    const mark = wbEl('span', 'wb-mark');
    if (wbOwn(p)) mark.textContent = '✎';
    else if (p.id === F.Routed.ID) mark.textContent = 'RW';
    else
      mark.textContent = (
        p.name
          .replace(/[^A-Za-z0-9 ]/g, ' ')
          .trim()
          .split(/\s+/)[0] || '?'
      )
        .slice(0, 3)
        .toUpperCase();
    let hash = 0;
    for (const c of p.id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
    mark.style.setProperty('--wb-hue', String(hash % 360));
    mark.setAttribute('aria-hidden', 'true');
    return mark;
  }
  // Build with this pack: the builder's piece list shows it.
  function useInBuilder(p) {
    $('pack').value = p.id;
    $('search').value = '';
    if (!p.pieces.some(d => d.geometry || d.referencePlan)) $('buildable').checked = false;
    catalogue();
    location.hash = 'builder';
    routeSection();
    say(p.name + ' selected. Choose a piece to add to your track.');
  }
  function wbKind(d) {
    const t = d.parameters?.type || '';
    if (d.parameters?.foldOverride) return 'Planning fold';
    if (d.parameters?.laneChange) return 'Lane changer';
    if (t.endsWith('border')) return 'Border';
    if (t === 'reference' || !d.geometry) return 'Reference';
    if (t === 'routed-spline' || d.parameters?.routed) return 'Routed section';
    return t ? t[0].toUpperCase() + t.slice(1) : 'Piece';
  }
  function wbFacts(d) {
    const q = d.parameters || {},
      mm = v => (Number.isFinite(+v) ? Math.round(+v * 10) / 10 + ' mm' : ''),
      facts = [];
    if (d.geometry?.centrelineLengthMm) facts.push(['Length', mm(d.geometry.centrelineLengthMm)]);
    else if (q.lengthMm) facts.push(['Length', mm(q.lengthMm)]);
    if (q.widthMm) facts.push(['Width', mm(q.widthMm)]);
    if (q.angleDeg) facts.push(['Angle', Math.round(q.angleDeg * 10) / 10 + '°']);
    if (q.innerRadiusMm) facts.push(['Inner radius', mm(q.innerRadiusMm)]);
    const lanes = d.geometry?.lanePaths?.length || 0;
    if (lanes) facts.push(['Lanes', String(lanes)]);
    if (q.laneSpacingMm && lanes > 1) facts.push(['Lane spacing', mm(q.laneSpacingMm)]);
    if (d.family)
      facts.push([
        'Connector',
        d.family === 'custom'
          ? 'Unbranded'
          : allPacks()
              .find(p => p.id === d.family)
              ?.name.split(' / ')[0] ||
            (/routed/.test(d.family) ? 'Routed wood' : d.family.replace(/^slotforge\./, '').replace(/\.v\d+$/, '')),
      ]);
    const placed = items.filter(p => p.definitionId === d.id).length;
    facts.push(['In this track', placed ? placed + (placed === 1 ? ' placed' : ' placed') : 'not used']);
    return facts;
  }
  function wbDrawing(d) {
    if (!d.geometry) {
      if (d.asset || d.referenceImage) {
        const img = wbEl('img', 'wb-reference');
        img.src = d.asset || d.referenceImage;
        img.alt = d.name;
        return img;
      }
      return wbEl('p', 'wb-message', 'This reference item has no drawing.');
    }
    const b = paletteBounds(d),
      pad = Math.max(b[2], b[3]) * 0.16 + 20,
      text = Math.max(b[2], b[3]) * 0.045 + 6,
      view = [b[0] - pad, b[1] - pad, b[2] + pad * 2 + text * 3.5, b[3] + pad * 2],
      image = svg('svg', { viewBox: view.join(' '), class: 'wb-drawing', role: 'img', 'aria-label': d.name }),
      gap = pad * 0.45,
      w = Math.round(b[2]),
      h = Math.round(b[3]);
    // The footprint, drawn as dimension lines above and to the right of the piece.
    image.innerHTML =
      paletteBody(d) +
      `<g class="wb-dim" stroke-width="${text / 7}" font-size="${text}">` +
      `<path d="M${b[0]} ${b[1] - gap - text / 2}v${text}M${b[0] + b[2]} ${b[1] - gap - text / 2}v${text}M${b[0]} ${b[1] - gap}H${b[0] + b[2]}"/>` +
      `<text x="${b[0] + b[2] / 2}" y="${b[1] - gap - text * 0.6}" text-anchor="middle">${w} mm</text>` +
      `<path d="M${b[0] + b[2] + gap - text / 2} ${b[1]}h${text}M${b[0] + b[2] + gap - text / 2} ${b[1] + b[3]}h${text}M${b[0] + b[2] + gap} ${b[1]}V${b[1] + b[3]}"/>` +
      `<text x="${b[0] + b[2] + gap + text * 0.5}" y="${b[1] + b[3] / 2}" dominant-baseline="middle">${h} mm</text></g>`;
    return image;
  }
  function renderWbPacks(current) {
    const host = $('wb-packs'),
      inBuilder = $('pack').value;
    const tab = p => {
      const b = wbEl('button', 'wb-pack');
      b.type = 'button';
      b.dataset.pack = p.id;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(p === current));
      b.title = p.name + (p.id === inBuilder ? ' · in the builder now' : '');
      const name = wbEl('span', 'wb-pack-name', p.name.split(' / ')[0]);
      b.append(wbMark(p), name);
      if (p.id === inBuilder) b.append(wbEl('span', 'wb-live'));
      return b;
    };
    const own = customLibrary.packs;
    host.replaceChildren(...packs.map(tab), ...(own.length ? [wbEl('span', 'wb-pack-gap')] : []), ...own.map(tab));
    // Bring the chosen tab into view without scrolling the page itself.
    const on = host.querySelector('[aria-selected="true"]');
    if (on) {
      const left = on.offsetLeft - host.offsetLeft,
        right = left + on.offsetWidth;
      if (left < host.scrollLeft) host.scrollLeft = left - 8;
      else if (right > host.scrollLeft + host.clientWidth) host.scrollLeft = right - host.clientWidth + 8;
    }
  }
  function renderWbPackBar(p) {
    const bar = $('wb-pack-bar'),
      own = wbOwn(p),
      routed = p.id === F.Routed.ID,
      shareable = p.pieces.some(d => d.parameters),
      left = wbEl('div', 'wb-pack-title'),
      actions = wbEl('div', 'wb-pack-actions');
    if (own) {
      const name = wbEl('input', 'wb-pack-rename');
      name.id = 'wb-pack-name';
      name.value = p.name;
      name.maxLength = 100;
      name.setAttribute('aria-label', 'Pack name');
      name.onchange = () => {
        try {
          p.name = CP.name(name.value);
          p.pieces = p.pieces.map(d => ({ ...d, pack: p.name }));
          for (const d of p.pieces) defs[d.id] = d;
          persistCustom();
        } catch (e) {
          name.value = p.name;
          say(e.message, true);
        }
      };
      left.append(name);
    } else left.append(wbEl('h2', '', p.name));
    const facts = [
      own
        ? p.inLibrary
          ? 'Your pack · saved'
          : 'Your pack · draft'
        : routed
          ? 'Routed wood'
          : p.modelScale || 'Built-in',
      p.pieces.length + (p.pieces.length === 1 ? ' piece' : ' pieces'),
      $('pack').value === p.id ? 'in the builder now' : '',
    ].filter(Boolean);
    left.append(wbEl('p', 'wb-pack-facts', facts.join(' · ')));
    const button = (label, run, cls = 'btn') => {
      const b = wbEl('button', cls, label);
      b.type = 'button';
      b.onclick = run;
      return b;
    };
    if (own && !p.inLibrary)
      actions.append(
        button('Save to my library', async () => {
          customLibrary.activePackId = p.id;
          await saveToLibrary(p);
        })
      );
    if (routed) actions.append(button('Configure in Routed Wood', () => (location.href = '#routed')));
    if (!own && !routed && p.gallery)
      // In its own window: the app stays as it is, with any save still running.
      actions.append(button('Open the gallery', () => window.open(p.gallery, '_blank'), 'btn quiet'));
    const exportButton = button('Export pack', () => downloadPack(p.id));
    exportButton.disabled = !shareable;
    if (!shareable) exportButton.title = 'This pack has reference artwork only, so there is nothing to share.';
    actions.append(exportButton);
    const use = button($('pack').value === p.id ? 'In the builder' : 'Build with this pack', () => useInBuilder(p));
    use.disabled = !p.pieces.length;
    actions.append(use);
    bar.replaceChildren(left, actions);
  }
  function renderWbBin(p) {
    const host = $('wb-bin'),
      query = $('packs-search').value.trim().toLowerCase(),
      list = p.pieces.filter(d => !query || (d.name + ' ' + (d.sku || '')).toLowerCase().includes(query)),
      groups = CF.group(list).filter(g => g.pieces.length),
      parts = [];
    for (const g of groups) {
      parts.push(wbEl('p', 'wb-label', g.name + ' · ' + g.pieces.length));
      for (const d of g.pieces) {
        const row = wbEl('button', 'wb-piece');
        row.type = 'button';
        row.dataset.piece = d.id;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(d.id === wbView.piece));
        const art = wbEl('span', 'wb-thumb');
        try {
          art.append(pieceThumb(d));
        } catch {}
        const words = wbEl('span', 'wb-piece-text');
        words.append(wbEl('strong', '', d.name), wbEl('small', '', d.sku || wbKind(d)));
        row.append(art, words);
        parts.push(row);
      }
    }
    if (!parts.length)
      parts.push(
        wbEl(
          'p',
          'wb-message',
          query
            ? 'No pieces match “' + query + '”.'
            : wbOwn(p)
              ? 'No pieces yet. Make the first one.'
              : 'This pack is empty.'
        )
      );
    host.replaceChildren(...parts);
    $('wb-new-piece').hidden = !wbOwn(p) || (p.pieces.every(d => d.parameters?.routed) && p.pieces.length > 0);
    return list;
  }
  function renderWbPiece(p, d) {
    const stage = $('wb-stage'),
      ins = $('wb-inspector');
    if (!d) {
      stage.replaceChildren(
        wbEl('p', 'wb-message', wbOwn(p) ? 'Choose ＋ New piece to start this pack.' : 'Choose a piece on the left.')
      );
      ins.replaceChildren(wbEl('h2', '', p.name), wbEl('p', 'wb-note', 'Pick a piece to see its measurements.'));
      return;
    }
    stage.replaceChildren(wbDrawing(d));
    if (d.geometry) {
      const b = paletteBounds(d);
      stage.append(wbEl('p', 'wb-stage-note', 'Footprint ' + Math.round(b[2]) + ' × ' + Math.round(b[3]) + ' mm'));
    }
    const own = wbOwn(p),
      head = wbEl('div', 'wb-ins-head');
    head.append(
      wbEl('span', 'wb-tag', wbKind(d) + (d.sku ? ' · ' + d.sku : '')),
      wbEl('h2', '', d.name),
      wbEl(
        'p',
        'wb-ins-sub',
        p.name +
          ' · ' +
          (d.status === 'user-defined' ? 'your measurements' : d.geometry ? 'nominal' : 'reference, approximate')
      )
    );
    const facts = wbEl('div', 'wb-facts');
    facts.dataset.units = 'raw';
    for (const [label, value] of wbFacts(d)) {
      const f = wbEl('div', 'wb-fact');
      f.append(wbEl('span', '', label), wbEl('b', '', value));
      facts.append(f);
    }
    const target = customLibrary.packs.find(x => x.id === customLibrary.activePackId) || customLibrary.packs[0];
    const note = wbEl(
      'p',
      'wb-note',
      own
        ? 'Your piece. Copy & adjust makes a new version; tracks keep the version they use.'
        : 'Built-in pieces keep their measurements. To change one, copy it into one of your packs.'
    );
    const button = (label, cls, run) => {
      const b = wbEl('button', cls, label);
      b.type = 'button';
      b.onclick = run;
      return b;
    };
    const copy = button(own ? 'Copy & adjust' : 'Copy & adjust into ' + (target?.name || 'My packs'), 'btn', () => {
      if (d.parameters?.routed) return routedUI.createFrom(d, own ? p.id : target.id);
      if (!own && target) customLibrary.activePackId = target.id;
      openCustom(d);
    });
    copy.hidden = !d.parameters || d.parameters.type === 'reference';
    const add = button('Add to the track', 'btn primary wb-add', () => {
      location.hash = 'builder';
      routeSection();
      updateView();
      place(d, p);
    });
    const tools = wbEl('div', 'wb-ins-tools');
    tools.append(copy);
    if (own) {
      const remove = button('Delete from pack', 'btn quiet danger', () => {
        customLibrary.activePackId = p.id;
        askDeletePackPieces([d.id]);
      });
      tools.append(remove);
    }
    ins.replaceChildren(head, facts, note, tools, add);
  }
  function renderWorkbench() {
    if (wbEditing()) return;
    const p = wbPack();
    if (!p) return;
    wbView.pack = p.id;
    if (wbOwn(p)) customLibrary.activePackId = p.id;
    renderWbPacks(p);
    renderWbPackBar(p);
    const list = renderWbBin(p),
      d = list.find(x => x.id === wbView.piece) || list[0] || null;
    wbView.piece = d?.id || '';
    $('wb-bin')
      .querySelectorAll('[data-piece]')
      .forEach(b => b.setAttribute('aria-selected', String(b.dataset.piece === wbView.piece)));
    renderWbPiece(p, d);
    keepWbView();
  }
  // The piece editor in place: the piece window's form moves into the workbench while you edit.
  const wbEditing = () => $('piece-form').parentElement === $('wb-editor');
  function dockPieceForm() {
    const editor = $('wb-editor');
    editor.append($('piece-form'));
    editor.hidden = false;
    $('packs-view').classList.add('wb-editing');
    $('piece-form').elements.name?.focus({ preventScroll: true });
  }
  function undockPieceForm() {
    if (!wbEditing()) return;
    $('piece-dialog').append($('piece-form'));
    $('wb-editor').hidden = true;
    $('packs-view').classList.remove('wb-editing');
    renderWorkbench();
  }
  function renderTrackPacks() {
    if (document.body.dataset.section === 'packs') renderWorkbench();
  }

  function updateCustomSelection() {}
  function askDeletePackPieces(ids) {
    const pack = activePack(),
      chosen = new Set(ids),
      pieces = pack.pieces.filter(d => chosen.has(d.id));
    if (!pieces.length || deletePackBusy) return;
    deletePackPieces = { packId: pack.id, ids: pieces.map(d => d.id) };
    $('delete-pack-pieces-summary').textContent =
      pieces.length === 1
        ? 'Delete “' + pieces[0].name + '” from “' + pack.name + '”?'
        : 'Delete ' + pieces.length + ' pieces from “' + pack.name + '”?';
    $('delete-pack-pieces-error').textContent = '';
    $('delete-pack-pieces-dialog').showModal();
  }
  async function confirmDeletePackPieces() {
    if (!deletePackPieces || deletePackBusy) return;
    deletePackBusy = true;
    let committed = false;
    const request = deletePackPieces;
    $('delete-pack-pieces-confirm').disabled = $('delete-pack-pieces-cancel').disabled = true;
    try {
      if (!DS.disk && (browserPackBaseline === undefined || localStorage.getItem(CP.STORAGE) !== browserPackBaseline))
        throw Error(
          'Another browser tab changed the saved packs. Reload before deleting, or export your current pack to keep unsaved changes.'
        );
      const next = CP.removePieces(customLibrary, request.packId, request.ids),
        data = CP.serialize(next);
      if (DS.disk) await DS.putPacks(data);
      else writeBrowserPacks(data);
      committed = true;
      customLibrary = next;
      customs = next.packs.flatMap(p => p.pieces);
      browserPackUnsaved = false;
      customPieceSelection.clear();
      deletePackPieces = null;
      $('delete-pack-pieces-dialog').close();
      // Keep definitions for placed pieces and the builder's undo/redo history.
      // Saved designs already embed their own definitions independently of packs.
      populatePacks();
      renderPackControls();
      renderCustomLibrary();
      renderTrackPacks();
      catalogue();
      saveState('clean', DS.disk ? 'Saved to disk' : 'Saved in browser');
      say(
        request.ids.length +
          ' ' +
          (request.ids.length === 1 ? 'piece deleted' : 'pieces deleted') +
          ' from the pack. Existing tracks are kept.'
      );
    } catch (e) {
      if (committed)
        say(
          'Pieces were deleted and saved, but the display could not refresh. Reload to update the view. ' + e.message,
          true
        );
      else $('delete-pack-pieces-error').textContent = 'Pieces were not deleted: ' + e.message;
    } finally {
      deletePackBusy = false;
      $('delete-pack-pieces-confirm').disabled = $('delete-pack-pieces-cancel').disabled = false;
    }
  }
  let customPage = 0;
  // The old "Edit your pack" page is now part of the Track Packs workbench.
  function renderCustomLibrary() {}
  function syncSaveChoices(existing) {
    const show = !$('design-copy-label').hidden && !$('design-copy').disabled,
      copy = $('design-copy').checked;
    $('design-save-choices').hidden = !show;
    for (const b of $('design-save-choices').querySelectorAll('[data-copy]'))
      b.setAttribute('aria-checked', String((b.dataset.copy === 'true') === copy));
    if (existing)
      $('design-save-update-note').textContent =
        'Replaces “' + existing.title + '”, saved ' + garageAgo(existing.updatedAt).toLowerCase() + '.';
    $('design-save-note').hidden = show;
  }
  function showSavePreview() {
    try {
      const current = layout(false),
        facts = DL.summarize({ layout: current });
      $('design-save-facts').textContent = [garageKind(facts), garageNumbers(facts)].filter(Boolean).join(' · ');
      $('design-save-picture').innerHTML = items.length ? I.picture(current, { maxDimension: 360 }).svg : '';
    } catch {
      $('design-save-picture').replaceChildren();
    }
  }
  async function openDesignSave() {
    const generation = ++designSaveGeneration;
    stop();
    $('save-design-form').reset();
    $('design-name').value = title;
    $('design-save-error').textContent = '';
    $('design-save-submit').disabled = true;
    $('design-save-choices').hidden = true;
    $('design-save-note').hidden = false;
    showSavePreview();
    $('save-design-dialog').showModal();
    try {
      const records = await DL.summaries();
      if (generation !== designSaveGeneration || !$('save-design-dialog').open) return;
      const existing = records.find(r => r.id === integrationState.designId);
      // Its saved copy was deleted (or moved to the Bin): this save starts a new one.
      if (!existing && librarySource && !records.some(r => r.id === librarySource.id)) librarySource = null;
      if (existing && !librarySource && existing.designRevision === layout(false).design.revision)
        librarySource = DL.source(existing);
      const unknown = !!existing && librarySource?.id !== existing.id;
      $('design-copy').checked = unknown;
      $('design-copy').disabled = unknown;
      $('design-save-note').textContent = unknown
        ? 'This drawing has no saved-version baseline. Save a new copy, or open the saved design to update it.'
        : existing
          ? 'Saving updates the version opened in this window. Choose a new copy to keep that version.'
          : 'This saves a new design in your library.';
      $('design-copy-label').hidden = !existing;
      $('design-save-submit').textContent = unknown
        ? 'Save as a new track'
        : existing
          ? 'Update saved track'
          : 'Save track';
      $('design-save-submit').disabled = false;
      syncSaveChoices(existing);
    } catch (e) {
      if (generation === designSaveGeneration && $('save-design-dialog').open)
        $('design-save-error').textContent = e.message;
    }
  }
  async function saveDesign(e) {
    e.preventDefault();
    if (designSaveBusy) return;
    designSaveBusy = true;
    $('design-save-error').textContent = '';
    const buttons = [...$('save-design-dialog').querySelectorAll('button')];
    buttons.forEach(b => (b.disabled = true));
    try {
      const record = await DL.save(
        layout(false),
        $('design-name').value,
        $('design-copy').checked,
        librarySource?.id === integrationState.designId ? librarySource.revision : null
      );
      afterLibrarySave(record);
      $('save-design-dialog').close();
    } catch (error) {
      $('design-save-error').textContent = error.message;
    } finally {
      designSaveBusy = false;
      buttons.forEach(b => (b.disabled = false));
    }
  }
  function afterLibrarySave(record) {
    const imported = I.importLayout(record.layout);
    checkpoint();
    librarySource = DL.source(record);
    title = imported.title;
    integrationState = imported.state;
    $('track-name').value = title;
    refresh();
    say('“' + title + '” saved to your Track Library.');
    if (document.body.dataset.section === 'library') renderDesignLibrary();
  }
  function designDownload(record) {
    downloadTrack(record.layout);
  }
  function pageControls(host, offset, total, limit, change) {
    host.replaceChildren();
    host.hidden = total <= limit;
    if (host.hidden) return;
    const previous = document.createElement('button'),
      next = document.createElement('button'),
      label = document.createElement('span');
    // Control Strip pager: quiet square buttons around the page count.
    previous.className = next.className = 'btn ghost sm icon';
    previous.textContent = '‹';
    next.textContent = '›';
    previous.setAttribute('aria-label', 'Previous page');
    next.setAttribute('aria-label', 'Next page');
    previous.title = 'Previous page';
    next.title = 'Next page';
    label.className = 'strip-page';
    previous.disabled = offset === 0;
    next.disabled = offset + limit >= total;
    previous.onclick = () => change(Math.max(0, offset - limit));
    next.onclick = () => change(offset + limit);
    label.textContent = 'Page ' + (Math.floor(offset / limit) + 1) + ' of ' + Math.ceil(total / limit);
    label.setAttribute('aria-live', 'polite');
    host.append(label, previous, next);
  }
  // ---------------------------------------------------------------- Track Library: the Garage
  // What's on the bench (the builder's track) on top, then every saved track as a picture card,
  // filtered by kind, system or star and sorted by date, name, lap or footprint.
  const GARAGE_VIEW = 'slotforge.library-view.v1',
    GARAGE_PAGE = 48;
  let garageAll = [],
    garageShown = GARAGE_PAGE,
    garageBin = [],
    garageBinOpen = false,
    renameDesign = null,
    garagePending = null;
  const garageView = (() => {
    try {
      const v = JSON.parse(localStorage.getItem(GARAGE_VIEW) || '{}');
      return { filter: typeof v.filter === 'string' ? v.filter : 'all', sort: v.sort || 'recent' };
    } catch {
      return { filter: 'all', sort: 'recent' };
    }
  })();
  function keepGarageView() {
    try {
      localStorage.setItem(GARAGE_VIEW, JSON.stringify(garageView));
    } catch {}
  }
  function garageLength(mm) {
    return Units.system() === 'imperial' ? Units.inches(mm) : (mm / 1000).toFixed(1) + ' m';
  }
  function garageKind(r) {
    if (r.kind === 'routed') return 'Routed wood';
    if (r.kind === 'freeform') return 'FreeForm';
    const systems = r.systems || [];
    return systems.length ? systems[0] + (systems.length > 1 ? ' +' + (systems.length - 1) : '') : 'Sectional';
  }
  function garageFacts(r) {
    return [
      garageKind(r),
      r.laneCount ? r.laneCount + (r.laneCount === 1 ? ' lane' : ' lanes') : r.pieceCount ? 'open layout' : 'empty',
      r.lapMm ? garageLength(r.lapMm) + ' lap' : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  function garageNumbers(r) {
    return [
      r.laneCount ? r.laneCount + (r.laneCount === 1 ? ' lane' : ' lanes') : r.pieceCount ? 'open layout' : 'empty',
      r.lapMm ? garageLength(r.lapMm) + ' lap' : '',
      garageSize(r),
    ]
      .filter(Boolean)
      .join(' · ');
  }
  function garageSize(r) {
    return r.sizeMm ? garageLength(r.sizeMm[0]) + ' × ' + garageLength(r.sizeMm[1]) : '';
  }
  function garageAgo(iso) {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'Just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + (Math.round(s / 3600) === 1 ? ' hour ago' : ' hours ago');
    const days = Math.floor(s / 86400);
    if (days === 1) return 'Yesterday';
    if (days < 7) return days + ' days ago';
    return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function garageMatches(r, filter) {
    if (filter === 'all') return true;
    if (filter === 'fav') return !!r.favourite;
    if (filter.startsWith('sys:')) return (r.systems || []).includes(filter.slice(4));
    return r.kind === filter;
  }
  const garageSorts = {
    recent: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    name: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }),
    long: (a, b) => (b.lapMm || 0) - (a.lapMm || 0),
    short: (a, b) => (a.lapMm || Infinity) - (b.lapMm || Infinity),
    small: (a, b) =>
      (a.sizeMm ? a.sizeMm[0] * a.sizeMm[1] : Infinity) - (b.sizeMm ? b.sizeMm[0] * b.sizeMm[1] : Infinity),
  };
  function garageChips() {
    const host = $('garage-chips'),
      chips = [['all', 'All', garageAll.length]],
      favourites = garageAll.filter(r => r.favourite).length;
    if (favourites) chips.push(['fav', '★ Favourites', favourites]);
    for (const [kind, label] of [
      ['sectional', 'Sectional'],
      ['routed', 'Routed wood'],
      ['freeform', 'FreeForm'],
    ]) {
      const n = garageAll.filter(r => r.kind === kind).length;
      if (n && n < garageAll.length) chips.push([kind, label, n]);
    }
    const systems = new Map();
    for (const r of garageAll) for (const s of r.systems || []) systems.set(s, (systems.get(s) || 0) + 1);
    if (systems.size > 1)
      for (const [name, n] of [...systems].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
        chips.push(['sys:' + name, name, n]);
    if (!chips.some(c => c[0] === garageView.filter)) garageView.filter = 'all';
    host.replaceChildren(
      ...chips.map(([key, label, n], i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className =
          'garage-chip' + (key.startsWith('sys:') && !chips[i - 1]?.[0].startsWith('sys:') ? ' first-system' : '');
        b.dataset.filter = key;
        b.setAttribute('aria-pressed', String(key === garageView.filter && !garageBinOpen));
        const count = document.createElement('span');
        count.className = 'garage-chip-count';
        count.textContent = n;
        b.append(label, count);
        return b;
      })
    );
    host.hidden = chips.length < 2;
  }
  async function garageOpen(id) {
    try {
      const fresh = await DL.get(id);
      confirmReplace(() => {
        try {
          applyImport(fresh.layout, DL.source(fresh));
          location.hash = 'builder';
          routeSection();
        } catch (e) {
          say(e.message, true);
        }
      });
    } catch (e) {
      say(e.message, true);
    }
  }
  function garageMenu(r, x, y) {
    Menus.context(
      x,
      y,
      [
        { label: 'Open in builder', action: () => garageOpen(r.id) },
        { label: 'Rename…', action: () => garageRename(r), shortcut: 'F2' },
        { label: 'Duplicate', action: () => garageDuplicate(r) },
        { label: r.favourite ? 'Remove the star' : 'Add a star', action: () => garageStar(r) },
        'separator',
        {
          label: 'Export…',
          action: () => {
            setTransferKind('tracks');
            exportChoice = 'saved:' + r.id;
            location.hash = 'export';
            routeSection();
          },
        },
        {
          label: 'Download track file',
          action: async () => {
            try {
              designDownload(await DL.get(r.id));
            } catch (e) {
              say(e.message, true);
            }
          },
        },
        'separator',
        {
          label: DL.hasBin() ? 'Move to the Bin' : 'Delete…',
          action: () => garageDelete(r),
          danger: true,
          shortcut: 'Del',
        },
      ],
      'Actions for ' + r.title
    );
  }
  async function garageStar(r) {
    try {
      await DL.favourite(r.id, !r.favourite);
      say(r.favourite ? '“' + r.title + '” no longer starred.' : '“' + r.title + '” starred.');
      // A star does not change the track, so the loaded list is updated in place.
      r.favourite = !r.favourite;
      renderDesignLibrary(false);
    } catch (e) {
      say(e.message, true);
    }
  }
  async function garageDuplicate(r) {
    try {
      const fresh = await DL.get(r.id),
        name = (r.title.length > 93 ? r.title.slice(0, 93) : r.title) + ' copy',
        copy = await DL.save(fresh.layout, name, true);
      say('“' + copy.layout.title + '” added to your Track Library.');
      renderDesignLibrary();
    } catch (e) {
      say(e.message, true);
    }
  }
  function garageRename(r) {
    renameDesign = r;
    $('rename-design-name').value = r.title;
    $('rename-design-error').textContent = '';
    $('rename-design-dialog').showModal();
    $('rename-design-name').select();
  }
  function garageDelete(r) {
    garagePending = null;
    deleteDesignId = r.id;
    deleteDesignRevision = r.revision;
    $('delete-design-name').textContent = r.title;
    const bin = DL.hasBin();
    $('delete-design-heading').textContent = bin ? 'Move to the Bin?' : 'Delete saved track?';
    $('delete-design-note').textContent = bin
      ? 'You can restore it from the Bin later. A layout already open in the builder and downloaded files are kept.'
      : 'This removes it from the library for good. A layout already open in the builder and downloaded files are kept.';
    $('delete-design-confirm').textContent = bin ? 'Move to the Bin' : 'Delete saved track';
    $('delete-design-dialog').showModal();
  }
  function garagePicture(host, r, generation) {
    host.textContent = r.pieceCount ? '' : 'Empty design';
    if (!r.pieceCount) return null;
    host.classList.add('loading');
    return { record: r, picture: host, generation };
  }
  function garageCard(r) {
    const card = document.createElement('article');
    card.className = 'garage-card';
    card.dataset.id = r.id;
    card.dataset.kind = r.kind || 'sectional';
    const onBench = librarySource?.id === r.id && items.length;
    if (onBench) card.classList.add('on-bench');
    const picture = document.createElement('button');
    picture.type = 'button';
    picture.className = 'garage-picture';
    picture.setAttribute('aria-label', 'Open ' + r.title + ' in the builder');
    picture.onclick = () => garageOpen(r.id);
    const frame = document.createElement('span');
    frame.className = 'garage-frame';
    picture.append(frame);
    if (onBench) {
      const badge = document.createElement('span');
      badge.className = 'garage-badge';
      badge.textContent = 'On the bench';
      picture.append(badge);
    }
    const body = document.createElement('div');
    body.className = 'garage-card-body';
    const head = document.createElement('div');
    head.className = 'garage-card-head';
    const name = document.createElement('h3');
    name.textContent = r.title;
    name.title = r.title;
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'garage-star';
    star.textContent = r.favourite ? '★' : '☆';
    star.setAttribute('aria-pressed', String(!!r.favourite));
    star.setAttribute('aria-label', (r.favourite ? 'Remove the star from ' : 'Star ') + r.title);
    star.title = r.favourite ? 'Starred' : 'Add a star';
    star.onclick = () => garageStar(r);
    head.append(name, star);
    const system = document.createElement('p');
    system.className = 'garage-system';
    system.textContent = garageKind(r);
    system.title = r.systems?.join(', ') || garageKind(r);
    const facts = document.createElement('p');
    facts.className = 'garage-facts';
    facts.dataset.units = 'raw';
    facts.textContent = garageNumbers(r);
    const when = document.createElement('p');
    when.className = 'garage-when';
    when.textContent = garageAgo(r.updatedAt);
    when.title = 'Saved ' + new Date(r.updatedAt).toLocaleString();
    const actions = document.createElement('div');
    actions.className = 'garage-card-actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn sm';
    open.textContent = 'Open';
    open.onclick = () => garageOpen(r.id);
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'btn sm icon garage-more-actions';
    more.textContent = '⋯';
    more.setAttribute('aria-label', 'More actions for ' + r.title);
    more.title = 'Rename, duplicate, export, delete';
    more.setAttribute('aria-haspopup', 'menu');
    more.onclick = e => {
      e.stopPropagation();
      const b = more.getBoundingClientRect();
      garageMenu(r, b.left, b.bottom + 4);
    };
    actions.append(open, more);
    body.append(head, system, facts, when, actions);
    card.append(picture, body);
    card.oncontextmenu = e => {
      e.preventDefault();
      garageMenu(r, e.clientX, e.clientY);
    };
    card.onkeydown = e => {
      if (e.target.closest('input, select, textarea')) return;
      if (e.key === 'F2') {
        e.preventDefault();
        garageRename(r);
      } else if (e.key === 'Delete') {
        e.preventDefault();
        garageDelete(r);
      }
    };
    return { card, frame };
  }
  function renderGarageBench() {
    const bench = $('garage-bench');
    // With a track on the bench, the bench does the saving; the heading's button steps aside.
    $('library-save-current').hidden = !!items.length;
    if (!items.length) {
      bench.hidden = true;
      return;
    }
    let current, summary;
    try {
      current = layout(false);
      summary = DL.summarize({ layout: current });
    } catch {
      bench.hidden = true;
      return;
    }
    const linked = librarySource ? garageAll.find(r => r.id === librarySource.id) : null,
      changed = linked && linked.designRevision !== current.design.revision;
    bench.hidden = false;
    bench.dataset.state = linked ? (changed ? 'changed' : 'saved') : 'new';
    $('garage-bench-name').textContent = title;
    $('garage-bench-facts').dataset.units = 'raw';
    $('garage-bench-facts').textContent = [garageFacts(summary), garageSize(summary)].filter(Boolean).join(' · ');
    $('garage-bench-state').textContent = 'On the bench now';
    $('garage-bench-note').textContent = linked
      ? changed
        ? 'Changed since you saved it ' + garageAgo(linked.updatedAt).toLowerCase() + '.'
        : 'Saved in your library. Nothing new to save.'
      : 'Not in your library yet.';
    $('garage-save-changes').hidden = !!linked && !changed;
    $('garage-save-changes').textContent = linked ? 'Save changes' : 'Save to library';
    $('garage-save-changes').classList.toggle('primary', !linked || changed);
    try {
      const svg = I.picture(current, { maxDimension: 640 }).svg,
        image = document.createElement('img');
      image.alt = '';
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      $('garage-bench-picture').replaceChildren(image);
    } catch {
      $('garage-bench-picture').replaceChildren();
    }
  }
  async function garageSaveChanges() {
    const linked = librarySource ? garageAll.find(r => r.id === librarySource.id) : null;
    if (!linked) return openDesignSave();
    const button = $('garage-save-changes');
    button.disabled = true;
    try {
      const record = await DL.save(
        layout(false),
        title,
        false,
        librarySource?.id === integrationState.designId ? librarySource.revision : null
      );
      afterLibrarySave(record);
    } catch (e) {
      say(e.message, true);
    } finally {
      button.disabled = false;
    }
  }
  async function renderGarageBin() {
    const panel = $('garage-bin-panel'),
      list = $('garage-bin-list');
    panel.hidden = !garageBinOpen;
    $('garage-bin').setAttribute('aria-pressed', String(garageBinOpen));
    if (!garageBinOpen) return;
    list.replaceChildren(
      ...garageBin.map(r => {
        const row = document.createElement('div');
        row.className = 'garage-bin-row';
        const text = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = r.title;
        const facts = document.createElement('span');
        facts.className = 'garage-facts';
        facts.dataset.units = 'raw';
        facts.textContent = garageFacts(r) + ' · deleted ' + garageAgo(r.deletedAt).toLowerCase();
        text.append(name, facts);
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'btn sm';
        restore.textContent = 'Restore';
        restore.onclick = async () => {
          restore.disabled = true;
          try {
            const back = await DL.restore(r.id, r.deletedAt);
            say('“' + back.layout.title + '” is back in your Track Library.');
            renderDesignLibrary();
          } catch (e) {
            restore.disabled = false;
            say(e.message, true);
          }
        };
        const purge = document.createElement('button');
        purge.type = 'button';
        purge.className = 'btn sm quiet danger';
        purge.textContent = 'Delete for good';
        purge.onclick = () =>
          garageConfirm(
            'Delete “' + r.title + '” for good?',
            'It leaves the Bin and cannot be restored.',
            'Delete for good',
            async () => {
              await DL.purge(r.id, r.deletedAt);
              renderDesignLibrary();
            }
          );
        row.append(text, restore, purge);
        return row;
      })
    );
    if (!garageBin.length) {
      const empty = document.createElement('p');
      empty.className = 'fine';
      empty.textContent = 'The Bin is empty.';
      list.append(empty);
    }
    $('garage-empty-bin').hidden = !garageBin.length;
  }
  function garageConfirm(heading, note, label, run) {
    deleteDesignId = null;
    garagePending = run;
    $('delete-design-heading').textContent = heading;
    $('delete-design-name').textContent = '';
    $('delete-design-note').textContent = note;
    $('delete-design-confirm').textContent = label;
    $('delete-design-dialog').showModal();
  }
  // Saved-track pictures by revision, shared by the Track Library and the Print Shop, so a page
  // drawn again does not ask the workspace for the same pictures again.
  var previewMemo; // var: start-up may draw the library before this line runs
  async function cachedPreview(r) {
    const key = r.id + ':' + r.revision;
    previewMemo ||= new Map();
    if (previewMemo.has(key)) return previewMemo.get(key);
    const result = await DL.preview(r.id);
    if (result.revision === r.revision) {
      previewMemo.set(key, result);
      while (previewMemo.size > 400) previewMemo.delete(previewMemo.keys().next().value);
    }
    return result;
  }
  // refetch false (search, sort, filters, Show more, the Bin toggle, a star): reuse the loaded list.
  async function renderDesignLibrary(refetch = true) {
    const generation = ++libraryRender,
      host = $('design-library');
    $('design-library-status').textContent = garageAll.length ? '' : 'Loading saved tracks…';
    try {
      const fresh = refetch || !garageAll.length;
      if (fresh) {
        const all = await DL.summaries();
        if (generation !== libraryRender) return;
        garageAll = all;
      }
      if (fresh && DL.hasBin()) {
        try {
          garageBin = await DL.bin();
        } catch {
          garageBin = [];
        }
        if (generation !== libraryRender) return;
      }
      $('garage-bin').hidden = !DL.hasBin() || (!garageBin.length && !garageBinOpen);
      $('garage-bin-count').textContent = garageBin.length ? String(garageBin.length) : '';
      if (fresh) renderGarageBench();
      garageChips();
      renderGarageBin();
      const query = $('design-search').value.trim().toLowerCase(),
        shown = garageAll
          .filter(r => garageMatches(r, garageView.filter))
          .filter(r => !query || r.title.toLowerCase().includes(query))
          .sort((a, b) => garageSorts[garageView.sort](a, b) || garageSorts.recent(a, b));
      const systems = new Set(garageAll.flatMap(r => r.systems || [])).size,
        total = garageAll.length;
      $('garage-count').textContent = !total
        ? 'No saved tracks yet'
        : shown.length === total
          ? total + (total === 1 ? ' track' : ' tracks') + (systems > 1 ? ' · ' + systems + ' systems' : '')
          : shown.length + ' of ' + total + ' tracks';
      $('design-library-status').textContent =
        total && !shown.length ? (query ? 'No tracks match “' + query + '”.' : 'No tracks in this group.') : '';
      $('design-library-empty').hidden = !!total;
      $('garage-sort').value = garageView.sort;
      host.hidden = garageBinOpen;
      $('garage-more').hidden = garageBinOpen || shown.length <= garageShown;
      $('garage-more').textContent = 'Show ' + Math.min(GARAGE_PAGE, shown.length - garageShown) + ' more';
      const cards = [],
        previews = [];
      for (const r of shown.slice(0, garageShown)) {
        const { card, frame } = garageCard(r);
        cards.push(card);
        const job = garagePicture(frame, r, generation);
        if (job) previews.push(job);
      }
      host.replaceChildren(...cards);
      // Two bounded requests at a time; abandoned renders cannot fill the new cards.
      async function loadPreviews() {
        while (previews.length && generation === libraryRender) {
          const { record, picture } = previews.shift();
          try {
            const result = await cachedPreview(record);
            if (generation !== libraryRender) return;
            picture.classList.remove('loading');
            if (result.revision !== record.revision) {
              picture.textContent = 'Track updated — reopen this page';
              continue;
            }
            const image = document.createElement('img');
            image.alt = '';
            image.loading = 'lazy';
            image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(result.svg);
            picture.replaceChildren(image);
          } catch (e) {
            if (generation === libraryRender) {
              picture.classList.remove('loading');
              picture.textContent = 'Preview unavailable';
              picture.title = e.message;
            }
          }
        }
      }
      void loadPreviews();
      void loadPreviews();
    } catch (e) {
      if (generation === libraryRender) $('design-library-status').textContent = e.message;
    }
  }

  // railKey: the side-list item to show; another page sending you here (Library → Export…)
  // lands on the export section of that kind, even if Import was picked last time.
  // ---------------------------------------------------------------- Import & Export: the Print Shop
  // Left: what to export (the track on the bench, library tracks, packs, the whole workspace) with
  // Import at the bottom. Middle: the output itself. Right: the format's options and its Save button.
  const SHOP_VIEW = 'slotforge.print-shop.v1',
    TRACK_FORMATS = ['slotforge', 'pdf', 'png', 'csv', 'cad'],
    PICTURE_SIZES = { small: 800, large: 1600, poster: 2048 },
    SHOP_FORMATS = {
      slotforge: {
        tab: 'Track file',
        title: 'Track file',
        save: 'Save track file',
        note: 'The complete, editable track. Open it again with Import, or load it in SlotForge Timing.',
      },
      pdf: {
        tab: 'PDF report',
        title: 'PDF report',
        save: 'Save PDF',
        note: 'A printable A4 report with the track drawing, lane lengths and the parts list.',
      },
      png: {
        tab: 'Picture',
        title: 'Picture',
        save: 'Save PNG',
        note: 'A picture of the track for sharing, a forum post or a track database.',
      },
      csv: {
        tab: 'Parts list',
        title: 'Parts list',
        save: 'Save CSV',
        note: 'Every piece with its product code and quantity, ready for a spreadsheet.',
      },
      cad: {
        tab: 'Drawing',
        title: 'Drawing and panels',
        save: 'Choose layers and save…',
        note: 'Full-size SVG or DXF of routed track for CAD, and cut files for each table panel.',
      },
      pack: {
        tab: 'Pack file',
        title: 'Track pack file',
        save: 'Save pack file',
        note: 'The pack’s pieces, to share or to add on another computer. It holds no layout.',
      },
      backup: {
        tab: 'Workspace backup',
        title: 'Workspace backup',
        save: 'Save backup',
        note: 'Everything in one file: the open track, every library track and your own packs.',
      },
    };
  const shopView = (() => {
    const pick = (value, list, fallback) => (list.includes(value) ? value : fallback);
    let v = {};
    try {
      v = JSON.parse(localStorage.getItem(SHOP_VIEW) || '{}') || {};
    } catch {}
    return {
      format: pick(v.format, TRACK_FORMATS, 'pdf'),
      orientation: pick(v.orientation, ['portrait', 'landscape'], 'portrait'),
      size: pick(v.size, Object.keys(PICTURE_SIZES), 'large'),
      background: pick(v.background, ['transparent', 'white', 'dark'], 'transparent'),
      borders: v.borders !== false,
    };
  })();
  let shopModel = null;
  function keepShopView() {
    try {
      localStorage.setItem(SHOP_VIEW, JSON.stringify(shopView));
    } catch {}
  }
  const shopKind = () => (exportChoice === 'backup' ? 'backup' : exportChoice.startsWith('pack:') ? 'pack' : 'track');
  const shopFormat = () => (shopKind() === 'track' ? shopView.format : shopKind());
  const shopEl = (tag, className, text) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  };
  const shopMessage = text => shopEl('p', 'shop-message', text);
  // Other pages send people here for a track (Library → Export…).
  function setTransferKind(kind) {
    if (kind === 'tracks' && shopKind() !== 'track') exportChoice = 'current';
  }
  function exportButtons(disabled) {
    document
      .querySelectorAll('[data-track-export]')
      .forEach(
        b =>
          (b.disabled = disabled || !exportTrackAvailable || (b.hasAttribute('data-cad-export') && !exportCadAvailable))
      );
  }
  function shopPack() {
    return exportChoice.startsWith('pack:') ? allPacks().find(p => p.id === exportChoice.slice(5)) : null;
  }
  function updateShopSave() {
    const f = shopFormat(),
      save = $('shop-save'),
      copy = $('shop-copy');
    save.textContent = SHOP_FORMATS[f].save;
    copy.hidden = f !== 'png';
    if (shopKind() === 'track') {
      save.setAttribute('data-track-export', '');
      save.toggleAttribute('data-cad-export', f === 'cad');
      exportButtons(!exportTrackAvailable);
    } else {
      save.removeAttribute('data-track-export');
      save.removeAttribute('data-cad-export');
      save.disabled = f === 'pack' && !shopPack()?.pieces.some(d => d.parameters);
    }
  }
  function renderShopTabs() {
    const host = $('shop-formats'),
      list = shopKind() === 'track' ? TRACK_FORMATS : [shopKind()];
    host.replaceChildren(
      ...list.map(f => {
        const b = shopEl('button', 'btn sm', SHOP_FORMATS[f].tab);
        b.type = 'button';
        b.dataset.format = f;
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(f === shopFormat()));
        return b;
      })
    );
  }
  function shopChoice(label, key, options) {
    const group = shopEl('div', 'shop-group'),
      bar = shopEl('div', 'pack-hub-filters');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', label);
    for (const [value, text] of options) {
      const b = shopEl('button', 'btn sm', text);
      b.type = 'button';
      b.dataset.shopOption = key;
      b.setAttribute('aria-pressed', String(shopView[key] === value));
      b.onclick = () => {
        shopView[key] = value;
        keepShopView();
        renderShopOptions();
        renderShopStage();
      };
      bar.append(b);
    }
    group.append(shopEl('p', 'shop-label', label), bar);
    return group;
  }
  function renderShopOptions() {
    const f = shopFormat(),
      host = $('shop-options-body');
    $('shop-format-title').textContent = SHOP_FORMATS[f].title;
    $('shop-format-note').textContent = SHOP_FORMATS[f].note;
    host.replaceChildren();
    if (f === 'pdf')
      host.append(
        shopChoice('Page', 'orientation', [
          ['portrait', 'A4 portrait'],
          ['landscape', 'A4 landscape'],
        ])
      );
    if (f === 'png') {
      const group = shopEl('div', 'shop-group'),
        label = shopEl('label', 'shop-check'),
        box = document.createElement('input');
      box.type = 'checkbox';
      box.id = 'picture-borders';
      box.checked = shopView.borders;
      box.onchange = () => {
        shopView.borders = box.checked;
        keepShopView();
        renderShopStage();
      };
      label.append(box, ' Borders and kerbs');
      group.append(shopEl('p', 'shop-label', 'Include'), label);
      host.append(
        shopChoice('Size', 'size', [
          ['small', 'Small'],
          ['large', 'Large'],
          ['poster', 'Poster'],
        ]),
        shopChoice('Background', 'background', [
          ['transparent', 'Transparent'],
          ['white', 'White'],
          ['dark', 'Dark'],
        ]),
        group
      );
    }
  }
  function shopTable(head, rows) {
    const table = shopEl('table', 'shop-table'),
      tr = document.createElement('tr');
    for (const h of head) tr.append(shopEl('th', '', h));
    table.append(tr);
    for (const row of rows) {
      const r = document.createElement('tr');
      for (const cell of row) r.append(shopEl('td', '', String(cell)));
      table.append(r);
    }
    return table;
  }
  const shopMetres = mm => (mm / 1000).toFixed(2) + ' m';
  function shopPdfPage(model) {
    const wrap = shopEl('div', 'shop-paper-wrap'),
      page = shopEl('div', 'shop-paper ' + shopView.orientation);
    page.dataset.units = 'raw';
    page.append(
      shopEl('h3', '', model.title),
      shopEl(
        'p',
        'shop-paper-sub',
        model.pieces.length +
          ' placed pieces · ' +
          (model.summary.invalidFreeform
            ? 'draft needs attention'
            : model.summary.planning
              ? 'approximate visual layout'
              : shopMetres(model.summary.length) + (model.summary.freeform ? ' reference slot' : ' track centreline'))
      )
    );
    const picture = shopEl('div', 'shop-paper-picture');
    picture.innerHTML = pdfDiagram(model.layout).svg;
    page.append(picture);
    const lanes = model.layout.track?.lanes || [];
    if (lanes.length)
      page.append(
        shopTable(
          ['Lane', 'Length'],
          lanes.map((l, i) => [l.label || 'Lane ' + (i + 1), shopMetres(l.lengthMm)])
        )
      );
    const room = shopView.orientation === 'portrait' ? 9 : 2,
      rows = model.inventory.map(({ d, count }) => [d.sku || 'Custom', d.name, count]);
    page.append(shopTable(['Product code', 'Piece', 'Qty'], rows.slice(0, room)));
    if (rows.length > room)
      page.append(
        shopEl('p', 'shop-paper-more', '+ ' + (rows.length - room) + ' more parts continue on the next page')
      );
    const foot = shopEl('div', 'shop-paper-foot');
    foot.append(shopEl('span', '', 'SlotForge Circuit'), shopEl('span', '', new Date().toLocaleDateString()));
    page.append(foot);
    wrap.append(page, shopEl('p', 'shop-caption', 'Preview of the first page. The PDF has the same content.'));
    $('shop-meta').textContent = 'A4 ' + shopView.orientation + ' · ' + model.inventory.length + ' kinds of parts';
    return wrap;
  }
  function shopPicture(model) {
    const picture = I.picture(model.layout, {
        borders: shopView.borders,
        maxDimension: PICTURE_SIZES[shopView.size],
      }),
      box = shopEl('div', 'shop-canvas'),
      img = document.createElement('img');
    box.dataset.background = shopView.background;
    img.alt = 'Picture of ' + model.title;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(picture.svg);
    box.append(img);
    $('shop-meta').textContent =
      picture.width + ' × ' + picture.height + ' px · ' + shopView.background + ' background';
    return box;
  }
  function shopParts(model) {
    const box = shopEl('div', 'shop-sheet');
    box.dataset.units = 'raw';
    box.append(
      shopTable(
        ['Piece', 'Product code', 'Pack', 'Qty', 'mm per piece'],
        model.inventory.map(({ d, count }) => {
          const length = XM.pieceLength(d);
          return [d.name, d.sku || '', d.pack, count, length == null ? '' : Number(length).toFixed(1)];
        })
      )
    );
    const total = model.inventory.reduce((n, r) => n + r.count, 0);
    $('shop-meta').textContent = model.inventory.length + ' rows · ' + total + ' pieces in all';
    return box;
  }
  function shopDrawing(model) {
    if (!exportCadAvailable) {
      $('shop-meta').textContent = '';
      return shopMessage(
        'This track has no routed sections, so there is nothing to cut. Use PDF report or Picture for sectional track.'
      );
    }
    const box = shopEl('div', 'shop-drawing'),
      img = document.createElement('img');
    img.alt = '';
    img.src =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(I.picture(model.layout, { borders: false, maxDimension: 1400 }).svg);
    box.append(img);
    $('shop-meta').textContent =
      model.routed.sections +
      ' routed sections' +
      (model.pieces.length > model.routed.sections ? ' · other pieces are left out' : '') +
      ' · layers and panels in the next step';
    return box;
  }
  function shopTrackFile(model) {
    const box = shopEl('div', 'shop-file'),
      file = XM.portableJSON(model.layout),
      head = shopEl('div', 'shop-file-head');
    head.innerHTML =
      '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/><path d="m10 13-2 2 2 2M14 13l2 2-2 2"/></svg>';
    const name = shopEl('div');
    name.append(
      shopEl('strong', '', XM.filename(model.title) + '.slotforge.json'),
      shopEl('span', '', Math.max(1, Math.round(file.bytes / 1024)) + ' KB')
    );
    head.append(name);
    const list = shopEl('ul', 'shop-file-list'),
      ws = model.layout.workspace || {};
    for (const line of [
      model.pieces.length + ' placed pieces',
      model.definitions && Object.keys(model.definitions).length + ' piece shapes, so it opens without the pack',
      ws.spaceGuide ? 'The table and its size' : '',
      'Heights, timing line and preview car',
      file.geometryIncluded ? 'Slot geometry for other apps' : 'Compact: slot geometry is rebuilt when opened',
    ].filter(Boolean))
      list.append(shopEl('li', '', line));
    const notes = model.layout.compatibility.issues.map(issue => issue.message);
    if (model.layout.timing.requiresLaneRemap) notes.unshift('Reconfirm lane mapping in SlotForge Timing.');
    const timing = shopEl('p', 'shop-timing' + (notes.length ? ' warn' : ''));
    timing.id = 'timing-compatibility';
    timing.textContent = notes.length ? notes.join(' ') : 'Ready for SlotForge Timing.';
    box.append(head, list, shopEl('p', 'shop-label', 'SlotForge Timing'), timing);
    $('shop-meta').textContent = 'Integration contract ' + model.layout.integration.contractVersion;
    return box;
  }
  function shopPackPreview() {
    const p = shopPack();
    if (!p) return shopMessage('This pack is no longer available. Choose another on the left.');
    const pieces = p.pieces.filter(d => d.parameters),
      box = shopEl('div', 'shop-sheet');
    box.append(
      shopTable(
        ['Piece', 'Product code', 'Type'],
        pieces.map(d => [d.name, d.sku || '', d.parameters.type])
      )
    );
    const excluded = p.pieces.length - pieces.length;
    $('shop-meta').textContent =
      pieces.length +
      (pieces.length === 1 ? ' piece' : ' pieces') +
      (excluded ? ' · ' + excluded + ' reference-only items are left out' : '');
    return pieces.length ? box : shopMessage('This pack has no pieces to share yet.');
  }
  async function shopBackupPreview(stage) {
    const generation = exportSourceGeneration,
      box = shopEl('div', 'shop-file'),
      list = shopEl('ul', 'shop-file-list');
    let tracks = 0;
    try {
      tracks = (await DL.summaries()).length;
    } catch {}
    if (generation !== exportSourceGeneration || shopKind() !== 'backup') return;
    const head = shopEl('div', 'shop-file-head');
    head.innerHTML =
      '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/><path d="M8 7h.01M8 17h.01"/></svg>';
    const name = shopEl('div');
    name.append(shopEl('strong', '', 'SlotForge-workspace-backup.json'), shopEl('span', '', 'Everything in one file'));
    head.append(name);
    for (const line of [
      'The open track: ' + title,
      tracks + (tracks === 1 ? ' track' : ' tracks') + ' from your Track Library',
      customLibrary.packs.length + (customLibrary.packs.length === 1 ? ' pack' : ' packs') + ' of your own',
    ])
      list.append(shopEl('li', '', line));
    box.append(
      head,
      list,
      shopEl(
        'p',
        'shop-timing',
        'Bring it back with Import: tracks and packs you don’t have yet are added, nothing is replaced.'
      )
    );
    $('shop-meta').textContent = '';
    stage.replaceChildren(box);
  }
  function renderShopStage() {
    const stage = $('shop-stage'),
      f = shopFormat();
    stage.dataset.format = f;
    $('shop-meta').textContent = '';
    if (f === 'pack') return stage.replaceChildren(shopPackPreview());
    if (f === 'backup') {
      stage.replaceChildren(shopMessage('Counting what goes in…'));
      return void shopBackupPreview(stage);
    }
    const model = shopModel;
    if (!model) return;
    if (!model.pieces.length)
      return stage.replaceChildren(shopMessage('This track is empty. Add pieces in the builder first.'));
    try {
      stage.replaceChildren(
        f === 'pdf'
          ? shopPdfPage(model)
          : f === 'png'
            ? shopPicture(model)
            : f === 'csv'
              ? shopParts(model)
              : f === 'cad'
                ? shopDrawing(model)
                : shopTrackFile(model)
      );
    } catch (e) {
      stage.replaceChildren(shopMessage(e.message));
    }
  }
  function shopSource(value, name, facts, art) {
    const b = shopEl('button', 'shop-source');
    b.type = 'button';
    b.dataset.choice = value;
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(value === exportChoice));
    const pic = shopEl('span', 'shop-thumb');
    if (art) pic.append(art);
    const text = shopEl('span', 'shop-source-text');
    text.append(shopEl('strong', '', name), shopEl('span', '', facts));
    text.lastChild.dataset.units = 'raw';
    b.append(pic, text);
    return { button: b, pic };
  }
  function shopIcon(path) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'shop-icon');
    s.innerHTML = path;
    return s;
  }
  function shopImage(svg) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return img;
  }
  var shopPreviewObserver = null;
  function renderShopSources(records) {
    const host = $('shop-sources'),
      parts = [],
      previews = [],
      generation = exportMenuGeneration;
    const group = (label, list) => {
      if (!list.length) return;
      const g = shopEl('div', 'shop-group-list');
      g.setAttribute('role', 'group');
      g.setAttribute('aria-label', label);
      g.append(shopEl('p', 'shop-label', label), ...list);
      parts.push(g);
    };
    let bench = null;
    try {
      bench = items.length ? shopImage(I.picture(layout(false), { maxDimension: 240 }).svg) : null;
    } catch {}
    group('On the bench', [
      shopSource('current', title, items.length ? items.length + ' placed pieces' : 'empty', bench).button,
    ]);
    group(
      'From the library',
      records.map(r => {
        const s = shopSource(
          'saved:' + r.id,
          r.title,
          [
            r.laneCount ? r.laneCount + (r.laneCount === 1 ? ' lane' : ' lanes') : '',
            r.lapMm ? garageLength(r.lapMm) : '',
          ]
            .filter(Boolean)
            .join(' · ') || r.pieceCount + ' pieces'
        );
        if (r.pieceCount) previews.push({ r, pic: s.pic });
        return s.button;
      })
    );
    group('Everything', [
      shopSource(
        'backup',
        'Workspace backup',
        'all tracks and packs',
        shopIcon(
          '<rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/>'
        )
      ).button,
    ]);
    const packIcon = '<path d="M12 3 4 7v10l8 4 8-4V7z"/><path d="m4 7 8 4 8-4M12 11v10"/>';
    group(
      'Track packs',
      allPacks()
        .filter(p => p.pieces.some(d => d.parameters))
        .map(p => {
          const n = p.pieces.filter(d => d.parameters).length;
          return shopSource('pack:' + p.id, p.name, n + (n === 1 ? ' piece' : ' pieces'), shopIcon(packIcon)).button;
        })
    );
    host.replaceChildren(...parts);
    host.setAttribute('role', 'listbox');
    host.setAttribute('aria-label', 'What to export');
    host.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    shopPreviewObserver?.disconnect();
    const queue = [],
      byPic = new Map(previews.map(p => [p.pic, p]));
    let running = false;
    const drain = async () => {
      if (running) return;
      running = true;
      while (queue.length && generation === exportMenuGeneration) {
        const { r, pic } = queue.shift();
        try {
          const result = await cachedPreview(r);
          if (generation === exportMenuGeneration && result.svg) pic.replaceChildren(shopImage(result.svg));
        } catch {}
      }
      running = false;
    };
    const take = pic => {
      const job = byPic.get(pic);
      if (!job) return;
      byPic.delete(pic);
      queue.push(job);
    };
    if (typeof IntersectionObserver === 'function') {
      shopPreviewObserver = new IntersectionObserver(
        entries => {
          for (const e of entries)
            if (e.isIntersecting) {
              shopPreviewObserver.unobserve(e.target);
              take(e.target);
            }
          drain();
        },
        { root: host, rootMargin: '200px 0px' }
      );
      for (const { pic } of previews) shopPreviewObserver.observe(pic);
    } else {
      for (const { pic } of previews) take(pic);
      drain();
    }
  }
  async function loadExportTrack() {
    const generation = ++exportSourceGeneration;
    exportTrackAvailable = false;
    exportCadAvailable = false;
    shopModel = null;
    $('export-source-error').textContent = '';
    $('shop-sources')
      .querySelectorAll('[data-choice]')
      .forEach(b => b.setAttribute('aria-selected', String(b.dataset.choice === exportChoice)));
    renderShopTabs();
    renderShopOptions();
    updateShopSave();
    if (shopKind() !== 'track') return renderShopStage();
    $('shop-stage').replaceChildren(shopMessage('Loading the track…'));
    try {
      const model = await XM.resolveSource(exportChoice, () => layout(), DL.get);
      if (generation !== exportSourceGeneration) return;
      showExportTrack(model);
    } catch (e) {
      if (generation !== exportSourceGeneration) return;
      $('shop-stage').replaceChildren(shopMessage('This track is unavailable. Choose another on the left.'));
      $('export-source-error').textContent = e.message;
    }
  }
  function showExportTrack(model) {
    exportTrackAvailable = !!model.pieces.length;
    exportCadAvailable = model.routed.sections > 0;
    shopModel = model;
    renderShopStage();
    updateShopSave();
  }
  async function populateExportTracks() {
    const generation = ++exportMenuGeneration;
    ++exportSourceGeneration;
    exportTrackAvailable = false;
    exportButtons(true);
    let records = [],
      libraryError = '';
    try {
      records = await DL.summaries();
    } catch (e) {
      libraryError = e.message;
    }
    if (generation !== exportMenuGeneration) return;
    let missing = '';
    if (exportChoice.startsWith('saved:') && !records.some(r => 'saved:' + r.id === exportChoice)) {
      exportChoice = 'current';
      missing = 'That saved track is no longer in the library, so the track on the bench is shown.';
    }
    if (exportChoice.startsWith('pack:') && !shopPack()) exportChoice = 'current';
    renderShopSources(records);
    await loadExportTrack();
    if (generation === exportMenuGeneration && (libraryError || missing))
      $('export-source-error').textContent = libraryError || missing;
  }
  async function makePdf(raw, orientation) {
    const picture = pdfDiagram(raw),
      url = URL.createObjectURL(new Blob([picture.svg], { type: 'image/svg+xml' }));
    let data;
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = picture.width;
      canvas.height = picture.height;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      data = canvas.toDataURL('image/jpeg', 0.95);
    } finally {
      URL.revokeObjectURL(url);
    }
    await window.PdfLibrary.load();
    return window.TrackPDF.create(raw, { data, width: picture.width, height: picture.height }, { orientation });
  }
  async function savePdf(raw) {
    const save = $('shop-save');
    save.textContent = 'Making the PDF…';
    try {
      const result = await makePdf(raw, shopView.orientation);
      download(XM.filename(result.title) + '.pdf', result.bytes, 'application/pdf');
      say('PDF saved: ' + result.title + ' · ' + result.pages + ' ' + (result.pages === 1 ? 'page' : 'pages'));
    } finally {
      save.textContent = SHOP_FORMATS[shopFormat()].save;
    }
  }
  async function copyPicture() {
    const model = shopModel;
    if (!model?.pieces.length) return;
    exportButtons(true);
    try {
      const { blob } = await pictureBlob(model.layout);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      say('Picture copied. Paste it into a message or a document.');
    } catch (e) {
      say('Could not copy the picture: ' + e.message, true);
    } finally {
      exportButtons(false);
    }
  }
  async function saveBackup(errorTarget = null) {
    try {
      const bundle = DS.disk
        ? await DS.exportBundle()
        : { ...(await browserBundle()), current: layout(false), customLibrary: CP.serialize(customLibrary) };
      bundle.current = layout(false);
      bundle.customLibrary = CP.serialize(customLibrary);
      download('SlotForge-workspace-backup.json', JSON.stringify(bundle));
      try {
        localStorage.setItem('slotforge.last-backup.v1', new Date().toISOString());
      } catch {}
      say('Complete workspace backup downloaded.');
      if (document.body.dataset.section === 'settings') renderSdWork();
    } catch (e) {
      if (errorTarget) errorTarget.textContent = e.message;
      say(e.message, true);
    }
  }
  // ---- Import: one way in for every SlotForge file, reviewed before anything changes.
  async function shopImportFile(file) {
    if (!file) return;
    if (file.size > 256 * 1024 * 1024) return say('That file is larger than 256 MB.', true);
    let raw;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      return say('Could not read ' + file.name + ': it is not a SlotForge file.', true);
    }
    reviewImport(raw, file.name, file.size);
  }
  function reviewImport(raw, name, size) {
    const dialog = $('import-review'),
      actions = $('import-review-actions'),
      picture = $('import-review-picture'),
      small = size <= 5 * 1024 * 1024;
    $('import-review-error').textContent = '';
    picture.replaceChildren();
    const button = (label, primary, run) => {
      const b = shopEl('button', primary ? 'btn primary' : 'btn', label);
      b.type = 'button';
      b.onclick = async () => {
        actions.querySelectorAll('button').forEach(x => (x.disabled = true));
        try {
          await run();
        } catch (e) {
          $('import-review-error').textContent = e.message;
        } finally {
          actions.querySelectorAll('button').forEach(x => (x.disabled = false));
        }
      };
      return b;
    };
    const cancel = shopEl('button', 'btn', 'Cancel');
    cancel.type = 'button';
    cancel.onclick = () => dialog.close();
    const show = (kind, heading, facts, note, art, buttons) => {
      $('import-review-kind').textContent = kind;
      $('import-review-title').textContent = heading;
      $('import-review-facts').textContent = facts;
      $('import-review-note').textContent = note;
      if (art) picture.append(art);
      picture.hidden = !art;
      actions.replaceChildren(cancel, ...buttons);
      dialog.showModal();
    };
    try {
      if (raw?.format === 'slotforge.layout') {
        if (!small) throw Error('Track files must be smaller than 5 MB.');
        const prepared = I.prepare(raw),
          facts = DL.summarize({ layout: prepared }),
          art = prepared.pieces.length ? shopImage(I.picture(raw, { maxDimension: 600 }).svg) : null;
        return show(
          'TRACK',
          prepared.title,
          [garageKind(facts), garageNumbers(facts)].join(' · '),
          'Open it to keep working on it, or add it to your Track Library and leave the builder as it is.',
          art,
          [
            button('Add to library', false, async () => {
              const record = await DL.save(raw, prepared.title, true);
              dialog.close();
              say('“' + record.layout.title + '” added to your Track Library.');
              if (document.body.dataset.section === 'export') populateExportTracks();
            }),
            button('Open in builder', true, async () => {
              dialog.close();
              importTrack(raw);
              location.hash = 'builder';
            }),
          ]
        );
      }
      if (raw?.format === 'slotforge.custom-pack') {
        if (!small) throw Error('Track pack files must be smaller than 5 MB.');
        const count = raw.pieces?.length || 0;
        return show(
          'TRACK PACK',
          raw.name || 'Track pack',
          count + (count === 1 ? ' piece' : ' pieces'),
          'It joins My packs in Track Packs. Your track stays as it is.',
          shopIcon('<path d="M12 3 4 7v10l8 4 8-4V7z"/><path d="m4 7 8 4 8-4M12 11v10"/>'),
          [
            button('Add to My packs', true, async () => {
              // Import first: a pack that cannot be read keeps the window open with the reason.
              await importPack(raw);
              dialog.close();
            }),
          ]
        );
      }
      if (raw?.format === 'slotforge.workspace-transfer') {
        const tracks = raw.designs?.length || 0,
          packs = raw.customLibrary?.packs?.length || 0,
          made = new Date(raw.createdAt);
        return show(
          'WORKSPACE BACKUP',
          'Workspace backup',
          tracks +
            (tracks === 1 ? ' track · ' : ' tracks · ') +
            packs +
            (packs === 1 ? ' pack' : ' packs') +
            (Number.isNaN(made.getTime()) ? '' : ' · made ' + made.toLocaleDateString()),
          DS.disk
            ? 'Tracks and packs you don’t have yet are added. Nothing you already have is replaced.'
            : 'Adding a backup needs the desktop app’s disk storage.',
          shopIcon(
            '<rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/>'
          ),
          DS.disk && DS.mode !== 'unavailable'
            ? [
                button('Add to this workspace', true, async () => {
                  const result = await DS.importBundle(raw);
                  dialog.close();
                  say(
                    result.tracksAdded +
                      (result.tracksAdded === 1 ? ' track and ' : ' tracks and ') +
                      result.packsAdded +
                      (result.packsAdded === 1 ? ' pack added.' : ' packs added.') +
                      (result.packsAdded ? ' Restart Circuit to see the new packs.' : '')
                  );
                  if (document.body.dataset.section === 'export') populateExportTracks();
                }),
              ]
            : []
        );
      }
      throw Error('This is not a SlotForge track, track pack or workspace backup.');
    } catch (e) {
      say('Could not import ' + name + ': ' + e.message, true);
    }
  }
  async function exportSelectedTrack(format) {
    const choice = exportChoice,
      generation = exportSourceGeneration,
      isCurrent = () => choice === exportChoice && generation === exportSourceGeneration;
    let resolved = false;
    exportButtons(true);
    try {
      const model = await XM.resolveSource(choice, () => layout(), DL.get);
      if (!isCurrent()) return;
      showExportTrack(model);
      resolved = true;
      if (!model.pieces.length) throw Error('Add pieces to this track before exporting.');
      exportButtons(true);
      if (format === 'pdf') await savePdf(model.layout);
      else if (format === 'slotforge') downloadTrack(model.layout);
      else if (format === 'png') await exportPNG(model.layout);
      else if (format === 'csv') exportCSV(model.layout);
      else if (format === 'cad') cadUI.open(model.layout);
    } catch (e) {
      if (isCurrent()) {
        if (!resolved) exportTrackAvailable = false;
        $('export-source-error').textContent = e.message;
        say(e.message, true);
      }
    } finally {
      if (isCurrent()) exportButtons(false);
    }
  }

  function routeSection() {
    if (location.hash === '#custom') {
      wbView.pack = activePack().id;
      wbView.piece = '';
      window.history.replaceState(null, '', location.pathname + location.search + '#packs');
    }
    if (location.hash === '#plugins')
      window.history.replaceState(null, '', location.pathname + location.search + '#packs');
    const section = ['packs', 'export', 'library', 'settings', 'routed', 'freeform'].includes(location.hash.slice(1))
      ? location.hash.slice(1)
      : 'builder';
    finishDrag(true);
    stop();
    document.body.dataset.section = section;
    $('builder-view').hidden = section !== 'builder';
    document.querySelector('.projectbar').hidden = section !== 'builder';
    $('export-view').hidden = section !== 'export';
    $('packs-view').hidden = section !== 'packs';
    $('library-view').hidden = section !== 'library';
    $('settings-view').hidden = section !== 'settings';
    $('routed-view').hidden = section !== 'routed';
    $('freeform-view').hidden = section !== 'freeform';
    if (section !== 'packs') undockPieceForm();
    if (section === 'freeform' && freeformUI) freeformUI.enter();
    document.querySelectorAll('.sf-nav-link').forEach(a => {
      // Editing a custom pack happens inside Track Packs.
      if (a.dataset.section === section) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (section === 'settings') syncSettingsDashboard();
    if (section === 'library') renderDesignLibrary();
    else {
      ++libraryRender;
      clearTimeout(designSearchTimer);
    }
    if (section === 'packs') renderTrackPacks();
    if (section === 'export') {
      renderPackControls();
      populateExportTracks();
    }
    if (section === 'builder')
      requestAnimationFrame(() => {
        updateView();
        renderCanvas();
      });
  }
  document.querySelectorAll('.sf-header a').forEach(a => {
    a.onclick = e => {
      e.preventDefault();
      location.hash = a.dataset.section || 'builder';
    };
  });
  $('reference-dialog').addEventListener('cancel', () => referenceRequests.cancel());
  $('reference-dialog').addEventListener('close', () => {
    if (!$('reference-dialog').open) referenceRequests.cancel();
  });
  $('reference-place').onclick = () => placeReference();
  $('reference-snap').onchange = updateReferenceForm;
  $('reference-shape').onchange = updateReferenceForm;
  $('reference-resize').onclick = () => {
    const p = current();
    if (p && defOf(p).parameters.type === 'reference') openReference(defOf(p), p);
  };
  // Track Packs workbench: pick a pack, pick a piece; ＋ New piece edits in place.
  $('wb-packs').onclick = e => {
    const b = e.target.closest('[data-pack]');
    if (!b || b.dataset.pack === wbView.pack) return;
    wbView.pack = b.dataset.pack;
    wbView.piece = '';
    $('packs-search').value = '';
    renderWorkbench();
  };
  $('wb-bin').onclick = e => {
    const b = e.target.closest('[data-piece]');
    if (!b) return;
    wbView.piece = b.dataset.piece;
    // Picking a piece only moves the selection and redraws the stage; the bin's thumbnails stay.
    const p = wbPack(),
      d = p?.pieces.find(x => x.id === wbView.piece);
    if (wbEditing() || !p || !d) renderWorkbench();
    else {
      $('wb-bin')
        .querySelectorAll('[data-piece]')
        .forEach(x => x.setAttribute('aria-selected', String(x.dataset.piece === wbView.piece)));
      renderWbPiece(p, d);
      keepWbView();
    }
    $('wb-bin')
      .querySelector(`[data-piece="${CSS.escape(wbView.piece)}"]`)
      ?.focus({ preventScroll: true });
  };
  $('wb-bin').onkeydown = e => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const list = [...$('wb-bin').querySelectorAll('[data-piece]')],
      at = list.indexOf(document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    list[Math.max(0, Math.min(list.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))].click();
  };
  $('wb-new-piece').onclick = () => {
    const pack = activePack();
    if (pack.pieces.length && pack.pieces.every(d => d.parameters.routed)) routedUI.createInPack(pack);
    else openCustom();
  };
  $('wb-editor').addEventListener('click', e => {
    if (e.target.closest('[data-close="piece-dialog"]')) undockPieceForm();
  });
  $('wb-editor').addEventListener('keydown', e => {
    if (e.key === 'Escape') undockPieceForm();
  });
  $('shop-sources').onclick = e => {
    const b = e.target.closest('[data-choice]');
    if (!b || b.dataset.choice === exportChoice) return;
    exportChoice = b.dataset.choice;
    loadExportTrack();
  };
  $('shop-sources').onkeydown = e => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const list = [...$('shop-sources').querySelectorAll('[data-choice]')],
      at = list.indexOf(document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    const next = list[Math.max(0, Math.min(list.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
    next.focus();
    next.click();
  };
  $('shop-formats').onclick = e => {
    const b = e.target.closest('[data-format]');
    if (!b || shopKind() !== 'track' || b.dataset.format === shopView.format) return;
    shopView.format = b.dataset.format;
    keepShopView();
    renderShopTabs();
    renderShopOptions();
    renderShopStage();
    updateShopSave();
  };
  $('shop-save').onclick = () => {
    const f = shopFormat();
    if (f === 'pack') downloadPack(exportChoice.slice(5));
    else if (f === 'backup') saveBackup();
    else exportSelectedTrack(f);
  };
  $('shop-copy').onclick = copyPicture;
  $('export-import').onclick = () => $('shop-file').click();
  $('shop-drop').onclick = () => $('shop-file').click();
  $('shop-file').onchange = () => {
    const file = $('shop-file').files[0];
    $('shop-file').value = '';
    shopImportFile(file);
  };
  // Drop a SlotForge file anywhere in Circuit: it is reviewed before anything changes.
  {
    const overlay = $('shop-drop-overlay'),
      hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
    document.body.append(overlay);
    addEventListener('dragover', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      overlay.hidden = false;
    });
    addEventListener('dragleave', e => {
      if (!e.relatedTarget) overlay.hidden = true;
    });
    addEventListener('drop', e => {
      overlay.hidden = true;
      if (!hasFiles(e)) return;
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (!/\.(json|slotforge)$/i.test(file.name))
        return say('Drop a SlotForge file (.json or .slotforge): a track, a track pack or a workspace backup.', true);
      shopImportFile(file);
    });
  }
  $('set-timing-line').onclick = () => {
    const p = current();
    if (!p || !defOf(p).geometry.lanePaths.length) {
      say('Select one road piece in the builder first.', true);
      return;
    }
    editTiming(() => (integrationState.startFinish = { pieceId: p.id, fraction: 0.5 }));
  };
  $('timing-position').onchange = () => {
    const value = Number($('timing-position').value);
    if (!Number.isFinite(value) || value < 0 || value > 100) return;
    editTiming(() => (integrationState.startFinish.fraction = value / 100));
  };
  $('travel-direction').onchange = () =>
    editTiming(() => (integrationState.direction = Number($('travel-direction').value)));
  $('delete-pack-pieces-confirm').onclick = confirmDeletePackPieces;
  $('delete-pack-pieces-dialog').addEventListener('cancel', e => {
    if (deletePackBusy) e.preventDefault();
  });
  $('delete-pack-pieces-dialog').addEventListener('close', () => {
    if (!deletePackBusy) deletePackPieces = null;
  });
  $('new-pack-form').onsubmit = async e => {
    e.preventDefault();
    try {
      if (customLibrary.packs.length >= 100) throw Error('The custom library supports up to 100 packs.');
      const p = { id: 'custom-pack-' + F.uid(), name: CP.name($('new-pack-name').value), inLibrary: false, pieces: [] };
      customLibrary.packs.push(p);
      customLibrary.activePackId = p.id;
      const saving = persistCustom();
      $('new-pack-dialog').close();
      wbView.pack = p.id;
      wbView.piece = '';
      location.hash = 'packs';
      routeSection();
      if (await saving) say('Pack created. Add pieces, then save it to the library.');
    } catch (e) {
      say(e.message, true);
    }
  };
  $('packs-import').onclick = () => $('shop-file').click();
  $('packs-create').onclick = () => {
    $('new-pack-form').reset();
    $('new-pack-dialog').showModal();
  };
  $('packs-search').oninput = renderWorkbench;
  $('pack-export-choice').onchange = () =>
    updateExportNote('pack-export-choice', 'pack-export-note', 'pack-export-download');
  $('pack-export-download').onclick = () => downloadPack($('pack-export-choice').value);
  $('save-design').onclick = openDesignSave;
  $('library-save-current').onclick = openDesignSave;
  $('design-library-empty').onclick = e => {
    const action = e.target.closest('[data-empty]')?.dataset.empty;
    if (action === 'save') openDesignSave();
    else if (action === 'open') openTrackFile();
    else if (action === 'template') $('open-template').click();
  };
  let designSearchTimer;
  $('design-search').oninput = () => {
    garageShown = GARAGE_PAGE;
    clearTimeout(designSearchTimer);
    designSearchTimer = setTimeout(() => renderDesignLibrary(false), 150);
  };
  $('garage-sort').onchange = () => {
    garageView.sort = garageSorts[$('garage-sort').value] ? $('garage-sort').value : 'recent';
    keepGarageView();
    renderDesignLibrary(false);
  };
  $('garage-chips').onclick = e => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    garageView.filter = chip.dataset.filter;
    garageBinOpen = false;
    garageShown = GARAGE_PAGE;
    keepGarageView();
    renderDesignLibrary(false);
  };
  $('garage-more').onclick = () => {
    garageShown += GARAGE_PAGE;
    renderDesignLibrary(false);
  };
  $('garage-bin').onclick = () => {
    garageBinOpen = !garageBinOpen;
    renderDesignLibrary(false);
  };
  $('garage-empty-bin').onclick = () =>
    garageConfirm(
      'Empty the Bin?',
      'Every track in the Bin is deleted for good. This cannot be undone.',
      'Empty the Bin',
      async () => {
        await DL.purge(null);
        garageBinOpen = false;
        renderDesignLibrary();
      }
    );
  $('garage-continue').onclick = () => {
    location.hash = 'builder';
    routeSection();
  };
  $('garage-save-changes').onclick = garageSaveChanges;
  $('garage-save-as').onclick = openDesignSave;
  $('delete-design-dialog').addEventListener('close', () => (garagePending = null));
  $('garage-storage').onclick = () => $('storage-open').click();
  $('rename-design-form').onsubmit = async e => {
    e.preventDefault();
    const r = renameDesign,
      name = $('rename-design-name').value.trim();
    if (!r) return;
    if (name === r.title) return $('rename-design-dialog').close();
    $('rename-design-submit').disabled = true;
    try {
      const fresh = await DL.get(r.id),
        record = await DL.save(fresh.layout, name, false, fresh.revision);
      // The open copy follows its saved track's new name.
      if (librarySource?.id === record.id && librarySource.revision === fresh.revision) {
        librarySource = DL.source(record);
        if (record.layout.design.revision === layout(false).design.revision || title === r.title) {
          title = record.layout.title;
          $('track-name').value = title;
          refresh();
        }
      }
      $('rename-design-dialog').close();
      say('Renamed to “' + record.layout.title + '”.');
      renderDesignLibrary();
    } catch (error) {
      $('rename-design-error').textContent = error.message;
    } finally {
      $('rename-design-submit').disabled = false;
    }
  };
  $('save-design-form').onsubmit = saveDesign;
  $('save-design-dialog').addEventListener('cancel', e => {
    if (designSaveBusy) e.preventDefault();
  });
  $('design-copy').onchange = () => {
    $('design-save-submit').textContent = $('design-copy').checked ? 'Save as a new track' : 'Update saved track';
    syncSaveChoices();
  };
  $('design-save-choices').onclick = e => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    $('design-copy').checked = b.dataset.copy === 'true';
    $('design-copy').dispatchEvent(new Event('change'));
  };
  $('delete-design-confirm').onclick = async () => {
    const pending = garagePending;
    if (!deleteDesignId && !pending) return;
    const id = deleteDesignId;
    $('delete-design-confirm').disabled = true;
    try {
      if (pending) {
        await pending();
        garagePending = null;
        $('delete-design-dialog').close();
        return;
      }
      const title = $('delete-design-name').textContent;
      await DL.remove(id, deleteDesignRevision);
      deleteDesignId = null;
      $('delete-design-dialog').close();
      renderDesignLibrary();
      say(DL.hasBin() ? '“' + title + '” moved to the Bin.' : 'Saved track deleted.');
    } catch (e) {
      say(e.message, true);
    } finally {
      $('delete-design-confirm').disabled = false;
    }
  };
  window.addEventListener('hashchange', routeSection);
  window.addEventListener('beforeunload', e => {
    // A change still waiting for its save: start it now (browser storage saves at once).
    if (saveTimer) persistNow();
    if (DS.unsaved || !storageAvailable || browserPackUnsaved) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  routeSection();

  function storageDetails() {
    $('storage-mode').textContent =
      DS.mode === 'disk'
        ? 'Disk storage is active. Layouts, autosave and custom packs are stored outside the browser.'
        : DS.error || 'Browser storage is active. Use an installed local launcher for automatic disk saving.';
    $('storage-directory').textContent = DS.directory || 'No disk workspace connected';
    $('storage-previous').hidden = !DS.disk;
    $('storage-previous').disabled = DS.mode === 'unavailable';
    $('storage-copy-browser').hidden = !DS.disk;
    $('storage-stop').hidden = !DS.disk;
    $('storage-import').disabled = !DS.disk || DS.mode === 'unavailable';
    $('storage-copy-browser').disabled = DS.mode === 'unavailable';
    $('storage-error').textContent = '';
    $('storage-dialog').showModal();
  }
  $('storage-open').textContent =
    DS.mode === 'disk' ? 'Storage: disk' : DS.disk ? 'Storage: unavailable' : 'Storage: browser';
  // The Pit Wall's storage light reads this: disk, browser or unavailable.
  $('storage-open').dataset.storage = DS.mode === 'disk' ? 'disk' : DS.disk ? 'unavailable' : 'browser';
  $('storage-open').onclick = storageDetails;
  if (DS.mode === 'disk')
    $('library-storage-note').textContent = 'Saved on this computer, apart from browser data. Updates keep it.';
  async function browserBundle() {
    const raw = localStorage.getItem(STORAGE),
      saved = localStorage.getItem(CP.STORAGE),
      legacy = localStorage.getItem(CUSTOM);
    return {
      format: 'slotforge.workspace-transfer',
      version: 1,
      createdAt: new Date().toISOString(),
      current: raw ? JSON.parse(raw) : null,
      customLibrary: CP.serialize(CP.read(saved ? JSON.parse(saved) : legacy ? JSON.parse(legacy) : null)),
      designs: (await DL.browserList()).map(r => r.layout),
    };
  }
  $('storage-previous').onclick = async () => {
    try {
      await DS.flush();
      download('SlotForge-previous-save.json', JSON.stringify(await DS.previousBundle()));
      $('storage-error').textContent =
        'Previous save downloaded. Import it to recover missing tracks as library copies; your current drawing is kept.';
    } catch (e) {
      $('storage-error').textContent = e.message;
    }
  };
  $('storage-export').onclick = () => saveBackup($('storage-error'));
  async function importWorkspace(value) {
    $('storage-error').textContent = '';
    const controls = [...$('storage-dialog').querySelectorAll('button')];
    controls.forEach(b => (b.disabled = true));
    try {
      const result = await DS.importBundle(value);
      $('storage-error').textContent =
        result.tracksAdded +
        ' tracks and ' +
        result.packsAdded +
        ' packs imported. Existing tracks were kept. Reload to see the imported library and packs.';
      $('storage-reload').hidden = false;
    } catch (e) {
      $('storage-error').textContent = e.message;
    } finally {
      controls.forEach(b => (b.disabled = false));
    }
  }
  $('storage-import').onclick = () => $('workspace-file').click();
  $('workspace-file').onchange = async () => {
    const file = $('workspace-file').files[0];
    $('workspace-file').value = '';
    if (!file) return;
    try {
      if (file.size > 256 * 1024 * 1024) throw Error('Workspace transfer files support up to 256 MiB.');
      await importWorkspace(JSON.parse(await file.text()));
    } catch (e) {
      $('storage-error').textContent = e.message;
    }
  };
  $('storage-copy-browser').onclick = async () => {
    try {
      await importWorkspace(await browserBundle());
    } catch (e) {
      $('storage-error').textContent = e.message;
    }
  };
  $('storage-reload').onclick = () => location.reload();
  $('storage-stop').onclick = async () => {
    try {
      await DS.quit();
      $('storage-error').textContent = 'Local app stopped. You can close this tab. Use the launcher to start it again.';
      $('storage-open').textContent = 'Storage: stopped';
      $('storage-open').dataset.storage = 'stopped';
    } catch (e) {
      $('storage-error').textContent = e.message;
    }
  };
  function syncRoutedPack() {
    Object.assign(routedPack, F.Routed.pack(routedState.settings));
    populatePacks();
    catalogue();
  }
  if (items.length && items.every(p => defOf(p).parameters.routed)) {
    $('pack').value = F.Routed.ID;
    catalogue();
  }
  routedUI = window.RoutedEditor.init({
    get: () => ({
      items,
      defs,
      routed: routedState,
      spaceGuide,
      selected,
      selectedIds,
      network,
      interacting: !!drag,
      packId: $('pack').value,
    }),
    focus: focusIssue,
    message: say,
    choosePack: (id = F.Routed.ID) => {
      $('pack').value = id;
      $('search').value = '';
      catalogue();
    },
    packs: () => customLibrary.packs,
    saveDefinition: saveRoutedDefinition,
    showSavedPack: id => {
      customLibrary.activePackId = id;
      persistCustom();
      $('pack').value = id;
      catalogue();
      wbView.pack = id;
      wbView.piece = '';
      location.hash = 'packs';
      routeSection();
    },
    table: () => {
      openSpaceGuide();
      $('guide-kind').value = 'table';
    },
    add: (d, flip) => {
      if (items.length >= 500) return false;
      defs[d.id] = d;
      return add(d, flip);
    },
    commit: next => {
      const ni = next.items || items,
        nd = next.definitions || defs,
        nr = F.Routed.workspace(next.routed || routedState);
      assertLockedUnchanged(ni, nd);
      F.validateLayout({
        format: 'slotforge.layout',
        version: 1,
        title,
        pieces: ni,
        definitions: [...new Set(ni.map(p => p.definitionId))].map(id => nd[id]),
        profile,
        workspace: { routed: nr, ...(spaceGuide ? { spaceGuide } : {}) },
      });
      checkpoint();
      stop();
      Object.assign(defs, nd);
      items = ni;
      if (next.selectId) setSelection([next.selectId]);
      routedState = nr;
      syncRoutedPack();
      routedUI.fill();
      refresh();
    },
    newLayout: exampleTrack => {
      const config = structuredClone(routedState);
      confirmReplace(() => {
        checkpoint();
        stop();
        librarySource = null;
        integrationState = I.newState();
        routedState = config;
        planning = F.Planning.validate();
        power = F.Power.empty();
        items = [];
        setSelection([]);
        syncRoutedPack();
        if (exampleTrack) {
          const straight = F.validateDefinition(
              F.Routed.definition(
                config.settings,
                exampleTrack === 'flowing'
                  ? { type: 'routed-spline', controlPointsMm: F.Routed.Spline.preset('s-bend', config.settings) }
                  : { type: 'straight', lengthMm: 1000 },
                'routed:' + F.uid()
              )
            ),
            corner = F.validateDefinition(
              F.Routed.definition(
                config.settings,
                { type: 'curve', slotRadiusMm: Math.max(300, config.settings.innerClearanceMm + 50), angleDeg: 90 },
                'routed:' + F.uid()
              )
            );
          defs[straight.id] = straight;
          defs[corner.id] = corner;
          let last;
          for (const d of [straight, corner, corner, straight, corner, corner]) {
            let p = F.pose(d);
            if (last) p = F.join(p, d, 0, F.ports(last, defs)[1]);
            items.push(p);
            last = p;
          }
        }
        const b = F.bounds(items, defs),
          lengthMm = exampleTrack ? Math.ceil(b[2] + 400 - 1e-6) : 3000,
          widthMm = exampleTrack ? Math.ceil(b[3] + 400 - 1e-6) : 1600;
        spaceGuide = { x: 0, y: 0, lengthMm, widthMm, kind: 'table', locked: true };
        if (exampleTrack) items = items.map(p => ({ ...p, x: p.x + 200 - b[0], y: p.y + 200 - b[1] }));
        title =
          exampleTrack === 'flowing'
            ? 'Flowing routed example'
            : exampleTrack
              ? 'Routed wood example'
              : 'My routed track';
        $('track-name').value = title;
        $('pack').value = F.Routed.ID;
        catalogue();
        routedUI.fill();
        refresh();
        location.hash = 'builder';
        routeSection();
        fit();
        say(
          exampleTrack
            ? 'Routed example loaded. Select a section to edit its dimensions.'
            : 'Routed layout ready. Add a section from the catalogue or create your own.'
        );
      });
    },
  });

  freeformUI = window.FreeFormEditor.init({
    get: () => ({
      items,
      defs,
      planning,
      car: previewCar,
      table: spaceGuide,
      settings: routedState.settings,
      title,
      state: integrationState,
    }),
    message: say,
    start: fn => confirmReplace(fn),
    reference: access => designToolsUI.referenceFor(access),
    apply: (model, settings, table, name, source, mark, offset = [0, 0], newPlanning = planning) => {
      if (source?.locked) throw Error('Unlock this circuit before applying edits.');
      const d = F.validateDefinition(F.FreeForm.definition(model, settings, 'freeform:' + F.uid(), name)),
        p = source
          ? { ...source, definitionId: d.id, x: offset[0], y: offset[1], angle: 0, flip: false }
          : { ...F.pose(d), x: offset[0], y: offset[1] };
      checkpoint();
      stop();
      if (!source) {
        librarySource = null;
        integrationState = I.newState();
      }
      defs[d.id] = d;
      items = [p];
      planning = F.Planning.validate(newPlanning);
      power = F.Power.empty();
      spaceGuide = F.validateSpaceGuide(table);
      routedState = F.Routed.workspace({ settings: d.parameters.routed });
      title = name;
      $('track-name').value = title;
      setSelection([p.id]);
      if (mark) {
        const fraction = F.FreeForm.fraction(d, mark);
        integrationState.startFinish = fraction === null ? null : { pieceId: p.id, fraction };
      } else if (source && integrationState.startFinish) integrationState.startFinish = null;
      syncRoutedPack();
      $('pack').value = F.Routed.ID;
      catalogue();
      refresh();
      location.hash = 'builder';
      routeSection();
      fit();
      say(
        d.geometry.closed
          ? 'FreeForm circuit saved to the builder. Save to Track Library to keep a named design.'
          : 'FreeForm draft saved to the builder. Open Edit FreeForm to continue.'
      );
    },
  });
  if (location.hash === '#freeform') freeformUI.enter();
  elevationUI = window.ElevationEditor.init({
    get: () => ({ pieces: items, defs, selected: selectedIds }),
    focus: focusIssue,
    apply: e => {
      if (!selection().length || selectionLocked()) return;
      finishDrag(true);
      checkpoint();
      stop();
      items = items.map(p => {
        if (!selectedIds.has(p.id) || defOf(p).parameters.type === 'freeform') return p;
        const next = { ...p };
        if (e) next.elevation = { ...e };
        else delete next.elevation;
        return next;
      });
      refresh();
      say('Track heights updated. Check adjoining heights and bridge clearance.');
    },
  });

  function convertRoutedToFreeform() {
    const token = toolsToken(),
      converted = window.FreeFormTools.convert(items, defs),
      dialog = document.createElement('dialog');
    dialog.className = 'design-tool-dialog';
    const title = document.createElement('h2');
    title.textContent = 'Convert routed sections to FreeForm';
    const note = document.createElement('p');
    note.textContent =
      converted.model.nodes.length +
      ' editable anchors. Sampled fit deviation up to ' +
      converted.maxErrorMm.toFixed(3) +
      ' mm. Circular slots become cubic approximations. This replaces the sections with one tabletop drawing; Undo restores them. Set the timing line again after conversion.';
    const picture = document.createElementNS(NS, 'svg'),
      b = converted.definition.geometry.boundsMm;
    picture.classList.add('tool-preview');
    picture.setAttribute('viewBox', [b[0] - 50, b[1] - 50, b[2] + 100, b[3] + 100].join(' '));
    picture.innerHTML = F.FreeForm.draw(converted.definition);
    const checks = document.createElement('p');
    checks.textContent = converted.definition.geometry.issues.map(i => i.message).join(' ');
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    cancel.onclick = () => dialog.close();
    const apply = document.createElement('button');
    apply.className = 'btn primary';
    apply.textContent = 'Convert & edit FreeForm';
    apply.disabled = !converted.definition.geometry.valid;
    apply.onclick = () => {
      try {
        if (toolsToken() !== token) throw Error('The layout changed. Preview again.');
        checkpoint();
        stop();
        const d = F.validateDefinition({ ...converted.definition, id: 'freeform:' + F.uid(), name: titleText() });
        defs[d.id] = d;
        items = [F.pose(d)];
        integrationState.startFinish = null;
        integrationState.requiresLaneRemap = true;
        routedState = F.Routed.workspace({ settings: converted.profile });
        syncRoutedPack();
        setSelection([items[0].id]);
        refresh();
        dialog.close();
        freeformUI.open();
      } catch (e) {
        checks.textContent = e.message;
      }
    };
    function titleText() {
      return $('track-name').value || 'Converted circuit';
    }
    dialog.append(title, note, picture, checks, cancel, apply);
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  function toolsToken() {
    return I.canonical([integrationState.designId, items, items.map(p => defOf(p).parameters)]);
  }
  function assertLockedUnchanged(next, nextDefs = defs) {
    for (const p of items.filter(p => p.locked)) {
      const q = next.find(q => q.id === p.id);
      if (
        !q ||
        I.canonical(p) !== I.canonical(q) ||
        I.canonical(defOf(p).parameters) !== I.canonical(nextDefs[q.definitionId]?.parameters)
      )
        throw Error('A locked piece would change. Unlock it first.');
    }
  }
  function focusIssue(issue) {
    const chosen = items.filter(p => (issue.pieceIds || []).includes(p.id));
    if (chosen.length) setSelection(chosen.map(p => p.id));
    const b = chosen.length ? F.bounds(chosen, defs) : null;
    if (issue.point) {
      view.w = 800;
      view.x = issue.point[0] - 400;
      view.y = issue.point[1] - 300;
    } else if (b) {
      view.w = Math.max(500, b[2] + 200);
      view.x = b[0] - 100;
      view.y = b[1] - 100;
    }
    updateView();
    renderCanvas();
    updateInspector();
  }
  function markPower(id, role) {
    checkpoint();
    power = F.Power.mark(power, id, role);
    refresh();
    say(role === 'base' ? 'Power base set.' : role === 'tap' ? 'Power tap added.' : 'Power mark removed.');
  }
  async function savePowerPdf() {
    const raw = layout(),
      result = await makePdf(raw, 'portrait');
    download(XM.filename(result.title) + '.pdf', result.bytes, 'application/pdf');
    say('PDF saved with the power test sheet: ' + result.title);
  }
  powerUI = window.PowerUI.init({
    power: () => power,
    analysis: () => powerCheck || F.Power.analyse(network, items, defs, power),
    selected: () => (selectedIds.size === 1 ? current()?.id || null : null),
    // Readings (quiet) don't change the check: save them and redraw only the panel.
    update: (next, message, quiet = false) => {
      checkpoint();
      power = F.Power.settings(next);
      if (quiet) {
        persist();
        setTimeout(() => powerUI.render());
      } else refresh();
      if (message) say(message);
    },
    focus: ids => focusIssue({ pieceIds: ids }),
    print: () => savePowerPdf().catch(e => say(e.message)),
  });
  // The saved track was restored before this panel existed: show its power marks now.
  powerUI.render();
  renderPower();
  designToolsUI = window.DesignToolsUI.init({
    // get(true) is for drawing only: it skips the change token, which hashes the whole design.
    get: (drawing = false) => ({
      items,
      defs,
      selected: [...selectedIds],
      planning,
      table: spaceGuide,
      car: previewCar,
      packs: allPacks(),
      ...(drawing ? {} : { token: toolsToken() }),
    }),
    world,
    focus: focusIssue,
    message: say,
    render: renderCanvas,
    download,
    convert: () => convertRoutedToFreeform(),
    commit: (next, token) => {
      if (token && token !== toolsToken()) throw Error('The layout changed. Reopen this tool and preview again.');
      const ni = next.items || items,
        nd = next.definitions || defs;
      if (!next.allowLocks) assertLockedUnchanged(ni, nd);
      const checked = F.validateLayout({
        format: 'slotforge.layout',
        version: 1,
        title,
        pieces: ni,
        definitions: [...new Set(ni.map(p => p.definitionId))].map(id => nd[id]),
        workspace: { planning: next.planning || planning },
      });
      checkpoint();
      stop();
      items = checked.pieces;
      Object.assign(defs, checked.definitions);
      planning = checked.workspace.planning;
      refresh();
    },
  });
  designToolsUI.render();

  cadUI = window.CADExportUI.init({ message: say, download });
  if (DS.error) say(DS.error + ' Existing files were retained.', true);
  else if (DS.disk && (localStorage.getItem(STORAGE) || localStorage.getItem(CP.STORAGE)))
    say('Previous browser saves are available. Open Storage to copy them to disk.');
  else if (!DS.disk)
    say('Browser mode. Use the installed launcher for disk saving. Storage can export your existing work.');

  // Help: welcome screen (first start only) and keyboard shortcuts.
  const welcomeChoices = {
    packs: () => (location.hash = 'packs'),
    routed: () => (location.hash = 'routed'),
    freeform: () => (location.hash = 'freeform'),
    builder: () => {
      location.hash = 'builder';
      if (!items.length) example();
    },
  };
  Menus.attach($('help-button'), $('help-menu'));
  $('help-shortcuts').onclick = () => CircuitHelp.shortcuts();
  $('help-welcome').onclick = () => CircuitHelp.welcome(welcomeChoices);
  CircuitHelp.condense();
  Units.start();
  // ---------------------------------------------------------------- Settings: the dashboard
  // One screen of cards, each showing its current state with quick controls: Look, Units, Your
  // saved work, Updates, Building, Shortcuts and About. The theme presets, the colour editor and
  // the update card are the existing parts, moved into their cards.
  const LAST_BACKUP = 'slotforge.last-backup.v1';
  const sdEl = (tag, className, text) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  };
  const SD_ICONS = {
    look: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z"/>',
    units: '<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>',
    work: '<rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/><path d="M8 7h.01M8 17h.01"/>',
    updates: '<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/>',
    building: '<path d="M4 7h16M4 12h10M4 17h7"/>',
    keys: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8"/>',
    about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  };
  function sdCard(key, title, { wide = false, link = null } = {}) {
    const card = sdEl('section', 'sd-card' + (wide ? ' sd-wide' : ''));
    card.id = 'sd-' + key;
    const head = sdEl('div', 'sd-top'),
      h = sdEl('h2', '', title);
    h.id = 'sd-' + key + '-title';
    card.setAttribute('aria-labelledby', h.id);
    head.innerHTML = `<svg class="sd-icon" viewBox="0 0 24 24" aria-hidden="true">${SD_ICONS[key]}</svg>`;
    head.append(h);
    if (link) {
      const a = sdEl('button', 'sd-link', link.text);
      a.type = 'button';
      a.onclick = link.run;
      if (link.id) a.id = link.id;
      head.append(a);
    }
    card.append(head);
    return card;
  }
  function sdSwitch(id, label, on, change) {
    const row = sdEl('label', 'sd-toggle'),
      box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'ss-switch';
    box.id = id;
    box.checked = on;
    box.onchange = () => change(box.checked);
    row.append(sdEl('span', '', label), box);
    return row;
  }
  function sdSeg(label, options, value, change) {
    const row = sdEl('div', 'sd-toggle'),
      bar = sdEl('div', 'pack-hub-filters');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', label);
    for (const [v, text] of options) {
      const b = sdEl('button', 'btn sm', text);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(v === value));
      b.onclick = () => {
        bar.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        change(v);
      };
      bar.append(b);
    }
    row.append(sdEl('span', '', label), bar);
    return row;
  }
  function sdWelcomeSeen() {
    try {
      return localStorage.getItem('slotforge.welcome.v1') === 'seen';
    } catch {
      return false;
    }
  }
  // Coming back to Settings: the switches follow changes made in the builder or FreeForm.
  function syncSettingsDashboard() {
    if (!$('sd-work')) return;
    $('sd-piece-colours').checked = colourByPiece;
    $('sd-ff-snap').checked = $('ff-snap')?.getAttribute('aria-pressed') === 'true';
    $('sd-welcome').checked = !sdWelcomeSeen();
    $('sd-building')
      .querySelectorAll('[aria-label="Rotate step"] button')
      .forEach(b => b.setAttribute('aria-pressed', String(parseFloat(b.textContent) === rotateStep)));
    renderSdWork();
  }
  function sdWhen(iso) {
    if (!iso) return 'never';
    const t = new Date(iso).getTime();
    return Number.isFinite(t) ? garageAgo(iso).toLowerCase() : 'never';
  }
  async function renderSdWork() {
    const card = $('sd-work');
    if (!card) return;
    let tracks = 0,
      binned = 0;
    try {
      tracks = (await DL.summaries()).length;
      binned = DL.hasBin() ? (await DL.bin()).length : 0;
    } catch {}
    const own = customLibrary.packs.length,
      pieces = customLibrary.packs.reduce((n, p) => n + p.pieces.length, 0);
    let last = null;
    try {
      last = localStorage.getItem(LAST_BACKUP);
    } catch {}
    const big = $('sd-work-big');
    big.replaceChildren();
    for (const [n, word] of [
      [tracks, tracks === 1 ? 'track' : 'tracks'],
      [own, own === 1 ? 'pack' : 'packs'],
      [pieces, pieces === 1 ? 'own piece' : 'own pieces'],
    ]) {
      const part = sdEl('span', 'sd-stat');
      part.append(sdEl('b', '', String(n)), sdEl('span', '', word));
      big.append(part);
    }
    $('sd-work-facts').textContent =
      (DS.mode === 'disk' ? 'Saved on this computer' : DS.disk ? 'Disk storage unavailable' : 'Saved in this browser') +
      (binned ? ' · ' + binned + ' in the Bin' : '') +
      ' · last backup ' +
      sdWhen(last);
    $('sd-work-path').textContent = DS.directory || '';
    $('sd-work-path').hidden = !DS.directory;
  }
  function buildSettingsDashboard() {
    const host = $('settings-dashboard');
    // Look: the theme presets, and the colour editor behind "Your own colours".
    const look = sdCard('look', 'Look', {
      wide: true,
      link: {
        text: 'Your own colours',
        id: 'sd-colours-toggle',
        run: () => {
          const open = $('sd-colours').hidden;
          $('sd-colours').hidden = !open;
          $('sd-colours-toggle').setAttribute('aria-expanded', String(open));
          if (open) $('sd-colours').scrollIntoView({ block: 'nearest' });
        },
      },
    });
    look.append($('theme-presets'));
    look.append(
      sdSwitch('sd-piece-colours', 'Colour pieces by type in the builder', colourByPiece, on => {
        if (on !== colourByPiece) $('piece-colours').click();
      })
    );
    // Units: two tiles with the same lengths written both ways.
    const units = sdCard('units', 'Units'),
      choice = sdEl('div', 'units-choice sd-units');
    choice.setAttribute('role', 'radiogroup');
    choice.setAttribute('aria-label', 'Measurement units');
    choice.dataset.units = 'raw';
    for (const [value, name, example] of [
      ['metric', 'Metric', '345 mm · 5.2 m'],
      ['imperial', 'Imperial', Units.inches(345) + ' · ' + Math.round(5200 / 304.8) + ' ft'],
    ]) {
      const tile = sdEl('label', 'sd-unit'),
        radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'units';
      radio.value = value;
      radio.checked = Units.system() === value;
      radio.onchange = () => {
        Units.setSystem(value);
        location.reload();
      };
      tile.append(radio, sdEl('b', '', name), sdEl('span', '', example));
      choice.append(tile);
    }
    units.append(
      choice,
      sdEl('p', 'sd-note', 'Pieces stay defined in millimetres. Imperial shows inches beside the mm fields.')
    );
    // Your saved work: what is kept, where, and the backup.
    const work = sdCard('work', 'Your saved work', {
        link: { text: 'More…', id: 'sd-storage-more', run: () => $('storage-open').click() },
      }),
      big = sdEl('div', 'sd-stats'),
      facts = sdEl('p', 'sd-facts'),
      where = sdEl('p', 'sd-path'),
      actions = sdEl('div', 'sd-actions');
    big.id = 'sd-work-big';
    facts.id = 'sd-work-facts';
    where.id = 'sd-work-path';
    const backup = sdEl('button', 'btn sm', 'Save backup…'),
      copy = sdEl('button', 'btn sm quiet', 'Copy folder path');
    backup.type = copy.type = 'button';
    backup.id = 'sd-backup';
    backup.onclick = () => saveBackup();
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(DS.directory);
        say('Folder path copied.');
      } catch (e) {
        say('Could not copy the folder path: ' + e.message, true);
      }
    };
    copy.hidden = !DS.directory;
    actions.append(backup, copy);
    work.append(big, facts, where, actions);
    // Updates: the existing update card, moved in.
    const updates = sdCard('updates', 'Updates'),
      updateHost = sdEl('div', 'sd-update-host');
    updates.append(updateHost);
    // Building: preferences that were remembered silently elsewhere.
    const building = sdCard('building', 'Building'),
      steps = [7.5, 15, 22.5, 45];
    building.append(
      sdSeg(
        'Rotate step',
        (steps.includes(rotateStep) ? steps : [...steps, rotateStep].sort((a, b) => a - b)).map(v => [v, v + '°']),
        rotateStep,
        v => {
          $('rotate-step').value = String(v);
          $('rotate-step').dispatchEvent(new Event('change'));
        }
      ),
      sdSwitch('sd-ff-snap', 'FreeForm snaps to 10 mm', $('ff-snap')?.getAttribute('aria-pressed') === 'true', on => {
        if ($('ff-snap') && ($('ff-snap').getAttribute('aria-pressed') === 'true') !== on) $('ff-snap').click();
      }),
      sdSwitch('sd-welcome', 'Welcome window at start', !sdWelcomeSeen(), on => {
        try {
          if (on) localStorage.removeItem('slotforge.welcome.v1');
          else localStorage.setItem('slotforge.welcome.v1', 'seen');
        } catch {}
      })
    );
    // Shortcuts: the ones people use most, and the full list.
    const keys = sdCard('keys', 'Shortcuts', { link: { text: 'All shortcuts', run: () => CircuitHelp.shortcuts() } }),
      list = sdEl('dl', 'sd-keys'),
      builder = CircuitHelp.SHORTCUTS.find(g => g.title === 'Track Builder') || CircuitHelp.SHORTCUTS[0];
    for (const [label, ...combos] of builder.rows.slice(0, 5)) {
      const dt = sdEl('dt');
      for (const k of combos[0]) dt.append(sdEl('kbd', '', k));
      list.append(dt, sdEl('dd', '', label));
    }
    keys.append(list);
    // About.
    const about = sdCard('about', 'About Circuit', { wide: true }),
      line = sdEl(
        'p',
        'sd-facts',
        'SlotForge Circuit ' +
          I.VERSION +
          (window.slotforgeDesktop ? ' · desktop app' : ' · in the browser') +
          (DS.directory ? ' · data in ' + DS.directory : '')
      ),
      links = sdEl('div', 'sd-actions');
    line.dataset.units = 'raw';
    const welcome = sdEl('button', 'btn sm', 'Welcome screen'),
      notices = sdEl('button', 'btn sm quiet', 'Third-party notices');
    welcome.type = notices.type = 'button';
    welcome.onclick = () => CircuitHelp.welcome(welcomeChoices);
    notices.onclick = () => window.open('../THIRD-PARTY-NOTICES.txt', '_blank');
    links.append(welcome, notices);
    about.append(line, links);
    // The colour editor opens as a full-width card under Look.
    const colours = sdEl('section', 'sd-card sd-full');
    colours.id = 'sd-colours';
    colours.hidden = true;
    colours.setAttribute('aria-label', 'Your own colours');
    colours.append(document.querySelector('#app-theme-settings .theme-custom-card'), $('theme-save-status'));
    host.replaceChildren(look, units, colours, work, updates, building, keys, about);
    $('app-theme-settings').hidden = true;
    UpdateUI.start({ settings: updateHost, say });
    if (!updateHost.children.length)
      updateHost.append(sdEl('p', 'sd-note', 'Update checks are part of the desktop app.'));
    else
      updates.append(
        sdEl('p', 'sd-note', 'Only the newest version number is asked for; nothing about you or your work is sent.')
      );
    // The track counts are filled when Settings opens (syncSettingsDashboard), not at start-up.
  }
  buildSettingsDashboard();
  // One dialog family (dialog-family.js): the same head, body and foot in every window.
  DialogFamily.watch();
  // Routed Wood: the joinery bench (routed-bench.js) groups the profile and draws the board.
  RoutedBench.mount();
  // The Tools menu, the inspector's side rail and the sidebar buttons (builder-layout.js).
  BuilderLayout.mount();
  CircuitHelp.maybeWelcome(welcomeChoices);
})();
