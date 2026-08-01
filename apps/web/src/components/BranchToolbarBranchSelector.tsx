import { scopeProjectRef, scopeThreadRef } from "@vide/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@vide/client-runtime/state/runtime";
import type { ContextMenuItem, EnvironmentId, VcsRef, ThreadId } from "@vide/contracts";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import {
  CheckIcon,
  ChevronDownIcon,
  GitBranchIcon,
  GitBranchPlusIcon,
  SearchIcon,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { readLocalApi } from "../localApi";
import { useOpenPrLink } from "../lib/openPullRequestLink";
import { usePaginatedBranches } from "../state/queries";
import { useProject, useThread } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";
import { cn } from "../lib/utils";
import { parsePullRequestReference } from "../pullRequestReference";
import { getSourceControlPresentation } from "../sourceControlPresentation";
import {
  deriveLocalBranchNameFromRemoteRef,
  type OptimisticThreadBranchSelection,
  resolveBranchTriggerLabel,
  resolveBranchToolbarPrBranch,
  resolveBranchSelectionTarget,
  resolveBranchToolbarValue,
  resolveDisplayedThreadBranch,
  resolveDraftEnvModeAfterBranchChange,
  resolveEffectiveEnvMode,
  shouldReconcileOptimisticThreadBranch,
  shouldIncludeBranchPickerItem,
} from "./BranchToolbar.logic";
import { useGitRepositoryInit } from "./GitActionsControl";
import {
  ChangeRequestStatusIcon,
  prStatusIndicator,
  resolveThreadPr,
} from "./ThreadStatusIndicators";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxListVirtualized,
  ComboboxPopup,
  ComboboxStatus,
  ComboboxTrigger,
} from "./ui/combobox";
import { Spinner } from "./ui/spinner";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

interface BranchToolbarBranchSelectorProps {
  className?: string;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  draftId?: DraftId;
  envLocked: boolean;
  effectiveEnvModeOverride?: "local" | "worktree";
  activeThreadBranchOverride?: string | null;
  onActiveThreadBranchOverrideChange?: (refName: string | null) => void;
  startFromOrigin: boolean;
  onStartFromOriginChange: (startFromOrigin: boolean) => void;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
}

interface ThreadBranchSelectionInput {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  draftId?: DraftId;
  envLocked: boolean;
  effectiveEnvModeOverride?: "local" | "worktree";
  activeThreadBranchOverride?: string | null;
  onActiveThreadBranchOverrideChange?: (refName: string | null) => void;
  /** Runs the moment a selection is applied, before any checkout starts. */
  onBranchApplied?: () => void;
  /** Refreshes ref queries the caller owns once a branch action settles. */
  onBranchActionSettled?: () => void;
}

interface StoredThreadBranchSelection extends OptimisticThreadBranchSelection {
  readonly actionId: number;
}

const threadBranchSelections = new Map<string, StoredThreadBranchSelection>();
const threadBranchSelectionListeners = new Map<string, Set<() => void>>();
let nextThreadBranchActionId = 0;

function threadBranchSelectionKey(environmentId: EnvironmentId, threadId: ThreadId): string {
  return JSON.stringify([environmentId, threadId]);
}

function emitThreadBranchSelection(key: string): void {
  for (const listener of threadBranchSelectionListeners.get(key) ?? []) {
    listener();
  }
}

function writeThreadBranchSelection(
  key: string,
  branch: string | null,
  isPending: boolean,
): number {
  const actionId = ++nextThreadBranchActionId;
  threadBranchSelections.set(key, { actionId, branch, isPending });
  emitThreadBranchSelection(key);
  return actionId;
}

function updateThreadBranchSelection(
  key: string,
  actionId: number,
  branch: string | null,
  isPending: boolean,
): void {
  if (threadBranchSelections.get(key)?.actionId !== actionId) return;
  threadBranchSelections.set(key, { actionId, branch, isPending });
  emitThreadBranchSelection(key);
}

function clearThreadBranchSelection(key: string, actionId: number): void {
  if (threadBranchSelections.get(key)?.actionId !== actionId) return;
  threadBranchSelections.delete(key);
  emitThreadBranchSelection(key);
}

export function useOptimisticThreadBranchSelection(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): OptimisticThreadBranchSelection | undefined {
  const key = useMemo(
    () => threadBranchSelectionKey(environmentId, threadId),
    [environmentId, threadId],
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      const listeners = threadBranchSelectionListeners.get(key) ?? new Set<() => void>();
      listeners.add(listener);
      threadBranchSelectionListeners.set(key, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          threadBranchSelectionListeners.delete(key);
        }
      };
    },
    [key],
  );
  const getSnapshot = useCallback(() => threadBranchSelections.get(key), [key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function toBranchActionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}

/**
 * Everything needed to move a thread onto another ref: which ref it is on now,
 * and the checkout/create mutations that move it. Lives apart from the combobox
 * so a menu can offer the same switch without restating the worktree rules.
 */
export function useThreadBranchSelection({
  environmentId,
  threadId,
  draftId,
  envLocked,
  effectiveEnvModeOverride,
  activeThreadBranchOverride,
  onActiveThreadBranchOverrideChange,
  onBranchApplied,
  onBranchActionSettled,
}: ThreadBranchSelectionInput) {
  const stopThreadSession = useAtomCommand(threadEnvironment.stopSession, "thread session stop");
  const updateThreadMetadata = useAtomCommand(
    threadEnvironment.updateMetadata,
    "thread metadata update",
  );
  const switchRef = useAtomCommand(vcsEnvironment.switchRef, {
    reportFailure: false,
  });
  const createRefMutation = useAtomCommand(vcsEnvironment.createRef, {
    reportFailure: false,
  });
  // ---------------------------------------------------------------------------
  // Thread / project state (pushed down from parent to colocate with mutation)
  // ---------------------------------------------------------------------------
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const draftThread = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : store.getDraftThreadByRef(threadRef),
  );
  const serverThread = useThread(threadRef, { waitForShell: draftThread !== null });
  const serverSession = serverThread?.session ?? null;
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);

  const activeProjectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const activeProject = useProject(activeProjectRef);

  const activeThreadId = serverThread?.id ?? (draftThread ? threadId : undefined);
  const activeThreadBranch =
    activeThreadBranchOverride !== undefined
      ? activeThreadBranchOverride
      : (serverThread?.branch ?? draftThread?.branch ?? null);
  const activeWorktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const activeProjectCwd = activeProject?.workspaceRoot ?? null;
  const branchCwd = activeWorktreePath ?? activeProjectCwd;
  const selectionKey = useMemo(
    () => threadBranchSelectionKey(environmentId, threadId),
    [environmentId, threadId],
  );
  const optimisticSelection = useOptimisticThreadBranchSelection(environmentId, threadId);
  const hasServerThread = serverThread !== null;
  const effectiveEnvMode =
    effectiveEnvModeOverride ??
    resolveEffectiveEnvMode({
      activeWorktreePath,
      hasServerThread,
      draftThreadEnvMode: draftThread?.envMode,
    });

  // ---------------------------------------------------------------------------
  // Thread branch mutation (colocated — only this component calls it)
  // ---------------------------------------------------------------------------
  const persistThreadBranch = useCallback(
    (branch: string | null, worktreePath: string | null, actionId: number) => {
      if (!activeThreadId || !activeProject) return;
      if (serverSession && worktreePath !== activeWorktreePath) {
        void stopThreadSession({
          environmentId,
          input: { threadId: activeThreadId },
        });
      }
      if (hasServerThread) {
        onActiveThreadBranchOverrideChange?.(branch);
        void updateThreadMetadata({
          environmentId,
          input: {
            threadId: activeThreadId,
            branch,
            worktreePath,
          },
        }).then((result) => {
          if (result._tag === "Failure") {
            clearThreadBranchSelection(selectionKey, actionId);
            onActiveThreadBranchOverrideChange?.(serverThread?.branch ?? null);
          }
        });
        return;
      }
      const nextDraftEnvMode = resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: worktreePath,
        currentWorktreePath: activeWorktreePath,
        effectiveEnvMode,
      });
      setDraftThreadContext(draftId ?? threadRef, {
        branch,
        worktreePath,
        envMode: nextDraftEnvMode,
        projectRef: scopeProjectRef(environmentId, activeProject.id),
      });
    },
    [
      activeThreadId,
      activeProject,
      serverSession,
      activeWorktreePath,
      hasServerThread,
      onActiveThreadBranchOverrideChange,
      setDraftThreadContext,
      draftId,
      threadRef,
      environmentId,
      effectiveEnvMode,
      selectionKey,
      serverThread?.branch,
      stopThreadSession,
      updateThreadMetadata,
    ],
  );

  const setThreadBranch = useCallback(
    (branch: string | null, worktreePath: string | null) => {
      const actionId = writeThreadBranchSelection(selectionKey, branch, false);
      persistThreadBranch(branch, worktreePath, actionId);
    },
    [persistThreadBranch, selectionKey],
  );

  const branchStatusQuery = useEnvironmentQuery(
    branchCwd === null
      ? null
      : vcsEnvironment.status({
          environmentId,
          input: { cwd: branchCwd },
        }),
  );
  const canonicalActiveBranch = resolveBranchToolbarValue({
    envMode: effectiveEnvMode,
    activeWorktreePath,
    activeThreadBranch,
    currentGitBranch: branchStatusQuery.data?.refName ?? null,
  });
  const resolvedActiveBranch = resolveDisplayedThreadBranch({
    authoritativeBranch: canonicalActiveBranch,
    optimisticSelection,
  });
  const isBranchActionPending = optimisticSelection?.isPending === true;
  const isSelectingWorktreeBase =
    effectiveEnvMode === "worktree" && !envLocked && !activeWorktreePath;

  useEffect(() => {
    if (
      !optimisticSelection ||
      !shouldReconcileOptimisticThreadBranch({
        authoritativeBranch: serverThread?.branch ?? draftThread?.branch ?? null,
        displayedBranch: canonicalActiveBranch,
        optimisticSelection,
      })
    ) {
      return;
    }
    const storedSelection = threadBranchSelections.get(selectionKey);
    if (storedSelection) {
      clearThreadBranchSelection(selectionKey, storedSelection.actionId);
    }
  }, [
    canonicalActiveBranch,
    draftThread?.branch,
    optimisticSelection,
    selectionKey,
    serverThread?.branch,
  ]);

  const runBranchAction = (
    optimisticBranch: string,
    action: (actionId: number) => Promise<void>,
  ) => {
    const actionId = writeThreadBranchSelection(selectionKey, optimisticBranch, true);
    void (async () => {
      await action(actionId);
      onBranchActionSettled?.();
    })();
  };

  const selectBranch = (refName: VcsRef) => {
    if (!branchCwd || !activeProjectCwd || isBranchActionPending) return;

    if (isSelectingWorktreeBase) {
      setThreadBranch(refName.name, null);
      onBranchApplied?.();
      return;
    }

    const selectionTarget = resolveBranchSelectionTarget({
      activeProjectCwd,
      activeWorktreePath,
      refName,
    });

    if (selectionTarget.reuseExistingWorktree) {
      setThreadBranch(refName.name, selectionTarget.nextWorktreePath);
      onBranchApplied?.();
      return;
    }

    const selectedBranchName = refName.isRemote
      ? deriveLocalBranchNameFromRemoteRef(refName.name)
      : refName.name;

    onBranchApplied?.();

    runBranchAction(selectedBranchName, async (actionId) => {
      const checkoutResult = await switchRef({
        environmentId,
        input: {
          cwd: selectionTarget.checkoutCwd,
          refName: refName.name,
        },
      });
      if (checkoutResult._tag === "Success") {
        const nextBranchName = refName.isRemote
          ? (checkoutResult.value.refName ?? selectedBranchName)
          : selectedBranchName;
        updateThreadBranchSelection(selectionKey, actionId, nextBranchName, false);
        persistThreadBranch(nextBranchName, selectionTarget.nextWorktreePath, actionId);
        return;
      }
      clearThreadBranchSelection(selectionKey, actionId);
      if (!isAtomCommandInterrupted(checkoutResult)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to switch ref.",
            description: toBranchActionErrorMessage(squashAtomCommandFailure(checkoutResult)),
          }),
        );
      }
    });
  };

  const createRef = (rawName: string) => {
    const name = rawName.trim();
    if (!branchCwd || !name || isBranchActionPending) return;

    onBranchApplied?.();

    runBranchAction(name, async (actionId) => {
      const createBranchResult = await createRefMutation({
        environmentId,
        input: {
          cwd: branchCwd,
          refName: name,
          switchRef: true,
        },
      });
      if (createBranchResult._tag === "Success") {
        updateThreadBranchSelection(
          selectionKey,
          actionId,
          createBranchResult.value.refName,
          false,
        );
        persistThreadBranch(createBranchResult.value.refName, activeWorktreePath, actionId);
        return;
      }
      clearThreadBranchSelection(selectionKey, actionId);
      if (!isAtomCommandInterrupted(createBranchResult)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to create and switch ref.",
            description: toBranchActionErrorMessage(squashAtomCommandFailure(createBranchResult)),
          }),
        );
      }
    });
  };

  return {
    activeProjectCwd,
    activeThreadBranch,
    activeWorktreePath,
    branchCwd,
    branchStatus: branchStatusQuery.data ?? null,
    createRef,
    effectiveEnvMode,
    isBranchActionPending,
    isSelectingWorktreeBase,
    resolvedActiveBranch,
    selectBranch,
    setThreadBranch,
  };
}

export function BranchToolbarBranchSelector({
  className,
  environmentId,
  threadId,
  draftId,
  envLocked,
  effectiveEnvModeOverride,
  activeThreadBranchOverride,
  onActiveThreadBranchOverrideChange,
  startFromOrigin,
  onStartFromOriginChange,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
}: BranchToolbarBranchSelectorProps) {
  const startFromOriginSwitchId = useId();

  // ---------------------------------------------------------------------------
  // Git ref queries
  // ---------------------------------------------------------------------------
  const [isBranchMenuOpen, setIsBranchMenuOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const deferredBranchQuery = useDeferredValue(branchQuery);
  const trimmedBranchQuery = branchQuery.trim();
  const deferredTrimmedBranchQuery = deferredBranchQuery.trim();
  const {
    activeProjectCwd,
    activeThreadBranch,
    activeWorktreePath,
    branchCwd,
    branchStatus,
    createRef,
    effectiveEnvMode,
    isBranchActionPending,
    isSelectingWorktreeBase,
    resolvedActiveBranch: selectedBranch,
    selectBranch,
    setThreadBranch,
  } = useThreadBranchSelection({
    environmentId,
    threadId,
    envLocked,
    ...(draftId ? { draftId } : {}),
    ...(effectiveEnvModeOverride ? { effectiveEnvModeOverride } : {}),
    ...(activeThreadBranchOverride !== undefined ? { activeThreadBranchOverride } : {}),
    ...(onActiveThreadBranchOverrideChange ? { onActiveThreadBranchOverrideChange } : {}),
    onBranchApplied: () => {
      setIsBranchMenuOpen(false);
      onComposerFocusRequest?.();
    },
    onBranchActionSettled: () => {
      branchRefState.refresh();
    },
  });
  // Default to true while status is loading, same as everywhere else this
  // flag is read — otherwise the chip flashes "not a repository" for every
  // plain folder for the one frame before the query resolves.
  const isRepo = branchStatus?.isRepo ?? true;
  const gitInitScope = useMemo(
    () => ({ environmentId, cwd: branchCwd }),
    [branchCwd, environmentId],
  );
  const gitInitThreadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const gitInitToastData = useMemo(() => ({ threadRef: gitInitThreadRef }), [gitInitThreadRef]);
  const { isInitPending, initRepository } = useGitRepositoryInit(gitInitScope, gitInitToastData);
  const branchRefTarget = useMemo(
    () => ({
      environmentId,
      cwd: branchCwd,
      query: deferredTrimmedBranchQuery,
    }),
    [branchCwd, deferredTrimmedBranchQuery, environmentId],
  );
  const branchRefState = usePaginatedBranches(branchRefTarget);
  const refs = branchRefState.refs;
  const hasNextPage =
    branchRefState.data?.nextCursor !== null && branchRefState.data?.nextCursor !== undefined;
  // Both states come from the hook: it is the only place that can tell a page
  // this picker asked for apart from a live stream refreshing on its own.
  const isFetchingNextPage = branchRefState.isLoadingMore;
  const isInitialBranchesLoadPending = branchRefState.isInitialLoad;
  const sourceControlPresentation = useMemo(
    () => getSourceControlPresentation(branchStatus?.sourceControlProvider),
    [branchStatus?.sourceControlProvider],
  );
  const SourceControlIcon = sourceControlPresentation.Icon;
  // The ref list carries a `current` entry of its own, so it can name the
  // checked-out ref in the window before the status query resolves.
  const resolvedActiveBranch =
    selectedBranch ?? refs.find((refName) => refName.current)?.name ?? null;
  const branchNames = useMemo(() => refs.map((refName) => refName.name), [refs]);
  const branchByName = useMemo(
    () => new Map(refs.map((refName) => [refName.name, refName] as const)),
    [refs],
  );
  const normalizedDeferredBranchQuery = deferredTrimmedBranchQuery.toLowerCase();
  const prReference = parsePullRequestReference(trimmedBranchQuery);
  const checkoutPullRequestItemValue =
    prReference && onCheckoutPullRequestRequest ? `__checkout_pull_request__:${prReference}` : null;
  const canCreateBranch = !isSelectingWorktreeBase && trimmedBranchQuery.length > 0;
  const hasExactBranchMatch = branchByName.has(trimmedBranchQuery);
  const createBranchItemValue = canCreateBranch
    ? `__create_new_branch__:${trimmedBranchQuery}`
    : null;
  const branchPickerItems = useMemo(() => {
    const items = [...branchNames];
    if (createBranchItemValue && !hasExactBranchMatch) {
      items.push(createBranchItemValue);
    }
    if (checkoutPullRequestItemValue) {
      items.unshift(checkoutPullRequestItemValue);
    }
    return items;
  }, [branchNames, checkoutPullRequestItemValue, createBranchItemValue, hasExactBranchMatch]);
  const filteredBranchPickerItems = useMemo(
    () =>
      normalizedDeferredBranchQuery.length === 0
        ? branchPickerItems
        : branchPickerItems.filter((itemValue) =>
            shouldIncludeBranchPickerItem({
              itemValue,
              normalizedQuery: normalizedDeferredBranchQuery,
              createBranchItemValue,
              checkoutPullRequestItemValue,
            }),
          ),
    [
      branchPickerItems,
      checkoutPullRequestItemValue,
      createBranchItemValue,
      normalizedDeferredBranchQuery,
    ],
  );
  const hasFilteredBranchRows = filteredBranchPickerItems.some((itemValue) =>
    branchByName.has(itemValue),
  );
  const listedActiveBranch =
    resolvedActiveBranch === null ? null : (branchByName.get(resolvedActiveBranch) ?? null);
  const activeBranchRefQuery = useEnvironmentQuery(
    branchCwd !== null && resolvedActiveBranch !== null
      ? vcsEnvironment.listRefs({
          environmentId,
          input: {
            cwd: branchCwd,
            query: resolvedActiveBranch,
            limit: 10,
          },
        })
      : null,
  );
  const queriedActiveBranch = activeBranchRefQuery.data?.refs.find(
    (refName) => refName.name === resolvedActiveBranch,
  );
  const resolvedActiveBranchIsRemote =
    listedActiveBranch !== null
      ? listedActiveBranch.isRemote === true
      : queriedActiveBranch
        ? queriedActiveBranch.isRemote === true
        : null;
  const totalBranchCount = branchRefState.data?.totalCount ?? 0;
  const branchStatusText = isInitialBranchesLoadPending
    ? "Loading branches…"
    : isFetchingNextPage
      ? "Loading more branches…"
      : hasNextPage && refs.length > 0
        ? `Showing ${refs.length} of ${totalBranchCount} branches`
        : null;

  // ---------------------------------------------------------------------------
  // Branch actions
  // ---------------------------------------------------------------------------
  const copyBranchName = useCallback((branchName: string) => {
    void writeTextToClipboard(branchName, "branch name").then(
      (didCopy) => {
        if (!didCopy) return;
        toastManager.add({
          type: "success",
          title: "Branch name copied",
          description: branchName,
        });
      },
      (error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to copy branch name",
            description: toBranchActionErrorMessage(error),
          }),
        );
      },
    );
  }, []);

  const handleBranchContextMenu = useCallback(
    (event: ReactMouseEvent, branchName: string | null) => {
      if (!branchName) return;
      const api = readLocalApi();
      if (!api) return;
      event.preventDefault();
      event.stopPropagation();
      const items: ContextMenuItem<"copy-branch-name">[] = [
        { id: "copy-branch-name", label: "Copy branch name", icon: "copy" },
      ];
      void api.contextMenu.show(items, { x: event.clientX, y: event.clientY }).then((action) => {
        if (action === "copy-branch-name") copyBranchName(branchName);
      });
    },
    [copyBranchName],
  );

  // Default the worktree base to the repo default branch (origin/HEAD), only
  // falling back to the checked-out branch when no default is known.
  const defaultBranchName = useMemo(
    () => refs.find((refName) => refName.isDefault)?.name ?? null,
    [refs],
  );
  const worktreeBaseBranchCandidate = isInitialBranchesLoadPending
    ? null
    : (defaultBranchName ?? resolvedActiveBranch);

  useEffect(() => {
    if (
      effectiveEnvMode !== "worktree" ||
      activeWorktreePath ||
      activeThreadBranch ||
      !worktreeBaseBranchCandidate
    ) {
      return;
    }
    setThreadBranch(worktreeBaseBranchCandidate, null);
  }, [
    activeThreadBranch,
    activeWorktreePath,
    effectiveEnvMode,
    setThreadBranch,
    worktreeBaseBranchCandidate,
  ]);

  // ---------------------------------------------------------------------------
  // Combobox / list plumbing
  // ---------------------------------------------------------------------------
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsBranchMenuOpen(open);
      if (!open) {
        setBranchQuery("");
        return;
      }
      branchRefState.refresh();
    },
    [branchRefState.refresh],
  );

  const branchListScrollElementRef = useRef<HTMLElement | null>(null);
  const [showTopBranchScrollFade, setShowTopBranchScrollFade] = useState(false);
  const [showBottomBranchScrollFade, setShowBottomBranchScrollFade] = useState(false);
  const fetchNextBranchPage = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) {
      return;
    }

    branchRefState.loadNext();
  }, [branchRefState.loadNext, hasNextPage, isFetchingNextPage]);
  const maybeFetchNextBranchPage = useCallback(() => {
    if (!isBranchMenuOpen || !hasNextPage || isFetchingNextPage) {
      return;
    }

    const scrollElement = branchListScrollElementRef.current;
    if (!scrollElement) {
      return;
    }

    const distanceFromBottom =
      scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
    if (distanceFromBottom > 96) {
      return;
    }

    fetchNextBranchPage();
  }, [fetchNextBranchPage, hasNextPage, isBranchMenuOpen, isFetchingNextPage]);

  const branchListRef = useRef<LegendListRef | null>(null);
  const updateBranchListScrollFades = useCallback(() => {
    const scrollElement = branchListRef.current?.getScrollableNode?.();
    if (!(scrollElement instanceof HTMLElement)) {
      return;
    }
    branchListScrollElementRef.current = scrollElement;
    const maxScrollOffset = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
    setShowTopBranchScrollFade(scrollElement.scrollTop > 1);
    setShowBottomBranchScrollFade(maxScrollOffset - scrollElement.scrollTop > 1);
  }, []);

  useLayoutEffect(() => {
    if (!isBranchMenuOpen) {
      return;
    }

    setShowTopBranchScrollFade(false);
    setShowBottomBranchScrollFade(filteredBranchPickerItems.length > 8);
    let nestedFrame = 0;
    const frame = requestAnimationFrame(() => {
      updateBranchListScrollFades();
      nestedFrame = requestAnimationFrame(updateBranchListScrollFades);
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(nestedFrame);
    };
  }, [
    deferredTrimmedBranchQuery,
    filteredBranchPickerItems.length,
    isBranchMenuOpen,
    updateBranchListScrollFades,
  ]);

  useEffect(() => {
    if (!isBranchMenuOpen) {
      return;
    }

    void branchListRef.current?.scrollToOffset?.({ offset: 0, animated: false });
  }, [deferredTrimmedBranchQuery, isBranchMenuOpen]);

  useEffect(() => {
    maybeFetchNextBranchPage();
  }, [refs.length, maybeFetchNextBranchPage]);

  const triggerLabel = resolveBranchTriggerLabel({
    activeWorktreePath,
    effectiveEnvMode,
    resolvedActiveBranch,
    resolvedActiveBranchIsRemote,
    startFromOrigin,
  });

  // PR pill shown next to the branch selector when the active branch has one.
  const branchPr = resolveThreadPr({
    threadBranch: resolveBranchToolbarPrBranch({
      activeThreadBranch,
      resolvedActiveBranch,
    }),
    gitStatus: branchStatus,
  });
  const branchPrStatus = prStatusIndicator(branchPr, branchStatus?.sourceControlProvider);
  // Action-oriented tooltip (the pill opens the PR), distinct from the sidebar's
  // state-description tooltip.
  const branchPrTooltip = branchPr
    ? `Open ${sourceControlPresentation.terminology.singular} #${branchPr.number} (${branchPr.state}) in browser`
    : "";
  const openPrLink = useOpenPrLink();

  // A plain folder has no refs to pick from, so the chip that would normally
  // open the branch picker instead names the actual state — silence here is
  // the one thing this strip can't afford, since it exists to answer "where
  // is this about to run" — and opens the same init action as the
  // environment column's "Initialize Git repository" row.
  if (!isRepo) {
    return (
      <div className={cn("flex min-w-0 items-center gap-1", className)}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="xs"
                disabled={isInitPending}
                onClick={initRepository}
                className="min-w-0 max-w-full text-muted-foreground/70 hover:text-foreground/80"
              />
            }
          >
            {isInitPending ? (
              <Spinner aria-hidden className="size-3 shrink-0" />
            ) : (
              <GitBranchPlusIcon aria-hidden className="size-3 shrink-0 opacity-70" />
            )}
            <span className="min-w-0 max-w-[240px] truncate">
              {isInitPending ? "Initializing Git…" : "Not a Git repository"}
            </span>
          </TooltipTrigger>
          <TooltipPopup side="top">
            {isInitPending ? "Initializing…" : "Initialize a Git repository for this folder"}
          </TooltipPopup>
        </Tooltip>
      </div>
    );
  }

  function renderPickerItem(itemValue: string, index: number) {
    if (checkoutPullRequestItemValue && itemValue === checkoutPullRequestItemValue) {
      return (
        <ComboboxItem
          hideIndicator
          key={itemValue}
          index={index}
          value={itemValue}
          className="pe-2"
          onClick={() => {
            if (!prReference || !onCheckoutPullRequestRequest) {
              return;
            }
            setIsBranchMenuOpen(false);
            setBranchQuery("");
            onComposerFocusRequest?.();
            onCheckoutPullRequestRequest(prReference);
          }}
        >
          <div className="flex min-w-0 items-center gap-2 py-1">
            <SourceControlIcon className="size-(--chat-picker-icon-size) shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-col items-start">
              <span className="truncate font-medium">
                Checkout {sourceControlPresentation.terminology.singular}
              </span>
              <span className="truncate text-(length:--text-caption) text-muted-foreground">
                {prReference}
              </span>
            </span>
          </div>
        </ComboboxItem>
      );
    }
    if (createBranchItemValue && itemValue === createBranchItemValue) {
      return (
        <ComboboxItem
          hideIndicator
          key={itemValue}
          index={index}
          value={itemValue}
          className="pe-1.5"
          onClick={() => createRef(trimmedBranchQuery)}
        >
          <div className="flex min-w-0 items-center gap-(--popup-item-gap)">
            <GitBranchPlusIcon
              aria-hidden
              className="size-(--chat-picker-icon-size) shrink-0 text-muted-foreground"
            />
            <span className="truncate">Create new ref &quot;{trimmedBranchQuery}&quot;</span>
          </div>
        </ComboboxItem>
      );
    }

    const refName = branchByName.get(itemValue);
    if (!refName) return null;

    const hasSecondaryWorktree =
      refName.worktreePath && activeProjectCwd && refName.worktreePath !== activeProjectCwd;
    const badge = hasSecondaryWorktree
      ? "worktree"
      : refName.isRemote
        ? "remote"
        : refName.isDefault
          ? "default"
          : null;
    return (
      <ComboboxItem
        hideIndicator
        key={itemValue}
        index={index}
        value={itemValue}
        className="pe-1.5"
        onClick={() => selectBranch(refName)}
        onContextMenu={(event) => handleBranchContextMenu(event, itemValue)}
      >
        <div className="flex w-full min-w-0 items-center gap-(--popup-item-gap)">
          <GitBranchIcon
            aria-hidden
            className="size-(--chat-picker-icon-size) shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 flex-1 truncate">{itemValue}</span>
          {refName.current ? (
            <CheckIcon
              aria-hidden
              className="size-(--chat-picker-icon-size) shrink-0 text-muted-foreground"
            />
          ) : badge ? (
            <span className="shrink-0 text-(length:--text-caption) text-muted-foreground">
              {badge}
            </span>
          ) : null}
        </div>
      </ComboboxItem>
    );
  }

  return (
    <Combobox
      items={branchPickerItems}
      filteredItems={filteredBranchPickerItems}
      autoHighlight
      virtualized
      onItemHighlighted={(_value, eventDetails) => {
        if (!isBranchMenuOpen || eventDetails.index < 0 || eventDetails.reason !== "keyboard") {
          return;
        }
        void branchListRef.current?.scrollIndexIntoView?.({
          index: eventDetails.index,
          animated: false,
        });
      }}
      onOpenChange={handleOpenChange}
      open={isBranchMenuOpen}
      value={resolvedActiveBranch}
    >
      <div className={cn("flex min-w-0 items-center gap-1", className)}>
        {branchPr && branchPrStatus ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={branchPrTooltip}
                  onClick={(event) => openPrLink(event, branchPrStatus.url)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-(length:--text-caption) font-medium tabular-nums transition-colors hover:bg-muted/60",
                    branchPrStatus.colorClass,
                  )}
                />
              }
            >
              <ChangeRequestStatusIcon className="size-3" />
              <span>#{branchPr.number}</span>
            </TooltipTrigger>
            <TooltipPopup side="top">{branchPrTooltip}</TooltipPopup>
          </Tooltip>
        ) : null}
        {/* Context menu lives on the wrapper: the disabled Button has
            pointer-events-none, so the trigger itself never sees right-clicks
            while refs are loading or a branch action is pending. */}
        <span
          className="flex min-w-0"
          onContextMenu={(event) => handleBranchContextMenu(event, resolvedActiveBranch)}
        >
          <ComboboxTrigger
            render={<Button variant="ghost" size="xs" />}
            className="min-w-0 max-w-full text-muted-foreground/70 hover:text-foreground/80"
            disabled={isInitialBranchesLoadPending || isBranchActionPending}
          >
            <GitBranchIcon className="size-3 shrink-0 opacity-70" />
            <span className="shrink-0 whitespace-nowrap">{triggerLabel}</span>
            <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
          </ComboboxTrigger>
        </span>
      </div>
      {/* Starts at the trigger's left edge, like every other chip in the
          context strip. This one opened to the right while its neighbours
          opened left, which read as two different menus. */}
      <ComboboxPopup align="start" side="top" className="flex w-(--chat-ref-picker-width) flex-col">
        <div className="shrink-0 px-(--popup-item-padding-inline) pt-(--popup-padding)">
          <div className="relative -translate-y-px border-b border-border/70 pb-1.5 transition-colors focus-within:border-ring">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1.5 left-0 size-(--chat-picker-icon-size) shrink-0 text-muted-foreground/55"
            />
            <ComboboxInput
              className="[&_input]:h-6.5 [&_input]:ps-5 [&_input]:font-sans [&_input]:leading-6.5"
              inputClassName="rounded-none bg-transparent text-(length:--text-ui)"
              placeholder="Search refs..."
              showTrigger={false}
              size="sm"
              unstyled
              value={branchQuery}
              onChange={(event) => setBranchQuery(event.target.value)}
            />
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {!isInitialBranchesLoadPending ? <ComboboxEmpty>No branches found.</ComboboxEmpty> : null}
          <ComboboxGroup className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {hasFilteredBranchRows ? (
              <ComboboxGroupLabel className="shrink-0 px-(--popup-item-padding-inline) pt-2 pb-1 text-(length:--text-caption)">
                Branches
              </ComboboxGroupLabel>
            ) : null}
            <div className="relative min-h-(--chat-ref-list-min-height) w-full max-h-(--chat-ref-list-max-height) flex-1 overflow-hidden">
              <ComboboxListVirtualized className="size-full min-w-0 p-0">
                <LegendList<string>
                  ref={branchListRef}
                  data={filteredBranchPickerItems}
                  keyExtractor={(item) => item}
                  getItemType={(item) =>
                    item === checkoutPullRequestItemValue
                      ? "checkout-pull-request"
                      : item === createBranchItemValue
                        ? "create-branch"
                        : "branch"
                  }
                  renderItem={({ item, index }) => renderPickerItem(item, index)}
                  estimatedItemSize={28}
                  drawDistance={336}
                  onEndReached={() => {
                    if (hasNextPage && !isFetchingNextPage) {
                      fetchNextBranchPage();
                    }
                  }}
                  onLayout={() => {
                    updateBranchListScrollFades();
                    maybeFetchNextBranchPage();
                  }}
                  onScroll={() => {
                    updateBranchListScrollFades();
                    maybeFetchNextBranchPage();
                  }}
                  className={cn(
                    "scrollbar-gutter-stable overflow-x-hidden overscroll-y-contain px-(--popup-padding) pt-1 pb-(--popup-padding) [--fade-size:1.5rem]",
                    showTopBranchScrollFade && "mask-t-from-[calc(100%-var(--fade-size))]",
                    showBottomBranchScrollFade && "mask-b-from-[calc(100%-var(--fade-size))]",
                  )}
                  style={{ maxHeight: "var(--chat-ref-list-max-height)" }}
                />
              </ComboboxListVirtualized>
            </div>
          </ComboboxGroup>
          {isSelectingWorktreeBase ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <label
                    htmlFor={startFromOriginSwitchId}
                    className="mx-(--popup-padding) flex cursor-pointer items-center justify-between gap-(--popup-item-gap) border-t border-border px-(--popup-item-padding-inline) py-(--popup-padding) text-(length:--text-caption)"
                  >
                    <span className="min-w-0 truncate text-muted-foreground">
                      Start from origin
                    </span>
                    <Switch
                      id={startFromOriginSwitchId}
                      checked={startFromOrigin}
                      className="[--thumb-size:--spacing(3.5)]"
                      aria-label="Start worktree from origin"
                      onCheckedChange={(checked) => onStartFromOriginChange(Boolean(checked))}
                    />
                  </label>
                }
              />
              <TooltipPopup side="top" className="max-w-72 whitespace-normal leading-tight">
                Creates the worktree from the latest matching branch on origin instead of your local
                branch.
              </TooltipPopup>
            </Tooltip>
          ) : null}
          {branchStatusText ? (
            <ComboboxStatus className="py-(--popup-padding) text-(length:--text-caption)">
              {branchStatusText}
            </ComboboxStatus>
          ) : null}
        </div>
      </ComboboxPopup>
    </Combobox>
  );
}
