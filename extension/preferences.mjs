export function readPreferences(saved) {
  return {
    pointRate: saved?.pointRate === 5 ? 5 : 10,
  };
}
