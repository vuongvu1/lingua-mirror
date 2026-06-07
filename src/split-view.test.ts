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

  it("injects the layout style only once across rebuilds", () => {
    buildSplitView(document).destroy();
    buildSplitView(document);
    expect(document.querySelectorAll("#ls-layout-style").length).toBe(1);
  });

  it("returns the actual pane elements as left/right", () => {
    const view = buildSplitView(document);
    expect(view.left).toBe(document.querySelector(".ls-left"));
    expect(view.right).toBe(document.querySelector(".ls-right"));
  });

  it("makes the cloned panes inert (no scripts)", () => {
    document.body.innerHTML = `<p id="a">Hello</p><script>window.x=1</script>`;
    buildSplitView(document);
    const left = document.querySelector(".ls-left")!;
    expect(left.querySelector("script")).toBeNull();
  });
});
