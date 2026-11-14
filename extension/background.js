import { fillCurrentZenoTab, isZenoUrl, ZENO_SITE } from "./zeno.mjs";

chrome.runtime.onInstalled.addListener(() => {
  const { onPageChanged, PageStateMatcher, ShowAction } = chrome.declarativeContent;
  onPageChanged.removeRules(undefined, () => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError.message);
      return;
    }
    onPageChanged.addRules([{
      id: "zenosolver-only",
      conditions: [new PageStateMatcher({ pageUrl: { urlPrefix: ZENO_SITE } })],
      actions: [new ShowAction()],
    }], () => {
      if (chrome.runtime.lastError) console.error(chrome.runtime.lastError.message);
    });
  });
});

let running = false;

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "fill-zeno" || sender.url !== chrome.runtime.getURL("workspace.html")) return;

  if (running) {
    respond({ error: "ZenoSolverへの入力を実行中です。" });
    return;
  }

  running = true;
  fillSolver(message.settings).then(
    respond,
    (error) => respond({ error: error.message }),
  ).finally(() => {
    running = false;
  });
  return true;
});

async function fillSolver(settings) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id == null || !isZenoUrl(tab.url) || (tab.pendingUrl && !isZenoUrl(tab.pendingUrl))) {
    throw new Error("ZenoSolverのタブを開いてからお試しください。");
  }

  await chrome.storage.session.set({ solverStatus: { state: "running" } });

  let result;
  try {
    await fillCurrentZenoTab(tab.id, settings);
    result = { state: "success", completedAt: Date.now() };
  } catch (error) {
    result = { state: "error", message: error.message };
  }
  await chrome.storage.session.set({ solverStatus: result });
  return result;
}
