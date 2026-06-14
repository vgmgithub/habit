// backup.js — Backup & Restore via the File System Access API.
//
// Backups live in a user-chosen folder (not Downloads), survive "clear site data"
// (the files are outside the browser sandbox), and auto-rotate. The chosen folder's
// handle is persisted in IndexedDB (meta store) and re-used for every backup.
//
// File naming is STRICT:
//   backups     : habits-backup-YYYY-MM-DD.json   (date only — same-day overwrites)
//   pre-restore : habits-prerestore.json          (single file, overwritten each restore)
// Only files matching BACKUP_RE are ever deleted — the folder may be shared.

import { getSetting, setSetting } from './db.js';

const SLUG = 'habits';
const PREFIX = `${SLUG}-backup-`;
const BACKUP_RE = /^habits-backup-\d{4}-\d{2}-\d{2}\.json$/;
const PRERESTORE_NAME = `${SLUG}-prerestore.json`;
const DIR_PICKER_ID = `${SLUG}-backups`;
const HANDLE_KEY = 'backupFolderHandle';

export const BACKUP_SLUG = SLUG;

function localDateStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function backupNameFor(dateStr) { return `${PREFIX}${dateStr}.json`; }

// --- capability ------------------------------------------------------------
export function fileSystemAccessSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

// --- folder handle persistence + permission --------------------------------
export async function getSavedFolder() {
  try { return (await getSetting(HANDLE_KEY, null)) || null; } catch (_) { return null; }
}
export async function saveFolder(handle) { await setSetting(HANDLE_KEY, handle); }
export async function forgetFolder() { await setSetting(HANDLE_KEY, null); }

// Must be called from a user-gesture context (a menu/button tap satisfies this).
export async function ensureFolderPermission(handle, mode = 'readwrite') {
  if (!handle) return false;
  const opts = { mode };
  try {
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
  } catch (_) { return false; }
}

// Throws AbortError if the user cancels the OS picker.
export async function pickFolder() {
  return window.showDirectoryPicker({ id: DIR_PICKER_ID, mode: 'readwrite', startIn: 'documents' });
}

// --- listing / reading -----------------------------------------------------
// Returns [{name, date, size, modified}] sorted newest-first. Only real backups.
export async function listBackups(handle) {
  const out = [];
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== 'file' || !BACKUP_RE.test(name)) continue;
    let size = 0, modified = 0;
    try { const f = await entry.getFile(); size = f.size; modified = f.lastModified; } catch (_) {}
    out.push({ name, date: name.slice(PREFIX.length, PREFIX.length + 10), size, modified });
  }
  out.sort((a, b) => b.date.localeCompare(a.date) || b.modified - a.modified);
  return out;
}

export async function readBackupByName(handle, name) {
  const fh = await handle.getFileHandle(name);
  const file = await fh.getFile();
  return JSON.parse(await file.text());
}

// --- writing ---------------------------------------------------------------
// Date-only name → same-day backups overwrite. Returns {name, date}.
export async function writeBackup(handle, data) {
  const date = localDateStr();
  const name = backupNameFor(date);
  const fh = await handle.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(data, null, 2));
  await w.close();
  return { name, date };
}

// Keep the newest `keep` dated backups; delete the rest. NEVER touches the
// pre-restore file or anything not matching BACKUP_RE.
export async function rotateBackups(handle, keep = 2) {
  const all = await listBackups(handle); // newest-first
  for (const b of all.slice(keep)) {
    if (!BACKUP_RE.test(b.name)) continue; // double safety
    try { await handle.removeEntry(b.name); } catch (_) {}
  }
}

// --- pre-restore snapshot (single-level undo) ------------------------------
export async function writePreRestoreSnapshot(handle, data) {
  const fh = await handle.getFileHandle(PRERESTORE_NAME, { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(data, null, 2));
  await w.close();
}
export async function readPreRestoreSnapshot(handle) {
  try {
    const fh = await handle.getFileHandle(PRERESTORE_NAME);
    const file = await fh.getFile();
    return JSON.parse(await file.text());
  } catch (_) { return null; }
}

// --- restore from any file (outside the folder, or no-FS-API fallback) -----
export async function readBackupViaFilePicker() {
  if ('showOpenFilePicker' in window) {
    const [fh] = await window.showOpenFilePicker({
      id: DIR_PICKER_ID,
      types: [{ description: 'JSON backup', accept: { 'application/json': ['.json'] } }],
      multiple: false,
    });
    const file = await fh.getFile();
    return JSON.parse(await file.text());
  }
  // Legacy <input type="file"> fallback (Safari/iOS, older browsers).
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) { reject(new DOMException('No file selected', 'AbortError')); return; }
      try { resolve(JSON.parse(await file.text())); } catch (e) { reject(e); }
    });
    input.click();
  });
}
