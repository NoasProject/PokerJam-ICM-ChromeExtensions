import { readPreferences } from "./preferences.mjs";

const form = document.getElementById("preferences");
const pointRate = document.getElementById("point-rate");
const status = document.getElementById("options-status");

function showStatus(message, tone = "") {
  status.dataset.tone = tone;
  status.textContent = message;
}

form.addEventListener("input", () => showStatus(""));
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const preferences = readPreferences({
    pointRate: Number(pointRate.value),
  });
  form.inert = true;
  try {
    await chrome.storage.local.set({ preferences });
    showStatus("設定を保存しました。", "success");
  } catch {
    showStatus("設定を保存できませんでした。もう一度お試しください。", "error");
  } finally {
    form.inert = false;
    document.getElementById("save").focus();
  }
});

try {
  const { preferences } = await chrome.storage.local.get("preferences");
  const saved = readPreferences(preferences);
  pointRate.value = String(saved.pointRate);
  form.inert = false;
} catch {
  showStatus("設定を読み込めませんでした。ページを再読み込みしてください。", "error");
}
