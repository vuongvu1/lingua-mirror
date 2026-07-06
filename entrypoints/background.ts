import { sendToActiveTab } from "../src/active-tab";
import { BERGAMOT_PORT } from "../src/bergamot/protocol";
import { handleConnection } from "../src/bergamot/server";
import { TOGGLE_SPLIT } from "../src/messages";

export default defineBackground(() => {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "toggle-split") return;
    await sendToActiveTab({ type: TOGGLE_SPLIT });
  });

  // Firefox has no built-in Translator API; host bergamot in the background.
  // import.meta.env.BROWSER is compile-time — this whole branch (and the
  // dynamic chunk) is dropped from Chrome builds.
  if (import.meta.env.BROWSER === "firefox") {
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== BERGAMOT_PORT) return;
      void import("../src/bergamot/engine").then(({ bergamotEngineFactory }) => {
        handleConnection(port, bergamotEngineFactory());
      });
    });
  }
});
