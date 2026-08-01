import type { FileDiffMetadata } from "@pierre/diffs/types";

/**
 * Whether a file can be laid out inline in the review diff.
 *
 * The panel renders with `overflow: "wrap"` by default, and the virtualiser it
 * sits on estimates a file's height as `lineCount × lineHeight` — one source
 * line, one row. A minified payload breaks that assumption completely: it is a
 * single line of several hundred kilobytes, so the virtualiser reserves ~20px
 * while the DOM lays out one element tens of thousands of pixels tall. Nothing
 * can virtualise *inside* a line, so the scroll range and the content stop
 * having anything to do with each other and the panel stops responding.
 *
 * The budget is a line length, not a file size: a 5MB file of ordinary lines is
 * fine, a 200KB file that is one line is not.
 */

/**
 * Characters in one line past which we stop treating a file as ordinary code.
 *
 * Deliberately the same number as `@pierre/diffs`'s own `tokenizeMaxLineLength`
 * default: past it the library already declines to tokenise the line, so it is
 * the point at which upstream itself stops calling this code rather than data.
 * Borrowing it means one threshold to reason about instead of two.
 */
export const INLINE_LINE_LENGTH_BUDGET = 1_000;

/**
 * Longest line on either side of the diff.
 *
 * `additionLines` and `deletionLines` are already in memory and a string's
 * `length` is O(1), so this costs one pass over the line array — cheap even
 * when a "line" is the whole payload.
 */
export function longestDiffLineLength(fileDiff: FileDiffMetadata): number {
  let longest = 0;
  for (const line of fileDiff.additionLines) {
    if (line.length > longest) longest = line.length;
  }
  for (const line of fileDiff.deletionLines) {
    if (line.length > longest) longest = line.length;
  }
  return longest;
}

/**
 * True when the file has a line long enough that rendering it inline would put
 * the virtualiser's height model and the DOM into open disagreement.
 */
export function exceedsInlineLineBudget(
  fileDiff: FileDiffMetadata,
  budget: number = INLINE_LINE_LENGTH_BUDGET,
): boolean {
  return longestDiffLineLength(fileDiff) > budget;
}
