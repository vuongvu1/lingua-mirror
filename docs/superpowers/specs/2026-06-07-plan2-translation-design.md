# Lingua Mirror — Plan 2: Translation (Design Spec)

**Status:** Approved design, ready for implementation planning
**Date:** 2026-06-07
**Builds on:** Plan 1 (Foundation & Split View, DONE) and the overall design at
`docs/superpowers/specs/2026-06-05-language-split-extension-design.md`.

## Summary

Plan 1 produces two side-by-side panes that mirror the page. Plan 2 makes the
**left pane a translation**: it segments the page into sentences, translates each
sentence on-device into the user's chosen language, and wraps sentences in **both**
panes in spans carrying a shared `data-pair-id`. The right pane stays the untouched
original.

The shared `data-pair-id` spans are the data structure Plan 3 consumes — Plan 2
produces them; Plan 3 makes them interactive.

## Scope

**In scope**
- Resolve the source language from `<html lang>` (or the right-pane override).
- Segment text into sentences with `Intl.Segmenter`.
- Wrap sentences in `<span data-pair-id>` in both panes (block-fallback for
  marked-up blocks — see "Sentence-span injection").
- Translate the left pane on-device with the `Translator` API, **visible-first then
  lazily on scroll**, filling each span as its translation lands.
- Handle translator availability/download and unsupported-pair states gracefully.

**Out of scope (Plan 3)**
- Any hover behavior, highlight styling, or highlight logic.
- Synchronized scrolling.

**Out of scope (later / non-goals, per the overall design)**
- Word-level lookup, cloud/LLM engines, language *detection*, Firefox/Safari.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Plan 2 ↔ Plan 3 boundary | Plan 2 emits translated text **and** paired spans; Plan 3 is purely interactive | The paired spans are exactly what Plan 3 needs; keeps Plan 3 free of DOM rewriting. |
| Clone freezing | **Inert snapshot + resilient keying** | Strip executable content from clones and key pairing off `data-pair-id` (which site scripts don't touch). A `MutationObserver` guard is deferred until a site proves destructive. |
| Translation timing | **Visible-first, lazy on scroll** | Fast first paint on long articles; matches the overall design's long-page guidance. |
| Sentence-span granularity | **Block-fallback** | Per-sentence spans for plain-text blocks; one block-level pair for blocks containing inline markup. Reliable, far less DOM code than range-based wrapping. |
| Translated-pane markup | **Flattened to plain text** | Inline links/bold are dropped in the *translated* (left) pane; the original (right) pane keeps full markup and working links. |
| Status/error surface | **A status banner in the extension's shadow-DOM UI, positioned over the left pane** | One predictable place for "preparing", "unavailable", and "pick a language" messages; stays in the shadow root per the project's UI-isolation rule. |
| Pair-ID survival | Key off `data-pair-id` attribute | Site scripts re-add ids / scan by class but essentially never touch our custom data-attribute. |

## Architecture

Dependency direction is unchanged: `entrypoints/ → src/`. All new logic lives in
`src/` with co-located tests; the content script wires the real `Translator` and
`IntersectionObserver` into it.

### Clone is now inert (extends Plan 1's `split-view.ts` / `dom.ts`)

`buildSplitView` already clones each body child and runs `stripIds`. Plan 2 adds a
`makeInert(el)` pass (in `src/dom.ts`) applied to every clone:

- remove `<script>` and `<noscript>` elements,
- remove inline event-handler attributes (`on*`),
- neutralize auto-playing/streaming media (`<video autoplay>`, `<audio autoplay>`),
  and other obviously-live embeds where cheap.

Cloned `<script>` nodes don't re-execute anyway; the real mutation risk is the
**original page's** still-running scripts reaching into the light-DOM clones (observed
on MDN, which re-added 8 stray ids to a clone). We don't try to stop those — instead
pairing keys off `data-pair-id`, which they don't touch, and `makeInert` keeps the
clones themselves from contributing new behavior.

### New `src/` modules

**`src/segment.ts`** — pure sentence segmentation.
```
segmentSentences(text: string, locale: string): string[]
```
Uses `Intl.Segmenter(locale, { granularity: "sentence" })`. Returns trimmed,
non-empty sentence strings in order.

**`src/pairing.ts`** — pure DOM transform that wraps both panes in lockstep.
```
pairPanes(left: HTMLElement, right: HTMLElement, sourceLocale: string): void
```
The two panes are structurally identical clones, so a single lockstep walk visits the
same blocks in both. For each **text block** (a leaf block-level element such as `p`,
`li`, `h1`–`h6`, `blockquote`, `figcaption`, `dt`, `dd`, table cells):

- **Plain-text block** (text only, no inline element children): segment its text and
  wrap each sentence in `<span data-pair-id="pN">` in both panes (sequential ids).
- **Marked-up block** (contains inline elements): assign **one** `data-pair-id` to the
  whole block (e.g. wrap its contents in a single span / set the attribute on the
  block). Markup is preserved; the block is one pair unit.

Left-pane spans initially contain the original text (they are clones); translation
replaces their text later. Right-pane spans/markup are never rewritten.

**`src/translator.ts`** — thin, testable wrapper over the browser `Translator` API.
```
type TranslatorPort = { translate(text: string): Promise<string> }
createTranslator(source: string, target: string, deps?): Promise<CreateResult>
```
`createTranslator` maps the API's availability to a small union:
`"ready"` (returns a `TranslatorPort`), `"downloading"` (preparing), or
`"unavailable"`. The `Translator` global and any download-progress monitor are passed
in via `deps` so tests use a mock — no real model needed.

**`src/translate-pane.ts`** — pure orchestrator.
```
translatePane(leftPane: HTMLElement, port: TranslatorPort, deps): Controller
```
Given the wrapped left pane and a `TranslatorPort`, it fills spans **visible-first then
lazily**: an injected visibility signal (real `IntersectionObserver` in the content
script) marks spans entering the viewport; their source sentences are queued and
translated with **bounded concurrency**, and each span's text is replaced as its
translation resolves. A failed sentence keeps its original text (optionally flagged via
`title`). Returns a `Controller` with a `stop()` for teardown/re-sync.

### `entrypoints/content.ts` (glue only)

On the `TOGGLE_SPLIT` activate path the content script:
1. calls `buildSplitView` (now producing inert clones),
2. resolves the source language (`<html lang>` → right-pane override → inline prompt),
3. calls `pairPanes(left, right, sourceLocale)`,
4. `await createTranslator(source, leftLang, { Translator })`, rendering the banner
   state while downloading / on `unavailable`,
5. on `"ready"`, calls `translatePane(left, port, { makeObserver: () => new IntersectionObserver(...) })`,
6. on teardown/re-sync, calls the controller's `stop()`.

## Data flow

```
TOGGLE_SPLIT (activate)
   └─ buildSplitView()            → two identical INERT clones (left, right)
   └─ resolveSource()             → sourceLocale  (or inline prompt → wait)
   └─ pairPanes(left,right,locale) → both panes wrapped with matching data-pair-id
   └─ createTranslator(src,target) → "ready" | "downloading" | "unavailable"
        ├─ downloading  → banner "Preparing <lang>…"  then continue
        └─ unavailable  → banner; leave panes as mirror (graceful)
   └─ translatePane(left, port, …) → visible-first lazy fill, progressive replace
```

## Edge cases & handling

- **No `<html lang>` and right pane = "auto":** the status banner prompts the user to
  pick the source language; translation waits until set.
- **Translator unavailable / unsupported pair:** status banner; panes remain a faithful
  mirror so the split is still useful.
- **Model not downloaded yet:** "Preparing <language>…" state (download progress if the
  API exposes it), then proceed.
- **Per-sentence translation failure:** keep the original text in that span; continue
  with the rest.
- **Marked-up block:** single block-level pair (sentence granularity sacrificed there,
  markup kept).
- **Re-sync:** stop the current controller, tear down, and re-run the pipeline on the
  current DOM.
- **Live-site mutation of clones:** accepted as low-risk for pairing (attributes only);
  revisited with a `MutationObserver` guard only if a real site breaks the spans.

## Testing

Pure logic only, Vitest + happy-dom, co-located `*.test.ts`. The content-script glue is
verified by `pnpm compile` + manual e2e (as in Plan 1).

- **`segment`** — splits English prose into sentences; one CJK locale case; trims and
  drops empties.
- **`pairing`** — plain block → N sentence spans with sequential ids; marked-up block →
  a single block pair; ids align between the paired left/right blocks; idempotent on
  re-run; original-pane markup untouched.
- **`translator`** — availability mapping (`ready`/`downloading`/`unavailable`);
  `translate` passthrough via a mock global.
- **`translate-pane`** — with a mock `TranslatorPort` and a controllable visible-set:
  visible sentences translate before off-screen ones; spans fill progressively; a
  rejecting translation leaves the original text; concurrency stays within the bound;
  `stop()` halts further work.

## Open questions for implementation planning

- Precise "text block" selection (which elements; how to treat nested block containers
  and whitespace-only nodes).
- Bounded-concurrency value and queue ordering details for the translator.
- Banner markup/styling within the shadow-DOM UI, and the source-language prompt UI
  (reuse the popup's picker vs. an inline shadow-DOM select).
- Whether `createTranslator`'s download-progress monitor is surfaced as a percentage or
  just an indeterminate "preparing" state in v1.
