import { type TurnId } from "@vide/contracts";
import { type ChatChangedFilesLayout } from "@vide/contracts/settings";
import { memo } from "react";

import { type TurnDiffFileChange } from "../../types";
import { cn } from "~/lib/utils";
import { chatChangedFilesLayoutStyle } from "./chatAppearance";
import { DiffStatLabel } from "./DiffStatLabel";
import { PierreEntryIcon } from "./PierreEntryIcon";
import { FilePathLabel } from "./QualifiedLabel";

/**
 * The flat ways to show the files a turn changed.
 *
 * One row component for all of them: what a layout changes is the classes it
 * is given, which live with the rest of the variant in `chatAppearance.ts`.
 * `tree` nests and keeps its own component.
 */

/** How many blocks the add/delete weight bar is drawn from. */
const WEIGHT_BLOCKS = 5;

const ROW_CLASS =
  "group flex w-full items-center gap-1.5 rounded-(--radius) text-left text-(length:--text-ui) transition-colors hover:bg-(--wash-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The shape of a file's change at a glance: how much of it was addition.
 *
 * Blocks rather than a proportional bar, because at this size a continuous bar
 * of two colours reads as one muddy stripe. A file with no counted lines gets
 * no bar at all instead of an arbitrary split.
 */
function WeightBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  if (total === 0) return null;

  const added = Math.max(1, Math.round((additions / total) * WEIGHT_BLOCKS));
  return (
    <span aria-hidden="true" className="flex shrink-0 gap-px">
      {Array.from({ length: WEIGHT_BLOCKS }, (_, index) => (
        <span
          key={index}
          className={cn(
            "size-1.5 rounded-[1px]",
            index < added ? "bg-success/70" : "bg-destructive/70",
          )}
        />
      ))}
    </span>
  );
}

export const ChangedFilesList = memo(function ChangedFilesList(props: {
  turnId: TurnId;
  files: ReadonlyArray<TurnDiffFileChange>;
  layout: Exclude<ChatChangedFilesLayout, "tree">;
  resolvedTheme: "light" | "dark";
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
}) {
  const style = chatChangedFilesLayoutStyle(props.layout);

  return (
    <div className={style.container} data-changed-files-layout={props.layout}>
      {props.files.map((file) => (
        <button
          key={file.path}
          type="button"
          title={file.path}
          className={cn(ROW_CLASS, style.row)}
          onClick={() => props.onOpenTurnDiff(props.turnId, file.path)}
        >
          <PierreEntryIcon
            pathValue={file.path}
            kind="file"
            theme={props.resolvedTheme}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 truncate">
            {/* Checkpoint paths are already workspace-relative, so there is no
                root to strip — but the cut and the inking still belong to the
                one helper every surface shows a file through. */}
            <FilePathLabel path={file.path} workspaceRoot={undefined} />
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-(length:--text-caption) tabular-nums">
            {style.showWeight ? (
              <WeightBar additions={file.additions} deletions={file.deletions} />
            ) : null}
            <DiffStatLabel additions={file.additions} deletions={file.deletions} />
          </span>
        </button>
      ))}
    </div>
  );
});
