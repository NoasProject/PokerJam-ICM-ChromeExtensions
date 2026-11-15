import { installUpdate } from "./install-update.mjs";
import { checkForReleaseUpdate } from "./release-updates.mjs";

const status = document.getElementById("update-status");
const hint = document.getElementById("update-hint");
const install = document.getElementById("install-update");
const reload = document.getElementById("reload-extension");
const link = document.getElementById("update-release");
const installed = chrome.runtime.getManifest();
let release;

function showStatus(message, error = false) {
  status.textContent = message;
  status.dataset.tone = error ? "error" : "";
}

async function fetchPackageFile(name) {
  const response = await fetch(chrome.runtime.getURL(name), { cache: "no-store" });
  return response.ok ? response.text() : null;
}

async function reloadExtension() {
  reload.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "reload-after-update" });
    if (!response?.ok) showStatus(response?.error ?? "chrome://extensions から再読み込みしてください。", true);
  } catch {
    showStatus("chrome://extensions から再読み込みしてください。", true);
  } finally {
    reload.disabled = false;
  }
}

reload.addEventListener("click", reloadExtension);
install.addEventListener("click", async () => {
  install.disabled = true;
  let folder;
  try {
    folder = await window.showDirectoryPicker({ mode: "readwrite", id: "pokerjam-extension" });
    showStatus(`v${release.version} をダウンロードしています…`);
    await navigator.locks.request("install-pokerjam-update", () => installUpdate(folder, release, installed, fetchPackageFile));
    install.hidden = true;
    hint.hidden = true;
    reload.hidden = false;
    showStatus(`v${release.version} を保存しました。拡張機能を再読み込みします。`);
    await reloadExtension();
  } catch (error) {
    if (!folder && error.name === "AbortError") {
      showStatus("更新をキャンセルしました。");
    } else {
      showStatus(`更新できませんでした。${error.message}`, true);
    }
  } finally {
    install.disabled = false;
  }
});

try {
  release = await checkForReleaseUpdate(installed.version);
  link.href = release.url;
  link.hidden = false;
  if (release.comparison === 0) {
    showStatus(`最新版 v${installed.version} を使用中です。`);
  } else if (release.comparison < 0) {
    showStatus(`公開版より新しい v${installed.version} を使用中です。`);
  } else if (typeof window.showDirectoryPicker !== "function") {
    showStatus("このブラウザではフォルダへの書き込みが使えません。GitHubから手動で更新してください。", true);
  } else {
    showStatus(`v${installed.version} から v${release.version} に更新できます。`);
    hint.hidden = false;
    install.hidden = false;
  }
} catch {
  showStatus("公開版を確認できませんでした。このページを再読み込みしてお試しください。", true);
}
