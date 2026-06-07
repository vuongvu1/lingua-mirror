import { makeInert, stripIds } from "./dom";

const ROOT_ID = "ls-root";
const STYLE_ID = "ls-layout-style";
const INERT_TAGS = new Set(["script", "noscript"]);

const LAYOUT_CSS = `
#${ROOT_ID}{position:fixed;inset:0;z-index:2147483646;display:flex;background:#fff;}
#${ROOT_ID} .ls-pane{flex:1 1 0;min-width:0;height:100%;overflow:auto;}
#${ROOT_ID} .ls-pane.ls-left{border-right:2px solid #6c8cff;}
html[data-ls-active] body > :not(#${ROOT_ID}){display:none !important;}
`;

export type SplitView = {
  root: HTMLElement;
  left: HTMLElement;
  right: HTMLElement;
  destroy: () => void;
};

function injectStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = LAYOUT_CSS;
  doc.head.appendChild(style);
}

/**
 * Build the two-pane split overlay from the current document.
 * The caller owns the lifecycle: call `destroy()` before building again —
 * calling this twice without destroying leaks a second `#ls-root` overlay.
 * The injected layout `<style>` is intentionally left in <head> on destroy;
 * it is inert once `data-ls-active` is removed.
 */
export function buildSplitView(doc: Document): SplitView {
  injectStyle(doc);

  const root = doc.createElement("div");
  root.id = ROOT_ID;

  const left = doc.createElement("div");
  left.className = "ls-pane ls-left";
  const right = doc.createElement("div");
  right.className = "ls-pane ls-right";

  const originalChildren = Array.from(doc.body.children).filter(
    (child) =>
      child.id !== ROOT_ID &&
      !INERT_TAGS.has(child.tagName.toLowerCase()),
  );
  for (const child of originalChildren) {
    right.appendChild(makeInert(stripIds(child.cloneNode(true) as HTMLElement)));
    left.appendChild(makeInert(stripIds(child.cloneNode(true) as HTMLElement)));
  }

  root.append(left, right);
  doc.body.appendChild(root);
  doc.documentElement.setAttribute("data-ls-active", "true");

  const destroy = (): void => {
    root.remove();
    doc.documentElement.removeAttribute("data-ls-active");
  };

  return { root, left, right, destroy };
}
