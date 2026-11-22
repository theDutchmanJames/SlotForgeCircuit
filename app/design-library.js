(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./integration.js'), require('./core.js'));
  else root.DesignLibrary = factory(root.SlotForgeIntegration, root.Forge);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (I, F) {
  'use strict';
  let backend = null;
  const DATABASE = 'slotforge.design-library.v1',
    STORE = 'designs',
    SUMMARIES = 'summaries';
  function prepare(raw, name, copy = false) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100)
      throw Error('Design names must be 1–100 characters.');
    const imported = I.importLayout(raw),
      state = { ...imported.state };
    if (copy) {
      state.designId = I.newState().designId;
      state.requiresLaneRemap = false;
    }
    return I.prepare({ ...raw, title: name.trim() }, state, false);
  }
  function validateSource(value, id) {
    if (value == null) return null;
    if (
      typeof value !== 'object' ||
      Array.isArray(value) ||
      value.id !== id ||
      typeof value.revision !== 'string' ||
      !/^[-\w]{1,100}$/.test(value.revision)
    )
      throw Error('Invalid saved-design revision.');
    return { id, revision: value.revision };
  }
  function source(record) {
    return validateSource(
      { id: record.id, revision: record.revision || record.layout?.design?.revision },
      record.layout?.design?.id || record.id
    );
  }
  function checkRevision(record, expected) {
    if ((record ? record.revision || record.layout.design.revision : null) !== (expected ?? null))
      throw Error(
        'This design changed in another window. Open the saved version again, or save your work as a new copy.'
      );
  }
  function openDB() {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB)
        return reject(Error('The track library is unavailable in this browser. Download JSON to keep a file.'));
      let blocked = false;
      const request = indexedDB.open(DATABASE, 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(SUMMARIES)) {
          const summaries = db.createObjectStore(SUMMARIES, { keyPath: 'id' }),
            cursor = request.transaction.objectStore(STORE).openCursor();
          cursor.onsuccess = () => {
            const c = cursor.result;
            if (!c) return;
            summaries.put(summarize(c.value));
            c.continue();
          };
        }
      };
      request.onsuccess = () => {
        if (blocked) {
          request.result.close();
          return;
        }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () =>
        reject(Error('Could not open the track library. Your saved layouts have not been changed.'));
      request.onblocked = () => {
        blocked = true;
        reject(Error('Close other outdated Builder tabs, then try again.'));
      };
    });
  }
  async function transaction(mode, run) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      let result, failure;
      const tx = db.transaction([STORE, SUMMARIES], mode);
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onabort = tx.onerror = () => {
        db.close();
        reject(
          failure ||
            Error(
              'Could not save or read the track library. Storage may be full or unavailable. Export a layout file as a backup.'
            )
        );
      };
      try {
        run(
          tx.objectStore(STORE),
          value => (result = value),
          error => {
            failure = error;
            tx.abort();
          }
        );
      } catch (e) {
        tx.abort();
        reject(e);
      }
    });
  }
  async function browserList() {
    const records = await transaction('readonly', (store, done) => {
      store.getAll().onsuccess = e => done(e.target.result);
    });
    return records.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  async function list() {
    return backend ? backend.list() : browserList();
  }
  // A saved track's card facts. v2 adds what the Track Library filters and sorts by: the kind of
  // track, the track systems used, the lap length, the footprint and the favourite star.
  const SUMMARY_VERSION = 2;
  function facts(layout) {
    const defs = layout?.definitions || [],
      types = new Set(defs.map(d => d?.parameters?.type || '')),
      routed = defs.some(d => d?.parameters?.routed || /^routed/.test(d?.parameters?.type || '')),
      kind = types.has('freeform') ? 'freeform' : routed ? 'routed' : 'sectional',
      systems = [
        ...new Set(
          defs
            .filter(d => !/border/.test(d?.parameters?.type || ''))
            .map(d => String(d?.pack || '').trim())
            .filter(name => name && !/^routed (wood|freeform)$/i.test(name))
        ),
      ].sort(),
      lanes = (layout?.track?.lanes || []).map(l => Number(l.lengthMm)).filter(Number.isFinite),
      lapMm = lanes.length ? Math.round(lanes.reduce((a, b) => a + b, 0) / lanes.length) : 0;
    let sizeMm = null;
    try {
      const guide = layout?.workspace?.spaceGuide;
      if (guide?.kind === 'table' && guide.lengthMm && guide.widthMm) sizeMm = [guide.lengthMm, guide.widthMm];
      else if (F && layout?.pieces?.length) {
        const clean = F.validateLayout(layout),
          b = F.bounds(clean.pieces, clean.definitions);
        sizeMm = [Math.round(b[2]), Math.round(b[3])];
      }
    } catch {
      sizeMm = null;
    }
    return { kind, systems, lapMm, sizeMm };
  }
  function summarize(r) {
    return {
      v: SUMMARY_VERSION,
      id: r.id,
      revision: r.revision || r.layout?.design?.revision || '',
      updatedAt: String(r.updatedAt || ''),
      title: String(r.layout?.title || 'Unreadable saved track'),
      designRevision: r.layout?.design?.revision || '',
      pieceCount: r.layout?.pieces?.length || 0,
      laneCount: r.layout?.track?.laneCount || 0,
      favourite: !!r.favourite,
      ...facts(r.layout),
    };
  }
  async function summaries() {
    if (backend) return backend.summaries();
    let rows = await transaction('readonly', (store, done) => {
      store.transaction.objectStore(SUMMARIES).getAll().onsuccess = e => done(e.target.result);
    });
    if (rows.some(r => r.v !== SUMMARY_VERSION)) {
      rows = (await browserList()).map(summarize);
      await transaction('readwrite', store => {
        const table = store.transaction.objectStore(SUMMARIES);
        for (const r of rows) table.put(r);
      });
    }
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }
  async function page({ query = '', offset = 0, limit = 24 } = {}) {
    if (backend) return backend.page({ query, offset, limit });
    const all = (await summaries()).filter(r => r.title.toLowerCase().includes(query.toLowerCase()));
    return { items: all.slice(offset, offset + limit), total: all.length, offset, limit };
  }
  const previewCache = new Map();
  async function preview(id) {
    if (backend) return backend.preview(id);
    const r = await get(id),
      key = id + ':' + r.revision;
    if (previewCache.has(key)) return previewCache.get(key);
    const result = {
      svg: r.layout.pieces.length ? I.picture(r.layout, { maxDimension: 600 }).svg : '',
      revision: r.revision,
    };
    previewCache.set(key, result);
    while (previewCache.size > 48) previewCache.delete(previewCache.keys().next().value);
    return result;
  }
  async function get(id) {
    if (backend) return backend.get(id);
    const record = await transaction('readonly', (store, done) => {
      store.get(id).onsuccess = e => done(e.target.result);
    });
    if (!record) throw Error('This design is no longer in the library.');
    return {
      ...record,
      revision: record.revision || record.layout.design.revision,
      layout: prepare(record.layout, record.layout.title),
    };
  }
  async function save(raw, name, copy = false, expectedRevision = null) {
    const layout = prepare(raw, name, copy),
      expected = copy ? null : expectedRevision;
    if (backend) return backend.putDesign(layout, expected);
    const record = {
      id: layout.design.id,
      revision: I.newState().designId,
      updatedAt: new Date().toISOString(),
      layout,
    };
    await transaction('readwrite', (store, done, fail) => {
      store.get(record.id).onsuccess = e => {
        try {
          checkRevision(e.target.result, expected);
          if (e.target.result?.favourite) record.favourite = true;
          store.put(record);
          store.transaction.objectStore(SUMMARIES).put(summarize(record));
          done(record);
        } catch (error) {
          fail(error);
        }
      };
    });
    return record;
  }
  async function remove(id, expectedRevision = null) {
    if (backend) return backend.remove(id, expectedRevision);
    await transaction('readwrite', (store, done, fail) => {
      store.get(id).onsuccess = e => {
        try {
          checkRevision(e.target.result, expectedRevision);
          store.delete(id);
          store.transaction.objectStore(SUMMARIES).delete(id);
        } catch (error) {
          fail(error);
        }
      };
    });
  }
  // The star on a card. It does not change the design's revision, so an open copy stays in step.
  async function favourite(id, on) {
    if (backend) return backend.favourite(id, !!on);
    await transaction('readwrite', (store, done, fail) => {
      store.get(id).onsuccess = e => {
        const record = e.target.result;
        if (!record) return fail(Error('This design is no longer in the library.'));
        if (on) record.favourite = true;
        else delete record.favourite;
        store.put(record);
        store.transaction.objectStore(SUMMARIES).put(summarize(record));
      };
    });
  }
  // The Bin: deleted tracks the disk workspace keeps (the last 20). Browser storage has no Bin.
  const hasBin = () => !!backend?.trash;
  async function bin() {
    return hasBin() ? backend.trash() : [];
  }
  async function restore(id, deletedAt) {
    if (!hasBin()) throw Error('The Bin needs the disk workspace.');
    return backend.restore(id, deletedAt);
  }
  async function purge(id = null, deletedAt = null) {
    if (!hasBin()) throw Error('The Bin needs the disk workspace.');
    return backend.purge(id, deletedAt);
  }
  return {
    SUMMARY_VERSION,
    summarize,
    favourite,
    hasBin,
    bin,
    restore,
    purge,
    setBackend: value => {
      backend = value;
    },
    browserList,
    DATABASE,
    prepare,
    validateSource,
    source,
    checkRevision,
    list,
    summaries,
    page,
    preview,
    get,
    save,
    remove,
  };
});
