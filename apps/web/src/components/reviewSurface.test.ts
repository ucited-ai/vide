import { describe, expect, it } from "vite-plus/test";

import type { StateStorage } from "~/lib/storage";

import { buildGitApplyCommand, persistReviewViewMode, readReviewViewMode } from "./reviewSurface";

function memoryStorage(initialValue: string | null = null): StateStorage {
  let value = initialValue;
  return {
    getItem: () => value,
    setItem: (_name, nextValue) => {
      value = nextValue;
    },
    removeItem: () => {
      value = null;
    },
  };
}

describe("review surface preferences", () => {
  it("defaults to split view and persists a unified selection", () => {
    const storage = memoryStorage();

    expect(readReviewViewMode(storage)).toBe("split");
    persistReviewViewMode(storage, "unified");
    expect(readReviewViewMode(storage)).toBe("unified");
  });
});

describe("review surface git apply command", () => {
  it("quotes refs and falls back to the working-tree diff", () => {
    expect(buildGitApplyCommand({ baseRef: "origin/main", headRef: "feature's/head" })).toBe(
      "git diff --binary 'origin/main'...'feature'\\''s/head' | git apply -",
    );
    expect(buildGitApplyCommand({})).toBe("git diff --binary | git apply -");
  });
});
