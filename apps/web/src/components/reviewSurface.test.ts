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
  it("quotes both refs", () => {
    expect(buildGitApplyCommand({ baseRef: "origin/main", headRef: "feature's/head" })).toBe(
      "git diff --binary 'origin/main'...'feature'\\''s/head' | git apply -",
    );
  });

  /*
   * No command rather than a working-tree fallback. The fallback described a
   * different change than the one on screen — it re-applied whatever was
   * unstaged at paste time — so callers hide the affordance instead.
   */
  it("returns null unless both refs are known", () => {
    expect(buildGitApplyCommand({})).toBeNull();
    expect(buildGitApplyCommand({ baseRef: "origin/main" })).toBeNull();
    expect(buildGitApplyCommand({ headRef: "HEAD" })).toBeNull();
    expect(buildGitApplyCommand({ baseRef: "", headRef: "HEAD" })).toBeNull();
  });
});
