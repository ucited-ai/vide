import { useAtomValue } from "@effect/atom-react";
import type { FileDiffMetadata } from "@pierre/diffs/types";
import { useParams } from "@tanstack/react-router";
import { scopeThreadRef } from "@vide/client-runtime/environment";
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
  FolderTreeIcon,
  ListTreeIcon,
  PilcrowIcon,
  RefreshCwIcon,
  Rows3Icon,
  TextWrapIcon,
} from "lucide-react";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOpenInPreferredEditor } from "../editorPreferences";
import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { openDiffFilePrimaryAction } from "../diffFileActions";
import { useCheckpointDiff } from "~/lib/checkpointDiffState";
import { cn } from "~/lib/utils";
import {
  type DiffPanelSelection,
  selectThreadDiffPanelSelection,
  useDiffPanelStore,
} from "../diffPanelStore";
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
import { GitActionItemIcon, GitQuickActionIcon, useGitActions } from "./GitActionsControl";
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
import { ScrollSurface } from "./ui/scroll-surface";
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
  persistReviewFilesPaneOpen,
  persistReviewRichPreview,
  persistReviewViewMode,
  readReviewFilesPaneOpen,
  readReviewRichPreview,
  readReviewViewMode,
  type ReviewViewMode,
} from "./reviewSurface";
import { ReviewFileTree, type ReviewFileChangeKind } from "./diffs/ReviewFileTree";
import { ReviewRichPreview } from "./diffs/ReviewRichPreview";
import { resolveRichPreviewKind } from "~/lib/reviewRichPreview";

type DiffThemeType = "light" | "dark";

interface CollapsedDiffFilesState {
  readonly scopeKey: string | null;
  readonly fileKeys: ReadonlySet<string>;
}

const EMPTY_COLLAPSED_DIFF_FILE_KEYS: ReadonlySet<string> = new Set();

/** Module constants so falling back off a turn scope keeps a stable identity. */
const WORKING_TREE_SELECTION: DiffPanelSelection = { kind: "unstaged" };
const BRANCH_SELECTION: DiffPanelSelection = { kind: "branch", baseRef: null };

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

/**
 * The review diff's scroller.
 *
 * `AnnotatableCodeView` owns the scroll container itself now, so this only says
 * how big it is. Scroll policy lives in the primitive.
 */
const REVIEW_DIFF_SURFACE_CLASS = "h-full";

/** Pierre names five outcomes; the tree badges four, since a pure rename and a
 *  rename-with-edits are the same news to someone scanning the list. */
function resolveReviewFileChangeKind(type: FileDiffMetadata["type"]): ReviewFileChangeKind {
  switch (type) {
    case "new":
      return "added";
    case "deleted":
      return "deleted";
    case "rename-pure":
    case "rename-changed":
      return "renamed";
    default:
      return "changed";
  }
}

/*
 * Every icon-sized trigger in the review toolbar.
 *
 * The open state is the load-bearing part, not the hover: with four popups on
 * one row and none of them marking their own trigger, an open menu floats free
 * of whatever produced it and you have to guess which button you pressed.
 * `data-popup-open` is what Base UI puts on the trigger, so the button stays lit
 * for as long as its menu is up.
 */
const REVIEW_TRIGGER_CLASS =
  "inline-flex size-(--review-control-size) shrink-0 items-center justify-center rounded-(--popup-item-radius) text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent data-popup-open:text-accent-foreground disabled:pointer-events-none disabled:opacity-64";

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
  const [filesPaneOpen, setFilesPaneOpen] = useState(() =>
    readReviewFilesPaneOpen(preferenceStorage),
  );
  const [richPreview, setRichPreview] = useState(() => readReviewRichPreview(preferenceStorage));
  const [wordDiffs, setWordDiffs] = useState(false);
  const [dontLoadFullFiles, setDontLoadFullFiles] = useState(true);
  const [baseRefQuery, setBaseRefQuery] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const [jumpTargetFileKey, setJumpTargetFileKey] = useState<string | null>(null);
  const [activeTreeFileKey, setActiveTreeFileKey] = useState<string | null>(null);
  // Keyed by file rather than a bare boolean, so "show the diff instead" applies
  // to the file it was clicked on and does not follow you to the next one.
  const [dismissedPreviewFileKey, setDismissedPreviewFileKey] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [collapsedDiffFiles, setCollapsedDiffFiles] = useState<CollapsedDiffFilesState>(() => ({
    scopeKey: null,
    fileKeys: EMPTY_COLLAPSED_DIFF_FILE_KEYS,
  }));
  const codeViewRef = useRef<AnnotatableCodeViewHandle>(null);

  useEffect(() => {
    persistReviewViewMode(preferenceStorage, diffRenderMode);
  }, [diffRenderMode, preferenceStorage]);

  useEffect(() => {
    persistReviewFilesPaneOpen(preferenceStorage, filesPaneOpen);
  }, [filesPaneOpen, preferenceStorage]);

  useEffect(() => {
    persistReviewRichPreview(preferenceStorage, richPreview);
  }, [preferenceStorage, richPreview]);

  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const draftId = typeof composerDraftTarget === "string" ? composerDraftTarget : null;
  const draftSession = useComposerDraftStore((store) => store.getDraftThread(composerDraftTarget));
  /*
   * A working-tree or branch diff needs a repo and a cwd; only turn scopes need a
   * thread. The draft route carries no thread ref in its URL, but its session
   * already holds the environment and the thread id the thread will be created
   * with — so review works before the first send, and the scope picked while
   * drafting survives promotion.
   */
  const diffThreadRef = useMemo(
    () =>
      routeThreadRef ??
      (draftSession ? scopeThreadRef(draftSession.environmentId, draftSession.threadId) : null),
    [draftSession, routeThreadRef],
  );
  const diffEnvironmentId = diffThreadRef?.environmentId ?? null;
  const activeThreadId = diffThreadRef?.threadId ?? null;
  // `waitForShell` while a draft session exists: a client-reserved thread id has
  // no detail endpoint to poll until the first send creates it.
  const activeThread = useThread(diffThreadRef, { waitForShell: draftSession !== null });
  const activeProjectId = activeThread?.projectId ?? draftSession?.projectId ?? null;
  const activeProject = useProject(
    diffEnvironmentId && activeProjectId
      ? {
          environmentId: diffEnvironmentId,
          projectId: activeProjectId,
        }
      : null,
  );
  // Once the thread exists it is the authority on its own worktree; before that
  // the draft session is, since its target can still change.
  const activeCwd =
    (activeThread ? activeThread.worktreePath : (draftSession?.worktreePath ?? null)) ??
    activeProject?.workspaceRoot;
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(diffEnvironmentId));
  const openInPreferredEditor = useOpenInPreferredEditor(
    diffEnvironmentId,
    serverConfig?.availableEditors ?? [],
  );
  const gitStatusQuery = useEnvironmentQuery(
    diffEnvironmentId && activeCwd != null
      ? vcsEnvironment.status({
          environmentId: diffEnvironmentId,
          input: { cwd: activeCwd },
        })
      : null,
  );
  const storedDiffSelection = useDiffPanelStore((state) =>
    selectThreadDiffPanelSelection(
      state.byThreadKey,
      diffThreadRef,
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

  /*
   * Turn scopes need a thread; a working tree and a branch range need only a repo.
   *
   * A thread route means one exists even while its detail is still in flight, so
   * that case keeps its stored turn scope rather than flashing a branch diff on
   * the way to the turn diff. A draft holds only the thread id it reserved, and
   * the selection is keyed by that id so it survives promotion — which means a
   * stored turn scope can outlive the thread it was picked in. Fall back to a git
   * scope there instead of rendering a panel with nothing in it.
   */
  const canReviewTurns = activeThread !== null || (routeThreadRef !== null && !draftSession);
  const diffSelection =
    canReviewTurns || storedDiffSelection.kind !== "turn"
      ? storedDiffSelection
      : initialGitScope === "unstaged"
        ? WORKING_TREE_SELECTION
        : BRANCH_SELECTION;

  useEffect(() => {
    if (!diffThreadRef || diffSelection.kind !== "turn") return;
    useDiffPanelStore.getState().reconcileTurnSelection(
      diffThreadRef,
      orderedTurnDiffSummaries.map((summary) => summary.turnId),
    );
  }, [diffSelection, diffThreadRef, orderedTurnDiffSummaries]);

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
  const collapseScopeKey = diffThreadRef
    ? `${diffThreadRef.environmentId}:${diffThreadRef.threadId}:${reviewSectionId}`
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
    selectedTurnId === null && diffEnvironmentId && activeCwd
      ? reviewEnvironment.diffPreview({
          environmentId: diffEnvironmentId,
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
    shouldRetryBranchDiffAtEnvironmentCwd && diffEnvironmentId && serverConfig
      ? reviewEnvironment.diffPreview({
          environmentId: diffEnvironmentId,
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
      diffEnvironmentId &&
      branchDiffPreview.data?.cwd
      ? vcsEnvironment.listRefs({
          environmentId: diffEnvironmentId,
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
      diffEnvironmentId &&
      branchDiffPreview.data?.cwd
      ? vcsEnvironment.listRefs({
          environmentId: diffEnvironmentId,
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
  /*
   * The file list, with no collapse state in it. Threading the collapsed flag
   * through here gave this array a new identity on every toggle, which rippled
   * into the tree, the jump list and every CodeView item. Which diffs are open
   * is passed alongside instead, so a toggle changes only that.
   */
  const codeViewFiles = useMemo(
    () =>
      renderableFiles.map((fileDiff) => ({
        fileDiff,
        filePath: resolveFileDiffPath(fileDiff),
        fileKey: buildFileDiffRenderKey(fileDiff),
      })),
    [renderableFiles],
  );
  const diffFileKeys = useMemo(() => codeViewFiles.map((file) => file.fileKey), [codeViewFiles]);
  /*
   * The file the column is showing as a document instead of as a diff.
   *
   * Scoped to one file rather than applied to the whole list because the diff
   * renderer owns its own scroller and virtualizes against it, so rendered
   * documents cannot be interleaved between diffs without nesting scrollers.
   * Reviewing stays the default view; this is the second look you ask for, and
   * the file list beside it is how you ask.
   */
  const previewedFile = useMemo(() => {
    if (!richPreview || activeTreeFileKey === null) return null;
    if (activeTreeFileKey === dismissedPreviewFileKey) return null;
    const file = codeViewFiles.find((candidate) => candidate.fileKey === activeTreeFileKey);
    if (!file) return null;
    const previewKind = resolveRichPreviewKind(file.filePath);
    return previewKind ? { file, previewKind } : null;
  }, [activeTreeFileKey, codeViewFiles, dismissedPreviewFileKey, richPreview]);
  /*
   * Built from `renderableFiles`, deliberately not from `codeViewFiles`.
   *
   * `codeViewFiles` carries each file's collapsed flag, so it gets a new
   * identity on every expand and collapse. Deriving the tree from it meant one
   * click on a diff header rebuilt every row's stats and re-ran
   * `buildTurnDiffTree` over the whole change set — work whose result is
   * identical every time, because which diffs are open says nothing about which
   * files exist. The patch is the only thing the tree actually depends on.
   */
  const reviewTreeFiles = useMemo(
    () =>
      renderableFiles.map((fileDiff) => {
        const stat = getDiffLineStat([fileDiff]);
        return {
          fileKey: buildFileDiffRenderKey(fileDiff),
          filePath: resolveFileDiffPath(fileDiff),
          additions: stat.additions,
          deletions: stat.deletions,
          changeKind: resolveReviewFileChangeKind(fileDiff.type),
        };
      }),
    [renderableFiles],
  );
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
    codeViewRef.current?.scrollToFile(file.fileKey);
  }, [codeViewFiles, selectedFilePath, selectedFileRevealRequestId]);

  useEffect(() => {
    if (!jumpTargetFileKey) return;
    const file = codeViewFiles.find((candidate) => candidate.fileKey === jumpTargetFileKey);
    if (!file || collapsedDiffFileKeys.has(file.fileKey)) return;
    codeViewRef.current?.scrollToFile(file.fileKey);
    setJumpTargetFileKey(null);
  }, [codeViewFiles, jumpTargetFileKey]);

  const openDiffFile = useCallback(
    (filePath: string) => {
      openDiffFilePrimaryAction({
        threadRef: diffThreadRef,
        filePath,
        activeCwd,
        openInEditor: (targetPath) => {
          void (async () => {
            const result = await openInPreferredEditor(targetPath);
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              console.warn("Failed to open diff file in editor.", {
                operation: "open-diff-file",
                ...(diffThreadRef
                  ? {
                      environmentId: diffThreadRef.environmentId,
                      threadId: diffThreadRef.threadId,
                    }
                  : {}),
                ...safeErrorLogAttributes(squashAtomCommandFailure(result)),
              });
            }
          })();
        },
      });
    },
    [activeCwd, diffThreadRef, openInPreferredEditor],
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
      // Survives the scroll, unlike the jump target: the tree keeps showing
      // which file you were taken to long after the scroll has landed.
      setActiveTreeFileKey(fileKey);
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

  // The draft id, when there is one, is what lets a commit made from here write
  // its branch back to the draft session instead of to a thread that has no row yet.
  const git = useGitActions({
    gitCwd: activeCwd ?? null,
    activeThreadRef: diffThreadRef,
    enabled: isGitRepo,
    ...(draftId ? { draftId } : {}),
  });
  const SourceControlIcon = git.sourceControlPresentation.Icon;
  /*
   * Every action, including the one the primary half performs.
   *
   * This used to drop whichever item matched the quick action's label, on the
   * theory that the split button should not offer the same thing twice. Two
   * problems: the labels are composed prose ("Commit, push & pull request"), so
   * the comparison silently matched nothing or the wrong row, and a menu that is
   * sometimes missing an entry reads as a bug rather than as tidiness. A
   * complete, stable list costs one redundant row and answers "where is commit".
   */
  const gitMenuItems = git.menuItems;
  const quickActionUnavailable = git.isBusy || git.quickAction.disabled;
  const quickActionReason = git.isBusy
    ? "A git action is already running."
    : (git.quickActionDisabledReason ?? git.quickAction.label);

  const selectTurn = (turnId: TurnId) => {
    if (!diffThreadRef) return;
    useDiffPanelStore.getState().selectTurn(diffThreadRef, turnId);
  };
  const selectGitScope = (scope: "branch" | "unstaged") => {
    if (!diffThreadRef) return;
    useDiffPanelStore.getState().selectGitScope(diffThreadRef, scope);
  };
  const selectBranchBaseRef = (baseRef: string | null) => {
    if (!diffThreadRef) return;
    useDiffPanelStore.getState().selectBranchBaseRef(diffThreadRef, baseRef);
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
            className="inline-flex min-w-0 flex-1 items-center gap-(--popup-item-gap) rounded-(--popup-item-radius) px-(--popup-item-padding-inline) text-(length:--text-ui) text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent data-popup-open:text-accent-foreground"
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
              disabled={!canReviewTurns}
              onClick={() => {
                if (latestTurn) selectTurn(latestTurn.turnId);
              }}
            >
              <span>Latest turn</span>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!canReviewTurns}>Turn</DropdownMenuSubTrigger>
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
            {/* Greyed rows with no reason read as broken; a thread that has not
                started simply has no turns to diff yet. */}
            {canReviewTurns ? null : (
              <p className="px-(--popup-item-padding-inline) pb-(--popup-padding) text-(length:--text-caption) text-muted-foreground">
                Turn diffs appear once this thread has run a turn.
              </p>
            )}
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
      {/* One right-aligned cluster. Controls hugging the left edge read as a
          second navigation bar; pinned right they read as this panel's tools,
          which is what they are. */}
      <div className="flex h-(--review-toolbar-height) shrink-0 items-center justify-end gap-(--popup-item-gap) border-b border-(--panel-edge-muted) px-(--popup-item-padding-inline)">
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
              <ComboboxTrigger className={REVIEW_TRIGGER_CLASS} aria-label="Jump to file">
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
        <ReviewToolbarTooltip
          label={filesPaneOpen ? "Hide files" : "Show files"}
          trigger={
            <Toggle
              aria-label={filesPaneOpen ? "Hide files" : "Show files"}
              variant="ghost"
              size="xs"
              className="size-(--review-control-size)"
              pressed={filesPaneOpen}
              onPressedChange={setFilesPaneOpen}
            >
              <FolderTreeIcon className="size-(--review-icon-size)" />
            </Toggle>
          }
        />
        <DropdownMenu>
          <ReviewToolbarTooltip
            label="Review options"
            trigger={
              <DropdownMenuTrigger className={REVIEW_TRIGGER_CLASS} aria-label="Review options">
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
            <DropdownMenuCheckboxItem
              checked={richPreview}
              onCheckedChange={(checked) => setRichPreview(Boolean(checked))}
            >
              Rich preview
            </DropdownMenuCheckboxItem>
            {/* The one option whose name says nothing on its own. */}
            <p className="px-(--popup-item-padding-inline) pb-(--popup-padding) text-(length:--text-caption) text-muted-foreground">
              Renders Markdown, CSV and JSON instead of showing them as text. Pick such a file in
              the list to read it.
            </p>
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
        {/*
         * Shipping the change sits at the far end of the same toolbar you read
         * it in, because the two belong to one motion: you review, then you
         * commit. A split button rather than two, since the chevron's contents
         * are the same action at a different scope, not a different subject.
         */}
        <div className="flex h-(--review-control-size) shrink-0 items-center overflow-hidden rounded-(--popup-item-radius) border border-(--edge-strong)">
          {/*
           * `aria-disabled`, not `disabled`. A disabled button gets
           * `pointer-events-none` from the button styles, which takes its
           * tooltip with it — so the half that cannot act right now became a grey
           * icon with no way to ask why. This keeps it hoverable and focusable
           * and lets the tooltip carry the reason.
           */}
          <ReviewToolbarTooltip
            label={quickActionReason}
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="size-(--review-control-size) rounded-none"
                aria-label={git.quickAction.label}
                {...(quickActionUnavailable
                  ? { "aria-disabled": true, onClick: undefined }
                  : { onClick: git.runQuickAction })}
              >
                <GitQuickActionIcon
                  quickAction={git.quickAction}
                  SourceControlIcon={SourceControlIcon}
                />
              </Button>
            }
          />
          <span aria-hidden className="h-full w-px shrink-0 bg-(--edge-strong)" />
          <DropdownMenu>
            <ReviewToolbarTooltip
              label="More git actions"
              trigger={
                <DropdownMenuTrigger
                  className="inline-flex h-(--review-control-size) w-[calc(var(--review-control-size)-0.25rem)] shrink-0 items-center justify-center text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent data-popup-open:text-accent-foreground"
                  aria-label="More git actions"
                >
                  <ChevronDownIcon className="size-(--review-icon-size)" />
                </DropdownMenuTrigger>
              }
            />
            {/* `sideOffset` clears the split button's border so the menu reads as
                hanging off it rather than growing out of it. */}
            <DropdownMenuContent align="end" sideOffset={6} className="w-(--review-git-menu-width)">
              {gitMenuItems.map((item) => (
                <DropdownMenuItem
                  key={`${item.id}-${item.label}`}
                  disabled={item.disabled}
                  onClick={() => git.runMenuItem(item)}
                >
                  <GitActionItemIcon icon={item.icon} SourceControlIcon={SourceControlIcon} />
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      {/* Outside every popup: a dialog must outlive the menu that opened it. */}
      {git.dialogs}
      {headerRow}
      {/* A cwd, not a thread: the diff is of the checkout, and the checkout is
          the project's. */}
      {!activeCwd ? (
        <div className="flex flex-1 items-center justify-center px-(--popup-item-padding-inline) text-center text-(length:--text-caption) text-(--panel-muted-ink)">
          Open a project to review its changes.
        </div>
      ) : !isGitRepo ? (
        <div className="flex flex-1 items-center justify-center px-(--popup-item-padding-inline) text-center text-(length:--text-caption) text-(--panel-muted-ink)">
          Review is unavailable because this folder is not a Git repository.
        </div>
      ) : selectedTurnId !== null && orderedTurnDiffSummaries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-(--popup-item-padding-inline) text-center text-(length:--text-caption) text-(--panel-muted-ink)">
          No completed turns yet.
        </div>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1">
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
            {previewedFile ? (
              <>
                <div className="flex h-(--review-toolbar-height) shrink-0 items-center gap-(--popup-item-gap) border-b border-(--panel-edge-muted) px-(--popup-item-padding-inline)">
                  <span
                    className="min-w-0 flex-1 truncate text-(length:--text-caption) text-muted-foreground"
                    title={previewedFile.file.filePath}
                  >
                    {previewedFile.file.filePath}
                  </span>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => {
                      setDismissedPreviewFileKey(previewedFile.file.fileKey);
                      jumpToDiffFile(previewedFile.file.fileKey);
                    }}
                  >
                    Show diff
                  </Button>
                </div>
                <ScrollSurface axis="both" className="flex-1">
                  <ReviewRichPreview
                    key={previewedFile.file.fileKey}
                    kind={previewedFile.previewKind}
                    filePath={previewedFile.file.filePath}
                    fileDiff={previewedFile.file.fileDiff}
                    cwd={activeCwd ?? null}
                    threadRef={diffThreadRef}
                  />
                </ScrollSurface>
              </>
            ) : !renderablePatch ? (
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
                  className={REVIEW_DIFF_SURFACE_CLASS}
                  files={codeViewFiles}
                  collapsedFileKeys={collapsedDiffFileKeys}
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
                    stickyHeader: true,
                  }}
                />
              </div>
            ) : (
              <ScrollSurface axis="both" className="flex-1 p-2">
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
              </ScrollSurface>
            )}
          </div>
          {/*
           * The wrapper's width animates; the pane inside keeps its own, so the
           * tree does not re-wrap on every frame of the slide. `inert` while
           * closed, or Tab walks into a list nobody can see.
           */}
          <div
            className={cn(
              "shrink-0 overflow-hidden border-s transition-[width] duration-(--duration-base) ease-(--ease-soft) motion-reduce:transition-none",
              filesPaneOpen
                ? "w-(--review-tree-width) border-(--panel-edge-muted)"
                : "w-0 border-transparent",
            )}
            {...(filesPaneOpen ? {} : { inert: true })}
          >
            <ReviewFileTree
              files={reviewTreeFiles}
              activeFileKey={activeTreeFileKey}
              theme={resolvedTheme as DiffThemeType}
              onSelectFile={jumpToDiffFile}
            />
          </div>
        </div>
      )}
    </div>
  );
}
