import { describe, expect, it } from "vite-plus/test";

import { shouldAutoExpandChangedFiles } from "./changedFilesPresentation";

describe("changed-files presentation", () => {
  it("auto-expands only small, low-churn latest changes", () => {
    const smallFiles = [
      { path: "src/a.ts", kind: "modified", additions: 80, deletions: 20 },
      { path: "src/b.ts", kind: "modified", additions: 60, deletions: 20 },
    ];

    expect(shouldAutoExpandChangedFiles(smallFiles, true)).toBe(true);
    expect(shouldAutoExpandChangedFiles(smallFiles, false)).toBe(false);
    expect(
      shouldAutoExpandChangedFiles(
        [{ path: "src/a.ts", kind: "modified", additions: 201, deletions: 0 }],
        true,
      ),
    ).toBe(false);
    expect(
      shouldAutoExpandChangedFiles(
        Array.from({ length: 6 }, (_, index) => ({
          path: `src/${String(index)}.ts`,
          kind: "modified",
          additions: 1,
          deletions: 0,
        })),
        true,
      ),
    ).toBe(false);
  });
});
