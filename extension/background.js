import { fillCurrentZenoTab, isZenoTab } from "./zeno.mjs";
import { fillCurrentGtoWizardTab, isGtoWizardTab } from "./gto-wizard.mjs";

let running = false;

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const { action } = chrome.runtime.getManifest();
  const workspace = chrome.runtime.getURL(action.default_popup);
  if (message?.type === "reload-after-update" &&
      sender.url === new URL("update.html", workspace).href) {
    if (running) {
      respond({ error: "フォームへの入力が終わってから再読み込みしてください。" });
    } else {
      respond({ ok: true });
      chrome.runtime.reload();
    }
    return;
  }
  if (message?.type !== "fill-solver" || sender.url !== workspace) return;

  if (running) {
    respond({ error: "フォームへの入力を実行中です。" });
    return;
  }

  running = true;
  fillSolver(message).then(
    respond,
    (error) => respond({ error: error.message }),
  ).finally(() => {
    running = false;
  });
  return true;
});

async function fillSolver({ tabId, solver, settings }) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const fill = solver === "gto-wizard" && isGtoWizardTab(tab) ? fillCurrentGtoWizardTab :
    solver === "zeno" && isZenoTab(tab) ? fillCurrentZenoTab : null;
  if (tab?.id == null || tab.id !== tabId || !fill) {
    throw new Error("入力先のZenoSolverまたはGTO Wizardのタブを開いてからお試しください。");
  }

  await chrome.storage.session.set({ solverStatus: { state: "running" } });

  let result;
  try {
    await fill(tab.id, settings);
    result = { state: "success", completedAt: Date.now() };
  } catch (error) {
    result = { state: "error", message: error.message };
  }
  await chrome.storage.session.set({ solverStatus: result });
  return result;
}
