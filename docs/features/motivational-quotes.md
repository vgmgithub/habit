# Feature: Motivational quotes on Today

## Objective

Show **one** motivating, **offline** quote on the Today tab — below the date/streak header,
above the habit cards — whose **tone reflects yesterday's habit completion** and whose
**flavor matches the habit category**. Encouraging, never guilt-inducing.

## Behavior

- **Tone (tier)** comes from yesterday's completion:
  | Yesterday | Tier | Tone |
  |---|---|---|
  | everything scheduled was done | `allDone` | celebrate 🎉 |
  | some done (1–99%) | `partial` | positive + "you can do more" 💪 |
  | scheduled but 0 done | `none` | strong push 🔥 |
  | **nothing scheduled** (rest day / brand new) | `fresh` | gentle fresh-start 🌱 |

  > **Key rule:** `sched === 0` is `fresh`, **never** treated as failure. A rest day with
  > nothing scheduled must not show a "you did nothing" nudge.

- **Flavor (category)** = the most-scheduled (non-paused) category among yesterday's habits,
  falling back to `General` when there's no clear winner.

- **Interactive emoji:** the tier emoji **animates on entry** (`quotePop` keyframe) and the
  whole card is **tap-to-cycle** — tapping shows the next quote in the same bucket.

- **Stable per day:** the quote is seeded deterministically by date+tier+category, so it
  doesn't reshuffle on every re-render. Tapping is the only way to change it (in-memory
  `state.quoteCycle` offset). Hidden entirely when there are zero habits.

## Implementation

### `js/quotes.js` (the quote bank)

- `QUOTES[category][tier]` — categories `Health`, `Mindfulness`, `Productivity`,
  `Personal care`, `General`; tiers `allDone`, `partial`, `none`, `fresh` (~5 each). Only
  `General` populates `fresh`. Quotes are original lines + short, widely-attributed classics.
- `TIER_EMOJI` — emoji pool per tier.
- `pickQuote(category, tier, seed)` → `{text, author, emoji, tier}`. Falls back to the
  `General` bucket, then `General.fresh`, if a bucket is empty. Deterministic index from `seed`.

### `js/model.js`

```js
yesterdayQuoteContext(habits, logsByHabit, today) → { tier, category }
```
Reuses `rangeCompletion(habits, logsByHabit, yesterday, yesterday)` for `{sched, done}`.
Tier rule: `sched===0 → 'fresh'`, `done===0 → 'none'`, `done>=sched → 'allDone'`, else
`'partial'`. Category = most-scheduled non-paused category yesterday (else `'General'`).

### `js/app.js`

- `hashStr(s)` — small deterministic string hash for the per-day seed.
- `quoteCard(today)` — builds the `.quote-card` button (emoji + text + optional author),
  returns `null` when there are no active habits. Click handler bumps `state.quoteCycle` and
  replaces the card in place (re-runs the entry animation).
- Inserted in `renderToday()` right after the header, before the `!due.length` branch (so it
  also shows on rest days, which are about *yesterday*).
- `state.quoteCycle` added to the state object.

### `css/styles.css`

`.quote-card` with per-tier color tints (allDone = accent green, partial = blue, none =
amber), the `quotePop` emoji keyframe, and `@media (prefers-reduced-motion: reduce)` to
disable the animation.

### `sw.js`

`js/quotes.js` added to the precache; `CACHE` bumped to `habits-v19`.

## Verification notes

Logic verified by importing `quotes.js`/`model.js` directly in the preview and exercising all
four tiers (correct tone + category flavor + emoji). Card rendering verified via computed
styles (distinct tier colors, `quotePop` animation, author shown only when present); no
console errors. The live Today screen couldn't display it in the preview profile because it
has 0 habits (card correctly returns `null`) — it appears with real habit data.

## Decisions / scope

- **Offline only.** Online fetching from a quote API was discussed and **deliberately skipped**
  to preserve the app's private, offline-first design (generic APIs also can't match a habit's
  category well). Could be added later as an optional, off-by-default enhancement that caches
  fetched quotes into IndexedDB.
