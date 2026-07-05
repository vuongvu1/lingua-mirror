# CLAUDE.md

**Lingua Mirror** — a Chrome/Edge browser extension for learning languages. When
activated, it splits the current page into two side-by-side panes (one the site's
original, one a translation) and highlights matching sentences across both panes on
hover.

Read `docs/superpowers/specs/2026-06-05-language-split-extension-design.md` (design)
and the plans in `docs/superpowers/plans/` before changing behavior.

## Stack

- **WXT** (extension framework) + **Manifest V3** + **TypeScript** (strict, `noUncheckedIndexedAccess`).
- **Vitest** + **happy-dom** for unit tests.
- **Chrome/Edge, Chromium 138+** — required for the built-in on-device `Translator` API.
- **Firefox 128+ (MV3)** — ports fully EXCEPT translation: Mozilla rejected the WICG
  Translator API (standards-position negative), so the split/highlight works and
  translation shows the "not available" banner. Build: `pnpm build:firefox`.
  A Bergamot-wasm engine backend is the plotted fix (own spec, not yet built).
- No backend, no runtime dependencies.

## Commands

This project uses **pnpm** (pinned via `packageManager` in `package.json`).

- `pnpm dev` — launch a dev browser with the extension (HMR)
- `pnpm build` — production build to `.output/chrome-mv3/` (load unpacked from there)
- `pnpm compile` — `tsc --noEmit` type-check
- `pnpm test` — run Vitest once · `pnpm test:watch` — watch mode
- `pnpm zip` — package for the store

Run `pnpm compile` and `pnpm test` before considering any change done.

## Architecture

```
entrypoints/        → browser glue (thin). NOT unit-tested; verified by compile + manual e2e.
  background.ts      → service worker: forwards the toggle-split command to the active tab
  content.ts         → injects/tears down the split, mounts shadow-DOM controls
  popup/             → settings dialog (two language pickers + toggle button)
src/                → pure logic. Unit-tested with Vitest + happy-dom.
  settings.ts        → ONLY place that touches chrome.storage.local
  messages.ts        → single source of the message contract (TOGGLE_SPLIT)
  active-tab.ts      → sendToActiveTab(): route a message to the active tab, no-op if no receiver
  languages.ts       → the picker language list
  dom.ts             → pure DOM helpers (stripIds, …)
  split-view.ts      → buildSplitView()/destroy(): the two-pane clone-in-place overlay
test/setup.ts       → global `chrome` mock for tests
docs/superpowers/   → specs/ (designs) and plans/ (implementation plans)
```

Dependency direction: `entrypoints/ → src/`, never the reverse. Put logic in `src/`
(testable); keep `entrypoints/` as orchestration only.

## Rules

MUST:
- Pure/testable logic goes in `src/` with co-located `*.test.ts` (TDD). Browser glue stays in `entrypoints/`.
- Named exports only. Default export ONLY for WXT entrypoints (`defineBackground`/`defineContentScript`) and the popup HTML's module.
- `export type` / `import type` for type-only symbols.
- `as const` or union types — never `enum`.
- Route all tab messaging through `src/active-tab.ts`; reference message types via `src/messages.ts` (no string literals).
- Only `src/settings.ts` reads/writes `chrome.storage`.
- The extension's own UI (controls, dividers) lives in a **shadow root**; cloned page panes stay in **light DOM** so the site's CSS still renders them.
- Guard `tab.id` with `!= null` (a tab id of `0` is valid; `noUncheckedIndexedAccess` makes `[tab]` possibly undefined).

NEVER:
- Add a backend or send page content over the network — translation is **on-device only**.
- Add language **detection** — the source language comes from the page's `<html lang>` (the "Original language of the site" / `auto` option); prompt the user if absent.
- Use `console.log`/`.info` (only `.error`/`.warn`).
- Barrel files or re-export-all.

## Testing notes

- `test/setup.ts` provides a global `chrome` mock; tests set per-case return values (e.g. `vi.mocked(chrome.storage.local.get).mockResolvedValue(...)`).
- Gotcha: `@types/chrome` declares storage `get`/`set` with overloads whose last signature returns `void`, so `ReturnType` resolves to `void` and `mockResolvedValue(...)` fails to type-check. `test/setup.ts` contains a **type-only** `declare global` augmentation re-declaring them as Promise-returning. Extend that augmentation if you mock `chrome.tabs`/`chrome.runtime` with `mockResolvedValue` in future tests.

## Design constraints (don't drift)

- **Immersion-agnostic split:** right pane = the site's original (untouched); left pane = a translation into the user's chosen language. Direction works either way.
- **Clone-in-place snapshot**, not iframes (avoids `X-Frame-Options`/CSP blocking). A "re-sync" control re-captures after the page changes.
- **Sentence-level pairing:** translate sentence-by-sentence so each sentence carries a stable pair-ID; hover-highlight is then an exact ID lookup across panes (Plan 3).
- **Manual activation only** (toolbar click + `Ctrl/Cmd+Shift+L`).

## Workflow & status

Built in incremental, independently-shippable milestones, each spec → plan → implement:
- **Plan 1 — Foundation & Split View: DONE.** Scaffold, settings popup, toggle, clone-in-place mirrored split (both panes identical, no translation yet).
- **Plan 2 — Translation: DONE.** `Intl.Segmenter` sentence segmentation + on-device `Translator` API translating the left pane visible-first; source from `<html lang>`; both panes carry matching `data-pair-id` spans; status banner for unavailable/downloading/no-lang states. (Manual on-device e2e of the model-download path still pending — see plan validation notes.)
- **Plan 3 — Synchronized hover-highlight** (next): pair-ID spans, bidirectional highlight, synced scroll.
