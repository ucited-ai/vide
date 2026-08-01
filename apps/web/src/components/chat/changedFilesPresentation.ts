import { type TurnDiffFileChange } from "../../types";
import { summarizeTurnDiffStats } from "../../lib/turnDiffTree";

export const CHANGED_FILES_AUTO_EXPAND_FILE_LIMIT = 5;
export const CHANGED_FILES_AUTO_EXPAND_LINE_LIMIT = 200;

export function shouldAutoExpandChangedFiles(
  files: ReadonlyArray<TurnDiffFileChange>,
  isLatestTurn: boolean,
): boolean {
  if (!isLatestTurn || files.length > CHANGED_FILES_AUTO_EXPAND_FILE_LIMIT) {
    return false;
  }
  const stat = summarizeTurnDiffStats(files);
  return stat.additions + stat.deletions <= CHANGED_FILES_AUTO_EXPAND_LINE_LIMIT;
}
