# Lingua Mirror — Design Spec

**Status:** Approved design, ready for implementation planning
**Date:** 2026-06-05
**Name:** Lingua Mirror

## Summary

A browser extension that helps people learn languages by showing any web page
side-by-side in two languages, with synchronized hover-highlighting that links
each sentence to its translation across the two panes.

When inactive, the extension does nothing. When activated on a page, it splits
the view into two panes:

- **Right pane** — the site's original content, untouched.
- **Left pane** — the same content translated into a language the user picks.

Hovering a sentence in either pane highlights that sentence *and its translation
counterpart in the other pane* at the same time, so the reader can instantly
locate the matching meaning.

## Goals

- Make it effortless to read a page in two languages at once.
- Let the user map meaning between languages sentence-by-sentence by hovering.
- Work on real-world content pages (articles, blogs, docs) without a backend.
- Keep page content private — translation happens on-device.
- Ship a focused, publishable v1 for Chrome/Edge.

## Non-goals (v1)

Explicitly out of scope for the first release (candidates for later):

- Word-level dictionary / click-to-look-up popups.
- Cloud or LLM translation engines.
- Firefox / Safari support.
- Automatic activation, language auto-detection, per-site memory, smart suggestions.
- Accounts, settings sync.
- Full support for dynamic web apps / dashboards (focus is readable content pages).

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Content model | Both directions ("immersion" and "comfort") | User sets the left pane's language; works for reading foreign content or familiar content. |
| Pane rendering | Mirrored clone of the real page | Looks like the real site, twice — visually faithful. |
| How the second pane is built | Clone-in-place snapshot (not iframes) | Works on virtually any site (no `X-Frame-Options`/CSP iframe blocking), lightweight, no double network/scripts. |
| Highlight granularity | Sentence-level | Matches the core learning interaction; precise without the unreliability of word-level cross-language mapping. |
| Translation engine | Chrome/Edge on-device Translator API | Free, private (text never leaves the device), no backend or API keys. |
| Language detection | None | Source language read from the page's `<html lang>` attribute (metadata, not a detection model); user can override. |
| Activation | Manual only (toolbar click + keyboard shortcut) | Simple, predictable, fully user-controlled. |
| Browser target | Chrome / Edge (Chromium 138+) | Required for the built-in Translator API. |

## Architecture

Manifest V3 extension. Three parts:

### Service worker (background)
- Stores settings: the two pane languages, keyboard-shortcut state, toolbar icon state.
- Relays the toggle command to the active tab's content script.
- Holds no page content.

### Popup (settings dialog)
- Two language pickers (see "Settings dialog" below).
- A toggle button to split / collapse the current page.

### Content script (the engine)
Injected into the page; runs the activation pipeline and owns the split UI.

**Style isolation:** the extension's own UI (split divider, controls, any badges)
lives in a **shadow root** so the site's CSS cannot break it. The two cloned page
panes stay in the **light DOM** so the site's own stylesheets keep rendering them
faithfully — this is what makes "the real site, twice" achievable.

## Activation pipeline

When the user activates (toolbar click or shortcut), the content script:

1. **Read source language** from `<html lang>`. If absent, prompt the user to pick it (via the right-pane picker).
2. **Snapshot & clone** the rendered DOM into a side-by-side split layout.
3. **Segment** text into sentences using `Intl.Segmenter` (built-in, language-aware).
4. **Translate** each sentence individually with the on-device Translator API, preserving a stable per-sentence ID.
5. **Wrap** each sentence in both panes in a span carrying its shared pair-ID.
6. **Render** the two panes side-by-side.
7. **Wire up** synchronized hover-highlight and synced scrolling.

Re-running the pipeline collapses the split back to the normal page.

## Core feature: synchronized hover-highlight

- Hovering any sentence in either pane highlights **that sentence and its
  translation counterpart in the other pane** simultaneously.
- **Bidirectional:** hover left → right twin lights up, and vice-versa.
- **Mechanism:** because translation happens sentence-by-sentence, each sentence
  in both panes carries a shared pair-ID. On `mouseover`, look up the matching
  pair-ID in the other pane and apply the highlight class to both. Direct ID
  lookup — no fuzzy text matching — so it is exact and fast.
- **Fallback:** if the translator merges or splits sentences so IDs don't line up
  1:1, highlight the parent block instead. Highlighting never breaks or points at
  the wrong text.
- **Synced scrolling:** scrolling one pane scrolls the other, so a hovered
  sentence's twin is usually already on-screen.

## Settings dialog (popup)

Deliberately minimal — two pickers and a toggle.

- **Left pane (translated):** pick any specific language. This pane shows the
  translation.
- **Right pane (original):** default top option is **"Original language of the
  site"** (kept as-is, source taken from `<html lang>`). Can be overridden to a
  specific language — useful when a site declares no language tag.
- **Toggle button:** "Split this page" ⇄ "Collapse split."
- **Keyboard shortcut** for the same toggle.

The labels "learning" vs "understand" are user intent, not system roles — the user
configures the left pane's language to suit immersion (set it to the language they
understand) or comfort (set it to the language they're learning).

## Tech stack

- **Manifest V3**, **TypeScript**.
- **WXT** as the extension framework (MV3 bundling, HMR, packaging).
- **Content script** in vanilla TS — the DOM cloning, segmentation, translation
  orchestration, and highlight engine. No UI framework needed.
- **Popup** in vanilla TS + minimal CSS.
- **`Intl.Segmenter`** for sentence segmentation.
- **Chrome Translator API** (and the page's `<html lang>`) for translation.
- No backend, no runtime dependencies.

## Edge cases & handling

- **Snapshot staleness** (infinite scroll, SPA navigation): the split is a
  snapshot. Provide a "re-sync" control to re-capture. Clicking a link navigates
  normally; the user can re-split the new page.
- **Long pages:** translate visible content first, then lazily translate the rest
  on scroll. Keeps activation fast and respects on-device translator throughput.
- **Translator model not yet downloaded:** show a one-time "preparing language…"
  state while the model downloads, then proceed.
- **Unsupported language pair / missing `<html lang>`:** show a clear inline
  message rather than failing silently; prompt for the source language if needed.
- **Sentence-count mismatch** between original and translation: fall back to
  block-level highlighting for the affected block.
- **Inline markup inside sentences** (links, bold): preserve where feasible;
  acceptable to flatten to plain text within a sentence span if it conflicts with
  reliable pairing.

## Testing

- **Unit tests** for pure logic: sentence segmentation, ID pairing/alignment,
  translation orchestration (with a mocked translator).
- **Manual / e2e** on a handful of real sites (a news article, a blog post, a docs
  page): verify split rendering, translation, hover-highlight in both directions,
  and synced scrolling.

## Open questions for implementation planning

- Exact layout mechanism for the side-by-side split (how the cloned DOM is
  arranged into two columns while preserving the site's styles, including handling
  of duplicate `id` attributes and fixed/sticky elements).
- Batching strategy and concurrency for per-sentence translation calls.
- Visual treatment of the split divider, highlight color, and controls (uses a
  later full settings page for customization; v1 picks sensible defaults).
