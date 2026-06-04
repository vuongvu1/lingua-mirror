import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, getSettings, saveSettings } from "./settings";

describe("settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns defaults when nothing is stored", async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({});
    await expect(getSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it("merges stored values over defaults", async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      settings: { leftLang: "de" },
    });
    await expect(getSettings()).resolves.toEqual({
      leftLang: "de",
      rightLang: "auto",
    });
  });

  it("persists settings under the 'settings' key", async () => {
    vi.mocked(chrome.storage.local.set).mockResolvedValue(undefined);
    await saveSettings({ leftLang: "en", rightLang: "auto" });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      settings: { leftLang: "en", rightLang: "auto" },
    });
  });
});
