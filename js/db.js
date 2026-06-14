// db.js — tiny promise-based IndexedDB wrapper.
// Stores keep concerns separate (see Core Goal #5):
//   habits      : habit definitions
//   logs        : completion/skip entries (one row per habit per day, never duplicated)
//   meta        : settings / app state (theme, pin, etc.)
//   challenges  : peer leaderboard challenges (friend + habit + acceptance date + cached streaks)
//   friendLinks : friend connection metadata (name, number, status)
//
// All storage is 100% local IndexedDB — nothing leaves the device. The leaderboard
// "syncs" only by links the user manually shares over WhatsApp.

const DB_NAME = 'habittracker';
const DB_VERSION = 2;

let _dbPromise = null;
let _db = null; // resolved IDBDatabase, cached so writes can be issued synchronously

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
      // --- v2: peer leaderboard ---
      if (!db.objectStoreNames.contains('challenges')) {
        // One row per challenge. id is a locally-generated unique challenge id.
        const s = db.createObjectStore('challenges', { keyPath: 'id' });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('friendId', 'friendId', { unique: false });
        s.createIndex('habitId', 'habitId', { unique: false });
      }
      if (!db.objectStoreNames.contains('friendLinks')) {
        const s = db.createObjectStore('friendLinks', { keyPath: 'id' });
        s.createIndex('status', 'status', { unique: false });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(req.result); };
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

// Best-effort kick so the connection is cached early (idempotent).
openDB().catch(() => {});

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
  // SYNCHRONOUS-ISSUE put: when the connection is already open (always true after
  // boot), create the transaction + issue the put + request commit immediately,
  // all in the current call frame. Critical before navigator.share() backgrounds
  // the PWA on Android — the async put() above only starts its transaction in a
  // later microtask, which may never run if the page is suspended/killed first.
  // Returns true if issued synchronously; falls back to async put() otherwise.
  putNow(store, value) {
    if (_db) {
      try {
        const tx = _db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        if (tx.commit) tx.commit(); // hint the browser to flush ASAP
        return true;
      } catch (_) { /* connection closing/closed — fall through */ }
    }
    this.put(store, value).catch(() => {});
    return false;
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
    await Promise.all([
      this.clear('habits'), this.clear('logs'), this.clear('meta'),
      this.clear('challenges'), this.clear('friendLinks'),
    ]);
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
