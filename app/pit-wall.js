// Pit Wall (SlotForge Restyle): the main menu as one slim bar that never wraps. The page
// links sit in two groups on a dark track (Design · Files), each with a line picture; the
// open one is lifted with its picture in the accent. A status light says where Circuit
// saves (hover for the words, click for the storage details).
//
// The bar measures itself: when it does not fit, it takes the steps below one by one
// until it does (classes pw-t1 … pw-t7 on the header):
//   1 no version   2 no slogan   3 the light without words   4 theme and Settings as pictures
//   5 no wordmark  6 tab names small under their pictures   7 tighter, then 8 pictures alone
(function (root) {
  'use strict';
  const ICONS = {
    builder: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M8 7v10M16 7v10"/>',
    routed: '<path d="M4 18a8 8 0 0 1 16 0"/><path d="M8 18a4 4 0 0 1 8 0"/>',
    freeform: '<path d="M4 18c3-9 6 2 9-6s5-3 7-6"/><circle cx="4" cy="18" r="1.5"/><circle cx="20" cy="6" r="1.5"/>',
    library: '<path d="M4 4h5v16H4zM10 4h5v16h-5z"/><path d="m16 5 4 1-3 14-4-1"/>',
    packs: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
    export: '<path d="M7 4v12M3 12l4 4 4-4"/><path d="M17 20V8M13 12l4-4 4 4"/>',
  };
  const GROUPS = [
    { label: 'Design', sections: ['builder', 'routed', 'freeform'] },
    { label: 'Files', sections: ['library', 'packs', 'export'] },
  ];
  const STEPS = 8;
  const svg = name =>
    `<svg class="pw-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  function mount(header = document.querySelector('.sf-header')) {
    const nav = header?.querySelector('nav');
    if (!nav || header.classList.contains('pitwall')) return null;
    let busy = false; // declared first: the status light below already asks the bar to fit
    header.classList.add('pitwall');

    for (const group of GROUPS) {
      const box = document.createElement('div');
      box.className = 'pw-grp';
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', group.label);
      for (const key of group.sections) {
        const a = nav.querySelector(`.sf-nav-link[data-section="${key}"]`);
        if (!a) continue;
        const text = a.textContent.trim();
        a.title = text;
        a.innerHTML = `${svg(key)}<span class="pw-name"></span>`;
        a.querySelector('.pw-name').textContent = text;
        box.append(a);
      }
      if (box.children.length) nav.append(box);
    }

    // The status light follows the Storage button in the status bar: app.js gives it a
    // data-storage of disk, browser, unavailable or stopped (none yet while connecting).
    const tools = header.querySelector('.sf-header-tools');
    const source = document.getElementById('storage-open');
    let light = null;
    const LIGHT = {
      disk: ['good', 'Saved on disk'],
      browser: ['warn', 'Saved in browser'],
      unavailable: ['bad', 'Storage unavailable'],
      stopped: ['bad', 'Storage stopped'],
    };
    if (tools && source) {
      light = document.createElement('button');
      light.type = 'button';
      light.id = 'pw-storage';
      light.className = 'pw-light';
      light.innerHTML = '<i aria-hidden="true"></i><span class="pw-light-text"></span>';
      light.onclick = () => source.click();
      tools.prepend(light);
      const sync = () => {
        const [state, say] = LIGHT[source.dataset.storage] || ['busy', 'Connecting…'];
        light.dataset.state = state;
        light.querySelector('.pw-light-text').textContent = say;
        light.title = `${say} · click for the storage details`;
        light.setAttribute('aria-label', `Storage: ${say}`);
      };
      new MutationObserver(sync).observe(source, { attributes: true, attributeFilter: ['data-storage'] });
      sync();
    }

    function fits() {
      return header.scrollWidth <= header.clientWidth + 1 && nav.scrollWidth <= nav.clientWidth + 1;
    }
    function fit() {
      if (busy) return;
      busy = true;
      for (let i = 1; i <= STEPS; i++) header.classList.remove(`pw-t${i}`);
      let step = 0;
      while (!fits() && step < STEPS) header.classList.add(`pw-t${++step}`);
      header.dataset.fit = String(step);
      busy = false;
    }
    // Measure again when the bar changes size or its words change (the version, the light,
    // a label), at most once per batch of changes. Its own step classes are not watched.
    let queued = false;
    const later = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        fit();
      });
    };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(later).observe(header);
    new MutationObserver(later).observe(header, { childList: true, characterData: true, subtree: true });
    document.fonts?.ready?.then(later);
    fit();
    return { fit, light };
  }

  root.PitWall = { mount };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount());
    else mount();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
