import { segmentSentences } from "./segment";

// Inline-level tags stay PART of their containing block, never their own unit.
const INLINE_TAGS = new Set([
  "A", "ABBR", "B", "BDI", "BDO", "BR", "CITE", "CODE", "DATA", "DFN", "EM",
  "I", "KBD", "MARK", "Q", "RP", "RT", "RUBY", "S", "SAMP", "SMALL", "SPAN",
  "STRONG", "SUB", "SUP", "TIME", "U", "VAR", "WBR", "IMG", "PICTURE",
  "BUTTON", "LABEL", "SELECT", "INPUT", "TEXTAREA", "OUTPUT",
]);
// Non-content tags we never treat as text blocks or descend into.
const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "MATH", "IFRAME",
  "CANVAS", "VIDEO", "AUDIO", "OBJECT", "EMBED", "HEAD", "META", "LINK", "TITLE",
]);
const SKIP_SELECTOR = [...SKIP_TAGS].map((t) => t.toLowerCase()).join(",");

/** A "block" is anything that is neither inline nor a skipped/non-content tag. */
function isBlock(el: Element): boolean {
  return !INLINE_TAGS.has(el.tagName) && !SKIP_TAGS.has(el.tagName);
}

/** True if `el` has a block-level descendant (so `el` is not a leaf block). */
function containsBlock(el: Element): boolean {
  for (const child of el.children) {
    if (SKIP_TAGS.has(child.tagName)) continue;
    if (isBlock(child) || containsBlock(child)) return true;
  }
  return false;
}

/**
 * Leaf block-level elements that carry non-empty text and aren't already paired.
 * Block membership is decided by an inline/skip blacklist, not a tag whitelist, so
 * containers like <div>/<section>/<figure> are covered — only their inline content
 * (and nested blocks) is excluded. This is the lowest block wrapping each text run,
 * so units never overlap.
 */
function collectTextBlocks(root: HTMLElement): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    if (!isBlock(el)) continue; // inline or non-content tag
    if (el.closest(SKIP_SELECTOR)) continue; // inside a skipped subtree (e.g. <svg>)
    if (!el.textContent || !el.textContent.trim()) continue;
    if (containsBlock(el)) continue; // not a leaf block
    if (el.hasAttribute("data-pair-id") || el.querySelector("[data-pair-id]")) continue;
    blocks.push(el);
  }
  return blocks;
}

function wrapSentences(block: HTMLElement, sentences: string[], pairIds: string[]): void {
  const doc = block.ownerDocument;
  const nodes: Node[] = [];
  sentences.forEach((sentence, i) => {
    // Single space between spans; original inter-sentence whitespace is not preserved.
    if (i > 0) nodes.push(doc.createTextNode(" "));
    const span = doc.createElement("span");
    span.setAttribute("data-pair-id", pairIds[i]!);
    span.textContent = sentence;
    nodes.push(span);
  });
  block.replaceChildren(...nodes);
}

/**
 * Tag sentences in both panes with a shared `data-pair-id`.
 * Plain blocks → one span per sentence; marked-up blocks → one id on the block.
 * The two panes are identical clones, so blocks pair by document order.
 */
export function pairPanes(left: HTMLElement, right: HTMLElement, sourceLocale: string): void {
  const leftBlocks = collectTextBlocks(left);
  const rightBlocks = collectTextBlocks(right);
  const count = Math.min(leftBlocks.length, rightBlocks.length);
  let next = 0;

  for (let i = 0; i < count; i++) {
    const lb = leftBlocks[i]!;
    const rb = rightBlocks[i]!;
    // Panes are structurally identical clones; rb is the canonical reference for both.
    const markedUp = rb.children.length > 0;

    if (markedUp) {
      const id = `lm-${next++}`;
      rb.setAttribute("data-pair-id", id);
      lb.setAttribute("data-pair-id", id);
      continue;
    }

    const sentences = segmentSentences(rb.textContent ?? "", sourceLocale);
    const pairIds = sentences.map(() => `lm-${next++}`);
    wrapSentences(rb, sentences, pairIds);
    wrapSentences(lb, sentences, pairIds);
  }
}
