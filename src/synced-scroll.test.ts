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
