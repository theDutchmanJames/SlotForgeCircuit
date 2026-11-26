// Builder layout: rearranges the Track Builder once the app has built it.
//  - Tools menu: the planning tools as one grouped menu in the top bar (Check, Measure, Plan …).
//  - Inspector rail: the right sidebar as a column of pictures with one section at a time.
//  - Sidebars: hide the piece list and the inspector, alone or together (full canvas, H).
// The existing elements are moved, not rebuilt, so the code that fills them keeps working.
(function (root) {
  'use strict';
  const $ = id => document.getElementById(id);
  const ICONS = {
    pointer: '<path d="M6 3l12 9-5 1 3 6-3 1-3-6-4 4z"/>',
    sheet: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    stairs: '<path d="M3 20h5v-5h5v-5h5V5h3"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
    ruler: '<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    route:
      '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6a4 4 0 0 0 0-8h-4a4 4 0 0 1 0-8h6"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h1M4 12h1M4 18h1"/>',
    car: '<path d="M5 16h14l-1.5-5a2 2 0 0 0-2-1.5h-7a2 2 0 0 0-2 1.5z"/><circle cx="8" cy="17" r="1.6"/><circle cx="16" cy="17" r="1.6"/>',
    hideLeft: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="m15 10-2 2 2 2"/>',
    hideRight: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/><path d="m9 10 2 2-2 2"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  };
  const icon = (name, cls = 'bl-ico') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  const load = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const store = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  };

  // ---------------------------------------------------------------- Tools menu

  const GROUPS = [
    ['Check', ['Find problems…', 'Gap assistant…', 'Car clearance envelope…', 'Curvature colours']],
    ['Measure', ['Measure distance / angle', 'Saved measurements…']],
    ['Selection', ['Replace piece…', 'Ramp across selection…']],
    ['Plan', ['Owned pieces / shopping list…', 'Reference image…']],
    ['Convert', ['Convert routed layout to FreeForm…']],
  ];

  function toolsMenu() {
    const folder = $('planning-tools'),
      content = folder?.querySelector('.planning-tools-content'),
      tools = document.querySelector('.pitboard .pb-tools');
    if (!content || !tools || $('tools-menu')) return;
    const anchor = document.createElement('div');
    anchor.className = 'menu-anchor pb-tools-menu';
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'tools-menu-button';
    button.className = 'btn';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'tools-menu');
    button.title = 'Check, measure and plan the track';
    button.innerHTML = '<span class="pb-word-always">Tools</span> <span aria-hidden="true">▾</span>';
    const menu = document.createElement('div');
    menu.id = 'tools-menu';
    menu.className = 'menu-popover tools-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-labelledby', 'tools-menu-button');
    menu.hidden = true;
    const all = [...document.querySelectorAll('#planning-tools button, .selection-tools button')];
    const find = text => all.find(b => b.textContent.trim() === text);
    for (const [label, names] of GROUPS) {
      const found = names.map(find).filter(Boolean);
      if (!found.length) continue;
      const head = document.createElement('p');
      head.className = 'menu-label';
      head.textContent = label;
      menu.append(head);
      for (const original of found) {
        // Selection tools stay with the selection too: the menu item stands in for them.
        const inSelection = !!original.closest('.selection-tools');
        const item = inSelection ? document.createElement('button') : original;
        if (inSelection) {
          item.type = 'button';
          item.textContent = original.textContent;
          item.onclick = () => original.click();
        }
        item.className = '';
        item.setAttribute('role', 'menuitem');
        if (/Convert routed/.test(item.textContent))
          item.title =
            'For continuous spacing and smooth joins on routed sections. It has a preview and can be undone.';
        menu.append(item);
      }
    }
    anchor.append(button, menu);
    tools.append(anchor);
    // Choosing an item closes the menu (the tools open their own windows or modes).
    menu.addEventListener('click', e => {
      if (e.target.closest('[role="menuitem"]')) {
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      }
    });
    root.Menus?.attach(button, menu);
    // The curvature key floats over the canvas while curvature colours are on.
    const legend = [...content.querySelectorAll('p.fine')].find(p => /Slot radius/.test(p.textContent));
    if (legend) {
      legend.classList.add('curvature-legend-float');
      document.querySelector('#builder-view .canvas-wrap')?.append(legend);
    }
    folder.closest('section')?.classList.add('rail-gone');
  }

  // ---------------------------------------------------------------- Inspector rail

  let rail = null;
  function inspectorRail() {
    const insp = document.querySelector('#builder-view .inspector');
    if (!insp || insp.classList.contains('has-insp-rail')) return null;
    const sec = sel => insp.querySelector(sel)?.closest('section');
    const items = [
      { key: 'sheet', text: 'Track sheet', icon: 'sheet', el: $('track-sheet') },
      { key: 'selection', text: 'Selected piece', icon: 'pointer', el: $('inspector-selection') },
      { key: 'heights', text: 'Heights and bridges', icon: 'stairs', el: sec('#height-folder') },
      { key: 'timing', text: 'Timing line and direction', icon: 'flag', el: sec('#timing-folder') },
      { key: 'power', text: 'Power taps', icon: 'bolt', el: sec('#power-folder') },
      { key: 'lengths', text: 'Lengths and lanes', icon: 'ruler', el: sec('#measurements-folder') },
      { key: 'routed', text: 'Routed materials and checks', icon: 'route', el: $('routed-overview') },
      { key: 'parts', text: 'Parts list', icon: 'list', el: sec('#parts-folder') },
      { key: 'car', text: 'Preview car and lap times', icon: 'car', el: $('tune-panel'), tune: true },
    ].filter(i => i.el);
    const layout = $('layout-panel');
    // Sections not in the rail (the overview moved to the top bar) are left out.
    for (const s of layout.querySelectorAll(':scope > section'))
      if (!items.some(i => i.el === s)) s.classList.add('rail-gone');
    document.querySelector('.inspector-tabs')?.classList.add('rail-gone');

    insp.classList.add('has-insp-rail');
    const body = document.createElement('div');
    body.className = 'insp-body';
    body.append(...insp.childNodes);
    const nav = document.createElement('nav');
    nav.className = 'insp-rail';
    nav.setAttribute('aria-label', 'Inspector sections');
    const hide = document.createElement('button');
    hide.type = 'button';
    hide.className = 'insp-rail-btn insp-hide';
    hide.id = 'hide-inspector';
    hide.title = 'Hide the inspector';
    hide.setAttribute('aria-label', 'Hide the inspector');
    hide.innerHTML = icon('hideRight');
    const list = document.createElement('div');
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-orientation', 'vertical');
    nav.append(list, hide);
    insp.append(nav, body);

    const buttons = new Map();
    for (const item of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'insp-rail-btn';
      b.id = `insp-${item.key}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-label', item.text);
      b.title = item.text;
      b.innerHTML = icon(item.icon);
      b.onclick = () => select(item.key, true);
      b.onkeydown = e => {
        const shown = items.filter(i => !buttons.get(i.key).hidden).map(i => i.key);
        const at = shown.indexOf(item.key);
        const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: shown.length - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        const key = shown[(next + shown.length) % shown.length];
        select(key, true);
        buttons.get(key).focus();
      };
      buttons.set(item.key, b);
      list.append(b);
    }
    // The routed section only exists for routed layouts.
    const routed = items.find(i => i.key === 'routed');
    const followRouted = () => {
      if (!routed) return;
      buttons.get('routed').hidden = routed.el.hidden;
      if (routed.el.hidden && active === 'routed') select('selection');
    };
    if (routed)
      new MutationObserver(followRouted).observe(routed.el, { attributes: true, attributeFilter: ['hidden'] });
    // In the rail a section is always open: its folder heading is a title, not a switch.
    insp.addEventListener('click', e => {
      const summary = e.target.closest('summary');
      if (summary && summary.parentElement.matches('.inspector-folder')) e.preventDefault();
    });

    let active = null;
    function select(key, fromUser = false) {
      const item = items.find(i => i.key === key && !buttons.get(i.key).hidden) || items[0];
      active = item.key;
      if (item.tune) $('tab-tune')?.click();
      else $('tab-layout')?.click();
      for (const i of items) if (!i.tune) i.el.classList.toggle('rail-off', i !== item);
      for (const folder of item.el.querySelectorAll('details.inspector-folder')) folder.open = true;
      for (const [k, b] of buttons) {
        b.setAttribute('aria-selected', String(k === active));
        b.tabIndex = k === active ? 0 : -1;
      }
      if (fromUser) body.scrollTop = 0;
      store('slotforge.inspector-rail.v1', active);
      return active;
    }
    followRouted();
    select(load('slotforge.inspector-rail.v1', 'sheet'));
    // Shows the rail section that holds an element (for example a folder opened from a menu).
    const reveal = id => {
      const target = $(id),
        item = target && items.find(i => i.el.contains(target));
      if (item) select(item.key);
    };
    rail = { select, reveal, current: () => active, nav, body, hide };
    return rail;
  }

  // ---------------------------------------------------------------- Sidebars

  let panels = null;
  function sidebars() {
    const editor = $('builder-view'),
      canvas = editor?.querySelector('.canvas-wrap');
    if (!editor || !canvas || panels) return panels;
    const state = Object.assign({ left: true, right: true }, load('slotforge.builder-panels.v1', {}));
    const edge = (side, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `edge-tab edge-${side}`;
      b.id = `show-${side === 'left' ? 'pieces' : 'inspector'}`;
      b.setAttribute('aria-label', label);
      b.title = label;
      b.textContent = side === 'left' ? '›' : '‹';
      canvas.append(b);
      return b;
    };
    const showLeft = edge('left', 'Show the piece list'),
      showRight = edge('right', 'Show the inspector');
    const hideLeft = document.createElement('button');
    hideLeft.type = 'button';
    hideLeft.id = 'hide-pieces';
    hideLeft.className = 'btn ghost sm icon';
    hideLeft.title = 'Hide the piece list';
    hideLeft.setAttribute('aria-label', 'Hide the piece list');
    hideLeft.innerHTML = icon('hideLeft');
    editor.querySelector('.catalogue-panel .panel-heading')?.append(hideLeft);
    const full = document.createElement('button');
    full.type = 'button';
    full.id = 'canvas-only';
    full.className = 'btn square';
    full.title = 'Full canvas: hide both sidebars (H)';
    full.setAttribute('aria-label', 'Full canvas');
    full.innerHTML = icon('full');
    editor.querySelector('.zoom-controls')?.append(full);

    function apply() {
      editor.classList.toggle('left-off', !state.left);
      editor.classList.toggle('right-off', !state.right);
      showLeft.hidden = state.left;
      showRight.hidden = state.right;
      full.setAttribute('aria-pressed', String(!state.left && !state.right));
      store('slotforge.builder-panels.v1', state);
    }
    const set = (left, right) => {
      state.left = left;
      state.right = right;
      apply();
    };
    hideLeft.onclick = () => set(false, state.right);
    showLeft.onclick = () => set(true, state.right);
    showRight.onclick = () => set(state.left, true);
    if (rail) rail.hide.onclick = () => set(state.left, false);
    // Full canvas: both away, or both back when either is away.
    const toggle = () => (state.left || state.right ? set(false, false) : set(true, true));
    full.onclick = toggle;
    apply();
    panels = { toggle, set, state };
    return panels;
  }

  function mount() {
    toolsMenu();
    inspectorRail();
    sidebars();
    return { rail, panels };
  }

  root.BuilderLayout = {
    mount,
    toggleSidebars: () => panels?.toggle(),
    reveal: id => {
      if (panels && !panels.state.right) panels.set(panels.state.left, true);
      rail?.reveal(id);
    },
    rail: () => rail,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
