# Feature: Backup & Restore

## Objective

One combined **Backup & Restore** flow in Settings (replaces the old separate Export/Import
rows). Uses the **File System Access API** so backups live in a dedicated user-chosen folder
(not Downloads), **auto-rotate**, and restore is one tap. Because the files live outside the
browser sandbox, they **survive "clear site data."**

## Single entry point → three sheets

`openBackupRestore()` (Settings → "Backup & Restore") routes to:

1. **Fallback sheet** — when `window.showDirectoryPicker` is undefined (Safari/iOS/Firefox).
   "Backup now" downloads JSON to the OS Downloads folder (`<a download>`); "Restore from file"
   opens a file picker. (`openBackupFallbackSheet`)
2. **Setup sheet** — no folder saved yet. One-line explanation + "Choose backup folder"
   (`showDirectoryPicker({ id:'habits-backups', mode:'readwrite', startIn:'documents' })`),
   plus a footer "Restore from a backup file…" for first-time recovery. (`openBackupSetupSheet`)
3. **Main sheet** — folder set + accessible. Folder name + Change link, "Backup now" +
   "Last: <date>", a "Recent backups" list (newest, each with Restore), and a footer
   "Restore from a file outside this folder…". Shows a "Reconnect folder" state if permission
   lapsed. (`openBackupMainSheet`)

## File naming (strict)

- Backups: **`habits-backup-YYYY-MM-DD.json`** — date only, **same-day backups overwrite** (no
  timestamps).
- Pre-restore snapshot: **`habits-prerestore.json`** — single file, overwritten each restore.
- Rotation regex: **`/^habits-backup-\d{4}-\d{2}-\d{2}\.json$/`**. **Only files matching this are
  ever deleted.** Foreign files, the prerestore file, and oddly-named files are left untouched
  (the user may pick a shared folder).
- App slug = `habits` (matches the filename the old Export already produced).

## Rotation

After every successful backup: list matching files → sort by date desc → delete everything
beyond the newest **`BACKUP_KEEP = 2`** (in `app.js`). Pre-restore file is never touched.

## Folder handle persistence

The `FileSystemDirectoryHandle` is stored directly in IndexedDB `meta` under
**`backupFolderHandle`** (structured-cloneable). After "clear site data" the handle is lost but
the files survive — re-picking the same folder makes the list reappear.

`ensureFolderPermission(handle, mode)` queries, then requests permission — must run from a
user-gesture (the menu/button taps satisfy this).

## Pre-restore safety net + restore

Before **any** restore (in-folder row or outside file), the current state is written to
`habits-prerestore.json` (best-effort — if it fails, log and continue, never block the restore).
This is a single-level "oops" undo: recover via "Restore from a file outside this folder…" →
pick the prerestore file.

Confirm dialog: *"Restore from <date>? This REPLACES all your current data with the backup.
Any edits made since that backup will be lost. A safety snapshot of your current state will be
saved as 'prerestore' first."* → write prerestore → `applyRestore` → toast
`"Restored · <date> · reloading…"` → reload after 900 ms.

**`applyRestore(data)` semantics (REPLACE):** clears all stores, then bulk-puts habits/logs and
puts meta — but **preserves this device's `pinHash` and `backupFolderHandle`** so the user isn't
locked out and the folder stays linked after reload. `buildBackupData()` excludes `pinHash` and
`backupFolderHandle` from the written JSON.

## Files

- `js/backup.js` (NEW) — all File System Access helpers. Exports: `fileSystemAccessSupported`,
  `getSavedFolder`, `saveFolder`, `forgetFolder`, `ensureFolderPermission`, `pickFolder`,
  `listBackups`, `readBackupByName`, `writeBackup`, `rotateBackups`, `writePreRestoreSnapshot`,
  `readPreRestoreSnapshot`, `readBackupViaFilePicker`, `BACKUP_SLUG`. Imports `getSetting`/
  `setSetting` from `db.js` for handle persistence.
- `js/app.js` — `buildBackupData`, `applyRestore`, `runRestore`, `restoreFromOutsideFile`,
  `downloadBackup`, `openBackupRestore` + the three sheet renderers; the single Settings row.
  (Old `exportData`/`importData` removed.) `BACKUP_KEEP = 2`.
- `css/styles.css` — `.backup-*` styles + `.linkish`, `.btn.small`.
- `sw.js` — precaches `js/backup.js`; `CACHE` bumped to `habits-v21`.

## Verification

Automated (headless Chromium, mock directory handle): same-day overwrite → one file with
latest content; strict filename format; rotation keeps newest 2, deletes only matching, and
**preserves foreign + prerestore + bad-named files**; `listBackups` newest-first; prerestore
round-trip. All 10 exports present; app boots with no console errors; Settings shows a single
"Backup & Restore" row (old Export/Import gone); entry point routes to the Setup sheet with the
correct controls.

Manual (need real OS interaction / other browsers — the user's listed scenarios): folder picker
→ main sheet, real file writes, live restore + reload, prerestore file presence in the file
manager, clear-site-data re-pick, and the Safari/iOS fallback sheet.
