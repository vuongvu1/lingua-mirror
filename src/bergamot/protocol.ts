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
