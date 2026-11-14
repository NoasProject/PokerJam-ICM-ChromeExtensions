const POSITIONS = [
  [], [],
  ["SB", "BB"],
  ["BTN", "SB", "BB"],
  ["CO", "BTN", "SB", "BB"],
  ["HJ", "CO", "BTN", "SB", "BB"],
  ["UTG", "HJ", "CO", "BTN", "SB", "BB"],
  ["UTG", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
  ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
  ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
];

const NUMBER = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const HAND_START = /^[^\S\r\n]*PokerStars (?:Hand|Game) #/gim;
const TABLE = /^Table '.+' (\d+)-max Seat #(\d+) is the button$/i;
const HOLE_CARDS = /^\*\*\* HOLE CARDS \*\*\*$/i;
const BLINDS = new RegExp(String.raw`\((${NUMBER})\s*\/\s*(${NUMBER})\)`);
const SEAT = new RegExp(String.raw`^Seat (\d+): (.+) \((${NUMBER}) in chips\)$`, "i");
const POST = new RegExp(
  String.raw`^(.+): posts (small blind|big blind|the ante|big blind ante|BB ante|ante) (?:of )?(${NUMBER})(?: and is all-in)?$`,
  "i",
);

function number(value) {
  return Number(value.replaceAll(",", ""));
}

function toBB(chips, bigBlind) {
  return Number((chips / bigBlind).toPrecision(12));
}

export function parseHandHistories(text) {
  const starts = Array.from(text.matchAll(HAND_START), ({ index }) => index);
  const blocks = starts.length > 1
    ? starts.map((start, index) => text.slice(start, starts[index + 1]).trim())
    : [text.trim()];

  const histories = blocks.map((source, sourceIndex) => {
    const header = source.split(/\r?\n/, 1)[0].trimEnd();
    const id = header.match(/^PokerStars (?:Hand|Game) #(\d+):/i)?.[1];
    const timestamp = header.match(/ - (\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}(?: [A-Z]{2,5})?)$/)?.[1];
    const heroCards = source.match(/^Dealt to Hero \[([2-9TJQKA][cdhs]) ([2-9TJQKA][cdhs])\]/im)?.slice(1) ?? [];
    const history = { source, sourceIndex, id, timestamp, heroCards };
    try {
      const hand = parseHandHistory(source);
      return { ...history, hand, headsUp: hand.players.length === 2, error: "" };
    } catch (error) {
      // A blind mismatch can leave the seats readable even when the hand cannot be parsed.
      const lines = source.split(/\r?\n/).map((line) => line.trim());
      const holeCards = lines.findIndex((line) => HOLE_CARDS.test(line));
      const headsUp = Boolean(id) && TABLE.test(lines[1] ?? "") && holeCards > 1 &&
        lines.slice(2, holeCards).filter((line) => SEAT.test(line)).length === 2;
      return { ...history, hand: null, headsUp, error: error.message };
    }
  });

  const allTimed = histories.every(({ timestamp }) => timestamp);
  return histories.sort((a, b) => {
    if (allTimed) {
      const byTime = b.timestamp.slice(0, 19).localeCompare(a.timestamp.slice(0, 19));
      if (byTime) return byTime;
    }
    const aId = a.id ?? "";
    const bId = b.id ?? "";
    return bId.length - aId.length || bId.localeCompare(aId);
  });
}

export function parseHandHistory(text) {
  if ((text.match(HAND_START)?.length ?? 0) > 1) {
    throw new Error("ハンド履歴を1件ずつ貼り付けてください。");
  }

  const lines = text.trim().split(/\r?\n/).map((line) => line.trim());
  const header = /^PokerStars (?:Hand|Game) #\d+:\s+Tournament #\d+,.*Hold['’]em No Limit/i.test(lines[0]);
  const blinds = lines[0].match(BLINDS);
  if (!header || !blinds) {
    throw new Error("POKER Jamの「GTO Wizard向け」でコピーした、NL Hold’emトーナメントの履歴を貼り付けてください。");
  }

  const smallBlind = number(blinds[1]);
  const bigBlind = number(blinds[2]);
  if (!(smallBlind > 0 && bigBlind >= smallBlind && Number.isFinite(bigBlind))) {
    throw new Error("ヘッダーのブラインド額を確認してください。");
  }

  const table = TABLE.exec(lines[1] ?? "");
  const holeCards = lines.findIndex((line) => HOLE_CARDS.test(line));
  if (!table || holeCards < 0) {
    throw new Error("テーブルとブラインドの記録を含むハンド履歴を貼り付けてください。");
  }

  const seatLimit = Number(table[1]);
  const buttonSeat = Number(table[2]);
  const players = [];
  const posts = { sb: [], bb: [], antes: [] };

  for (const line of lines.slice(2, holeCards)) {
    if (!line) continue;
    const seat = line.match(SEAT);
    if (seat) {
      players.push({ seat: Number(seat[1]), name: seat[2], chips: number(seat[3]) });
      continue;
    }

    const post = line.match(POST);
    if (!post) {
      throw new Error("席情報またはブラインド・アンティの記録に対応していない形式があります。");
    }

    const kind = post[2].toLowerCase();
    const key = kind === "small blind" ? "sb" : kind === "big blind" ? "bb" : "antes";
    posts[key].push({ name: post[1], kind, amount: number(post[3]) });
  }

  const count = players.length;
  const uniqueSeats = new Set(players.map((player) => player.seat));
  const uniqueNames = new Set(players.map((player) => player.name));
  if (!POSITIONS[count]?.length || count > seatLimit || uniqueSeats.size !== count ||
      uniqueNames.size !== count || !players.every(({ seat, chips }) =>
        seat >= 1 && seat <= seatLimit && Number.isFinite(chips) && chips > 0)) {
    throw new Error("2〜9人分の重複のない席番号・プレイヤー名・開始スタックが必要です。");
  }

  players.sort((a, b) => a.seat - b.seat);
  const buttonIndex = players.findIndex((player) => player.seat === buttonSeat);
  if (buttonIndex === -1) {
    throw new Error("ボタン席のプレイヤーが見つかりません。");
  }

  // Zeno lists players in preflop action order. At heads-up the button posts SB.
  const firstIndex = count === 2 ? buttonIndex : (buttonIndex + 3) % count;
  const ordered = players.slice(firstIndex).concat(players.slice(0, firstIndex));
  const sb = ordered.at(-2);
  const bb = ordered.at(-1);
  if (posts.sb.length !== 1 || posts.bb.length !== 1 ||
      posts.sb[0].name !== sb.name || posts.bb[0].name !== bb.name ||
      posts.sb[0].amount !== smallBlind || posts.bb[0].amount !== bigBlind) {
    throw new Error("席順とSB・BBの記録が一致しないか、欠けているブラインドがあります。");
  }

  return {
    smallBlind,
    bigBlind,
    smallBlindBB: toBB(smallBlind, bigBlind),
    ante: readAnte(posts.antes, ordered, bigBlind),
    players: ordered.map((player, index) => ({
      ...player,
      position: POSITIONS[count][index],
      isHero: player.name === "Hero",
      bb: toBB(player.chips, bigBlind),
    })),
  };
}

function readAnte(posts, players, bigBlind) {
  if (!posts.length) return { type: "none", chips: 0, bb: 0 };

  const amount = posts[0].amount;
  if (amount > 0 && Number.isFinite(amount) && posts.every((post) => post.amount === amount)) {
    if (posts.length === 1 && posts[0].name === players.at(-1).name) {
      return { type: "bba", chips: amount, bb: toBB(amount, bigBlind) };
    }

    const names = new Set(posts.map((post) => post.name));
    if (posts.length === players.length && players.every(({ name }) => names.has(name)) &&
        posts.every(({ kind }) => kind === "ante" || kind === "the ante")) {
      return { type: "ante", chips: amount, bb: toBB(amount, bigBlind) };
    }
  }
  throw new Error("アンティの記録がBBアンティまたは全員同額のアンティと一致しません。");
}
