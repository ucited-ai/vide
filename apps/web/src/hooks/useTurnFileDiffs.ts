import { type EnvironmentId, type ThreadId, type TurnId } from "@vide/contracts";
import type { FileDiffMetadata } from "@pierre/diffs/types";
import { useMemo } from "react";

import { useCheckpointDiff } from "../lib/checkpointDiffState";
import { getRenderablePatch } from "../lib/diffRendering";
import { useClientSettings } from "./useSettings";

/**
 * The diff a turn produced, split per file, for showing under the file's own row
 * in the transcript.
 *
 * One request for the whole turn rather than one per file: the server has a
 * single `git diff` between the turn's two checkpoints and nothing narrower, so
 * asking per file would be the same work repeated. It is only asked for at all
 * once a file has actually been opened — the parse and the highlighting are not
 * cheap, and most turns are read without anyone opening a diff.
 *
 * Keyed by the path the patch itself carries, stripped of its `a/`/`b/` prefix,
 * which is the same form the checkpoint's file list uses.
 */
export interface TurnFileDiffs {
  readonly byPath: ReadonlyMap<string, FileDiffMetadata>;
  readonly isPending: boolean;
  readonly error: string | null;
}

const NO_FILE_DIFFS: TurnFileDiffs = { byPath: new Map(), isPending: false, error: null };

export function useTurnFileDiffs(input: {
  readonly turnId: TurnId;
  readonly checkpointTurnCount: number;
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
  readonly enabled: boolean;
}): TurnFileDiffs {
  const ignoreWhitespace = useClientSettings((settings) => settings.diffIgnoreWhitespace);
  const enabled = input.enabled && input.checkpointTurnCount >= 1;
  const diff = useCheckpointDiff(
    {
      environmentId: input.environmentId,
      threadId: input.threadId,
      /* The turn is the step from the checkpoint before it to its own; a first
         turn has nothing before it, and 0 is what asks for the whole thread. */
      fromTurnCount: Math.max(0, input.checkpointTurnCount - 1),
      toTurnCount: input.checkpointTurnCount,
      ignoreWhitespace,
      cacheScope: `turn-inline:${input.turnId}`,
    },
    { enabled },
  );

  return useMemo(() => {
    if (!enabled) return NO_FILE_DIFFS;
    const patch = getRenderablePatch(diff.data?.diff, `turn-inline:${input.turnId}`);
    const byPath = new Map<string, FileDiffMetadata>();
    if (patch?.kind === "files") {
      for (const file of patch.files) {
        byPath.set(stripDiffPathPrefix(file.name ?? file.prevName ?? ""), file);
      }
    }
    return { byPath, isPending: diff.isPending, error: diff.error };
  }, [diff.data?.diff, diff.error, diff.isPending, enabled, input.turnId]);
}

function stripDiffPathPrefix(path: string): string {
  return path.startsWith("a/") || path.startsWith("b/") ? path.slice(2) : path;
}
