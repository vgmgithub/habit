# Growth-icon improvement — parked task & context

This folder holds an experiment that is **not wired into the app**. It is kept
here so a future model/tool with image capabilities can pick it up.

## The goal
Improve the **consistency-streak growth icons** shown in the Insights tab
(the plant/tree that grows as the streak climbs).

Source files: `../icons/growth-1.png` … `growth-6.png`
They depict a realistic clipart growth journey:
watering can + seed → sprout → sapling → young tree → bigger tree → mighty oak.
Used by `js/app.js` → `growthIcon(streak)` / `growthImg()` and the
`.cs-hero-art` hero in `renderInsights()`.

## The problems to fix
1. **Pixelation** — the PNGs are low-resolution (e.g. `growth-1.png` is 96×86).
   When the Insights hero renders them ~140px they look blocky.
2. **White edge halo on dark mode** — the PNGs have a thin semi-transparent
   light fringe on their alpha edges; against the dark background it reads as
   faint white outlines.

## What the user wants
- **Keep the SAME realistic images / art style.** Just render them with more
  clarity. They explicitly did NOT want a different (flat-vector) look.

## What was tried (this demo)
`growth-demo.html` — a flat-vector SVG redraw of all six stages (badge tiles,
theme-aware, crisp at any size), shown side-by-side with the current PNGs, with
a light/dark toggle. Open at: `http://localhost/habit/demo/growth-demo.html`

**Outcome:** rejected. The flat-vector style is crisp and theme-aware but is a
*different* look; the user wants the original realistic art, just sharper.
The SVG demo is retained only as a reference for the "theme-aware + crisp"
properties, not the style.

## Why it wasn't done (my limitation / requirement)
I (the assistant in this CLI session) could not reproduce the *same* realistic
art at higher fidelity:
- **No image-generation or AI-upscaling capability** in this environment to
  re-render the existing clipart at higher resolution.
- **Hand-vectorizing** that detailed, shaded clipart by hand does not faithfully
  reproduce it — it drifts into a different style (which the user rejected).
- The lost detail is **not recoverable** from the low-res source by code alone.

## What a future model/tool would need to actually do this
Pick whichever applies:
1. **AI image upscaler** (e.g. a super-resolution / "uncrop"-style model) to take
   each `growth-N.png` to ~2–4× resolution while preserving the style, then
   re-export. Target ≥ 512px on the long edge so the 140px hero is razor-sharp.
2. **Generative re-render**: feed the existing PNG as a style/reference image and
   ask for a high-resolution version in the same illustration style.
3. **Edge defringe (achievable with a plain image library, no AI):** this fixes
   ONLY the dark-mode white halo, not the pixelation. Approach: load each PNG
   with an image lib (Python Pillow / Node sharp), for every pixel with low
   alpha pull its RGB toward the neighboring opaque colour (kill the white
   premultiplied fringe), or erode the alpha by ~1px. Re-export as PNG.
   - This is the one piece I *could* do here if asked, but the user chose to
     leave it for now.

## Integration notes (once better assets exist)
- Drop the improved PNGs in place of `icons/growth-1.png` … `growth-6.png`
  (same filenames) — no code change needed; `growthIcon()` maps streak→tier→file.
- If switching to SVG instead, change `growthImg()` in `js/app.js` to return
  inline `<svg>` (so it inherits theme colours) instead of an `<img>`, and add
  the files to the `sw.js` precache list. Bump the `CACHE` version.
- Tier thresholds live in `growthTier(streak)` in `js/app.js`
  (≤50, ≤100, ≤150, ≤200, ≤250, else) and double as the "Level N" label.
