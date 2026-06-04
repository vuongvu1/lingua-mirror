export type Settings = {
  /** BCP-47 code for the translated (left) pane, e.g. "en". */
  leftLang: string;
  /** BCP-47 code for the original (right) pane, or "auto" to keep the site's language. */
  rightLang: string;
};

export const DEFAULT_SETTINGS: Settings = {
  leftLang: "en",
  rightLang: "auto",
};

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get("settings");
  return {
    ...DEFAULT_SETTINGS,
    ...(stored.settings as Partial<Settings> | undefined),
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ settings });
}
