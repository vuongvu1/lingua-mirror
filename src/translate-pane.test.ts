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
