import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Language Split",
    description:
      "Read any page side-by-side in two languages with synchronized hover-highlighting.",
    permissions: ["storage", "activeTab"],
    commands: {
      "toggle-split": {
        suggested_key: { default: "Ctrl+Shift+L", mac: "Command+Shift+L" },
        description: "Toggle the language split on the current page",
      },
    },
  },
});
