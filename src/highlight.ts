const HIGHLIGHT_ATTR = "data-lm-highlight";

/** CSS rule the content script injects so `[data-lm-highlight]` paints over site styles. */
export const HIGHLIGHT_CSS = `[${HIGHLIGHT_ATTR}]{background:#fff3a3 !important;border-radius:3px;box-shadow:0 0 0 2px #fff3a3;}`;

export type HoverController = { destroy(): void };

/**
 * Wire bidirectional hover-highlight on `root` (which contains both panes).
 * Hovering a sentence sets `data-lm-highlight` on every element carrying the
 * same `data-pair-id` — the hovered element and its twin in the other pane.
 */
export function linkHover(root: HTMLElement): HoverController {
  let currentId: string | null = null;

  const clear = (): void => {
    if (currentId == null) return;
    for (const el of root.querySelectorAll(`[${HIGHLIGHT_ATTR}]`)) {
      el.removeAttribute(HIGHLIGHT_ATTR);
    }
    currentId = null;
  };

  const apply = (id: string): void => {
    if (id === currentId) return; // re-hovering the same sentence: no-op
    clear();
    for (const el of root.querySelectorAll(`[data-pair-id="${id}"]`)) {
      el.setAttribute(HIGHLIGHT_ATTR, "");
    }
    currentId = id;
  };

  const onOver = (event: Event): void => {
    const target = event.target as Element | null;
    const sentence = target?.closest("[data-pair-id]");
    if (sentence) apply(sentence.getAttribute("data-pair-id")!);
    else clear();
  };

  root.addEventListener("mouseover", onOver);
  root.addEventListener("mouseleave", clear);

  return {
    destroy(): void {
      root.removeEventListener("mouseover", onOver);
      root.removeEventListener("mouseleave", clear);
      clear();
    },
  };
}
