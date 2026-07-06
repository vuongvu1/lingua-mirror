import { bergamotApi } from "../src/bergamot/client";
import { BERGAMOT_PORT } from "../src/bergamot/protocol";
import { TOGGLE_SPLIT, type ToggleSplitMessage } from "../src/messages";
import { buildSplitView, type SplitView } from "../src/split-view";
import { getSettings } from "../src/settings";
import { resolveSourceLanguage } from "../src/source-language";
import { pairPanes } from "../src/pairing";
import { createTranslator, type TranslatorApi, type TranslatorPort } from "../src/translator";
import { translatePane, type Controller, type Visibility } from "../src/translate-pane";
import { linkHover, highlightCss, type HoverController } from "../src/highlight";
import { linkScroll, type ScrollController } from "../src/synced-scroll";

const HIGHLIGHT_STYLE_ID = "lm-highlight-style";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    let view: SplitView | null = null;
    let controls: HTMLElement | null = null;
    let banner: Banner | null = null;
    let translation: Controller | null = null;
    let port: TranslatorPort | null = null;
    let highlight: HoverController | null = null;
    let scrollSync: ScrollController | null = null;

    const teardown = (): void => {
      highlight?.destroy();
      highlight = null;
      scrollSync?.destroy();
      scrollSync = null;
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
      // Scroll sync needs no pair-ids, so wire it even when the page has no <html lang>.
      scrollSync = linkScroll(active.left, active.right);
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
      // Highlight works on the pair-id structure regardless of translation state.
      injectHighlightStyle(document, settings.highlightColor);
      highlight = linkHover(active.root);

      const target = settings.leftLang;
      if (source === target) return; // same language: panes already mirror

      const translatorApi = resolveTranslatorApi();
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
      // Teardown or a re-activate may have run while the model loaded; if this
      // run is no longer the active one, release the port and bail (avoids
      // orphaning a live TranslatorPort + IntersectionObserver).
      if (view !== active) {
        result.port.destroy();
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

/** Native Translator API where the browser has it; bergamot proxy on Firefox. */
function resolveTranslatorApi(): TranslatorApi | undefined {
  const native = (globalThis as { Translator?: TranslatorApi }).Translator;
  if (native) return native;
  if (import.meta.env.BROWSER === "firefox") {
    return bergamotApi(() => chrome.runtime.connect({ name: BERGAMOT_PORT }));
  }
  return undefined;
}

/**
 * Inject (or refresh) the highlight CSS rule; left in <head> on destroy
 * (inert without the data-lm-highlight attribute). Refreshing the text on
 * every activation picks up a changed highlight color on re-split.
 */
function injectHighlightStyle(doc: Document, color: string): void {
  let style = doc.getElementById(HIGHLIGHT_STYLE_ID);
  if (!style) {
    style = doc.createElement("style");
    style.id = HIGHLIGHT_STYLE_ID;
    doc.head.appendChild(style);
  }
  style.textContent = highlightCss(color);
}

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
    // root is the scrollable left pane; 200px margin prefetches just-offscreen sentences.
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
  // #ls-root is position:fixed inset:0, so absolute positions the banner inside the overlay.
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
