import assert from "node:assert/strict";
import test from "node:test";
import { parseHandHistory } from "../extension/hand-history.mjs";

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
