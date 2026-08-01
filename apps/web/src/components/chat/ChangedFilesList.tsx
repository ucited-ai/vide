import { type TurnId } from "@vide/contracts";
import { type ChatChangedFilesLayout } from "@vide/contracts/settings";
import { memo } from "react";

import { type TurnDiffFileChange } from "../../types";
import { cn } from "~/lib/utils";
import { DiffStatLabel } from "./DiffStatLabel";
import { PierreEntryIcon } from "./PierreEntryIcon";
import { QualifiedLabel } from "./QualifiedLabel";

/**
 * The flat ways to show the files a turn changed.
 *
 * `tree` is the odd one out — it nests, and keeps its own component. Everything
 * else is the same row repeated, so the variants here differ only in how dense
 * that row is, whether it carries a weight bar, and how the rows are arranged.
 * That is deliberate: a layout you can choose should change how a list reads,
 * not what it says, and one row component means the five cannot drift apart.
 */

/** How many blocks the add/delete weight bar is drawn from. */
const WEIGHT_BLOCKS = 5;

interface LayoutStyle {
  /** The element the rows sit in. */
  readonly container: string;
  /** Each row. */
  readonly row: string;
  /** Whether the row carries the proportional add/delete bar. */
  readonly showWeight: boolean;
}

const LAYOUT_STYLES: Readonly<Record<Exclude<ChatChangedFilesLayout, "tree">, LayoutStyle>> = {
  rows: {
    container: "space-y-px",
    row: "px-2 py-1",
    showWeight: false,
  },
  stat: {
    container: "space-y-px",
    row: "px-2 py-1",
    showWeight: true,
  },
  cards: {
    container: "space-y-1.5",
    row: "rounded-(--radius) border border-border/70 px-2 py-1.5",
    showWeight: false,
  },
  // Two columns of the same row. Wide changes stop running off the bottom of
  // the card; a narrow transcript falls back to one column rather than
  // squeezing a path into half of nothing.
  split: {
    container: "grid grid-cols-1 gap-x-3 gap-y-px sm:grid-cols-2",
    row: "px-2 py-1",
    showWeight: false,
  },
  strip: {
    container: "",
    row: "px-2 py-0.5 text-(length:--text-caption)",
    showWeight: false,
  },
};

const ROW_CLASS =
  "group flex w-full items-center gap-1.5 rounded-(--radius) text-left text-(length:--text-ui) transition-colors hover:bg-(--wash-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Where a path stops locating the file and starts naming it. */
function splitPath(pathValue: string): { directory: string; name: string } {
  const normalized = pathValue.replaceAll("\\", "/");
  const cut = normalized.lastIndexOf("/") + 1;
  return { directory: normalized.slice(0, cut), name: normalized.slice(cut) };
}

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
  const style = LAYOUT_STYLES[props.layout];

  return (
    <div className={style.container} data-changed-files-layout={props.layout}>
      {props.files.map((file) => {
        const { directory, name } = splitPath(file.path);
        return (
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
              <QualifiedLabel lead={directory} name={name} />
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-(length:--text-caption) tabular-nums">
              {style.showWeight ? (
                <WeightBar additions={file.additions} deletions={file.deletions} />
              ) : null}
              <DiffStatLabel additions={file.additions} deletions={file.deletions} />
            </span>
          </button>
        );
      })}
    </div>
  );
});
