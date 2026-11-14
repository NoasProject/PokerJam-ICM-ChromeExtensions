import { parseHandHistory } from "./hand-history.mjs";
import { calculatePayouts, summarizePoints } from "./payouts.mjs";
import { estimateFieldAverageBB } from "./field-stacks.mjs";
import { checkForReleaseUpdate } from "./release-updates.mjs";

const byId = (id) => document.getElementById(id);
const MAX_HISTORY_LENGTH = 100000;
const MID_STAGE_MIN_PLAYERS = 10;
const historyPanel = byId("history-panel");
const historyPasteTarget = byId("history-paste-target");
const openFile = byId("open-history-file");
const historyFile = byId("history-file");
const entriesInput = byId("entries");
const remainingInput = byId("remaining");
const playerCountInputs = [remainingInput, entriesInput];
const averagePreview = byId("estimated-average");
const settings = byId("settings");
const send = byId("send");
const checkUpdate = byId("check-update");
const updateRelease = byId("update-release");
const draftFields = [entriesInput, remainingInput];
const historyControls = [historyPasteTarget, openFile, historyFile];
const chipFormat = new Intl.NumberFormat("ja-JP");
const bbFormat = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 4 });
const pointFormat = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });
const anteLabels = { none: "なし", ante: "全員", bba: "BB" };

let hand = null;
let historyText = "";
let sending = false;
let importingHistory = false;

function status(id, message = "", tone = "") {
  const element = byId(id);
  element.textContent = message;
  element.dataset.tone = tone;
}

const installedVersion = chrome.runtime.getManifest().version;
byId("installed-version").textContent = `v${installedVersion}`;

checkUpdate.addEventListener("click", async () => {
  checkUpdate.disabled = true;
  updateRelease.hidden = true;
  updateRelease.removeAttribute("href");
  status("update-status", "更新を確認しています…");
  try {
    const { version, comparison, url } = await checkForReleaseUpdate(installedVersion);
    if (comparison > 0) {
      status("update-status", `新しいバージョンがあります（使用中 ${installedVersion} / 公開版 ${version}）`, "success");
      updateRelease.href = url;
      updateRelease.hidden = false;
    } else if (comparison < 0) {
      status("update-status", `公開版より新しいバージョンを使用中です（使用中 ${installedVersion} / 公開版 ${version}）`);
    } else {
      status("update-status", "最新版を使用中です", "success");
    }
  } catch {
    status("update-status", "公開リリースのバージョンを取得できませんでした。時間をおいて再試行してください。", "error");
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
  const entries = entriesInput.value ? Number(entriesInput.value) : NaN;
  const remaining = remainingInput.value ? Number(remainingInput.value) : NaN;
  const seated = hand?.players.length;
  const mid = Number.isSafeInteger(remaining) &&
    (remaining >= MID_STAGE_MIN_PLAYERS || (seated != null && remaining > seated));
  let error = "";
  if ([entries, remaining].some((count) => !Number.isNaN(count) && !Number.isSafeInteger(count))) {
    error = "総エントリー数と残り人数は整数で入力してください。";
  } else if (entries < 2 || remaining < 2) {
    error = "総エントリー数と残り人数は2以上にしてください。";
  } else if (Number.isFinite(remaining) && seated && remaining < seated) {
    error = `残り人数はハンド履歴の着席人数（${seated}人）以上にしてください。`;
  } else if (Number.isFinite(entries) && remaining > entries) {
    error = "残り人数は総エントリー数以下にしてください。";
  }
  status("settings-status", error, error ? "error" : "");

  const countsValid = Number.isSafeInteger(entries) && Number.isSafeInteger(remaining) &&
    remaining >= 2 && entries >= remaining && !error;
  const busy = send.dataset.busy === "true";
  renderPoints(entries);

  const field = mid && countsValid && hand
    ? { entries, remaining, averageBB: estimateFieldAverageBB(hand.players, remaining) }
    : null;
  const estimate = field ? `全体の平均スタック（推定） ${bbFormat.format(field.averageBB)} BB` : "";
  if (averagePreview.textContent !== estimate) {
    averagePreview.textContent = estimate;
  }
  averagePreview.hidden = !field;
  send.disabled = busy || importingHistory || !seated || !countsValid;
  return { entries, remaining, field };
}

function renderHand() {
  byId("preview").hidden = false;
  const { smallBlind, bigBlind, ante, players } = hand;
  const blinds = [smallBlind, bigBlind].map((amount) => chipFormat.format(amount)).join(" / ");
  const anteAmount = ante.chips ? ` ${chipFormat.format(ante.chips)}` : "";
  byId("blinds").textContent = `${players.length}人 · SB / BB ${blinds} · アンティ ${anteLabels[ante.type]}${anteAmount}`;

  const rows = players.map(({ position, chips, bb }) => {
    const row = document.createElement("tr");
    for (const [index, value] of [position, chipFormat.format(chips), bbFormat.format(bb)].entries()) {
      const cell = document.createElement(index === 0 ? "th" : "td");
      if (index === 0) cell.scope = "row";
      cell.textContent = value;
      row.append(cell);
    }
    return row;
  });
  byId("players").replaceChildren(...rows);
  updateSettings();
}

function readHistory(text) {
  try {
    if (!text.trim()) throw new Error("ハンド履歴のテキストがありません。");
    if (text.length > MAX_HISTORY_LENGTH) {
      throw new Error("ハンド履歴が長すぎます。1件分を取り込んでください。");
    }
    hand = parseHandHistory(text);
    historyText = text;
  } catch (error) {
    status("history-status", error.message, "error");
    return false;
  }
  status("history-status");
  renderHand();
  return true;
}

function saveDraft() {
  const values = Object.fromEntries(draftFields.map(({ id, value }) => [id, value]));
  values.history = historyText;
  chrome.storage.session.set({ draft: { values } }).catch((error) => {
    status("send-status", error.message, "error");
  });
}

function showSolverStatus(result) {
  const busy = result?.state === "running";
  send.dataset.busy = String(busy);
  for (const control of playerCountInputs) control.disabled = busy;
  setHistoryControlsDisabled(busy || importingHistory);
  updateSettings();

  if (busy) {
    status("send-status", "カスタムプリフロップツリーに入力しています…");
  } else if (result?.state === "success") {
    status("send-status", "カスタムプリフロップツリーに入力しました。内容を確認して「計算」を押してください。", "success");
  } else if (result?.state === "error") {
    status("send-status", result.message, "error");
  } else {
    status("send-status");
  }
}

function clearSolverStatus() {
  status("send-status");
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
    status("history-status", "ファイルが大きすぎます。ハンド履歴1件分のテキストファイルを選んでください。", "error");
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

settings.addEventListener("input", () => {
  clearSolverStatus();
  updateSettings();
  saveDraft();
});

settings.addEventListener("submit", async (event) => {
  event.preventDefault();
  const { entries, remaining, field } = updateSettings();
  if (send.disabled || sending) return;

  sending = true;
  try {
    const payouts = calculatePayouts(entries, remaining);
    const solverHand = {
      smallBlindBB: hand.smallBlindBB,
      ante: { type: hand.ante.type, bb: hand.ante.bb },
      players: hand.players.map(({ position, bb }) => ({ position, bb })),
    };
    showSolverStatus({ state: "running" });
    const result = await chrome.runtime.sendMessage({
      type: "fill-zeno",
      settings: { hand: solverHand, payouts, field },
    });
    if (result?.error) throw new Error(result.error);
    showSolverStatus(result);
  } catch (error) {
    showSolverStatus({ state: "error", message: error.message });
  } finally {
    sending = false;
  }
});

let statusChanged = false;
chrome.storage?.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.solverStatus?.newValue) {
    statusChanged = true;
    showSolverStatus(changes.solverStatus.newValue);
  }
});

try {
  const { draft, solverStatus } = await chrome.storage.session.get(["draft", "solverStatus"]);
  if (draft) {
    for (const input of draftFields) input.value = draft.values[input.id] ?? input.value;
    for (const input of playerCountInputs) {
      // Older drafts may contain exponent notation from the number input.
      if (input.value && !/^[0-9]+$/.test(input.value)) {
        const count = Number(input.value);
        input.value = Number.isSafeInteger(count) && count >= 0 ? String(count) : "";
      }
    }
    if (draft.values.history) readHistory(draft.values.history);
  }
  if (!statusChanged) showSolverStatus(solverStatus);
} catch (error) {
  showSolverStatus({ state: "error", message: error.message });
} finally {
  for (const input of playerCountInputs) {
    let lastValue = input.value;
    input.addEventListener("input", () => {
      const digits = input.value.replace(/[０-９]/g, (digit) => digit.normalize("NFKC"));
      if (/^[0-9]*$/.test(digits)) lastValue = digits;
      if (input.value !== lastValue) {
        const cursor = input.selectionStart;
        input.value = lastValue;
        input.setSelectionRange(cursor, cursor);
      }
    });
  }
  document.querySelector("main").inert = false;
}
