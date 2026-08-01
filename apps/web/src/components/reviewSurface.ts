import type { StateStorage } from "~/lib/storage";

export type ReviewViewMode = "split" | "unified";

const REVIEW_VIEW_MODE_STORAGE_KEY = "vide:review-view-mode";
const REVIEW_FILES_PANE_STORAGE_KEY = "vide:review-files-pane";

export function readReviewViewMode(storage: StateStorage): ReviewViewMode {
  return storage.getItem(REVIEW_VIEW_MODE_STORAGE_KEY) === "unified" ? "unified" : "split";
}

export function persistReviewViewMode(storage: StateStorage, mode: ReviewViewMode): void {
  storage.setItem(REVIEW_VIEW_MODE_STORAGE_KEY, mode);
}

/** Shown unless it was explicitly turned off — the file list is the cheapest
 *  answer to "what is in this review", so it earns its width by default. */
export function readReviewFilesPaneOpen(storage: StateStorage): boolean {
  return storage.getItem(REVIEW_FILES_PANE_STORAGE_KEY) !== "hidden";
}

export function persistReviewFilesPaneOpen(storage: StateStorage, open: boolean): void {
  storage.setItem(REVIEW_FILES_PANE_STORAGE_KEY, open ? "shown" : "hidden");
}

const REVIEW_RICH_PREVIEW_STORAGE_KEY = "vide:review-rich-preview";

/** Off unless asked for. A review surface's default answer to "what happened"
 *  is the diff; rendering the document instead is a deliberate second look. */
export function readReviewRichPreview(storage: StateStorage): boolean {
  return storage.getItem(REVIEW_RICH_PREVIEW_STORAGE_KEY) === "on";
}

export function persistReviewRichPreview(storage: StateStorage, enabled: boolean): void {
  storage.setItem(REVIEW_RICH_PREVIEW_STORAGE_KEY, enabled ? "on" : "off");
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
