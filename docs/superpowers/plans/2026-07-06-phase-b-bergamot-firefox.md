# Phase B — Bergamot Translation Engine for Firefox: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real on-device translation in Firefox by hosting Bergamot (wasm) in the background script, exposed to the content script through the existing `TranslatorApi` seam over a `runtime.connect` Port.

**Architecture:** New `src/bergamot/` module: a versioned Port protocol + pending-request map (pure, TDD), a content-side `TranslatorApi` proxy (TDD with fake ports), a background dispatcher (TDD with fake ports + mock engine), and a thin `BatchTranslator` adapter (verified manually). Background and content wiring is gated on `import.meta.env.BROWSER === "firefox"` so the Chrome bundle stays Bergamot-free.

**Tech Stack:** `@browsermt/bergamot-translator` (pinned), existing WXT/TS/Vitest toolchain.

**Spec:** `docs/superpowers/specs/2026-07-06-phase-b-bergamot-firefox-design.md`. Read it first.

---

## Ground rules for this plan

- Chrome behavior must not change. The native-`Translator` path in
  `entrypoints/content.ts` stays the first choice everywhere.
- `src/translator.ts` is the seam — do NOT modify it. Bergamot implements its
  existing `TranslatorApi`/`TranslatorPort` types.
- **API recon caveat:** the exact `@browsermt/bergamot-translator` API
  (constructor options, translate call shape, registry format/URL) is
  verified in Task 1. Code in Tasks 5–6 is written against the documented API
  (`BatchTranslator`, `translate({from,to,text,html})`); if recon finds
  differences, adapt Task 5's adapter (only that file) and note the deviation
  in the commit body. Everything else is package-agnostic by design.

## File structure (new/changed)

```
src/bergamot/
  protocol.ts        # Port name, message types, Pair, PortLike, createPendingMap()
  protocol.test.ts
  client.ts          # bergamotApi(connect): TranslatorApi — content-side proxy
  client.test.ts
  server.ts          # handleConnection(port, engines) — background dispatcher
  server.test.ts
  engine.ts          # bergamotEngineFactory() — BatchTranslator adapter (firefox-only chunk)
test/
  fake-port.ts       # fakePortPair() helper shared by client/server tests
entrypoints/
  background.ts      # MODIFIED: firefox-only onConnect → handleConnection
  content.ts         # MODIFIED: engine resolution falls back to bergamotApi on firefox
wxt.config.ts        # MODIFIED: firefox host_permissions for the model registry
CLAUDE.md            # MODIFIED: dependency-rule amendment + engine map
package.json         # MODIFIED: pinned @browsermt/bergamot-translator
```

---

## Task 1: Pin the dependency + API recon (kill-switch)

**Files:**
- Modify: `package.json` (+ lockfile)

- [ ] **Step 1: Install, exact-pinned**

Run: `npx -y pnpm@11 add -E @browsermt/bergamot-translator` from the repo root.
If the sandbox blocks pnpm (EACCES on `~/Library/pnpm`), STOP and ask the user
to run the install command themselves — do not switch package managers.

- [ ] **Step 2: Recon the installed package (no product code)**

Inspect `node_modules/@browsermt/bergamot-translator/`:
- List package `exports` / files: does `translator.js` export `BatchTranslator`? What are its constructor options (read the source: workers, batchSize, cacheSize, registryUrl, downloadTimeout…)?
- What is the exact translate call and result shape? (Documented: `translator.translate({from, to, text, html}) → {target: {text}}` — verify.)
- Where does the default model registry live (URL constant in the source) and what is the registry JSON shape (how to check a pair exists)?
- Do the wasm/worker assets load via `new Worker(...)` with package-relative URLs? Note anything WXT must copy/serve.

- [ ] **Step 3: Record findings**

Append a `## Recon findings (Task 1)` section to THIS plan file documenting:
exact import path, constructor options used, translate call shape, registry
URL + pair-lookup shape, and any asset-loading caveat. Tasks 5–7 consume this.

- [ ] **Step 4: Sanity + commit**

Run: `./node_modules/.bin/tsc --noEmit` (must stay clean — nothing imports the package yet) and `./node_modules/.bin/vitest run` (54 passing).

```bash
git add package.json pnpm-lock.yaml docs/superpowers/plans/2026-07-06-phase-b-bergamot-firefox.md
git commit -m "chore: pin @browsermt/bergamot-translator + API recon notes"
```

**Kill-switch:** if recon shows the package is broken/unusable (dead assets,
node-only, incompatible license), STOP the plan and report — fallback
(vendoring Mozilla worker artifacts) is a separate plan.

---

## Task 2: Port protocol + pending map (TDD)

**Files:**
- Create: `src/bergamot/protocol.ts`
- Test: `src/bergamot/protocol.test.ts`

- [ ] **Step 1: Write the failing test** `src/bergamot/protocol.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createPendingMap } from "./protocol";

describe("createPendingMap", () => {
  it("issues increasing ids", () => {
    const map = createPendingMap();
    expect(map.next()).toBe(0);
    expect(map.next()).toBe(1);
  });

  it("resolves a registered request by id", async () => {
    const map = createPendingMap();
    const id = map.next();
    const promise = map.register(id);
    map.resolve(id, "hallo");
    await expect(promise).resolves.toBe("hallo");
  });

  it("rejects a registered request by id", async () => {
    const map = createPendingMap();
    const id = map.next();
    const promise = map.register(id);
    map.reject(id, new Error("boom"));
    await expect(promise).rejects.toThrow("boom");
  });

  it("ignores resolutions for unknown ids", () => {
    const map = createPendingMap();
    expect(() => map.resolve(99, "x")).not.toThrow();
  });

  it("rejectAll rejects every pending request and clears the map", async () => {
    const map = createPendingMap();
    const a = map.register(map.next());
    const b = map.register(map.next());
    map.rejectAll(new Error("disconnected"));
    await expect(a).rejects.toThrow("disconnected");
    await expect(b).rejects.toThrow("disconnected");
    // subsequent resolve is a no-op, not a crash
    expect(() => map.resolve(0, "late")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `./node_modules/.bin/vitest run src/bergamot/protocol.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/bergamot/protocol.ts`

```ts
import type { TranslatorAvailability } from "../translator";

/** Name of the runtime.connect Port the bergamot client/server speak over. */
export const BERGAMOT_PORT = "bergamot";

export type Pair = { sourceLanguage: string; targetLanguage: string };

export type BergamotRequest =
  | { type: "availability"; pair: Pair }
  | { type: "init"; pair: Pair }
  | { type: "translate"; id: number; text: string };

export type BergamotResponse =
  | { type: "availability:result"; value: TranslatorAvailability }
  | { type: "init:result"; ok: boolean }
  | { type: "translate:result"; id: number; text: string }
  | { type: "translate:error"; id: number; message: string };

/**
 * Structural subset of chrome.runtime.Port used by both sides — lets tests
 * drive the protocol with plain fakes.
 */
export type PortLike = {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(cb: (message: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
};

type Pending = { resolve(text: string): void; reject(error: Error): void };

/** Pairs translate requests with their responses across one Port. */
export function createPendingMap(): {
  next(): number;
  register(id: number): Promise<string>;
  resolve(id: number, text: string): void;
  reject(id: number, error: Error): void;
  rejectAll(error: Error): void;
} {
  let counter = 0;
  const pending = new Map<number, Pending>();
  return {
    next: () => counter++,
    register(id) {
      return new Promise<string>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    },
    resolve(id, text) {
      pending.get(id)?.resolve(text);
      pending.delete(id);
    },
    reject(id, error) {
      pending.get(id)?.reject(error);
      pending.delete(id);
    },
    rejectAll(error) {
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `./node_modules/.bin/vitest run src/bergamot/protocol.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Type-check + commit**

```bash
git add src/bergamot/protocol.ts src/bergamot/protocol.test.ts
git commit -m "feat: bergamot port protocol and pending-request map"
```

---

## Task 3: Fake port pair helper + content-side proxy (TDD)

**Files:**
- Create: `test/fake-port.ts`
- Create: `src/bergamot/client.ts`
- Test: `src/bergamot/client.test.ts`

- [ ] **Step 1: Create the shared test helper** `test/fake-port.ts`

```ts
import type { PortLike } from "../src/bergamot/protocol";

/**
 * Two linked in-memory ports: messages posted on one side arrive on the
 * other synchronously; disconnect() fires the peer's onDisconnect.
 */
export function fakePortPair(): [PortLike, PortLike] {
  const listeners: [Array<(m: unknown) => void>, Array<() => void>][] = [
    [[], []],
    [[], []],
  ];
  let connected = true;
  const make = (self: 0 | 1, peer: 0 | 1): PortLike => ({
    postMessage(message) {
      if (!connected) return;
      for (const cb of listeners[peer]![0]) cb(message);
    },
    disconnect() {
      if (!connected) return;
      connected = false;
      for (const cb of listeners[peer]![1]) cb();
    },
    onMessage: { addListener: (cb) => listeners[self]![0].push(cb) },
    onDisconnect: { addListener: (cb) => listeners[self]![1].push(cb) },
  });
  return [make(0, 1), make(1, 0)];
}
```

- [ ] **Step 2: Write the failing test** `src/bergamot/client.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { fakePortPair } from "../../test/fake-port";
import type { BergamotRequest, PortLike } from "./protocol";
import { bergamotApi } from "./client";

const PAIR = { sourceLanguage: "de", targetLanguage: "en" };

/** Collects server-side messages and lets a test script the responses. */
function harness() {
  const [clientPort, serverPort] = fakePortPair();
  const received: BergamotRequest[] = [];
  serverPort.onMessage.addListener((m) => received.push(m as BergamotRequest));
  return { clientPort, serverPort, received, connect: (): PortLike => clientPort };
}

describe("bergamotApi", () => {
  it("resolves availability from the background's answer", async () => {
    const h = harness();
    const api = bergamotApi(h.connect);
    const promise = api.availability(PAIR);
    expect(h.received[0]).toEqual({ type: "availability", pair: PAIR });
    h.serverPort.postMessage({ type: "availability:result", value: "downloadable" });
    await expect(promise).resolves.toBe("downloadable");
  });

  it("create() sends init and yields a working TranslatorPort", async () => {
    const h = harness();
    const api = bergamotApi(h.connect);
    const portPromise = api.create(PAIR);
    expect(h.received[0]).toEqual({ type: "init", pair: PAIR });
    h.serverPort.postMessage({ type: "init:result", ok: true });
    const translator = await portPromise;

    const textPromise = translator.translate("Hallo Welt.");
    const request = h.received[1] as { type: string; id: number; text: string };
    expect(request.type).toBe("translate");
    h.serverPort.postMessage({ type: "translate:result", id: request.id, text: "Hello world." });
    await expect(textPromise).resolves.toBe("Hello world.");
  });

  it("rejects create() when init fails", async () => {
    const h = harness();
    const api = bergamotApi(h.connect);
    const portPromise = api.create(PAIR);
    h.serverPort.postMessage({ type: "init:result", ok: false });
    await expect(portPromise).rejects.toThrow();
  });

  it("maps translate:error to a rejection for that id only", async () => {
    const h = harness();
    const api = bergamotApi(h.connect);
    const portPromise = api.create(PAIR);
    h.serverPort.postMessage({ type: "init:result", ok: true });
    const translator = await portPromise;

    const bad = translator.translate("kaputt");
    const good = translator.translate("gut");
    const [first, second] = h.received.slice(1) as Array<{ id: number }>;
    h.serverPort.postMessage({ type: "translate:error", id: first!.id, message: "engine burp" });
    h.serverPort.postMessage({ type: "translate:result", id: second!.id, text: "good" });
    await expect(bad).rejects.toThrow("engine burp");
    await expect(good).resolves.toBe("good");
  });

  it("rejects all in-flight translations when the port disconnects", async () => {
    const h = harness();
    const api = bergamotApi(h.connect);
    const portPromise = api.create(PAIR);
    h.serverPort.postMessage({ type: "init:result", ok: true });
    const translator = await portPromise;

    const inflight = translator.translate("hängt");
    h.serverPort.disconnect();
    await expect(inflight).rejects.toThrow();
  });

  it("destroy() disconnects the port", async () => {
    const h = harness();
    let disconnected = false;
    h.clientPort.onDisconnect.addListener(() => {}); // client side
    h.serverPort.onDisconnect.addListener(() => {
      disconnected = true;
    });
    const api = bergamotApi(h.connect);
    const portPromise = api.create(PAIR);
    h.serverPort.postMessage({ type: "init:result", ok: true });
    const translator = await portPromise;
    translator.destroy();
    expect(disconnected).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `./node_modules/.bin/vitest run src/bergamot/client.test.ts`
Expected: FAIL — `./client` not found.

- [ ] **Step 4: Implement** `src/bergamot/client.ts`

```ts
import type { TranslatorApi, TranslatorPort } from "../translator";
import {
  createPendingMap,
  type BergamotResponse,
  type Pair,
  type PortLike,
} from "./protocol";

/**
 * Content-side TranslatorApi backed by the background bergamot engine.
 * availability() uses a short-lived port; create() keeps its port open for
 * the lifetime of the returned TranslatorPort (destroy() disconnects it).
 */
export function bergamotApi(connect: () => PortLike): TranslatorApi {
  return {
    availability(pair: Pair) {
      const port = connect();
      return new Promise((resolve) => {
        port.onMessage.addListener((message) => {
          const response = message as BergamotResponse;
          if (response.type === "availability:result") {
            port.disconnect();
            resolve(response.value);
          }
        });
        port.onDisconnect.addListener(() => resolve("unavailable"));
        port.postMessage({ type: "availability", pair });
      });
    },

    create(pair: Pair): Promise<TranslatorPort> {
      const port = connect();
      const pending = createPendingMap();
      let ready: (translator: TranslatorPort) => void;
      let failed: (error: Error) => void;
      const result = new Promise<TranslatorPort>((resolve, reject) => {
        ready = resolve;
        failed = reject;
      });

      const translator: TranslatorPort = {
        translate(text) {
          const id = pending.next();
          const reply = pending.register(id);
          port.postMessage({ type: "translate", id, text });
          return reply;
        },
        destroy() {
          port.disconnect();
        },
      };

      port.onMessage.addListener((message) => {
        const response = message as BergamotResponse;
        switch (response.type) {
          case "init:result":
            if (response.ok) ready(translator);
            else failed(new Error(`bergamot init failed for ${pair.sourceLanguage}→${pair.targetLanguage}`));
            break;
          case "translate:result":
            pending.resolve(response.id, response.text);
            break;
          case "translate:error":
            pending.reject(response.id, new Error(response.message));
            break;
        }
      });
      port.onDisconnect.addListener(() => {
        pending.rejectAll(new Error("bergamot port disconnected"));
        failed(new Error("bergamot port disconnected"));
      });

      port.postMessage({ type: "init", pair });
      return result;
    },
  };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `./node_modules/.bin/vitest run src/bergamot/client.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Type-check + commit**

```bash
git add test/fake-port.ts src/bergamot/client.ts src/bergamot/client.test.ts
git commit -m "feat: content-side bergamot TranslatorApi proxy"
```

---

## Task 4: Background dispatcher (TDD)

**Files:**
- Create: `src/bergamot/server.ts`
- Test: `src/bergamot/server.test.ts`

- [ ] **Step 1: Write the failing test** `src/bergamot/server.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { fakePortPair } from "../../test/fake-port";
import type { BergamotResponse } from "./protocol";
import { handleConnection, type EngineFactory } from "./server";

const PAIR = { sourceLanguage: "de", targetLanguage: "en" };

function collect(port: ReturnType<typeof fakePortPair>[0]): BergamotResponse[] {
  const out: BergamotResponse[] = [];
  port.onMessage.addListener((m) => out.push(m as BergamotResponse));
  return out;
}

function mockEngines(overrides: Partial<EngineFactory> = {}): EngineFactory {
  return {
    availability: vi.fn().mockResolvedValue("downloadable"),
    create: vi.fn().mockResolvedValue({
      translate: vi.fn(async (text: string) => text.toUpperCase()),
      destroy: vi.fn(),
    }),
    ...overrides,
  };
}

describe("handleConnection", () => {
  it("answers availability requests", async () => {
    const [client, server] = fakePortPair();
    const responses = collect(client);
    handleConnection(server, mockEngines());
    client.postMessage({ type: "availability", pair: PAIR });
    await vi.waitFor(() =>
      expect(responses).toContainEqual({ type: "availability:result", value: "downloadable" }),
    );
  });

  it("init creates an engine and confirms", async () => {
    const [client, server] = fakePortPair();
    const responses = collect(client);
    const engines = mockEngines();
    handleConnection(server, engines);
    client.postMessage({ type: "init", pair: PAIR });
    await vi.waitFor(() =>
      expect(responses).toContainEqual({ type: "init:result", ok: true }),
    );
    expect(engines.create).toHaveBeenCalledWith(PAIR);
  });

  it("init failure reports ok:false", async () => {
    const [client, server] = fakePortPair();
    const responses = collect(client);
    handleConnection(server, mockEngines({ create: vi.fn().mockRejectedValue(new Error("no model")) }));
    client.postMessage({ type: "init", pair: PAIR });
    await vi.waitFor(() =>
      expect(responses).toContainEqual({ type: "init:result", ok: false }),
    );
  });

  it("translates after init, echoing the request id", async () => {
    const [client, server] = fakePortPair();
    const responses = collect(client);
    handleConnection(server, mockEngines());
    client.postMessage({ type: "init", pair: PAIR });
    await vi.waitFor(() => expect(responses.length).toBe(1));
    client.postMessage({ type: "translate", id: 7, text: "hallo" });
    await vi.waitFor(() =>
      expect(responses).toContainEqual({ type: "translate:result", id: 7, text: "HALLO" }),
    );
  });

  it("maps a translate crash to translate:error with the same id", async () => {
    const [client, server] = fakePortPair();
    const responses = collect(client);
    const engines = mockEngines({
      create: vi.fn().mockResolvedValue({
        translate: vi.fn().mockRejectedValue(new Error("wasm panic")),
        destroy: vi.fn(),
      }),
    });
    handleConnection(server, engines);
    client.postMessage({ type: "init", pair: PAIR });
    await vi.waitFor(() => expect(responses.length).toBe(1));
    client.postMessage({ type: "translate", id: 3, text: "x" });
    await vi.waitFor(() =>
      expect(responses).toContainEqual({ type: "translate:error", id: 3, message: "wasm panic" }),
    );
  });

  it("translate before init errors instead of crashing", async () => {
    const [client, server] = fakePortPair();
    const responses = collect(client);
    handleConnection(server, mockEngines());
    client.postMessage({ type: "translate", id: 1, text: "premature" });
    await vi.waitFor(() =>
      expect(responses).toContainEqual({
        type: "translate:error",
        id: 1,
        message: "not initialized",
      }),
    );
  });

  it("destroys the engine on disconnect", async () => {
    const [client, server] = fakePortPair();
    const destroy = vi.fn();
    const engines = mockEngines({
      create: vi.fn().mockResolvedValue({ translate: vi.fn(), destroy }),
    });
    const responses = collect(client);
    handleConnection(server, engines);
    client.postMessage({ type: "init", pair: PAIR });
    await vi.waitFor(() => expect(responses.length).toBe(1));
    client.disconnect();
    expect(destroy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `./node_modules/.bin/vitest run src/bergamot/server.test.ts`
Expected: FAIL — `./server` not found.

- [ ] **Step 3: Implement** `src/bergamot/server.ts`

```ts
import type { TranslatorAvailability, TranslatorPort } from "../translator";
import type { BergamotRequest, Pair, PortLike } from "./protocol";

/** What the background needs from an engine implementation. */
export type EngineFactory = {
  availability(pair: Pair): Promise<TranslatorAvailability>;
  create(pair: Pair): Promise<TranslatorPort>;
};

/**
 * Serve one content-script connection: answer availability, hold at most one
 * engine per connection, translate by id, tear down on disconnect.
 */
export function handleConnection(port: PortLike, engines: EngineFactory): void {
  let engine: TranslatorPort | null = null;
  let closed = false;

  const send = (message: unknown): void => {
    if (!closed) port.postMessage(message);
  };

  port.onMessage.addListener((message) => {
    const request = message as BergamotRequest;
    switch (request.type) {
      case "availability":
        void engines.availability(request.pair).then(
          (value) => send({ type: "availability:result", value }),
          () => send({ type: "availability:result", value: "unavailable" }),
        );
        break;
      case "init":
        void engines.create(request.pair).then(
          (created) => {
            engine = created;
            send({ type: "init:result", ok: true });
          },
          () => send({ type: "init:result", ok: false }),
        );
        break;
      case "translate": {
        if (!engine) {
          send({ type: "translate:error", id: request.id, message: "not initialized" });
          break;
        }
        void engine.translate(request.text).then(
          (text) => send({ type: "translate:result", id: request.id, text }),
          (error: unknown) =>
            send({
              type: "translate:error",
              id: request.id,
              message: error instanceof Error ? error.message : String(error),
            }),
        );
        break;
      }
    }
  });

  port.onDisconnect.addListener(() => {
    closed = true;
    engine?.destroy();
    engine = null;
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `./node_modules/.bin/vitest run src/bergamot/server.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Full suite + type-check + commit**

Run: `./node_modules/.bin/vitest run` (expect 54 + 5 + 6 + 7 = 72) and `./node_modules/.bin/tsc --noEmit`.

```bash
git add src/bergamot/server.ts src/bergamot/server.test.ts
git commit -m "feat: background bergamot connection dispatcher"
```

---

## Task 5: BatchTranslator engine adapter

**Files:**
- Create: `src/bergamot/engine.ts`

Thin adapter over the real package — no unit tests (the contract is pinned by
Task 1 recon + Task 8 manual e2e). **Adapt the exact import path, constructor
options, registry URL/shape, and translate call to the Task 1 recon findings**;
the structure below is the contract that must hold.

**Recon-driven requirements (from `## Recon findings (Task 1)` — read it):**
- Registry: `https://bergamot.s3.amazonaws.com/models/index.json`; keys are
  4-char pairs (`"deen"`); English pivot is built into `BatchTranslator`
  (`pivotLanguage: 'en'` default), so a pair is usable if it exists directly
  OR both `${from}en` and `en${to}` exist.
- `workerUrl` option is DEAD — `TranslatorBacking.loadWorker()` hardcodes
  `new Worker(new URL('./worker/translator-worker.js', import.meta.url))`,
  which breaks under Vite bundling. Subclass `TranslatorBacking`, override
  `loadWorker()` to mirror the original implementation (read it in
  `node_modules/.../translator.js`) but construct the Worker from
  `chrome.runtime.getURL("/worker/translator-worker.js")`.
- `TranslatorBacking`'s constructor fetches the registry immediately — keep
  construction lazy (first `create()`), never at module top level.
- Verify whether `new BatchTranslator(options, backing)` accepts a backing
  instance (check the constructor at translator.js:461+). If not, follow
  whatever injection the source supports (e.g. subclassing BatchTranslator);
  note the deviation in the commit body.

- [ ] **Step 1: Implement** `src/bergamot/engine.ts`

```ts
// Firefox-only chunk: imported dynamically from the background entrypoint.
// API per the Task 1 recon findings in the plan doc.
import {
  BatchTranslator,
  TranslatorBacking,
} from "@browsermt/bergamot-translator/translator.js";
import type { TranslatorAvailability, TranslatorPort } from "../translator";
import type { Pair } from "./protocol";
import type { EngineFactory } from "./server";

const REGISTRY_URL = "https://bergamot.s3.amazonaws.com/models/index.json";

/**
 * The stock backing spawns its worker via import.meta.url, which Vite
 * bundling breaks. Same implementation, but the Worker URL comes from the
 * extension package (assets shipped by the wxt config, Task 6).
 */
class ExtensionBacking extends TranslatorBacking {
  // Mirror the original loadWorker() body (translator.js:118) — only the
  // Worker construction changes. Keep the same return shape.
  override loadWorker(): ReturnType<TranslatorBacking["loadWorker"]> {
    return super.loadWorkerFromUrl(
      chrome.runtime.getURL("/worker/translator-worker.js"),
    );
    // ^ If no such seam exists in the source, inline the original body here
    //   with the swapped URL instead — read translator.js and replicate.
  }
}

let registryPromise: Promise<Record<string, unknown>> | null = null;
function loadRegistry(): Promise<Record<string, unknown>> {
  registryPromise ??= fetch(REGISTRY_URL).then(
    (response) => response.json() as Promise<Record<string, unknown>>,
  );
  return registryPromise;
}

// ponytail: one shared BatchTranslator; per-connection destroy() is a no-op
// so a re-split doesn't re-pay wasm startup. Add idle teardown if memory bites.
let translator: BatchTranslator | null = null;
function sharedTranslator(): BatchTranslator {
  translator ??= new BatchTranslator(
    { workers: 1, registryUrl: REGISTRY_URL },
    new ExtensionBacking({ registryUrl: REGISTRY_URL }),
  );
  return translator;
}

/** Direct pair, or pivotable through English (BatchTranslator pivots itself). */
async function pairSupported(pair: Pair): Promise<boolean> {
  const registry = await loadRegistry();
  const { sourceLanguage: from, targetLanguage: to } = pair;
  return (
    `${from}${to}` in registry ||
    (`${from}en` in registry && `en${to}` in registry)
  );
}

export function bergamotEngineFactory(): EngineFactory {
  return {
    async availability(pair): Promise<TranslatorAvailability> {
      try {
        return (await pairSupported(pair)) ? "downloadable" : "unavailable";
      } catch {
        return "unavailable"; // registry unreachable
      }
    },
    async create(pair): Promise<TranslatorPort> {
      if (!(await pairSupported(pair))) {
        throw new Error(
          `no bergamot model for ${pair.sourceLanguage}→${pair.targetLanguage}`,
        );
      }
      const engine = sharedTranslator();
      return {
        async translate(text) {
          const response = await engine.translate({
            from: pair.sourceLanguage,
            to: pair.targetLanguage,
            text,
            html: false,
          });
          return response.target.text;
        },
        destroy() {
          // Shared instance stays warm; see ponytail note above.
        },
      };
    },
  };
}
```

- [ ] **Step 2: Types**

The package ships no `.d.ts` (recon). Add `src/bergamot/bergamot-translator.d.ts`,
declaring ONLY what we call — align member names with the real source:

```ts
declare module "@browsermt/bergamot-translator/translator.js" {
  export type BergamotOptions = {
    workers?: number;
    batchSize?: number;
    cacheSize?: number;
    registryUrl?: string;
    downloadTimeout?: number;
    pivotLanguage?: string | null;
  };
  export class TranslatorBacking {
    constructor(options?: BergamotOptions);
    loadWorker(): unknown; // narrow to the real return shape while implementing
  }
  export class BatchTranslator {
    constructor(options?: BergamotOptions, backing?: TranslatorBacking);
    translate(request: {
      from: string;
      to: string;
      text: string;
      html: boolean;
    }): Promise<{ target: { text: string } }>;
    delete(): void;
  }
}
```

- [ ] **Step 3: Type-check + commit**

Run: `./node_modules/.bin/tsc --noEmit` — clean.

```bash
git add src/bergamot/engine.ts src/bergamot/bergamot-translator.d.ts
git commit -m "feat: BatchTranslator engine adapter for the bergamot dispatcher"
```

---

## Task 6: Wire background + manifest

**Files:**
- Modify: `entrypoints/background.ts`
- Modify: `wxt.config.ts`

- [ ] **Step 1: Background — firefox-gated connection handler**

Add to `entrypoints/background.ts` inside `defineBackground(() => { ... })`,
after the existing command listener:

```ts
    // Firefox has no built-in Translator API; host bergamot in the background.
    // import.meta.env.BROWSER is compile-time — this whole branch (and the
    // dynamic chunk) is dropped from Chrome builds.
    if (import.meta.env.BROWSER === "firefox") {
      chrome.runtime.onConnect.addListener((port) => {
        if (port.name !== BERGAMOT_PORT) return;
        void import("../src/bergamot/engine").then(({ bergamotEngineFactory }) => {
          handleConnection(port, bergamotEngineFactory());
        });
      });
    }
```

With imports at the top of the file:

```ts
import { BERGAMOT_PORT } from "../src/bergamot/protocol";
import { handleConnection } from "../src/bergamot/server";
```

(`chrome.runtime.Port` satisfies `PortLike` structurally — no cast needed. If
tsc disagrees on listener signatures, adapt `PortLike` in protocol.ts, not the
call site.)

- [ ] **Step 2: Manifest — host permission + wasm CSP (firefox only)**

In `wxt.config.ts`, inside the existing `...(browser === "firefox" && { ... })`
spread, add:

```ts
      host_permissions: ["https://bergamot.s3.amazonaws.com/*"],
      content_security_policy: {
        extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
      },
```

(S3 origin per recon — registry AND model files come from there. The CSP
grants wasm compilation in extension pages; required for the Emscripten glue.)

- [ ] **Step 2b: Ship the worker assets (firefox output only)**

The three files `node_modules/@browsermt/bergamot-translator/worker/`
`{translator-worker.js, bergamot-translator-worker.js, bergamot-translator-worker.wasm}`
(~5.3MB) must land at `/worker/` in the FIREFOX build output and be ABSENT
from the Chrome output (purity check).

Preferred: WXT's public-assets hook in `wxt.config.ts` (verify the exact hook
signature against the installed WXT 0.20 docs/types — `wxt/dist` types list
available hooks):

```ts
  hooks: {
    "build:publicAssets": (wxt, assets) => {
      if (wxt.config.browser !== "firefox") return;
      const base = "node_modules/@browsermt/bergamot-translator/worker";
      for (const file of [
        "translator-worker.js",
        "bergamot-translator-worker.js",
        "bergamot-translator-worker.wasm",
      ]) {
        assets.push({
          absoluteSrc: resolve(base, file),
          relativeDest: `worker/${file}`,
        });
      }
    },
  },
```

(`import { resolve } from "node:path"` at the top of wxt.config.ts.) If the
hook's real shape differs, adapt; if WXT 0.20 has no usable hook, fall back to
a small Vite plugin in the config's `vite:` option that copies the files in
`writeBundle` when `wxt.config.browser === "firefox"`. Requirement is fixed,
mechanism is free.

- [ ] **Step 3: Build both targets + purity check**

Run: `./node_modules/.bin/wxt build` and `./node_modules/.bin/wxt build -b firefox --mv3`
Then verify the Chrome bundle is bergamot-free:

Run: `grep -ri bergamot .output/chrome-mv3/ | wc -l`
Expected: `0`. Also compare sizes: chrome total must stay ~20 kB; firefox
grows by the wasm/worker chunk.

- [ ] **Step 4: Commit**

```bash
git add entrypoints/background.ts wxt.config.ts
git commit -m "feat: firefox background hosts bergamot engine behind runtime port"
```

---

## Task 7: Wire content script + CLAUDE.md

**Files:**
- Modify: `entrypoints/content.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Engine resolution in `entrypoints/content.ts`**

Replace the current native-only lookup:

```ts
      const translatorApi = (globalThis as { Translator?: TranslatorApi }).Translator;
      if (!translatorApi) {
        status.show("Translation isn't available in this browser.");
        return;
      }
```

with:

```ts
      const translatorApi = resolveTranslatorApi();
      if (!translatorApi) {
        status.show("Translation isn't available in this browser.");
        return;
      }
```

and add at module level (with imports for `bergamotApi` from
`../src/bergamot/client` and `BERGAMOT_PORT` from `../src/bergamot/protocol`):

```ts
/** Native Translator API where the browser has it; bergamot proxy on Firefox. */
function resolveTranslatorApi(): TranslatorApi | undefined {
  const native = (globalThis as { Translator?: TranslatorApi }).Translator;
  if (native) return native;
  if (import.meta.env.BROWSER === "firefox") {
    return bergamotApi(() => chrome.runtime.connect({ name: BERGAMOT_PORT }));
  }
  return undefined;
}
```

Note: the existing `createTranslator` flow already maps `"downloadable"` to
the "Preparing …" banner and the bergamot engine reports `"downloadable"`
whenever the pair exists — so on Firefox the banner shows on every activation
until translation starts. Accepted v1 behavior (spec: availability decision).

- [ ] **Step 2: CLAUDE.md updates**

- Stack section: replace the Firefox bullet's "A Bergamot-wasm engine backend
  is the plotted fix (own spec, not yet built)." with "Translation there runs
  on the bundled Bergamot engine (background script, `src/bergamot/`)."
- Rules MUST list: add "Engine map: content resolves native `Translator`
  first, bergamot Port proxy on Firefox (`resolveTranslatorApi` in
  content.ts). Bergamot code must never reach the Chrome bundle
  (`import.meta.env.BROWSER` gates + grep check in `docs/...phase-b` plan)."
- Rules NEVER list: change "No backend, no runtime dependencies." context:
  amend the stack bullet to "No backend. One pinned runtime dependency:
  `@browsermt/bergamot-translator` (Firefox engine)."

- [ ] **Step 3: Verify everything**

Run: `./node_modules/.bin/tsc --noEmit` — clean.
Run: `./node_modules/.bin/vitest run` — 72 passing.
Run: both builds + the grep purity check from Task 6 Step 3 again.

- [ ] **Step 4: Commit**

```bash
git add entrypoints/content.ts CLAUDE.md
git commit -m "feat: firefox content script falls back to bergamot engine"
```

---

## Task 8: Manual end-to-end validation (user)

- [ ] **Firefox happy path:** `pnpm build:firefox`, load temporary add-on, open
  a German article, Left = English → split. Expect "Preparing en…" then
  progressive translation. First use downloads the model (network tab shows
  registry + model fetches — from Mozilla's bucket, nothing else).
- [ ] **Cancel:** close mid-translation — no console errors, background port
  closes.
- [ ] **Unsupported pair:** Left = a language without a Mozilla model (e.g.
  Korean if absent from registry) → banner "isn't available on this device."
- [ ] **Chrome regression:** `pnpm build`, load, translate a page — identical
  behavior to before; DevTools network shows no bergamot/registry traffic.
- [ ] **Record notes:** append `## Validation notes` to this plan; commit.

---

## Done criteria

- 72 unit tests green; tsc clean.
- Chrome bundle contains zero bergamot bytes (grep = 0) and its size is unchanged.
- Firefox: real translation with model download UX; cancel and unsupported-pair paths behave.
- CLAUDE.md reflects the engine map and the amended dependency rule.

---

## Recon findings (Task 1)

Inspected `node_modules/@browsermt/bergamot-translator` v0.4.9 (source, not docs-only).

### 1. Exports / import paths

`package.json`: `"type": "module"`, `"main": "translator.js"`, **no `exports` field** — deep imports are unrestricted, so `import {BatchTranslator} from '@browsermt/bergamot-translator/translator.js'` works (and is what the README shows). `files`: `translator.js`, `main.js` (node CLI demo), `worker/translator-worker.js`, `worker/bergamot-translator-worker.js`, `worker/bergamot-translator-worker.wasm`.

Named exports from `translator.js`: `BatchTranslator`, `LatencyOptimisedTranslator`, `TranslatorBacking`, `SupersededError`, `CancelledError`. No default export.

### 2. Constructor options

`new BatchTranslator(options?, backing?)` — `backing` defaults to `new TranslatorBacking(options)` (translator.js:474-476).

| option | default | notes |
|---|---|---|
| `workers` | 1 | upper bound, lazily spawned (translator.js:490) |
| `batchSize` | 8 | min 1 (translator.js:521) |
| `cacheSize` | 0 (disabled) | per-worker translation cache; worker clamps `Math.max(cacheSize\|\|0, 0)` |
| `downloadTimeout` | 60000 ms | 0 disables (translator.js:77) |
| `registryUrl` | see §4 | (translator.js:75) |
| `pivotLanguage` | `'en'` | set `null` to disable pivoting (translator.js:94) |
| `useNativeIntGemm` | false | Firefox **Nightly**-only `WebAssembly.mozIntGemm`; auto-falls back to embedded gemm (translator-worker.js:201-217) |
| `onerror` | `console.error` wrapper | async/unrecoverable worker errors |
| `workerUrl` | — | **documented in README/JSDoc but NOT implemented** — `loadWorker()` hardcodes `new Worker(new URL('./worker/translator-worker.js', import.meta.url))` (translator.js:118) |

Caveat: `TranslatorBacking`'s constructor **fetches the registry immediately** (`this.registry = this.loadModelRegistery()`, translator.js:83) — constructing a translator triggers network I/O; defer construction until first use.

### 3. Translate call

Confirmed, matches the documented guess plus extras:

```js
translate({from, to, text, html?: boolean, qualityScores?: boolean, priority?: number})
  → Promise<{request: TranslationRequest, target: {text: string}}>
```

- Response echoes back `request` alongside `target.text` (translator.js:724-731; worker returns `[{target:{text}}]`, translator-worker.js:423-427).
- `priority`: lower = translated first (BatchTranslator only).
- Rejections: `CancelledError` (removed/aborted/deleted), `SupersededError` (LatencyOptimisedTranslator replaces a still-pending request), or worker errors re-thrown with call-site stack.
- Upstream nit: in `loadTranslationModel` the abort handler references `reject` out of scope (translator.js:273) → aborting mid-model-download throws ReferenceError, not CancelledError. Also `if (!entries)` (translator.js:268) can never be true (filter returns `[]`), so a missing model surfaces as a TypeError on `entries[0].files`.

### 4. Registry & pivoting

Default constant: `https://bergamot.s3.amazonaws.com/models/index.json` (translator.js:75). The README claims a `storage.googleapis.com/bergamot-models-sandbox/0.3.3` default — **README is stale; code wins.**

Registry JSON shape: an object keyed by concatenated 2-letter pair, e.g. `"deen"`, each value a files map. Parsed as `{from: key.substring(0,2), to: key.substring(2,4), files}` (translator.js:212-218) — 2-letter ISO codes only. `files` parts: `model`, `lex` (→ shortlist), `vocab` **or** `srcvocab`+`trgvocab`, optional `qualityModel`, optional `config`; each file entry is `{name (URL), size, expectedSha256Hash}`. Downloads use fetch subresource `integrity` from the sha256 (translator.js:365-375).

Pair check: `findModels(from, to)` (translator.js:433-454) — direct model wins; otherwise **automatic pivot** `from→en` + `en→to` (both must exist), using the worker's `translateViaPivoting` (translator-worker.js:413-415); else throws `No model available to translate from '<from>' to '<to>'`. So yes: pivot through English is automatic and on by default.

### 5. Worker / wasm loading (bundling risk assessment)

Mechanism:
1. Main thread: `new Worker(new URL('./worker/translator-worker.js', import.meta.url))` — **classic** worker, not `{type:'module'}` (translator.js:118).
2. Worker: `importScripts('bergamot-translator-worker.js')` loads the Emscripten glue relative to the worker's own URL (translator-worker.js:266).
3. Wasm: `fetch(new URL('./bergamot-translator-worker.wasm', self.location))` + `WebAssembly.instantiateStreaming` via a custom `instantiateWasm` hook (translator-worker.js:243-258) — the glue's own `locateFile` path is bypassed. No `.arrayBuffer()` fallback, so the wasm must be served with `Content-Type: application/wasm` (moz-extension:// URLs are fine in Firefox).

Shipped assets: `worker/translator-worker.js` (17 KB wrapper), `worker/bergamot-translator-worker.js` (80 KB Emscripten glue), `worker/bergamot-translator-worker.wasm` (5.2 MB).

**No SharedArrayBuffer / pthreads**: zero occurrences in the glue; model config pins `cpu-threads: 0`. No COOP/COEP/cross-origin-isolation requirement. Parallelism comes from multiple whole workers, each with its own model copy.

Vite/WXT MV3 risks (all manageable, Firefox-only background):
- **`import.meta.url`-relative worker path**: since `workerUrl` is dead (see §2), the three `worker/*` files must end up at `./worker/` relative to wherever the code containing `loadWorker` executes — either keep `translator.js` un-prebundled (`optimizeDeps.exclude`) and copy `worker/` into the output preserving layout, or subclass `TranslatorBacking`/patch to point at a known extension URL. This is the main integration hazard.
- **Classic worker + `importScripts`**: the worker files must be shipped verbatim (static assets), NOT run through Vite's worker bundling (which would emit a module worker where `importScripts` throws). Also do not let the bundler rename `Module` (translator-worker.js:264-266 warns about this).
- **Wasm CSP**: Firefox MV3 needs `"content_security_policy": {"extension_pages": "script-src 'self' 'wasm-unsafe-eval'; ..."}` in the manifest for `WebAssembly.instantiateStreaming`.
- **Firefox MV3 background is a page** (event page, has `window` + `Worker`) — the node-compat shim at translator.js:19-42 is skipped. It would break in a Chrome MV3 service worker (`window` undefined → `import('node:worker_threads')`), but Chrome keeps zero bergamot bytes per plan. Bundler may warn on the `node:worker_threads` / `node:fs` dynamic imports (translator.js:25, translator-worker.js:20,45,62) — externalize or ignore; they're behind runtime guards.
- **Network**: registry (bergamot.s3.amazonaws.com) + model file hosts need `host_permissions` (fetches use `credentials:'omit'`).

### 6. Delete / teardown

`BatchTranslator.delete()` (translator.js:529-535): rejects everything queued with `CancelledError`, then `worker.terminate()` on all workers. `LatencyOptimisedTranslator.delete()` (translator.js:783-797) likewise. Worker also exposes `freeTranslationModel({from,to})` (translator-worker.js:364-374) to free a single model's aligned memory without killing the worker (callable through the backing's exports proxy). Memory note: each worker holds its own copies of loaded models (tens of MB each) plus the 5.2 MB wasm; `delete()` is the only full reclaim.

### 7. Types

**No `.d.ts` files** anywhere in the package — JSDoc annotations only. We need a local `declare module '@browsermt/bergamot-translator/translator.js'` shim for tsc.

### 8. License

`MPL-2.0` (package.json:15) — file-level copyleft, compatible with bundling into an extension; no obligation on our code.

**Verdict:** GO
