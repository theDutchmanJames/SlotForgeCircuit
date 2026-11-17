'use strict';
// Interface tests: drive the real app window like a user would.
// Run with: npm run test:ui   (desktop/ui-test-runner.cjs starts the app in test mode)
// Each test gets a fresh page load on a throwaway data folder.

function harness(win) {
  const wc = win.webContents;
  const errors = [];
  wc.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message);
  });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const h = {
    errors,
    sleep,
    // Runs code in the page; `code` may use await and should `return` a value.
    js: code => wc.executeJavaScript(`(async () => { ${code} })()`, true),
    async waitFor(code, what, timeout = 8000) {
      const end = Date.now() + timeout;
      let last;
      while (Date.now() < end) {
        try {
          last = await h.js(code);
          if (last) return last;
        } catch (e) {
          last = e.message;
        }
        await sleep(100);
      }
      throw Error(`Timed out waiting for ${what} (last value: ${JSON.stringify(last)})`);
    },
    async click(selector) {
      const ok = await h.js(
        `const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true;`
      );
      if (!ok) throw Error(`Nothing to click for ${selector}`);
      await sleep(80);
    },
    async key(keyCode, modifiers = []) {
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      wc.sendInputEvent({ type: 'char', keyCode, modifiers });
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      await sleep(80);
    },
    async mouse(type, x, y, extra = {}) {
      wc.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...extra });
      await sleep(30);
    },
    async rightClick(x, y) {
      for (const type of ['mouseDown', 'mouseUp'])
        wc.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'right', clickCount: 1 });
      await sleep(120);
    },
    async resize(width, height) {
      win.setContentSize(width, height);
      await sleep(400);
    },
    text: selector => h.js(`return document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? null;`),
    async section(name) {
      await h.js(`location.hash = ${JSON.stringify('#' + name)};`);
      await h.waitFor(`return document.body.dataset.section === ${JSON.stringify(name)};`, `section ${name}`);
      await sleep(150);
    },
    // True when the drawn track lies (mostly) inside the visible canvas.
    // Returns true, or a description of where the track and canvas are (for the failure message).
    trackOnScreen: () =>
      h.js(`
        const c = document.getElementById('canvas').getBoundingClientRect(),
          r = document.getElementById('roads').getBoundingClientRect(),
          box = q => [q.left, q.top, q.right, q.bottom].map(Math.round).join(',');
        if (!r.width) return 'track has no size';
        const w = Math.max(0, Math.min(c.right, r.right) - Math.max(c.left, r.left)),
          ht = Math.max(0, Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top)),
          share = (w * ht) / (r.width * r.height);
        return share > 0.95 || 'only ' + Math.round(share * 100) + '% visible; track ' + box(r) + ' canvas ' + box(c);`),
    async reload(hash = 'builder') {
      await wc.loadURL(wc.getURL().replace(/#.*$/, '') + '#' + hash);
      await wc.reload();
      await h.waitFor(
        `return document.getElementById('storage-open')?.textContent.startsWith('Storage: disk');`,
        'disk storage after reload',
        15000
      );
      await sleep(300);
    },
  };
  return h;
}

const assert = (ok, message) => {
  if (!ok) throw Error(message);
};

const tests = [];
// Tests share one data folder; { first: true } runs a test before anything is saved.
const test = (name, fn, { first = false } = {}) => (first ? tests.unshift({ name, fn }) : tests.push({ name, fn }));

// ---------------------------------------------------------------- baseline

test('starts with the example track on screen and disk storage connected', async h => {
  assert((await h.text('#storage-open')) === 'Storage: disk', 'storage is not on disk');
  assert(Number(await h.text('#piece-total')) > 0, 'no pieces on the example track');
  assert(
    (await h.trackOnScreen()) === true,
    'example track is not visible on the canvas: ' + (await h.trackOnScreen())
  );
});

test('adding a catalogue piece counts it and Undo removes it again', async h => {
  const before = Number(await h.text('#piece-total'));
  await h.click('#catalogue .piece-card');
  assert(Number(await h.text('#piece-total')) === before + 1, 'piece count did not go up');
  await h.click('#undo');
  assert(Number(await h.text('#piece-total')) === before, 'Undo did not remove the piece');
});

test('saving to the Track Library lists the design', async h => {
  await h.click('#save-design');
  await h.waitFor(`return document.getElementById('save-design-dialog').open;`, 'save dialog');
  await h.js(`document.getElementById('design-name').value = 'UI test oval';`);
  await h.click('#design-save-submit');
  await h.waitFor(`return !document.getElementById('save-design-dialog').open;`, 'save dialog to close');
  await h.section('library');
  await h.waitFor(
    `return document.getElementById('design-library').textContent.includes('UI test oval');`,
    'saved design in library'
  );
});

test('every main section opens without errors', async h => {
  for (const name of ['builder', 'routed', 'freeform', 'library', 'packs', 'custom', 'export', 'settings']) {
    await h.section(name);
  }
  await h.section('builder');
});

test('track stays on screen after the window is made smaller and larger', async h => {
  await h.resize(960, 640);
  assert(
    (await h.trackOnScreen()) === true,
    'track is off-screen after shrinking the window: ' + (await h.trackOnScreen())
  );
  await h.resize(1440, 900);
  assert(
    (await h.trackOnScreen()) === true,
    'track is off-screen after enlarging the window: ' + (await h.trackOnScreen())
  );
});

test('track is on screen when the app starts in a small window', async h => {
  await h.resize(920, 620);
  await h.reload();
  assert(
    (await h.trackOnScreen()) === true,
    'track is off-screen after starting in a small window: ' + (await h.trackOnScreen())
  );
  await h.resize(1440, 900);
  assert(
    (await h.trackOnScreen()) === true,
    'track is off-screen after enlarging the window: ' + (await h.trackOnScreen())
  );
});

// ---------------------------------------------------------------- quick wins

test('File menu opens, lists the file actions and closes with Escape', async h => {
  await h.click('#file-menu-button');
  assert(!(await h.js(`return document.getElementById('file-menu').hidden;`)), 'File menu did not open');
  const labels = await h.js(
    `return [...document.querySelectorAll('#file-menu [role=menuitem]:not([hidden])')].map(b => b.textContent);`
  );
  for (const want of ['New track', 'Open track file', 'Export track file', 'Export PDF report'])
    assert(
      labels.some(l => l.startsWith(want)),
      `File menu is missing "${want}" (has ${labels.join(', ')})`
    );
  await h.key('Escape');
  assert(await h.js(`return document.getElementById('file-menu').hidden;`), 'Escape did not close the File menu');
});

test('New track from the File menu asks first, then clears the canvas', async h => {
  await h.click('#file-menu-button');
  await h.click('#new');
  await h.waitFor(`return document.getElementById('confirm-dialog').open;`, 'replace confirmation');
  await h.click('#confirm-go');
  await h.waitFor(`return document.getElementById('piece-total').textContent.trim() === '0';`, 'empty track');
  // Put the example back so later tests have a track to work with.
  await h.click('#demo');
  await h.waitFor(`return Number(document.getElementById('piece-total').textContent) > 0;`, 'example track');
});

test('navigation has no separate Custom Track tab and pack editing highlights Track Packs', async h => {
  assert(
    !(await h.js(`return !!document.querySelector('.sf-nav-link[data-section="custom"]');`)),
    'Custom Track tab is still there'
  );
  await h.section('custom');
  assert(
    await h.js(`return document.querySelector('.sf-nav-link[aria-current="page"]')?.dataset.section === 'packs';`),
    'Track Packs is not highlighted while editing a pack'
  );
});

test(
  'an empty Track Library offers ways to start',
  async h => {
    await h.section('library');
    await h.waitFor(`return !document.getElementById('design-library-empty').hidden;`, 'library empty state');
    const cards = await h.js(`return document.querySelectorAll('#design-library-empty .empty-action').length;`);
    assert(cards === 3, `expected 3 start options, found ${cards}`);
  },
  { first: true }
);

test('a new FreeForm drawing explains how to start instead of listing problems', async h => {
  await h.section('freeform');
  const status = await h.waitFor(`return document.getElementById('ff-status')?.textContent;`, 'FreeForm status');
  assert(/first point/.test(status), `FreeForm status says "${status}"`);
  assert(!/review|attention/i.test(status), `FreeForm status still reports problems: "${status}"`);
});

test('track is on screen when the app starts on another page and then opens the builder', async h => {
  await h.reload('library');
  await h.section('builder');
  await h.sleep(200);
  assert(
    (await h.trackOnScreen()) === true,
    'track is off-screen after switching to the builder: ' + (await h.trackOnScreen())
  );
});

// ---------------------------------------------------------------- help, welcome, right-click

test('the welcome screen appears on first start, leads somewhere, then stays away', async h => {
  await h.js(`localStorage.removeItem('slotforge.welcome.v1');`);
  await h.reload();
  await h.waitFor(`return document.getElementById('welcome-dialog')?.open;`, 'welcome screen');
  await h.click('[data-welcome="freeform"]');
  await h.waitFor(`return document.body.dataset.section === 'freeform';`, 'FreeForm after choosing Draw freely');
  assert(!(await h.js(`return document.getElementById('welcome-dialog').open;`)), 'welcome screen did not close');
  await h.reload();
  assert(!(await h.js(`return !!document.getElementById('welcome-dialog')?.open;`)), 'welcome screen came back');
});

test('pressing ? shows the keyboard shortcuts and Escape closes them', async h => {
  await h.js(`document.getElementById('canvas').focus();`);
  await h.key('?', ['shift']);
  await h.waitFor(`return document.getElementById('shortcut-dialog')?.open;`, 'shortcut overview');
  const groups = await h.js(`return document.querySelectorAll('#shortcut-dialog .shortcut-groups section').length;`);
  assert(groups >= 4, `expected at least 4 shortcut groups, found ${groups}`);
  await h.key('Escape');
  assert(!(await h.js(`return document.getElementById('shortcut-dialog').open;`)), 'Escape did not close shortcuts');
});

// Finds a screen point that hits a track piece (or empty canvas when piece is false).
const canvasPoint = (h, piece = true) =>
  h.js(`
    const c = document.getElementById('canvas').getBoundingClientRect();
    for (let y = c.top + 20; y < c.bottom - 20; y += 9)
      for (let x = c.left + 20; x < c.right - 20; x += 9) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || !document.getElementById('canvas').contains(hit)) continue;
        if (!!hit.closest('[data-id]') === ${piece}) return { x, y, id: hit.closest('[data-id]')?.getAttribute('data-id') };
      }
    return null;`);

test('right-clicking a piece offers piece actions, and Delete removes it', async h => {
  const point = await canvasPoint(h, true);
  assert(point, 'could not find a piece on screen');
  const before = Number(await h.text('#piece-total'));
  await h.rightClick(point.x, point.y);
  await h.waitFor(`return !document.getElementById('context-menu')?.hidden;`, 'piece menu');
  const labels = await h.js(
    `return [...document.querySelectorAll('#context-menu [role=menuitem]')].map(b => b.firstChild.textContent);`
  );
  for (const want of ['Rotate', 'Mirror', 'Duplicate', 'Delete'])
    assert(labels.includes(want), `piece menu is missing "${want}" (has ${labels.join(', ')})`);
  await h.js(
    `[...document.querySelectorAll('#context-menu [role=menuitem]')].find(b => b.firstChild.textContent === 'Delete').click();`
  );
  assert(Number(await h.text('#piece-total')) === before - 1, 'Delete from the menu did not remove the piece');
  assert(await h.js(`return document.getElementById('context-menu').hidden;`), 'menu stayed open');
});

test('right-clicking empty canvas offers view actions', async h => {
  const point = await canvasPoint(h, false);
  assert(point, 'could not find empty canvas');
  await h.rightClick(point.x, point.y);
  await h.waitFor(`return !document.getElementById('context-menu')?.hidden;`, 'canvas menu');
  const labels = await h.js(
    `return [...document.querySelectorAll('#context-menu [role=menuitem]')].map(b => b.firstChild.textContent);`
  );
  assert(labels.includes('Fit track to view'), `canvas menu has ${labels.join(', ')}`);
  await h.key('Escape');
  assert(await h.js(`return document.getElementById('context-menu').hidden;`), 'Escape did not close the menu');
});

// ---------------------------------------------------------------- templates

test('a template from the File menu replaces the track with a closed circuit from that pack', async h => {
  await h.click('#file-menu-button');
  await h.click('#open-template');
  await h.waitFor(`return document.getElementById('template-dialog').open;`, 'template picker');
  await h.js(
    `const s = document.getElementById('template-pack'); s.value = [...s.options].find(o => /Scalextric/.test(o.text)).value; s.dispatchEvent(new Event('change'));`
  );
  const cards = await h.js(`return document.querySelectorAll('#template-grid .template-card svg').length;`);
  assert(cards >= 3, `expected at least 3 previews, found ${cards}`);
  await h.js(
    `[...document.querySelectorAll('#template-grid .template-card')].find(c => /Long oval/.test(c.textContent)).click();`
  );
  await h.waitFor(`return document.getElementById('confirm-dialog').open;`, 'replace confirmation');
  await h.click('#confirm-go');
  await h.waitFor(`return /Long oval/.test(document.getElementById('track-name').value);`, 'template track name');
  assert(/Closed circuit/.test(await h.text('#connection-state')), 'template is not a closed circuit');
  assert((await h.trackOnScreen()) === true, 'template is not fitted on screen');
  await h.click('#demo');
  await h.waitFor(`return document.getElementById('confirm-dialog').open;`, 'confirm for example');
  await h.click('#confirm-go');
});

test('the figure eight template opens in FreeForm as a closed circuit with a bridge', async h => {
  await h.click('#file-menu-button');
  await h.click('#open-template');
  await h.js(
    `[...document.querySelectorAll('#template-grid .template-card')].find(c => /Figure eight/.test(c.textContent)).click();`
  );
  await h.waitFor(`return document.body.dataset.section === 'freeform';`, 'FreeForm');
  const status = await h.waitFor(
    `const s = document.getElementById('ff-status').textContent; return /Closed circuit/.test(s) && s;`,
    'closed figure eight'
  );
  const issues = await h.js(`return document.getElementById('ff-issues').innerText;`);
  assert(/Bridge crossing/.test(issues), `no bridge crossing reported (${status}): ${issues}`);
  assert(!/insufficient height/i.test(issues), `bridge is too low: ${issues}`);
  const side = await h.js(
    `return document.querySelector('#ff-elevation svg') ? document.getElementById('ff-elevation').innerText : null;`
  );
  assert(side && /Highest 1\d\d mm/.test(side), `no side view with the bridge height: ${side}`);
});

// ---------------------------------------------------------------- desktop files

test('an exported track appears under Recent and opens again like a double-clicked file', async h => {
  // Export: in test mode the save goes straight to a temp folder instead of showing a dialog.
  await h.click('#save');
  const recent = await h.waitFor(
    `const list = await window.slotforgeDesktop.recentFiles(); return list.length && list;`,
    'the exported file in the recent list'
  );
  const file = recent[0].path;
  assert(/\.slotforge\.json$/.test(file), `recent file is ${file}`);
  // The File menu lists it.
  await h.click('#file-menu-button');
  await h.waitFor(`return !document.getElementById('recent-files').hidden;`, 'Recent section in the File menu');
  await h.key('Escape');
  // Replace the track, then open the file as the operating system would.
  await h.js(
    `document.getElementById('track-name').value = 'Something else'; document.getElementById('track-name').dispatchEvent(new Event('change'));`
  );
  h.context.trackFiles.deliver(file);
  await h.waitFor(`return document.getElementById('confirm-dialog').open;`, 'replace confirmation');
  await h.click('#confirm-go');
  await h.waitFor(`return document.getElementById('track-name').value === 'Club circuit';`, 'the opened track');
  require('node:fs').rmSync(file, { force: true });
});

test('a damaged track file shows a clear message instead of failing silently', async h => {
  const fs = require('node:fs'),
    file = require('node:path').join(h.context.app.getPath('temp'), 'circuit-ui-broken.slotforge');
  fs.writeFileSync(file, '{ not json');
  h.context.trackFiles.deliver(file);
  const message = await h.waitFor(
    `const t = document.getElementById('toast'); return !t.hidden && t.textContent;`,
    'error message'
  );
  assert(/Could not open circuit-ui-broken\.slotforge/.test(message), `message was "${message}"`);
  fs.rmSync(file, { force: true });
  h.errors.length = 0; // the app reports the parse error on purpose
});

// ---------------------------------------------------------------- lap times

test('Tune profile shows a lap time per lane, and a higher top speed shortens it', async h => {
  await h.click('#tab-tune');
  const read = () =>
    h.waitFor(
      `const rows = [...document.querySelectorAll('#lap-times .lap-row strong')].map(s => parseFloat(s.textContent));
       return rows.length ? rows : null;`,
      'lap times'
    );
  const before = await read();
  assert(before.length === 2 && before.every(s => s > 0), `lap times were ${JSON.stringify(before)}`);
  await h.js(
    `const s = document.getElementById('tune-speed'); s.value = Number(s.value) + 800; s.dispatchEvent(new Event('input'));`
  );
  await h.sleep(250);
  const after = await read();
  assert(after[0] < before[0], `lap did not get faster (${before[0]} → ${after[0]})`);
  await h.js(
    `const p = document.getElementById('preset'); p.value = 'Balanced'; p.dispatchEvent(new Event('change'));`
  );
});

// ---------------------------------------------------------------- units

test('choosing Imperial shows lengths in feet and inches, with inch hints on mm fields', async h => {
  await h.section('settings');
  await h.js(`document.querySelector('.units-choice input[value="imperial"]').click();`);
  await h.waitFor(
    `return document.getElementById('storage-open')?.textContent.startsWith('Storage: disk') && document.documentElement.dataset.units === 'imperial';`,
    'reload in imperial units',
    15000
  );
  await h.section('builder');
  await h.sleep(300);
  const length = await h.text('#length-total');
  assert(/ft/.test(length) && !/\bm\b/.test(length), `track length shows "${length}"`);
  await h.section('routed');
  const hint = await h.js(`return document.querySelector('#routed-view .unit-hint')?.textContent;`);
  assert(/in$/.test(hint || ''), `no inch hint next to mm fields (got ${JSON.stringify(hint)})`);
  // Back to metric for the other tests.
  await h.section('settings');
  await h.js(`document.querySelector('.units-choice input[value="metric"]').click();`);
  await h.waitFor(
    `return document.getElementById('storage-open')?.textContent.startsWith('Storage: disk') && !document.documentElement.dataset.units;`,
    'reload in metric units',
    15000
  );
  await h.section('builder');
  await h.sleep(300);
  assert(/\bm\b/.test(await h.text('#length-total')), 'track length did not return to metres');
});

// ---------------------------------------------------------------- routed layout, shorter text

test('Routed Wood shows the profile panel beside the preview, without page scrolling', async h => {
  await h.section('routed');
  const layout = await h.js(`
    const side = document.querySelector('.routed-sidebar').getBoundingClientRect(),
      main = document.querySelector('.routed-main').getBoundingClientRect(),
      view = document.getElementById('routed-view');
    return { sideBySide: side.right <= main.left + 1 && Math.abs(side.top - main.top) < 2,
      pageScrolls: view.scrollHeight > view.clientHeight + 1,
      applyVisible: (() => { const b = document.querySelector('#routed-profile-form button[type=submit]').getBoundingClientRect(); return b.bottom <= innerHeight && b.top >= 0; })() };`);
  assert(layout.sideBySide, 'profile panel is not beside the preview');
  assert(!layout.pageScrolls, 'the whole Routed Wood page still scrolls');
  assert(layout.applyVisible, 'Apply routed profile is not visible without scrolling');
});

test('long help texts are shortened with a More link that reveals the rest', async h => {
  const info = await h.js(`
    const p = document.querySelector('[data-condensed]');
    if (!p) return null;
    const more = p.querySelector('.more-text'), before = more.hidden;
    p.querySelector('.more-toggle').click();
    return { count: document.querySelectorAll('[data-condensed]').length, before, after: more.hidden };`);
  assert(info && info.count >= 20, `expected many shortened texts, found ${info?.count}`);
  assert(info.before === true && info.after === false, 'More did not reveal the rest of the text');
});

// ---------------------------------------------------------------- saving

test('edits are saved once editing pauses, and a waiting save finishes before quitting', async h => {
  const before = await h.js(`return LocalWorkspace.current.pieces.length;`);
  await h.js(
    `window.__puts = 0; const f = window.fetch; window.fetch = (u, o) => { if (String(u).endsWith('/api/current') && o?.method === 'PUT') window.__puts++; return f(u, o); };`
  );
  for (let i = 0; i < 4; i++) await h.click('#catalogue .piece-card');
  const waiting = await h.js(
    `return { unsaved: LocalWorkspace.unsaved, puts: window.__puts, state: document.getElementById('save-state').textContent };`
  );
  assert(waiting.unsaved && waiting.puts === 0, `saved before editing paused: ${JSON.stringify(waiting)}`);
  await h.waitFor(
    `return !LocalWorkspace.unsaved && document.getElementById('save-state').textContent === 'Saved to disk';`,
    'save after pause'
  );
  const after = await h.js(`return { pieces: LocalWorkspace.current.pieces.length, puts: window.__puts };`);
  assert(after.pieces === before + 4, `disk has ${after.pieces} pieces, expected ${before + 4}`);
  assert(after.puts === 1, `four quick edits made ${after.puts} saves`);
  // flush() (used by quit, export and backups) starts a waiting save at once.
  await h.click('#catalogue .piece-card');
  const flushed = await h.js(
    `return LocalWorkspace.flush().then(() => ({ unsaved: LocalWorkspace.unsaved, pieces: LocalWorkspace.current.pieces.length }));`
  );
  assert(!flushed.unsaved && flushed.pieces === before + 5, `flush left ${JSON.stringify(flushed)}`);
});

test('zooming and dragging keep the drawn pieces instead of redrawing them', async h => {
  await h.js(`window.__first = document.querySelector('#roads > g');`);
  const radius = await h.js(`return +document.querySelector('#ports circle')?.getAttribute('r') || null;`);
  await h.click('#zoom-in');
  assert(await h.js(`return document.querySelector('#roads > g') === window.__first;`), 'zoom redrew the pieces');
  const zoomed = await h.js(`return +document.querySelector('#ports circle')?.getAttribute('r') || null;`);
  assert(radius === null || zoomed < radius, `connector dots did not shrink with zoom (${radius} -> ${zoomed})`);
  // Drag the last piece away with real mouse input; it moves, the other pieces stay the same elements.
  const spot = await h.js(`
    const g = document.querySelector('#roads > g:last-child'), r = g.getBoundingClientRect();
    window.__id = g.dataset.id; window.__tf = g.getAttribute('transform');
    // A curve's bounding-box centre can lie off the piece: find a point that really hits it.
    for (const fy of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9])
      for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9]) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        if (document.elementFromPoint(x, y)?.closest('[data-id]') === g) return [x, y];
      }
    return [r.left + r.width / 2, r.top + r.height / 2];`);
  await h.mouse('mouseDown', spot[0], spot[1]);
  for (let i = 1; i <= 8; i++) await h.mouse('mouseMove', spot[0] + i * 12, spot[1] + i * 9, { button: 'left' });
  await h.mouse('mouseUp', spot[0] + 96, spot[1] + 72);
  const result = await h.js(`
    const g = document.querySelector('#roads > g[data-id="' + window.__id + '"]');
    return { moved: g.getAttribute('transform') !== window.__tf, kept: document.querySelector('#roads > g') === window.__first };`);
  assert(result.moved, 'the dragged piece did not move');
  assert(result.kept, 'dragging redrew the other pieces');
  await h.key('z', ['control']);
});

test('the PDF report loads its library on first use and downloads a PDF', async h => {
  assert(!(await h.js(`return !!window.jspdf;`)), 'the PDF library was loaded at start');
  const downloads = [];
  const listen = (_e, item) => downloads.push(item.getFilename());
  require('electron').session.defaultSession.on('will-download', listen);
  try {
    await h.click('#builder-pdf');
    await h.waitFor(`return document.getElementById('pdf-dialog').open;`, 'PDF dialog');
    await h.click('#pdf-download');
    await h.waitFor(
      `return !document.getElementById('pdf-dialog').open || document.getElementById('pdf-error').textContent;`,
      'PDF result',
      20000
    );
    const error = await h.text('#pdf-error');
    assert(!error, `PDF failed: ${error}`);
    assert(await h.js(`return !!window.jspdf?.jsPDF && !!window.SlotForgePdfFonts;`), 'PDF library not loaded');
    for (let i = 0; i < 50 && !downloads.length; i++) await new Promise(r => setTimeout(r, 100));
    assert(
      downloads.some(n => n.endsWith('.pdf')),
      `no PDF downloaded (${downloads.join(', ')})`
    );
  } finally {
    require('electron').session.defaultSession.removeListener('will-download', listen);
  }
});

// ---------------------------------------------------------------- updates

test('Check now finds a newer release: notice with Download and Not now, and Settings shows it', async h => {
  const u = h.context.updateCheck;
  const realFetch = u.fetch;
  let tag = 'v9.9.0';
  u.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({ tag_name: tag, draft: false, prerelease: false, published_at: '2026-01-01T00:00:00Z' }),
  });
  try {
    await h.section('settings');
    assert(/This version/.test(await h.text('.update-card')), 'no Updates card in Settings');
    await h.click('#update-check-now');
    const notice = await h.waitFor(`return document.getElementById('update-notice')?.textContent;`, 'update notice');
    assert(/Circuit 9\.9\.0 is available/.test(notice), `notice says "${notice}"`);
    assert(/Version 9\.9\.0 is available/.test(await h.text('.update-card')), 'Settings does not show the new version');
    assert(
      u.releaseUrl() === 'https://github.com/theDutchmanJames/SlotForgeCircuit/releases/tag/v9.9.0',
      u.releaseUrl()
    );
    await h.js(
      `[...document.querySelectorAll('#update-notice button')].find(b => b.textContent === 'Not now').click();`
    );
    await h.waitFor(`return !document.getElementById('update-notice');`, 'notice to close after Not now');
    // Not now holds until an even newer version appears.
    await h.reload('settings');
    assert(!(await h.js(`return !!document.getElementById('update-notice');`)), 'notice came back after Not now');
    tag = 'v9.9.1';
    await h.click('#update-check-now');
    await h.waitFor(
      `return /9\.9\.1/.test(document.getElementById('update-notice')?.textContent || '');`,
      'newer notice'
    );
  } finally {
    u.fetch = realFetch;
    // Leave the profile as a fresh install would have it.
    require('node:fs').rmSync(require('node:path').join(h.context.app.getPath('userData'), 'update-check.json'), {
      force: true,
    });
    Object.assign(u.state, u.load());
  }
});

async function run(win, context = {}) {
  const h = harness(win);
  h.context = context; // { app, where, origin, trackFiles } from the desktop shell
  const results = [];
  await h.waitFor(
    `return document.getElementById('storage-open')?.textContent.startsWith('Storage: disk');`,
    'disk storage',
    20000
  );
  // A fresh profile shows the welcome screen; most tests start after it has been seen.
  await h.js(`localStorage.setItem('slotforge.welcome.v1', 'seen');`);
  await h.reload();
  const only = process.env.SLOTFORGE_UI_ONLY;
  for (const t of tests) {
    if (only && !t.name.includes(only)) continue;
    const started = Date.now();
    h.errors.length = 0;
    try {
      await h.resize(1440, 900);
      await t.fn(h);
      if (h.errors.length) throw Error('Console errors: ' + h.errors.join(' | '));
      results.push({ name: t.name, ok: true, ms: Date.now() - started });
    } catch (e) {
      results.push({ name: t.name, ok: false, error: e.message, ms: Date.now() - started });
    }
    try {
      await h.reload();
    } catch (e) {
      results.push({ name: '(reload after ' + t.name + ')', ok: false, error: e.message });
      break;
    }
  }
  return { results };
}

module.exports = { run, tests, test, harness };
