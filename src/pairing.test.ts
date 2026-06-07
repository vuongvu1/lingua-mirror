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
