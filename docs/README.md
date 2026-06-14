# HabitTracker PWA — Documentation

> Entry point for understanding the project and continuing work in a new session.

## Objective

A **private, offline-first habit tracker PWA** that helps the user build daily habits
through gentle, motivating feedback rather than guilt. It runs entirely on-device
(served from Apache `htdocs`), stores all data locally in IndexedDB, works fully offline
via a service worker, and is installable to the home screen.

Design principles:
- **Offline-first & private** — no backend, no network calls, no third-party data sharing.
- **Instant** — data is cached in memory after one load; every action is spinner-free.
- **Encouraging, not punishing** — pauses are neutral, rest days aren't failures, and
  the app celebrates progress (growing tree, motivational quotes).
- **Vanilla JS, no build step** — plain ES modules, hand-rolled DOM helper (`h()`).

## Document index

| Doc | What's in it |
|---|---|
| [architecture.md](architecture.md) | File/module map, data model (IndexedDB), key `model.js` functions, app state & view renderers. Read this first in a new session. |
| [features/consistency-growth.md](features/consistency-growth.md) | The growing-tree consistency-streak artwork: 6 growth-stage images, how they were produced, and where they're shown. |
| [features/motivational-quotes.md](features/motivational-quotes.md) | The Today-screen motivational quote card: tone (yesterday's completion) × flavor (habit category), the quote bank, and tap-to-cycle. |
| [features/backup-restore.md](features/backup-restore.md) | Backup & Restore via the File System Access API: user-chosen folder, auto-rotation, one-tap restore, pre-restore safety net. |
| [features/manual-updates.md](features/manual-updates.md) | Manual service-worker updates: no surprise reloads. New versions install silently; user taps to apply. |
| [CONTEXT.md](CONTEXT.md) | Raw running session log / decision history (kept verbatim). |

## How to continue in a new session

1. Read [architecture.md](architecture.md) for the lay of the land.
2. Check the **"Next steps / open ideas"** section below.
3. Dev server: from the project root, `python -m http.server 8765`
   (also defined in `.claude/launch.json` as the `habit` preview config).
   Open `http://localhost:8765/index.html`.
4. Standalone artwork demo: `http://localhost:8765/demo-consistency.html`.
5. **Service worker is cache-first.** After editing JS/CSS/images, bump `CACHE` in
   `sw.js` and hard-refresh (Ctrl+F5). If assets still look stale, clear `caches`
   in DevTools → Application, or unregister the SW.

## Work completed (this stream of sessions)

- **Consistency-streak growth artwork** — replaced the plain 🌱 emoji with a tree that
  grows through 6 stages as the streak climbs. See [features/consistency-growth.md](features/consistency-growth.md).
- **Motivational quotes on Today** — offline, category-aware quote card whose tone reflects
  yesterday's completion. See [features/motivational-quotes.md](features/motivational-quotes.md).
- **Backup & Restore** — File System Access API; backups in a user-chosen folder, auto-rotate,
  one-tap restore, survive clearing site data. See [features/backup-restore.md](features/backup-restore.md).
- **Manual service-worker updates** — no surprise reloads. New versions install silently;
  Settings → "Check for updates" or wait for "Update available" label. See [features/manual-updates.md](features/manual-updates.md).
- **Fingerprint unlock fix** — surfaced the real WebAuthn error + secure-context guard
  (see CONTEXT.md). Note: WebAuthn needs https:// or http://localhost.

(The core app — habits CRUD, scheduling, streaks, Tracker/Stats/Insights, daily Wrap-up,
PIN/biometric lock — was built in earlier sessions; see [architecture.md](architecture.md).)

## Next steps / open ideas

- Animate a tier-up transition / celebration when the streak crosses a growth boundary.
- (Earlier idea, not pursued) optional online quote fetching — deliberately skipped to
  keep the app fully offline & private.

## Notes

- Plan file (artwork work): `C:\Users\016142\.claude\plans\gleaming-sauteeing-wreath.md`
- Earliest session that built the app + first artwork: "Exploring - TSK2" (`local_81f9703c-…`).
- Licensing: the tree illustration is a stock image the user supplied; app is private/personal use.
