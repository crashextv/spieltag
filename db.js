'use strict';
// Datenspeicher auf dem Gerät (IndexedDB). Nichts verlässt das Handy.
// Bereiche: players (Kader), games (Spiele), meta (Einstellungen)
const DB = (() => {
  let dbPromise;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('spieltag', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const name of ['players', 'games', 'meta']) {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function run(store, mode, action) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = action(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  return {
    all: store => run(store, 'readonly', s => s.getAll()),
    get: (store, id) => run(store, 'readonly', s => s.get(id)),
    put: (store, obj) => run(store, 'readwrite', s => s.put(obj)),
    del: (store, id) => run(store, 'readwrite', s => s.delete(id)),
  };
})();
