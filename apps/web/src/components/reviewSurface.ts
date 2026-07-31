import type { StateStorage } from "~/lib/storage";

export type ReviewViewMode = "split" | "unified";

const REVIEW_VIEW_MODE_STORAGE_KEY = "vide:review-view-mode";

export function readReviewViewMode(storage: StateStorage): ReviewViewMode {
  return storage.getItem(REVIEW_VIEW_MODE_STORAGE_KEY) === "unified" ? "unified" : "split";
}

export function persistReviewViewMode(storage: StateStorage, mode: ReviewViewMode): void {
  storage.setItem(REVIEW_VIEW_MODE_STORAGE_KEY, mode);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * The command that reproduces the diff on screen, or null when there is none.
 *
 * Null rather than a best effort. Only a branch review names two refs; a
 * working-tree review is assembled server-side from `git diff HEAD` plus
 * separately generated untracked-file diffs, and a turn review is scoped to a
 * checkpoint neither of which a ref pair can express. The earlier fallback,
 * `git diff --binary | git apply -`, described none of those: it re-applied
 * whatever happened to be unstaged at paste time onto the same working tree, so
 * it was a no-op, a failure, or a second application of matching hunks. A copy
 * affordance that yields a wrong command is worse than no affordance, so callers
 * hide it instead of offering one.
 */
export function buildGitApplyCommand(input: {
  baseRef?: string | null;
  headRef?: string | null;
}): string | null {
  if (!input.baseRef || !input.headRef) {
    return null;
  }
  return `git diff --binary ${shellQuote(input.baseRef)}...${shellQuote(input.headRef)} | git apply -`;
}
