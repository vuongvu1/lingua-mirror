import { describe, expect, it } from "vitest";
import { resolveSourceLanguage } from "./source-language";

describe("resolveSourceLanguage", () => {
  it("uses <html lang> when right pane is auto", () => {
    expect(resolveSourceLanguage("de", "auto")).toBe("de");
  });

  it("normalizes a region tag to its base subtag", () => {
    expect(resolveSourceLanguage("en-US", "auto")).toBe("en");
  });

  it("returns null when auto and no <html lang>", () => {
    expect(resolveSourceLanguage("", "auto")).toBeNull();
    expect(resolveSourceLanguage(null, "auto")).toBeNull();
  });

  it("uses the explicit override regardless of <html lang>", () => {
    expect(resolveSourceLanguage("de", "fr")).toBe("fr");
    expect(resolveSourceLanguage(null, "fr")).toBe("fr");
  });
});
