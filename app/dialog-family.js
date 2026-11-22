// One dialog family: every window gets the same anatomy, whatever its markup.
//   Head: an icon tile, a small label (eyebrow) above the title, and ×.
//   Body: what the window is about.
//   Foot: the keys on the left ("Enter saves · Esc closes"), the buttons on the right, main one last.
// The windows keep their ids and handlers; this only arranges and labels them.
(function (root) {
  'use strict';
  const ICONS = {
    save: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
    trash: '<path d="M4 7h16"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
    warning: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
    box: '<path d="M12 3 4 7v10l8 4 8-4V7z"/><path d="m4 7 8 4 8-4M12 11v10"/>',
    out: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    in: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    table: '<rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M6 17v3M18 17v3"/>',
    template:
      '<rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="13" width="8" height="7" rx="1.5"/><rect x="13" y="13" width="8" height="7" rx="1.5"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/>',
    border: '<path d="M4 18c4-10 12-10 16 0"/><path d="M4 13c4-7 12-7 16 0" stroke-dasharray="2 3"/>',
    doc: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/><path d="M9 13h6M9 17h4"/>',
    disk: '<rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/><path d="M8 7h.01M8 17h.01"/>',
    up: '<path d="M12 20V6"/><path d="m6 12 6-6 6 6"/><path d="M4 4h16"/>',
    route: '<path d="M4 18c3-9 7 0 10-6s4-7 6-8"/><circle cx="4" cy="18" r="1.5"/><circle cx="20" cy="4" r="1.5"/>',
    piece: '<rect x="3" y="8" width="18" height="8" rx="1"/><path d="M3 12h18" stroke-dasharray="3 3"/>',
  };
  // id: [icon, eyebrow, keys, tone]
  const FAMILY = {
    'save-design-dialog': ['save', 'Track Library', 'Enter saves · Esc closes'],
    'rename-design-dialog': ['pencil', 'Track Library', 'Enter renames · Esc closes'],
    'delete-design-dialog': ['trash', 'Track Library', 'Esc keeps it', 'danger'],
    'delete-pack-pieces-dialog': ['trash', 'Track Packs', 'Esc keeps them', 'danger'],
    'confirm-dialog': ['warning', 'Replace the track', 'Esc keeps your track', 'danger'],
    'new-pack-dialog': ['box', 'Track Packs', 'Enter creates · Esc closes'],
    'pack-export-dialog': ['out', 'Track Packs', 'Esc closes'],
    'import-review': ['in', null, 'Esc closes'],
    'space-guide-dialog': ['table', 'Track Builder', 'Esc closes'],
    'template-dialog': ['template', 'New track', 'Esc closes'],
    'reference-dialog': ['image', 'Reference image', 'Esc closes'],
    'borders-dialog': ['border', 'Track Builder', 'Esc closes'],
    'pdf-dialog': ['doc', 'Export', 'Esc closes'],
    'storage-dialog': ['disk', 'Storage', 'Esc closes'],
    'storage-upgrade': ['up', 'Saved library', null, 'alert', 'no-close'],
    'routed-section-dialog': ['route', 'Routed Wood', 'Esc closes'],
    'piece-dialog': ['piece', null, 'Esc closes'],
    'cad-dialog': ['route', null, 'Esc closes'],
  };
  const svg = name =>
    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  function arrange(dialog) {
    const spec = FAMILY[dialog.id];
    if (!spec || dialog.classList.contains('dlg')) return;
    const [icon, eyebrow, keys, tone, closing] = spec;
    const title = dialog.querySelector('.dialog-heading h2') || dialog.querySelector('h2');
    if (!title) return;
    dialog.classList.add('dlg');
    if (tone) dialog.classList.add('dlg-' + tone);
    // Short message windows used the Flag Dialog badge; the tile takes its place.
    if (dialog.classList.contains('appdlg')) dialog.classList.add('dlg-s');
    dialog.classList.remove('appdlg', 'appdlg-confirm', 'appdlg-danger', 'appdlg-alert');
    let head = title.closest('.dialog-heading');
    if (!head) {
      head = document.createElement('div');
      head.className = 'dialog-heading';
      title.before(head);
      head.append(title);
    }
    head.classList.add('dlg-head');
    // The title block: eyebrow (if any) and the title.
    let words = title.parentElement === head ? null : title.parentElement;
    if (!words) {
      words = document.createElement('div');
      title.before(words);
      words.append(title);
    }
    words.classList.add('dlg-words');
    if (eyebrow && !words.querySelector('.eyebrow')) {
      const e = document.createElement('span');
      e.className = 'eyebrow';
      e.textContent = eyebrow;
      words.prepend(e);
    }
    const tile = document.createElement('span');
    tile.className = 'dlg-tile';
    tile.innerHTML = svg(icon);
    head.prepend(tile);
    let close = head.querySelector('[data-close], .btn.square, [aria-label^="Close"]');
    if (!close && closing !== 'no-close') {
      close = document.createElement('button');
      close.type = 'button';
      close.className = 'btn square';
      close.setAttribute('aria-label', 'Close');
      close.textContent = '×';
      close.onclick = () => dialog.close();
      head.append(close);
    }
    close?.classList.add('dlg-close');
    // The head always comes first (some windows had fields above their title).
    const host = head.parentElement;
    if (host.firstElementChild !== head) host.prepend(head);
    // The foot: the keys on the left of the buttons.
    const foot = [...dialog.querySelectorAll('.dialog-actions')].pop();
    if (foot) {
      foot.classList.add('dlg-foot');
      if (keys && !foot.querySelector('.dlg-keys')) {
        const k = document.createElement('span');
        k.className = 'dlg-keys';
        k.textContent = keys;
        foot.prepend(k);
      }
    }
  }
  function apply(scope = document) {
    for (const id of Object.keys(FAMILY)) {
      const d = scope.getElementById ? scope.getElementById(id) : null;
      if (d) arrange(d);
    }
  }
  function watch() {
    apply();
    // Windows made later by other modules (the CAD window, for example) join when they appear.
    new MutationObserver(records => {
      for (const r of records)
        for (const n of r.addedNodes) if (n.nodeType === 1 && n.tagName === 'DIALOG' && FAMILY[n.id]) arrange(n);
    }).observe(document.body, { childList: true });
  }
  root.DialogFamily = { apply, watch, arrange, FAMILY };
})(typeof globalThis !== 'undefined' ? globalThis : this);
