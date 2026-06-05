import { TOGGLE_SPLIT } from "../src/messages";

export default defineBackground(() => {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "toggle-split") return;
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id != null) {
      chrome.tabs.sendMessage(tab.id, { type: TOGGLE_SPLIT });
    }
  });
});
