import { sendToActiveTab } from "../src/active-tab";
import { TOGGLE_SPLIT } from "../src/messages";

export default defineBackground(() => {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "toggle-split") return;
    await sendToActiveTab({ type: TOGGLE_SPLIT });
  });
});
