import { type EnvironmentId, type ThreadId, type TurnId } from "@vide/contracts";
import { type ChatChangedFilesLayout } from "@vide/contracts/settings";
import { memo, useCallback, useMemo, useState } from "react";
import { type TurnDiffFileChange } from "../../types";
import {
  buildTurnDiffTree,
  summarizeTurnDiffStats,
  type TurnDiffTreeNode,
} from "../../lib/turnDiffTree";
import { useTurnFileDiffs, type TurnFileDiffs } from "../../hooks/useTurnFileDiffs";
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  ChevronRightIcon,
  FileDiffIcon,
  FilesIcon,
  FolderIcon,
  FolderClosedIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { ChangedFileDiff } from "./ChangedFileDiff";
import { ChatGrow } from "./ChatGrow";
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel";
import { PierreEntryIcon } from "./PierreEntryIcon";
import { QUALIFIER_CLASS_NAME, QualifiedLabel } from "./QualifiedLabel";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ChangedFilesList } from "./ChangedFilesList";

const EMPTY_DIRECTORY_OVERRIDES: Record<string, boolean> = {};

/**
 * One row, whether it names a directory or a file: the same height, the same
 * radius, and one wash on hover so a long list reads as an even column.
 */
const TREE_ROW_CLASS =
  "group flex w-full items-center gap-1.5 rounded-(--radius) py-1 pr-3 text-left text-(length:--text-ui) transition-colors hover:bg-(--wash-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Counts stay monospaced and tabular so the column of stats does not jitter. */
const TREE_ROW_STAT_CLASS = "ml-auto shrink-0 font-mono text-(length:--text-caption) tabular-nums";

/** The row's own inset, then one even step per level of nesting. */
const TREE_ROW_INSET_PX = 8;
const TREE_ROW_INDENT_PX = 12;

/**
 * What a turn changed, as the last line of the turn.
 *
 * Not a card any more: a bordered box under the answer read as an attachment,
 * where this is the turn's own receipt and belongs on the same gutter as
 * everything else it said. One row states the count and the weight; opening it
 * lists the files; opening a file shows its diff right there.
 */
export interface ChangedFilesDiffTarget {
  readonly turnId: TurnId;
  readonly checkpointTurnCount: number;
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
}

export const ChangedFilesCard = memo(function ChangedFilesCard(props: {
  turnId: TurnId;
  files: ReadonlyArray<TurnDiffFileChange>;
  expanded: boolean;
  allDirectoriesExpanded: boolean;
  layout: ChatChangedFilesLayout;
  resolvedTheme: "light" | "dark";
  diffTarget: ChangedFilesDiffTarget;
  onExpandedChange: (expanded: boolean) => void;
  onToggleAllDirectories: () => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
}) {
  const {
    turnId,
    files,
    expanded,
    allDirectoriesExpanded,
    layout,
    resolvedTheme,
    diffTarget,
    onExpandedChange,
    onToggleAllDirectories,
    onOpenTurnDiff,
  } = props;
  const summaryStat = useMemo(() => summarizeTurnDiffStats(files), [files]);
  const [openPaths, setOpenPaths] = useState<ReadonlySet<string>>(() => new Set());
  const onTogglePath = useCallback((path: string) => {
    setOpenPaths((existing) => {
      const next = new Set(existing);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);
  const diffs = useTurnFileDiffs({
    turnId: diffTarget.turnId,
    checkpointTurnCount: diffTarget.checkpointTurnCount,
    environmentId: diffTarget.environmentId,
    threadId: diffTarget.threadId,
    enabled: expanded && openPaths.size > 0,
  });

  return (
    <div
      className="mt-3"
      data-changed-files-state={expanded ? "expanded" : "collapsed"}
      data-changed-files-turn={turnId}
    >
      <button
        aria-expanded={expanded}
        className="chat-turn-row cursor-pointer rounded-(--radius) py-0.5 pr-2 text-(length:--text-caption) transition-colors hover:bg-(--wash-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
        data-scroll-anchor-ignore
        onClick={() => onExpandedChange(!expanded)}
        type="button"
      >
        <span className="flex items-center justify-start">
          <FilesIcon aria-hidden="true" className="size-3.5 shrink-0 text-(--ink-tertiary)" />
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-left whitespace-nowrap text-(--ink-secondary)">
          <span>
            Changed {files.length} file{files.length === 1 ? "" : "s"}
          </span>
          {hasNonZeroStat(summaryStat) && (
            <DiffStatLabel
              additions={summaryStat.additions}
              className="text-(length:--text-caption)"
              deletions={summaryStat.deletions}
              layout="inline"
            />
          )}
        </span>
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 text-(--ink-tertiary) transition-transform",
            expanded && "rotate-90",
          )}
        />
      </button>
      <ChatGrow open={expanded}>
        <div className="chat-turn-body pt-1 pb-1">
          {layout === "tree" ? (
            <ChangedFilesTree
              key={`changed-files-tree:${turnId}`}
              allDirectoriesExpanded={allDirectoriesExpanded}
              diffs={diffs}
              files={files}
              openPaths={openPaths}
              onTogglePath={onTogglePath}
              resolvedTheme={resolvedTheme}
            />
          ) : (
            <ChangedFilesList
              diffs={diffs}
              files={files}
              layout={layout}
              openPaths={openPaths}
              onTogglePath={onTogglePath}
              resolvedTheme={resolvedTheme}
            />
          )}
          {/*
           * The panel is no longer where a file is read, so the button that opens
           * it sits after the list rather than in the head — it is the way out to
           * the full diff, not the way into this one.
           */}
          <div className="mt-1 flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label="Open diff"
                    data-scroll-anchor-ignore
                    onClick={() => onOpenTurnDiff(turnId, files[0]?.path)}
                    size="xs"
                    type="button"
                    variant="ghost"
                  />
                }
              >
                <FileDiffIcon className="size-3" />
                <span>Open diff</span>
              </TooltipTrigger>
              <TooltipPopup side="top">Open the full diff in the panel</TooltipPopup>
            </Tooltip>
            {/* Only the tree has folders to fold. */}
            {layout === "tree" ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={
                        allDirectoriesExpanded ? "Collapse all folders" : "Expand all folders"
                      }
                      data-scroll-anchor-ignore
                      onClick={onToggleAllDirectories}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    />
                  }
                >
                  {allDirectoriesExpanded ? (
                    <ChevronsDownUpIcon className="size-3" />
                  ) : (
                    <ChevronsUpDownIcon className="size-3" />
                  )}
                </TooltipTrigger>
                <TooltipPopup side="top">
                  {allDirectoriesExpanded ? "Collapse all folders" : "Expand all folders"}
                </TooltipPopup>
              </Tooltip>
            ) : null}
          </div>
        </div>
      </ChatGrow>
    </div>
  );
});

export const ChangedFilesTree = memo(function ChangedFilesTree(props: {
  files: ReadonlyArray<TurnDiffFileChange>;
  allDirectoriesExpanded: boolean;
  resolvedTheme: "light" | "dark";
  openPaths: ReadonlySet<string>;
  diffs: TurnFileDiffs;
  onTogglePath: (path: string) => void;
}) {
  const { files, allDirectoriesExpanded, diffs, openPaths, onTogglePath, resolvedTheme } = props;
  const treeNodes = useMemo(() => buildTurnDiffTree(files), [files]);
  const directoryPathsKey = useMemo(
    () => collectDirectoryPaths(treeNodes).join("\u0000"),
    [treeNodes],
  );
  const hasDirectoryNodes = directoryPathsKey.length > 0;
  const expansionStateKey = `${allDirectoriesExpanded ? "expanded" : "collapsed"}\u0000${directoryPathsKey}`;
  const [directoryExpansionState, setDirectoryExpansionState] = useState<{
    key: string;
    overrides: Record<string, boolean>;
  }>(() => ({
    key: expansionStateKey,
    overrides: {},
  }));
  const expandedDirectories =
    directoryExpansionState.key === expansionStateKey
      ? directoryExpansionState.overrides
      : EMPTY_DIRECTORY_OVERRIDES;

  const toggleDirectory = useCallback(
    (pathValue: string) => {
      setDirectoryExpansionState((current) => {
        const nextOverrides = current.key === expansionStateKey ? current.overrides : {};
        return {
          key: expansionStateKey,
          overrides: {
            ...nextOverrides,
            [pathValue]: !(nextOverrides[pathValue] ?? allDirectoriesExpanded),
          },
        };
      });
    },
    [allDirectoriesExpanded, expansionStateKey],
  );

  const renderTreeNode = (node: TurnDiffTreeNode, depth: number) => {
    const leftPadding = TREE_ROW_INSET_PX + depth * TREE_ROW_INDENT_PX;
    if (node.kind === "directory") {
      const isExpanded = expandedDirectories[node.path] ?? allDirectoriesExpanded;
      return (
        <div key={`dir:${node.path}`}>
          <button
            type="button"
            data-scroll-anchor-ignore
            className={TREE_ROW_CLASS}
            style={{ paddingLeft: `${leftPadding}px` }}
            onClick={() => toggleDirectory(node.path)}
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                isExpanded && "rotate-90",
              )}
            />
            {isExpanded ? (
              <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <FolderClosedIcon className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            {/* A directory only locates the files under it, so it recedes and
                the file rows below it keep the only primary ink in the tree. */}
            <span className={cn("truncate", QUALIFIER_CLASS_NAME)}>{node.name}</span>
            {hasNonZeroStat(node.stat) && (
              <span className={TREE_ROW_STAT_CLASS}>
                <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
              </span>
            )}
          </button>
          {isExpanded && (
            <div className="space-y-0.5">
              {node.children.map((childNode) => renderTreeNode(childNode, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    const open = openPaths.has(node.path);
    return (
      <div key={`file:${node.path}`}>
        <button
          aria-expanded={open}
          className={TREE_ROW_CLASS}
          data-scroll-anchor-ignore
          onClick={() => onTogglePath(node.path)}
          style={{ paddingLeft: `${String(leftPadding)}px` }}
          type="button"
        >
          {hasDirectoryNodes || depth > 0 ? (
            <span aria-hidden="true" className="size-3.5 shrink-0" />
          ) : null}
          <PierreEntryIcon
            pathValue={node.path}
            kind="file"
            theme={resolvedTheme}
            className="size-3.5 text-muted-foreground"
          />
          <span className="truncate">
            <QualifiedLabel name={node.name} />
          </span>
          {node.stat && (
            <span className={TREE_ROW_STAT_CLASS}>
              <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
            </span>
          )}
        </button>
        <ChatGrow open={open}>
          <ChangedFileDiff diffs={diffs} path={node.path} resolvedTheme={resolvedTheme} />
        </ChatGrow>
      </div>
    );
  };

  return <div className="space-y-0.5">{treeNodes.map((node) => renderTreeNode(node, 0))}</div>;
});

function collectDirectoryPaths(nodes: ReadonlyArray<TurnDiffTreeNode>): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "directory") continue;
    paths.push(node.path);
    paths.push(...collectDirectoryPaths(node.children));
  }
  return paths;
}
