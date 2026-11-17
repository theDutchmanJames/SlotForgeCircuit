// First-run welcome and the keyboard shortcut overview (press ? anywhere).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CircuitHelp = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SEEN = 'slotforge.welcome.v1';
  const mod = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl';

  // [description, ...key combinations]; a combination is a list of keys.
  const SHORTCUTS = [
    {
      title: 'Everywhere',
      rows: [
        ['Show this list', ['?']],
        ['Close a dialog or menu', ['Esc']],
      ],
    },
    {
      title: 'Track Builder',
      rows: [
        ['Undo', [mod, 'Z']],
        ['Redo', [mod, 'Y'], [mod, 'Shift', 'Z']],
        ['Select all pieces', [mod, 'A']],
        ['Duplicate selection', [mod, 'D']],
        ['Rotate / rotate back', ['R'], ['Shift', 'R']],
        ['Mirror', ['M']],
        ['Delete selection', ['Delete'], ['Backspace']],
        ['Clear selection', ['Esc']],
        ['New track', [mod, 'N']],
        ['Open track file', [mod, 'O']],
        ['Export track file', [mod, 'S']],
      ],
    },
    {
      title: 'Canvas and mouse',
      rows: [
        ['Pan the view', ['Space', 'drag']],
        ['Zoom', ['mouse wheel']],
        ['Add to / remove from selection', ['Shift', 'click']],
        ['Select an area', ['drag on empty canvas']],
        ['Move without snapping', ['Shift', 'drag']],
        ['Piece actions', ['right-click']],
      ],
    },
    {
      title: 'FreeForm Drawing',
      rows: [
        ['Undo / redo', [mod, 'Z'], [mod, 'Y']],
        ['Select all points', [mod, 'A']],
        ['Delete selected point', ['Delete']],
        ['Nudge a point 1 mm / 10 mm', ['arrow keys'], ['Shift', 'arrows']],
        ['Select several points', ['Shift', 'click']],
        ['Stop drawing or deselect', ['Esc']],
      ],
    },
  ];

  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('data-')) node.setAttribute(k, v);
      else node[k] = v;
    }
    node.append(...children.filter(c => c != null));
    return node;
  };
  const keys = combo =>
    el(
      'span',
      {},
      ...combo.flatMap((k, i) => [i ? ' + ' : null, /^[a-z ]+$/.test(k) && k.length > 3 ? k : el('kbd', {}, k)])
    );

  function dialog(id, cls, label) {
    let d = document.getElementById(id);
    if (!d) {
      d = el('dialog', { id, class: cls });
      d.setAttribute('aria-label', label);
      d.addEventListener('click', e => {
        if (e.target === d || e.target.closest('[data-close-help]')) d.close();
      });
      document.body.append(d);
    }
    return d;
  }

  function shortcuts() {
    const d = dialog('shortcut-dialog', 'help-dialog', 'Keyboard shortcuts');
    d.replaceChildren(
      el(
        'div',
        { class: 'dialog-heading' },
        el('h2', {}, 'Keyboard shortcuts'),
        el('button', { class: 'btn quiet', type: 'button', 'data-close-help': '1', ariaLabel: 'Close' }, '✕')
      ),
      el(
        'div',
        { class: 'shortcut-groups' },
        ...SHORTCUTS.map(group =>
          el(
            'section',
            {},
            el('h3', {}, group.title),
            ...group.rows.map(([label, ...combos]) =>
              el(
                'div',
                { class: 'shortcut-row' },
                el('span', {}, label),
                el('span', {}, ...combos.flatMap((c, i) => [i ? ' or ' : null, keys(c)]))
              )
            )
          )
        )
      ),
      el('p', { class: 'fine' }, 'Shortcuts work when you are not typing in a field.')
    );
    if (!d.open) d.showModal();
    return d;
  }

  const seen = () => {
    try {
      return localStorage.getItem(SEEN) === 'seen';
    } catch {
      return true;
    }
  };
  const markSeen = () => {
    try {
      localStorage.setItem(SEEN, 'seen');
    } catch {}
  };

  // choices: { builder, packs, routed, freeform } callbacks supplied by the app.
  function welcome(go) {
    const d = dialog('welcome-dialog', 'welcome-dialog', 'Welcome to SlotForge Circuit');
    const card = (key, icon, title, text) =>
      el(
        'button',
        { type: 'button', class: 'empty-action', 'data-welcome': key },
        el('span', { class: 'empty-icon', ariaHidden: 'true' }, icon),
        el('strong', {}, title),
        el('span', {}, text)
      );
    d.replaceChildren(
      el(
        'div',
        { class: 'dialog-heading' },
        el('div', {}, el('h2', {}, 'Welcome to Circuit'), el('p', { class: 'muted' }, 'What would you like to plan?')),
        el('button', { class: 'btn quiet', type: 'button', 'data-close-help': '1', ariaLabel: 'Close' }, '✕')
      ),
      el(
        'div',
        { class: 'empty-actions' },
        card('packs', '▭', 'Plastic track', 'Snap together pieces from Carrera, Scalextric, Ninco and more.'),
        card('routed', '◠', 'Routed wood', 'Design a routed track from straights and curves, ready for CAD.'),
        card('freeform', '✎', 'Draw freely', 'Draw one slot as a smooth curve and generate the other lanes.'),
        card('builder', '▶', 'Look at an example', 'Open the example circuit and watch cars drive it in Live Preview.')
      ),
      el(
        'div',
        { class: 'welcome-foot' },
        el('span', {}, 'Tip: press ', el('kbd', {}, '?'), ' any time for keyboard shortcuts.'),
        el('button', { class: 'btn quiet', type: 'button', 'data-close-help': '1' }, 'Skip')
      )
    );
    d.onclick = e => {
      const choice = e.target.closest('[data-welcome]')?.dataset.welcome;
      if (!choice) return;
      d.close();
      go[choice]?.();
    };
    markSeen(); // Shown once is enough; it stays available under Help.
    if (!d.open) d.showModal();
    return d;
  }

  // Shows the welcome once, unless another start-up dialog is already open.
  function maybeWelcome(go) {
    if (seen() || document.querySelector('dialog[open]')) return null;
    return welcome(go);
  }

  // Long static help paragraphs show their first sentence and a "More" link.
  // Paragraphs the app updates (with an id), errors and live status text are left alone.
  const INLINE = new Set(['STRONG', 'EM', 'KBD', 'CODE', 'B', 'I', 'SPAN', 'A']);
  function condense(root = document, minLength = 150) {
    let count = 0;
    for (const p of root.querySelectorAll('p')) {
      if (
        p.id ||
        p.dataset.condensed ||
        p.closest('[role="alert"], .error, [aria-live], [id^="welcome"], [id^="shortcut"]')
      )
        continue;
      if (![...p.childNodes].every(n => n.nodeType === 3 || INLINE.has(n.nodeName))) continue;
      if (p.textContent.trim().length < minLength) continue;
      // Find the end of the first sentence inside a text node.
      let cut = null;
      for (const node of p.childNodes) {
        if (node.nodeType !== 3) continue;
        const m = /[.!?](\s+)(?=[A-Z0-9“"(])/.exec(node.textContent);
        if (m) {
          cut = { node, at: m.index + 1 };
          break;
        }
      }
      if (!cut) continue;
      const rest = cut.node.splitText(cut.at);
      const more = document.createElement('span');
      more.className = 'more-text';
      more.hidden = true;
      let n = rest;
      while (n) {
        const next = n.nextSibling;
        more.append(n);
        n = next;
      }
      if (!more.textContent.trim()) continue;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'more-toggle';
      toggle.textContent = 'More';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.onclick = () => {
        const open = more.hidden;
        more.hidden = !open;
        toggle.textContent = open ? 'Less' : 'More';
        toggle.setAttribute('aria-expanded', String(open));
      };
      p.append(' ', toggle, more);
      p.dataset.condensed = 'true';
      count++;
    }
    return count;
  }

  if (typeof document !== 'undefined')
    document.addEventListener('keydown', e => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest?.('input, select, textarea, [contenteditable="true"]')) return;
      if (document.querySelector('dialog[open]:not(#shortcut-dialog)')) return;
      e.preventDefault();
      shortcuts();
    });

  return { shortcuts, welcome, maybeWelcome, condense, SHORTCUTS };
});
