import assert from "node:assert/strict";
import test from "node:test";
import { calculatePayouts, summarizePoints } from "../extension/payouts.mjs";

test("summarizes the full field's points, including single-place payouts", () => {
  const points = summarizePoints(42);
  assert.deepEqual(points, { paidPlaces: 7, first: 160, increase: 128 / 6, last: 32 });
  assert.deepEqual(summarizePoints(19), { paidPlaces: 3, first: 110, increase: 44, last: 22 });
  assert.deepEqual(summarizePoints(6), { paidPlaces: 1, first: 100, increase: null, last: 100 });
});

test("matches the 19E and 42E reference payouts at the default rate", () => {
  assert.deepEqual(calculatePayouts(19, 9), [1100, 660, 220]);
  assert.deepEqual(calculatePayouts(42, 9), [1600, 1387, 1173, 960, 747, 533, 320]);
});

test("rounds dollars up after converting the rounded points at $5", () => {
  assert.deepEqual(calculatePayouts(42, 9, 5), [800, 694, 587, 480, 374, 267, 160]);
  assert.deepEqual(calculatePayouts(19, 9, 5), [550, 330, 110]);
  assert.equal(calculatePayouts(9, 9, 5)[1], 100);
});

test("preserves the original payout amounts when paid positions have been eliminated", () => {
  assert.deepEqual(calculatePayouts(42, 3), [1600, 1387, 1173]);
  assert.deepEqual(calculatePayouts(6, 2), [1000]);
  assert.deepEqual(calculatePayouts(9, 2), [1000, 200]);
});

test("uses the scale threshold for every entry-count bracket", () => {
  for (const [entries, first] of [
    [9, 1000], [10, 1100], [19, 1100], [20, 1200], [29, 1200], [30, 1400],
    [39, 1400], [40, 1600], [49, 1600], [50, 1700], [69, 1700], [70, 1800],
    [99, 1800], [100, 2000], [101, 2000],
  ]) {
    const payouts = calculatePayouts(entries, entries);
    assert.equal(payouts[0], first);
    assert.equal(payouts.length, Math.ceil(entries * 0.15));
    assert.equal(payouts.at(-1), first / 5);
  }
});

test("rejects invalid counts and unsupported conversion rates", () => {
  assert.throws(() => calculatePayouts(19, 20), /残り人数/);
  assert.throws(() => calculatePayouts(19, 1), /残り人数/);
  assert.throws(() => calculatePayouts(19.5, 9), /参加人数/);
  assert.throws(() => calculatePayouts(19, 9, 0), /換算額/);
});
