import assert from "node:assert/strict";
import test from "node:test";
import { parseHandHistories, parseHandHistory } from "../extension/hand-history.mjs";

const finalTable = `PokerStars Hand #13579: Tournament #2468, Freeroll Hold'em No Limit - Level XV (6000/12000) - 2026/11/13 08:02:20 ET
Table 'JAM用' 9-max Seat #4 is the button
Seat 1: プレイヤー1 (126000 in chips)
Seat 2: プレイヤー2 (470000 in chips)
Seat 3: 5555 (197000 in chips)
Seat 4: Hero (73000 in chips)
Seat 5: プレイヤー5 (180000 in chips)
Seat 6: プレイヤー6 (183000 in chips)
Seat 7: プレイヤー7 (248000 in chips)
Seat 8: プレイヤー8 (145000 in chips)
Seat 9: プレイヤー9 (180000 in chips)
プレイヤー5: posts small blind 6000
プレイヤー6: posts big blind 12000
プレイヤー6: posts the ante 12000
*** HOLE CARDS ***
Dealt to Hero [Td 8d]
*** SUMMARY ***
Seat 1: プレイヤー1 lost`;

test("reads POKER Jam's export layout and assigns the nine positions clockwise", () => {
  const hand = parseHandHistory(finalTable);
  assert.equal(hand.smallBlindBB, 0.5);
  assert.deepEqual(hand.ante, { type: "bba", chips: 12000, bb: 1 });
  assert.deepEqual(hand.players.map(({ position, seat }) => [position, seat]), [
    ["UTG", 7], ["UTG1", 8], ["UTG2", 9], ["LJ", 1], ["HJ", 2],
    ["CO", 3], ["BTN", 4], ["SB", 5], ["BB", 6],
  ]);
  assert.equal(hand.players.find(({ position }) => position === "BTN").bb, 6.08333333333);
  assert.deepEqual(hand.players.filter(({ isHero }) => isHero).map(({ position }) => position), ["BTN"]);
  assert.equal(hand.players.at(-1).bb, 15.25);
});

const headsUp = `PokerStars Hand #3579: Tournament #42, Freeroll Hold'em No Limit - Level II (1,000/2,000)
Table '離席あり' 9-max Seat #8 is the button
Seat 1: BB Player (22,000 in chips)
Seat 8: SB Player (16,000 in chips)
SB Player: posts small blind 1,000
BB Player: posts big blind 2,000
*** HOLE CARDS ***`;

test("uses the button as SB heads-up, accounts for empty seats and reads comma-grouped amounts", () => {
  const hand = parseHandHistory(headsUp.replaceAll("\n", "\r\n"));
  assert.deepEqual(hand.players.map(({ position, seat, bb }) => [position, seat, bb]), [
    ["SB", 8, 8], ["BB", 1, 11],
  ]);
  assert.equal(hand.ante.type, "none");
  assert.equal(hand.players.some(({ isHero }) => isHero), false);
});

test("classifies equal per-player antes and rejects inconsistent ante posts", () => {
  const withAntes = headsUp.replace("*** HOLE CARDS ***", `BB Player: posts the ante 200
SB Player: posts the ante 200
*** HOLE CARDS ***`);
  assert.deepEqual(parseHandHistory(withAntes).ante, { type: "ante", chips: 200, bb: 0.1 });
  assert.throws(() => parseHandHistory(withAntes.replace("SB Player: posts the ante 200", "SB Player: posts the ante 100")), /アンティ/);
});

test("rejects a second hand or blinds that conflict with the assigned seats", () => {
  assert.throws(() => parseHandHistory(`${finalTable}\n\n${headsUp}`), /1件ずつ/);
  assert.throws(() => parseHandHistory(headsUp.replace("SB Player: posts small", "BB Player: posts small")), /席順/);
});

test("sorts consecutive hands by ID when timestamps are missing and keeps invalid hands as text", () => {
  const missingSmallBlind = headsUp.replace("PokerStars Hand #3579", "PokerStars Game #4321")
    .replace("SB Player: posts small blind 1,000\n", "");
  const source = `\uFEFF${headsUp}\n  ${missingSmallBlind}\n\n${finalTable}`.replaceAll("\n", "\r\n");
  const histories = parseHandHistories(source);

  assert.deepEqual(histories.map(({ id }) => id), ["13579", "4321", "3579"]);
  assert.deepEqual(histories.map(({ sourceIndex }) => sourceIndex), [2, 1, 0]);
  assert.equal(histories[0].timestamp, "2026/11/13 08:02:20 ET");
  assert.deepEqual(histories[0].heroCards, ["Td", "8d"]);
  assert.equal(histories[0].hand.players.length, 9);
  assert.equal(histories[1].hand, null);
  assert.match(histories[1].error, /ブラインド/);
  assert.equal(histories[1].source, missingSmallBlind.replaceAll("\n", "\r\n"));
  assert.equal(histories[2].hand.players.length, 2);
});

test("sorts out-of-order hands by recorded time when every hand has a timestamp", () => {
  const earlier = finalTable.replace("08:02:20", "08:01:00");
  const later = finalTable.replace("#13579", "#13578").replace("08:02:20", "08:03:00");
  const histories = parseHandHistories(`${finalTable}\n${earlier}\n${later}`);

  assert.deepEqual(histories.map(({ sourceIndex }) => sourceIndex), [2, 0, 1]);
});

test("recognizes heads-up hands even when the blind posts conflict with the button", () => {
  const mismatched = headsUp.replace("Seat #8 is the button", "Seat #1 is the button");
  const missingBlind = finalTable.replace("プレイヤー5: posts small blind 6000\n", "");
  const [validHu, invalidHu, invalidMultiway] = [headsUp, mismatched, missingBlind]
    .map((text) => parseHandHistories(text)[0]);

  assert.equal(validHu.headsUp, true);
  assert.equal(validHu.hand.players.length, 2);
  assert.equal(invalidHu.headsUp, true);
  assert.equal(invalidHu.hand, null);
  assert.equal(invalidMultiway.headsUp, false);
  assert.equal(invalidMultiway.hand, null);
});
