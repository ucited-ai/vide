import { ChevronRightIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { buildTurnDiffTree, type TurnDiffTreeNode } from "~/lib/turnDiffTree";
import { cn } from "~/lib/utils";
import { DiffStatLabel } from "../chat/DiffStatLabel";
import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { PopupSearchField } from "../ui/popup-search-field";
import { ScrollSurface } from "../ui/scroll-surface";

/**
 * What happened to a file, reduced to the four outcomes a badge can carry. The
 * renamed case deliberately outranks "changed": a path that moved is the thing
 * you are least likely to have expected, so it is what the badge should say.
 */
export type ReviewFileChangeKind = "added" | "deleted" | "renamed" | "changed";

export interface ReviewTreeFile {
  readonly fileKey: string;
  readonly filePath: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changeKind: ReviewFileChangeKind;
}

/*
 * One glyph per outcome, and nothing for "changed".
 *
 * Every row already carries its additions and deletions in green and red, so a
 * bordered green "+" beside a green "+40" said the same thing twice — and it was
 * the doubling, not the hue, that made the list read as busy. What the counts
 * cannot say is that a file is new, gone, or moved, so those three keep a mark
 * and the ordinary case keeps none: the eye lands on the rows that are unusual
 * rather than on a badge per row. That leaves shape to carry the meaning, which
 * is also what pulls "renamed" and "changed" apart — they were both amber before
 * and looked identical.
 */
const KIND_GLYPH: Record<ReviewFileChangeKind, string | null> = {
  added: "+",
  deleted: "−",
  renamed: "→",
  changed: null,
};

/** The row's own inset, then one even step per level of nesting. */
const ROW_INSET_PX = 6;
const ROW_INDENT_PX = 12;

const ROW_CLASS =
  "flex min-h-(--popup-item-height) w-full cursor-default select-none items-center gap-1.5 rounded-(--popup-item-radius) pe-1.5 text-left text-(length:--text-ui) outline-none transition-colors hover:bg-(--wash-hover) focus-visible:ring-2 focus-visible:ring-ring";

interface FlatRow {
  readonly node: TurnDiffTreeNode;
  readonly depth: number;
}

/** Depth-first walk, skipping whatever sits under a collapsed directory. */
function flattenTree(
  nodes: readonly TurnDiffTreeNode[],
  collapsedPaths: ReadonlySet<string>,
  depth = 0,
): FlatRow[] {
  return nodes.flatMap((node) => {
    const row: FlatRow = { node, depth };
    if (node.kind !== "directory" || collapsedPaths.has(node.path)) return [row];
    return [row, ...flattenTree(node.children, collapsedPaths, depth + 1)];
  });
}

/**
 * The list of files in a review, as a tree beside the diffs.
 *
 * It names what the diff column cannot: the shape of the change. Scrolling a
 * flat run of patches tells you what each file did, never how many there are or
 * where they sit relative to each other — so this pane exists to answer "what
 * is in here" while the column beside it answers "what changed".
 */
export const ReviewFileTree = memo(function ReviewFileTree({
  files,
  activeFileKey,
  theme,
  onSelectFile,
}: {
  files: readonly ReviewTreeFile[];
  activeFileKey: string | null;
  theme: "light" | "dark";
  onSelectFile: (fileKey: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(() => new Set());

  const matchingFiles = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return files;
    return files.filter((file) => file.filePath.toLocaleLowerCase().includes(needle));
  }, [files, query]);

  const fileByPath = useMemo(
    () => new Map(matchingFiles.map((file) => [file.filePath, file])),
    [matchingFiles],
  );

  /*
   * Rebuilt from the filtered set rather than filtered after the fact, so a
   * directory whose children all dropped out disappears with them instead of
   * standing there empty. `buildTurnDiffTree` also folds single-child chains
   * into one row, which is what keeps a deep monorepo path from costing six
   * levels of indent to show one file.
   */
  const tree = useMemo(
    () =>
      buildTurnDiffTree(
        matchingFiles.map((file) => ({
          path: file.filePath,
          kind: file.changeKind,
          additions: file.additions,
          deletions: file.deletions,
        })),
      ),
    [matchingFiles],
  );
  const rows = useMemo(() => flattenTree(tree, collapsedPaths), [collapsedPaths, tree]);

  return (
    <div className="flex h-full min-h-0 w-(--review-tree-width) flex-col">
      <PopupSearchField
        placeholder="Filter files…"
        aria-label="Filter files"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {rows.length === 0 ? (
        <p className="px-(--popup-item-padding-inline) py-2 text-(length:--text-caption) text-muted-foreground">
          {files.length === 0 ? "No changed files." : "No matching file."}
        </p>
      ) : (
        <ScrollSurface className="flex-1 p-(--popup-padding)">
          {rows.map(({ node, depth }) => {
            const indent = { paddingInlineStart: `${ROW_INSET_PX + depth * ROW_INDENT_PX}px` };
            if (node.kind === "directory") {
              const collapsed = collapsedPaths.has(node.path);
              return (
                <button
                  key={`dir:${node.path}`}
                  type="button"
                  style={indent}
                  className={ROW_CLASS}
                  aria-expanded={!collapsed}
                  onClick={() =>
                    setCollapsedPaths((current) => {
                      const next = new Set(current);
                      if (!next.delete(node.path)) next.add(node.path);
                      return next;
                    })
                  }
                >
                  <ChevronRightIcon
                    aria-hidden
                    className={cn(
                      "size-3 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) ease-(--ease-out) motion-reduce:transition-none",
                      !collapsed && "rotate-90",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{node.name}</span>
                </button>
              );
            }
            const file = fileByPath.get(node.path);
            if (!file) return null;
            const glyph = KIND_GLYPH[file.changeKind];
            const active = file.fileKey === activeFileKey;
            return (
              <button
                key={`file:${file.fileKey}`}
                type="button"
                style={indent}
                title={file.filePath}
                aria-current={active}
                className={cn(ROW_CLASS, active && "bg-(--wash-selected)")}
                onClick={() => onSelectFile(file.fileKey)}
              >
                <PierreEntryIcon
                  pathValue={file.filePath}
                  kind="file"
                  theme={theme}
                  className="size-3.5 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate">{node.name}</span>
                <DiffStatLabel
                  additions={file.additions}
                  deletions={file.deletions}
                  layout="inline"
                  className="shrink-0 text-(length:--text-caption)"
                />
                <span className="flex w-(--review-kind-width) shrink-0 justify-center font-mono text-(length:--text-caption) text-(--review-kind-ink) leading-none">
                  {glyph === null ? null : (
                    <>
                      <span aria-hidden>{glyph}</span>
                      <span className="sr-only">{file.changeKind}</span>
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </ScrollSurface>
      )}
    </div>
  );
});
