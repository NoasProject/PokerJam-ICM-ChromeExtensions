import { installUpdate } from "./install-update.mjs";
import { checkForReleaseUpdate } from "./release-updates.mjs";
import { loadUpdateFolder, saveUpdateFolder } from "./update-folder.mjs";

const status = document.getElementById("update-status");
const hint = document.getElementById("update-hint");
const install = document.getElementById("install-update");
const pickFolder = document.getElementById("pick-update-folder");
const reload = document.getElementById("reload-extension");
const back = document.getElementById("back-to-workspace");
const link = document.getElementById("update-release");
const installed = chrome.runtime.getManifest();
const writeAccess = { mode: "readwrite" };
let release;
let savedFolder;

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
back.addEventListener("click", () => window.location.replace(chrome.runtime.getURL(installed.action.default_popup)));
install.addEventListener("click", () => applyUpdate(false));
pickFolder.addEventListener("click", () => applyUpdate(true));

async function applyUpdate(chooseFolder) {
  install.disabled = true;
  pickFolder.disabled = true;
  back.disabled = true;
  let folder;
  try {
    if (chooseFolder) {
      folder = await window.showDirectoryPicker({
        ...writeAccess,
        // Keep the same picker ID so Chrome can reopen the location used by older versions.
        id: "pokerjam-extension",
        startIn: savedFolder,
      });
    } else {
      folder = savedFolder;
      if (await folder.requestPermission(writeAccess) !== "granted") {
        showStatus("更新するには、Chromeでこのフォルダへの書き込みを許可してください。", true);
        return;
      }
    }
    showStatus(`v${release.version} をダウンロードしています…`);
    const installFolder = await navigator.locks.request("install-pokerjam-update", () =>
      installUpdate(folder, release, installed, fetchPackageFile));
    if (chooseFolder) await saveUpdateFolder(installFolder).catch((error) => console.warn("Could not remember update folder", error));
    install.hidden = true;
    pickFolder.hidden = true;
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
    pickFolder.disabled = false;
    back.disabled = false;
  }
}

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
    savedFolder = await loadUpdateFolder().catch((error) => console.warn("Could not restore update folder", error));
    showStatus(`v${installed.version} から v${release.version} に更新できます。`);
    if (savedFolder) {
      hint.textContent = "保存済みの読み込み元を使用します。Chromeが確認を表示した場合は、書き込みを許可してください。更新時に、ポップアップに取り込んだハンド履歴は消えます。";
      pickFolder.textContent = "フォルダを選び直す";
      install.hidden = false;
    }
    hint.hidden = false;
    pickFolder.hidden = false;
  }
} catch {
  showStatus("公開版を確認できませんでした。「戻る」を押して、もう一度更新を確認してください。", true);
}
