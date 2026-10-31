/* لایه‌ی ذخیره‌سازی IndexedDB */
(function () {
  const NAME = 'avaz-music';
  const VERSION = 1;
  const STORES = ['tracks', 'covers', 'files', 'artists', 'playlists', 'kv'];
  let dbp;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      Promise.resolve(fn(s)).then((r) => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

  window.DB = {
    get: (store, key) => tx(store, 'readonly', (s) => wrap(s.get(key))),
    set: (store, key, val) => tx(store, 'readwrite', (s) => { s.put(val, key); }),
    del: (store, key) => tx(store, 'readwrite', (s) => { s.delete(key); }),
    clear: (store) => tx(store, 'readwrite', (s) => { s.clear(); }),
    keys: (store) => tx(store, 'readonly', (s) => wrap(s.getAllKeys())),
    all: (store) => tx(store, 'readonly', async (s) => {
      const [keys, vals] = await Promise.all([wrap(s.getAllKeys()), wrap(s.getAll())]);
      return keys.map((k, i) => [k, vals[i]]);
    }),
    putMany: (store, entries) => tx(store, 'readwrite', (s) => { for (const [k, v] of entries) s.put(v, k); }),
  };
})();
