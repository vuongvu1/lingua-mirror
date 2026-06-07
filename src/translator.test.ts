import { describe, expect, it } from "vitest";
import { createTranslator, type TranslatorApi, type TranslatorAvailability } from "./translator";

function makeApi(availability: TranslatorAvailability): TranslatorApi {
  return {
    availability: async () => availability,
    create: async () => ({
      translate: async (text: string) => `[${text}]`,
      destroy: () => {},
    }),
  };
}

describe("createTranslator", () => {
  it("returns unavailable without creating a translator", async () => {
    let created = false;
    const api: TranslatorApi = {
      availability: async () => "unavailable",
      create: async () => {
        created = true;
        return { translate: async (t: string) => t, destroy: () => {} };
      },
    };
    const result = await createTranslator("en", "de", api);
    expect(result.status).toBe("unavailable");
    expect(created).toBe(false);
  });

  it("returns a ready port when available", async () => {
    const result = await createTranslator("en", "de", makeApi("available"));
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(await result.port.translate("hi")).toBe("[hi]");
    }
  });

  it("calls onDownloading for a downloadable model, then resolves ready", async () => {
    let downloading = false;
    const result = await createTranslator("en", "de", makeApi("downloadable"), {
      onDownloading: () => {
        downloading = true;
      },
    });
    expect(downloading).toBe(true);
    expect(result.status).toBe("ready");
  });
});
