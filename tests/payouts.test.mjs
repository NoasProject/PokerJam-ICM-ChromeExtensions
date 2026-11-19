import assert from "node:assert/strict";
import test from "node:test";
import { calculatePayouts, pointFormulaForTimestamp, resolvePointFormula, summarizePoints } from "../extension/payouts.mjs";

test("selects v2 starting November 19 at 08:00 JST in the hand's time zone", () => {
  assert.equal(pointFormulaForTimestamp("2026/11/19 07:59:59 JST"), "v1");
  assert.equal(pointFormulaForTimestamp("2026/11/19 08:00:00 JST"), "v2");
  assert.equal(pointFormulaForTimestamp("2026/11/19 08:00:00"), "v2");
  assert.equal(pointFormulaForTimestamp("2026/11/18 17:59:59 ET"), "v1");
  assert.equal(pointFormulaForTimestamp("2026/11/18 18:00:00 ET"), "v2");
  assert.equal(pointFormulaForTimestamp("2026/11/18 23:00:00 UTC"), "v2");
});

test("treats missing, invalid and unrecognized hand times as unknown", () => {
  assert.equal(pointFormulaForTimestamp(), null);
  assert.equal(pointFormulaForTimestamp("2026/02/30 08:00:00 JST"), null);
  assert.equal(pointFormulaForTimestamp("2026/11/19 08:00:00 CST"), null);
});

test("applies the latest formula without a timestamp even with a manual v1 preference", () => {
  const oldHand = pointFormulaForTimestamp("2026/11/18 17:59:59 ET");
  const newHand = pointFormulaForTimestamp("2026/11/18 18:00:00 ET");
  const undatedHand = pointFormulaForTimestamp();
  assert.equal(resolvePointFormula(oldHand, "auto"), "v1");
  assert.equal(resolvePointFormula(oldHand, "v2"), "v2");
  assert.equal(resolvePointFormula(newHand, "v1"), "v1");
  assert.equal(resolvePointFormula(undatedHand, "auto"), "v2");
  assert.equal(resolvePointFormula(undatedHand, "v1"), "v2");
});

test("uses the v1 scale and equally spaced prizes down to 20 percent", () => {
  assert.deepEqual(summarizePoints(32, "v1"), { paidPlaces: 5, first: 140, second: 112, last: 28 });
  assert.deepEqual(calculatePayouts(32, 32, "v1"), [700, 560, 420, 280, 140]);
  assert.deepEqual(calculatePayouts(32, 4, "v1"), [700, 560, 420, 280]);
  assert.deepEqual(calculatePayouts(6, 2, "v1"), [500]);
  assert.deepEqual(calculatePayouts(7, 2, "v1"), [500, 100]);
  assert.deepEqual(calculatePayouts(19, 19, "v1"), [550, 330, 110]);
  assert.equal(summarizePoints(20, "v1").first, 120);
});

test("summarizes first, second and last paid place, including one- and two-place payouts", () => {
  assert.deepEqual(summarizePoints(6), { paidPlaces: 1, first: 37, second: null, last: 37 });
  assert.deepEqual(summarizePoints(7), { paidPlaces: 2, first: 40.6, second: 24.3, last: 24.3 });
  assert.deepEqual(summarizePoints(32), { paidPlaces: 5, first: 101, second: 60.6, last: 30.3 });
});

test("uses rank factors 1, 0.6, 0.5, 0.4 and 0.3 for five paid places", () => {
  assert.deepEqual(calculatePayouts(32, 32), [505, 303, 253, 202, 152]);
  assert.deepEqual(calculatePayouts(19, 19), [369, 222, 111]);
});

test("rounds points to tenths before converting at $5 per point and rounding dollars up", () => {
  assert.deepEqual(summarizePoints(30), { paidPlaces: 5, first: 97.1, second: 58.3, last: 29.1 });
  assert.deepEqual(calculatePayouts(30, 30), [486, 292, 243, 194, 146]);
});

test("preserves the original payout amounts when paid positions have been eliminated", () => {
  assert.deepEqual(calculatePayouts(32, 4), [505, 303, 253, 202]);
  assert.deepEqual(calculatePayouts(6, 2), [185]);
  assert.deepEqual(calculatePayouts(7, 2), [203, 122]);
});

test("applies the scale formula and caps it at 100 entries", () => {
  for (const [entries, first] of [
    [10, 251], [20, 381], [30, 486], [50, 660], [70, 808],
    [99, 994], [100, 1000], [101, 1000], [4096, 1000],
  ]) {
    const payouts = calculatePayouts(entries, entries);
    assert.equal(payouts[0], first);
    assert.equal(payouts.length, Math.ceil(entries * 0.15));
    if (entries >= 100) assert.equal(payouts.at(-1), 300);
  }
});

test("rejects invalid counts", () => {
  assert.throws(() => calculatePayouts(19, 20), /残り人数/);
  assert.throws(() => calculatePayouts(19, 1), /残り人数/);
  assert.throws(() => calculatePayouts(19.5, 9), /参加人数/);
});
