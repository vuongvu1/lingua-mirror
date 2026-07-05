# Phase B — Bergamot Translation Engine for Firefox: Design Spec

**Status:** Approved design, ready for implementation planning
**Date:** 2026-07-06

## Summary

Give Firefox users real on-device translation. Firefox has no built-in
`Translator` API (Mozilla's standards position on the WICG proposal is
negative), so the extension bundles the Bergamot neural MT engine — the same
engine Firefox's own page translation uses — as WebAssembly, running in the
background script. Language models are downloaded on first use from Mozilla's
public model registry and cached. Page content never leaves the device.

Chrome/Edge behavior is unchanged: the built-in `Translator` API remains the
engine there.

## Goals

- Left-pane translation works in Firefox 128+ with the same UX as Chrome
  (download banner on first use, then sentence-by-sentence translation).
- One engine abstraction; feature detection picks the implementation.
- Keep the privacy promise: no page text over the network, ever. Only model
  files are fetched (from Mozilla's registry), analogous to Chrome
  downloading its models.
- Chrome build stays byte-for-byte free of Bergamot code (no bundle growth).

## Non-goals (v1)

- Pivot translation (de→fr via English) unless the library provides it for
  free — direct pairs (X↔en) are the v1 surface.
- Model pre-downloading, model management UI, or eviction controls.
- Safari.

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Engine | `@browsermt/bergamot-translator` npm package (`BatchTranslator`) | Prebuilt wasm + worker + model fetching against Mozilla's registry; no Emscripten toolchain; engine identical to Firefox's own translation. |
| Where it runs | Background script (event page), one `BatchTranslator` instance | Wasm workers in content-script worlds are CSP-fragile; background hosting is the pattern Mozilla's own extension uses. |
| Content ↔ background transport | `browser.runtime.connect` Port, one connection per activation | Ports keep the event page alive during translation and give clean teardown (disconnect = cancel). |
| Engine selection | Feature-detect `globalThis.Translator` → native; else Bergamot | No browser sniffing; Chrome path untouched. |
| Bergamot code in Chrome build | Excluded | Background imports Bergamot lazily/conditionally; WXT per-browser builds keep the Chrome bundle clean (verified in CI-less fashion by size check). |
| Models | Downloaded on first use from the package's default Mozilla registry; rely on the package's caching + HTTP cache in v1 | Zero custom registry/cache code until proven insufficient. |
| Availability | A pair is "available" if the registry lists source→target (or the package can construct it); otherwise unavailable banner as today | Mirrors the existing `TranslatorAvailability` semantics. |
| Permissions | Add host permission for the model registry/CDN origin (Firefox manifest only) | Model fetch happens from the background script. |
| Dependency policy | First runtime dependency, pinned exact version | Amends the repo's "no runtime dependencies" rule; noted in CLAUDE.md. |

## Architecture

Existing seam: `src/translator.ts` defines `TranslatorApi` (`availability(pair)`,
`create(pair) → TranslatorPort`) and `TranslatorPort` (`translate(text)`,
`destroy()`). The content script's `runTranslation` consumes `TranslatorApi`.
Phase B adds a second implementation of that interface — nothing above the
seam changes except engine resolution.

```
content script                         background (event page)
──────────────                        ────────────────────────
resolveEngine():                       onConnect("bergamot"):
  globalThis.Translator? ──native──▶     hosts one BatchTranslator
  else bergamotApi()                     per connection lifetime
       │                                       ▲
       ▼                                       │ Port messages
bergamotApi: TranslatorApi ────────────────────┘
  availability(pair) → ask background (registry lookup)
  create(pair) → open Port; TranslatorPort proxies
    translate(text) → {id, text} request/response over Port
    destroy() → port.disconnect()
```

### Port protocol (versioned, tiny)

- `{type:"availability", pair}` → `{type:"availability:result", value}`
- `{type:"init", pair}` → `{type:"init:result", ok}` (loads/downloads model;
  progress events `{type:"downloading"}` map to the existing banner hook)
- `{type:"translate", id, text}` → `{type:"translate:result", id, text}`
- Port disconnect (either side) tears down the translator for that connection.

Request/response pairing by numeric `id` — the content side keeps a pending
map; this is what makes per-sentence concurrency from `translate-pane.ts`
safe over one Port.

### Failure semantics

- Registry unreachable / pair missing → `availability: "unavailable"` →
  existing banner ("isn't available on this device") — no new UI.
- Worker crash / port disconnect mid-run → pending translations reject;
  `translate-pane.ts` already leaves original text on per-sentence failure.
- Event-page suspension: the open Port prevents suspension during active
  translation; after `destroy()` the background is free to idle out.

## Testing

- Unit (Vitest, happy-dom): port protocol codec + pending-map
  request/response pairing (both content proxy and background dispatcher,
  with a fake Port pair); engine resolution (native present/absent);
  availability mapping. `BatchTranslator` itself is mocked — its contract is
  pinned by an integration smoke test, not unit tests.
- Manual (Firefox): first-use model download UX, translation correctness,
  cancel mid-run, re-sync, unsupported pair banner, Chrome regression pass.
- Size check: Chrome zip must not grow (Bergamot absent from chrome-mv3
  output).

## Risks

- **Package health unverified.** First implementation task pins the version
  and smoke-tests `BatchTranslator` in a scratch page before any integration
  work. If the package is unusable, fallback is vendoring Mozilla's
  `bergamot-translator-worker.{js,wasm}` artifacts — bigger task, new plan.
- **Event-page lifetime** during long model downloads (~40MB on slow links)
  — the Port should hold it; verified manually.
- **Memory:** Bergamot peaks at a few hundred MB during translation;
  acceptable for a desktop browser, destroyed on teardown.
