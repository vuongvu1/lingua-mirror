import { TOGGLE_SPLIT, type ToggleSplitMessage } from "../src/messages";
import { buildSplitView, type SplitView } from "../src/split-view";
import { getSettings } from "../src/settings";
import { resolveSourceLanguage } from "../src/source-language";
import { pairPanes } from "../src/pairing";
import { createTranslator, type TranslatorApi, type TranslatorPort } from "../src/translator";
import { translatePane, type Controller, type Visibility } from "../src/translate-pane";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    let view: SplitView | null = null;
    let controls: HTMLElement | null = null;
    let banner: Banner | null = null;
    let translation: Controller | null = null;
    let port: TranslatorPort | null = null;

    const teardown = (): void => {
      translation?.stop();
      translation = null;
      port?.destroy();
      port = null;
      banner?.remove();
      banner = null;
      controls?.remove();
      controls = null;
      view?.destroy();
      view = null;
    };

    const activate = async (): Promise<void> => {
      const active = buildSplitView(document);
      view = active;
      controls = mountControls(active.root, { onClose: teardown, onResync: resync });
      banner = mountBanner(active.root);
      await runTranslation(active, banner);
    };

    const runTranslation = async (active: SplitView, status: Banner): Promise<void> => {
      const settings = await getSettings();
      const source = resolveSourceLanguage(document.documentElement.lang, settings.rightLang);
      if (source == null) {
        status.show("Set the page's language in the popup to translate.");
        return;
      }
      pairPanes(active.left, active.right, source);

      const target = settings.leftLang;
      if (source === target) return; // same language: panes already mirror

      const translatorApi = (globalThis as { Translator?: TranslatorApi }).Translator;
      if (!translatorApi) {
        status.show("Translation isn't available in this browser.");
        return;
      }
      const result = await createTranslator(source, target, translatorApi, {
        onDownloading: () => status.show(`Preparing ${target}…`),
      });
      if (result.status === "unavailable") {
        status.show(`Translation ${source} → ${target} isn't available on this device.`);
        return;
      }
      status.hide();
      port = result.port;
      translation = translatePane(active.left, port, { visibility: makeVisibility(active.left) });
    };

    const resync = (): void => {
      teardown();
      void activate();
    };

    const toggle = (): void => {
      if (view) teardown();
      else void activate();
    };

    chrome.runtime.onMessage.addListener((message: ToggleSplitMessage) => {
      if (message?.type === TOGGLE_SPLIT) toggle();
    });
  },
});

function makeVisibility(pane: HTMLElement): Visibility {
  const callbacks = new Map<Element, () => void>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = callbacks.get(entry.target);
        observer.unobserve(entry.target);
        callbacks.delete(entry.target);
        callback?.();
      }
    },
    { root: pane, rootMargin: "200px" },
  );
  return {
    observe(el, onVisible) {
      callbacks.set(el, onVisible);
      observer.observe(el);
    },
    disconnect() {
      observer.disconnect();
      callbacks.clear();
    },
  };
}

type Banner = { show(message: string): void; hide(): void; remove(): void };

function mountBanner(root: HTMLElement): Banner {
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;top:8px;left:8px;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .b{display:none;max-width:46%;font:600 12px system-ui,sans-serif;background:#1e1e1e;color:#fff;padding:6px 10px;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.3);}
    </style>
    <div class="b"></div>`;
  const box = shadow.querySelector(".b") as HTMLElement;
  root.appendChild(host);
  return {
    show(message) {
      box.textContent = message;
      box.style.display = "block";
    },
    hide() {
      box.style.display = "none";
    },
    remove() {
      host.remove();
    },
  };
}

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
