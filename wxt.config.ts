import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Lingua Mirror",
    description:
      "Read any page side-by-side in two languages with synchronized hover-highlighting.",
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
  },
});
