# Architecture

Vanilla-JS PWA, no build step, no dependencies. ES modules loaded directly by the browser.

## File map

```
habit/
├── index.html              App shell: appbar, <main id="app">, bottom tab bar
│                           (Today/Tracker/Stats/Insights/Habits), lock screen,
│                           modal-root + toast-root. Inline pre-paint theme script.
├── manifest.webmanifest    PWA manifest (installable, theme color #10b981)
├── sw.js                   Service worker — precaches the app shell + assets,
│                           cache-first with network refresh. Bump CACHE on deploy.
├── css/styles.css          All styles. CSS variables for theming (light/dark/auto + accent).
├── js/
│   ├── app.js              Controller + UI. State, render(), per-view renderers,
│   │                       DOM helper h(), all event handling.
│   ├── model.js            Pure logic: date math, scheduling, streaks, completion,
│   │                       insights, categories, milestones. No DOM, no storage.
│   ├── db.js               Promise-based IndexedDB wrapper (3 stores) + settings helpers.
│   └── quotes.js           Offline motivational quote bank + pickQuote() (see quotes doc).
├── icons/                  PWA icons + growth-1..6.png (consistency artwork) + growth-ref.png
├── demo-consistency.html   Standalone demo of the 6 growth stages (dev/preview only)
├── docs/                   This documentation
└── .claude/launch.json     Preview server config (python http.server on :8765)
```

## Data model (IndexedDB — db name `habittracker`, v1)

Three object stores (see `js/db.js`):

- **`habits`** (keyPath `id`) — habit definitions. Indexes: `archived`, `order`.
  Notable fields: `id`, `name`, `emoji`, `color`, `categories[]` (legacy single `category`
  is migrated to the array), `frequency` ({type: 'daily'|'weekly'|…}), `routine`
  ('morning'|'afternoon'|'evening'|'anytime'), `priority` (pinned), `pauses[]`,
  `archived`, `order`, `createdAt`.
- **`logs`** (keyPath `` `${habitId}|${date}` ``) — one row per habit per day (de-dup for free).
  Fields: `id`, `habitId`, `date` (YYYY-MM-DD), `status` ('done'|'skipped'|'pending'),
  `reason` (miss reason key). Indexes: `habitId`, `date`.
  Wrap-up completion is logged against the synthetic habit id `M.WRAPUP_HABIT_ID` (`__wrapup__`).
- **`meta`** (keyPath `key`) — settings/app state (theme, accent, pinHash, reminders,
  wrapUp config, userName, customCategories, fpCredId, …). Access via `getSetting`/`setSetting`.

Predefined categories: `Health`, `Mindfulness`, `Productivity`, `Personal care` (+ user customs).

## App runtime (`js/app.js`)

- **`state`** — in-memory cache: `habits[]`, `logsByHabit` (Map id→logs[]), `settings`,
  `view`, `quoteCycle`, timers, `trackerMonth`. Loaded once; mutations write through to
  IndexedDB and re-render.
- **`h(tag, props, ...kids)`** — tiny hyperscript DOM builder (handles `class`, `html`,
  `dataset`, `style` object, `on*` listeners, nested/array children, text).
- **`render()`** (line ~378) dispatches to the per-view renderer based on `state.view`:
  - `renderToday()` — greeting, date, consistency badge + ring, **motivational quote card**,
    Focus section, routine groups of habit cards, wrap-up CTA, insight tile.
  - `renderInsights()` — **consistency hero (growing tree)**, headline insight, breakdowns.
  - `renderTracker()` — month calendar / heatmap.
  - `renderStats()` — metric tiles (incl. consistency streak tree), per-habit stats.
  - `renderHabits()` — habit list + CRUD, category management.
  - `renderSettings()` — theme/accent, PIN, wrap-up, reminders, data export.

## Key `model.js` functions (pure, testable)

Dates: `ymd`, `todayStr`, `parseYmd`, `addDays`, `weekday`, `weekKey`, `startOfWeek`.

Scheduling / streaks:
- `isScheduled(habit, dateStr)`, `isPausedOn(habit, dateStr)`
- `currentStreak`, `bestStreak` (per habit; pauses neutral)
- `consistencyStreak`, `bestConsistencyStreak` (app-wide: a day "counts" if any habit done
  OR wrap-up completed — see `isEngagedDay`)

Completion:
- `rangeCompletion(habits, logsByHabit, from, to)` → `{done, sched, pct}` (skips paused
  habits and pre-creation days). Backbone for week/month/yesterday metrics.
- `thisWeekCompletion`, `prevWeekCompletion`, `thisMonthCompletion`
- `yesterdayQuoteContext(habits, logsByHabit, today)` → `{tier, category}` (powers the quote)

Stats / insights: `habitStats`, `lastNStats`, `recentHeatmap`, `heatmapData`,
`reasonBreakdown`, `bestDayOfWeek`, `topReasonForHabit`, `pickInsight`, `priorityScore`.

Milestones: `MILESTONES`, `reachedMilestone(prev, next)` (drives streak toasts).

## Conventions

- Dates are local `YYYY-MM-DD` strings everywhere (`ymd`/`todayStr`), never raw Date in storage.
- Reference files in code review as `path:line`.
- After changing previewable code, bump `sw.js` `CACHE` and hard-refresh.
