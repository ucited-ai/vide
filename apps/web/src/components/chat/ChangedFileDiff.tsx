import { FileDiff } from "@pierre/diffs/react";

import { resolveDiffThemeName } from "../../lib/diffRendering";
import { type TurnFileDiffs } from "../../hooks/useTurnFileDiffs";

/**
 * A changed file's diff, in the transcript, under the file it belongs to.
 *
 * Clicking a file used to throw the reader into the git panel — a different
 * surface, a different scroll position, and the turn they were reading left
 * behind. The diff is part of what the turn said, so it opens where it was
 * mentioned. `FileDiff` was already being rendered inline for review comments, so
 * it makes no assumption about a panel: no fixed width, no scroller of its own.
 */
export function ChangedFileDiff({
  path,
  diffs,
  resolvedTheme,
}: {
  readonly path: string;
  readonly diffs: TurnFileDiffs;
  readonly resolvedTheme: "light" | "dark";
}) {
  const fileDiff = diffs.byPath.get(path);

  if (!fileDiff) {
    return (
      <p className="px-2 py-1.5 text-(length:--text-caption) text-(--ink-tertiary)">
        {diffs.isPending
          ? "Loading the diff…"
          : (diffs.error ??
            "This change is no longer in the working tree — open the full diff to see it.")}
      </p>
    );
  }

  return (
    <div className="py-1">
      <FileDiff
        fileDiff={fileDiff}
        options={{
          collapsed: false,
          diffStyle: "unified",
          theme: resolveDiffThemeName(resolvedTheme),
        }}
      />
    </div>
  );
}
