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

export function buildGitApplyCommand(input: {
  baseRef?: string | null;
  headRef?: string | null;
}): string {
  if (!input.baseRef || !input.headRef) {
    return "git diff --binary | git apply -";
  }
  return `git diff --binary ${shellQuote(input.baseRef)}...${shellQuote(input.headRef)} | git apply -`;
}
