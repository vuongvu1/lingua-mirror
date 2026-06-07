import { describe, expect, it } from "vitest";
import { segmentSentences } from "./segment";

describe("segmentSentences", () => {
  it("splits English prose into trimmed sentences", () => {
    expect(segmentSentences("Hello world. How are you?", "en")).toEqual([
      "Hello world.",
      "How are you?",
    ]);
  });

  it("drops empty/whitespace-only segments", () => {
    expect(segmentSentences("   ", "en")).toEqual([]);
    expect(segmentSentences("One.\n\n  Two.", "en")).toEqual(["One.", "Two."]);
  });

  it("segments a non-Latin script (Japanese)", () => {
    expect(segmentSentences("これはペンです。あれは本です。", "ja")).toHaveLength(2);
  });
});
