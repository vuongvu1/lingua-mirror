# Lingua Mirror — Plan 3: Synchronized Hover-Highlight + Synced Scroll (Design)

**Status:** Approved design, ready for implementation planning
**Date:** 2026-06-08
**Milestone:** Plan 3
**Parent spec:** `docs/superpowers/specs/2026-06-05-language-split-extension-design.md`
(see "Core feature: synchronized hover-highlight")

## Summary

Make the bilingual split *interactive*. Hovering any sentence in either pane
highlights that sentence **and its translation twin in the other pane**
simultaneously, and scrolling one pane scrolls the other so the twin is usually
already on-screen. This is the payoff feature the earlier plans set up: Plan 2
already tags every sentence in both panes with a shared `data-pair-id`, so the
highlight is an exact ID lookup — no fuzzy text matching.

## Goals

- Hover a sentence → it and its `data-pair-id` twin light up, in both directions
  (hover left → right twin highlights, and vice-versa).
- Scrolling one pane keeps the other roughly aligned so twins stay visible.
- Survive the site's own CSS (highlight must win against arbitrary page styles).
- Work whether or not a sentence has been translated yet (pair-IDs exist before
  translation fills the left pane).
- Stay consistent with Plans 1–2: pure/testable logic in `src/`, thin glue in
  `entrypoints/content.ts`, one job per module.

## Non-goals (this plan)

- Pair-anchored ("align the same sentence to the top") scroll sync — proportional
  sync is sufficient for v1 (see Key decisions).
- Differentiated styling for the hovered sentence vs. its twin — both get the
  identical highlight.
- Keyboard/focus-driven highlight, click-to-pin, touch interactions — mouse hover
  only for v1.
- Any change to segmentation, pairing, or translation (Plan 2 owns those).

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Highlight lookup | Direct `data-pair-id` match | Pairing guarantees matched IDs in both panes; exact and fast, no text matching. |
| Highlight application | `data-lm-highlight` attribute + injected CSS rule with `!important` | Same pattern as the existing layout `<style>`; robust against site CSS; no need to save/restore inline styles. |
| Listener placement | Delegated `mouseover` + `mouseleave` on `#ls-root` | `#ls-root` contains *both* panes, so one listener pair is bidirectional for free; `mouseleave` clears when the pointer exits both panes. |
| Highlight style | Identical on hovered + twin; soft yellow (`#fff3a3`) bg + subtle rounded outline | Cleanest "these two match" signal; minimal logic. |
| Scroll sync | Proportional (relative position) | Panes differ in content height (a translation runs longer/shorter); proportional keeps twins usually on-screen without depending on pairing. Matches the parent spec's stated goal. |
| Module split | Two pure modules (`highlight.ts`, `synced-scroll.ts`) + glue | One job each; each unit-testable in isolation. |

## Architecture

Two new pure modules in `src/`, wired by `entrypoints/content.ts`. No new
entrypoints, no settings, no messaging changes.

### `src/highlight.ts` — hover engine

```
linkHover(root: HTMLElement): { destroy(): void }
export const HIGHLIGHT_CSS: string   // for the glue to inject
```

- Attaches a delegated `mouseover` listener on `root` (`#ls-root`, which contains
  both panes) plus a `mouseleave` listener on `root`.
- On each `mouseover`, resolves `event.target.closest("[data-pair-id]")`:
  - **New id** → clear the previously highlighted elements, then set the
    `data-lm-highlight` attribute on **every** `[data-pair-id="<id>"]` within
    `root` (matches the hovered element and its twin — 1 or 2 elements).
  - **No match** (moved into a text gap/padding) → clear.
- On `mouseleave` (pointer exits both panes — e.g. onto the controls bar or out of
  the window) → clear. `mouseover` alone never fires in that case, so this is what
  releases a lingering highlight.
- Tracks the currently highlighted id so re-entering the same sentence is a cheap
  no-op.
- `destroy()` removes both listeners and clears any active highlight.
- The module performs **no `document`-level side effects** — it only mutates the
  `root` passed in. The CSS rule lives in the exported `HIGHLIGHT_CSS` constant:
  `[data-lm-highlight]{ background:#fff3a3 !important; border-radius:3px; box-shadow:0 0 0 2px #fff3a3; }`
  The glue injects it. This keeps the module pure and unit-testable.

Works on untranslated spans (pair-IDs exist before translation) and on
block-fallback elements (the attribute toggles regardless of element type).

### `src/synced-scroll.ts` — proportional sync

```
computeMirroredScrollTop(source: Element, target: Element): number
linkScroll(a: HTMLElement, b: HTMLElement): { destroy(): void }
```

- `computeMirroredScrollTop` — pure: `ratio = source.scrollTop /
  max(1, source.scrollHeight − source.clientHeight)`, returns
  `ratio × (target.scrollHeight − target.clientHeight)`. The thoroughly tested core.
- `linkScroll` — attaches `scroll` listeners both ways. A re-entrancy guard
  prevents A→B from ricocheting back B→A: when a programmatic scroll is applied to
  the target, the guard is set and reset on the next `requestAnimationFrame` (so a
  no-op `scrollTop` assignment that fires no scroll event cannot leave the guard
  stuck). `destroy()` removes both listeners.

### Wiring in `entrypoints/content.ts` (glue)

- **Scroll sync** — wired right after `buildSplitView`; needs no pair-IDs, so it
  works even when the page has no `<html lang>` (the prompt-for-language case).
- **Highlight** — wired right after `pairPanes` succeeds (it needs the pair-IDs);
  `HIGHLIGHT_CSS` injected once into `<head>` (idempotent; left in place on
  destroy like the layout style — inert without the attribute present).
- **Teardown** — `teardown()` calls `highlight?.destroy()` and
  `scrollSync?.destroy()` alongside the existing cleanup; `resync()` re-wires both.

## Data flow

```
mouseover on #ls-root
  → target.closest("[data-pair-id]")
  → id changed?  clear old [data-lm-highlight], set on all [data-pair-id="id"] in root
  → no match?    clear
mouseleave #ls-root → clear
(CSS rule paints both the hovered sentence and its twin)

scroll on pane A
  → guard set; B.scrollTop = computeMirroredScrollTop(A, B); reset guard next frame
(and symmetrically for B → A)
```

## Edge cases & handling

- **Twin missing** (defensive — pairing always produces matched IDs): toggle
  whatever matches in `root` (0, 1, or 2 elements); never throw.
- **Hovering a gap** between spans (whitespace text node, block padding):
  `closest` returns null → clears the highlight. Expected.
- **Rapid pointer movement**: the current-id check makes unchanged re-hovers a
  no-op; no thrash.
- **Untranslated sentences**: highlight works regardless, since pair-IDs are
  assigned before translation fills the left pane.
- **Zero-scrollable pane** (content shorter than viewport): the `max(1, …)`
  denominator avoids division by zero; mirrored `scrollTop` is 0.
- **No `<html lang>` / no pairing**: scroll sync still runs; highlight simply has
  nothing to match — no error.

## Testing

- **`src/highlight.test.ts`** (happy-dom): dispatch `mouseover` on a sentence and
  assert `data-lm-highlight` lands on **both** twins; moving to another sentence
  moves the highlight; moving into a gap clears it; `mouseleave` on root clears it;
  the block-fallback element case highlights the block; `destroy()` removes the
  listeners and clears state.
- **`src/synced-scroll.test.ts`**: unit-test `computeMirroredScrollTop` across
  height ratios (target longer / shorter / equal / zero-scrollable source); test
  `linkScroll`'s loop-guard with stubbed `scrollHeight`/`clientHeight` so a single
  user scroll produces exactly one mirrored write and no ricochet.
- **Glue** (`content.ts`) — verified by `pnpm compile` + manual e2e (hover both
  directions on a real translated page; confirm synced scrolling keeps twins
  visible; confirm close/re-sync wire and unwire cleanly).

## Done criteria

- `pnpm test` passes (new `highlight` and `synced-scroll` suites + existing green).
- `pnpm compile` clean.
- On a translated page, hovering a sentence in either pane highlights it and its
  twin; scrolling one pane keeps the other aligned.
- Highlight wins against site CSS and clears correctly on exit.
- Close / second toggle / re-sync wire and unwire highlight + scroll without leaks.
