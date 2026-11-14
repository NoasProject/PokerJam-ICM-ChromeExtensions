export const ZENO_SITE = "https://zenosolver.com/";

export function isZenoUrl(url) {
  return typeof url === "string" && url.startsWith(ZENO_SITE);
}

export async function fillCurrentZenoTab(tabId, settings) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: fillZenoForm,
    args: [settings],
  });
  if (!injection?.result?.ok) {
    throw new Error(injection?.result?.error ?? "カスタムプリフロップツリーへの入力結果を確認できませんでした。");
  }
}

// chrome.scripting serializes this function, so it must be self-contained.
export function fillZenoForm(settings) {
  try {
    if (location.origin !== "https://zenosolver.com") {
      throw new Error("ZenoSolverのタブを開いてからお試しください。");
    }

    const dialog = Array.from(document.querySelectorAll(".ipbox[role=dialog]")).find((entry) =>
      entry.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && entry.querySelector("#ipN")
    );
    if (!dialog) {
      throw new Error("このタブで「カスタムプリフロップツリー」を開いてからお試しください。");
    }

    function required(selector) {
      const element = dialog.querySelector(selector);
      if (!element || element.disabled) {
        throw new Error("対応するZenoSolverの入力欄が見つかりませんでした。");
      }
      return element;
    }

    function activate(selector) {
      const button = required(selector);
      if (!button.classList.contains("on")) button.click();
      if (!required(selector).classList.contains("on")) {
        throw new Error("ZenoSolverの設定を切り替えられませんでした。");
      }
    }

    function write(selector, value) {
      const field = required(selector);
      field.value = String(value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const { hand, payouts, field } = settings;
    const count = hand.players.length;
    activate('#ipMode button[data-m="icm"]');
    activate('#ipModel button[data-v="icm"]');
    activate(field ? '#ipStage button[data-s="mid"]' : '#ipStage button[data-s=""]');
    activate('#ipUnitSeg button[data-u="bb"]');
    activate('#ipStk button[data-v="before"]');
    write("#ipN", count);

    const positionInputs = Array.from(dialog.querySelectorAll("#ipSeats input[data-seat]"));
    if (positionInputs.length !== count ||
        positionInputs.some((input, index) => input.dataset.seat !== hand.players[index].position)) {
      throw new Error("ZenoSolverの席順が一致しませんでした。");
    }

    const sbChoice = [0.4, 0.5, 0.67].includes(hand.smallBlindBB) ? hand.smallBlindBB : "custom";
    activate(`#ipSbSeg button[data-v="${sbChoice}"]`);
    write("#ipAnteK", hand.ante.type);
    if (field) {
      activate('#ipMidK button[data-m="field"]');
    }
    if (required("#ipBty").checked) required("#ipBty").click();

    const values = [
      ["#ipPay", payouts.join(", ")],
      ...hand.players.map(({ position, bb }) => [`#ipSeats input[data-seat="${position}"]`, bb]),
    ];

    if (sbChoice === "custom") values.push(["#ipSbV", hand.smallBlindBB]);
    if (hand.ante.type !== "none") values.push(["#ipAnteV", hand.ante.bb]);
    if (field) {
      values.push(
        ["#ipEnt", field.entries],
        ["#ipLeft", field.remaining],
        ["#ipDist", "gamma:2"],
        ["#ipAvg", field.averageBB],
      );
    }
    for (const [selector, expected] of values) write(selector, expected);

    // Confirm the page still shows the values after all of its change handlers.
    if (required("#ipN").value !== String(count) || required("#ipAnteK").value !== hand.ante.type ||
        values.some(([selector, expected]) => required(selector).value !== String(expected)) ||
        required("#ipBty").checked) {
      throw new Error("一部の設定を入力できませんでした。ZenoSolverのフォームを確認してください。");
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
