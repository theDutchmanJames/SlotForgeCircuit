// Paddock Rail (SlotForge Restyle): a page with its sections in a side list on the left
// and one section at a time on the right. The page's existing elements are moved into the
// shell, so the code that fills them keeps working.
//
//   const rail = SideRail.mount(view, {
//     title: 'Settings', label: 'Settings sections', storageKey: 'slotforge.settings-rail.v1',
//     groups: [{ label: 'Look and feel', items: [{ key, text, icon, sections: [el, …] }] }],
//     onSelect: key => {},
//   });
//   rail.select(key);  rail.current();  rail.count(key, 12);
(function (root) {
  'use strict';
  const ICONS = {
    ruler: '<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>',
    palette:
      '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-.9-.7-1.3-.7-2.1 0-.8.6-1.4 1.5-1.4H17a4 4 0 0 0 4-4C21 6.7 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15" cy="7.5" r="1"/>',
    update: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
    import: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 19h16"/>',
    export: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M4 19h16"/>',
    grid: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
    box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    share:
      '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6"/>',
  };
  const icon = name =>
    `<svg class="rail-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  function mount(view, { title, label, groups, storageKey, initial, onSelect } = {}) {
    const items = groups.flatMap(g => g.items).filter(i => i.sections.some(Boolean));
    if (!view || !items.length) return null;
    const managed = new Set(items.flatMap(i => i.sections.filter(Boolean)));

    const shell = document.createElement('div');
    shell.className = 'rail-shell';
    const nav = document.createElement('nav');
    nav.className = 'rail';
    nav.setAttribute('aria-label', label || title);
    const head = document.createElement('div');
    head.className = 'rail-title';
    head.textContent = title;
    nav.append(head);
    const list = document.createElement('div');
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-orientation', 'vertical');
    nav.append(list);
    const page = document.createElement('div');
    page.className = 'rail-page';
    page.append(...view.childNodes);
    shell.append(nav, page);
    view.append(shell);
    view.classList.add('has-rail');

    const buttons = new Map();
    for (const group of groups) {
      const shown = group.items.filter(i => items.includes(i));
      if (!shown.length) continue;
      const box = document.createElement('div');
      box.className = 'rail-group';
      if (group.label) {
        const heading = document.createElement('span');
        heading.className = 'rail-label';
        heading.textContent = group.label;
        box.append(heading);
      }
      for (const item of shown) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'rail-tab';
        b.id = `rail-${item.key}`;
        b.dataset.railKey = item.key;
        b.setAttribute('role', 'tab');
        b.innerHTML = `${icon(item.icon)}<span class="rail-text"></span><span class="rail-count" hidden></span>`;
        b.querySelector('.rail-text').textContent = item.text;
        b.onclick = () => select(item.key, true);
        b.onkeydown = e => {
          const keys = [...buttons.keys()],
            at = keys.indexOf(item.key);
          const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: keys.length - 1 }[e.key];
          if (next === undefined) return;
          e.preventDefault();
          const key = keys[(next + keys.length) % keys.length];
          select(key, true);
          buttons.get(key).focus();
        };
        buttons.set(item.key, b);
        box.append(b);
      }
      list.append(box);
    }

    let active = null;
    function select(key, fromUser = false) {
      const item = items.find(i => i.key === key) || items[0];
      active = item.key;
      const visible = new Set(item.sections.filter(Boolean));
      for (const el of managed) el.hidden = !visible.has(el);
      for (const [k, b] of buttons) {
        b.setAttribute('aria-selected', String(k === active));
        b.tabIndex = k === active ? 0 : -1;
      }
      try {
        if (storageKey) localStorage.setItem(storageKey, active);
      } catch {}
      if (fromUser) page.scrollTop = 0;
      onSelect?.(active, fromUser);
      return active;
    }
    let saved = null;
    try {
      saved = storageKey && localStorage.getItem(storageKey);
    } catch {}
    select(saved || initial);
    // A small number on the right of an item (for example how many packs it shows).
    function count(key, value) {
      const badge = buttons.get(key)?.querySelector('.rail-count');
      if (!badge) return;
      badge.hidden = value == null || value === '';
      badge.textContent = badge.hidden ? '' : String(value);
    }
    return { select, current: () => active, count, nav, page };
  }

  root.SideRail = { mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
