import { resolve } from "node:path";
import { defineConfig } from "wxt";

export default defineConfig({
  hooks: {
    // Ship the bergamot worker trio verbatim (classic worker + importScripts +
    // wasm — must NOT go through Vite's worker bundling). Firefox output only;
    // the Chrome bundle stays bergamot-free.
    "build:publicAssets": (wxt, assets) => {
      if (wxt.config.browser !== "firefox") return;
      const base = "node_modules/@browsermt/bergamot-translator/worker";
      for (const file of [
        "translator-worker.js",
        "bergamot-translator-worker.js",
        "bergamot-translator-worker.wasm",
      ]) {
        assets.push({
          absoluteSrc: resolve(base, file),
          relativeDest: `worker/${file}`,
        });
      }
    },
  },
  manifest: ({ browser }) => ({
    name: "Lingua Mirror",
    description:
      "Read any page side-by-side in two languages with synchronized hover-highlighting.",
    // Firefox: MV3 needs an explicit add-on id (also required for storage on AMO).
    // Translation degrades gracefully there — no built-in Translator API yet.
    ...(browser === "firefox" && {
      browser_specific_settings: {
        gecko: { id: "lingua-mirror@vuhoangvuong", strict_min_version: "128.0" },
      },
      // Bergamot: registry + model files come from Mozilla's S3 bucket, and
      // the Emscripten glue needs wasm compilation in the background page.
      host_permissions: ["https://bergamot.s3.amazonaws.com/*"],
      content_security_policy: {
        extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
      },
    }),
    icons: {
      16: "icon-16.png",
      32: "icon-32.png",
      48: "icon-48.png",
      128: "icon-128.png",
    },
    action: {
      default_icon: {
        16: "icon-16.png",
        32: "icon-32.png",
        48: "icon-48.png",
      },
    },
    permissions: ["storage", "activeTab"],
    commands: {
      "toggle-split": {
        suggested_key: { default: "Ctrl+Shift+L", mac: "Command+Shift+L" },
        description: "Toggle the Lingua Mirror split on the current page",
      },
    },
  }),
});
