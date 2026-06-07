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
