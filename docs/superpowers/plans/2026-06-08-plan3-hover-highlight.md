# Lingua Mirror — Plan 3: Synchronized Hover-Highlight + Synced Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bilingual split interactive — hovering a sentence in either pane highlights it and its `data-pair-id` twin in the other pane, and scrolling one pane proportionally scrolls the other.

**Architecture:** Two new pure modules in `src/` (`highlight.ts` — delegated hover engine toggling a `data-lm-highlight` attribute; `synced-scroll.ts` — proportional scroll mirroring with a re-entrancy guard) wired into `entrypoints/content.ts`. Both modules mutate only the elements passed to them; the highlight CSS rule is an exported string the content script injects. All logic is unit-tested with Vitest + happy-dom; the content-script glue is verified by `pnpm compile` + manual e2e.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), WXT, Vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-06-08-plan3-hover-highlight-design.md`

---

## File Structure

```
src/
  highlight.ts          # NEW: linkHover(root) → toggle data-lm-highlight on matching pair-ids; HIGHLIGHT_CSS const
  highlight.test.ts     # NEW
  synced-scroll.ts      # NEW: computeMirroredScrollTop() + linkScroll(a, b)
  synced-scroll.test.ts # NEW
entrypoints/
  content.ts            # MODIFY: inject HIGHLIGHT_CSS, wire linkHover after pairing + linkScroll on activate, teardown both
```

Responsibilities (one job each):
- `highlight.ts` — given the shared `#ls-root`, light up the hovered sentence and its twin; nothing else touches the DOM outside `root`.
- `synced-scroll.ts` — mirror scroll position proportionally between two scroll containers, no ricochet.
- `content.ts` — thin glue: inject the highlight stylesheet, wire/unwire both modules across activate / re-sync / teardown.

---

## Task 1: Hover-highlight engine (`highlight.ts`)

**Files:**
- Create: `src/highlight.ts`
- Test: `src/highlight.test.ts`

`linkHover(root)` attaches a delegated `mouseover` (for moving between sentences) plus a `mouseleave` (for leaving the panes entirely) on `root`. On hover it resolves the nearest `[data-pair-id]` ancestor and sets `data-lm-highlight` on **every** element in `root` carrying that id (the hovered element + its twin). Tracks the active id so re-hovering the same sentence is a no-op. Exports `HIGHLIGHT_CSS` for the glue to inject.

- [ ] **Step 1: Write the failing test** — `src/highlight.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { HIGHLIGHT_CSS, linkHover } from "./highlight";

/** A root containing two panes whose sentences share the same pair-ids. */
function panes(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <div class="left">
      <span data-pair-id="lm-0">one</span>
      <span data-pair-id="lm-1">two</span>
    </div>
    <div class="right">
      <span data-pair-id="lm-0">eins</span>
      <span data-pair-id="lm-1">zwei</span>
    </div>`;
  return root;
}

function over(el: Element): void {
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
}

function highlighted(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll("[data-lm-highlight]")).map(
    (el) => el.getAttribute("data-pair-id")!,
  );
}

describe("linkHover", () => {
  it("highlights the hovered sentence and its twin in the other pane", () => {
    const root = panes();
    linkHover(root);
    over(root.querySelector('.left [data-pair-id="lm-0"]')!);
    expect(highlighted(root)).toEqual(["lm-0", "lm-0"]); // left + right twins
  });

  it("moves the highlight when hovering a different sentence", () => {
    const root = panes();
    linkHover(root);
    over(root.querySelector('.left [data-pair-id="lm-0"]')!);
    over(root.querySelector('.right [data-pair-id="lm-1"]')!);
    expect(highlighted(root)).toEqual(["lm-1", "lm-1"]);
  });

  it("clears the highlight when hovering a gap with no pair-id", () => {
    const root = panes();
    linkHover(root);
    over(root.querySelector('.left [data-pair-id="lm-0"]')!);
    over(root.querySelector(".left")!); // container itself, no pair-id at/above target
    expect(highlighted(root)).toEqual([]);
  });

  it("clears the highlight when the pointer leaves the panes", () => {
    const root = panes();
    linkHover(root);
    over(root.querySelector('.left [data-pair-id="lm-0"]')!);
    root.dispatchEvent(new MouseEvent("mouseleave"));
    expect(highlighted(root)).toEqual([]);
  });

  it("highlights a block-level pair-id element (marked-up fallback)", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <p data-pair-id="lm-0">See <a href="#">link</a>.</p>
      <p data-pair-id="lm-0">Siehe <a href="#">Link</a>.</p>`;
    linkHover(root);
    over(root.querySelector("a")!); // hover inline markup inside the block
    expect(highlighted(root)).toEqual(["lm-0", "lm-0"]);
  });

  it("destroy() removes listeners and clears state", () => {
    const root = panes();
    const controller = linkHover(root);
    over(root.querySelector('.left [data-pair-id="lm-0"]')!);
    controller.destroy();
    expect(highlighted(root)).toEqual([]); // cleared on destroy
    over(root.querySelector('.left [data-pair-id="lm-1"]')!);
    expect(highlighted(root)).toEqual([]); // listener gone, nothing re-highlights
  });

  it("exposes a CSS rule targeting the highlight attribute", () => {
    expect(HIGHLIGHT_CSS).toContain("data-lm-highlight");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/highlight.test.ts`
Expected: FAIL — cannot import from `./highlight`.

- [ ] **Step 3: Write the implementation** — `src/highlight.ts`

```ts
const HIGHLIGHT_ATTR = "data-lm-highlight";

/** CSS rule the content script injects so `[data-lm-highlight]` paints over site styles. */
export const HIGHLIGHT_CSS = `[${HIGHLIGHT_ATTR}]{background:#fff3a3 !important;border-radius:3px;box-shadow:0 0 0 2px #fff3a3;}`;

export type HoverController = { destroy(): void };

/**
 * Wire bidirectional hover-highlight on `root` (which contains both panes).
 * Hovering a sentence sets `data-lm-highlight` on every element carrying the
 * same `data-pair-id` — the hovered element and its twin in the other pane.
 */
export function linkHover(root: HTMLElement): HoverController {
  let currentId: string | null = null;

  const clear = (): void => {
    if (currentId == null) return;
    for (const el of root.querySelectorAll(`[${HIGHLIGHT_ATTR}]`)) {
      el.removeAttribute(HIGHLIGHT_ATTR);
    }
    currentId = null;
  };

  const apply = (id: string): void => {
    if (id === currentId) return; // re-hovering the same sentence: no-op
    clear();
    for (const el of root.querySelectorAll(`[data-pair-id="${id}"]`)) {
      el.setAttribute(HIGHLIGHT_ATTR, "");
    }
    currentId = id;
  };

  const onOver = (event: Event): void => {
    const target = event.target as Element | null;
    const sentence = target?.closest("[data-pair-id]");
    if (sentence) apply(sentence.getAttribute("data-pair-id")!);
    else clear();
  };

  root.addEventListener("mouseover", onOver);
  root.addEventListener("mouseleave", clear);

  return {
    destroy(): void {
      root.removeEventListener("mouseover", onOver);
      root.removeEventListener("mouseleave", clear);
      clear();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/highlight.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/highlight.ts src/highlight.test.ts
git commit -m "feat: bidirectional hover-highlight engine"
```

---

## Task 2: Proportional synced scroll (`synced-scroll.ts`)

**Files:**
- Create: `src/synced-scroll.ts`
- Test: `src/synced-scroll.test.ts`

`computeMirroredScrollTop(source, target)` is the pure proportional math. `linkScroll(a, b)` wires `scroll` listeners both ways with a re-entrancy guard so mirroring A→B does not ricochet B→A. The guard resets on the next animation frame; the frame scheduler is injected (defaulting to `requestAnimationFrame`) so tests drive it deterministically.

- [ ] **Step 1: Write the failing test** — `src/synced-scroll.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { computeMirroredScrollTop, linkScroll } from "./synced-scroll";

/** happy-dom has no layout, so stub the scroll geometry explicitly. */
function sized(scrollHeight: number, clientHeight: number): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  return el;
}

describe("computeMirroredScrollTop", () => {
  it("mirrors proportionally when the target is shorter", () => {
    const source = sized(1000, 200); // scrollable range 800
    const target = sized(600, 200); // scrollable range 400
    source.scrollTop = 400; // 50% down
    expect(computeMirroredScrollTop(source, target)).toBe(200);
  });

  it("keeps the same position when heights are equal", () => {
    const source = sized(1000, 200);
    const target = sized(1000, 200);
    source.scrollTop = 300;
    expect(computeMirroredScrollTop(source, target)).toBe(300);
  });

  it("returns 0 when the source cannot scroll", () => {
    const source = sized(200, 200); // range 0 — guard against divide-by-zero
    const target = sized(600, 200);
    source.scrollTop = 0;
    expect(computeMirroredScrollTop(source, target)).toBe(0);
  });
});

describe("linkScroll", () => {
  it("mirrors a scroll one way once, without ricocheting back", () => {
    const a = sized(1000, 200); // range 800
    const b = sized(600, 200); // range 400
    const rafQueue: Array<() => void> = [];
    linkScroll(a, b, (cb) => rafQueue.push(cb));

    a.scrollTop = 400;
    a.dispatchEvent(new Event("scroll"));
    expect(b.scrollTop).toBe(200); // a → b mirrored

    // the programmatic write to b would fire b's scroll handler; the guard swallows it
    const aBefore = a.scrollTop;
    b.dispatchEvent(new Event("scroll"));
    expect(a.scrollTop).toBe(aBefore); // no ricochet to a

    // releasing the guard (next frame) re-enables syncing
    rafQueue.forEach((fn) => fn());
    b.scrollTop = 0;
    b.dispatchEvent(new Event("scroll"));
    expect(a.scrollTop).toBe(0); // b → a now mirrors
  });

  it("destroy() detaches both listeners", () => {
    const a = sized(1000, 200);
    const b = sized(600, 200);
    const controller = linkScroll(a, b, (cb) => cb());
    controller.destroy();
    a.scrollTop = 400;
    a.dispatchEvent(new Event("scroll"));
    expect(b.scrollTop).toBe(0); // no sync after destroy
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/synced-scroll.test.ts`
Expected: FAIL — cannot import from `./synced-scroll`.

- [ ] **Step 3: Write the implementation** — `src/synced-scroll.ts`

```ts
/** Proportional scroll position of `source` mapped onto `target`'s scrollable range. */
export function computeMirroredScrollTop(source: Element, target: Element): number {
  const sourceRange = source.scrollHeight - source.clientHeight;
  const targetRange = target.scrollHeight - target.clientHeight;
  const ratio = source.scrollTop / Math.max(1, sourceRange); // max(1,…) avoids /0
  return ratio * targetRange;
}

export type ScrollController = { destroy(): void };

type ScheduleFrame = (callback: () => void) => void;

/**
 * Keep two scroll containers proportionally aligned. A re-entrancy guard prevents
 * mirroring a → b from triggering b → a; it resets on the next animation frame so a
 * no-op scrollTop write (which fires no scroll event) cannot leave the guard stuck.
 */
export function linkScroll(
  a: HTMLElement,
  b: HTMLElement,
  scheduleFrame: ScheduleFrame = requestAnimationFrame,
): ScrollController {
  let locked = false;

  const mirror = (source: HTMLElement, target: HTMLElement) => (): void => {
    if (locked) return;
    locked = true;
    target.scrollTop = computeMirroredScrollTop(source, target);
    scheduleFrame(() => {
      locked = false;
    });
  };

  const onA = mirror(a, b);
  const onB = mirror(b, a);
  a.addEventListener("scroll", onA);
  b.addEventListener("scroll", onB);

  return {
    destroy(): void {
      a.removeEventListener("scroll", onA);
      b.removeEventListener("scroll", onB);
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/synced-scroll.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/synced-scroll.ts src/synced-scroll.test.ts
git commit -m "feat: proportional synced scroll with re-entrancy guard"
```

---

## Task 3: Wire highlight + scroll into the content script (`content.ts`)

**Files:**
- Modify: `entrypoints/content.ts`

Browser glue — verified by `pnpm compile` and the manual e2e in Task 4. Scroll sync is wired on activate (needs no pair-ids, so it also works in the no-language case). Highlight is wired right after `pairPanes` (needs the pair-ids) and the `HIGHLIGHT_CSS` rule is injected once into `<head>`. Both are wired before any `await`, so the existing mid-load teardown guard already covers them; `teardown()` disconnects both before the split view is removed.

- [ ] **Step 1: Replace `entrypoints/content.ts` with the wired version**

```ts
import { TOGGLE_SPLIT, type ToggleSplitMessage } from "../src/messages";
import { buildSplitView, type SplitView } from "../src/split-view";
import { getSettings } from "../src/settings";
import { resolveSourceLanguage } from "../src/source-language";
import { pairPanes } from "../src/pairing";
import { createTranslator, type TranslatorApi, type TranslatorPort } from "../src/translator";
import { translatePane, type Controller, type Visibility } from "../src/translate-pane";
import { linkHover, HIGHLIGHT_CSS, type HoverController } from "../src/highlight";
import { linkScroll, type ScrollController } from "../src/synced-scroll";

const HIGHLIGHT_STYLE_ID = "lm-highlight-style";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    let view: SplitView | null = null;
    let controls: HTMLElement | null = null;
    let banner: Banner | null = null;
    let translation: Controller | null = null;
    let port: TranslatorPort | null = null;
    let highlight: HoverController | null = null;
    let scrollSync: ScrollController | null = null;

    const teardown = (): void => {
      highlight?.destroy();
      highlight = null;
      scrollSync?.destroy();
      scrollSync = null;
      translation?.stop();
      translation = null;
      port?.destroy();
      port = null;
      banner?.remove();
      banner = null;
      controls?.remove();
      controls = null;
      view?.destroy();
      view = null;
    };

    const activate = async (): Promise<void> => {
      const active = buildSplitView(document);
      view = active;
      controls = mountControls(active.root, { onClose: teardown, onResync: resync });
      banner = mountBanner(active.root);
      // Scroll sync needs no pair-ids, so wire it even when the page has no <html lang>.
      scrollSync = linkScroll(active.left, active.right);
      await runTranslation(active, banner);
    };

    const runTranslation = async (active: SplitView, status: Banner): Promise<void> => {
      const settings = await getSettings();
      const source = resolveSourceLanguage(document.documentElement.lang, settings.rightLang);
      if (source == null) {
        status.show("Set the page's language in the popup to translate.");
        return;
      }
      pairPanes(active.left, active.right, source);
      // Highlight works on the pair-id structure regardless of translation state.
      injectHighlightStyle(document);
      highlight = linkHover(active.root);

      const target = settings.leftLang;
      if (source === target) return; // same language: panes already mirror

      const translatorApi = (globalThis as { Translator?: TranslatorApi }).Translator;
      if (!translatorApi) {
        status.show("Translation isn't available in this browser.");
        return;
      }
      const result = await createTranslator(source, target, translatorApi, {
        onDownloading: () => status.show(`Preparing ${target}…`),
      });
      if (result.status === "unavailable") {
        status.show(`Translation ${source} → ${target} isn't available on this device.`);
        return;
      }
      // Teardown or a re-activate may have run while the model loaded; if this
      // run is no longer the active one, release the port and bail (avoids
      // orphaning a live TranslatorPort + IntersectionObserver).
      if (view !== active) {
        result.port.destroy();
        return;
      }
      status.hide();
      port = result.port;
      translation = translatePane(active.left, port, { visibility: makeVisibility(active.left) });
    };

    const resync = (): void => {
      teardown();
      void activate();
    };

    const toggle = (): void => {
      if (view) teardown();
      else void activate();
    };

    chrome.runtime.onMessage.addListener((message: ToggleSplitMessage) => {
      if (message?.type === TOGGLE_SPLIT) toggle();
    });
  },
});

/** Inject the highlight CSS rule once; left in <head> on destroy (inert without the attribute). */
function injectHighlightStyle(doc: Document): void {
  if (doc.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = HIGHLIGHT_CSS;
  doc.head.appendChild(style);
}

function makeVisibility(pane: HTMLElement): Visibility {
  const callbacks = new Map<Element, () => void>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = callbacks.get(entry.target);
        observer.unobserve(entry.target);
        callbacks.delete(entry.target);
        callback?.();
      }
    },
    // root is the scrollable left pane; 200px margin prefetches just-offscreen sentences.
    { root: pane, rootMargin: "200px" },
  );
  return {
    observe(el, onVisible) {
      callbacks.set(el, onVisible);
      observer.observe(el);
    },
    disconnect() {
      observer.disconnect();
      callbacks.clear();
    },
  };
}

type Banner = { show(message: string): void; hide(): void; remove(): void };

function mountBanner(root: HTMLElement): Banner {
  const host = document.createElement("div");
  // #ls-root is position:fixed inset:0, so absolute positions the banner inside the overlay.
  host.style.cssText = "position:absolute;top:8px;left:8px;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .b{display:none;max-width:46%;font:600 12px system-ui,sans-serif;background:#1e1e1e;color:#fff;padding:6px 10px;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.3);}
    </style>
    <div class="b"></div>`;
  const box = shadow.querySelector(".b") as HTMLElement;
  root.appendChild(host);
  return {
    show(message) {
      box.textContent = message;
      box.style.display = "block";
    },
    hide() {
      box.style.display = "none";
    },
    remove() {
      host.remove();
    },
  };
}

function mountControls(
  root: HTMLElement,
  handlers: { onClose: () => void; onResync: () => void },
): HTMLElement {
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .bar{display:flex;gap:6px;font:600 12px system-ui,sans-serif;background:#1e1e1e;color:#fff;padding:6px 8px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.3);}
      button{all:unset;cursor:pointer;padding:3px 8px;border-radius:5px;}
      button:hover{background:rgba(255,255,255,.15);}
    </style>
    <div class="bar">
      <button id="resync">&#x27F3; Re-sync</button>
      <button id="close">&#x2715; Close</button>
    </div>`;
  shadow.getElementById("resync")?.addEventListener("click", handlers.onResync);
  shadow.getElementById("close")?.addEventListener("click", handlers.onClose);
  root.appendChild(host);
  return host;
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm compile`
Expected: no type errors.

- [ ] **Step 3: Run the full unit suite**

Run: `pnpm test`
Expected: PASS — all `src/*.test.ts` green, including the new `highlight` (7) and `synced-scroll` (5) suites.

- [ ] **Step 4: Commit**

```bash
git add entrypoints/content.ts
git commit -m "feat: wire hover-highlight and synced scroll into the split view"
```

---

## Task 4: Manual end-to-end validation

Validates real hover-highlight and synced scrolling on a translated page. Requires Chrome/Edge **138+** for the on-device `Translator` API. No code unless a fix is needed.

- [ ] **Step 1: Build and load**

Run: `pnpm build`, then load `.output/chrome-mv3` via `chrome://extensions` → "Load unpacked". (Or `pnpm dev`.)

- [ ] **Step 2: Hover-highlight, both directions**

- Open a German article, e.g. `https://de.wikipedia.org/wiki/Fahrrad`. Popup → Left = English, Right = "Original language of the site" → "Split this page".
- Hover a sentence in the **left** pane → it and its **right** twin both light up soft yellow.
- Hover a sentence in the **right** pane → its **left** twin lights up. Confirms bidirectional.
- Move the cursor off the sentences (into a gap, or onto the controls bar) → highlight clears.
- Confirm the highlight is visible over the site's own background (the `!important` rule wins).

- [ ] **Step 3: Synced scrolling**

- Scroll the left pane → the right pane tracks proportionally (the hovered sentence's twin stays roughly on-screen). Scroll the right pane → the left tracks. Confirm no visible jitter/ricochet.

- [ ] **Step 4: Edge cases**

- Re-sync → re-captures, re-pairs, and re-wires highlight + scroll (still works after).
- Close / second toggle → collapses cleanly; the original page scrolls and is interactive again (no lingering scroll-sync or highlight listeners).
- A page with no `<html lang>` and Right = "auto" → the banner asks you to set the language; scroll sync still works between the two (mirrored) panes; no highlight (no pair-ids) and no error.
- Set Left = the page's own language → panes mirror, no translation, but hover-highlight still works on the matching pair-ids.

- [ ] **Step 5: Record validation notes**

Append observations to this plan under a new `## Validation notes` heading (highlight legibility/scroll feel/perf), then:

```bash
git add docs/superpowers/plans/2026-06-08-plan3-hover-highlight.md
git commit -m "docs: record Plan 3 validation notes"
```

---

## Done criteria for Plan 3

- `pnpm test` passes (new `highlight` + `synced-scroll` suites plus existing green).
- `pnpm compile` is clean.
- On a translated page, hovering a sentence in either pane highlights it and its twin; the highlight wins over site CSS and clears on exit.
- Scrolling one pane keeps the other proportionally aligned, with no ricochet.
- Close / second toggle / re-sync wire and unwire highlight + scroll without leaking listeners.
- Highlight works on untranslated and same-language panes (it depends only on the `data-pair-id` structure).
```
