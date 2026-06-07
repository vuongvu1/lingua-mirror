export type TranslatorPort = {
  translate(text: string): Promise<string>;
  destroy(): void;
};

export type TranslatorAvailability =
  | "available"
  | "downloadable"
  | "downloading"
  | "unavailable";

type LanguagePair = { sourceLanguage: string; targetLanguage: string };

/** The slice of the browser `Translator` API this extension depends on. */
export type TranslatorApi = {
  availability(pair: LanguagePair): Promise<TranslatorAvailability>;
  create(pair: LanguagePair): Promise<TranslatorPort>;
};

export type CreateTranslatorResult =
  | { status: "ready"; port: TranslatorPort }
  | { status: "unavailable" };

/**
 * Resolve a ready TranslatorPort for the given pair, or report it's unavailable.
 * Calls `hooks.onDownloading` once if the model still needs to download.
 */
export async function createTranslator(
  source: string,
  target: string,
  api: TranslatorApi,
  hooks: { onDownloading?: () => void } = {},
): Promise<CreateTranslatorResult> {
  const pair: LanguagePair = { sourceLanguage: source, targetLanguage: target };
  const availability = await api.availability(pair);
  if (availability === "unavailable") return { status: "unavailable" };
  if (availability === "downloadable" || availability === "downloading") {
    hooks.onDownloading?.();
  }
  const port = await api.create(pair);
  return { status: "ready", port };
}
