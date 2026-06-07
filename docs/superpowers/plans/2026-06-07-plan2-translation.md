# Lingua Mirror — Plan 2: Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate the left pane on-device, sentence-by-sentence, and wrap sentences in both panes in shared `data-pair-id` spans — so the split view becomes bilingual and Plan 3 has the pairing structure it needs.

**Architecture:** Five new pure modules in `src/` (segmentation, source-language resolution, pane pairing, a `Translator`-API wrapper, and a visible-first lazy translation orchestrator) plus a `makeInert` DOM helper. `entrypoints/content.ts` wires the real `Translator` global and a real `IntersectionObserver` into them. All logic is unit-tested with Vitest + happy-dom using injected mocks; the content-script glue is verified by `pnpm compile` + manual e2e.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), WXT, Vitest + happy-dom, `Intl.Segmenter`, Chrome built-in `Translator` API (Chromium 138+).

**Spec:** `docs/superpowers/specs/2026-06-07-plan2-translation-design.md`

---

## File Structure

```
src/
  dom.ts              # MODIFY: add makeInert() next to stripIds()
  dom.test.ts         # MODIFY: tests for makeInert()
  split-view.ts       # MODIFY: run makeInert() on each clone
  split-view.test.ts  # MODIFY: assert clones are inert
  segment.ts          # NEW: segmentSentences(text, locale)
  segment.test.ts     # NEW
  source-language.ts  # NEW: resolveSourceLanguage(htmlLang, rightLang)
  source-language.test.ts # NEW
  pairing.ts          # NEW: pairPanes(left, right, sourceLocale) — span wrapping + block-fallback
  pairing.test.ts     # NEW
  translator.ts       # NEW: TranslatorPort/TranslatorApi types, createTranslator(), ambient Translator global
  translator.test.ts  # NEW
  translate-pane.ts   # NEW: translatePane(pane, port, deps) — visible-first lazy fill
  translate-pane.test.ts # NEW
entrypoints/
  content.ts          # MODIFY: resolve source, pair panes, create translator, drive translate-pane, status banner
```

Responsibilities (one job each):
- `segment.ts` — turn a string + locale into trimmed sentence strings.
- `source-language.ts` — decide the source language code (or `null` → prompt).
- `pairing.ts` — wrap both panes' sentences in matching `data-pair-id` spans (block-fallback for marked-up blocks).
- `translator.ts` — adapt the browser `Translator` API to a small mockable port + map availability.
- `translate-pane.ts` — orchestrate visible-first, lazy, bounded-concurrency translation of one pane.
- `dom.ts`/`split-view.ts` — make clones inert.
- `content.ts` — thin glue: read settings, inject real `Translator`/`IntersectionObserver`, show the banner.

---

## Task 1: `makeInert` DOM helper + inert clones

**Files:**
- Modify: `src/dom.ts`
- Modify: `src/dom.test.ts`
- Modify: `src/split-view.ts`
- Modify: `src/split-view.test.ts`

`makeInert(el)` strips executable content from a cloned subtree: `<script>`/`<noscript>` elements, inline `on*` handler attributes, and `autoplay`. Clones then contribute no behavior of their own.

- [ ] **Step 1: Write the failing tests** — append to `src/dom.test.ts`

```ts
import { makeInert, stripIds } from "./dom";

describe("makeInert", () => {
  it("removes script and noscript descendants", () => {
    const el = document.createElement("div");
    el.innerHTML = `<p>keep</p><script>evil()</script><noscript>x</noscript>`;
    makeInert(el);
    expect(el.querySelector("script")).toBeNull();
    expect(el.querySelector("noscript")).toBeNull();
    expect(el.querySelector("p")?.textContent).toBe("keep");
  });

  it("strips inline on* handler attributes from the element and descendants", () => {
    const el = document.createElement("div");
    el.setAttribute("onmouseover", "a()");
    el.innerHTML = `<button onclick="b()">go</button>`;
    makeInert(el);
    expect(el.hasAttribute("onmouseover")).toBe(false);
    expect(el.querySelector("button")?.hasAttribute("onclick")).toBe(false);
  });

  it("removes autoplay from media", () => {
    const el = document.createElement("div");
    el.innerHTML = `<video autoplay></video><audio autoplay></audio>`;
    makeInert(el);
    expect(el.querySelector("video")?.hasAttribute("autoplay")).toBe(false);
    expect(el.querySelector("audio")?.hasAttribute("autoplay")).toBe(false);
  });

  it("returns the same element", () => {
    const el = document.createElement("div");
    expect(makeInert(el)).toBe(el);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/dom.test.ts`
Expected: FAIL — `makeInert` is not exported.

- [ ] **Step 3: Implement `makeInert`** — append to `src/dom.ts`

```ts
export function makeInert<T extends Element>(el: T): T {
  for (const node of el.querySelectorAll("script, noscript")) {
    node.remove();
  }
  const stripHandlers = (node: Element): void => {
    for (const attr of Array.from(node.attributes)) {
      if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
    }
  };
  stripHandlers(el);
  for (const node of el.querySelectorAll("*")) stripHandlers(node);
  for (const media of el.querySelectorAll("video[autoplay], audio[autoplay]")) {
    media.removeAttribute("autoplay");
  }
  return el;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/dom.test.ts`
Expected: PASS (existing `stripIds` tests + 4 new `makeInert` tests).

- [ ] **Step 5: Make split-view clones inert** — edit `src/split-view.ts`

Change the import line:

```ts
import { makeInert, stripIds } from "./dom";
```

Replace the clone loop body so each clone is also made inert:

```ts
  for (const child of originalChildren) {
    right.appendChild(makeInert(stripIds(child.cloneNode(true) as HTMLElement)));
    left.appendChild(makeInert(stripIds(child.cloneNode(true) as HTMLElement)));
  }
```

- [ ] **Step 6: Add a split-view inert test** — append a case to `src/split-view.test.ts`

```ts
  it("makes the cloned panes inert (no scripts)", () => {
    document.body.innerHTML = `<p id="a">Hello</p><script>window.x=1</script>`;
    buildSplitView(document);
    const left = document.querySelector(".ls-left")!;
    expect(left.querySelector("script")).toBeNull();
  });
```

- [ ] **Step 7: Run the full suite**

Run: `pnpm exec vitest run src/dom.test.ts src/split-view.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/dom.ts src/dom.test.ts src/split-view.ts src/split-view.test.ts
git commit -m "feat: makeInert helper; split-view clones are inert"
```

---

## Task 2: Sentence segmentation (`segment.ts`)

**Files:**
- Create: `src/segment.ts`
- Test: `src/segment.test.ts`

- [ ] **Step 1: Write the failing test** — `src/segment.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { segmentSentences } from "./segment";

describe("segmentSentences", () => {
  it("splits English prose into trimmed sentences", () => {
    expect(segmentSentences("Hello world. How are you?", "en")).toEqual([
      "Hello world.",
      "How are you?",
    ]);
  });

  it("drops empty/whitespace-only segments", () => {
    expect(segmentSentences("   ", "en")).toEqual([]);
    expect(segmentSentences("One.\n\n  Two.", "en")).toEqual(["One.", "Two."]);
  });

  it("segments a non-Latin script (Japanese)", () => {
    expect(segmentSentences("これはペンです。あれは本です。", "ja")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/segment.test.ts`
Expected: FAIL — cannot import `segmentSentences`.

- [ ] **Step 3: Write the implementation** — `src/segment.ts`

```ts
/** Split `text` into trimmed, non-empty sentences using the locale's rules. */
export function segmentSentences(text: string, locale: string): string[] {
  const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
  const sentences: string[] = [];
  for (const { segment } of segmenter.segment(text)) {
    const trimmed = segment.trim();
    if (trimmed) sentences.push(trimmed);
  }
  return sentences;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/segment.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/segment.ts src/segment.test.ts
git commit -m "feat: locale-aware sentence segmentation"
```

---

## Task 3: Source-language resolution (`source-language.ts`)

**Files:**
- Create: `src/source-language.ts`
- Test: `src/source-language.test.ts`

The right-pane setting is either `"auto"` (use the page's `<html lang>`) or a specific code (override). Returns the base subtag, or `null` when it cannot be determined (caller prompts).

- [ ] **Step 1: Write the failing test** — `src/source-language.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { resolveSourceLanguage } from "./source-language";

describe("resolveSourceLanguage", () => {
  it("uses <html lang> when right pane is auto", () => {
    expect(resolveSourceLanguage("de", "auto")).toBe("de");
  });

  it("normalizes a region tag to its base subtag", () => {
    expect(resolveSourceLanguage("en-US", "auto")).toBe("en");
  });

  it("returns null when auto and no <html lang>", () => {
    expect(resolveSourceLanguage("", "auto")).toBeNull();
    expect(resolveSourceLanguage(null, "auto")).toBeNull();
  });

  it("uses the explicit override regardless of <html lang>", () => {
    expect(resolveSourceLanguage("de", "fr")).toBe("fr");
    expect(resolveSourceLanguage(null, "fr")).toBe("fr");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/source-language.test.ts`
Expected: FAIL — cannot import `resolveSourceLanguage`.

- [ ] **Step 3: Write the implementation** — `src/source-language.ts`

```ts
/**
 * Resolve the source (original) language code.
 * @param htmlLang the page's `<html lang>` value (may be null/empty)
 * @param rightLang the right-pane setting: "auto" or a specific BCP-47 code
 * @returns the base language subtag, or null when it cannot be determined
 */
export function resolveSourceLanguage(
  htmlLang: string | null | undefined,
  rightLang: string,
): string | null {
  const code = rightLang === "auto" ? (htmlLang ?? "").trim() : rightLang;
  if (!code) return null;
  return code.split("-")[0] ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/source-language.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/source-language.ts src/source-language.test.ts
git commit -m "feat: resolve source language from html lang or override"
```

---

## Task 4: Pane pairing (`pairing.ts`)

**Files:**
- Create: `src/pairing.ts`
- Test: `src/pairing.test.ts`

`pairPanes(left, right, sourceLocale)` walks the two structurally-identical panes in lockstep and tags sentences with a shared `data-pair-id`. A plain-text block becomes one `<span data-pair-id>` per sentence; a block containing inline markup gets a single `data-pair-id` on the block itself (markup preserved). Already-paired blocks are skipped (idempotent).

- [ ] **Step 1: Write the failing test** — `src/pairing.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { pairPanes } from "./pairing";

function panes(html: string): { left: HTMLElement; right: HTMLElement } {
  const left = document.createElement("div");
  const right = document.createElement("div");
  left.innerHTML = html;
  right.innerHTML = html;
  return { left, right };
}

function ids(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll("[data-pair-id]")).map(
    (el) => el.getAttribute("data-pair-id")!,
  );
}

describe("pairPanes", () => {
  it("wraps each sentence of a plain block in a span with a sequential pair-id", () => {
    const { left, right } = panes(`<p>Hello world. How are you?</p>`);
    pairPanes(left, right, "en");
    const spans = right.querySelectorAll("p > span[data-pair-id]");
    expect(spans.length).toBe(2);
    expect(spans[0]!.getAttribute("data-pair-id")).toBe("lm-0");
    expect(spans[1]!.getAttribute("data-pair-id")).toBe("lm-1");
    expect(spans[0]!.textContent).toBe("Hello world.");
  });

  it("uses the SAME ids in both panes", () => {
    const { left, right } = panes(`<p>One. Two.</p>`);
    pairPanes(left, right, "en");
    expect(ids(left)).toEqual(ids(right));
    expect(ids(left)).toEqual(["lm-0", "lm-1"]);
  });

  it("falls back to a single block-level pair when a block has inline markup", () => {
    const { left, right } = panes(`<p>See <a href="#">this link</a> now.</p>`);
    pairPanes(left, right, "en");
    const p = right.querySelector("p")!;
    expect(p.getAttribute("data-pair-id")).toBe("lm-0");
    expect(p.querySelector("a")).not.toBeNull(); // markup preserved
    expect(right.querySelectorAll("[data-pair-id]").length).toBe(1);
    expect(left.querySelector("p")!.getAttribute("data-pair-id")).toBe("lm-0");
  });

  it("assigns ids across multiple blocks in document order", () => {
    const { left, right } = panes(`<p>A. B.</p><h2>C.</h2>`);
    pairPanes(left, right, "en");
    expect(ids(right)).toEqual(["lm-0", "lm-1", "lm-2"]);
  });

  it("is idempotent — a second call adds no new pairs", () => {
    const { left, right } = panes(`<p>One. Two.</p>`);
    pairPanes(left, right, "en");
    const before = ids(right);
    pairPanes(left, right, "en");
    expect(ids(right)).toEqual(before);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/pairing.test.ts`
Expected: FAIL — cannot import `pairPanes`.

- [ ] **Step 3: Write the implementation** — `src/pairing.ts`

```ts
import { segmentSentences } from "./segment";

const BLOCK_TAGS = [
  "P", "LI", "H1", "H2", "H3", "H4", "H5", "H6",
  "BLOCKQUOTE", "FIGCAPTION", "DT", "DD", "TD", "TH", "CAPTION", "SUMMARY",
];
const NESTED_BLOCK_SELECTOR = BLOCK_TAGS.map((t) => t.toLowerCase()).join(",");

/** Leaf block-level elements that carry non-empty text and aren't already paired. */
function collectTextBlocks(root: HTMLElement): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    if (!BLOCK_TAGS.includes(el.tagName)) continue;
    if (el.querySelector(NESTED_BLOCK_SELECTOR)) continue; // not a leaf block
    if (!el.textContent || !el.textContent.trim()) continue;
    if (el.hasAttribute("data-pair-id") || el.querySelector("[data-pair-id]")) continue;
    blocks.push(el);
  }
  return blocks;
}

function wrapSentences(block: HTMLElement, sentences: string[], pairIds: string[]): void {
  const doc = block.ownerDocument;
  const nodes: Node[] = [];
  sentences.forEach((sentence, i) => {
    if (i > 0) nodes.push(doc.createTextNode(" "));
    const span = doc.createElement("span");
    span.setAttribute("data-pair-id", pairIds[i]!);
    span.textContent = sentence;
    nodes.push(span);
  });
  block.replaceChildren(...nodes);
}

/**
 * Tag sentences in both panes with a shared `data-pair-id`.
 * Plain blocks → one span per sentence; marked-up blocks → one id on the block.
 * The two panes are identical clones, so blocks pair by document order.
 */
export function pairPanes(left: HTMLElement, right: HTMLElement, sourceLocale: string): void {
  const leftBlocks = collectTextBlocks(left);
  const rightBlocks = collectTextBlocks(right);
  const count = Math.min(leftBlocks.length, rightBlocks.length);
  let next = 0;

  for (let i = 0; i < count; i++) {
    const lb = leftBlocks[i]!;
    const rb = rightBlocks[i]!;
    const markedUp = rb.children.length > 0;

    if (markedUp) {
      const id = `lm-${next++}`;
      rb.setAttribute("data-pair-id", id);
      lb.setAttribute("data-pair-id", id);
      continue;
    }

    const sentences = segmentSentences(rb.textContent ?? "", sourceLocale);
    const pairIds = sentences.map(() => `lm-${next++}`);
    wrapSentences(rb, sentences, pairIds);
    wrapSentences(lb, sentences, pairIds);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/pairing.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pairing.ts src/pairing.test.ts
git commit -m "feat: pair panes with shared data-pair-id spans (block-fallback)"
```

---

## Task 5: Translator wrapper (`translator.ts`)

**Files:**
- Create: `src/translator.ts`
- Test: `src/translator.test.ts`

Wraps the browser `Translator` API behind a small `TranslatorPort` and maps availability to `ready`/`unavailable`. The API is passed in (not read from the global) so tests use a mock. Also declares the ambient `Translator` global so `content.ts` compiles.

- [ ] **Step 1: Write the failing test** — `src/translator.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createTranslator, type TranslatorApi, type TranslatorAvailability } from "./translator";

function makeApi(availability: TranslatorAvailability): TranslatorApi {
  return {
    availability: async () => availability,
    create: async () => ({
      translate: async (text: string) => `[${text}]`,
      destroy: () => {},
    }),
  };
}

describe("createTranslator", () => {
  it("returns unavailable without creating a translator", async () => {
    let created = false;
    const api: TranslatorApi = {
      availability: async () => "unavailable",
      create: async () => {
        created = true;
        return { translate: async (t: string) => t, destroy: () => {} };
      },
    };
    const result = await createTranslator("en", "de", api);
    expect(result.status).toBe("unavailable");
    expect(created).toBe(false);
  });

  it("returns a ready port when available", async () => {
    const result = await createTranslator("en", "de", makeApi("available"));
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(await result.port.translate("hi")).toBe("[hi]");
    }
  });

  it("calls onDownloading for a downloadable model, then resolves ready", async () => {
    let downloading = false;
    const result = await createTranslator("en", "de", makeApi("downloadable"), {
      onDownloading: () => {
        downloading = true;
      },
    });
    expect(downloading).toBe(true);
    expect(result.status).toBe("ready");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/translator.test.ts`
Expected: FAIL — cannot import from `./translator`.

- [ ] **Step 3: Write the implementation** — `src/translator.ts`

```ts
export type TranslatorPort = {
  translate(text: string): Promise<string>;
  destroy(): void;
};

export type TranslatorAvailability =
  | "available"
  | "downloadable"
  | "downloading"
  | "unavailable";

type LanguagePair = { sourceLanguage: string; targetLanguage: string };

/** The slice of the browser `Translator` API this extension depends on. */
export type TranslatorApi = {
  availability(pair: LanguagePair): Promise<TranslatorAvailability>;
  create(pair: LanguagePair): Promise<TranslatorPort>;
};

export type CreateTranslatorResult =
  | { status: "ready"; port: TranslatorPort }
  | { status: "unavailable" };

/**
 * Resolve a ready TranslatorPort for the given pair, or report it's unavailable.
 * Calls `hooks.onDownloading` once if the model still needs to download.
 */
export async function createTranslator(
  source: string,
  target: string,
  api: TranslatorApi,
  hooks: { onDownloading?: () => void } = {},
): Promise<CreateTranslatorResult> {
  const pair: LanguagePair = { sourceLanguage: source, targetLanguage: target };
  const availability = await api.availability(pair);
  if (availability === "unavailable") return { status: "unavailable" };
  if (availability === "downloadable" || availability === "downloading") {
    hooks.onDownloading?.();
  }
  const port = await api.create(pair);
  return { status: "ready", port };
}
```

Note: we deliberately do **not** declare a `Translator` ambient global here — recent
TS DOM libs may already declare it, which would clash. The content script reads it via
a typed `globalThis` cast (Task 7).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/translator.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/translator.ts src/translator.test.ts
git commit -m "feat: Translator API wrapper with availability mapping"
```

---

## Task 6: Translation orchestrator (`translate-pane.ts`)

**Files:**
- Create: `src/translate-pane.ts`
- Test: `src/translate-pane.test.ts`

`translatePane(pane, port, deps)` fills the pane's `[data-pair-id]` elements visible-first then lazily, with bounded concurrency. Visibility is abstracted behind a `Visibility` port (real `IntersectionObserver` injected by the content script) so tests trigger "visible" deterministically. A failed translation leaves the original text. `stop()` halts work and disconnects.

- [ ] **Step 1: Write the failing test** — `src/translate-pane.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { translatePane, type TranslatorPort, type Visibility } from "./translate-pane";

function makePane(): HTMLElement {
  const pane = document.createElement("div");
  pane.innerHTML = `
    <span data-pair-id="lm-0">one</span>
    <span data-pair-id="lm-1">two</span>
    <span data-pair-id="lm-2">three</span>`;
  return pane;
}

function fakeVisibility() {
  const callbacks = new Map<Element, () => void>();
  let disconnected = false;
  const port: Visibility = {
    observe: (el, cb) => {
      callbacks.set(el, cb);
    },
    disconnect: () => {
      disconnected = true;
    },
  };
  return {
    port,
    reveal: (el: Element) => callbacks.get(el)?.(),
    revealAll: () => callbacks.forEach((cb) => cb()),
    get disconnected() {
      return disconnected;
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("translatePane", () => {
  it("translates a span only once it becomes visible", async () => {
    const pane = makePane();
    const vis = fakeVisibility();
    const port: TranslatorPort = { translate: async (t) => t.toUpperCase(), destroy: () => {} };
    translatePane(pane, port, { visibility: vis.port });

    const second = pane.querySelector('[data-pair-id="lm-1"]')!;
    expect(second.textContent).toBe("two"); // not visible yet
    vis.reveal(second);
    await flush();
    expect(second.textContent).toBe("TWO");
  });

  it("fills all spans once revealed", async () => {
    const pane = makePane();
    const vis = fakeVisibility();
    const port: TranslatorPort = { translate: async (t) => `${t}!`, destroy: () => {} };
    translatePane(pane, port, { visibility: vis.port });
    vis.revealAll();
    await flush();
    expect(Array.from(pane.querySelectorAll("[data-pair-id]")).map((e) => e.textContent))
      .toEqual(["one!", "two!", "three!"]);
  });

  it("keeps the original text when a translation fails", async () => {
    const pane = makePane();
    const vis = fakeVisibility();
    const port: TranslatorPort = { translate: async () => Promise.reject(new Error("x")), destroy: () => {} };
    translatePane(pane, port, { visibility: vis.port });
    vis.revealAll();
    await flush();
    expect(pane.querySelector('[data-pair-id="lm-0"]')!.textContent).toBe("one");
  });

  it("never exceeds the concurrency limit", async () => {
    const pane = makePane();
    const vis = fakeVisibility();
    let active = 0;
    let max = 0;
    const resolvers: Array<() => void> = [];
    const port: TranslatorPort = {
      translate: () => {
        active++;
        max = Math.max(max, active);
        return new Promise<string>((resolve) => {
          resolvers.push(() => {
            active--;
            resolve("x");
          });
        });
      },
      destroy: () => {},
    };
    translatePane(pane, port, { visibility: vis.port, concurrency: 2 });
    vis.revealAll();
    await flush();
    expect(max).toBe(2);
    resolvers.forEach((r) => r());
    await flush();
  });

  it("stop() disconnects visibility and halts further work", async () => {
    const pane = makePane();
    const vis = fakeVisibility();
    const translate = vi.fn(async (t: string) => t);
    const port: TranslatorPort = { translate, destroy: () => {} };
    const controller = translatePane(pane, port, { visibility: vis.port });
    controller.stop();
    expect(vis.disconnected).toBe(true);
    vis.revealAll();
    await flush();
    expect(translate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/translate-pane.test.ts`
Expected: FAIL — cannot import from `./translate-pane`.

- [ ] **Step 3: Write the implementation** — `src/translate-pane.ts`

```ts
import type { TranslatorPort } from "./translator";

export type { TranslatorPort };

/** Abstraction over IntersectionObserver: call `onVisible` when `el` enters view. */
export type Visibility = {
  observe(el: Element, onVisible: () => void): void;
  disconnect(): void;
};

export type TranslatePaneDeps = {
  visibility: Visibility;
  /** Max concurrent translate() calls. Default 4. */
  concurrency?: number;
};

export type Controller = { stop(): void };

/**
 * Fill `pane`'s [data-pair-id] elements with translations, visible-first then lazily,
 * with bounded concurrency. Failed translations keep their original text.
 */
export function translatePane(
  pane: HTMLElement,
  port: TranslatorPort,
  deps: TranslatePaneDeps,
): Controller {
  const concurrency = deps.concurrency ?? 4;
  const elements = Array.from(pane.querySelectorAll<HTMLElement>("[data-pair-id]"));
  const sourceText = new Map<HTMLElement, string>();
  const state = new Map<HTMLElement, "idle" | "pending">();

  for (const el of elements) {
    sourceText.set(el, el.textContent ?? "");
    state.set(el, "idle");
  }

  const queue: HTMLElement[] = [];
  let active = 0;
  let stopped = false;

  const pump = (): void => {
    while (!stopped && active < concurrency && queue.length > 0) {
      const el = queue.shift()!;
      active += 1;
      port
        .translate(sourceText.get(el) ?? "")
        .then(
          (translated) => {
            if (!stopped) el.textContent = translated;
          },
          () => {
            /* leave original text on failure */
          },
        )
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  const enqueue = (el: HTMLElement): void => {
    if (stopped || state.get(el) !== "idle") return;
    state.set(el, "pending");
    queue.push(el);
    pump();
  };

  for (const el of elements) {
    deps.visibility.observe(el, () => enqueue(el));
  }

  return {
    stop(): void {
      stopped = true;
      queue.length = 0;
      deps.visibility.disconnect();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/translate-pane.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/translate-pane.ts src/translate-pane.test.ts
git commit -m "feat: visible-first lazy translation orchestrator"
```

---

## Task 7: Wire translation into the content script (`content.ts`)

**Files:**
- Modify: `entrypoints/content.ts`

Browser glue — verified by `pnpm compile` and the manual e2e in Task 8 (cannot be unit-tested without a loaded extension + the on-device model). The content script reads settings, resolves the source language, pairs the panes, creates the translator (real `Translator` global), drives `translatePane` with a real `IntersectionObserver`, and shows a status banner.

- [ ] **Step 1: Replace `entrypoints/content.ts` with the wired version**

```ts
import { TOGGLE_SPLIT, type ToggleSplitMessage } from "../src/messages";
import { buildSplitView, type SplitView } from "../src/split-view";
import { getSettings } from "../src/settings";
import { resolveSourceLanguage } from "../src/source-language";
import { pairPanes } from "../src/pairing";
import { createTranslator, type TranslatorApi, type TranslatorPort } from "../src/translator";
import { translatePane, type Controller, type Visibility } from "../src/translate-pane";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    let view: SplitView | null = null;
    let controls: HTMLElement | null = null;
    let banner: Banner | null = null;
    let translation: Controller | null = null;
    let port: TranslatorPort | null = null;

    const teardown = (): void => {
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
Expected: no type errors. (`Translator` is read via a typed `globalThis` cast — no ambient global declared; `defineContentScript`/`IntersectionObserver` resolve via WXT + DOM lib types.)

- [ ] **Step 3: Run the full unit suite**

Run: `pnpm test`
Expected: PASS — all `src/*.test.ts` green.

- [ ] **Step 4: Commit**

```bash
git add entrypoints/content.ts
git commit -m "feat: translate left pane on activation with status banner"
```

---

## Task 8: Manual end-to-end validation

Validates real translation + pairing on a page whose language differs from the target (so translation actually runs). Requires Chrome/Edge **138+** for the on-device `Translator` API. No code unless a fix is needed.

- [ ] **Step 1: Build and load**

Run: `pnpm build`, then load `.output/chrome-mv3` via `chrome://extensions` → "Load unpacked". (Or `pnpm dev`.)

- [ ] **Step 2: Translate a foreign-language article**

- Open a German article, e.g. `https://de.wikipedia.org/wiki/Fahrrad` (it declares `<html lang="de">`).
- Popup → Left = English, Right = "Original language of the site" → "Split this page".
- Expected: right pane stays German; left pane fills in **English**, top-of-page first, more as you scroll. A "Preparing English…" banner may appear once on first use while the model downloads.

- [ ] **Step 3: Inspect pairing**

- DevTools → inspect a sentence in each pane → both carry the same `data-pair-id` (e.g. `lm-12`). Confirms Plan 3 has its pairing structure.

- [ ] **Step 4: Edge cases**

- Re-sync → re-captures and re-translates.
- Close / second toggle → collapses cleanly; the original page is interactive again.
- A page with no `<html lang>` and Right = "auto" → the banner asks you to set the page's language.
- Set Left = the page's own language → panes mirror, no banner, no translation calls.

- [ ] **Step 5: Record validation notes**

Append observations to this plan under a new `## Validation notes` heading (layout/translation quality/perf), then:

```bash
git add docs/superpowers/plans/2026-06-07-plan2-translation.md
git commit -m "docs: record Plan 2 validation notes"
```

---

## Done criteria for Plan 2

- `pnpm test` passes (segment, source-language, pairing, translator, translate-pane, plus updated dom/split-view).
- `pnpm compile` is clean.
- On a foreign-language page, the left pane shows an on-device translation that fills visible-first then lazily; the right pane is the untouched original.
- Every paired sentence carries a matching `data-pair-id` in both panes (block-level fallback for marked-up blocks).
- Availability/download and unsupported-pair states show a clear banner instead of failing silently.
- Ready for Plan 3 (synchronized hover-highlight + synced scroll) on top of the `data-pair-id` spans.
```
