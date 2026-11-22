// Display units. Circuit stores and calculates everything in millimetres.
// With Imperial chosen, measurements shown on screen and in the PDF report are
// converted to inches and feet as they are displayed; number fields stay in mm
// (the unit track pieces are defined in) and show a live inch equivalent.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Units = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'slotforge.units.v1';
  const MM_PER_IN = 25.4;

  function system() {
    try {
      return localStorage.getItem(KEY) === 'imperial' ? 'imperial' : 'metric';
    } catch {
      return 'metric';
    }
  }
  function setSystem(value) {
    try {
      localStorage.setItem(KEY, value === 'imperial' ? 'imperial' : 'metric');
    } catch {}
  }

  const trim = n => String(Number(n.toFixed(3)));
  // 11.8 in below a metre; 7 ft 4 in from a metre up; small sizes keep more decimals.
  function inches(mm) {
    const sign = mm < 0 ? '-' : '',
      a = Math.abs(mm);
    if (a >= 1000) {
      // One decimal of an inch keeps small lane-length differences visible.
      let ft = Math.floor(a / 304.8),
        inch = Math.round(((a - ft * 304.8) / MM_PER_IN) * 10) / 10;
      if (inch >= 12) {
        ft++;
        inch = 0;
      }
      return `${sign}${ft} ft${inch ? ' ' + String(inch) + ' in' : ''}`;
    }
    const value = a / MM_PER_IN;
    return `${sign}${value < 1 ? value.toFixed(3) : value < 10 ? value.toFixed(2) : value.toFixed(1)} in`;
  }
  const num = s => Number(String(s).replace(/,/g, ''));

  // Converts metric measurements inside a piece of text. Returns the text unchanged when none are found.
  // A list of numbers sharing one "mm": 2235 × 1200 mm, 100 → 80 → 100 mm, 300–400 mm.
  const N = String.raw`-?\d[\d,]*(?:\.\d+)?`,
    LIST = new RegExp(String.raw`(${N}(?:\s*(?:×|x|→|–|to)\s*${N})+)\s?mm\b(?![²³])`, 'g'),
    SPEED = /(-?\d+(?:\.\d+)?)\s?m\/s(²?)/g,
    MM = /(-?\d[\d,]*(?:\.\d+)?)\s?mm\b(?![²³])/g,
    M = /(-?\d+(?:\.\d+)?)\s?m\b(?![²³/\w])/g;
  function convertText(text) {
    if (typeof text !== 'string' || !/\d\s?m/.test(text)) return text;
    return text
      .replace(LIST, (_, list) => list.replace(new RegExp(N, 'g'), v => inches(num(v))))
      .replace(SPEED, (_, v, sq) => `${(num(v) * 3.28084).toFixed(1)} ft/s${sq}`)
      .replace(MM, (_, v) => inches(num(v)))
      .replace(M, (_, v) => inches(num(v) * 1000));
  }
  function format(mm) {
    return system() === 'imperial' ? inches(mm) : `${trim(mm)} mm`;
  }

  // ---------------------------------------------------------------- page conversion
  const SKIP = 'script, style, textarea, input, select, kbd, code, [data-units="raw"]';
  function convertNode(node) {
    if (node.nodeType === 3) {
      const parent = node.parentElement;
      if (!parent || parent.closest(SKIP)) return;
      const next = convertText(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
      return;
    }
    if (node.nodeType !== 1 || node.closest?.(SKIP)) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(convertNode);
    if (node.matches?.('input[type="number"]')) hint(node);
    node.querySelectorAll?.('input[type="number"]').forEach(hint);
  }

  // Number fields measured in millimetres get a live "≈ 11.8 in" next to them.
  function measuredInMm(input) {
    const label = input.closest('label')?.textContent || input.getAttribute('aria-label') || input.name || '';
    return /\bmm\b/.test(label) && !/mm²|%/.test(label);
  }
  function hint(input) {
    if (input.dataset.unitHint || !measuredInMm(input)) return;
    input.dataset.unitHint = 'true';
    const out = document.createElement('span');
    out.className = 'unit-hint';
    out.dataset.units = 'raw';
    out.setAttribute('aria-live', 'off');
    const update = () => {
      const v = input.value === '' ? NaN : Number(input.value);
      out.textContent = Number.isFinite(v) ? '≈ ' + inches(v) : '';
    };
    input.addEventListener('input', update);
    input.addEventListener('change', update);
    // Values set from code do not fire events; refresh when the field is shown or focused.
    input.addEventListener('focus', update);
    input.after(out);
    update();
    hints.push([input, update]);
  }
  const hints = [];

  function start() {
    if (system() !== 'imperial' || typeof document === 'undefined') return;
    document.documentElement.dataset.units = 'imperial';
    convertNode(document.body);
    new MutationObserver(records => {
      for (const r of records) {
        if (r.type === 'characterData') convertNode(r.target);
        else r.addedNodes.forEach(convertNode);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
    // Keep field hints in step with values the app fills in.
    setInterval(() => hints.forEach(([input, update]) => input.isConnected && update()), 800);
  }

  // Settings card: Metric / Imperial. Changing it reloads so every view is redrawn in the new units.
  function settingsCard() {
    const card = document.createElement('section');
    card.className = 'units-card ss-section';
    card.setAttribute('aria-labelledby', 'units-title');
    card.innerHTML = `<h2 id="units-title">Measurement units</h2>
      <div class="ss-sheet"><div class="ss-row">
        <div class="ss-t"><b>Units</b><span class="ss-desc">Lengths, footprints, speeds and the PDF report: metric (mm and m) or imperial (inches and feet).</span></div>
        <div class="ss-ctl"><div class="units-choice ss-seg" role="radiogroup" aria-label="Measurement units">
          <label><input type="radio" name="units" value="metric"> Metric</label><label><input type="radio" name="units" value="imperial"> Imperial</label>
        </div></div>
      </div></div>
      <p class="ss-note">Track pieces are defined in millimetres. With Imperial, number fields stay in mm and show the inch equivalent beside them.</p>`;
    card.dataset.units = 'raw';
    for (const radio of card.querySelectorAll('input')) {
      radio.checked = radio.value === system();
      radio.onchange = () => {
        setSystem(radio.value);
        location.reload();
      };
    }
    return card;
  }

  return { system, setSystem, inches, convertText, format, start, settingsCard };
});
