/**
 * Send a message to the active tab's content script.
 * No-ops silently if there is no active tab or no content script is loaded
 * (e.g. chrome:// pages, the Web Store) — sendMessage rejects in that case and
 * the toggle simply does nothing on those pages.
 */
export async function sendToActiveTab(message: unknown): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return;
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    // No receiver in this tab — intentionally ignored.
  }
}
