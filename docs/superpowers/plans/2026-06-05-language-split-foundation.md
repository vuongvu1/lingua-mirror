# Lingua Mirror — Plan 1: Foundation & Split View

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Manifest V3 Chrome/Edge extension that, on toggle, splits the current page into two side-by-side panes that each faithfully mirror the page (no translation yet), and collapses back on a second toggle.

**Architecture:** WXT-based MV3 extension. A background service worker forwards a keyboard-command toggle to the active tab. A popup holds the two language pickers and a toggle button. A content script clones the page body's children into two light-DOM panes inside a full-viewport overlay, hides the original content, and exposes a small shadow-DOM control bar. Pure DOM/logic lives in `src/` and is unit-tested with Vitest + happy-dom; browser glue lives in `entrypoints/` and is verified manually.

**Tech Stack:** TypeScript, WXT, Vitest, happy-dom, Chrome Manifest V3.

**This is Plan 1 of 3.** Plan 2 adds sentence segmentation + on-device translation of the left pane. Plan 3 adds the synchronized hover-highlight and synced scrolling. The spec lives at `docs/superpowers/specs/2026-06-05-language-split-extension-design.md`.

---

## File Structure

```
lingua-mirror/
  package.json              # scripts + deps
  wxt.config.ts             # manifest + WXT config
  tsconfig.json             # extends WXT-generated tsconfig
  vitest.config.ts          # happy-dom test env
  test/
    setup.ts                # global `chrome` mock for tests
  src/
    settings.ts             # typed get/save of the two-language settings
    settings.test.ts
    languages.ts            # static list of supported languages
    dom.ts                  # stripIds() helper
    dom.test.ts
    split-view.ts           # buildSplitView()/destroy() — the two-pane overlay
    split-view.test.ts
    messages.ts             # shared message type constant
    active-tab.ts           # sendToActiveTab() — send a message to the active tab (added in impl)
  entrypoints/
    background.ts           # command -> message to active tab
    content.ts              # message listener -> build/teardown split + controls
    popup/
      index.html
      main.ts               # populate pickers, save settings, toggle button
      style.css
```

Responsibilities:
- `src/settings.ts` — the only place that reads/writes `chrome.storage.local`.
- `src/languages.ts` — single source of truth for the picker options.
- `src/dom.ts` — small pure DOM helpers (starts with `stripIds`).
- `src/split-view.ts` — owns the overlay structure and its teardown; knows nothing about translation or messaging.
- `src/messages.ts` — shared message contract so background, popup, and content agree.
- `src/active-tab.ts` — `sendToActiveTab(message)`; routes a message to the active tab's content script and no-ops on tabs without one (added during implementation to de-duplicate the background/popup send logic).
- `entrypoints/*` — thin browser glue, no business logic.

---

## Task 1: Project scaffold & tooling

**Files:**
- Create: `package.json`
- Create: `wxt.config.ts`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `test/setup.ts`
- Create: `src/sanity.test.ts` (temporary, deleted at end of task)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "lingua-mirror",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "zip": "wxt zip",
    "postinstall": "wxt prepare",
    "compile": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.270",
    "happy-dom": "^15.7.4",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1",
    "wxt": "^0.19.11"
  }
}
```

- [ ] **Step 2: Create `wxt.config.ts`**

```ts
import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Lingua Mirror",
    description:
      "Read any page side-by-side in two languages with synchronized hover-highlighting.",
    permissions: ["storage", "activeTab"],
    commands: {
      "toggle-split": {
        suggested_key: { default: "Ctrl+Shift+L", mac: "Command+Shift+L" },
        description: "Toggle the Lingua Mirror split on the current page",
      },
    },
  },
});
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "types": ["chrome", "vitest/globals"],
    "strict": true,
    "noUncheckedIndexedAccess": true
  }
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Create `test/setup.ts`** (a minimal `chrome` mock; tests override return values per case)

```ts
import { vi } from "vitest";

const chromeMock = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
    },
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn() },
  },
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn(),
  },
  commands: {
    onCommand: { addListener: vi.fn() },
  },
};

// @ts-expect-error - assign a partial mock onto the global for tests
globalThis.chrome = chromeMock;
```

- [ ] **Step 6: Install dependencies and generate WXT types**

Run: `npm install`
Expected: dependencies install and the `postinstall` hook runs `wxt prepare`, creating `.wxt/tsconfig.json`. If `.wxt/` is not created, run `npx wxt prepare` manually.

- [ ] **Step 7: Add a temporary sanity test** `src/sanity.test.ts`

```ts
import { describe, expect, it } from "vitest";

describe("toolchain", () => {
  it("runs vitest in a DOM environment", () => {
    const el = document.createElement("div");
    el.textContent = "ok";
    expect(el.textContent).toBe("ok");
  });
});
```

- [ ] **Step 8: Run the sanity test**

Run: `npm test`
Expected: PASS (1 test). Confirms Vitest + happy-dom + setup file all load.

- [ ] **Step 9: Type-check**

Run: `npm run compile`
Expected: no type errors.

- [ ] **Step 10: Delete the sanity test and commit**

```bash
rm src/sanity.test.ts
git add package.json wxt.config.ts tsconfig.json vitest.config.ts test/setup.ts .gitignore
git commit -m "chore: scaffold WXT extension with vitest + happy-dom"
```

---

## Task 2: Settings module

**Files:**
- Create: `src/settings.ts`
- Test: `src/settings.test.ts`

- [ ] **Step 1: Write the failing test** `src/settings.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, getSettings, saveSettings } from "./settings";

describe("settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns defaults when nothing is stored", async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({});
    await expect(getSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it("merges stored values over defaults", async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      settings: { leftLang: "de" },
    });
    await expect(getSettings()).resolves.toEqual({
      leftLang: "de",
      rightLang: "auto",
    });
  });

  it("persists settings under the 'settings' key", async () => {
    vi.mocked(chrome.storage.local.set).mockResolvedValue(undefined);
    await saveSettings({ leftLang: "en", rightLang: "auto" });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      settings: { leftLang: "en", rightLang: "auto" },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/settings.test.ts`
Expected: FAIL — cannot import from `./settings` (module not found).

- [ ] **Step 3: Write the implementation** `src/settings.ts`

```ts
export type Settings = {
  /** BCP-47 code for the translated (left) pane, e.g. "en". */
  leftLang: string;
  /** BCP-47 code for the original (right) pane, or "auto" to keep the site's language. */
  rightLang: string;
};

export const DEFAULT_SETTINGS: Settings = {
  leftLang: "en",
  rightLang: "auto",
};

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings as Partial<Settings> | undefined) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ settings });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/settings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts src/settings.test.ts
git commit -m "feat: typed settings storage with defaults"
```

---

## Task 3: DOM helper — stripIds

**Files:**
- Create: `src/dom.ts`
- Test: `src/dom.test.ts`

`stripIds` removes `id` attributes from an element and its descendants. We call it on cloned panes so the clones don't create duplicate IDs (which would break `getElementById` and `#id` CSS rules against the original).

- [ ] **Step 1: Write the failing test** `src/dom.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { stripIds } from "./dom";

describe("stripIds", () => {
  it("removes the id from the element itself", () => {
    const el = document.createElement("div");
    el.id = "root";
    stripIds(el);
    expect(el.hasAttribute("id")).toBe(false);
  });

  it("removes ids from all descendants", () => {
    const el = document.createElement("div");
    el.innerHTML = `<p id="a">x</p><section><span id="b">y</span></section>`;
    stripIds(el);
    expect(el.querySelectorAll("[id]").length).toBe(0);
  });

  it("returns the same element it was given", () => {
    const el = document.createElement("div");
    expect(stripIds(el)).toBe(el);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/dom.test.ts`
Expected: FAIL — cannot import `stripIds`.

- [ ] **Step 3: Write the implementation** `src/dom.ts`

```ts
export function stripIds<T extends Element>(el: T): T {
  if (el.hasAttribute("id")) {
    el.removeAttribute("id");
  }
  for (const node of el.querySelectorAll("[id]")) {
    node.removeAttribute("id");
  }
  return el;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/dom.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/dom.ts src/dom.test.ts
git commit -m "feat: stripIds DOM helper"
```

---

## Task 4: Split-view module

**Files:**
- Create: `src/split-view.ts`
- Test: `src/split-view.test.ts`

`buildSplitView(doc)` creates a full-viewport overlay `#ls-root` inside `<body>`, with two `.ls-pane` columns. It clones every existing body child into both panes (running them through `stripIds`), injects a layout stylesheet that hides the original body children while active, and sets `data-ls-active` on `<html>`. `destroy()` reverses all of it.

- [ ] **Step 1: Write the failing test** `src/split-view.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { buildSplitView } from "./split-view";

describe("buildSplitView", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-ls-active");
    document.body.innerHTML = `<p id="a">Hello</p><div id="b"><span id="c">x</span></div>`;
  });

  it("adds an #ls-root overlay with two panes", () => {
    buildSplitView(document);
    const root = document.getElementById("ls-root");
    expect(root).not.toBeNull();
    expect(root!.querySelectorAll(".ls-pane").length).toBe(2);
  });

  it("clones every original body child into each pane", () => {
    buildSplitView(document);
    const left = document.querySelector(".ls-left")!;
    const right = document.querySelector(".ls-right")!;
    // 2 original children (the <p> and the <div>) cloned into each pane
    expect(left.children.length).toBe(2);
    expect(right.children.length).toBe(2);
  });

  it("strips ids from the clones so the originals stay unique", () => {
    buildSplitView(document);
    const left = document.querySelector(".ls-left")!;
    expect(left.querySelectorAll("[id]").length).toBe(0);
    // original elements are untouched
    expect(document.getElementById("a")).not.toBeNull();
  });

  it("marks the document active", () => {
    buildSplitView(document);
    expect(document.documentElement.getAttribute("data-ls-active")).toBe("true");
  });

  it("destroy() removes the overlay and the active flag", () => {
    const view = buildSplitView(document);
    view.destroy();
    expect(document.getElementById("ls-root")).toBeNull();
    expect(document.documentElement.hasAttribute("data-ls-active")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/split-view.test.ts`
Expected: FAIL — cannot import `buildSplitView`.

- [ ] **Step 3: Write the implementation** `src/split-view.ts`

```ts
import { stripIds } from "./dom";

const ROOT_ID = "ls-root";
const STYLE_ID = "ls-layout-style";

const LAYOUT_CSS = `
#${ROOT_ID}{position:fixed;inset:0;z-index:2147483646;display:flex;background:#fff;}
#${ROOT_ID} .ls-pane{flex:1 1 0;min-width:0;height:100%;overflow:auto;}
#${ROOT_ID} .ls-pane.ls-left{border-right:2px solid #6c8cff;}
html[data-ls-active] body > :not(#${ROOT_ID}){display:none !important;}
`;

export type SplitView = {
  root: HTMLElement;
  left: HTMLElement;
  right: HTMLElement;
  destroy: () => void;
};

function injectStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = LAYOUT_CSS;
  doc.head.appendChild(style);
}

export function buildSplitView(doc: Document): SplitView {
  injectStyle(doc);

  const root = doc.createElement("div");
  root.id = ROOT_ID;

  const left = doc.createElement("div");
  left.className = "ls-pane ls-left";
  const right = doc.createElement("div");
  right.className = "ls-pane ls-right";

  const originalChildren = Array.from(doc.body.children).filter(
    (child) => child.id !== ROOT_ID,
  );
  for (const child of originalChildren) {
    right.appendChild(stripIds(child.cloneNode(true) as HTMLElement));
    left.appendChild(stripIds(child.cloneNode(true) as HTMLElement));
  }

  root.append(left, right);
  doc.body.appendChild(root);
  doc.documentElement.setAttribute("data-ls-active", "true");

  const destroy = (): void => {
    root.remove();
    doc.documentElement.removeAttribute("data-ls-active");
  };

  return { root, left, right, destroy };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/split-view.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/split-view.ts src/split-view.test.ts
git commit -m "feat: clone-in-place two-pane split view"
```

---

## Task 5: Shared message contract + background service worker

**Files:**
- Create: `src/messages.ts`
- Create: `entrypoints/background.ts`

This is browser glue — verified manually in Task 8 (cannot be unit-tested without a loaded extension).

- [ ] **Step 1: Create the shared message constant** `src/messages.ts`

```ts
export const TOGGLE_SPLIT = "TOGGLE_SPLIT" as const;

export type ToggleSplitMessage = { type: typeof TOGGLE_SPLIT };
```

- [ ] **Step 2: Create the background service worker** `entrypoints/background.ts`

```ts
import { TOGGLE_SPLIT } from "../src/messages";

export default defineBackground(() => {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "toggle-split") return;
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id != null) {
      chrome.tabs.sendMessage(tab.id, { type: TOGGLE_SPLIT });
    }
  });
});
```

- [ ] **Step 3: Type-check**

Run: `npm run compile`
Expected: no type errors. (`defineBackground` is a WXT auto-import global resolved via the generated `.wxt` types.)

- [ ] **Step 4: Commit**

```bash
git add src/messages.ts entrypoints/background.ts
git commit -m "feat: background forwards toggle command to active tab"
```

---

## Task 6: Content script + control bar

**Files:**
- Create: `entrypoints/content.ts`

The content script listens for the toggle message and builds/tears down the split. It also mounts a small control bar (Re-sync / Close) inside a shadow root so site CSS cannot affect it. Browser glue — verified manually in Task 8.

- [ ] **Step 1: Create the content script** `entrypoints/content.ts`

```ts
import { TOGGLE_SPLIT, type ToggleSplitMessage } from "../src/messages";
import { buildSplitView, type SplitView } from "../src/split-view";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    let view: SplitView | null = null;
    let controls: HTMLElement | null = null;

    const teardown = (): void => {
      controls?.remove();
      controls = null;
      view?.destroy();
      view = null;
    };

    const activate = (): void => {
      view = buildSplitView(document);
      controls = mountControls(view.root, { onClose: teardown, onResync: resync });
    };

    const resync = (): void => {
      teardown();
      activate();
    };

    const toggle = (): void => {
      if (view) teardown();
      else activate();
    };

    chrome.runtime.onMessage.addListener((message: ToggleSplitMessage) => {
      if (message?.type === TOGGLE_SPLIT) toggle();
    });
  },
});

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

Run: `npm run compile`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add entrypoints/content.ts
git commit -m "feat: content script toggles split + shadow-DOM controls"
```

---

## Task 7: Popup (settings dialog)

**Files:**
- Create: `src/languages.ts`
- Create: `entrypoints/popup/index.html`
- Create: `entrypoints/popup/style.css`
- Create: `entrypoints/popup/main.ts`

- [ ] **Step 1: Create the languages list** `src/languages.ts`

```ts
export type Language = { code: string; label: string };

export const LANGUAGES: Language[] = [
  { code: "en", label: "English" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "ja", label: "Japanese" },
  { code: "zh", label: "Chinese" },
  { code: "ko", label: "Korean" },
];
```

- [ ] **Step 2: Create the popup markup** `entrypoints/popup/index.html`

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <div class="head">🌍 Lingua Mirror</div>
    <div class="body">
      <label class="field">
        <span>Left pane — translated</span>
        <select id="left"></select>
      </label>
      <label class="field">
        <span>Right pane — original</span>
        <select id="right"></select>
      </label>
      <button id="toggle" class="toggle">Split this page</button>
    </div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 3: Create the popup styles** `entrypoints/popup/style.css`

```css
body {
  width: 300px;
  margin: 0;
  font: 13px system-ui, sans-serif;
  color: #1e1e1e;
}
.head {
  padding: 12px 14px;
  font-weight: 700;
  background: #eef1ff;
  border-bottom: 1px solid #e0e0e0;
}
.body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field span {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
}
select {
  padding: 8px 10px;
  font-size: 13px;
  border: 1px solid #c8c8c8;
  border-radius: 8px;
}
.toggle {
  padding: 11px;
  font-size: 13.5px;
  font-weight: 700;
  color: #fff;
  background: #6c8cff;
  border: none;
  border-radius: 9px;
  cursor: pointer;
}
```

- [ ] **Step 4: Create the popup logic** `entrypoints/popup/main.ts`

```ts
import { LANGUAGES } from "../../src/languages";
import { TOGGLE_SPLIT } from "../../src/messages";
import { getSettings, saveSettings } from "../../src/settings";

async function init(): Promise<void> {
  const leftSel = document.getElementById("left") as HTMLSelectElement;
  const rightSel = document.getElementById("right") as HTMLSelectElement;
  const toggleBtn = document.getElementById("toggle") as HTMLButtonElement;

  for (const lang of LANGUAGES) {
    leftSel.add(new Option(lang.label, lang.code));
  }
  rightSel.add(new Option("Original language of the site", "auto"));
  for (const lang of LANGUAGES) {
    rightSel.add(new Option(lang.label, lang.code));
  }

  const settings = await getSettings();
  leftSel.value = settings.leftLang;
  rightSel.value = settings.rightLang;

  const persist = (): void => {
    void saveSettings({ leftLang: leftSel.value, rightLang: rightSel.value });
  };
  leftSel.addEventListener("change", persist);
  rightSel.addEventListener("change", persist);

  toggleBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id != null) {
      chrome.tabs.sendMessage(tab.id, { type: TOGGLE_SPLIT });
    }
    window.close();
  });
}

void init();
```

- [ ] **Step 5: Type-check**

Run: `npm run compile`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/languages.ts entrypoints/popup/
git commit -m "feat: settings popup with language pickers and toggle"
```

---

## Task 8: Manual end-to-end validation

This task validates the clone-in-place layout on real sites — the part flagged as the key risk in the spec. No code unless a fix is needed.

- [ ] **Step 1: Build and load the extension**

Run: `npm run dev`
Expected: WXT launches a dev browser with the extension loaded. (Alternatively `npm run build`, then load `.output/chrome-mv3` via `chrome://extensions` → "Load unpacked".)

- [ ] **Step 2: Validate on a news article**

- Open a long article (e.g. `https://en.wikipedia.org/wiki/Bicycle`).
- Click the toolbar icon → set Left = German, Right = "Original language of the site" → click "Split this page".
- Expected: the page splits into two side-by-side panes, each showing the (still English) article content; the original single-column page is hidden behind the overlay; the control bar shows at top-center.

- [ ] **Step 3: Validate scrolling and teardown**

- Scroll each pane independently — both scroll.
- Click "Close" in the control bar → the overlay disappears and the original page is visible and interactive again.
- Press `Ctrl/Cmd+Shift+L` → it splits again; press again → it collapses.

- [ ] **Step 4: Validate on a second, differently-structured site**

- Repeat Step 2 on a blog or docs page (e.g. `https://developer.mozilla.org/en-US/docs/Web/HTML`).
- Note any layout breakage in `docs/superpowers/plans/2026-06-05-language-split-foundation.md` under a new "## Validation notes" heading (e.g. fixed headers overlapping, full-width backgrounds). These inform refinements but do not block Plan 1 — both panes rendering recognizable content is the bar.

- [ ] **Step 5: Commit any validation notes**

```bash
git add docs/superpowers/plans/2026-06-05-language-split-foundation.md
git commit -m "docs: record split-view validation notes"
```

---

## Done criteria for Plan 1

- `npm test` passes (settings, dom, split-view).
- `npm run compile` is clean.
- Toggling (via popup button and keyboard shortcut) splits and collapses the page on at least two real sites.
- Language selections persist across popup opens.
- Ready for Plan 2 (translation): `src/split-view.ts` exposes `left`/`right` panes that Plan 2 will segment, translate, and pair.
