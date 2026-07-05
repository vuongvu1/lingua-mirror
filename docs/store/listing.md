# Chrome Web Store Listing — Lingua Mirror

## Name

Lingua Mirror

## Short description (≤132 chars)

Read any page side-by-side in two languages. Hover a sentence to see its
translation highlighted. 100% on-device, private.

## Detailed description

Lingua Mirror turns any web page into a bilingual reading exercise.

Hit the toolbar button (or Ctrl/Cmd+Shift+L) and the page splits into two
mirrored panes: the right pane keeps the site exactly as it is, the left pane
shows the same content translated into the language you choose. Hover any
sentence — in either pane — and its counterpart lights up on the other side,
so you can check meaning without losing your place.

Built for language learners:

- **Immersion or comfort — your choice.** Read foreign news with your native
  language beside it, or read familiar sites rendered in the language you're
  learning.
- **Sentence-level highlighting.** Hovering highlights exactly the matching
  sentence across both panes. Scrolling stays in sync.
- **Completely private.** Translation runs on your device using Chrome's
  built-in translation models. Page content never leaves your machine. No
  account, no server, no tracking, no analytics.
- **Works everywhere.** No iframe tricks — Lingua Mirror mirrors the page
  in place, so it works on sites that block embedding.

Requirements: Chrome or Edge 138+ (uses the built-in on-device Translator
API). The first use of a language pair downloads a small translation model;
afterwards it works offline.

## Category

Education

## Language

English

## Permissions justification

- `storage` — saves your two language choices locally.
- `activeTab` — sends the toggle command to the tab you activate it on.
- Content script on all sites (`<all_urls>`) — the split view must be able to
  run on whatever page you are reading; it does nothing until you toggle it.

## Privacy policy

Lingua Mirror does not collect, store, transmit, or sell any user data.
All processing (page snapshotting, sentence segmentation, translation)
happens locally in your browser using Chrome's built-in on-device APIs.
The only data persisted are your language preferences, stored in your
browser's local extension storage. No network requests are made by the
extension.

## Assets checklist

- [x] Icons 16/32/48/128 (in `public/`, generated two-pane motif)
- [ ] Screenshots 1280×800 (min 1, max 5) — capture: split view on a news
      article, hover-highlight in action, the popup, model-download status
- [ ] Promo tile 440×280 (optional)
- [ ] Developer account + one-time $5 registration fee
- [ ] Store zip: `pnpm zip` → `.output/lingua-mirror-<version>-chrome.zip`
