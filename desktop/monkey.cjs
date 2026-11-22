'use strict';
// Random-click run: clicks, types, drags and opens windows at random in the real app, and records
// every console error, failed request, crash, frozen page and window that does not close.
// Started by desktop/monkey-runner.cjs (source tree only, never in a build), always on a copy of
// the data. Nothing leaves the computer: links, folders, native dialogs and the update check are
// replaced by stand-ins for the run.
const { BrowserWindow, dialog, shell } = require('electron');

function random(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 2 ** 32;
  };
}

// Runs in the page: lists what a person could click or type into right now, as plain data.
const CANDIDATES = `
  const skip = el =>
    el.closest('#storage-stop, #upgrade-stop, [data-monkey-skip]') ||
    (el.matches('input[type=file]')) ||
    (el.matches('a[href]') && /^(https?:|mailto:)/.test(el.getAttribute('href')));
  const visible = el => {
    if (el.disabled || el.closest('[inert], [hidden], [aria-hidden=true]')) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null;
    const top = document.elementFromPoint(x, y);
    if (!top || !(el === top || el.contains(top) || top.contains(el))) return null;
    return { x, y, w: r.width, h: r.height };
  };
  const dialogs = [...document.querySelectorAll('dialog[open]')];
  const scope = dialogs.length ? dialogs[dialogs.length - 1] : document;
  const list = [];
  const describe = el =>
    (el.id ? '#' + el.id : el.tagName.toLowerCase()) +
    ' "' + (el.getAttribute('aria-label') || el.title || (el.matches('input, select, textarea') ? (el.labels?.[0]?.textContent || el.name || el.placeholder) + ' = ' + el.value : el.textContent) || el.value || el.name || '').trim().replace(/\\s+/g, ' ').slice(0, 60) + '"' + (el.closest('[id]') ? ' in #' + el.closest('[id]').id : '');
  let n = 0;
  for (const el of document.querySelectorAll('[data-monkey]')) delete el.dataset.monkey;
  for (const el of scope.querySelectorAll('button, a[href], summary, [role=button], [role=tab], [role=menuitem], [role=option], [role=checkbox], [role=switch], input, select, textarea, label')) {
    if (skip(el)) continue;
    const at = visible(el);
    if (!at) continue;
    el.dataset.monkey = String(++n);
    const kind = el.matches('select') ? 'select'
      : el.matches('textarea, input:not([type]), input[type=text], input[type=search], input[type=number], input[type=email], input[type=url]') ? 'text'
      : el.matches('input[type=range]') ? 'range'
      : 'click';
    list.push({ id: n, kind, what: describe(el), ...at });
  }
  const surfaces = [...document.querySelectorAll('#canvas, svg#plan, .freeform-canvas, canvas, svg[role=img], [data-canvas]')]
    .map(el => ({ el, at: visible(el) }))
    .filter(s => s.at && s.at.w > 120 && s.at.h > 120 && (!dialogs.length || scope.contains(s.el)))
    .map(s => ({ what: describe(s.el), ...s.at }));
  return {
    list,
    surfaces,
    dialog: dialogs.length ? describe(dialogs[dialogs.length - 1]) : null,
    section: document.body.dataset.section || '',
    width: innerWidth,
    height: innerHeight,
  };
`;

const TEXT = [
  '',
  '0',
  '-1',
  '1',
  '12.5',
  '99999999',
  '1e9',
  'NaN',
  'abc',
  'Club oval',
  '  spaces  ',
  '<b>tag</b>',
  'O\'Brien "quoted"',
  '100% _wild\\',
  'Ünïcödé 🏁',
  'x'.repeat(120),
];
const KEYS = [
  ['Escape'],
  ['Enter'],
  ['Tab'],
  ['Tab', ['shift']],
  ['Space'],
  ['Delete'],
  ['Backspace'],
  ['Up'],
  ['Down'],
  ['Left'],
  ['Right'],
  ['z', ['control']],
  ['y', ['control']],
  ['z', ['control', 'shift']],
  ['a', ['control']],
  ['d', ['control']],
  ['r'],
  ['f'],
  ['m'],
  ['PageDown'],
  ['Home'],
];
const SECTIONS = ['builder', 'library', 'freeform', 'routed', 'packs', 'export', 'settings'];

async function run(h, win, context = {}) {
  // SLOTFORGE_PROBE=file.cjs: run one scripted check (module.exports = async (h, win) => result) instead.
  if (process.env.SLOTFORGE_PROBE)
    return { monkey: { probe: await require(process.env.SLOTFORGE_PROBE)(h, win), found: [], stats: {} } };
  const minutes = Number(process.env.SLOTFORGE_MONKEY_MINUTES || 5),
    seed = Number(process.env.SLOTFORGE_MONKEY_SEED || Date.now() % 100000),
    rnd = random(seed),
    pick = list => list[Math.floor(rnd() * list.length)],
    wc = win.webContents,
    steps = [],
    found = [],
    seen = new Map(),
    stats = { steps: 0, clicks: 0, typed: 0, keys: 0, drags: 0, sections: 0, reloads: 0, resizes: 0, windows: 0 };
  let action = ''; // the step in progress, so a problem can name what was happening
  const recent = () => steps.slice(-10).map(s => s.step + ' ' + s.action);
  // One entry per distinct problem, counted, with the steps that led to the first one.
  function report(kind, message, extra = {}) {
    const key = kind + ':' + String(message).replace(/\d+/g, '#').slice(0, 300);
    const known = seen.get(key);
    if (known) return void known.count++;
    const entry = {
      kind,
      message: String(message).slice(0, 2000),
      count: 1,
      step: stats.steps,
      section: steps.at(-1)?.section,
      before: recent(),
      during: action,
      ...extra,
    };
    seen.set(key, entry);
    found.push(entry);
  }

  // Stand-ins, so a random click never reaches the internet, the file system or a blocking dialog.
  shell.openExternal = async url => report('note', 'Would open an external link: ' + url);
  shell.showItemInFolder = () => {};
  shell.openPath = async () => '';
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  dialog.showSaveDialog = async () => ({ canceled: true });
  dialog.showMessageBoxSync = () => 1;
  dialog.showMessageBox = async () => ({ response: 1 });
  if (context.updateCheck) {
    const u = context.updateCheck;
    u.check = async () => u.status();
    u.startDownload = async () => u.status();
  }
  h.errors.length = 0;
  wc.on('console-message', event => {
    if (event.level === 'error')
      report('console error', event.message, { source: event.sourceId + ':' + event.lineNumber });
  });
  wc.on('render-process-gone', (_e, d) => report('crash', 'The page stopped: ' + d.reason));
  wc.on('unresponsive', () => report('frozen', 'The window stopped responding'));
  wc.session.webRequest.onCompleted({ urls: ['*://*/*'] }, d => {
    if (d.statusCode >= 400)
      report('failed request', `${d.method} ${d.url.replace(/^https?:\/\/[^/]+/, '')} → ${d.statusCode}`);
  });
  let lastNavigation = 0;
  wc.on('did-start-navigation', (_e, url, inPage) => {
    if (inPage) return;
    lastNavigation = Date.now();
    // The window should only ever show the app itself.
    // The track-pack galleries are pages of their own with the app's navigation bar: a note, not a fault.
    if (/\/track-packs\/[\w-]+\/index\.html$/.test(url)) report('note', 'Opened a pack gallery page: ' + url);
    else if (!/\/app\/(index\.html)?([?#].*)?$/.test(url)) report('navigation', 'The window left the app for ' + url);
  });
  // Steps that take far longer than a click should are a sign of a page getting slower.
  stats.slowSteps = 0;
  wc.session.webRequest.onErrorOccurred({ urls: ['*://*/*'] }, d => {
    // A reload cancels the outgoing page's unfinished font loads with ERR_CACHE_MISS; the new page
    // loads them again (checked at the end of the run), so those are not problems.
    if (d.error === 'net::ERR_CACHE_MISS' && d.resourceType === 'font') return;
    if (d.error !== 'net::ERR_ABORTED')
      report('failed request', `${d.method} ${d.url.replace(/^https?:\/\/[^/]+/, '')} → ${d.error}`, {
        type: d.resourceType,
        msSincePageLoad: Date.now() - lastNavigation,
      });
  });
  // A page call that does not come back in 15 s is a frozen page.
  const page = (code, what) =>
    Promise.race([
      h.js(code),
      new Promise((_, reject) =>
        setTimeout(() => reject(Error('no answer from the page for 15 s during ' + what)), 15000)
      ),
    ]);
  const native = async (type, x, y, extra) => h.mouse(type, x, y, extra);
  // A reload as a person does it (Ctrl+R): one navigation, then wait for the workspace.
  async function userReload() {
    wc.reload();
    await h.sleep(300);
    await h.waitFor(
      `return document.getElementById('storage-open')?.textContent.startsWith('Storage: disk');`,
      'disk storage after reload',
      15000
    );
  }

  async function click(t) {
    await native('mouseMove', t.x, t.y);
    await native('mouseDown', t.x, t.y);
    await native('mouseUp', t.x, t.y);
    stats.clicks++;
  }
  async function closeDialogs(state) {
    // Escape, then the dialog's own close or cancel button: a dialog still open after both is stuck.
    for (let attempt = 0; attempt < 2 && state.dialog; attempt++) {
      if (attempt === 0) await h.key('Escape');
      else
        await page(
          `const d = [...document.querySelectorAll('dialog[open]')].pop();
           const b = d && [...d.querySelectorAll('button')].find(b => /^(close|cancel|done|×|✕|not now|keep editing|ok)$/i.test((b.getAttribute('aria-label') || b.textContent).trim()));
           if (b) b.click(); return !!b;`,
          'closing a dialog'
        );
      await h.sleep(250);
      state = await page(CANDIDATES, 'listing');
    }
    if (state.dialog) {
      report('stuck window', `${state.dialog} stays open after Escape and its close button`);
      await page(
        `for (const d of document.querySelectorAll('dialog[open]')) d.close(); return true;`,
        'forcing dialogs shut'
      );
    }
  }

  const end = Date.now() + minutes * 60000;
  // Findings are saved as the run goes, so a window that closes or an app that stops by
  // itself still leaves a report, with the steps that led to it.
  let finished = false;
  const save = () => {
    if (finished) return;
    try {
      require('node:fs').writeFileSync(
        process.env.SLOTFORGE_UI_TESTS,
        JSON.stringify({ monkey: { seed, minutes, stats, found, partial: true, recent: recent() } }, null, 2)
      );
    } catch {}
  };
  const saver = setInterval(save, 30000);
  win.on('close', () => {
    report('closed', 'The main window was closed during the run');
    save();
  });
  require('electron').app.on('before-quit', () => {
    report('closed', 'Circuit started to quit during the run');
    save();
  });
  process.on('uncaughtException', e => {
    report('crash', 'Main process error: ' + (e.stack || e.message));
    save();
  });
  await h.resize(1440, 900);
  let state = await page(CANDIDATES, 'listing');
  while (Date.now() < end) {
    stats.steps++;
    const stepStarted = Date.now();
    const roll = rnd();
    action = '';
    try {
      if (state.dialog && rnd() < 0.08) {
        action = 'close ' + state.dialog;
        await closeDialogs(state);
      } else if (roll < 0.03) {
        const s = pick(SECTIONS);
        action = 'go to ' + s;
        await page(`location.hash = '#${s}'; return true;`, action);
        stats.sections++;
      } else if (roll < 0.035) {
        action = 'reload the page';
        await userReload();
        stats.reloads++;
      } else if (roll < 0.045) {
        const size = pick([
          [1440, 900],
          [1024, 700],
          [800, 600],
          [1920, 1080],
          [390, 800],
        ]);
        action = 'resize to ' + size.join('×');
        await h.resize(...size);
        stats.resizes++;
      } else if (roll < 0.15) {
        const [key, mods = []] = pick(KEYS);
        action = 'press ' + [...mods, key].join('+');
        await h.key(key, mods);
        stats.keys++;
      } else if (roll < 0.27 && state.surfaces.length) {
        const s = pick(state.surfaces),
          x0 = s.x + (rnd() - 0.5) * s.w * 0.8,
          y0 = s.y + (rnd() - 0.5) * s.h * 0.8,
          x1 = x0 + (rnd() - 0.5) * 300,
          y1 = y0 + (rnd() - 0.5) * 300;
        if (rnd() < 0.3) {
          action = 'wheel over ' + s.what;
          wc.sendInputEvent({
            type: 'mouseWheel',
            x: Math.round(x0),
            y: Math.round(y0),
            deltaX: 0,
            deltaY: rnd() < 0.5 ? 120 : -120,
            canScroll: true,
          });
        } else {
          action = `drag on ${s.what}`;
          await native('mouseMove', x0, y0);
          await native('mouseDown', x0, y0);
          for (let i = 1; i <= 6; i++) await native('mouseMove', x0 + ((x1 - x0) * i) / 6, y0 + ((y1 - y0) * i) / 6);
          await native('mouseUp', x1, y1);
          if (rnd() < 0.2) await native('mouseDown', x1, y1, { clickCount: 2 });
        }
        stats.drags++;
      } else if (state.list.length) {
        const t = pick(state.list);
        if (t.kind === 'text' && rnd() < 0.7) {
          const text = pick(TEXT);
          action = `type ${JSON.stringify(text.slice(0, 20))} into ${t.what}`;
          await click(t);
          await h.key('a', ['control']);
          if (text) wc.insertText(text);
          else await h.key('Backspace');
          await h.key(pick(['Enter', 'Tab', 'Escape']));
          stats.typed++;
        } else if (t.kind === 'select') {
          action = 'choose in ' + t.what;
          await page(
            `const el = document.querySelector('[data-monkey="${t.id}"]');
             if (el?.options?.length) { el.selectedIndex = Math.floor(${rnd()} * el.options.length); el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }
             return true;`,
            action
          );
        } else if (t.kind === 'range') {
          action = 'slide ' + t.what;
          await native('mouseDown', t.x - t.w / 2 + rnd() * t.w, t.y);
          await native('mouseUp', t.x - t.w / 2 + rnd() * t.w, t.y);
        } else {
          action = 'click ' + t.what;
          await click(t);
        }
      } else {
        action = 'press Escape (nothing to click)';
        await h.key('Escape');
      }
      steps.push({ step: stats.steps, action, section: state.section });
      if (steps.length > 200) steps.shift();
      if (Date.now() - stepStarted > 3000) {
        stats.slowSteps++;
        report('slow', `A step took ${((Date.now() - stepStarted) / 1000).toFixed(1)} s: ${action}`);
      }
      await h.sleep(40 + rnd() * 120);
      // Extra windows (Help, print previews) are counted, then closed; one that will not close is stuck.
      for (const w of BrowserWindow.getAllWindows())
        if (w !== win && !w.isDestroyed()) {
          stats.windows++;
          w.destroy();
        }
      if (!win.isFocused()) win.focus();
      state = await page(CANDIDATES, 'listing');
    } catch (e) {
      steps.push({ step: stats.steps, action, section: state.section });
      report('frozen', e.message, {
        url: wc.getURL(),
        title: wc.getTitle(),
        minutesIn: +((Date.now() - (end - minutes * 60000)) / 60000).toFixed(1),
      });
      try {
        await h.reload('builder');
        state = await page(CANDIDATES, 'listing');
      } catch (again) {
        report('crash', 'The page could not be reloaded: ' + again.message);
        break;
      }
    }
  }
  // At the end: the workspace still opens and answers.
  try {
    await h.reload('library');
    const tracks = await h.js(`return (await DesignLibrary.summaries()).length;`);
    stats.tracksAtEnd = tracks;
    // After a reload every web font must still load (or not be needed yet), never fail.
    stats.fonts = await h.js(
      `await Promise.all([...document.fonts].map(f => f.load().catch(() => null)));
       return [...document.fonts].map(f => f.family.replace(/"/g, '') + ' ' + f.weight + ' ' + f.style + ': ' + f.status);`
    );
    for (const font of stats.fonts) if (!font.endsWith(': loaded')) report('font', 'A web font did not load: ' + font);
  } catch (e) {
    report('crash', 'After the run the library did not open: ' + e.message);
  }
  clearInterval(saver);
  finished = true; // the normal quit after the run must not overwrite the final report
  return { monkey: { seed, minutes, stats, found } };
}

module.exports = { run };
