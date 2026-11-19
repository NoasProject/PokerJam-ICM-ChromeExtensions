import assert from "node:assert/strict";
import test from "node:test";
import { calculatePayouts, summarizePoints } from "../extension/payouts.mjs";

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
