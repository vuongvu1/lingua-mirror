import { LANGUAGES } from "../../src/languages";
import { TOGGLE_SPLIT } from "../../src/messages";
import { getSettings, saveSettings } from "../../src/settings";

async function init(): Promise<void> {
  const leftSel = document.getElementById("left") as HTMLSelectElement;
  const rightSel = document.getElementById("right") as HTMLSelectElement;
  const toggleBtn = document.getElementById("toggle") as HTMLButtonElement;

  for (const lang of LANGUAGES) {
    leftSel.add(new Option(lang.label, lang.code));
  }
  rightSel.add(new Option("Original language of the site", "auto"));
  for (const lang of LANGUAGES) {
    rightSel.add(new Option(lang.label, lang.code));
  }

  const settings = await getSettings();
  leftSel.value = settings.leftLang;
  rightSel.value = settings.rightLang;

  const persist = (): void => {
    void saveSettings({ leftLang: leftSel.value, rightLang: rightSel.value });
  };
  leftSel.addEventListener("change", persist);
  rightSel.addEventListener("change", persist);

  toggleBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id != null) {
      chrome.tabs.sendMessage(tab.id, { type: TOGGLE_SPLIT });
    }
    window.close();
  });
}

void init();
