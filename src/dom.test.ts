import { describe, expect, it } from "vitest";
import { stripIds } from "./dom";

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
