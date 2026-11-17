// "A new version is available" in the desktop app (same design as Paddock).
// A quiet notice offers Download (the release page in the browser) and Not now
// (hidden until an even newer version appears); Settings → Updates shows the
// versions, has Check now and turns the automatic check off. The browser edition
// has no update check, so this does nothing there.
(function (root) {
  'use strict';
  const desktop = root.slotforgeDesktop;
  let state = null;
  let card = null;
  let say = () => {};
  let loading = null;

  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };
  const when = ms => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  async function call(action, payload) {
    const answer = await desktop.updateCheck(action, payload);
    if (!answer || answer.error) throw Error(answer?.error || 'The update check is not available.');
    return answer.value;
  }

  async function load() {
    if (loading) return loading;
    loading = call('status')
      .then(s => (state = s))
      .catch(() => {}) // Optional: never get in the way of the app.
      .finally(() => {
        loading = null;
        show();
      });
    return loading;
  }

  function show() {
    showNotice();
    showCard();
  }

  function showNotice() {
    const old = document.getElementById('update-notice');
    const s = state;
    if (!s?.notify || !s.latest) return old?.remove();
    if (old?.dataset.version === s.latest.version) return;
    old?.remove();
    const download = el('button', { type: 'button', className: 'btn primary', textContent: 'Download' });
    download.onclick = () => open();
    const later = el('button', {
      type: 'button',
      className: 'btn',
      textContent: 'Not now',
      title: 'Hide until a newer version appears',
    });
    later.onclick = () => skip();
    const box = el('div', { id: 'update-notice', className: 'update-notice' }, [
      el('span', { textContent: `Circuit ${s.latest.version} is available` }),
      download,
      later,
    ]);
    box.setAttribute('role', 'status');
    box.dataset.version = s.latest.version;
    box.dataset.units = 'raw';
    document.body.append(box);
  }

  async function open() {
    try {
      await call('open');
    } catch (e) {
      say(e.message, true);
    }
  }

  async function skip() {
    try {
      state = await call('skip', { version: state?.latest?.version });
      show();
      say('Circuit will remind you again when a newer version appears. Settings → Updates has the download.');
    } catch (e) {
      say(e.message, true);
      load();
    }
  }

  function check() {
    // Not awaited by the button: a slow network must not hold up the app.
    call('check').then(
      s => {
        state = s;
        show();
        say(s.latest ? `Circuit ${s.latest.version} is available.` : 'You have the latest version.');
      },
      e => {
        say(e.message, true);
        load();
      }
    );
    load(); // shows "Checking…"
  }

  async function toggle() {
    try {
      state = await call('enable', { enabled: !state?.enabled });
      show();
    } catch (e) {
      say(e.message, true);
    }
  }

  function showCard() {
    if (!card) return;
    const s = state;
    const body = card.querySelector('.update-body');
    body.replaceChildren();
    if (!s) return body.append(el('p', { textContent: 'Loading…' }));
    let newest = 'Not checked yet';
    if (s.checking) newest = 'Checking…';
    else if (s.latest) newest = `Version ${s.latest.version} is available`;
    else if (s.upToDate) newest = 'You have the latest version';
    const how = !s.enabled
      ? 'Off: Circuit only checks when you click Check now.'
      : s.automatic
        ? 'Circuit checks for a new version twice a day at most and shows a notice when one is published.'
        : 'This copy only checks when you click Check now.';
    body.append(
      el('p', {
        textContent: `${how} It only asks GitHub for the newest version number; nothing about you or your tracks is sent. Circuit never installs anything by itself.`,
      })
    );
    if (s.lastError && !s.checking) body.append(el('p', { className: 'update-error', textContent: s.lastError }));
    const list = el('dl', { className: 'update-facts' });
    for (const [term, value] of [
      ['This version', s.current],
      ['Newest version', newest],
      ['Last checked', s.lastCheck ? when(s.lastCheck) : 'Never'],
    ])
      list.append(el('dt', { textContent: term }), el('dd', { textContent: value }));
    body.append(list);
    const actions = el('div', { className: 'update-actions' });
    if (s.latest) {
      const download = el('button', {
        type: 'button',
        className: 'btn primary',
        textContent: `Download ${s.latest.version}`,
      });
      download.onclick = () => open();
      actions.append(download);
    }
    const now = el('button', { type: 'button', className: 'btn', id: 'update-check-now', textContent: 'Check now' });
    now.disabled = !!s.checking;
    now.onclick = check;
    actions.append(now);
    if (s.automatic) {
      const auto = el('button', {
        type: 'button',
        className: 'btn',
        id: 'update-toggle',
        textContent: s.enabled ? 'Turn off automatic checks' : 'Turn on automatic checks',
      });
      auto.onclick = toggle;
      actions.append(auto);
    }
    body.append(actions);
    if (s.latest)
      body.append(
        el('p', {
          className: 'update-hint',
          textContent:
            'Download opens the release page in your browser. Close Circuit, then install the new version as before; your tracks stay where they are.',
        })
      );
  }

  function start({ settings, before, say: message } = {}) {
    if (!desktop?.updateCheck) return;
    say = message || say;
    if (settings) {
      card = el('section', { className: 'export-card update-card' }, [
        el('h2', { id: 'update-title', textContent: 'Updates' }),
        el('div', { className: 'update-body' }),
      ]);
      card.setAttribute('aria-labelledby', 'update-title');
      card.dataset.units = 'raw';
      settings.insertBefore(card, before && before.parentNode === settings ? before : null);
    }
    desktop.onUpdateChange?.(load);
    load();
  }

  root.UpdateUI = { start };
})(typeof globalThis !== 'undefined' ? globalThis : this);
