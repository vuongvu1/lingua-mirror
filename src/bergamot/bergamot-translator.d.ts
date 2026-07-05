/**
 * Local shim — @browsermt/bergamot-translator v0.4.9 ships no .d.ts (JSDoc
 * only). Declares ONLY the members engine.ts touches; names/signatures match
 * the real source (see "Recon findings (Task 1)" in the Phase B plan).
 */
declare module "@browsermt/bergamot-translator/translator.js" {
  /** Subset of the shared options bag we actually pass (translator.js:62-72, 462-473). */
  export type BergamotOptions = {
    workers?: number;
    registryUrl?: string;
  };

  /** Model registry + worker management (translator.js:60). */
  export class TranslatorBacking {
    constructor(options?: BergamotOptions);
    /** Options bag, forwarded to the worker's `initialize` call (translator.js:169). */
    options: BergamotOptions;
    /** Handler for async/unrecoverable errors; also bound as the Worker 'error' listener (translator.js:107, 165). */
    onerror: (error: Error | ErrorEvent) => void;
    /** Spawns + wraps the wasm worker (translator.js:117). Overridden in engine.ts. */
    loadWorker(): Promise<{ worker: Worker; exports: unknown }>;
  }

  /** Batching translator (translator.js:461). `backing` defaults to `new TranslatorBacking(options)` (translator.js:474-476). */
  export class BatchTranslator {
    constructor(options?: BergamotOptions, backing?: TranslatorBacking);
    /** translator.js:609; resolves `{request, target: {text}}` (translator.js:724-731). */
    translate(request: {
      from: string;
      to: string;
      text: string;
      html?: boolean;
      qualityScores?: boolean;
      priority?: number;
    }): Promise<{ request: unknown; target: { text: string } }>;
  }
}
