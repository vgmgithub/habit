# Feature: Consistency-streak growth artwork

## Objective

Replace the plain `🌱` emoji used for the app-wide **consistency streak** with a tree that
**visibly grows through stages as the streak climbs** — inspired by the Windows taskbar
search-box plant-over-soil graphic. Reinforces "keep showing up → watch it grow."

## Final state — 6 growth stages

The user supplied a stock illustration (watering can → sprout → sapling → medium tree → big
tree). It was split into standalone transparent PNGs, one per growth stage, plus a synthesized
6th "grand tree".

| Streak (days) | Stage name | File | Natural size |
|---|---|---|---|
| 1–50 | Planting (watering can) | `icons/growth-1.png` | 96×86 |
| 51–100 | Sprouting | `icons/growth-2.png` | 43×52 |
| 101–150 | Young sapling | `icons/growth-3.png` | 56×101 |
| 151–200 | Growing tree | `icons/growth-4.png` | 117×204 |
| 201–250 | Mature tree | `icons/growth-5.png` | 232×303 |
| 251+ | Grand tree | `icons/growth-6.png` | 310×352 (synthesized) |

`icons/growth-ref.png` (600×350) is the original combined reference (white bg removed).

## How the images were produced (Pillow / Python)

1. Captured the reference from the clipboard (`Get-Clipboard -Format Image`), saved as
   `growth-ref.png`, and made the white background transparent (R,G,B > 240 → alpha 0).
2. **Split into stages 1–5** via connected-component analysis: BFS over the alpha channel
   labels each contiguous blob, and blobs are assigned to a stage by their min-x band.
   This avoids the cross-stage bleed that simple rectangular crops produced (the medium/big
   tree canopies touch).
3. **Stage 6 ("grand tree") is synthesized from stage 5**, because the reference only has 5:
   - Back crown: whole canopy mirrored, enlarged ~1.28×/1.16×, raised behind the original.
   - Original tree composited on top.
   - **Bulkier trunk:** the trunk strip (below the fork) is widened per-row, 1.18× → 1.65×
     at the base, for a natural flare with no seam.
   - A **solid leaves-only front foliage mass** (brown branch pixels AND their white outlines
     removed) hides the fork and the four low limbs, so the crown bottom is clean leaves.
   - Cleanup passes removed stray light/desaturated pixels and tiny islands near the trunk.

   **Lessons (if regenerating):** feathered alpha masks leave ghost smears; cloned canopy
   pieces carry embedded branch pixels (strip browns *and* their white outlines); the trunk
   widening must start *below* the fork or it smears limb outlines into diagonal dashes.
   A separate "level 7" was prototyped and removed — **6 levels is final.**

## Where it's shown in the app

`js/app.js` maps streak → tier and renders the image:

```js
function growthIcon(streak) {           // ≤50→1, ≤100→2, ≤150→3, ≤200→4, ≤250→5, else 6
  const tier = streak <= 50 ? 1 : streak <= 100 ? 2 : streak <= 150 ? 3
    : streak <= 200 ? 4 : streak <= 250 ? 5 : 6;
  return `./icons/growth-${tier}.png`;
}
function growthImg(streak, cls) { return h('img', { class: cls, src: growthIcon(streak), alt: '' }); }
```

Three placements (all replaced the old `🌱`):
- **Today header** consistency badge — `.cs-badge-art` (22px), next to the streak number.
- **Insights** consistency hero — `.cs-hero-art` (120px), above the big number.
- **Stats** "Consistency streak" tile — `.tile-growth-art` (26px) as the tile icon.

CSS for all three sizes is in `css/styles.css`. Streak value comes from
`M.consistencyStreak(...)`.

## Offline / caching

`sw.js` precaches `growth-1.png … growth-6.png` (CACHE bumped to `habits-v18` when added;
later `habits-v19` for the quotes feature). After changing any image, bump `CACHE` and
hard-refresh.

## Dev preview

`demo-consistency.html` renders all 6 stages side by side with their day ranges — used to
iterate on the artwork without touching the app. Open at
`http://localhost:8765/demo-consistency.html`.
