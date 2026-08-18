export type UsageActivityNavigationKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End";

/** Maps a positive value onto five quantile bands; zero always stays empty. */
export function usageQuantileLevel(value: number, positiveValues: readonly number[]): number {
  if (value <= 0 || positiveValues.length === 0) return 0;
  let upperBound = 0;
  while (upperBound < positiveValues.length && positiveValues[upperBound]! <= value) {
    upperBound += 1;
  }
  return Math.max(1, Math.min(5, Math.ceil((upperBound / positiveValues.length) * 5)));
}

/** Resolves row/column keyboard movement for a column-major activity grid. */
export function nextUsageActivityIndex(
  index: number,
  key: UsageActivityNavigationKey,
  rowCount: number,
  itemCount: number,
): number {
  if (itemCount === 0) return 0;
  let next = index;
  if (key === "ArrowLeft") next -= rowCount;
  else if (key === "ArrowRight") next += rowCount;
  else if (key === "ArrowUp") next -= 1;
  else if (key === "ArrowDown") next += 1;
  else if (key === "Home") next = 0;
  else next = itemCount - 1;
  return Math.max(0, Math.min(itemCount - 1, next));
}
