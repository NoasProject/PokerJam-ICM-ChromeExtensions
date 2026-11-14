import assert from "node:assert/strict";
import test from "node:test";
import { estimateFieldAverageBB } from "../extension/field-stacks.mjs";

const players = [10, 30, 5, 15, 20].map((bb) => ({ bb }));

test("omits the shortest stack when estimating four other players from a five-player table", () => {
  assert.equal(estimateFieldAverageBB(players, 9), (80 + 75) / 9);
  assert.deepEqual(players.map(({ bb }) => bb), [10, 30, 5, 15, 20]);
});

test("uses complete copies and fills the remaining seats with the largest stacks", () => {
  assert.equal(estimateFieldAverageBB(players, 10), 16);
  assert.equal(estimateFieldAverageBB(players, 12), (80 * 2 + 30 + 20) / 12);
});
