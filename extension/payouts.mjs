const DOLLARS_PER_POINT = 5;
const V2_START_TIME = Date.parse("2026-11-19T08:00:00+09:00");
const TIME_ZONE_OFFSETS_AT_V2_START = { JST: 9, UTC: 0, GMT: 0, ET: -5, EST: -5, EDT: -4 };
const V1_FIRST_PLACE_POINTS = [
  [9, 100],
  [19, 110],
  [29, 120],
  [39, 140],
  [49, 160],
  [69, 170],
  [99, 180],
  [Infinity, 200],
];

export function pointFormulaForTimestamp(timestamp) {
  const match = /^(\d{4}\/\d{2}\/\d{2}) (\d{2}:\d{2}:\d{2})(?: ([A-Z]{2,5}))?$/.exec(timestamp ?? "");
  if (!match) return null;

  const [, date, time, zone = "JST"] = match;
  const offset = TIME_ZONE_OFFSETS_AT_V2_START[zone];
  if (offset === undefined) return null;

  const wallTime = `${date.replaceAll("/", "-")}T${time}`;
  const timestampMs = Date.parse(`${wallTime}Z`);
  if (!Number.isFinite(timestampMs) || new Date(timestampMs).toISOString().slice(0, 19) !== wallTime) {
    return null;
  }
  // Compare local clock readings at the cutover, when ET is on standard time.
  const cutoffInZone = V2_START_TIME + offset * 60 * 60 * 1000;
  return timestampMs < cutoffInZone ? "v1" : "v2";
}

export function resolvePointFormula(detectedFormula, preference) {
  if (!detectedFormula) return "v2";
  return preference === "auto" ? detectedFormula : preference;
}

function pointStructure(entries, formula) {
  const paidPlaces = Math.ceil(entries * 0.15);
  const firstPlacePoints = formula === "v1"
    ? V1_FIRST_PLACE_POINTS.find(([max]) => entries <= max)[1]
    : 100 * Math.min(2, 2 * (entries / 100) ** 0.6);
  return { paidPlaces, firstPlacePoints, formula };
}

function pointTenths({ firstPlacePoints, paidPlaces, formula }, place) {
  if (formula === "v1") {
    const steps = Math.max(1, paidPlaces - 1);
    const rankWeight = 5 * steps - 4 * (place - 1);
    return Math.round(firstPlacePoints * 10 * rankWeight / (5 * steps));
  }

  // Express the rank factors as percentages with a shared denominator.
  const steps = Math.max(1, paidPlaces - 2);
  const rankWeight = place === 1 ? 100 * steps : 60 * steps - 30 * (place - 2);
  return Math.round(firstPlacePoints * rankWeight / (10 * steps));
}

export function summarizePoints(entries, formula = "v2") {
  const structure = pointStructure(entries, formula);
  const { paidPlaces } = structure;
  return {
    paidPlaces,
    first: pointTenths(structure, 1) / 10,
    second: paidPlaces >= 2 ? pointTenths(structure, 2) / 10 : null,
    last: pointTenths(structure, paidPlaces) / 10,
  };
}

export function calculatePayouts(entries, remaining, formula = "v2") {
  if (!Number.isSafeInteger(entries) || !Number.isSafeInteger(remaining) ||
      remaining < 2 || entries < remaining) {
    throw new Error("参加人数と残り人数を入力してください。残り人数は2人以上、参加人数以下です。");
  }

  const structure = pointStructure(entries, formula);
  return Array.from({ length: Math.min(structure.paidPlaces, remaining) }, (_, index) => {
    const points = pointTenths(structure, index + 1);
    return Math.ceil(points * DOLLARS_PER_POINT / 10);
  });
}
