const DOLLARS_PER_POINT = 5;

function pointStructure(entries) {
  const paidPlaces = Math.ceil(entries * 0.15);
  const firstPlacePoints = 100 * Math.min(2, 2 * (entries / 100) ** 0.6);
  return { paidPlaces, firstPlacePoints };
}

function pointTenths(firstPlacePoints, paidPlaces, place) {
  // Express the rank factors as percentages with a shared denominator.
  const steps = Math.max(1, paidPlaces - 2);
  const rankWeight = place === 1 ? 100 * steps : 60 * steps - 30 * (place - 2);
  return Math.round(firstPlacePoints * rankWeight / (10 * steps));
}

export function summarizePoints(entries) {
  const { paidPlaces, firstPlacePoints } = pointStructure(entries);
  return {
    paidPlaces,
    first: pointTenths(firstPlacePoints, paidPlaces, 1) / 10,
    second: paidPlaces >= 2 ? pointTenths(firstPlacePoints, paidPlaces, 2) / 10 : null,
    last: pointTenths(firstPlacePoints, paidPlaces, paidPlaces) / 10,
  };
}

export function calculatePayouts(entries, remaining) {
  if (!Number.isSafeInteger(entries) || !Number.isSafeInteger(remaining) ||
      remaining < 2 || entries < remaining) {
    throw new Error("参加人数と残り人数を入力してください。残り人数は2人以上、参加人数以下です。");
  }

  const { paidPlaces, firstPlacePoints } = pointStructure(entries);
  return Array.from({ length: Math.min(paidPlaces, remaining) }, (_, index) => {
    const points = pointTenths(firstPlacePoints, paidPlaces, index + 1);
    return Math.ceil(points * DOLLARS_PER_POINT / 10);
  });
}
