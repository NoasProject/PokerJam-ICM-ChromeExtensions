// Scale factors multiplied by 1,000 so the formula works in tenths of a point.
const FIRST_PLACE_TENTHS = [
  [9, 1000],
  [19, 1100],
  [29, 1200],
  [39, 1400],
  [49, 1600],
  [69, 1700],
  [99, 1800],
  [Infinity, 2000],
];

function pointStructure(entries) {
  const paidPlaces = Math.ceil(entries * 0.15);
  const [, firstPlaceTenths] = FIRST_PLACE_TENTHS.find(([max]) => entries <= max);
  return { paidPlaces, firstPlaceTenths };
}

export function summarizePoints(entries) {
  const { paidPlaces, firstPlaceTenths } = pointStructure(entries);
  const first = firstPlaceTenths / 10;
  const last = paidPlaces === 1 ? first : firstPlaceTenths / 50;
  const increase = paidPlaces === 1 ? null : (first - last) / (paidPlaces - 1);
  return { paidPlaces, first, increase, last };
}

export function calculatePayouts(entries, remaining, dollarsPerPoint = 10) {
  if (!Number.isSafeInteger(entries) || !Number.isSafeInteger(remaining) ||
      remaining < 2 || entries < remaining) {
    throw new Error("参加人数と残り人数を入力してください。残り人数は2人以上、参加人数以下です。");
  }
  if (dollarsPerPoint !== 5 && dollarsPerPoint !== 10) {
    throw new Error("1ptの換算額は $10 または $5 を選んでください。");
  }

  const { paidPlaces, firstPlaceTenths } = pointStructure(entries);
  const rankSteps = Math.max(1, paidPlaces - 1);
  return Array.from({ length: Math.min(paidPlaces, remaining) }, (_, index) => {
    const rankWeight = 5 * rankSteps - 4 * index;
    const pointTenths = Math.round(firstPlaceTenths * rankWeight / (5 * rankSteps));
    return Math.ceil(pointTenths * dollarsPerPoint / 10);
  });
}
