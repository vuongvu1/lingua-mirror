/** Split `text` into trimmed, non-empty sentences using the locale's rules. */
export function segmentSentences(text: string, locale: string): string[] {
  const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
  const sentences: string[] = [];
  for (const { segment } of segmenter.segment(text)) {
    const trimmed = segment.trim();
    if (trimmed) sentences.push(trimmed);
  }
  return sentences;
}
