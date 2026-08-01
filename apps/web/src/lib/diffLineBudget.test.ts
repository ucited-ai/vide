import type { FileDiffMetadata } from "@pierre/diffs/types";
import { describe, expect, it } from "vite-plus/test";

import {
  exceedsInlineLineBudget,
  INLINE_LINE_LENGTH_BUDGET,
  longestDiffLineLength,
} from "./diffLineBudget";

function fileDiff(additionLines: string[], deletionLines: string[] = []): FileDiffMetadata {
  return {
    name: "src/example.ts",
    type: "modified",
    hunks: [],
    splitLineCount: additionLines.length,
    unifiedLineCount: additionLines.length,
    isPartial: false,
    additionLines,
    deletionLines,
  } as unknown as FileDiffMetadata;
}

describe("longestDiffLineLength", () => {
  it("measures the longest line across both sides", () => {
    expect(longestDiffLineLength(fileDiff(["ab", "abcd"], ["abcdef"]))).toBe(6);
    expect(longestDiffLineLength(fileDiff(["abcdefg"], ["ab"]))).toBe(7);
  });

  it("is zero for a diff with no text, such as a binary file", () => {
    expect(longestDiffLineLength(fileDiff([], []))).toBe(0);
  });
});

describe("exceedsInlineLineBudget", () => {
  it("passes an ordinary file no matter how many lines it has", () => {
    expect(
      exceedsInlineLineBudget(fileDiff(Array.from({ length: 20_000 }, () => "const x = 1;"))),
    ).toBe(false);
  });

  it("catches the minified payload: one line, hundreds of kilobytes", () => {
    expect(exceedsInlineLineBudget(fileDiff(["x".repeat(400_000)]))).toBe(true);
  });

  it("catches a long line on the deleted side too", () => {
    expect(exceedsInlineLineBudget(fileDiff([], ["x".repeat(400_000)]))).toBe(true);
  });

  it("treats the budget as exclusive, so a line exactly at it still renders", () => {
    expect(exceedsInlineLineBudget(fileDiff(["x".repeat(INLINE_LINE_LENGTH_BUDGET)]))).toBe(false);
    expect(exceedsInlineLineBudget(fileDiff(["x".repeat(INLINE_LINE_LENGTH_BUDGET + 1)]))).toBe(
      true,
    );
  });

  it("accepts an explicit budget so the policy lives in one place", () => {
    expect(exceedsInlineLineBudget(fileDiff(["x".repeat(50)]), 10)).toBe(true);
    expect(exceedsInlineLineBudget(fileDiff(["x".repeat(50)]), 100)).toBe(false);
  });
});
