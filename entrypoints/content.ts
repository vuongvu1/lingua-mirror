import { TOGGLE_SPLIT, type ToggleSplitMessage } from "../src/messages";
import { buildSplitView, type SplitView } from "../src/split-view";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    let view: SplitView | null = null;
    let controls: HTMLElement | null = null;

    const teardown = (): void => {
      controls?.remove();
      controls = null;
      view?.destroy();
      view = null;
    };

    const activate = (): void => {
      view = buildSplitView(document);
      controls = mountControls(view.root, { onClose: teardown, onResync: resync });
    };

    const resync = (): void => {
      teardown();
      activate();
    };

    const toggle = (): void => {
      if (view) teardown();
      else activate();
    };

    chrome.runtime.onMessage.addListener((message: ToggleSplitMessage) => {
      if (message?.type === TOGGLE_SPLIT) toggle();
    });
  },
});

function mountControls(
  root: HTMLElement,
  handlers: { onClose: () => void; onResync: () => void },
): HTMLElement {
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .bar{display:flex;gap:6px;font:600 12px system-ui,sans-serif;background:#1e1e1e;color:#fff;padding:6px 8px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.3);}
      button{all:unset;cursor:pointer;padding:3px 8px;border-radius:5px;}
      button:hover{background:rgba(255,255,255,.15);}
    </style>
    <div class="bar">
      <button id="resync">&#x27F3; Re-sync</button>
      <button id="close">&#x2715; Close</button>
    </div>`;
  shadow.getElementById("resync")?.addEventListener("click", handlers.onResync);
  shadow.getElementById("close")?.addEventListener("click", handlers.onClose);
  root.appendChild(host);
  return host;
}
