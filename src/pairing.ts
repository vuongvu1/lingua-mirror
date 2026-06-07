import { segmentSentences } from "./segment";

const BLOCK_TAGS = [
  "P", "LI", "H1", "H2", "H3", "H4", "H5", "H6",
  "BLOCKQUOTE", "FIGCAPTION", "DT", "DD", "TD", "TH", "CAPTION", "SUMMARY",
];
const NESTED_BLOCK_SELECTOR = BLOCK_TAGS.map((t) => t.toLowerCase()).join(",");

/** Leaf block-level elements that carry non-empty text and aren't already paired. */
function collectTextBlocks(root: HTMLElement): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    if (!BLOCK_TAGS.includes(el.tagName)) continue;
    if (el.querySelector(NESTED_BLOCK_SELECTOR)) continue; // not a leaf block
    if (!el.textContent || !el.textContent.trim()) continue;
    if (el.hasAttribute("data-pair-id") || el.querySelector("[data-pair-id]")) continue;
    blocks.push(el);
  }
  return blocks;
}

function wrapSentences(block: HTMLElement, sentences: string[], pairIds: string[]): void {
  const doc = block.ownerDocument;
  const nodes: Node[] = [];
  sentences.forEach((sentence, i) => {
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
