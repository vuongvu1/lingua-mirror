import { describe, expect, it } from "vitest";
import { highlightCss, linkHover } from "./highlight";

/** A root containing two panes whose sentences share the same pair-ids. */
function panes(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <div class="left">
      <span data-pair-id="lm-0">one</span>
      <span data-pair-id="lm-1">two</span>
    </div>
    <div class="right">
      <span data-pair-id="lm-0">eins</span>
      <span data-pair-id="lm-1">zwei</span>
    </div>`;
  return root;
}

function over(el: Element): void {
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
}

function highlighted(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll("[data-lm-highlight]")).map(
    (el) => el.getAttribute("data-pair-id")!,
  );
}

describe("linkHover", () => {
  it("highlights the hovered sentence and its twin in the other pane", () => {
    const root = panes();
    linkHover(root);
    over(root.querySelector('.left [data-pair-id="lm-0"]')!);
    expect(highlighted(root)).toEqual(["lm-0", "lm-0"]); // left + right twins
  });

  it("moves the highlight when hovering a different sentence", () => {
    const root = panes();
    linkHover(root);
    over(root.querySelector('.left [data-pair-id="lm-0"]')!);
    over(root.querySelector('.right [data-pair-id="lm-1"]')!);
    expect(highlighted(root)).toEqual(["lm-1", "lm-1"]);
  });

  it("clears the highlight when hovering a gap with no pair-id", () => {
    const root = panes();
    linkHover(root);
    over(root.querySelector('.left [data-pair-id="lm-0"]')!);
    over(root.querySelector(".left")!); // container itself, no pair-id at/above target
    expect(highlighted(root)).toEqual([]);
  });

  it("clears the highlight when the pointer leaves the panes", () => {
    const root = panes();
    linkHover(root);
    over(root.querySelector('.left [data-pair-id="lm-0"]')!);
    root.dispatchEvent(new MouseEvent("mouseleave"));
    expect(highlighted(root)).toEqual([]);
  });

  it("highlights a block-level pair-id element (marked-up fallback)", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <p data-pair-id="lm-0">See <a href="#">link</a>.</p>
      <p data-pair-id="lm-0">Siehe <a href="#">Link</a>.</p>`;
    linkHover(root);
    over(root.querySelector("a")!); // hover inline markup inside the block
    expect(highlighted(root)).toEqual(["lm-0", "lm-0"]);
  });

  it("destroy() removes listeners and clears state", () => {
    const root = panes();
    const controller = linkHover(root);
    over(root.querySelector('.left [data-pair-id="lm-0"]')!);
    controller.destroy();
    expect(highlighted(root)).toEqual([]); // cleared on destroy
    over(root.querySelector('.left [data-pair-id="lm-1"]')!);
    expect(highlighted(root)).toEqual([]); // listener gone, nothing re-highlights
  });

  it("builds a CSS rule targeting the highlight attribute with the given color", () => {
    const css = highlightCss("#ffb3b3");
    expect(css).toContain("data-lm-highlight");
    expect(css).toContain("#ffb3b3");
    expect(css).not.toContain("#fff3a3");
  });
});
