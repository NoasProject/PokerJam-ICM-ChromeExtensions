export const MAX_GTO_WIZARD_ENTRIES = 4096;

const GTO_WIZARD_SITE = "https://app.gtowizard.com/";

export function isGtoWizardTab(tab) {
  return typeof tab?.url === "string" && tab.url.startsWith(GTO_WIZARD_SITE) &&
    (!tab.pendingUrl || tab.pendingUrl.startsWith(GTO_WIZARD_SITE));
}

export async function fillCurrentGtoWizardTab(tabId, settings) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: fillGtoWizardForm,
    args: [settings],
  });
  if (!injection?.result?.ok) {
    throw new Error(injection?.result?.error ?? "GTO Wizardへの入力結果を確認できませんでした。");
  }
}

// Chrome injects this function by itself, without its module scope.
export async function fillGtoWizardForm({ hand, entries, remaining, payouts, field }) {
  try {
    if (location.origin !== "https://app.gtowizard.com") {
      throw new Error("GTO Wizardのタブを開いてからお試しください。");
    }

    const tab = (name) => `[data-custom-solution-tab="${name}"]`;
    const visible = (element) => element?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((entry) =>
      visible(entry) && entry.querySelector(tab("handDetails")));
    if (!dialog) throw new Error("GTO Wizardで「Custom Solutions」を開いてからお試しください。");

    const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
    async function poll(find, timeout = 1800) {
      const deadline = Date.now() + timeout;
      while (dialog.isConnected && Date.now() < deadline) {
        const result = find();
        if (result) return result;
        await pause();
      }
    }

    async function waitFor(find, error) {
      const result = await poll(find);
      if (!result) throw new Error(error);
      return result;
    }

    const text = (element) => element?.textContent.trim();
    const enabled = (element) => visible(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true";
    const button = (root, ...labels) => Array.from(root?.querySelectorAll('button, [role="button"]') ?? [])
      .find((element) => enabled(element) && labels.includes(text(element)));
    function panel(control = dialog.querySelector('[data-custom-solution-tab][aria-selected="true"]')) {
      if (control?.getAttribute("aria-selected") !== "true") return;
      const content = document.getElementById(control.getAttribute("aria-controls") ?? "");
      if (visible(content) && dialog.contains(content) && content.getAttribute("role") === "tabpanel") return content;
    }

    async function openTab(name, label) {
      const error = `GTO Wizardの「${label}」タブを開けませんでした。`;
      // Switching from Cash mounts Tournament Details after the game type button's click.
      const control = await waitFor(() => {
        const candidate = dialog.querySelector(tab(name));
        if (enabled(candidate)) return candidate;
      }, error);
      if (control.getAttribute("aria-selected") !== "true") control.click();
      await waitFor(() => panel(dialog.querySelector(tab(name))), error);
    }

    const input = (selector) => panel()?.querySelector(selector);
    const valueOf = (element) => element?.value.trim() ? Number(element.value.replace(/[,\s]/g, "")) : NaN;
    const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    function editValue(element, value) {
      const data = String(value);
      setInputValue.call(element, data);
      element.dispatchEvent(new InputEvent("input", { bubbles: true, data, inputType: "insertReplacementText" }));
    }

    async function write(selector, value, label, { committed, prepare } = {}) {
      const applied = () => valueOf(input(selector)) === value && (!committed || committed());
      let found = false;
      for (const timeout of committed ? [700, 1800] : [1800]) {
        if (applied()) return;
        if (!input(selector)) prepare?.();
        const target = await poll(() => {
          const candidate = input(selector);
          if (enabled(candidate)) return candidate;
        }, timeout);
        if (!target) continue;
        found = true;

        // Use native events so the site's controlled inputs save the new values on blur.
        target.focus({ preventScroll: true });
        editValue(target, value);
        await pause();
        target.blur();
        if (await poll(applied, timeout)) return;
      }
      throw new Error(found ? `GTO Wizardの「${label}」に ${value} を反映できませんでした。` :
        `GTO Wizardの「${label}」欄が見つかりませんでした。`);
    }

    async function choose(option, selectedLabel = option, autofillValue) {
      const combobox = () => input('[role="combobox"]');
      const selectionError = `GTO Wizardで「${selectedLabel}」を選べませんでした。`;
      const applied = () => {
        const combo = combobox();
        return text(combo) === selectedLabel && combo.getAttribute("aria-expanded") === "false";
      };
      const findOption = () => {
        const listbox = document.getElementById(combobox()?.getAttribute("aria-controls") ?? "");
        return Array.from(listbox?.querySelectorAll('[role="option"]') ?? [])
          .find((entry) => enabled(entry) && text(entry) === option);
      };
      const highlightedOption = () => {
        const candidate = findOption();
        if (candidate && document.activeElement !== candidate) candidate.focus({ preventScroll: true });
        if (candidate?.hasAttribute("data-highlighted") && document.activeElement === candidate) return candidate;
      };
      const readyCombobox = () => waitFor(() => {
        const control = combobox();
        if (enabled(control)) return control;
      }, selectionError);

      const combo = await readyCombobox();
      if (applied()) return;
      const autofill = combo.parentElement?.querySelector('input[id$="-hidden-input"][aria-hidden="true"]');
      if (autofillValue && autofill?.type === "text" && !autofill.disabled && !autofill.readOnly) {
        if (combo.getAttribute("aria-expanded") !== "true") combo.click();
        // The select's autofill handler accepts registered option values without moving focus.
        if (await poll(findOption, 700)) {
          editValue(autofill, autofillValue);
          if (await poll(() => text(combobox()) === selectedLabel, 700)) {
            const selected = combobox();
            if (selected.getAttribute("aria-expanded") === "true") selected.click();
            if (await poll(applied, 700)) return;
          }
        }
      }

      // Reacquire the menu after an ignored activation, since Base UI may replace it.
      for (const activate of [pressEnter, clickOption]) {
        const combo = await readyCombobox();
        if (applied()) return;
        if (combo.getAttribute("aria-expanded") !== "true") combo.click();
        const item = await poll(highlightedOption);
        if (applied()) return;
        if (item) {
          activate(item);
          if (await poll(applied, 700)) return;
        }
      }
      throw new Error(selectionError);
    }

    function pressEnter(option) {
      option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    }

    function clickOption(option) {
      const pointer = { bubbles: true, cancelable: true, pointerType: "mouse", button: 0, isPrimary: true, pointerId: 1 };
      option.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
      option.dispatchEvent(new PointerEvent("pointerup", pointer));
      option.click();
    }

    const rounded = (value, precision) => Number(value.toFixed(precision));
    const smallBlind = rounded(hand.smallBlindBB, 2);
    const ante = rounded(hand.ante.bb, 3);
    const stacks = hand.players.map(({ position, bb }) => ({
      position: position.replace(/^UTG([12])$/, "UTG+$1"),
      bb: rounded(bb, 3),
    }));
    if (smallBlind <= 0 || stacks.some(({ bb }) => bb <= 0) || (hand.ante.type !== "none" && ante <= 0)) {
      throw new Error("GTO Wizardに入力できる小数精度を下回るブラインド、アンティ、またはスタックがあります。");
    }

    const tournaments = button(dialog, "Tournaments");
    if (!tournaments) throw new Error("GTO Wizardの「Tournaments」が見つかりませんでした。");
    if (tournaments.getAttribute("aria-pressed") !== "true") tournaments.click();
    await openTab("tournamentDetails", "Tournament Details");
    const isIcm = () => /ICM\b/.test(dialog.querySelector(tab("tournamentDetails"))?.textContent ?? "");
    const entrantsField = "#holdem-total-entrants";
    const tournamentHeaderMatch = () => isIcm() && text(input('[role="combobox"]')) === "STD" &&
      valueOf(input(entrantsField)) === entries;
    const placesPaid = () => valueOf(input("#holdem-players-paid"));
    const payoutRows = () => panel().querySelectorAll("[data-payout-row-key]");
    const prizeField = (start) => `input[data-payout-field="prize"][aria-label="Prize for place ${start}"]`;
    const lastPlaceField = (start) => `input[data-payout-field="end"][aria-label="Last place of the row that starts at place ${start}"]`;
    const prizeGroups = [];
    for (let start = 1; start <= payouts.length;) {
      let end = start;
      while (end < payouts.length && payouts[end] === payouts[start - 1]) end++;
      prizeGroups.push({ start, end, amount: payouts[start - 1] });
      start = end + 1;
    }

    async function writeTournamentDetails() {
      if (!isIcm()) {
        const icm = button(panel(), "ICM");
        if (!icm) throw new Error("GTO Wizardの「ICM」が見つかりませんでした。");
        icm.click();
        await waitFor(isIcm, "GTO Wizardで「ICM」を選べませんでした。");
      }
      await choose("Standard", "STD", "NORMAL");
      if (tournamentDetailsMatch()) return;
      if (placesPaid() > 1 || payoutRows().length > 1) {
        const clear = button(panel(), "Clear");
        if (!clear) throw new Error("GTO Wizardの既存の賞金行を置き換えられませんでした。");
        clear.click();
        const confirm = await waitFor(() => button(panel(), "Confirm"), "GTO Wizardの賞金行の確認ボタンが見つかりませんでした。");
        confirm.click();
        await waitFor(() => placesPaid() === 1 && payoutRows().length === 1,
          "GTO Wizardの既存の賞金行を置き換えられませんでした。");
      }
      await write(entrantsField, entries, "Entrants");

      const addPlace = () => {
        const add = button(panel(), "Add Place");
        if (!add) throw new Error("GTO Wizardの賞金行を追加できませんでした。");
        add.click();
      };
      // A draft prize can be visible before it counts toward Places Paid.
      for (const { start, end, amount } of prizeGroups) {
        if (!tournamentHeaderMatch()) throw new Error("GTO Wizardのトーナメント形式または総エントリー数が戻りました。");
        await write(prizeField(start), amount, `${start}位の賞金`, {
          committed: () => placesPaid() === start,
          prepare: addPlace,
        });
        if (end > start) {
          await write(lastPlaceField(start), end, `${start}位から同額になる最後の順位`, {
            committed: () => placesPaid() === end,
          });
        }
      }
      if (placesPaid() !== payouts.length) throw new Error("GTO Wizardの入賞枠数が一致しませんでした。");
      if (!tournamentHeaderMatch()) throw new Error("GTO Wizardのトーナメント形式または総エントリー数が戻りました。");
    }

    async function fillTournamentDetails() {
      try {
        await writeTournamentDetails();
      } catch (error) {
        // A fresh Custom Solution can restore its previous tournament settings while the first fill is in progress.
        if (!dialog.isConnected || tournamentHeaderMatch()) throw error;
        await openTab("tournamentDetails", "Tournament Details");
        await writeTournamentDetails();
      }
    }

    function tournamentDetailsMatch() {
      return tournamentHeaderMatch() &&
        placesPaid() === payouts.length && payoutRows().length === prizeGroups.length &&
        prizeGroups.every(({ start, end, amount }) => {
          const lastPlace = input(lastPlaceField(start));
          return valueOf(input(prizeField(start))) === amount && lastPlace &&
            (valueOf(lastPlace) === end || (start === end && lastPlace.value.trim() === ""));
        });
    }

    await fillTournamentDetails();

    await openTab("handDetails", "Hand Details");
    if (!visible(input("#holdem-preflop-stack"))) {
      const preflop = button(panel(), "Preflop", "プリフロップ");
      if (!preflop) throw new Error("GTO Wizardのプリフロップ設定が見つかりませんでした。");
      preflop.click();
      await waitFor(() => visible(input("#holdem-preflop-stack")), "GTO Wizardをプリフロップに切り替えられませんでした。");
    }

    const stackSelector = 'input[id^="holdem-preflop-stack-"]';
    const stackInputs = () => Array.from(panel().querySelectorAll(stackSelector)).filter(visible);
    if (stackInputs().length !== stacks.length) {
      const tableSize = button(panel(), String(stacks.length));
      if (!tableSize) throw new Error("GTO Wizardの卓人数を変更できませんでした。");
      tableSize.click();
    }
    const positionsMatch = () => {
      const inputs = stackInputs();
      return inputs.length === stacks.length && inputs.every((element, index) =>
        element.id === `holdem-preflop-stack-${stacks[index].position}`);
    };
    await waitFor(positionsMatch, "GTO Wizardの席順がハンド履歴と一致しませんでした。");
    await write("#holdem-players-remaining", remaining, "Players Left");
    await write('input[aria-label="Small blind in big blinds"]', smallBlind, "SB/BB");
    await choose({ none: "No Ante", ante: "Per player", bba: "BB Ante" }[hand.ante.type]);
    if (hand.ante.type !== "none") await write("#holdem-ante", ante, "Ante");
    for (const { position, bb } of stacks) {
      await write(`input[id="holdem-preflop-stack-${position}"]`, bb, `${position}のスタック`);
    }

    if (field) {
      const average = "#holdem-average-stack";
      if (input(average)?.disabled) {
        const distribution = Array.from(panel().querySelectorAll('button[aria-expanded]')).find((element) =>
          enabled(element) && text(element).startsWith("Stack Distribution"));
        if (!distribution) throw new Error("GTO Wizardの「Stack Distribution」が見つかりませんでした。");
        if (distribution.getAttribute("aria-expanded") !== "true") distribution.click();
        const automatic = await waitFor(() => button(panel(), "Automatic"), "GTO Wizardのスタック分布を設定できませんでした。");
        automatic.click();
      }
      await write(average, rounded(field.averageBB, 3), "Avg Stack");
    }

    // Some inputs can still display an uncommitted edit until the panel is reopened.
    await openTab("tournamentDetails", "Tournament Details");
    if (!tournamentDetailsMatch()) {
      await fillTournamentDetails();
      await openTab("handDetails", "Hand Details");
      await openTab("tournamentDetails", "Tournament Details");
      if (!tournamentDetailsMatch()) throw new Error("GTO Wizardの総エントリー数と賞金の反映を確認できませんでした。");
    }
    await openTab("handDetails", "Hand Details");
    if (valueOf(input("#holdem-players-remaining")) !== remaining || !positionsMatch() ||
        stackInputs().some((element, index) => valueOf(element) !== stacks[index].bb)) {
      throw new Error("GTO Wizardに反映された残り人数やスタックを確認してください。");
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
