import { parseHandHistories } from "./hand-history.mjs";
import { calculatePayouts, summarizePoints } from "./payouts.mjs";
import { estimateFieldAverageBB } from "./field-stacks.mjs";
import { checkForReleaseUpdate, rememberCheckedRelease } from "./release-updates.mjs";
import { isZenoTab } from "./zeno.mjs";
import { isGtoWizardTab, MAX_GTO_WIZARD_ENTRIES } from "./gto-wizard.mjs";

const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
const usingGtoWizard = isGtoWizardTab(activeTab);

const byId = (id) => document.getElementById(id);
const MAX_HISTORY_LENGTH = 100000;
const MID_STAGE_MIN_PLAYERS = 10;
const HEADS_UP_STATUS = "HUのためICM不可";
const SUCCESS_TOAST_MS = 3000;
const historyPanel = byId("history-panel");
const historyPasteTarget = byId("history-paste-target");
const openFile = byId("open-history-file");
const historyFile = byId("history-file");
const historyPicker = byId("history-picker");
const historySelect = byId("history-select");
const historyDetails = byId("history-details");
const historySource = byId("history-source");
const entriesInput = byId("entries");
const remainingInput = byId("remaining");
const finalTableInput = byId("final-table");
const remainingField = byId("remaining-field");
const finalTableCount = byId("final-table-count");
const playerCountInputs = [remainingInput, entriesInput];
const lastPlayerCountValues = new Map();
const averagePreview = byId("estimated-average");
const settings = byId("settings");
const send = byId("send");
const sendToast = byId("send-toast");
const checkUpdate = byId("check-update");
const openUpdater = byId("open-updater");
const updateRelease = byId("update-release");
const historyControls = [historyPasteTarget, openFile, historyFile, historySelect];
const chipFormat = new Intl.NumberFormat("ja-JP");
const bbFormat = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 4 });
const pointFormat = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });
const anteLabels = { none: "なし", ante: "全員", bba: "BB" };
const ranks = "23456789TJQKA";

let hand = null;
let histories = [];
let historyText = "";
let sending = false;
let importingHistory = false;
let solverState;
let toastTimer;

function status(id, message = "", tone = "") {
  const element = byId(id);
  element.textContent = message;
  element.dataset.tone = tone;
}

const installedVersion = chrome.runtime.getManifest().version;
byId("installed-version").textContent = `v${installedVersion}`;

const UPDATE_TOAST_MS = 3000;
let updateToastTimer;

function showUpdateToast(message, tone = "") {
  clearTimeout(updateToastTimer);
  status("update-toast", message, tone);
  if (message) updateToastTimer = setTimeout(() => status("update-toast"), UPDATE_TOAST_MS);
}

checkUpdate.addEventListener("click", async () => {
  checkUpdate.disabled = true;
  openUpdater.hidden = true;
  updateRelease.hidden = true;
  updateRelease.removeAttribute("href");
  showUpdateToast("");
  status("update-status", "更新を確認しています…");
  try {
    const release = await checkForReleaseUpdate(installedVersion);
    const { version, comparison, url } = release;
    if (comparison > 0) {
      rememberCheckedRelease(release);
      status("update-status", `使用中 ${installedVersion} / 公開版 ${version}`);
      openUpdater.hidden = false;
      updateRelease.href = url;
      updateRelease.hidden = false;
      showUpdateToast("新しいバージョンがあります");
    } else if (comparison < 0) {
      status("update-status");
      showUpdateToast("公開版より新しいバージョンを使用中です");
    } else {
      status("update-status");
      showUpdateToast("最新版を使用中です");
    }
  } catch {
    status("update-status", "公開リリースのバージョンを取得できませんでした。時間をおいて再試行してください。", "error");
    showUpdateToast("更新を確認できませんでした", "error");
  } finally {
    checkUpdate.disabled = false;
  }
});

function renderPoints(entries) {
  const points = Number.isSafeInteger(entries) && entries >= 2 ? summarizePoints(entries) : null;
  const values = {
    "first-points": points ? `${pointFormat.format(points.first)} pt` : "—",
    "rank-increase": points?.increase != null ? `+${pointFormat.format(points.increase)} pt` : "—",
    "last-points": points ? `${pointFormat.format(points.last)} pt` : "—",
    "itm-count": points ? `ITM ${chipFormat.format(points.paidPlaces)}人` : "",
  };
  for (const [id, text] of Object.entries(values)) {
    const element = byId(id);
    if (element.textContent !== text) element.textContent = text;
  }
  byId("itm-count").hidden = !points;
}

function updateSettings() {
  const finalTable = finalTableInput.checked;
  const busy = send.dataset.busy === "true";
  remainingField.hidden = finalTable;
  remainingInput.disabled = finalTable || busy;

  const entries = entriesInput.value ? Number(entriesInput.value) : NaN;
  const seated = hand?.players.length;
  const selectedHistory = histories[historySelect.selectedIndex];
  let finalTableMessage = "";
  if (finalTable) {
    const displayedCount = selectedHistory?.headsUp ? 2 : seated;
    if (displayedCount) {
      finalTableMessage = `残り人数 ${displayedCount}人（ハンド履歴から取得）`;
    } else {
      finalTableMessage = selectedHistory ? "このハンドから残り人数を取得できません。" : "ハンド履歴を取り込むと残り人数が表示されます。";
    }
  }
  finalTableCount.hidden = !finalTable;
  if (finalTableCount.textContent !== finalTableMessage) finalTableCount.textContent = finalTableMessage;

  const remaining = finalTable ? (seated ?? NaN) : Number(remainingInput.value || NaN);
  const mid = !finalTable && Number.isSafeInteger(remaining) &&
    (remaining >= MID_STAGE_MIN_PLAYERS || (seated != null && remaining > seated));
  let error = "";
  if ([entries, remaining].some((count) => !Number.isNaN(count) && !Number.isSafeInteger(count))) {
    error = finalTable ? "総エントリー数は整数で入力してください。" : "総エントリー数と残り人数は整数で入力してください。";
  } else if (entries < 2 || remaining < 2) {
    error = finalTable ? "総エントリー数は2以上にしてください。" : "総エントリー数と残り人数は2以上にしてください。";
  } else if (Number.isFinite(remaining) && seated && remaining < seated) {
    error = `残り人数はハンド履歴の着席人数（${seated}人）以上にしてください。`;
  } else if (Number.isFinite(entries) && remaining > entries) {
    error = finalTable ? `総エントリー数はハンド履歴の着席人数（${seated}人）以上にしてください。` : "残り人数は総エントリー数以下にしてください。";
  } else if (usingGtoWizard && entries > MAX_GTO_WIZARD_ENTRIES) {
    error = `GTO Wizardに入力できる総エントリー数は${MAX_GTO_WIZARD_ENTRIES.toLocaleString("ja-JP")}人までです。`;
  }
  status("settings-status", error, error ? "error" : "");

  const countsValid = Number.isSafeInteger(entries) && Number.isSafeInteger(remaining) &&
    remaining >= 2 && entries >= remaining && !error;
  const canUseIcm = seated >= 3;
  renderPoints(entries);

  const field = mid && countsValid && canUseIcm
    ? { entries, remaining, averageBB: estimateFieldAverageBB(hand.players, remaining) }
    : null;
  const estimate = field ? `全体の平均スタック（推定） ${bbFormat.format(field.averageBB)} BB` : "";
  if (averagePreview.textContent !== estimate) {
    averagePreview.textContent = estimate;
  }
  averagePreview.hidden = !field;
  send.disabled = busy || importingHistory || !canUseIcm || !countsValid;
  return { entries, remaining, field };
}

function renderHand() {
  byId("preview").hidden = !hand;
  if (!hand) return;

  const { smallBlind, bigBlind, ante, players } = hand;
  const blinds = [smallBlind, bigBlind].map((amount) => chipFormat.format(amount)).join(" / ");
  const anteAmount = ante.chips ? ` ${chipFormat.format(ante.chips)}` : "";
  byId("blinds").textContent = `${players.length}人 · SB / BB ${blinds} · アンティ ${anteLabels[ante.type]}${anteAmount}`;

  const rows = players.map(({ position, isHero, chips, bb }) => {
    const row = document.createElement("tr");
    const positionCell = document.createElement("th");
    positionCell.scope = "row";
    positionCell.textContent = position;
    if (isHero) {
      const badge = document.createElement("span");
      badge.className = "hero-badge";
      badge.textContent = "Hero";
      positionCell.append(" ", badge);
    }
    row.append(positionCell);

    for (const value of [chipFormat.format(chips), bbFormat.format(bb)]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    return row;
  });
  byId("players").replaceChildren(...rows);
}

function selectHistory(index) {
  historySelect.selectedIndex = index;
  const selected = histories[index];
  hand = selected.hand;
  const message = selected.headsUp ? HEADS_UP_STATUS : selected.error;
  status("history-status", message ? `(${message})` : "", message ? "error" : "");
  historyDetails.hidden = histories.length < 2 && !selected.headsUp;
  historyDetails.open = !hand;
  const source = selected.timestamp ? selected.source.replace(` - ${selected.timestamp}`, "") : selected.source;
  historySource.textContent = historyDetails.hidden ? "" : source;
  historySource.scrollTop = 0;
  renderHand();
  updateSettings();
}

function formatHoleCards([first, second]) {
  if (!second) return "";

  const [firstRank, firstSuit] = first.toUpperCase();
  const [secondRank, secondSuit] = second.toUpperCase();
  if (firstRank === secondRank) return firstRank + secondRank;

  const ordered = ranks.indexOf(firstRank) > ranks.indexOf(secondRank)
    ? firstRank + secondRank
    : secondRank + firstRank;
  return ordered + (firstSuit === secondSuit ? "s" : "o");
}

function readHistory(text, selectedSourceIndex) {
  try {
    if (!text.trim()) throw new Error("ハンド履歴のテキストがありません。");
    if (text.length > MAX_HISTORY_LENGTH) {
      throw new Error("ハンド履歴が長すぎます。件数を減らして取り込んでください。");
    }
    const parsed = parseHandHistories(text);
    if (parsed.length === 1 && parsed[0].error && !parsed[0].headsUp) throw new Error(parsed[0].error);

    histories = parsed;
    historyText = text;
  } catch (error) {
    status("history-status", error.message, "error");
    return false;
  }

  historyPicker.hidden = histories.length < 2;
  byId("history-picker-label").textContent = `表示するハンド（${histories.length}件）`;
  historySelect.replaceChildren(...histories.map(({ heroCards, headsUp, error }, index) => {
    const message = headsUp ? HEADS_UP_STATUS : error && "ICM入力不可";
    const label = [`${histories.length - index}.`, formatHoleCards(heroCards), message && `(${message})`];
    const option = document.createElement("option");
    option.textContent = label.filter(Boolean).join(" ");
    return option;
  }));
  const selectedIndex = histories.findIndex(({ sourceIndex }) => sourceIndex === selectedSourceIndex);
  selectHistory(Math.max(0, selectedIndex));
  return true;
}

function saveDraft() {
  const values = Object.fromEntries(playerCountInputs.map(({ id, value }) => [id, value]));
  values.history = historyText;
  // Drafts saved before sorting used the hand's position in the original text.
  const selectedHistoryIndex = histories[historySelect.selectedIndex]?.sourceIndex ?? -1;
  chrome.storage.session.set({ draft: { values, selectedHistoryIndex } }).catch((error) => {
    status("send-status", error.message, "error");
  });
}

function saveFinalTablePreference() {
  chrome.storage.local.set({ finalTable: finalTableInput.checked }).catch(() => {
    status("send-status", "FT想定の設定を保存できませんでした。", "error");
  });
}

function showSolverStatus(result) {
  const previousState = solverState;
  solverState = result?.state;
  const busy = solverState === "running";
  send.dataset.busy = String(busy);
  entriesInput.disabled = busy;
  finalTableInput.disabled = busy;
  setHistoryControlsDisabled(busy || importingHistory);
  updateSettings();

  if (solverState === "success") {
    status("send-status");
    // Completion can arrive through both session storage and the message response.
    const remaining = SUCCESS_TOAST_MS - (Date.now() - result.completedAt);
    if (previousState !== "success" && remaining > 0) {
      sendToast.textContent = "反映しました";
      toastTimer = setTimeout(hideSuccessToast, remaining);
    }
    return;
  }

  hideSuccessToast();
  if (busy) {
    status("send-status", "フォームに入力しています…");
  } else if (solverState === "error") {
    status("send-status", result.message, "error");
  } else {
    status("send-status");
  }
}

function hideSuccessToast() {
  clearTimeout(toastTimer);
  sendToast.textContent = "";
}

function clearSolverStatus() {
  showSolverStatus();
  chrome.storage.session.remove("solverStatus").catch(() => {});
}

function setHistoryControlsDisabled(disabled) {
  for (const control of historyControls) control.disabled = disabled;
}

async function importHistory(load, readError) {
  if (historyPasteTarget.disabled) return;

  importingHistory = true;
  setHistoryControlsDisabled(true);
  updateSettings();
  status("history-status", "履歴を取り込んでいます…");
  try {
    const text = await load();
    if (readHistory(text)) {
      clearSolverStatus();
      saveDraft();
    }
  } catch {
    status("history-status", readError, "error");
  } finally {
    importingHistory = false;
    setHistoryControlsDisabled(send.dataset.busy === "true");
    updateSettings();
  }
}

historyPasteTarget.addEventListener("paste", (event) => {
  event.preventDefault();
  const text = event.clipboardData?.getData("text/plain") ?? "";
  void importHistory(() => text, "貼り付けたハンド履歴を読み取れませんでした。");
});

historyPasteTarget.addEventListener("input", () => {
  historyPasteTarget.value = "";
});

historySelect.addEventListener("change", () => {
  remainingInput.value = "";
  lastPlayerCountValues.set(remainingInput, "");
  selectHistory(historySelect.selectedIndex);
  clearSolverStatus();
  saveDraft();
});

openFile.addEventListener("click", () => historyFile.click());
historyFile.addEventListener("change", () => {
  const files = [...historyFile.files];
  historyFile.value = "";
  importHistoryFile(files);
});

function importHistoryFile(files) {
  if (historyPasteTarget.disabled || !files.length) return;
  if (files.length !== 1) {
    status("history-status", "ハンド履歴ファイルを1つずつ取り込んでください。", "error");
    return;
  }
  const [file] = files;
  if (file.size > MAX_HISTORY_LENGTH * 4) {
    status("history-status", "ファイルが大きすぎます。履歴の件数を減らして取り込んでください。", "error");
    return;
  }
  void importHistory(() => file.text(), "ファイルを読み取れませんでした。テキストファイルを選んでください。");
}

historyPanel.addEventListener("dragover", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = historyPasteTarget.disabled ? "none" : "copy";
  if (!historyPasteTarget.disabled) historyPanel.dataset.dragging = "";
});

historyPanel.addEventListener("dragleave", (event) => {
  if (!historyPanel.contains(event.relatedTarget)) delete historyPanel.dataset.dragging;
});

document.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
});

document.addEventListener("drop", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  delete historyPanel.dataset.dragging;
  if (historyPanel.contains(event.target)) importHistoryFile(event.dataTransfer.files);
});

settings.addEventListener("input", (event) => {
  clearSolverStatus();
  if (event.target === finalTableInput) saveFinalTablePreference();
  saveDraft();
});

settings.addEventListener("submit", async (event) => {
  event.preventDefault();
  const { entries, remaining, field } = updateSettings();
  if (send.disabled || sending) return;

  sending = true;
  try {
    const payouts = calculatePayouts(entries, usingGtoWizard ? entries : remaining);
    const solverHand = {
      smallBlindBB: hand.smallBlindBB,
      ante: { type: hand.ante.type, bb: hand.ante.bb },
      players: hand.players.map(({ position, bb }) => ({ position, bb })),
    };
    showSolverStatus({ state: "running" });
    const result = await chrome.runtime.sendMessage({
      type: "fill-solver",
      tabId: activeTab.id,
      solver: usingGtoWizard ? "gto-wizard" : "zeno",
      settings: { hand: solverHand, payouts, entries, remaining, field },
    });
    if (result?.error) throw new Error(result.error);
    showSolverStatus(result);
  } catch (error) {
    showSolverStatus({ state: "error", message: error.message });
  } finally {
    sending = false;
  }
});

async function restoreWorkspace() {
  let statusChanged = false;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && changes.solverStatus?.newValue) {
      statusChanged = true;
      showSolverStatus(changes.solverStatus.newValue);
    }
  });

  try {
    const [{ draft, solverStatus }, { finalTable }] = await Promise.all([
      chrome.storage.session.get(["draft", "solverStatus"]),
      chrome.storage.local.get("finalTable"),
    ]);
    finalTableInput.checked = (finalTable ?? draft?.finalTable) === true;
    if (finalTable === undefined && typeof draft?.finalTable === "boolean") saveFinalTablePreference();
    if (draft) {
      for (const input of playerCountInputs) {
        input.value = draft.values[input.id] ?? input.value;
        // Older drafts may contain exponent notation from the number input.
        if (input.value && !/^[0-9]+$/.test(input.value)) {
          const count = Number(input.value);
          input.value = Number.isSafeInteger(count) && count >= 0 ? String(count) : "";
        }
      }
      if (draft.values.history) readHistory(draft.values.history, draft.selectedHistoryIndex);
    }
    if (!statusChanged) showSolverStatus(solverStatus);
  } catch (error) {
    showSolverStatus({ state: "error", message: error.message });
  }

  for (const input of playerCountInputs) {
    lastPlayerCountValues.set(input, input.value);
    input.addEventListener("input", () => {
      const digits = input.value.replace(/[０-９]/g, (digit) => digit.normalize("NFKC"));
      if (/^[0-9]*$/.test(digits)) lastPlayerCountValues.set(input, digits);
      const lastValue = lastPlayerCountValues.get(input);
      if (input.value !== lastValue) {
        const cursor = input.selectionStart;
        input.value = lastValue;
        input.setSelectionRange(cursor, cursor);
      }
    });
  }
}

if (usingGtoWizard || isZenoTab(activeTab)) {
  if (usingGtoWizard) send.textContent = "GTO WizardのCustom Solutionsに入力";
  await restoreWorkspace();
  byId("workspace").hidden = false;
} else {
  byId("site-guide").hidden = false;
}
document.querySelector("main").inert = false;
