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
    // A picture of the window, only when SLOTFORGE_UI_SHOTS names a folder (for checking a design by eye).
    async shot(name) {
      const dir = process.env.SLOTFORGE_UI_SHOTS;
      if (!dir) return;
      await sleep(400); // let the window draw first
      require('node:fs').writeFileSync(require('node:path').join(dir, name + '.png'), (await wc.capturePage()).toPNG());
    },
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
  for (const name of ['builder', 'routed', 'freeform', 'library', 'packs', 'export', 'settings']) {
    await h.section(name);
  }
  await h.section('builder');
});

test('the main menu bar never cuts a page link off and steps down in a narrow window', async h => {
  const bar = () =>
    h.js(`
      const head = document.querySelector('.sf-header'), nav = head.querySelector('nav');
      const box = nav.getBoundingClientRect();
      const links = [...nav.querySelectorAll('.pw-grp > .sf-nav-link')];
      return { groups: nav.querySelectorAll('.pw-grp').length, links: links.length, fit: Number(head.dataset.fit),
        cut: links.filter(a => { const r = a.getBoundingClientRect(); return r.right > box.right + 1 || r.left < box.left - 1; }).map(a => a.title),
        light: document.getElementById('pw-storage')?.dataset.state };`);
  await h.resize(1440, 900);
  let b = await bar();
  assert(b.groups === 2 && b.links === 6, `expected 6 page links in 2 groups, found ${b.links} in ${b.groups}`);
  assert(!b.cut.length, `links cut off at 1440 px: ${b.cut}`);
  assert(['good', 'warn', 'busy', 'bad'].includes(b.light), `no storage light state: ${b.light}`);
  const wide = b.fit;
  await h.resize(720, 640);
  await h.waitFor(`return Number(document.querySelector('.sf-header').dataset.fit) > ${wide};`, 'the bar to step down');
  b = await bar();
  assert(!b.cut.length, `links cut off at 720 px (step ${b.fit}): ${b.cut}`);
  await h.resize(1440, 900);
  await h.waitFor(
    `return Number(document.querySelector('.sf-header').dataset.fit) === ${wide};`,
    'the bar to step back up'
  );
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
  // The old pack-editing address opens the Track Packs workbench on your own pack.
  await h.js(`location.hash = '#custom';`);
  await h.waitFor(`return document.body.dataset.section === 'packs' && location.hash === '#packs';`, 'Track Packs');
  assert(
    await h.js(`return document.querySelector('.sf-nav-link[aria-current="page"]')?.dataset.section === 'packs' &&
      !!document.querySelector('#wb-packs [aria-selected="true"]') && !!document.getElementById('wb-pack-name');`),
    'editing a pack did not open your own pack on Track Packs'
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

test('FreeForm guided sketch: five steps, a drawer per step, and lanes and heights from the drawer', async h => {
  await h.section('freeform');
  await h.resize(1600, 900);
  const q = code => h.js(code);
  const steps = await q(`return [...document.querySelectorAll('#ff-steps [data-step]')].map(b => b.dataset.step);`);
  assert(steps.join() === 'draw,close,lanes,heights,check', `steps ${steps}`);
  await h.click('#ff-eight');
  await h.waitFor(`return /closed/.test(document.getElementById('ff-facts').textContent);`, 'the figure eight');
  assert(
    await q(
      `return document.getElementById('ff-step-close').classList.contains('done') || document.getElementById('ff-step-close').getAttribute('aria-selected') === 'true';`
    ),
    'Close the loop is not done'
  );
  // Lanes: ＋ adds a lane at once, and the lap per lane follows.
  await h.click('#ff-step-lanes');
  const lanes = await q(`return +document.querySelector('#ffd-body .ffd-stepper b').textContent;`);
  await q(`document.querySelector('#ffd-body [aria-label="One lane more"]').click();`);
  await h.waitFor(`return document.querySelectorAll('#ffd-body .ffd-lap').length === ${lanes + 1};`, 'one more lane');
  assert(new RegExp(lanes + 1 + ' lanes').test(await h.text('#ff-facts')), 'the facts did not follow');
  await q(`document.querySelector('#ffd-body [aria-label="One lane fewer"]').click();`);
  await h.waitFor(`return document.querySelectorAll('#ffd-body .ffd-lap').length === ${lanes};`, 'back to the start');
  // Heights: the drawer sets the chosen point's height.
  await h.click('#ffd-next');
  assert(
    (await q(`return document.getElementById('ff-step-heights').getAttribute('aria-selected');`)) === 'true',
    'Next did not go to Heights'
  );
  const old = await q(`return document.getElementById('ffd-height').value;`);
  await q(`const f = document.getElementById('ffd-height'); f.value = '42'; f.dispatchEvent(new Event('change'));`);
  await h.waitFor(`return document.getElementById('ffd-height')?.value === '42';`, 'the new height');
  await h.click('#ff-undo');
  await h.waitFor(
    `return document.getElementById('ffd-height')?.value === ${JSON.stringify(old)};`,
    'undo of the height'
  );
  // Check & use: Next becomes Use in builder.
  await h.click('#ff-step-check');
  assert((await h.text('#ffd-next')) === 'Use in builder', 'the last step does not offer Use in builder');
  await h.click('#ff-cancel');
  await h.waitFor(`return document.body.dataset.section === 'builder';`, 'the builder after Cancel');
  await h.resize(1440, 900);
});

test('FreeForm: start card, modes by key, snap, one loop button, whole-drawing moves, history, full canvas', async h => {
  await h.section('freeform');
  await h.resize(1600, 900);
  const q = code => h.js(code);
  assert(await q(`return !document.getElementById('ff-start').hidden;`), 'no start card on an empty table');
  assert((await h.text('#ff-facts')) === 'No points yet', 'facts on an empty table');
  // Modes by key: E and D.
  await q(`document.getElementById('ff-canvas').focus();`);
  await h.key('e');
  assert(
    (await q(`return document.getElementById('ff-edit').getAttribute('aria-pressed');`)) === 'true',
    'E did not choose Edit'
  );
  await h.key('d');
  assert(
    (await q(`return document.getElementById('ff-draw').getAttribute('aria-pressed');`)) === 'true',
    'D did not choose Draw'
  );
  // Snap 10 mm: a clicked point lands on the grid.
  await h.click('#ff-snap');
  const spot = await q(`const r = document.getElementById('ff-canvas').getBoundingClientRect();
    return [Math.round(r.left + r.width * 0.2), Math.round(r.top + r.height * 0.25)];`);
  await h.mouse('mouseDown', spot[0], spot[1]);
  await h.mouse('mouseUp', spot[0], spot[1]);
  await h.waitFor(`return /^1 point/.test(document.getElementById('ff-facts').textContent);`, 'one point');
  const xy = await q(`return [+document.getElementById('ff-x').value, +document.getElementById('ff-y').value];`);
  assert(
    xy.every(v => Math.abs(v / 10 - Math.round(v / 10)) < 1e-6),
    `the point is not on the 10 mm grid: ${xy}`
  );
  assert(await q(`return document.getElementById('ff-start').hidden;`), 'the start card stayed after the first point');
  await h.click('#ff-snap');
  // Start again from an oval: one loop button.
  await h.click('#ff-oval');
  await h.waitFor(`return /points · closed/.test(document.getElementById('ff-facts').textContent);`, 'a closed oval');
  assert(
    await q(`return document.getElementById('ff-close').hidden && !document.getElementById('ff-reopen').hidden;`),
    'Close loop and Reopen loop both show'
  );
  // Rotate 90° moves every point; the history says so and undoes it.
  await h.click('#ff-next-point');
  const before = await q(`return [+document.getElementById('ff-x').value, +document.getElementById('ff-y').value];`);
  await q(
    `[...document.querySelectorAll('.ff-design-menu button')].find(b => b.textContent === 'Rotate 90°').click();`
  );
  const after = await q(`return [+document.getElementById('ff-x').value, +document.getElementById('ff-y').value];`);
  assert(after.join() !== before.join(), `Rotate 90° did not move point 1 (${before} -> ${after})`);
  await h.click('#ff-history');
  const steps = await q(
    `return [...document.querySelectorAll('#ff-history-menu [role=menuitem]')].map(b => b.textContent);`
  );
  assert(/^Moved \d+ points$/.test(steps[0]), `history ${steps}`);
  await q(`document.querySelector('#ff-history-menu [role=menuitem]').click();`);
  const back = await q(`return [+document.getElementById('ff-x').value, +document.getElementById('ff-y').value];`);
  assert(back.join() === before.join(), `undo from the history did not restore point 1 (${back})`);
  // Lanes: − / +.
  await h.click('#ff-tab-lanes');
  const lanes = await q(`return +document.getElementById('ff-count').value;`);
  await h.click('#ff-count-up');
  assert(
    (await q(`return +document.getElementById('ff-count').value;`)) === Math.min(8, lanes + 1),
    '+ did not add a lane'
  );
  await h.click('#ff-count-down');
  await h.click('#ff-tab-points');
  // The guided sketch starts full width: H shows every setting, H folds them away again.
  await q(`document.getElementById('ff-canvas').focus();`);
  const hidden = () =>
    q(
      `return document.getElementById('freeform-dialog').classList.contains('ff-canvas-only') && !document.querySelector('#freeform-dialog .ff-settings').offsetParent;`
    );
  const was = await hidden();
  await h.key('h');
  assert((await hidden()) !== was, 'H did not toggle the settings');
  await h.key('h');
  assert((await hidden()) === was, 'H did not toggle the settings back');
  await h.click('#ff-cancel');
  await h.waitFor(`return document.body.dataset.section === 'builder';`, 'the builder after Cancel');
  await h.resize(1440, 900);
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

test('the shortcuts window reads as a help page and its related chip opens the welcome screen', async h => {
  await h.js(`CircuitHelp.shortcuts();`);
  await h.waitFor(`return document.getElementById('shortcut-dialog')?.open;`, 'shortcut overview');
  const look = await h.js(`
    const d = document.getElementById('shortcut-dialog');
    const lead = d.querySelector('.help-plain');
    return { crumb: d.querySelector('.help-crumb')?.textContent, lead: lead && getComputedStyle(lead).borderLeftWidth,
      chips: [...d.querySelectorAll('.help-related .help-chip')].map(b => b.textContent) };`);
  assert(look.crumb === 'Help', `expected the trail "Help", found ${look.crumb}`);
  assert(look.lead === '2px', `expected the lead with a 2px line on its left, found ${look.lead}`);
  assert(look.chips.includes('Welcome screen'), `expected a Welcome screen chip, found ${look.chips}`);
  await h.click('#shortcut-dialog .help-chip');
  await h.waitFor(`return document.getElementById('welcome-dialog')?.open;`, 'welcome screen from the chip');
  assert(!(await h.js(`return document.getElementById('shortcut-dialog').open;`)), 'shortcuts stayed open');
  await h.js(`document.getElementById('welcome-dialog').close();`);
});

test('Track Packs workbench: pack tabs, a piece drawn with its size, and a new piece made in place', async h => {
  await h.section('packs');
  await h.resize(1600, 900);
  const tab = id => h.js(`document.querySelector('#wb-packs [data-pack="${id}"]').click();`);
  // A built-in pack: pieces grouped on the left, the first drawn with its footprint, facts on the right.
  await tab('slotforge.carrera-evolution-digital');
  const shown = await h.js(`return {
    groups: [...document.querySelectorAll('#wb-bin .wb-label')].map(e => e.textContent.split(' · ')[0]),
    pieces: document.querySelectorAll('#wb-bin [data-piece]').length,
    picked: document.querySelector('#wb-bin [aria-selected="true"]')?.textContent,
    drawing: !!document.querySelector('#wb-stage svg.wb-drawing .wb-dim'),
    title: document.querySelector('#wb-inspector h2')?.textContent,
    facts: [...document.querySelectorAll('#wb-inspector .wb-fact span')].map(e => e.textContent),
    newPiece: !document.getElementById('wb-new-piece').hidden };`);
  assert(shown.groups[0] === 'Straights' && shown.pieces > 10, `bin: ${JSON.stringify(shown)}`);
  assert(shown.drawing && shown.picked?.includes(shown.title), `stage/inspector: ${JSON.stringify(shown)}`);
  assert(shown.facts.includes('Length') && shown.facts.includes('Connector'), `facts ${shown.facts}`);
  assert(!shown.newPiece, 'a built-in pack offers New piece');
  // Search narrows the bin; another piece shows in the inspector.
  await h.js(
    `const f = document.getElementById('packs-search'); f.value = 'curve'; f.dispatchEvent(new Event('input'));`
  );
  assert(
    await h.js(
      `return [...document.querySelectorAll('#wb-bin [data-piece]')].every(b => /curve/i.test(b.textContent));`
    ),
    'search did not narrow the pieces'
  );
  await h.js(`document.querySelectorAll('#wb-bin [data-piece]')[1].click();`);
  assert(
    await h.js(
      `return document.querySelector('#wb-bin [aria-selected="true"]').textContent.includes(document.querySelector('#wb-inspector h2').textContent);`
    ),
    'the inspector did not follow the picked piece'
  );
  await h.js(`const f = document.getElementById('packs-search'); f.value = ''; f.dispatchEvent(new Event('input'));`);
  // Your own pack: New piece opens the editor in place; Cancel puts it back in its window.
  await tab('custom');
  const before = await h.js(`return document.querySelectorAll('#wb-bin [data-piece]').length;`);
  await h.click('#wb-new-piece');
  assert(
    await h.js(
      `return !document.getElementById('wb-editor').hidden && document.getElementById('wb-editor').contains(document.getElementById('piece-form')) && !document.getElementById('piece-dialog').open;`
    ),
    'New piece did not open the editor in place'
  );
  await h.js(`document.querySelector('#wb-editor [data-close="piece-dialog"]').click();`);
  assert(
    await h.js(
      `return document.getElementById('wb-editor').hidden && document.getElementById('piece-dialog').contains(document.getElementById('piece-form'));`
    ),
    'Cancel did not put the form back'
  );
  // Make a piece: it joins the pack and is picked.
  await h.click('#wb-new-piece');
  await h.js(
    `const f = document.getElementById('piece-form'); f.elements.name.value = 'Workbench test straight'; f.elements.name.dispatchEvent(new Event('input'));`
  );
  await h.click('#create-piece');
  await h.waitFor(
    `return document.getElementById('wb-editor').hidden &&
    document.querySelector('#wb-inspector h2')?.textContent === 'Workbench test straight';`,
    'the new piece picked'
  );
  assert(
    (await h.js(`return document.querySelectorAll('#wb-bin [data-piece]').length;`)) === before + 1,
    'the pack did not grow'
  );
  // Delete it again.
  await h.js(
    `[...document.querySelectorAll('#wb-inspector button')].find(b => b.textContent === 'Delete from pack').click();`
  );
  await h.waitFor(`return document.getElementById('delete-pack-pieces-dialog').open;`, 'the delete window');
  await h.click('#delete-pack-pieces-confirm');
  await h.waitFor(`return document.querySelectorAll('#wb-bin [data-piece]').length === ${before};`, 'the piece to go');
  // The routed templates link to Routed Wood; leaving the page while editing puts the form back.
  await tab('slotforge.routed');
  assert(/Configure in Routed Wood/.test(await h.text('#wb-pack-bar')), 'no Configure in Routed Wood');
  await tab('custom');
  await h.click('#wb-new-piece');
  await h.section('builder');
  assert(
    await h.js(`return document.getElementById('piece-dialog').contains(document.getElementById('piece-form'));`),
    'leaving Track Packs kept the form out of its window'
  );
  await h.resize(1440, 900);
});

test('the storage light follows the storage state and the bar re-fits when its words change', async h => {
  await h.resize(1440, 900);
  const light = () => h.js(`return document.getElementById('pw-storage').dataset.state;`);
  const before = await h.js(`return document.getElementById('storage-open').dataset.storage;`);
  assert(before === 'disk' || before === 'browser', `footer storage state is ${before}`);
  await h.js(`document.getElementById('storage-open').dataset.storage = 'unavailable';`);
  await h.waitFor(`return document.getElementById('pw-storage').dataset.state === 'bad';`, 'a red light');
  await h.js(`document.getElementById('storage-open').dataset.storage = ${JSON.stringify(before)};`);
  await h.waitFor(`return document.getElementById('pw-storage').dataset.state !== 'bad';`, 'the light back');
  assert(['good', 'warn'].includes(await light()), 'light did not return to its state');
  // Longer words in the bar (here the version) make it step down without a resize.
  await h.resize(1900, 900);
  await h.waitFor(`return document.querySelector('.sf-header').dataset.fit === '0';`, 'the whole bar at 1900 px');
  const fit = 0;
  const version = await h.text('.sf-header .sf-version');
  await h.js(`document.querySelector('.sf-header .sf-version').textContent = 'v0.4.1 ' + 'x'.repeat(400);`);
  await h.waitFor(`return Number(document.querySelector('.sf-header').dataset.fit) > ${fit};`, 'the bar to step down');
  await h.js(`document.querySelector('.sf-header .sf-version').textContent = ${JSON.stringify(version)};`);
  await h.waitFor(
    `return Number(document.querySelector('.sf-header').dataset.fit) === ${fit};`,
    'the bar to step back'
  );
});

// Library cards: find one by name, and choose an item from its ⋯ menu.
const cardJs = name =>
  `[...document.querySelectorAll('.garage-card')].find(c => c.querySelector('h3').textContent === ${JSON.stringify(name)})`;
async function cardMenu(h, name, item) {
  await h.js(`${cardJs(name)}.querySelector('.garage-more-actions').click();`);
  await h.waitFor(`return !document.getElementById('context-menu')?.hidden;`, 'the card menu');
  const found = await h.js(`const b = [...document.querySelectorAll('#context-menu [role=menuitem]')]
      .find(b => b.firstChild.textContent === ${JSON.stringify(item)});
    if (b) b.click();
    return !!b;`);
  assert(found, `no "${item}" in the menu of ${name}`);
}
async function saveToLibrary(h, name) {
  await h.section('library');
  // With a track in the builder, the bench saves it; on an empty builder, the heading does.
  await h.click(
    (await h.js(`return document.getElementById('library-save-current').hidden;`))
      ? '#garage-save-as'
      : '#library-save-current'
  );
  await h.waitFor(`return !document.getElementById('design-save-submit').disabled;`, 'the save window');
  await h.js(`document.getElementById('design-name').value = ${JSON.stringify(name)};
    document.getElementById('design-copy').checked = !document.getElementById('design-copy-label').hidden;`);
  await h.click('#design-save-submit');
  await h.waitFor(`return !!${cardJs(name)};`, `"${name}" in the library`);
}

test('dialog family: every window has the same head and foot; Save offers update or a new track', async h => {
  await h.section('builder');
  const shape =
    await h.js(`return Object.keys(DialogFamily.FAMILY).map(id => document.getElementById(id)).filter(Boolean).map(d => {
    const head = d.querySelector('.dlg-head'), host = head?.parentElement;
    return { id: d.id, dlg: d.classList.contains('dlg'), first: host?.firstElementChild === head, tile: !!head?.querySelector('.dlg-tile svg'),
      title: !!head?.querySelector('h2'), close: !!head?.querySelector('.dlg-close') };
  });`);
  assert(shape.length >= 15, `only ${shape.length} windows in the family`);
  const bad = shape.filter(s => !(s.dlg && s.first && s.tile && s.title));
  assert(!bad.length, `windows without the family head: ${JSON.stringify(bad)}`);
  assert(!shape.find(s => s.id === 'storage-upgrade').close, 'the library upgrade window offers ×');
  assert(
    shape.filter(s => s.id !== 'storage-upgrade').every(s => s.close),
    'a window has no ×'
  );
  // Save this track: a picture, and two choices that set "new copy" for the save.
  await saveToLibrary(h, 'Dialog family check');
  await h.click('#garage-save-as');
  await h.waitFor(`return !document.getElementById('design-save-submit').disabled;`, 'the save window');
  assert(
    await h.js(
      `return !!document.querySelector('#design-save-picture svg') && !document.getElementById('design-save-choices').hidden;`
    ),
    'no picture or choices'
  );
  await h.js(`document.querySelector('#design-save-choices [data-copy="true"]').click();`);
  assert(
    await h.js(
      `return document.getElementById('design-copy').checked && document.getElementById('design-save-submit').textContent === 'Save as a new track';`
    ),
    'Save as a new track did not set the copy'
  );
  await h.js(`document.querySelector('#design-save-choices [data-copy="false"]').click();`);
  assert(
    await h.js(
      `return !document.getElementById('design-copy').checked && document.getElementById('design-save-submit').textContent === 'Update saved track';`
    ),
    'Update did not clear the copy'
  );
  await h.js(`document.getElementById('save-design-dialog').close();`);
  await h.js(`(async () => { const D = window.DesignLibrary;
    for (const r of await D.summaries()) if (r.title === 'Dialog family check') await D.remove(r.id, r.revision);
    await D.purge(null); })();`);
  await h.section('builder');
});

test('Export… on a saved track opens the Print Shop with that track picked', async h => {
  await h.section('export');
  await h.js(`document.querySelector('#shop-sources [data-choice="backup"]').click();`);
  await saveToLibrary(h, 'Export landing check');
  await cardMenu(h, 'Export landing check', 'Export…');
  await h.waitFor(`return document.body.dataset.section === 'export';`, 'the export page');
  await h.waitFor(
    `const b = document.querySelector('#shop-sources [aria-selected="true"]');
    return !!b && b.dataset.choice.startsWith('saved:') && b.textContent.includes('Export landing check') &&
      document.querySelectorAll('#shop-formats [data-format]').length === 5;`,
    'the saved track picked, with the five track formats'
  );
  // Tidy up: delete the saved track again, and empty the Bin.
  await h.section('library');
  await cardMenu(h, 'Export landing check', 'Move to the Bin');
  await h.waitFor(`return document.getElementById('delete-design-dialog')?.open;`, 'the delete window');
  await h.click('#delete-design-confirm');
  await h.waitFor(`return !${cardJs('Export landing check')};`, 'the card to leave');
  await h.js(`window.DesignLibrary.purge(null);`);
  await h.section('builder');
});

test('Open the gallery shows a pack gallery in its own window; its app links come back to the main window', async h => {
  const { BrowserWindow } = require('electron');
  await h.section('packs');
  await h.js(`document.querySelector('#wb-packs [data-pack="slotforge.ninco"]').click();`);
  await h.sleep(200);
  const before = BrowserWindow.getAllWindows().length,
    mainUrl = h.context.app && (await h.js('return location.href;'));
  const clicked = await h.js(
    `const b = [...document.querySelectorAll('#wb-pack-bar button')].find(b => b.textContent.trim() === 'Open the gallery'); if (b) b.click(); return !!b;`
  );
  assert(clicked, 'no Open the gallery button for a built-in pack');
  let gallery = null;
  for (let i = 0; i < 50 && !gallery; i++) {
    await h.sleep(100);
    gallery = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/track-packs/ninco/index.html'));
  }
  assert(gallery, 'the gallery did not open in a window of its own');
  assert(BrowserWindow.getAllWindows().length === before + 1, 'not exactly one new window');
  assert((await h.js('return location.href;')) === mainUrl, 'the main window left the app');
  await new Promise(r => (gallery.webContents.isLoading() ? gallery.webContents.once('did-finish-load', r) : r()));
  const closed = new Promise(r => gallery.once('closed', r));
  // Clicked a moment later: the click closes this window, so it could not answer a call that waits.
  await gallery.webContents.executeJavaScript(
    `setTimeout(() => document.querySelector('a.sf-nav-link[data-section="library"]').click(), 50); true`
  );
  await Promise.race([closed, h.sleep(5000)]);
  assert(gallery.isDestroyed(), 'the gallery window stayed open after a link into the app');
  await h.waitFor(`return document.body.dataset.section === 'library';`, 'the main window showing the Track Library');
  assert(BrowserWindow.getAllWindows().length === before, 'a second app window was left behind');
  await h.section('builder');
});

test('Track Library: the bench, stars and chips, sort, rename, duplicate and the Bin', async h => {
  await h.section('library');
  await h.resize(1600, 900);
  await saveToLibrary(h, 'Garage alpha');
  await saveToLibrary(h, 'Garage beta');
  // The bench shows the builder's track, saved and up to date.
  assert(
    await h.js(`return !document.getElementById('garage-bench').hidden &&
      document.getElementById('garage-bench').dataset.state === 'saved' &&
      document.getElementById('garage-bench-name').textContent === 'Garage beta' &&
      ${cardJs('Garage beta')}.classList.contains('on-bench');`),
    'the bench does not show "Garage beta" as saved'
  );
  // A star adds the Favourites chip; the chip shows only starred tracks.
  await h.js(`${cardJs('Garage alpha')}.querySelector('.garage-star').click();`);
  await h.waitFor(`return !!document.querySelector('.garage-chip[data-filter="fav"]');`, 'the Favourites chip');
  await h.click('.garage-chip[data-filter="fav"]');
  await h.waitFor(
    `return document.querySelectorAll('.garage-card').length >= 1 &&
    [...document.querySelectorAll('.garage-card h3')].every(n => n.textContent === 'Garage alpha');`,
    'only the starred track'
  );
  await h.click('.garage-chip[data-filter="all"]');
  // Sort by name puts alpha before beta.
  await h.js(
    `const s = document.getElementById('garage-sort'); s.value = 'name'; s.dispatchEvent(new Event('change'));`
  );
  await h.waitFor(
    `const n = [...document.querySelectorAll('.garage-card h3')].map(n => n.textContent);
    return n.indexOf('Garage alpha') > -1 && n.indexOf('Garage alpha') < n.indexOf('Garage beta');`,
    'alpha before beta'
  );
  // Rename from the menu; the open copy follows the new name.
  await cardMenu(h, 'Garage beta', 'Rename…');
  await h.waitFor(`return document.getElementById('rename-design-dialog').open;`, 'the rename window');
  await h.js(`document.getElementById('rename-design-name').value = 'Garage gamma';`);
  await h.click('#rename-design-submit');
  await h.waitFor(`return !!${cardJs('Garage gamma')};`, 'the renamed card');
  assert(
    (await h.js(`return document.getElementById('track-name').value;`)) === 'Garage gamma',
    'the builder kept the old name'
  );
  // Duplicate adds a copy.
  await cardMenu(h, 'Garage alpha', 'Duplicate');
  await h.waitFor(`return !!${cardJs('Garage alpha copy')};`, 'the copy');
  // The Bin: move one in, restore it.
  await cardMenu(h, 'Garage alpha copy', 'Move to the Bin');
  await h.waitFor(`return document.getElementById('delete-design-dialog')?.open;`, 'the delete window');
  await h.click('#delete-design-confirm');
  await h.waitFor(
    `return !document.getElementById('garage-bin').hidden &&
    document.getElementById('garage-bin-count').textContent === '1';`,
    'the Bin button'
  );
  await h.click('#garage-bin');
  await h.waitFor(
    `return !document.getElementById('garage-bin-panel').hidden &&
    document.querySelectorAll('.garage-bin-row').length === 1;`,
    'the Bin list'
  );
  await h.js(
    `[...document.querySelectorAll('.garage-bin-row button')].find(b => b.textContent === 'Restore').click();`
  );
  await h.waitFor(`return document.querySelectorAll('.garage-bin-row').length === 0;`, 'the Bin to empty');
  await h.click('#garage-bin');
  await h.waitFor(`return !!${cardJs('Garage alpha copy')};`, 'the restored card');
  // Tidy up.
  await h.js(`(async () => {
    const D = window.DesignLibrary;
    for (const r of await D.summaries()) if (/^Garage /.test(r.title)) await D.remove(r.id, r.revision);
    await D.purge(null);
    const s = document.getElementById('garage-sort'); s.value = 'recent'; s.dispatchEvent(new Event('change'));
  })();`);
  // Sorting reuses the loaded list; opening the page again reads the library afresh.
  await h.waitFor(
    `return (async () => !(await window.DesignLibrary.summaries()).some(r => /^Garage /.test(r.title)))();`,
    'the test tracks to be removed'
  );
  await h.section('builder');
  await h.section('library');
  await h.waitFor(
    `return !document.querySelector('.garage-card h3') ||
    ![...document.querySelectorAll('.garage-card h3')].some(n => /^Garage /.test(n.textContent));`,
    'the tidy-up'
  );
  await h.resize(1440, 900);
});

test('the builder bar holds the tools, and the name field is as wide as the name', async h => {
  await h.section('builder');
  await h.resize(1600, 900);
  const look = () =>
    h.js(`
      const bar = document.querySelector('.projectbar'), input = document.getElementById('track-name');
      return { inBar: !!bar.querySelector('.pb-tools #rotate') && !document.querySelector('.workspace > .toolbar'),
        width: input.getBoundingClientRect().width, overflow: bar.scrollWidth > bar.clientWidth + 1 };`);
  const name = await h.js(`return document.getElementById('track-name').value;`);
  let l = await look();
  assert(l.inBar, 'the tools are not in the top bar');
  assert(!l.overflow, 'the top bar overflows at 1600 px');
  const short = l.width;
  await h.js(`document.getElementById('track-name').value = 'A much longer name for this circuit';`);
  l = await look();
  assert(l.width > short + 40, `the name field did not grow with the name (${short} -> ${l.width})`);
  assert(l.width <= 361, `the name field is wider than its limit (${l.width})`);
  await h.js(`document.getElementById('track-name').value = ${JSON.stringify(name)};`);
  for (const width of [1280, 1000, 900]) {
    await h.resize(width, 800);
    assert(!(await look()).overflow, `the top bar overflows at ${width} px`);
  }
  await h.resize(1440, 900);
});

test('builder layout: facts, Tools menu, inspector rail and hidden sidebars', async h => {
  await h.section('builder');
  await h.resize(1600, 900);
  const facts = await h.text('#track-facts');
  assert(/\d+ pieces · .+ m · \d+ × \d+ mm/.test(facts), `track facts say "${facts}"`);
  // Tools: one grouped menu; choosing a tool closes it.
  await h.click('#tools-menu-button');
  const tools = await h.js(`const m = document.getElementById('tools-menu');
    return { open: !m.hidden, items: [...m.querySelectorAll('[role=menuitem]')].map(b => b.textContent.trim()),
      groups: [...m.querySelectorAll('.menu-label')].map(p => p.textContent) };`);
  assert(tools.open, 'the Tools menu did not open');
  assert(
    tools.items.includes('Find problems…') && tools.items.includes('Measure distance / angle'),
    `items ${tools.items}`
  );
  assert(tools.groups.join() === 'Check,Measure,Selection,Plan,Convert', `groups ${tools.groups}`);
  await h.click('#measure-tool');
  assert(await h.js(`return document.getElementById('tools-menu').hidden;`), 'the menu stayed open');
  assert(
    (await h.js(`return document.getElementById('measure-tool').getAttribute('aria-pressed');`)) === 'true',
    'Measure did not start'
  );
  await h.click('#measure-tool'); // and off again
  assert(
    !(await h.js(`return !!document.querySelector('#planning-tools')?.closest('section')?.offsetParent;`)),
    'the old Planning tools folder still shows'
  );
  // The inspector: one section at a time.
  const shown = () =>
    h.js(
      `return [...document.querySelectorAll('#layout-panel > section')].filter(s => s.offsetParent).map(s => s.id || s.querySelector('details')?.id);`
    );
  await h.click('#insp-parts');
  let s = await shown();
  assert(s.length === 1 && s[0] === 'parts-folder', `Parts list shows ${s}`);
  assert(await h.js(`return document.getElementById('parts-folder').open;`), 'the Parts list folder is closed');
  await h.click('#insp-car');
  assert(
    await h.js(
      `return !document.getElementById('tune-panel').hidden && document.getElementById('layout-panel').hidden;`
    ),
    'Preview car does not show the car settings'
  );
  await h.click('#insp-selection');
  s = await shown();
  assert(s.length === 1 && s[0] === 'inspector-selection', `Selection shows ${s}`);
  // Sidebars: H hides both, H shows both; the buttons hide and show one.
  const width = () => h.js(`return document.getElementById('canvas').getBoundingClientRect().width;`);
  const before = await width();
  await h.js(`document.getElementById('canvas').focus();`);
  await h.key('h');
  await h.sleep(200);
  assert(
    await h.js(
      `const e = document.getElementById('builder-view'); return e.classList.contains('left-off') && e.classList.contains('right-off');`
    ),
    'H did not hide the sidebars'
  );
  assert((await width()) > before + 400, 'the canvas did not get wider');
  await h.key('h');
  await h.click('#hide-pieces');
  assert(
    await h.js(
      `return !document.getElementById('show-pieces').hidden && !document.querySelector('.catalogue-panel').offsetParent;`
    ),
    'Hide the piece list did not hide it'
  );
  await h.click('#show-pieces');
  assert(
    await h.js(`return !!document.querySelector('.catalogue-panel').offsetParent;`),
    'the piece list did not come back'
  );
  await h.resize(1440, 900);
});

test('builder sidebars: pack card, piece options, folder tabs and the track sheet', async h => {
  await h.section('builder');
  await h.resize(1600, 900);
  // The pack card names the pack and opens the pack list; choosing one switches the pieces.
  const before = await h.text('#pack-card-name');
  await h.click('#pack-card');
  await h.waitFor(`return !document.getElementById('pack-menu').hidden;`, 'the pack list');
  const other = await h.js(
    `const b = [...document.querySelectorAll('#pack-menu [role=menuitem]')].find(b => !b.hasAttribute('aria-current') && /Scalextric/.test(b.textContent)); b.click(); return b.textContent;`
  );
  await h.waitFor(
    `return document.getElementById('pack-card-name').textContent !== ${JSON.stringify(before)};`,
    'the new pack'
  );
  assert(other.includes(await h.text('#pack-card-name')), 'the card does not show the chosen pack');
  // Options live behind one button; the badge counts what is on.
  const badge = () =>
    h.js(
      `return document.getElementById('catalogue-filter-count').hidden ? 0 : +document.getElementById('catalogue-filter-count').textContent;`
    );
  const on = await badge();
  await h.click('#catalogue-filter');
  assert(await h.js(`return !document.getElementById('catalogue-filter-menu').hidden;`), 'the options did not open');
  await h.click('#mirror-new');
  assert((await badge()) === on + 1, 'the badge did not count Mirror new pieces');
  await h.click('#mirror-new');
  await h.key('Escape');
  assert(
    await h.js(`return document.getElementById('catalogue-filter-menu').hidden;`),
    'Escape did not close the options'
  );
  // Folder tabs: one folder at a time; a search shows every folder that matches.
  const tabs = await h.js(
    `return [...document.querySelectorAll('#catalogue-tabs [data-folder]')].map(b => b.dataset.folder);`
  );
  assert(tabs.length > 1, `tabs ${tabs}`);
  await h.js(`document.querySelector('#catalogue-tabs [data-folder="Corners"]').click();`);
  assert(
    await h.js(
      `return document.querySelectorAll('#catalogue .catalogue-folder').length === 1 && [...document.querySelectorAll('#catalogue .piece-card strong')].every(n => /curve|corner|hairpin|R\d/i.test(n.textContent));`
    ),
    'Corners did not show only corners'
  );
  await h.js(`const f = document.getElementById('search'); f.value = 'straight'; f.dispatchEvent(new Event('input'));`);
  assert(
    await h.js(
      `return document.getElementById('catalogue-tabs').hidden || !document.querySelectorAll('#catalogue-tabs [data-folder]').length;`
    ),
    'tabs stayed during a search'
  );
  await h.js(`const f = document.getElementById('search'); f.value = ''; f.dispatchEvent(new Event('input'));
    document.querySelector('#catalogue-tabs [data-folder="Straights"]')?.click();`);
  await h.js(
    `document.getElementById('pack').value = 'slotforge.carrera-evolution-digital'; document.getElementById('pack').onchange();`
  );
  // The track sheet: lap per lane for the example, and parts against what you own.
  await h.js(`document.getElementById('demo').click();`);
  if (await h.js(`return document.getElementById('confirm-dialog').open;`)) await h.click('#confirm-go');
  await h.click('#insp-sheet');
  await h.waitFor(`return document.querySelectorAll('#ts-lanes .ts-lane').length >= 2;`, 'lap per lane');
  await h.click('#ts-tab-parts');
  const own = await h.js(`return document.querySelectorAll('#ts-parts-table .ts-own').length;`);
  assert(own > 0, 'no parts to own');
  const need = await h.js(
    `return +document.querySelector('#ts-parts-table .ts-part:not(.ts-part-head) b').textContent;`
  );
  await h.js(
    `const f = document.querySelector('#ts-parts-table .ts-own'); f.value = ${JSON.stringify(String(0))}; f.dispatchEvent(new Event('change'));`
  );
  assert(/buy/.test(await h.text('#ts-tab-parts')), 'the Parts tab does not say what to buy');
  await h.js(
    `const f = document.querySelector('#ts-parts-table .ts-own'); f.value = String(${need}); f.dispatchEvent(new Event('change'));`
  );
  assert(
    /✓/.test(
      await h.js(
        `return document.querySelector('#ts-parts-table .ts-part:not(.ts-part-head) b:last-child').textContent;`
      )
    ),
    'owning enough did not tick the row'
  );
  // A mistyped huge number (found by the random-click run) is kept to 100,000, not an error.
  await h.js(
    `const f = document.querySelector('#ts-parts-table .ts-own'); f.value = '99999999'; f.dispatchEvent(new Event('change'));`
  );
  assert(
    (await h.js(`return document.querySelector('#ts-parts-table .ts-own').value;`)) === '100000',
    'a huge owned count was not kept to 100,000'
  );
  await h.click('#ts-tab-overview');
  await h.click('#insp-selection');
  await h.resize(1440, 900);
});

test('builder tools: recent pieces, zoom to selection, rotate step, undo history, all packs', async h => {
  await h.section('builder');
  await h.js(`localStorage.removeItem('slotforge.recent-pieces.v1');`);
  await h.js(
    `document.getElementById('search').value = ''; document.getElementById('search').dispatchEvent(new Event('input'));`
  );
  const count = () => h.js(`return document.querySelectorAll('#roads > g').length;`);
  const pieces = await count();
  // Adding a piece puts it in Recent; Recent adds it again.
  await h.js(`document.querySelector('#catalogue .piece-card').click();`);
  await h.waitFor(`return document.querySelectorAll('.recent-pieces .recent-piece').length === 1;`, 'the Recent row');
  await h.js(`document.querySelector('.recent-pieces .recent-piece').click();`);
  assert((await count()) === pieces + 2, 'Recent did not add the piece');
  // Zoom to selection: the new piece fills the view (F).
  await h.click('#fit');
  const whole = await h.js(`return document.getElementById('canvas').viewBox.baseVal.width;`);
  await h.js(`document.getElementById('canvas').focus();`);
  await h.key('f');
  const near = await h.js(`return document.getElementById('canvas').viewBox.baseVal.width;`);
  assert(near < whole / 2, `Zoom to selection did not zoom in (${whole} -> ${near})`);
  // Rotate by a chosen step, then undo it from the history.
  const angle = () => h.js(`return +document.getElementById('pos-angle').value;`);
  await h.js(`const f = document.getElementById('rotate-step'); f.value = '45'; f.dispatchEvent(new Event('change'));`);
  const a0 = await angle();
  await h.click('#rotate');
  const a1 = await angle();
  assert(Math.abs(((a1 - a0 + 540) % 360) - 180) === 135 || Math.abs(a1 - a0) === 45, `rotated ${a0} -> ${a1}`);
  await h.click('#undo-history');
  const steps = await h.js(
    `return [...document.querySelectorAll('#undo-menu [role=menuitem]')].map(b => b.textContent);`
  );
  assert(steps[0] === 'Rotated 1 piece' && steps[1] === 'Added 1 piece', `history ${steps}`);
  await h.js(`document.querySelectorAll('#undo-menu [role=menuitem]')[2].click();`);
  assert((await count()) === pieces, 'undoing three steps did not remove both pieces');
  await h.js(`const f = document.getElementById('rotate-step'); f.value = '15'; f.dispatchEvent(new Event('change'));`);
  // Search in every pack: one folder per pack.
  await h.js(`document.getElementById('search').value = 'curve'; document.getElementById('search-all').checked = true;
    document.getElementById('search-all').dispatchEvent(new Event('change'));`);
  const folders = await h.js(`return document.querySelectorAll('#catalogue .catalogue-folder').length;`);
  assert(folders > 3, `All packs found curves in ${folders} packs`);
  await h.js(`document.getElementById('search').value = ''; document.getElementById('search-all').checked = false;
    document.getElementById('search-all').dispatchEvent(new Event('change'));
    localStorage.removeItem('slotforge.recent-pieces.v1');`);
  await h.click('#fit'); // leave the whole track in view for the next tests
});

// Finds a screen point that hits a track piece (or empty canvas when piece is false).
const canvasPoint = (h, piece = true) =>
  h.js(`
    // Whole pixels (mouse events are sent rounded), and the same answer 4 px around the point,
    // so the click cannot land just beside a piece's edge.
    const c = document.getElementById('canvas').getBoundingClientRect(),
      canvas = document.getElementById('canvas');
    const what = (x, y) => {
      const hit = document.elementFromPoint(x, y);
      if (!hit || !canvas.contains(hit)) return undefined;
      return hit.closest('[data-id]')?.getAttribute('data-id') || null;
    };
    for (let y = Math.round(c.top) + 20; y < c.bottom - 20; y += 9)
      for (let x = Math.round(c.left) + 20; x < c.right - 20; x += 9) {
        const id = what(x, y);
        if (id === undefined || !!id !== ${piece}) continue;
        if ([[4, 0], [-4, 0], [0, 4], [0, -4]].every(([dx, dy]) => what(x + dx, y + dy) === id)) return { x, y, id };
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

// ---------------------------------------------------------------- type

test('titles use the bundled Barlow Condensed and data numbers Roboto Mono', async h => {
  const r = await h.js(`
    await Promise.all([document.fonts.load('italic 700 20px "SF Barlow Condensed"'), document.fonts.load('500 14px "SF Roboto Mono"')]);
    const loaded = name => [...document.fonts].some(f => f.family.replace(/"/g, '') === name && f.status === 'loaded');
    const font = sel => getComputedStyle(document.querySelector(sel)).fontFamily;
    return { barlow: loaded('SF Barlow Condensed'), mono: loaded('SF Roboto Mono'),
      title: font('#builder-view h2'), number: font('#length-total'), body: font('#status'),
      eyebrow: font('.inspector-overview > h2') };`);
  assert(r.barlow && r.mono, `fonts did not load from the app (${JSON.stringify(r)})`);
  assert(/Barlow/.test(r.title) && /Roboto Mono/.test(r.number), `wrong fonts: ${JSON.stringify(r)}`);
  assert(
    !/Barlow|Roboto/.test(r.body) && !/Barlow/.test(r.eyebrow),
    `text or eyebrow changed font: ${JSON.stringify(r)}`
  );
});

test('every page shows at most one main (red) button', async h => {
  const extra = [];
  for (const page of ['builder', 'routed', 'library', 'packs', 'export', 'settings']) {
    await h.section(page);
    const shown = await h.js(`
      return [...document.querySelectorAll('.btn.primary')]
        .filter(b => !b.closest('dialog') && b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden')
        .map(b => b.textContent.trim());`);
    if (shown.length > 1) extra.push(`${page}: ${shown.join(' / ')}`);
  }
  assert(!extra.length, `more than one main button: ${extra.join('; ')}`);
});

test('Settings dashboard: every card, the colour editor, building preferences and a backup', async h => {
  await h.section('settings');
  await h.resize(1600, 900);
  const cards = await h.js(
    `return [...document.querySelectorAll('#settings-dashboard > .sd-card:not([hidden]) h2')].map(e => e.textContent);`
  );
  for (const name of ['Look', 'Units', 'Your saved work', 'Updates', 'Building', 'Shortcuts', 'About Circuit'])
    assert(cards.includes(name), `no ${name} card (${cards})`);
  assert(
    await h.js(`return document.querySelectorAll('#sd-look [data-pick-theme]').length > 4;`),
    'no theme presets in Look'
  );
  // Your own colours opens the colour editor under Look, and closes it again.
  await h.click('#sd-colours-toggle');
  assert(
    await h.js(
      `return !document.getElementById('sd-colours').hidden && !!document.querySelector('#sd-colours #theme-colors');`
    ),
    'the colour editor did not open'
  );
  await h.click('#sd-colours-toggle');
  assert(await h.js(`return document.getElementById('sd-colours').hidden;`), 'the colour editor did not close');
  // Rotate step follows into the builder; FreeForm snap and the welcome window are switches.
  const was = await h.js(`return document.getElementById('rotate-step').value;`);
  await h.js(
    `[...document.querySelectorAll('#sd-building [aria-label="Rotate step"] button')].find(b => b.textContent === '45°').click();`
  );
  assert(
    (await h.js(`return document.getElementById('rotate-step').value;`)) === '45',
    'the rotate step did not change'
  );
  const snap = await h.js(`return document.getElementById('ff-snap').getAttribute('aria-pressed');`);
  await h.click('#sd-ff-snap');
  assert(
    (await h.js(`return document.getElementById('ff-snap').getAttribute('aria-pressed');`)) !== snap,
    'snap did not follow'
  );
  await h.click('#sd-ff-snap');
  const seen = await h.js(`return localStorage.getItem('slotforge.welcome.v1');`);
  await h.click('#sd-welcome');
  assert(
    (await h.js(`return localStorage.getItem('slotforge.welcome.v1');`)) !== seen,
    'the welcome switch did nothing'
  );
  await h.click('#sd-welcome');
  await h.js(
    `const f = document.getElementById('rotate-step'); f.value = ${JSON.stringify(was)}; f.dispatchEvent(new Event('change'));`
  );
  // Save backup downloads the workspace and shows when.
  const downloads = [];
  const listen = (_e, item) => downloads.push(item.getFilename());
  require('electron').session.defaultSession.on('will-download', listen);
  try {
    await h.click('#sd-backup');
    for (let i = 0; i < 50 && !downloads.length; i++) await h.sleep(100);
    assert(
      downloads.some(n => /workspace-backup\.json$/.test(n)),
      `no backup downloaded (${downloads})`
    );
    await h.waitFor(
      `return /last backup just now/.test(document.getElementById('sd-work-facts').textContent);`,
      'the backup time'
    );
  } finally {
    require('electron').session.defaultSession.removeListener('will-download', listen);
  }
  // More… opens the storage window.
  await h.click('#sd-storage-more');
  assert(await h.js(`return document.getElementById('storage-dialog').open;`), 'More… did not open the storage window');
  await h.js(`document.getElementById('storage-dialog').close();`);
  await h.resize(1440, 900);
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

test('Routed Wood bench: starting profiles, a live cross-section, grouped fields and the build facts', async h => {
  await h.section('routed');
  const slots = () => h.js(`return document.querySelectorAll('#rb-section .rb-cut').length;`);
  const before = await h.js(`return document.querySelector('#routed-profile-form [name=laneCount]').value;`);
  // Four groups with summaries; five layout tiles.
  const shape = await h.js(`return {
    groups: [...document.querySelectorAll('#routed-groups .rb-group > summary b')].map(b => b.textContent),
    tiles: document.querySelectorAll('#rb-start .rb-tile').length };`);
  assert(shape.groups.join() === 'Lanes,Slot,Conductors,Board', `groups ${shape.groups}`);
  assert(shape.tiles === 5, `${shape.tiles} start tiles`);
  // Club 1:32 fills four lanes; the drawing and the summary follow before Apply.
  await h.click('[data-preset="club"]');
  assert((await slots()) === 4, 'the cross-section does not show four slots');
  assert(/^4 lanes/.test(await h.text('[data-group="lanes"] .rb-summary')), 'the lanes summary did not follow');
  assert(
    await h.js(
      `return document.querySelector('[data-preset="club"]').getAttribute('aria-pressed') === 'true' && !document.getElementById('rb-pending').hidden;`
    ),
    'Club is not marked, or Not applied yet is missing'
  );
  // Typing a value updates the drawing too.
  await h.js(
    `const f = document.querySelector('#routed-profile-form [name=laneCount]'); f.value = '3'; f.dispatchEvent(new Event('input', { bubbles: true }));`
  );
  assert((await slots()) === 3, 'typing 3 lanes did not redraw');
  // A mistyped lane count (found by the random-click run) used to draw that many slots and run
  // the page out of memory; now the drawing waits for a valid 1–8.
  for (const typo of ['99999999', '0', '2.5', '-3']) {
    const started = Date.now();
    await h.js(
      `const f = document.querySelector('#routed-profile-form [name=laneCount]'); f.value = ${JSON.stringify(typo)}; f.dispatchEvent(new Event('input', { bubbles: true }));`
    );
    assert(Date.now() - started < 2000, `typing ${typo} lanes took ${Date.now() - started} ms`);
    assert((await slots()) === 0, `${typo} lanes still drew slots`);
    assert(/Enter the profile/.test(await h.text('#rb-section')), `${typo} lanes: no "Enter the profile" message`);
  }
  assert(
    await h.js(`return document.querySelector('[data-preset="club"]').getAttribute('aria-pressed') === 'false';`),
    'Club still marked after a change'
  );
  // Apply with a wrong value in a folded group unfolds that group to show it (it used to do nothing).
  await h.js(`
    const f = document.querySelector('#routed-profile-form [name=laneCount]'); f.value = '2'; f.dispatchEvent(new Event('input', { bubbles: true }));
    const g = document.querySelector('[data-group="lanes"]'); g.open = false;
    const s = document.querySelector('#routed-profile-form [name=laneSpacingMm]'); s.dataset.was = s.value; s.value = '';
    document.querySelector('#routed-profile-form button[type=submit]').click();`);
  await h.sleep(150);
  assert(
    await h.js(`return document.querySelector('[data-group="lanes"]').open;`),
    'Apply did not unfold the group with the empty field'
  );
  await h.js(
    `const s = document.querySelector('#routed-profile-form [name=laneSpacingMm]'); s.value = s.dataset.was; s.dispatchEvent(new Event('input', { bubbles: true }));`
  );
  // Back to the start values without applying.
  await h.js(
    `const f = document.querySelector('#routed-profile-form [name=laneCount]'); f.value = ${JSON.stringify(before)}; f.dispatchEvent(new Event('input', { bubbles: true }));`
  );
  await h.section('builder');
  await h.section('routed');
  assert(
    await h.js(`return document.getElementById('rb-pending').hidden;`),
    'Not applied yet stayed after coming back'
  );
  // The routed oval fills Your build.
  await h.click('#routed-example');
  if (await h.js(`return document.getElementById('confirm-dialog').open;`)) await h.click('#confirm-go');
  await h.section('routed');
  await h.waitFor(
    `return [...document.querySelectorAll('#routed-materials .routed-metric')].some(r => /Total slot length/.test(r.textContent) && !/ 0\.00 m/.test(r.textContent));`,
    'slot length in Your build'
  );
  assert(/Slot cutter/.test(await h.text('#routed-materials')), 'no slot cutter in Your build');
  await h.js(`document.getElementById('demo').click();`);
  if (await h.js(`return document.getElementById('confirm-dialog').open;`)) await h.click('#confirm-go');
  await h.section('builder');
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
  // Let the builder settle first: after another page was shown, it re-fits the track on its
  // first frame, which in the hidden test window can land after the zoom click and undo it.
  await h.section('builder');
  await h.js(`await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));`);
  await h.js(`window.__first = document.querySelector('#roads > g');`);
  const radius = await h.js(`return +document.querySelector('#ports circle')?.getAttribute('r') || null;`);
  await h.click('#zoom-in');
  assert(await h.js(`return document.querySelector('#roads > g') === window.__first;`), 'zoom redrew the pieces');
  const zoomed = await h.js(`return +document.querySelector('#ports circle')?.getAttribute('r') || null;`);
  const where = await h.js(
    `return { section: document.body.dataset.section, canvas: document.getElementById('canvas').clientWidth, zoom: document.getElementById('zoom-level')?.textContent, box: document.getElementById('canvas').getAttribute('viewBox') };`
  );
  assert(
    radius === null || zoomed < radius,
    `connector dots did not shrink with zoom (${radius} -> ${zoomed}; ${JSON.stringify(where)})`
  );
  // Drag the last piece away with real mouse input; it moves, the other pieces stay the same elements.
  // GitHub's macOS machines do not deliver simulated mouse drags to the hidden test window.
  if (process.platform === 'darwin' && process.env.GITHUB_ACTIONS) {
    console.log('    (drag part skipped on GitHub macOS: simulated mouse drags are not delivered there)');
    return;
  }
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
  // Drag well towards the middle of the canvas, beyond the snap distance, so Snap cannot pull it back.
  const [dx, dy] = await h.js(`
    const c = document.getElementById('canvas').getBoundingClientRect();
    const vx = c.left + c.width / 2 - ${spot[0]}, vy = c.top + c.height / 2 - ${spot[1]}, d = Math.hypot(vx, vy);
    return d > 260 ? [(vx / d) * 260, (vy / d) * 260] : [-180, -140];`);
  await h.mouse('mouseDown', spot[0], spot[1]);
  for (let i = 1; i <= 10; i++)
    await h.mouse('mouseMove', spot[0] + (dx * i) / 10, spot[1] + (dy * i) / 10, { button: 'left' });
  await h.mouse('mouseUp', spot[0] + dx, spot[1] + dy);
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

test('Print Shop: formats preview and save, packs and backups have their own file, and dropped files are reviewed', async h => {
  const downloads = [];
  const listen = (_e, item) => downloads.push(item.getFilename());
  require('electron').session.defaultSession.on('will-download', listen);
  const tab = f => h.js(`document.querySelector('#shop-formats [data-format="${f}"]').click();`);
  const waitDownload = async (ext, label) => {
    for (let i = 0; i < 100 && !downloads.some(n => n.endsWith(ext)); i++) await new Promise(r => setTimeout(r, 100));
    assert(
      downloads.some(n => n.endsWith(ext)),
      `${label}: no ${ext} downloaded (${downloads.join(', ')})`
    );
  };
  try {
    await h.section('export');
    await h.js(`document.querySelector('#shop-sources [data-choice="current"]').click();`);
    await h.waitFor(`return !document.getElementById('shop-save').disabled;`, 'the bench track to load');
    // PDF: a page preview that follows the orientation, and Save PDF downloads it.
    await tab('pdf');
    assert(
      await h.js(`return !!document.querySelector('#shop-stage .shop-paper.portrait svg');`),
      'no PDF page preview'
    );
    await h.js(`document.querySelector('[data-shop-option="orientation"]:last-child').click();`);
    assert(
      await h.js(`return !!document.querySelector('#shop-stage .shop-paper.landscape');`),
      'landscape did not show'
    );
    await h.click('#shop-save');
    await waitDownload('.pdf', 'Save PDF');
    await h.js(`document.querySelector('[data-shop-option="orientation"]').click();`);
    // Picture: size changes the pixels; Copy shows only here.
    await tab('png');
    const large = await h.text('#shop-meta');
    await h.js(`document.querySelector('[data-shop-option="size"]').click();`);
    const small = await h.text('#shop-meta');
    assert(large !== small && /^\d+ × \d+ px/.test(small), `picture sizes: ${large} / ${small}`);
    assert(!(await h.js(`return document.getElementById('shop-copy').hidden;`)), 'Copy to clipboard is missing');
    await h.click('#shop-save');
    await waitDownload('.png', 'Save PNG');
    await h.js(`document.querySelectorAll('[data-shop-option="size"]')[1].click();`);
    // Parts list and track file.
    await tab('csv');
    assert(await h.js(`return document.querySelectorAll('#shop-stage .shop-table tr').length > 1;`), 'no parts table');
    await h.click('#shop-save');
    await waitDownload('.csv', 'Save CSV');
    await tab('slotforge');
    assert(/slotforge\.json/.test(await h.text('#shop-stage')), 'no track file card');
    assert(await h.js(`return document.getElementById('shop-copy').hidden;`), 'Copy shows outside Picture');
    // A pack: one tab, its own file.
    await h.js(`document.querySelector('#shop-sources [data-choice^="pack:"]').click();`);
    await h.waitFor(
      `return [...document.querySelectorAll('#shop-formats [data-format]')].map(b => b.dataset.format).join() === 'pack';`,
      'the pack file tab'
    );
    await h.click('#shop-save');
    await waitDownload('.track-pack.json', 'Save pack file');
    // The whole workspace.
    await h.js(`document.querySelector('#shop-sources [data-choice="backup"]').click();`);
    await h.waitFor(
      `return /tracks? from your Track Library/.test(document.getElementById('shop-stage').textContent);`,
      'the backup contents'
    );
    // Drop a track file: it is reviewed first; Add to library keeps the builder as it is.
    const before = await h.js(`return (await window.DesignLibrary.summaries()).length;`);
    const name = await h.js(`return document.getElementById('track-name').value;`);
    const dropped = {
      ...require('../app/integration.js').prepare(
        require('../integration/slotforge-timing/fixtures/01-closed-oval.slotforge.json')
      ),
      title: 'Dropped track',
    };
    await h.js(`(async () => {
      const raw = ${JSON.stringify(dropped)};
      const dt = new DataTransfer();
      dt.items.add(new File([JSON.stringify(raw)], 'Dropped track.slotforge.json', { type: 'application/json' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    })();`);
    await h.waitFor(`return document.getElementById('import-review').open;`, 'the review window');
    assert((await h.text('#import-review-title')) === 'Dropped track', 'the review shows another title');
    await h.js(
      `[...document.querySelectorAll('#import-review-actions button')].find(b => b.textContent === 'Add to library').click();`
    );
    await h.waitFor(`return !document.getElementById('import-review').open;`, 'the review to close');
    await h.waitFor(
      `return (async () => (await window.DesignLibrary.summaries()).length === ${before + 1})();`,
      'the dropped track in the library'
    );
    assert(
      (await h.js(`return document.getElementById('track-name').value;`)) === name,
      'Add to library changed the builder'
    );
    // Tidy up.
    await h.js(`(async () => { const D = window.DesignLibrary;
      for (const r of await D.summaries()) if (r.title === 'Dropped track') await D.remove(r.id, r.revision);
      await D.purge(null); })();`);
    await h.js(`document.querySelector('#shop-sources [data-choice="current"]').click();`);
    await tab('pdf');
  } finally {
    require('electron').session.defaultSession.removeListener('will-download', listen);
  }
});

// ---------------------------------------------------------------- updates

test("a newer release opens the update window: What's new, Skip, and Download into Downloads", async h => {
  const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path'),
    crypto = require('node:crypto');
  const u = h.context.updateCheck;
  const real = { fetch: u.fetch, downloads: u.downloads, edition: u.edition };
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'circuit-downloads-'));
  const bytes = Buffer.from('a pretend installer');
  let tag = 'v9.9.0';
  const name = () => `SlotForgeCircuit-${tag.slice(1)}-Setup-x64.exe`;
  u.edition = { platform: 'win32', arch: 'x64' };
  u.downloads = folder;
  u.fetch = async url =>
    url.includes('/releases/download/')
      ? {
          ok: true,
          status: 200,
          body: {
            getReader: () => {
              const parts = [bytes];
              return { read: async () => (parts.length ? { done: false, value: parts.shift() } : { done: true }) };
            },
          },
        }
      : {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              tag_name: tag,
              draft: false,
              prerelease: false,
              published_at: '2026-01-01T00:00:00Z',
              body: "Intro.\n\n## What's new\n\n- **More lanes:** up to 8 cars.\n\n## Verification\n\n- tests",
              assets: [
                {
                  name: name(),
                  size: bytes.length,
                  digest: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex'),
                },
              ],
            }),
        };
  const dialog = () =>
    h.js(`const d = document.getElementById('update-dialog');
      return d && { open: d.open, title: d.querySelector('h2')?.textContent, news: d.querySelector('.update-news')?.textContent,
        text: d.textContent, buttons: [...d.querySelectorAll('.dialog-actions button')].map(b => b.textContent) };`);
  try {
    // At start: the check opens the window by itself.
    await u.check(); // what the check at start does (it is off in automated runs)
    await h.waitFor(`return document.getElementById('update-dialog')?.open;`, 'the update window');
    let d = await dialog();
    assert(d.title === 'Circuit 9.9.0', `title "${d.title}"`);
    assert(/More lanes: up to 8 cars\./.test(d.news) && !/tests/.test(d.news), `What's new "${d.news}"`);
    assert(/Windows · installer/.test(d.text), 'the window does not say which copy this is');
    assert(!/null|undefined/.test(d.text), `stray words in the window: ${d.text}`);
    assert(d.buttons.join() === 'Skip this version,Download', `buttons ${d.buttons}`);
    await h.shot('update-window');
    if (process.env.SLOTFORGE_UI_SHOTS) {
      await h.click('[data-theme-choice="light"]');
      await h.shot('update-window-light');
      await h.click('[data-theme-choice="dark"]');
    }
    // Download: saved in the Downloads folder and checked; Show in folder is offered.
    await h.click('#update-download');
    await h.waitFor(`return !!document.getElementById('update-show');`, 'the finished download');
    assert(fs.readFileSync(path.join(folder, name())).equals(bytes), 'the downloaded file is not the release file');
    assert(/Saved in Downloads/.test((await dialog()).text), 'no saved message');
    await h.shot('update-saved');
    await h.js(`document.getElementById('update-dialog').close();`);
    // Closed: it stays away for this session. (A new start forgets the finished download.)
    await h.reload('settings');
    u.download = { state: 'idle' };
    assert(/Version 9\.9\.0 is available/.test(await h.text('.update-card')), 'Settings does not show the new version');
    // Check now shows the window again; Skip keeps it away until a newer version.
    await h.click('#update-check-now');
    await h.waitFor(`return document.getElementById('update-dialog')?.open;`, 'the window from Check now');
    await h.click('#update-skip');
    await h.waitFor(`return !document.getElementById('update-dialog')?.open;`, 'the window to close after Skip');
    await h.reload('settings');
    await u.check(); // what the check at start does (it is off in automated runs)
    await h.sleep(600);
    assert(!(await h.js(`return !!document.getElementById('update-dialog')?.open;`)), 'a skipped version came back');
    tag = 'v9.9.1';
    await u.check(); // what the check at start does (it is off in automated runs)
    await h.waitFor(
      `return /9\\.9\\.1/.test(document.getElementById('update-dialog')?.open && document.querySelector('#update-dialog h2').textContent);`,
      'the window for the newer version'
    );
    await h.js(`document.getElementById('update-dialog').close();`);
  } finally {
    Object.assign(u, real);
    u.download = { state: 'idle' };
    fs.rmSync(folder, { recursive: true, force: true });
    // Leave the profile as a fresh install would have it.
    fs.rmSync(path.join(h.context.app.getPath('userData'), 'update-check.json'), { force: true });
    Object.assign(u.state, u.load());
  }
});

// ---------------------------------------------------------------- live preview (last: replaces the track)

test('Live preview drives one car per lane', async h => {
  // Routed example layouts, opened as a double-clicked file would be.
  const open = async name => {
    h.context.trackFiles.deliver(
      require('node:path').join(__dirname, '..', 'integration/slotforge-timing/routed-examples', name)
    );
    await h.waitFor(`return document.getElementById('confirm-dialog').open;`, 'replace confirmation');
    await h.click('#confirm-go');
    await h.waitFor(`return !document.getElementById('confirm-dialog').open;`, name);
  };
  const play = async () => {
    await h.click('#play');
    await h.waitFor(`return document.querySelectorAll('#cars .car').length > 0;`, 'cars on the track');
    const colours = await h.js(
      `return [...document.querySelectorAll('#cars .car')].map(c => c.innerHTML.match(/#(?:ec6167|66b4e7|5cc46a|f2c94c|f2994a|a77ce8|4fd1c5|f07cb8)/i)?.[0]);`
    );
    await h.click('#play');
    return colours;
  };
  await open('closed-routed-oval.slotforge.json');
  const two = await play();
  assert(two.length === 2, `the 2-lane oval showed ${two.length} cars`);
  await open('closed-tabletop-track.slotforge.json');
  const four = await play();
  assert(four.length === 4, `the 4-lane track showed ${four.length} cars`);
  assert(new Set(four).size === 4, `cars share colours: ${four.join(', ')}`);
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
  // desktop/monkey-runner.cjs: a random-click run instead of the tests.
  if (process.env.SLOTFORGE_MONKEY) return require('./monkey.cjs').run(h, win, context);
  const only = process.env.SLOTFORGE_UI_ONLY;
  for (const t of tests) {
    if (only && !only.split('|').some(part => t.name.includes(part))) continue; // several names: a|b
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
