# HabitTracker PWA — Session Context

> Raw running session log / decision history. For organized docs see [README.md](README.md).

## Project
Private, offline-first habit tracker PWA served from `C:\Apache24\htdocs\habit` (Apache htdocs).
Same family as the user's MyNotes / Stocks PWAs. Vanilla JS, no build step.

**Structure:**
- `index.html` — app shell (Today / Tracker / Stats / Insights / Habits tabs, PIN lock, modal + toast hosts)
- `js/app.js` — controller, `js/model.js` — logic, `js/db.js` — IndexedDB
- `css/styles.css`, `sw.js` (offline), `manifest.webmanifest`, `icons/`
- `demo-consistency.html` — standalone demo page for the consistency-streak growth artwork
- `.claude/launch.json` — dev server: `python -m http.server 8765`

## Consistency growth artwork — history
Goal: the Insights "consistency streak" hero should show a growing plant/tree
(inspired by the Windows taskbar search-box plant-over-soil graphic), instead of a plain number + 🌱 emoji.

Iterations (all in `demo-consistency.html`):
1. v4 (previous session): 9 hand-coded SVG tiers (dug hole → seed → sprout → … → tree with bird flock). **Rejected.**
2. v5: simplified SVG, cleaner palette. **Rejected** — tiers 6–9 "look worst, not realistic".
3. Realistic-branch SVG attempt. **Rejected.**
4. User supplied a stock illustration (watering can → sprout → sapling → medium tree → big tree)
   and asked to **use the actual image, split into 4 categories** (drop the watering-can stage).

## Current state (2026-06-10) — DONE
`demo-consistency.html` rewritten to a **CSS/JS sprite-crop** approach:
- `icons/growth-ref.png` (600×350): the reference illustration, captured from the user's
  clipboard via PowerShell `Get-Clipboard -Format Image`, then **white background removed**
  (Pillow: pixels with R,G,B > 240 → transparent).
- Rectangular sprite crops bled between touching canopies, so the image was **split into 5
  standalone PNGs** (`icons/growth-1.png` … `growth-5.png`) via connected-component analysis
  (pure-Python BFS over the alpha channel; each component assigned to a stage by its min-x band:
  <130 / <195 / <258 / <350 / rest). Zero cross-stage bleed.
- Each card shows its own image, bottom-center via flexbox, with a per-tier `scale`
  (max-height %) so smaller stages render smaller: 0.42 / 0.34 / 0.55 / 0.80 / 1.00.
- **6 levels** (user's final spec):
  | Days | Name | File |
  |---|---|---|
  | 1–50 | Planting (watering can) | growth-1.png 96×86 |
  | 51–100 | Sprouting | growth-2.png 43×52 |
  | 101–150 | Young sapling | growth-3.png 56×101 |
  | 151–200 | Growing tree | growth-4.png 117×204 |
  | 201–250 | Mature tree | growth-5.png 232×303 |
  | 251–300 | Grand tree | growth-6.png 310×352 (synthesized) |
- `growth-6.png` (310×352) **synthesized from growth-5.png** (Pillow). Final recipe:
  (1) back crown: whole canopy mirrored, 1.28×/1.16×, raised 46px;
  (2) original tree;
  (3) bulky trunk: per-row widened strip from y200 (below fork; 1.18× → 1.65× at base);
  (4) SOLID front foliage mass hiding the fork + all 4 low limbs: leaves-only canopy
  (brown AND white-outline pixels removed) stacked at 5 offsets to close holes, ×0.92,
  pasted over the fork; trunk emerges below it;
  (5) cleanup passes: desaturated-light pixel sweep beside trunk, small-island despeckle,
  two small flanking leaf clusters to hide last limb remnants.
  Lessons: feathered alpha masks ghost; front canopy layers carry embedded branch pixels
  (strip browns AND their white outlines); trunk strip must start below the fork or
  widening smears limb outlines into diagonal dashes.
  (A separate level 7 was tried and removed at the user's request — 6 levels is final.)

## Live-app integration — DONE (2026-06-10)
- `js/app.js`: added `growthIcon(streak)` (tier by day ranges: ≤50→1, ≤100→2, ≤150→3,
  ≤200→4, ≤250→5, else 6) + `growthImg(streak, cls)` helper (near `tile()`).
- Replaced the 🌱 emoji with the growth artwork in 3 places:
  Today header consistency badge (`.cs-badge-art`, 22px), Insights consistency hero
  (`.cs-hero-art`, 120px, above the number), Stats "Consistency streak" tile
  (`.tile-growth-art`, 26px). CSS added in `css/styles.css`.
- `sw.js`: CACHE bumped to `habits-v18`, `growth-1..6.png` added to precache.
- Gotcha: the SW is cache-first; after deploys users need a hard refresh (and the SW
  install can even precache from the browser HTTP cache — clear `caches` if assets look stale).

## Motivational quotes on Today — DONE (2026-06-13)
Offline, category-based motivational quote card on the Today tab, below the header/streak,
above the habit cards. Hidden only when there are zero habits.
- **Tone** from yesterday's completion tier; **flavor** from the dominant scheduled category.
- `js/quotes.js` (NEW): `QUOTES[category][tier]` bank (categories Health/Mindfulness/
  Productivity/Personal care/General; tiers allDone/partial/none/fresh; ~5 each, original
  lines + short attributed classics). `TIER_EMOJI` map. `pickQuote(category, tier, seed)`
  with General fallback. Precached in `sw.js` (CACHE bumped to `habits-v19`).
- `js/model.js`: `yesterdayQuoteContext(habits, logsByHabit, today)` → `{tier, category}`.
  Reuses `rangeCompletion(...,y,y)`. Tier rule: **sched===0 → 'fresh'** (rest day / brand
  new — never a guilt nudge), done===0 → 'none', done>=sched → 'allDone', else 'partial'.
  Category = most-scheduled (non-paused) category yesterday, else 'General'.
- `js/app.js`: `quoteCard(today)` renderer + `hashStr()`; inserted in `renderToday` after the
  head. Deterministic per-day seed (no flicker); `state.quoteCycle` increments on tap →
  card replaced in place (tap-to-cycle). Tier-matched emoji animates (`quotePop`) on entry.
- CSS `.quote-card` in `styles.css`: tier color tints (allDone=accent, partial=blue,
  none=amber), `quotePop` keyframe, `prefers-reduced-motion` respected.
- Verified: all 4 tiers + category flavor via direct module import; 3 tier cards render with
  correct colors/animation/author; no console errors. (Couldn't see it in the live Today
  screen — the preview profile has 0 habits, so the card correctly returns null.)

## Fingerprint unlock fix — DONE (2026-06-13)
Symptom: "fingerprint option is not working." Root cause: the WebAuthn calls were correct,
but **all errors were swallowed** by the catch blocks and reported as a generic
"Couldn't set up fingerprint." The most common real blocker is **secure context** —
WebAuthn only works on `https://` or `http://localhost`/`127.0.0.1`. Served from Apache via a
LAN IP/hostname (e.g. `http://192.168.x.x/habit`), `PublicKeyCredential` still *exists* (so the
option appears), but `create()`/`get()` throw `SecurityError`.
- `js/app.js`: added `biometricSupported()` (interface present) and `biometricUsable()`
  (`+ window.isSecureContext`). `registerFingerprint()`/`verifyFingerprint()` now return
  `{ok, error}` with a `fpErrorMessage(e, verb)` mapper (NotAllowedError/InvalidStateError/
  SecurityError/NotSupportedError/AbortError) and `console.warn` the raw error.
- Settings row: button disabled when no PIN **or** not a secure context; hint explains which.
- Lock screen: biometric button only shown when `biometricUsable()`; shows the specific error;
  subtitle no longer promises fingerprint in an insecure context.
- `sw.js`: CACHE bumped to `habits-v20`.
- **User-facing fix:** open the app at `http://localhost/habit/` (or set up https) — not an IP
  or machine-name URL — and ensure Windows Hello / a fingerprint is enrolled in the OS.

## Backup & Restore — DONE (2026-06-14)
Single Settings entry "Backup & Restore" (replaced old Export/Import rows) → routes to Fallback /
Setup / Main sheet. File System Access API; backups to a user-chosen folder, auto-rotate, one-tap
restore, survive clear-site-data. Decisions: slug `habits`, **keep 2**, restore preserves device
PIN + folder handle. New `js/backup.js`; `app.js` flows/sheets; `.backup-*` CSS; `sw.js` → v21.
Strict naming `habits-backup-YYYY-MM-DD.json` (same-day overwrite), prerestore `habits-prerestore.json`,
rotation only deletes regex-matching files. Full details: docs/features/backup-restore.md.

## Manual service-worker updates — DONE (2026-06-14)
Default PWA patterns auto-reload when new SWs install (`skipWaiting()` in install), causing
surprise page reloads mid-flow. This feature gates activation behind user consent: SWs install
→ stay waiting → user taps "Update available" / "Check for updates" → reload only then.
- `sw.js`: removed `skipWaiting()` from install, added `message` listener for explicit
  `SKIP_WAITING` (the only activation path). `updateViaCache: 'none'` in registration options
  (no HTTP cache hiding updates for 24h). CACHE bumped to v22.
- `js/app.js`: registered SW with options, detect waiting SWs, `checkForUpdates()` function
  (check network, apply if waiting). Settings "App updates" menu item flips label based on
  `window.__updateReady`. controllerchange listener reloads (only when user triggers skip-wait).
- Full details: docs/features/manual-updates.md. Verified: button click works, "Checking for
  updates" toast fires, no surprise reloads.

## Next steps
- Optional: animate tier-up transitions / celebration when crossing a tier boundary.
- Backup & Restore manual tests (need real OS picker / Safari): folder pick → main sheet, real
  file writes, live restore + reload, prerestore presence, clear-site-data re-pick, fallback sheet.
- Note: licensing — the illustration is a stock image the user supplied; app is private/personal use.

## Notes
- Plan file: `C:\Users\016142\.claude\plans\gleaming-sauteeing-wreath.md`
- Previous session: "Exploring - TSK2" (`local_81f9703c-...`), where the app + v4 art were built.
