import { fillCurrentZenoTab, isZenoTab } from "./zeno.mjs";

let running = false;

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const { action } = chrome.runtime.getManifest();
  const workspace = chrome.runtime.getURL(action.default_popup);
  if (message?.type === "reload-after-update" &&
      sender.url === new URL("update.html", workspace).href) {
    if (running) {
      respond({ error: "ZenoSolverへの入力が終わってから再読み込みしてください。" });
    } else {
      respond({ ok: true });
      chrome.runtime.reload();
    }
    return;
  }
  if (message?.type !== "fill-zeno" || sender.url !== workspace) return;

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
  if (tab?.id == null || !isZenoTab(tab)) {
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
