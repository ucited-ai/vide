import { describe, expect, it } from "vite-plus/test";

import { nextUsageActivityIndex, usageQuantileLevel } from "./UsageActivityField.logic";

describe("usage activity field logic", () => {
  it("keeps empty periods distinct and distributes positive values over five bands", () => {
    const values = [10, 20, 30, 40, 50];

    expect(usageQuantileLevel(0, values)).toBe(0);
    expect(values.map((value) => usageQuantileLevel(value, values))).toEqual([1, 2, 3, 4, 5]);
  });

  it("moves by rows across columns and clamps at the grid boundaries", () => {
    expect(nextUsageActivityIndex(8, "ArrowLeft", 7, 30)).toBe(1);
    expect(nextUsageActivityIndex(8, "ArrowRight", 7, 30)).toBe(15);
    expect(nextUsageActivityIndex(0, "ArrowUp", 7, 30)).toBe(0);
    expect(nextUsageActivityIndex(29, "ArrowDown", 7, 30)).toBe(29);
    expect(nextUsageActivityIndex(12, "Home", 7, 30)).toBe(0);
    expect(nextUsageActivityIndex(12, "End", 7, 30)).toBe(29);
  });
});
