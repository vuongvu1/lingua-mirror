import { describe, expect, it } from "vitest";
import { makeInert, stripIds } from "./dom";

describe("stripIds", () => {
  it("removes the id from the element itself", () => {
    const el = document.createElement("div");
    el.id = "root";
    stripIds(el);
    expect(el.hasAttribute("id")).toBe(false);
  });

  it("removes ids from all descendants", () => {
    const el = document.createElement("div");
    el.innerHTML = `<p id="a">x</p><section><span id="b">y</span></section>`;
    stripIds(el);
    expect(el.querySelectorAll("[id]").length).toBe(0);
  });

  it("returns the same element it was given", () => {
    const el = document.createElement("div");
    expect(stripIds(el)).toBe(el);
  });
});

describe("makeInert", () => {
  it("removes script and noscript descendants", () => {
    const el = document.createElement("div");
    el.innerHTML = `<p>keep</p><script>evil()</script><noscript>x</noscript>`;
    makeInert(el);
    expect(el.querySelector("script")).toBeNull();
    expect(el.querySelector("noscript")).toBeNull();
    expect(el.querySelector("p")?.textContent).toBe("keep");
  });

  it("strips inline on* handler attributes from the element and descendants", () => {
    const el = document.createElement("div");
    el.setAttribute("onmouseover", "a()");
    el.innerHTML = `<button onclick="b()">go</button>`;
    makeInert(el);
    expect(el.hasAttribute("onmouseover")).toBe(false);
    expect(el.querySelector("button")?.hasAttribute("onclick")).toBe(false);
  });

  it("removes autoplay from media", () => {
    const el = document.createElement("div");
    el.innerHTML = `<video autoplay></video><audio autoplay></audio>`;
    makeInert(el);
    expect(el.querySelector("video")?.hasAttribute("autoplay")).toBe(false);
    expect(el.querySelector("audio")?.hasAttribute("autoplay")).toBe(false);
  });

  it("returns the same element", () => {
    const el = document.createElement("div");
    expect(makeInert(el)).toBe(el);
  });
});
