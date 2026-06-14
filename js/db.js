// db.js — tiny promise-based IndexedDB wrapper.
// Three stores keep concerns separate (see Core Goal #5):
//   habits : habit definitions
//   logs   : completion/skip entries (one row per habit per day, never duplicated)
//   meta   : settings / app state (theme, pin, etc.)

const DB_NAME = 'habittracker';
const DB_VERSION = 1;

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('habits')) {
        const s = db.createObjectStore('habits', { keyPath: 'id' });
        s.createIndex('archived', 'archived', { unique: false });
        s.createIndex('order', 'order', { unique: false });
      }
      if (!db.objectStoreNames.contains('logs')) {
        // keyPath is `${habitId}|${date}` so a day can only ever have ONE
        // row per habit — this guarantees de-duplication for free.
        const s = db.createObjectStore('logs', { keyPath: 'id' });
        s.createIndex('habitId', 'habitId', { unique: false });
        s.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function txStore(store, mode) {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const db = {
  async getAll(store) {
    const s = await txStore(store, 'readonly');
    return reqToPromise(s.getAll());
  },
  async get(store, key) {
    const s = await txStore(store, 'readonly');
    return reqToPromise(s.get(key));
  },
  async put(store, value) {
    const s = await txStore(store, 'readwrite');
    return reqToPromise(s.put(value));
  },
  async delete(store, key) {
    const s = await txStore(store, 'readwrite');
    return reqToPromise(s.delete(key));
  },
  async getByIndex(store, index, value) {
    const s = await txStore(store, 'readonly');
    return reqToPromise(s.index(index).getAll(value));
  },
  // Bulk write inside a single transaction (used by import + seeding).
  async bulkPut(store, values) {
    const dbi = await openDB();
    return new Promise((resolve, reject) => {
      const tx = dbi.transaction(store, 'readwrite');
      const s = tx.objectStore(store);
      values.forEach((v) => s.put(v));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async clear(store) {
    const s = await txStore(store, 'readwrite');
    return reqToPromise(s.clear());
  },
  async clearAll() {
    await Promise.all([this.clear('habits'), this.clear('logs'), this.clear('meta')]);
  },
};

// --- meta (settings) convenience helpers -----------------------------------
export async function getSetting(key, fallback = null) {
  const row = await db.get('meta', key);
  return row ? row.value : fallback;
}
export async function setSetting(key, value) {
  return db.put('meta', { key, value });
}
