import { describe, expect, it } from "@effect/vitest";

import { isSupportedHourlyUsageDuration } from "./usageWindow.ts";

describe("hourly usage windows", () => {
  it("accepts the seven-day Activity Field and rejects larger hourly scans", () => {
    const dayMs = 24 * 60 * 60 * 1000;

    expect(isSupportedHourlyUsageDuration(7 * dayMs)).toBe(true);
    expect(isSupportedHourlyUsageDuration(7 * dayMs + 1)).toBe(false);
    expect(isSupportedHourlyUsageDuration(0)).toBe(false);
  });
});
