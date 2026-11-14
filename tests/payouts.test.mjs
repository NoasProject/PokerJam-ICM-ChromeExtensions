import assert from "node:assert/strict";
import test from "node:test";
import { calculatePayouts, summarizePoints } from "../extension/payouts.mjs";

test("summarizes the full field's points, including single-place payouts", () => {
  const points = summarizePoints(42);
  assert.deepEqual(points, { paidPlaces: 7, first: 160, increase: 128 / 6, last: 32 });
  assert.deepEqual(summarizePoints(19), { paidPlaces: 3, first: 110, increase: 44, last: 22 });
  assert.deepEqual(summarizePoints(6), { paidPlaces: 1, first: 100, increase: null, last: 100 });
});

test("converts points at a fixed $5 rate and rounds dollars up", () => {
  assert.deepEqual(calculatePayouts(42, 9), [800, 694, 587, 480, 374, 267, 160]);
  assert.deepEqual(calculatePayouts(19, 9), [550, 330, 110]);
  assert.equal(calculatePayouts(9, 9)[1], 100);
});

test("preserves the original payout amounts when paid positions have been eliminated", () => {
  assert.deepEqual(calculatePayouts(42, 3), [800, 694, 587]);
  assert.deepEqual(calculatePayouts(6, 2), [500]);
  assert.deepEqual(calculatePayouts(9, 2), [500, 100]);
});

test("uses the scale threshold for every entry-count bracket", () => {
  for (const [entries, first] of [
    [9, 500], [10, 550], [19, 550], [20, 600], [29, 600], [30, 700],
    [39, 700], [40, 800], [49, 800], [50, 850], [69, 850], [70, 900],
    [99, 900], [100, 1000], [101, 1000],
  ]) {
    const payouts = calculatePayouts(entries, entries);
    assert.equal(payouts[0], first);
    assert.equal(payouts.length, Math.ceil(entries * 0.15));
    assert.equal(payouts.at(-1), first / 5);
  }
});

test("rejects invalid counts", () => {
  assert.throws(() => calculatePayouts(19, 20), /残り人数/);
  assert.throws(() => calculatePayouts(19, 1), /残り人数/);
  assert.throws(() => calculatePayouts(19.5, 9), /参加人数/);
});
