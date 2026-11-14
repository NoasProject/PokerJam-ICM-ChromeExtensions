export function estimateFieldAverageBB(players, remaining) {
  const stacks = players.map(({ bb }) => bb).sort((a, b) => b - a);
  const fullTables = Math.floor(remaining / stacks.length);
  const partialTableSize = remaining % stacks.length;
  const tableTotal = stacks.reduce((total, stack) => total + stack, 0);
  const partialTotal = stacks.slice(0, partialTableSize).reduce((total, stack) => total + stack, 0);

  return (tableTotal * fullTables + partialTotal) / remaining;
}
