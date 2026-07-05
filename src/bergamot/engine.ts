// Firefox-only chunk: imported dynamically from the background entrypoint.
// API per the "Recon findings (Task 1)" section of the Phase B plan doc.
import {
  BatchTranslator,
  TranslatorBacking,
} from "@browsermt/bergamot-translator/translator.js";
import type { TranslatorAvailability, TranslatorPort } from "../translator";
import type { Pair } from "./protocol";
import type { EngineFactory } from "./server";

const REGISTRY_URL = "https://bergamot.s3.amazonaws.com/models/index.json";

/**
 * The stock `TranslatorBacking.loadWorker()` spawns its worker via
 * `new Worker(new URL('./worker/translator-worker.js', import.meta.url))`
 * (translator.js:118) — under Vite bundling `import.meta.url` points at the
 * background chunk, not the package, so the worker file 404s. This override
 * replicates the original method body (translator.js:117-189, transliterated
 * to TS) changing ONLY the Worker URL: the worker assets are shipped at
 * /worker/ in the firefox build output (Task 6) and resolved through the
 * extension URL. Same return shape, same error handling.
 */
class ExtensionBacking extends TranslatorBacking {
  override async loadWorker(): Promise<{ worker: Worker; exports: unknown }> {
    const worker = new Worker(
      chrome.runtime.getURL("/worker/translator-worker.js"),
    );

    /** Incremental counter to derive request/response ids from. */
    let serial = 0;

    /** Map of pending requests */
    const pending = new Map<
      number,
      {
        accept: (result: unknown) => void;
        reject: (error: Error) => void;
        callsite: { message: string; stack: string | undefined };
      }
    >();

    // Function to send requests
    const call = (name: string, ...args: unknown[]): Promise<unknown> =>
      new Promise((accept, reject) => {
        const id = ++serial;
        pending.set(id, {
          accept,
          reject,
          callsite: {
            // for debugging which call caused the error
            message: `${name}(${args.map((arg) => String(arg)).join(", ")})`,
            stack: new Error().stack,
          },
        });
        worker.postMessage({ id, name, args });
      });

    // … receive responses
    worker.addEventListener("message", (event) => {
      const { id, result, error } = event.data as {
        id: number;
        result?: unknown;
        error?: { message: string; stack?: string };
      };
      const entry = pending.get(id);
      if (!entry) {
        console.debug("Received message with unknown id:", event);
        throw new Error(
          `BergamotTranslator received response from worker to unknown call '${id}'`,
        );
      }
      const { accept, reject, callsite } = entry;
      pending.delete(id);

      if (error !== undefined) {
        reject(
          Object.assign(new Error(), error, {
            message: `${error.message} (response to ${callsite.message})`,
            stack: error.stack
              ? `${error.stack}\n${callsite.stack}`
              : callsite.stack,
          }),
        );
      } else {
        accept(result);
      }
    });

    // … and general errors
    worker.addEventListener("error", this.onerror.bind(this));

    // Await initialisation. This will also nicely error out if the WASM
    // runtime fails to load.
    await call("initialize", this.options);

    // Proxy that exposes the worker-side TranslationWorker interface as
    // async methods; all calls go through the message-passing channel.
    return {
      worker,
      exports: new Proxy(
        {},
        {
          get(_target, name) {
            // Prevent this object from being marked "then-able"
            if (name !== "then") {
              // upstream forwards `name` verbatim; only string props are used
              return (...args: unknown[]) => call(name as string, ...args);
            }
          },
        },
      ),
    };
  }
}

let registryPromise: Promise<Record<string, unknown>> | null = null;
function loadRegistry(): Promise<Record<string, unknown>> {
  // credentials:'omit' matches the package's own registry fetch
  // (translator.js:208).
  registryPromise ??= fetch(REGISTRY_URL, { credentials: "omit" })
    .then((response) => response.json() as Promise<Record<string, unknown>>)
    .catch((error: unknown) => {
      // Don't memoize failure: a transient network error would otherwise pin
      // availability() to "unavailable" until the background page unloads.
      registryPromise = null;
      throw error;
    });
  return registryPromise;
}

// ponytail: one shared BatchTranslator; per-connection destroy() is a no-op
// so a re-split doesn't re-pay wasm startup. Add idle teardown if memory bites.
let translator: BatchTranslator | null = null;
function sharedTranslator(): BatchTranslator {
  // TranslatorBacking's constructor fetches the registry immediately
  // (translator.js:83) — construct lazily on first create(), never at module
  // top level.
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
