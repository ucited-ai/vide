const MAX_HOURLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** The Activity Field requests hourly buckets only up to its seven-day view. */
export function isSupportedHourlyUsageDuration(durationMs: number): boolean {
  return durationMs > 0 && durationMs <= MAX_HOURLY_WINDOW_MS;
}
