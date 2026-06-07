/**
 * Resolve the source (original) language code.
 * @param htmlLang the page's `<html lang>` value (may be null/empty)
 * @param rightLang the right-pane setting: "auto" or a specific BCP-47 code
 * @returns the base language subtag, or null when it cannot be determined
 */
export function resolveSourceLanguage(
  htmlLang: string | null | undefined,
  rightLang: string,
): string | null {
  const code = rightLang === "auto" ? (htmlLang ?? "").trim() : rightLang;
  if (!code) return null;
  return code.split("-")[0] ?? null;
}
