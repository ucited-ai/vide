import { useAtomValue } from "@effect/atom-react";
import { useParams } from "@tanstack/react-router";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@vide/client-runtime/state/runtime";
import { safeErrorLogAttributes } from "@vide/client-runtime/errors";
import type { ScopedThreadRef, TurnId } from "@vide/contracts";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  Columns2Icon,
  CopyIcon,
  EllipsisIcon,
  ListTreeIcon,
  PilcrowIcon,
  RefreshCwIcon,
  Rows3Icon,
  TextWrapIcon,
} from "lucide-react";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOpenInPreferredEditor } from "../editorPreferences";
import { type DraftId } from "../composerDraftStore";
import { openDiffFilePrimaryAction } from "../diffFileActions";
import { useCheckpointDiff } from "~/lib/checkpointDiffState";
import { cn } from "~/lib/utils";
import { selectThreadDiffPanelSelection, useDiffPanelStore } from "../diffPanelStore";
import { useTheme } from "../hooks/useTheme";
import {
  buildFileDiffRenderKey,
  getDiffCollapseIconClassName,
  getDiffLineStat,
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "../lib/diffRendering";
import { areAllDiffFilesCollapsed, toggleAllDiffFiles } from "../lib/diffCollapse";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { useProject, useThread } from "../state/entities";
import { resolveThreadRouteRef } from "../threadRoutes";
import { useClientSettings, useUpdateClientSettings } from "../hooks/useSettings";
import { formatShortTimestamp } from "../timestampFormat";
import { DiffStatLabel } from "./chat/DiffStatLabel";
import { AnnotatableCodeView, type AnnotatableCodeViewHandle } from "./diffs/AnnotatableCodeView";
import { Button } from "./ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "./ui/combobox";
import { Toggle, ToggleGroup } from "./ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/menu";
import { PopupSearchField } from "./ui/popup-search-field";
import { Skeleton } from "./ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { reviewEnvironment } from "../state/review";
import { vcsEnvironment } from "../state/vcs";
import { buildBaseRefChoices, filterBaseRefChoices } from "../lib/baseRefChoices";
import { resolveStorage } from "../lib/storage";
import {
  buildGitApplyCommand,
  persistReviewViewMode,
  readReviewViewMode,
  type ReviewViewMode,
} from "./reviewSurface";

type DiffThemeType = "light" | "dark";

interface CollapsedDiffFilesState {
  readonly scopeKey: string | null;
  readonly fileKeys: ReadonlySet<string>;
}

const EMPTY_COLLAPSED_DIFF_FILE_KEYS: ReadonlySet<string> = new Set();

const DIFF_PANEL_UNSAFE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-header-font-family: var(--font-sans) !important;
  --diffs-font-family: var(--font-mono) !important;
  --diffs-font-size: var(--code-font-size);
  --diffs-line-height: var(--code-line-height);
  --diffs-bg: var(--panel-diff-code-surface) !important;
  --diffs-light-bg: var(--panel-diff-code-surface) !important;
  --diffs-dark-bg: var(--panel-diff-code-surface) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  --diffs-bg-context-override: var(--panel-diff-context-surface);
  --diffs-bg-hover-override: var(--panel-diff-hover-surface);
  --diffs-bg-separator-override: var(--panel-diff-separator-surface);
  --diffs-bg-buffer-override: var(--panel-diff-buffer-surface);

  --diffs-bg-addition-override: var(--panel-diff-addition-surface);
  --diffs-bg-addition-number-override: var(--panel-diff-addition-number-surface);
  --diffs-bg-addition-hover-override: var(--panel-diff-addition-hover-surface);
  --diffs-bg-addition-emphasis-override: var(--panel-diff-addition-emphasis-surface);

  --diffs-bg-deletion-override: var(--panel-diff-deletion-surface);
  --diffs-bg-deletion-number-override: var(--panel-diff-deletion-number-surface);
  --diffs-bg-deletion-hover-override: var(--panel-diff-deletion-hover-surface);
  --diffs-bg-deletion-emphasis-override: var(--panel-diff-deletion-emphasis-surface);

  background-color: var(--diffs-bg) !important;
}

[data-file-info] {
  background-color: var(--panel-diff-header-surface) !important;
  border-block-color: var(--border) !important;
  color: var(--foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: var(--panel-diff-header-surface) !important;
  border-bottom: var(--panel-hairline) solid var(--border) !important;
  align-items: center !important;
  font-family: var(--font-sans) !important;
  font-size: var(--text-caption) !important;
  line-height: 1 !important;
  min-height: var(--review-file-row-height) !important;
  padding-block: 0 !important;
  cursor: pointer;
}

[data-diffs-header] [data-header-content] {
  align-items: center !important;
  line-height: 1 !important;
  min-width: 0;
}

[data-diffs-header] [data-metadata] {
  align-items: center !important;
  line-height: 1 !important;
  font-variant-numeric: tabular-nums;
}

[data-diffs-header] [data-additions-count],
[data-diffs-header] [data-deletions-count] {
  font-family: var(--font-mono) !important;
  font-size: var(--text-caption) !important;
  font-variant-numeric: tabular-nums;
  line-height: 1 !important;
}

[data-diffs-header] [data-change-icon],
[data-diffs-header] [data-rename-icon] {
  display: block;
  flex-shrink: 0;
}

[data-title] {
  min-width: 0;
  overflow: hidden;
  direction: rtl;
  text-align: left;
  text-overflow: ellipsis;
  unicode-bidi: plaintext;
  white-space: nowrap;
  cursor: pointer;
  transition:
    color var(--duration-fast) var(--ease-out),
    text-decoration-color var(--duration-fast) var(--ease-out);
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: var(--panel-diff-title-underline-offset);
  font-family: var(--font-sans) !important;
}

[data-title]:hover {
  color: var(--panel-diff-title-hover-ink) !important;
  text-decoration-color: currentColor;
}
`;

function ReviewToolbarTooltip(props: { label: string; trigger: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.trigger} />
      <TooltipPopup side="top">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

function DiffPanelLoadingState(props: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-(--popup-padding)">
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden border border-(--panel-loading-edge) bg-(--panel-loading-surface)"
        role="status"
        aria-live="polite"
        aria-label={props.label}
      >
        <div className="flex min-h-(--review-file-row-height) items-center gap-(--popup-item-gap) border-b border-(--panel-loading-divider) px-(--popup-item-padding-inline)">
          <Skeleton className="h-(--review-loading-line-height) w-(--review-loading-title-width) rounded-full" />
          <Skeleton className="ml-auto h-(--review-loading-line-height) w-(--review-loading-stat-width) rounded-full" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-(--popup-padding) px-(--popup-item-padding-inline) py-(--popup-padding)">
          <div className="space-y-(--popup-padding)">
            <Skeleton className="h-(--review-loading-line-height) w-full rounded-full" />
            <Skeleton className="h-(--review-loading-line-height) w-full rounded-full" />
            <Skeleton className="h-(--review-loading-line-height) w-10/12 rounded-full" />
            <Skeleton className="h-(--review-loading-line-height) w-11/12 rounded-full" />
            <Skeleton className="h-(--review-loading-line-height) w-9/12 rounded-full" />
          </div>
          <span className="sr-only">{props.label}</span>
        </div>
      </div>
    </div>
  );
}

interface DiffPanelProps {
  composerDraftTarget: ScopedThreadRef | DraftId;
  initialGitScope: "branch" | "unstaged";
}

export { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";

export default function DiffPanel({
  composerDraftTarget,
  initialGitScope: initialGitScopeProp,
}: DiffPanelProps) {
  const { resolvedTheme } = useTheme();
  const settings = useClientSettings();
  const updateClientSettings = useUpdateClientSettings();
  const preferenceStorage = useMemo(
    () => resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
    [],
  );
  const [initialGitScope] = useState(initialGitScopeProp);
  const [diffRenderMode, setDiffRenderMode] = useState<ReviewViewMode>(() =>
    readReviewViewMode(preferenceStorage),
  );
  const [wordDiffs, setWordDiffs] = useState(false);
  const [dontLoadFullFiles, setDontLoadFullFiles] = useState(true);
  const [baseRefQuery, setBaseRefQuery] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const [jumpTargetFileKey, setJumpTargetFileKey] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [collapsedDiffFiles, setCollapsedDiffFiles] = useState<CollapsedDiffFilesState>(() => ({
    scopeKey: null,
    fileKeys: EMPTY_COLLAPSED_DIFF_FILE_KEYS,
  }));
  const codeViewRef = useRef<AnnotatableCodeViewHandle>(null);

  useEffect(() => {
    persistReviewViewMode(preferenceStorage, diffRenderMode);
  }, [diffRenderMode, preferenceStorage]);

  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const activeThreadId = routeThreadRef?.threadId ?? null;
  const activeThread = useThread(routeThreadRef);
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useProject(
    activeThread && activeProjectId
      ? {
          environmentId: activeThread.environmentId,
          projectId: activeProjectId,
        }
      : null,
  );
  const activeCwd = activeThread?.worktreePath ?? activeProject?.workspaceRoot;
  const serverConfig = useAtomValue(
    serverEnvironment.configValueAtom(activeThread?.environmentId ?? null),
  );
  const openInPreferredEditor = useOpenInPreferredEditor(
    activeThread?.environmentId ?? null,
    serverConfig?.availableEditors ?? [],
  );
  const gitStatusQuery = useEnvironmentQuery(
    activeThread !== null && activeThread !== undefined && activeCwd != null
      ? vcsEnvironment.status({
          environmentId: activeThread.environmentId,
          input: { cwd: activeCwd },
        })
      : null,
  );
  const diffSelection = useDiffPanelStore((state) =>
    selectThreadDiffPanelSelection(
      state.byThreadKey,
      routeThreadRef,
      initialGitScope === "unstaged",
    ),
  );
  const isGitRepo = gitStatusQuery.data?.isRepo ?? true;
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const orderedTurnDiffSummaries = useMemo(
    () =>
      [...turnDiffSummaries].toSorted((left, right) => {
        const leftTurnCount =
          left.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[left.turnId] ?? 0;
        const rightTurnCount =
          right.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[right.turnId] ?? 0;
        if (leftTurnCount !== rightTurnCount) {
          return rightTurnCount - leftTurnCount;
        }
        return right.completedAt.localeCompare(left.completedAt);
      }),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaries],
  );

  useEffect(() => {
    if (!routeThreadRef || diffSelection.kind !== "turn") return;
    useDiffPanelStore.getState().reconcileTurnSelection(
      routeThreadRef,
      orderedTurnDiffSummaries.map((summary) => summary.turnId),
    );
  }, [diffSelection, orderedTurnDiffSummaries, routeThreadRef]);

  const selectedTurnId = diffSelection.kind === "turn" ? diffSelection.turnId : null;
  const selectedGitScope = diffSelection.kind === "unstaged" ? "unstaged" : "branch";
  const selectedBaseRef = diffSelection.kind === "branch" ? diffSelection.baseRef : null;
  const selectedFilePath = diffSelection.kind === "turn" ? diffSelection.filePath : null;
  const selectedFileRevealRequestId =
    diffSelection.kind === "turn" ? diffSelection.revealRequestId : 0;
  const selectedTurn =
    selectedTurnId === null
      ? undefined
      : (orderedTurnDiffSummaries.find((summary) => summary.turnId === selectedTurnId) ??
        orderedTurnDiffSummaries[0]);
  const selectedCheckpointTurnCount =
    selectedTurn &&
    (selectedTurn.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[selectedTurn.turnId]);
  const latestTurn = orderedTurnDiffSummaries[0];
  const selectedScopeLabel =
    selectedTurnId === null
      ? selectedGitScope === "unstaged"
        ? "Working tree"
        : "Branch changes"
      : selectedTurn?.turnId === latestTurn?.turnId
        ? "Latest turn"
        : `Turn ${selectedCheckpointTurnCount ?? "?"}`;
  const reviewSectionId = selectedTurn ? `turn:${selectedTurn.turnId}` : selectedGitScope;
  const collapseScopeKey = routeThreadRef
    ? `${routeThreadRef.environmentId}:${routeThreadRef.threadId}:${reviewSectionId}`
    : null;
  const collapsedDiffFileKeys =
    collapsedDiffFiles.scopeKey === collapseScopeKey
      ? collapsedDiffFiles.fileKeys
      : EMPTY_COLLAPSED_DIFF_FILE_KEYS;
  const reviewSectionTitle = selectedTurn
    ? `Turn ${selectedCheckpointTurnCount ?? "?"}`
    : selectedGitScope === "unstaged"
      ? "Working tree"
      : "Branch changes";
  const selectedCheckpointRange = useMemo(
    () =>
      typeof selectedCheckpointTurnCount === "number"
        ? {
            fromTurnCount: Math.max(0, selectedCheckpointTurnCount - 1),
            toTurnCount: selectedCheckpointTurnCount,
          }
        : null,
    [selectedCheckpointTurnCount],
  );
  const activeCheckpointDiff = useCheckpointDiff(
    {
      environmentId: activeThread?.environmentId ?? null,
      threadId: activeThreadId,
      fromTurnCount: selectedCheckpointRange?.fromTurnCount ?? null,
      toTurnCount: selectedCheckpointRange?.toTurnCount ?? null,
      ignoreWhitespace: settings.diffIgnoreWhitespace,
      cacheScope: selectedTurn ? `turn:${selectedTurn.turnId}:refresh:${refreshVersion}` : null,
    },
    { enabled: isGitRepo && selectedTurn !== undefined },
  );
  const primaryBranchDiffPreview = useEnvironmentQuery(
    selectedTurnId === null && activeThread && activeCwd
      ? reviewEnvironment.diffPreview({
          environmentId: activeThread.environmentId,
          input: {
            cwd: activeCwd,
            ...(selectedBaseRef ? { baseRef: selectedBaseRef } : {}),
            ignoreWhitespace: settings.diffIgnoreWhitespace,
          },
        })
      : null,
  );
  const shouldRetryBranchDiffAtEnvironmentCwd =
    selectedTurnId === null &&
    primaryBranchDiffPreview.error?.includes("configured workspace root") === true &&
    serverConfig?.cwd !== undefined &&
    serverConfig.cwd !== activeCwd;
  const fallbackBranchDiffPreview = useEnvironmentQuery(
    shouldRetryBranchDiffAtEnvironmentCwd && activeThread && serverConfig
      ? reviewEnvironment.diffPreview({
          environmentId: activeThread.environmentId,
          input: {
            cwd: serverConfig.cwd,
            ...(selectedBaseRef ? { baseRef: selectedBaseRef } : {}),
            ignoreWhitespace: settings.diffIgnoreWhitespace,
          },
        })
      : null,
  );
  const branchDiffPreview = shouldRetryBranchDiffAtEnvironmentCwd
    ? fallbackBranchDiffPreview
    : primaryBranchDiffPreview;
  const selectedGitSource = branchDiffPreview.data?.sources.find(
    (source) => source.kind === (selectedGitScope === "unstaged" ? "working-tree" : "branch-range"),
  );
  const localBranchRefs = useEnvironmentQuery(
    selectedTurnId === null &&
      selectedGitScope === "branch" &&
      activeThread &&
      branchDiffPreview.data?.cwd
      ? vcsEnvironment.listRefs({
          environmentId: activeThread.environmentId,
          input: {
            cwd: branchDiffPreview.data.cwd,
            includeMatchingRemoteRefs: true,
            refKind: "local",
            limit: 100,
          },
        })
      : null,
  );
  const remoteBranchRefs = useEnvironmentQuery(
    selectedTurnId === null &&
      selectedGitScope === "branch" &&
      activeThread &&
      branchDiffPreview.data?.cwd
      ? vcsEnvironment.listRefs({
          environmentId: activeThread.environmentId,
          input: {
            cwd: branchDiffPreview.data.cwd,
            includeMatchingRemoteRefs: true,
            refKind: "remote",
            limit: 100,
          },
        })
      : null,
  );
  const baseRefChoices = buildBaseRefChoices(
    localBranchRefs.data?.refs.filter((ref) => ref.name !== selectedGitSource?.headRef) ?? [],
    remoteBranchRefs.data?.refs ?? [],
  );
  const matchingBaseRefChoices = filterBaseRefChoices(baseRefChoices, baseRefQuery);
  const valueForBaseRefChoice = (choice: (typeof baseRefChoices)[number]) =>
    selectedBaseRef && selectedBaseRef === choice.remote?.name
      ? selectedBaseRef
      : (choice.local?.name ?? choice.remote?.name ?? choice.id);
  const gitDiff = selectedGitSource?.diff;

  const selectedPatch = selectedTurn ? activeCheckpointDiff.data?.diff : gitDiff;
  const isSelectedPatchTruncated = !selectedTurn && selectedGitSource?.truncated === true;
  const isLoadingSelectedPatch = selectedTurn
    ? activeCheckpointDiff.isPending
    : branchDiffPreview.isPending;
  const selectedPatchError = selectedTurn ? activeCheckpointDiff.error : branchDiffPreview.error;
  const hasResolvedPatch = typeof selectedPatch === "string";
  const hasNoNetChanges = hasResolvedPatch && selectedPatch.trim().length === 0;
  const renderablePatch = useMemo(
    () =>
      getRenderablePatch(selectedPatch, `diff-panel:${resolvedTheme}`, {
        compactPartialHunkOffsets: selectedTurnId === null,
      }),
    [resolvedTheme, selectedPatch, selectedTurnId],
  );
  const renderableFiles = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== "files") {
      return [];
    }
    return renderablePatch.files.toSorted((left, right) =>
      resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [renderablePatch]);
  const codeViewFiles = useMemo(
    () =>
      renderableFiles.map((fileDiff) => {
        const fileKey = buildFileDiffRenderKey(fileDiff);
        return {
          fileDiff,
          filePath: resolveFileDiffPath(fileDiff),
          fileKey,
          collapsed: collapsedDiffFileKeys.has(fileKey),
        };
      }),
    [collapsedDiffFileKeys, renderableFiles],
  );
  const diffFileKeys = useMemo(() => codeViewFiles.map((file) => file.fileKey), [codeViewFiles]);
  const allDiffFilesCollapsed = areAllDiffFilesCollapsed(diffFileKeys, collapsedDiffFileKeys);
  const diffLineStat = useMemo(() => getDiffLineStat(renderableFiles), [renderableFiles]);
  const matchingCodeViewFiles = useMemo(() => {
    const query = fileQuery.trim().toLocaleLowerCase();
    if (!query) return codeViewFiles;
    return codeViewFiles.filter((file) => file.filePath.toLocaleLowerCase().includes(query));
  }, [codeViewFiles, fileQuery]);

  useEffect(() => {
    if (!selectedFilePath) return;
    const file = codeViewFiles.find((candidate) => candidate.filePath === selectedFilePath);
    if (!file) return;
    codeViewRef.current?.scrollTo({ type: "item", id: file.fileKey, align: "start" });
  }, [codeViewFiles, selectedFilePath, selectedFileRevealRequestId]);

  useEffect(() => {
    if (!jumpTargetFileKey) return;
    const file = codeViewFiles.find((candidate) => candidate.fileKey === jumpTargetFileKey);
    if (!file || file.collapsed) return;
    codeViewRef.current?.scrollTo({ type: "item", id: file.fileKey, align: "start" });
    setJumpTargetFileKey(null);
  }, [codeViewFiles, jumpTargetFileKey]);

  const openDiffFile = useCallback(
    (filePath: string) => {
      openDiffFilePrimaryAction({
        threadRef: routeThreadRef,
        filePath,
        activeCwd,
        openInEditor: (targetPath) => {
          void (async () => {
            const result = await openInPreferredEditor(targetPath);
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              console.warn("Failed to open diff file in editor.", {
                operation: "open-diff-file",
                ...(routeThreadRef
                  ? {
                      environmentId: routeThreadRef.environmentId,
                      threadId: routeThreadRef.threadId,
                    }
                  : {}),
                ...safeErrorLogAttributes(squashAtomCommandFailure(result)),
              });
            }
          })();
        },
      });
    },
    [activeCwd, openInPreferredEditor, routeThreadRef],
  );
  const toggleDiffFileCollapsed = useCallback(
    (fileKey: string) => {
      setCollapsedDiffFiles((current) => {
        const next = new Set(current.scopeKey === collapseScopeKey ? current.fileKeys : []);
        if (next.has(fileKey)) {
          next.delete(fileKey);
        } else {
          next.add(fileKey);
        }
        return { scopeKey: collapseScopeKey, fileKeys: next };
      });
    },
    [collapseScopeKey],
  );

  const toggleDiffFileCollapse = useCallback(() => {
    setCollapsedDiffFiles((current) => {
      const currentKeys =
        current.scopeKey === collapseScopeKey ? current.fileKeys : EMPTY_COLLAPSED_DIFF_FILE_KEYS;

      return {
        scopeKey: collapseScopeKey,
        fileKeys: toggleAllDiffFiles(diffFileKeys, currentKeys),
      };
    });
  }, [collapseScopeKey, diffFileKeys]);

  const jumpToDiffFile = useCallback(
    (fileKey: string) => {
      setCollapsedDiffFiles((current) => {
        const next = new Set(
          current.scopeKey === collapseScopeKey ? current.fileKeys : EMPTY_COLLAPSED_DIFF_FILE_KEYS,
        );
        next.delete(fileKey);
        return { scopeKey: collapseScopeKey, fileKeys: next };
      });
      setJumpTargetFileKey(fileKey);
      setFileQuery("");
    },
    [collapseScopeKey],
  );

  const refreshDiff = useCallback(() => {
    setRefreshVersion((version) => version + 1);
    gitStatusQuery.refresh();
    branchDiffPreview.refresh();
    localBranchRefs.refresh();
    remoteBranchRefs.refresh();
  }, [branchDiffPreview, gitStatusQuery, localBranchRefs, remoteBranchRefs]);

  const gitApplyCommand =
    selectedTurnId === null && selectedGitScope === "branch"
      ? buildGitApplyCommand({
          baseRef: selectedGitSource?.baseRef ?? null,
          headRef: selectedGitSource?.headRef ?? "HEAD",
        })
      : null;

  const copyGitApplyCommand = useCallback(() => {
    if (gitApplyCommand === null) return;
    void navigator.clipboard?.writeText(gitApplyCommand);
  }, [gitApplyCommand]);

  const selectTurn = (turnId: TurnId) => {
    if (!routeThreadRef) return;
    useDiffPanelStore.getState().selectTurn(routeThreadRef, turnId);
  };
  const selectGitScope = (scope: "branch" | "unstaged") => {
    if (!routeThreadRef) return;
    useDiffPanelStore.getState().selectGitScope(routeThreadRef, scope);
  };
  const selectBranchBaseRef = (baseRef: string | null) => {
    if (!routeThreadRef) return;
    useDiffPanelStore.getState().selectBranchBaseRef(routeThreadRef, baseRef);
  };
  const rangeHeadRef = selectedGitSource?.headRef ?? "HEAD";
  const rangeBaseRef = selectedGitSource?.baseRef ?? "Automatic";
  const isBranchRange = selectedTurnId === null && selectedGitScope === "branch";
  const rangeControlLabel = isBranchRange
    ? `${rangeHeadRef} → ${rangeBaseRef}`
    : selectedScopeLabel;

  const headerRow = (
    <>
      <div className="surface-subheader flex min-w-0 items-center gap-(--popup-item-gap) border-b border-(--panel-edge-muted) px-(--popup-item-padding-inline)">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex min-w-0 flex-1 items-center gap-(--popup-item-gap) rounded-(--popup-item-radius) px-(--popup-item-padding-inline) text-(length:--text-ui) text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Review range: ${rangeControlLabel}`}
            title={rangeControlLabel}
          >
            {isBranchRange ? (
              <>
                <span className="min-w-0 flex-1 truncate text-left">{rangeHeadRef}</span>
                <ArrowRightIcon className="size-(--review-icon-size) shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate text-left">{rangeBaseRef}</span>
              </>
            ) : (
              <span className="min-w-0 flex-1 truncate text-left">{selectedScopeLabel}</span>
            )}
            <ChevronDownIcon className="size-(--review-icon-size) shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-(--review-range-menu-width)">
            <DropdownMenuItem
              className={
                selectedTurnId === null && selectedGitScope === "unstaged"
                  ? "bg-(--wash-selected)"
                  : undefined
              }
              onClick={() => selectGitScope("unstaged")}
            >
              <span>Working tree</span>
            </DropdownMenuItem>
            <DropdownMenuSub onOpenChange={(open) => !open && setBaseRefQuery("")}>
              <DropdownMenuSubTrigger
                className={
                  selectedTurnId === null && selectedGitScope === "branch"
                    ? "bg-(--wash-selected)"
                    : undefined
                }
              >
                Branch changes
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-(--review-range-menu-width) overflow-hidden p-0">
                <PopupSearchField
                  autoFocus
                  placeholder="Search refs..."
                  value={baseRefQuery}
                  onChange={(event) => setBaseRefQuery(event.target.value)}
                />
                <DropdownMenuItem
                  className="mx-(--popup-padding) mt-(--popup-padding)"
                  onClick={() => {
                    selectGitScope("branch");
                    selectBranchBaseRef(null);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">Automatic</span>
                  {selectedBaseRef === null ? <CheckIcon aria-hidden="true" /> : null}
                </DropdownMenuItem>
                {matchingBaseRefChoices.map((choice) => {
                  const ref = valueForBaseRefChoice(choice);
                  return (
                    <DropdownMenuItem
                      key={choice.id}
                      className="mx-(--popup-padding)"
                      onClick={() => {
                        selectGitScope("branch");
                        selectBranchBaseRef(ref);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{ref}</span>
                      {selectedBaseRef === ref ? <CheckIcon aria-hidden="true" /> : null}
                    </DropdownMenuItem>
                  );
                })}
                {matchingBaseRefChoices.length === 0 ? (
                  <DropdownMenuItem className="mx-(--popup-padding)" disabled>
                    No matching refs.
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              className={
                selectedTurnId !== null && selectedTurn?.turnId === latestTurn?.turnId
                  ? "bg-(--wash-selected)"
                  : undefined
              }
              onClick={() => {
                if (latestTurn) selectTurn(latestTurn.turnId);
              }}
            >
              <span>Latest turn</span>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Turn</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64">
                {orderedTurnDiffSummaries.map((summary) => {
                  const turnCount =
                    summary.checkpointTurnCount ??
                    inferredCheckpointTurnCountByTurnId[summary.turnId] ??
                    "?";
                  return (
                    <DropdownMenuItem
                      key={summary.turnId}
                      className={
                        summary.turnId === selectedTurn?.turnId ? "bg-(--wash-selected)" : undefined
                      }
                      onClick={() => selectTurn(summary.turnId)}
                    >
                      <span>Turn {turnCount}</span>
                      <span className="ml-auto text-(length:--text-caption) tabular-nums text-muted-foreground">
                        {formatShortTimestamp(summary.completedAt, settings.timestampFormat)}
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
        {codeViewFiles.length > 0 ? (
          <DiffStatLabel
            additions={diffLineStat.additions}
            deletions={diffLineStat.deletions}
            className="shrink-0 text-(length:--text-caption)"
            layout="inline"
          />
        ) : null}
      </div>
      <div className="flex h-(--review-toolbar-height) shrink-0 items-center gap-(--popup-item-gap) border-b border-(--panel-edge-muted) px-(--popup-item-padding-inline)">
        <ReviewToolbarTooltip
          label={allDiffFilesCollapsed ? "Expand all diffs" : "Collapse all diffs"}
          trigger={
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="size-(--review-control-size)"
              aria-label={allDiffFilesCollapsed ? "Expand all diffs" : "Collapse all diffs"}
              disabled={codeViewFiles.length === 0}
              onClick={toggleDiffFileCollapse}
            >
              {allDiffFilesCollapsed ? (
                <ChevronsUpDownIcon className="size-(--review-icon-size)" />
              ) : (
                <ChevronsDownUpIcon className="size-(--review-icon-size)" />
              )}
            </Button>
          }
        />
        <Combobox<string>
          items={codeViewFiles.map((file) => file.fileKey)}
          filteredItems={matchingCodeViewFiles.map((file) => file.fileKey)}
          onOpenChange={(open) => !open && setFileQuery("")}
          onValueChange={(fileKey) => {
            if (fileKey) jumpToDiffFile(fileKey);
          }}
        >
          <ReviewToolbarTooltip
            label="Jump to file"
            trigger={
              <ComboboxTrigger
                className="inline-flex size-(--review-control-size) items-center justify-center rounded-(--popup-item-radius) text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Jump to file"
              >
                <ListTreeIcon className="size-(--review-icon-size)" />
              </ComboboxTrigger>
            }
          />
          <ComboboxPopup align="start" className="w-(--review-jump-menu-width) overflow-hidden">
            <PopupSearchField
              autoFocus
              placeholder="Jump to file..."
              value={fileQuery}
              onChange={(event) => setFileQuery(event.target.value)}
            />
            <ComboboxEmpty>No matching files.</ComboboxEmpty>
            <ComboboxList>
              {matchingCodeViewFiles.map((file) => (
                <ComboboxItem key={file.fileKey} value={file.fileKey}>
                  <span className="min-w-0 flex-1 truncate">{file.filePath}</span>
                </ComboboxItem>
              ))}
            </ComboboxList>
          </ComboboxPopup>
        </Combobox>
        <ReviewToolbarTooltip
          label={diffRenderMode === "split" ? "Use unified view" : "Use split view"}
          trigger={
            <ToggleGroup
              variant="ghost"
              size="xs"
              value={diffRenderMode === "split" ? ["split"] : []}
              onValueChange={(value) =>
                setDiffRenderMode(value.includes("split") ? "split" : "unified")
              }
              className="shrink-0"
            >
              <Toggle
                value="split"
                aria-label={diffRenderMode === "split" ? "Use unified view" : "Use split view"}
                className="size-(--review-control-size)"
              >
                {diffRenderMode === "split" ? (
                  <Columns2Icon className="size-(--review-icon-size)" />
                ) : (
                  <Rows3Icon className="size-(--review-icon-size)" />
                )}
              </Toggle>
            </ToggleGroup>
          }
        />
        <ReviewToolbarTooltip
          label={
            settings.diffIgnoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"
          }
          trigger={
            <Toggle
              aria-label={
                settings.diffIgnoreWhitespace
                  ? "Show whitespace changes"
                  : "Hide whitespace changes"
              }
              variant="ghost"
              size="xs"
              className="size-(--review-control-size)"
              pressed={!settings.diffIgnoreWhitespace}
              onPressedChange={(showWhitespace) =>
                updateClientSettings({ diffIgnoreWhitespace: !showWhitespace })
              }
            >
              <PilcrowIcon className="size-(--review-icon-size)" />
            </Toggle>
          }
        />
        <DropdownMenu>
          <ReviewToolbarTooltip
            label="Review options"
            trigger={
              <DropdownMenuTrigger
                className="inline-flex size-(--review-control-size) items-center justify-center rounded-(--popup-item-radius) text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Review options"
              >
                <EllipsisIcon className="size-(--review-icon-size)" />
              </DropdownMenuTrigger>
            }
          />
          <DropdownMenuContent align="end" className="w-(--review-options-menu-width)">
            <DropdownMenuItem onClick={refreshDiff}>
              <RefreshCwIcon />
              Refresh
            </DropdownMenuItem>
            <DropdownMenuCheckboxItem
              checked={settings.wordWrap}
              onCheckedChange={(checked) => updateClientSettings({ wordWrap: Boolean(checked) })}
            >
              <TextWrapIcon />
              Word wrap
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={wordDiffs}
              onCheckedChange={(checked) => setWordDiffs(Boolean(checked))}
            >
              Word diffs
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={dontLoadFullFiles}
              onCheckedChange={(checked) => setDontLoadFullFiles(Boolean(checked))}
            >
              Don&apos;t load full files
            </DropdownMenuCheckboxItem>
            {/* Only a branch review can name the two refs the command needs. */}
            {gitApplyCommand === null ? null : (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={copyGitApplyCommand}>
                  <CopyIcon />
                  Copy git apply command
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      {headerRow}
      {!activeThread ? (
        <div className="flex flex-1 items-center justify-center px-(--popup-item-padding-inline) text-center text-(length:--text-caption) text-(--panel-muted-ink)">
          Select a thread to inspect turn diffs.
        </div>
      ) : !isGitRepo ? (
        <div className="flex flex-1 items-center justify-center px-(--popup-item-padding-inline) text-center text-(length:--text-caption) text-(--panel-muted-ink)">
          Turn diffs are unavailable because this project is not a git repository.
        </div>
      ) : selectedTurnId !== null && orderedTurnDiffSummaries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-(--popup-item-padding-inline) text-center text-(length:--text-caption) text-(--panel-muted-ink)">
          No completed turns yet.
        </div>
      ) : (
        <>
          <div className="diff-panel-viewport flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {isSelectedPatchTruncated && (
              <p className="shrink-0 border-b border-(--panel-edge-muted) bg-(--panel-notice-surface) px-3 py-1.5 text-(length:--text-caption) text-muted-foreground">
                This diff was truncated because it exceeded the preview limit. The changes shown are
                incomplete.
              </p>
            )}
            {selectedPatchError && !renderablePatch && (
              <div className="px-3">
                <p className="mb-2 text-(length:--text-caption) text-destructive">
                  {selectedPatchError}
                </p>
              </div>
            )}
            {!renderablePatch ? (
              isLoadingSelectedPatch ? (
                <DiffPanelLoadingState
                  label={
                    selectedTurn
                      ? "Loading checkpoint diff..."
                      : selectedGitScope === "unstaged"
                        ? "Loading working tree diff..."
                        : "Loading branch diff..."
                  }
                />
              ) : (
                <div className="flex h-full items-center justify-center px-3 py-2 text-(length:--text-caption) text-(--panel-muted-ink)">
                  <p>
                    {hasNoNetChanges
                      ? "No net changes in this selection."
                      : "No patch available for this selection."}
                  </p>
                </div>
              )
            ) : renderablePatch.kind === "files" ? (
              <div
                className="min-h-0 flex-1"
                onClickCapture={(event) => {
                  const composedPath = event.nativeEvent.composedPath?.() ?? [];
                  if (composedPath.some((node) => node instanceof HTMLButtonElement)) return;
                  const header = composedPath.find(
                    (node): node is HTMLElement =>
                      node instanceof HTMLElement && node.hasAttribute("data-diffs-header"),
                  );
                  const title = header?.querySelector<HTMLElement>("[data-title]");
                  const filePath = title?.textContent?.trim();
                  const file = codeViewFiles.find((candidate) => candidate.filePath === filePath);
                  if (!file) return;
                  if (event.shiftKey) {
                    openDiffFile(file.filePath);
                  } else {
                    toggleDiffFileCollapsed(file.fileKey);
                  }
                }}
              >
                <AnnotatableCodeView
                  viewerRef={codeViewRef}
                  key={collapseScopeKey ?? reviewSectionId}
                  className="diff-render-surface review-diff-surface h-full min-h-0 overflow-auto [&>div>div:last-child]:top-0! [&>div>div:last-child]:bottom-auto!"
                  files={codeViewFiles}
                  sectionId={reviewSectionId}
                  sectionTitle={reviewSectionTitle}
                  composerDraftTarget={composerDraftTarget}
                  renderHeaderPrefix={(fileDiff, fileKey, collapsed) => {
                    const filePath = resolveFileDiffPath(fileDiff);
                    return (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className={cn(
                                "size-(--review-control-size) rounded-(--popup-item-radius)",
                                getDiffCollapseIconClassName(fileDiff),
                              )}
                              aria-label={collapsed ? `Expand ${filePath}` : `Collapse ${filePath}`}
                              aria-expanded={!collapsed}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleDiffFileCollapsed(fileKey);
                              }}
                            />
                          }
                        >
                          {collapsed ? (
                            <ChevronRightIcon className="size-(--review-icon-size)" />
                          ) : (
                            <ChevronDownIcon className="size-(--review-icon-size)" />
                          )}
                        </TooltipTrigger>
                        <TooltipPopup side="top">
                          {collapsed ? "Expand diff" : "Collapse diff"}
                        </TooltipPopup>
                      </Tooltip>
                    );
                  }}
                  options={{
                    diffStyle: diffRenderMode === "split" ? "split" : "unified",
                    lineDiffType: wordDiffs ? "word-alt" : "none",
                    overflow: settings.wordWrap ? "wrap" : "scroll",
                    expandUnchanged: !dontLoadFullFiles,
                    theme: resolveDiffThemeName(resolvedTheme),
                    themeType: resolvedTheme as DiffThemeType,
                    unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
                    stickyHeaders: true,
                    layout: { paddingTop: 0, paddingBottom: 0, gap: 0 },
                  }}
                />
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto p-2">
                <div className="space-y-2">
                  <p className="text-(length:--text-caption) text-muted-foreground">
                    {renderablePatch.reason}
                  </p>
                  <pre
                    className={cn(
                      "max-h-(--panel-raw-patch-max-height) rounded-md border border-(--panel-edge-muted) bg-(--panel-raw-patch-surface) p-3 font-mono text-(length:--code-font-size) leading-(--code-line-height) text-muted-foreground",
                      settings.wordWrap
                        ? "overflow-auto whitespace-pre-wrap wrap-break-word"
                        : "overflow-auto",
                    )}
                  >
                    {renderablePatch.text}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
