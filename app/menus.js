// Small accessible menus: a dropdown attached to a button, and a context menu
// opened at a point. Keyboard: arrows move, Enter/Space choose, Escape closes.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Menus = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  let open = null; // { menu, button, close }

  const items = menu => [...menu.querySelectorAll('[role="menuitem"]')].filter(i => !i.hidden && !i.disabled);

  function closeOpen(focusButton = false) {
    if (!open) return;
    const current = open;
    open = null;
    current.close(focusButton);
  }

  function keyboard(menu, e) {
    const list = items(menu),
      index = list.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      closeOpen(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (index + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
      list[next]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
    } else if (e.key === 'Tab') closeOpen(false);
  }

  function show(menu, close, button = null) {
    closeOpen(false);
    menu.hidden = false;
    open = { menu, button, close };
    const onKey = e => keyboard(menu, e);
    menu.addEventListener('keydown', onKey);
    const original = open.close;
    open.close = focusButton => {
      menu.removeEventListener('keydown', onKey);
      original(focusButton);
    };
    requestAnimationFrame(() => items(menu)[0]?.focus({ preventScroll: true }));
  }

  // Dropdown: clicking the button toggles the menu; choosing an item closes it.
  function attach(button, menu) {
    const close = focusButton => {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (focusButton) button.focus();
    };
    button.addEventListener('click', e => {
      e.stopPropagation();
      if (open?.menu === menu) return closeOpen(false);
      button.setAttribute('aria-expanded', 'true');
      show(menu, close, button);
    });
    button.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' && menu.hidden) {
        e.preventDefault();
        button.click();
      }
    });
    menu.addEventListener('click', e => {
      if (e.target.closest('[role="menuitem"]')) closeOpen(false);
    });
  }

  // Context menu at viewport point (x, y). entries: [{label, action, shortcut, disabled, danger} | 'separator'].
  function context(x, y, entries, label = 'Actions') {
    let menu = document.getElementById('context-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'context-menu';
      menu.className = 'menu-popover context-menu';
      menu.setAttribute('role', 'menu');
      document.body.append(menu);
      menu.addEventListener('click', e => {
        const item = e.target.closest('[role="menuitem"]');
        if (!item || item.disabled) return;
        const action = item._action;
        closeOpen(false);
        action?.();
      });
    }
    menu.setAttribute('aria-label', label);
    menu.replaceChildren(
      ...entries.map(entry => {
        if (entry === 'separator') return document.createElement('hr');
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.textContent = entry.label;
        b.disabled = !!entry.disabled;
        if (entry.danger) b.classList.add('danger');
        if (entry.shortcut) {
          const k = document.createElement('kbd');
          k.textContent = entry.shortcut;
          b.append(k);
        }
        b._action = entry.action;
        return b;
      })
    );
    menu.hidden = false;
    menu.style.left = '0px';
    menu.style.top = '0px';
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
    show(menu, () => (menu.hidden = true));
    return menu;
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', e => {
      if (open && !open.menu.contains(e.target) && !open.button?.contains(e.target)) closeOpen(false);
    });
    // Escape closes an open menu wherever the keyboard focus is.
    document.addEventListener(
      'keydown',
      e => {
        if (open && e.key === 'Escape' && !open.menu.contains(document.activeElement)) {
          e.preventDefault();
          e.stopPropagation();
          closeOpen(true);
        }
      },
      true
    );
    addEventListener('blur', () => closeOpen(false));
    addEventListener('resize', () => closeOpen(false));
  }

  return { attach, context, close: closeOpen, isOpen: () => !!open };
});
