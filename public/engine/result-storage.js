/* One completed, validated slice stays local for recovery after a page reload.
 * Shared by the classic slicing worker and the app's dynamic module import. */
(function (root) {
  'use strict';
  if (root.PocketSliceStorage) return;
  const STORE = 'results', KEY = 'latest', VERSION = 1, TIMEOUT_MS = 15000;

  function databaseName(appBase) {
    const url = new URL(String(appBase), root.location.href);
    if (url.origin !== root.location.origin || !url.pathname.endsWith('/') || url.search || url.hash) {
      throw new Error('The recovery storage application path is invalid.');
    }
    return `pocket-slicer-results-v1:${encodeURIComponent(url.pathname)}`;
  }

  function open(appBase) {
    return new Promise((resolve, reject) => {
      let settled = false, request;
      const finish = (error, db) => {
        if (settled) { db?.close(); return; }
        settled = true; clearTimeout(timer);
        if (error) reject(error); else resolve(db);
      };
      const timer = setTimeout(() => finish(new Error('Local recovery storage did not respond.')), TIMEOUT_MS);
      try {
        if (!root.indexedDB) throw new Error('Local recovery storage is unavailable.');
        request = root.indexedDB.open(databaseName(appBase), VERSION);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
        };
        request.onerror = () => finish(request.error || new Error('Local recovery storage could not open.'));
        request.onblocked = () => finish(new Error('Local recovery storage is busy in another tab.'));
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => db.close();
          finish(null, db);
        };
      } catch (error) { finish(error); }
    });
  }

  async function transact(appBase, mode, action) {
    const db = await open(appBase);
    try {
      return await new Promise((resolve, reject) => {
        let transaction, value, settled = false, failure;
        const finish = (error) => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          if (error) reject(error); else resolve(value);
        };
        const timer = setTimeout(() => {
          failure = new Error('Local recovery storage did not respond.');
          try { transaction?.abort(); } catch { /* It may have just completed. */ }
          finish(failure);
        }, TIMEOUT_MS);
        try {
          // Request a flush before completion where supported; older WebKit
          // still supplies atomic transactions through the ordinary API.
          try { transaction = db.transaction(STORE, mode, { durability: 'strict' }); }
          catch (error) {
            if (!(error instanceof TypeError)) throw error;
            transaction = db.transaction(STORE, mode);
          }
          transaction.oncomplete = () => finish();
          transaction.onerror = () => { failure = transaction.error; };
          transaction.onabort = () => finish(failure || transaction.error || new Error('Local recovery storage was interrupted.'));
          action(transaction.objectStore(STORE), result => { value = result; });
        } catch (error) {
          try { transaction?.abort(); } catch { /* Preserve the original error. */ }
          finish(error);
        }
      });
    } finally { db.close(); }
  }

  function isRecord(record) {
    return record?.version === VERSION && typeof record.id === 'string' && record.id.length > 0 &&
      typeof record.name === 'string' && record.name.length > 0 &&
      Number.isFinite(record.savedAt) && record.savedAt > 0 &&
      (record.gcode instanceof Blob || record.gcode instanceof ArrayBuffer) && record.byteLength > 0 &&
      (record.gcode.size ?? record.gcode.byteLength) === record.byteLength &&
      Number.isFinite(record.elapsedMs) && record.elapsedMs >= 0 &&
      Number.isInteger(record.layerCount) && record.layerCount >= 0;
  }

  function recoveryReason(error) {
    if (error?.name === 'QuotaExceededError') return 'Not enough device storage to keep a recovery copy. Save this G-code to Files now.';
    if (/did not respond|busy/.test(error?.message || '')) return `${error.message} Save this G-code to Files now.`;
    return 'Local recovery storage is unavailable. Save this G-code to Files before leaving this page.';
  }

  async function save(result, appBase) {
    try {
      const content = result?.gcode;
      if (!(content instanceof Blob) && !(content instanceof Uint8Array) && !(content instanceof ArrayBuffer)) throw new Error('Invalid G-code bytes.');
      // WebKit cannot reliably prepare worker-created Blobs for IndexedDB.
      // Store binary bytes and create the export Blob only when recovering in
      // the app. Never clone unrelated bytes from a view's backing buffer.
      const gcode = content instanceof Blob ? await content.arrayBuffer() :
        content instanceof Uint8Array ? (content.byteOffset === 0 && content.byteLength === content.buffer.byteLength ? content.buffer : content.slice().buffer) : content;
      if (!gcode.byteLength) throw new Error('Empty G-code cannot be saved.');
      const record = {
        version: VERSION, id: root.crypto.randomUUID(), savedAt: Date.now(),
        name: String(result.name || 'K1C-print.gcode').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200) || 'K1C-print.gcode',
        byteLength: gcode.byteLength, gcode, statistics: result.statistics ?? null,
        elapsedMs: Number.isFinite(result.elapsedMs) && result.elapsedMs >= 0 ? result.elapsedMs : 0,
        layerCount: Number.isInteger(result.layerCount) && result.layerCount >= 0 ? result.layerCount : 0,
      };
      // Replacement is atomic: quota/abort failures leave the previous file.
      await transact(appBase, 'readwrite', store => { store.put(record, KEY); });
      return { saved: true, id: record.id, savedAt: record.savedAt };
    } catch (error) {
      // Completed G-code must remain exportable even when IDB is unavailable.
      return { saved: false, reason: recoveryReason(error) };
    }
  }

  async function load(appBase) {
    const record = await transact(appBase, 'readonly', (store, setValue) => {
      const request = store.get(KEY);
      request.onsuccess = () => setValue(request.result ?? null);
    });
    if (record === null) return null;
    if (!isRecord(record)) throw new Error('The saved G-code recovery copy is unreadable.');
    return { ...record, gcode: record.gcode instanceof Blob ? record.gcode : new Blob([record.gcode], { type: 'text/plain' }) };
  }

  async function remove(id, appBase) {
    if (typeof id !== 'string' || !id) throw new Error('Choose a saved G-code file to remove.');
    await transact(appBase, 'readwrite', store => {
      const request = store.get(KEY);
      // An old recovery card must not delete a newer slice saved by another tab.
      request.onsuccess = () => { if (request.result?.id === id) store.delete(KEY); };
    });
  }

  root.PocketSliceStorage = Object.freeze({ save, load, remove });
})(globalThis);
