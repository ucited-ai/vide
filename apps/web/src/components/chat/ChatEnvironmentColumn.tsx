import { scopeThreadRef } from "@vide/client-runtime/environment";
import type { EnvironmentId, ThreadId, VcsRef } from "@vide/contracts";
import {
  ArrowLeftIcon,
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CloudUploadIcon,
  FileDiffIcon,
  FolderGit2Icon,
  FolderIcon,
  GitBranchIcon,
  GitBranchPlusIcon,
  GlobeIcon,
  MoreHorizontalIcon,
  SearchIcon,
} from "lucide-react";
import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { type DraftId } from "~/composerDraftStore";
import { keepPrintableKeysInField } from "~/lib/menuTypeahead";
import { cn } from "~/lib/utils";
import type { WorkLogWebSource } from "../../session-logic";
import type { SubagentSummary } from "../../subagentActivity";
import { usePaginatedBranches } from "~/state/queries";
import ChatMarkdown from "../ChatMarkdown";
import { resolveLockedWorkspaceLabel } from "../BranchToolbar.logic";
import { useThreadBranchSelection } from "../BranchToolbarBranchSelector";
import { GitActionItemIcon, GitQuickActionIcon, useGitActions } from "../GitActionsControl";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuRow, MenuTrigger, menuRowVariants } from "../ui/menu";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { DiffStatLabel } from "./DiffStatLabel";
import { WorkCallExpandedDetails } from "./WorkGroupRow";

interface ChatEnvironmentColumnProps {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  draftId?: DraftId;
  gitCwd: string | null;
  /** The panel stays mounted at all times, so both directions animate. */
  open: boolean;
  fullAreaHidden: boolean;
  onClose: () => void;
  /** Opens the review surface in the right panel, or `null` where review is not
   *  available — a draft thread, or a workspace that is not a Git repository. */
  onOpenReview: (() => void) | null;
  subagents: ReadonlyArray<SubagentSummary>;
  selectedSubagentId: string | null;
  onSelectSubagent: (agentId: string | null) => void;
  webSources: ReadonlyArray<WorkLogWebSource>;
  resolvedTheme: "light" | "dark";
}

/**
 * Stands in for a reading the panel cannot answer yet — a diff stat, a pull
 * request — while the ref it describes is being switched underneath it.
 */
function ReadingSkeleton() {
  return <Skeleton className="h-3 w-14 rounded-full motion-reduce:animate-none" />;
}

/*
 * One bar per row, enough of them to fill the ceiling the loaded list settles
 * at.
 *
 * The loading path used to be a bare "Loading branches…" line, so the popup
 * opened at the floor its own surface sets and then grew past it the moment the
 * refs arrived — by the search field's height at the very least, and by the
 * whole span between floor and ceiling on any repository with more refs than
 * fit. Reserving the ceiling from the first frame is what makes the two states
 * the same size — and a search lands here too, since retargeting the query
 * starts over with no pages. Widths vary so the bars read as ref names, and stay
 * distinct so each row keys off its own.
 */
const REF_SKELETON_LABEL_WIDTHS = [
  "w-8/12",
  "w-5/12",
  "w-10/12",
  "w-6/12",
  "w-11/12",
  "w-4/12",
  "w-9/12",
  "w-7/12",
];

function EnvironmentBranchListSkeleton() {
  return (
    // A height, not a floor, and clipped rather than scrollable: there is
    // nothing below these bars to scroll to.
    <div aria-busy="true" className="h-(--chat-ref-list-max-height) overflow-hidden">
      <span className="sr-only" role="status">
        Loading branches…
      </span>
      {REF_SKELETON_LABEL_WIDTHS.map((labelWidth) => (
        <div
          aria-hidden
          key={labelWidth}
          className="flex min-h-(--popup-item-height) items-center gap-(--popup-item-gap) px-(--popup-item-padding-inline) py-1"
        >
          <Skeleton className="size-(--chat-picker-icon-size) shrink-0 motion-reduce:animate-none" />
          <Skeleton className={cn("h-3 rounded-full motion-reduce:animate-none", labelWidth)} />
        </div>
      ))}
    </div>
  );
}

/**
 * The refs this thread can move to. Mounted only while the branch picker is
 * open, so the ref list is not fetched until someone asks for it.
 */
function EnvironmentBranchList({
  environmentId,
  branchCwd,
  activeBranch,
  query,
  onSelectBranch,
}: {
  environmentId: EnvironmentId;
  branchCwd: string | null;
  activeBranch: string | null;
  query: string;
  onSelectBranch: (refName: VcsRef) => void;
}) {
  const branchRefTarget = useMemo(
    () => ({ environmentId, cwd: branchCwd, query }),
    [branchCwd, environmentId, query],
  );
  const branchRefState = usePaginatedBranches(branchRefTarget);
  const refs = branchRefState.refs;
  const hasNextPage =
    branchRefState.data?.nextCursor !== null && branchRefState.data?.nextCursor !== undefined;

  if (refs.length === 0) {
    if (branchRefState.isInitialLoad) return <EnvironmentBranchListSkeleton />;
    // The floor, so a repository with no refs is not a popup the size of the
    // sentence saying so.
    return (
      <div className="min-h-(--chat-ref-list-min-height)">
        <MenuItem disabled>No branches found</MenuItem>
      </div>
    );
  }

  /*
   * Ten rows, then scroll. Rendering every ref made this popup taller than the
   * window on any repo with real history, which is the one shape a picker must
   * never take. The branch picker above the composer caps the same way.
   */
  return (
    <div className="min-h-(--chat-ref-list-min-height) max-h-(--chat-ref-list-max-height) overflow-y-auto overscroll-contain">
      {refs.map((refName) => (
        <MenuItem key={refName.name} onClick={() => onSelectBranch(refName)}>
          <GitBranchIcon aria-hidden className="size-(--chat-picker-icon-size)" />
          <span className="min-w-0 flex-1 truncate">{refName.name}</span>
          {refName.name === activeBranch ? (
            <CheckIcon aria-hidden className="ms-auto size-3.5 shrink-0" />
          ) : refName.isRemote || refName.isDefault ? (
            <span className="ms-auto shrink-0 text-(length:--text-caption) text-muted-foreground">
              {refName.isRemote ? "remote" : "default"}
            </span>
          ) : null}
        </MenuItem>
      ))}
      {hasNextPage ? (
        <MenuItem
          closeOnClick={false}
          disabled={branchRefState.isLoadingMore}
          className="text-(length:--text-caption) text-muted-foreground"
          onClick={(event) => {
            event.preventDefault();
            branchRefState.loadNext();
          }}
        >
          {branchRefState.isLoadingMore ? <Spinner aria-hidden /> : null}
          {branchRefState.isLoadingMore ? "Loading more branches…" : "Load more branches"}
        </MenuItem>
      ) : null}
    </div>
  );
}

/**
 * The branch row doubles as the trigger for a small popup listing refs — the
 * one piece of this column that stays a transient menu, since picking a
 * branch is an occasional action rather than something to keep on screen.
 */
function EnvironmentBranchRow({
  environmentId,
  branchCwd,
  activeBranch,
  branchLabel,
  pending,
  onSelectBranch,
}: {
  environmentId: EnvironmentId;
  branchCwd: string | null;
  activeBranch: string | null;
  branchLabel: string;
  /** A switch this row started is still running. The label is already the ref
   *  being moved to, so the row reports progress rather than restating it. */
  pending: boolean;
  onSelectBranch: (refName: VcsRef) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!pickerOpen) return;
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [pickerOpen]);

  return (
    <Menu
      open={pickerOpen}
      onOpenChange={(open) => {
        setPickerOpen(open);
        if (!open) setQuery("");
      }}
    >
      <MenuTrigger
        disabled={pending}
        render={
          <button
            type="button"
            className={cn(menuRowVariants({ variant: "button" }), "data-popup-open:bg-accent")}
          />
        }
      >
        {pending ? <Spinner aria-hidden /> : <GitBranchIcon aria-hidden />}
        <span className="min-w-0 flex-1 truncate">{branchLabel}</span>
        <ChevronDownIcon aria-hidden className="ms-auto size-3.5 shrink-0 opacity-50" />
      </MenuTrigger>
      {/* Opens toward the chat. Anchored below its row it covered the rest of
          the panel it belongs to, so choosing a branch hid the environment you
          were choosing it for. */}
      <MenuPopup
        side="left"
        align="start"
        className="min-h-(--chat-ref-list-min-height) w-(--chat-picker-width)"
      >
        <div className="flex items-center gap-(--popup-item-gap) border-b border-border px-(--popup-item-padding-inline)">
          <SearchIcon
            aria-hidden
            className="size-(--chat-picker-icon-size) shrink-0 text-muted-foreground"
          />
          <Input
            ref={searchInputRef}
            unstyled
            size="sm"
            aria-label="Search branches"
            placeholder="Search branches…"
            className="min-w-0 flex-1 [&_input]:bg-transparent [&_input]:px-0 [&_input]:text-(length:--text-ui)"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={keepPrintableKeysInField}
          />
        </div>
        <EnvironmentBranchList
          environmentId={environmentId}
          branchCwd={branchCwd}
          activeBranch={activeBranch}
          query={deferredQuery}
          onSelectBranch={(refName) => {
            setPickerOpen(false);
            onSelectBranch(refName);
          }}
        />
      </MenuPopup>
    </Menu>
  );
}

/**
 * The rows a ref switch invalidates, held back for as long as it runs.
 *
 * A checkout leaves the diff stat, the worktree path, the recommended action and
 * the pull request all describing the ref the thread has just left, and the git
 * query only catches up once the switch settles. So the group steps back and
 * stops taking input, rather than inviting an action against a tree that is
 * moving underneath it.
 */
function EnvironmentPendingGroup({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "transition-opacity duration-(--duration-base) ease-(--ease-soft) motion-reduce:transition-none",
        pending && "opacity-64",
      )}
      // Same reason the collapsed column uses it: rows that read as out of
      // service must not still answer Tab and clicks.
      {...(pending ? { inert: true } : {})}
    >
      {children}
    </div>
  );
}

/**
 * Everything a thread runs against — its worktree, its ref, and the git actions
 * that move it forward — as a panel over the right of the chat pane, in place
 * of the dropdown this replaced. Stays mounted so it animates in both
 * directions, and transform carries it over the chat either way.
 */
export const ChatEnvironmentColumn = memo(function ChatEnvironmentColumn({
  environmentId,
  threadId,
  draftId,
  gitCwd,
  open,
  fullAreaHidden,
  onClose,
  onOpenReview,
  subagents,
  selectedSubagentId,
  onSelectSubagent,
  webSources,
  resolvedTheme,
}: ChatEnvironmentColumnProps) {
  const visibleOpen = open && !fullAreaHidden;

  /*
   * The git query outlives the closing animation, and the panel itself reports
   * when that is over.
   *
   * Switching the query off in the same frame the slide starts made the rows
   * fall back to their empty readings — "No changes", "Git status is
   * unavailable" — so the panel spent its whole exit animating a version of
   * itself nobody asked to see. The work still stops when the panel is gone; it
   * just stops after it is gone. `transitionend` rather than a timer, because a
   * timer would be a second copy of a duration that lives in CSS.
   */
  const [exitSettled, setExitSettled] = useState(!visibleOpen);
  useEffect(() => {
    if (visibleOpen) setExitSettled(false);
  }, [visibleOpen]);

  /*
   * Escape closes the panel from anywhere, not only from inside it.
   *
   * Opening the panel does not move focus into it, so the keydown handler on the
   * wrapper below only ever fired if the user had already tabbed in — which left
   * the keyboard with no way out of an open panel. `defaultPrevented` keeps a
   * dialog or popup layered above this one from being dismissed twice: whatever
   * is on top handles Escape first and marks it.
   */
  useEffect(() => {
    if (!visibleOpen) return;
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      onClose();
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [onClose, visibleOpen]);
  const activeThreadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const git = useGitActions({
    gitCwd,
    activeThreadRef,
    enabled: visibleOpen || !exitSettled,
    ...(draftId ? { draftId } : {}),
  });
  /*
   * No `onBranchActionSettled`. This panel used to refresh the git status itself
   * once a branch action settled, which duplicated work the server already does:
   * every VCS mutation the callback could follow — switchRef, createRef,
   * createWorktree, removeWorktree — ends in a server-side `refreshGitStatus`
   * that broadcasts the new status to us (apps/server/src/ws.ts). Asking again
   * from here bought nothing and added a query to the moment the UI was busiest.
   * The chat bar still passes the callback, because there it reconciles the ref
   * *list* — a different thing, which no broadcast covers.
   */
  const branch = useThreadBranchSelection({
    environmentId,
    threadId,
    envLocked: false,
    ...(draftId ? { draftId } : {}),
  });

  // Refreshes the moment the column opens, the way the dropdown menu it
  // replaced refreshed on every open. The column now stays mounted while
  // closed, so this only needs to fire on the closed -> open edge.
  const wasOpenRef = useRef(visibleOpen);
  useEffect(() => {
    if (visibleOpen && !wasOpenRef.current) {
      git.refreshStatus();
    }
    wasOpenRef.current = visibleOpen;
  }, [visibleOpen, git.refreshStatus]);

  const SourceControlIcon = git.sourceControlPresentation.Icon;
  const pullRequestItem = git.menuItems.find((item) => item.id === "pr") ?? null;
  /*
   * The quick action already spells out the recommended next step, so a row
   * repeating it under the same label would just be the same button twice.
   * Commit drops out for the same reason rather than a different one: it is
   * actionable only while the working tree has changes, and in exactly that
   * state the quick action is already one of the commit variants.
   */
  const secondaryItems = git.menuItems.filter(
    (item) => item.id !== "commit" && item.id !== "pr" && item.label !== git.quickAction.label,
  );
  const pullRequest = git.gitStatus?.pr ?? null;
  /*
   * A checkout in flight, and nothing else. The branch hook already runs its
   * mutations inside a transition, so this is the switch's own duration rather
   * than a guess at how long a git command takes — which is why the panel can
   * step back for exactly as long as its readings are wrong.
   */
  const isSwitchingRef = branch.isBranchActionPending;
  const changedFileCaption =
    git.changedFileCount > 0
      ? `${git.changedFileCount} file${git.changedFileCount === 1 ? "" : "s"}`
      : "No changes";
  /*
   * Lines, not files. A file count tells you how far you will scroll; "+412 −8"
   * tells you how much there is to read, which is what you are actually weighing
   * before you open a review. Binary-only changes report no lines at all, so
   * those keep the file count rather than claiming nothing happened.
   */
  const workingTree = git.gitStatus?.workingTree ?? null;
  const changesCaption = isSwitchingRef ? (
    <ReadingSkeleton />
  ) : workingTree && workingTree.insertions + workingTree.deletions > 0 ? (
    <DiffStatLabel
      additions={workingTree.insertions}
      deletions={workingTree.deletions}
      layout="inline"
    />
  ) : (
    changedFileCaption
  );
  const workspaceLabel = resolveLockedWorkspaceLabel(branch.activeWorktreePath);
  const WorkspaceIcon = branch.activeWorktreePath ? FolderGit2Icon : FolderIcon;
  const branchLabel = branch.resolvedActiveBranch ?? "No ref";
  const showPublishRow = git.canPublishRepository && git.quickAction.kind !== "open_publish";
  const selectedSubagent =
    subagents.find((agent) => agent.agent.agentId === selectedSubagentId) ?? null;
  const runningSubagents = subagents.filter((agent) => agent.status === "running");
  const finishedSubagents = subagents.filter((agent) => agent.status !== "running");
  const [allSourcesOpen, setAllSourcesOpen] = useState(false);

  return (
    <>
      {/*
        Always a layer, never a column. The room the panel needs is ceded by the
        chat as its own end padding (`--chat-column-end-reserve` in ChatView),
        so the timeline's scroller — and its native scrollbar — keeps the full
        pane width. This zero-wide wrapper only marks the right edge the
        surface hangs from.
      */}
      <div
        className="relative z-40 h-full min-h-0 w-0 min-w-0 self-stretch overflow-visible"
        // Collapsed but mounted, it must not be reachable: without this, Tab
        // walks into a panel nobody can see.
        {...(!visibleOpen ? { inert: true } : {})}
        data-environment-column-open={visibleOpen ? "true" : "false"}
        data-environment-column-full-area-hidden={fullAreaHidden ? "true" : "false"}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) {
            onClose();
          }
        }}
      >
        <div
          onTransitionEnd={(event) => {
            if (event.target !== event.currentTarget || event.propertyName !== "opacity") return;
            if (!visibleOpen) setExitSettled(true);
          }}
          className={cn(
            "absolute top-(--envcol-inset) end-(--envcol-inset-end) flex max-h-[calc(100%-2*var(--envcol-inset))] w-[calc(var(--envcol-width)-var(--envcol-inset-end)-var(--envcol-inset-start))] min-h-0 flex-col overflow-hidden rounded-[var(--envcol-radius)] border border-(--envcol-edge) bg-(--envcol-surface) shadow-[var(--envcol-shadow)]",
            /*
             * Grows out of the corner it is pinned to, so the motion reads as
             * the panel arriving from the right edge rather than as a block
             * being pushed across whatever is underneath it.
             */
            /*
             * `translate` and `scale`, not `transform`. Tailwind v4 compiles
             * those utilities to the individual CSS properties of the same
             * name, so a transition list naming `transform` covers neither —
             * which is why this panel used to jump to its offset, stand there
             * for the duration, and only then blink out.
             */
            "origin-top-right transition-[opacity,translate,scale,visibility] duration-(--duration-base) ease-(--ease-soft)",
            visibleOpen
              ? "visible translate-x-0 scale-100 opacity-100"
              : "invisible translate-x-(--envcol-enter-offset) scale-(--envcol-enter-scale) opacity-0",
          )}
          data-environment-column-surface
          aria-label="Environment overview"
          role="region"
        >
          {/* The rows establish the window's natural height, then shrink into
              an internal scroller when the available workspace is exhausted. */}
          <div className="min-h-0 flex-auto overflow-y-auto p-(--popup-padding)">
            {selectedSubagent ? (
              <SubagentDetail
                agent={selectedSubagent}
                environmentId={environmentId}
                gitCwd={gitCwd}
                onBack={() => onSelectSubagent(null)}
                resolvedTheme={resolvedTheme}
                threadId={threadId}
              />
            ) : (
              <>
                <div>
                  <MenuRow variant="static" label="Environment" tone="heading" />
                  {!git.isRepo ? (
                    <>
                      <MenuRow
                        variant="static"
                        icon={<GitBranchPlusIcon aria-hidden />}
                        label="Not a Git repository"
                        tone="muted"
                      />
                      <MenuRow
                        icon={
                          git.isInitPending ? (
                            <Spinner aria-hidden />
                          ) : (
                            <GitBranchPlusIcon aria-hidden />
                          )
                        }
                        label={
                          git.isInitPending ? "Initializing Git…" : "Initialize Git repository"
                        }
                        disabled={git.isInitPending}
                        onClick={git.initRepository}
                      />
                    </>
                  ) : (
                    <>
                      {/*
                       * Reading the diff, not committing it. This row used to open
                       * the commit dialog, which put the one surface built for
                       * reading a change behind a dialog built for shipping it —
                       * and committing is already the quick action below, so
                       * nothing is lost by letting this row mean review.
                       *
                       * It is also the only row here that navigates rather than
                       * acting in place, so it is the only one the column steps
                       * aside for: opening the right panel auto-collapses this
                       * column, which is why it needs no explicit close.
                       */}
                      <EnvironmentPendingGroup pending={isSwitchingRef}>
                        <MenuRow
                          icon={<FileDiffIcon aria-hidden />}
                          label="Changes"
                          caption={changesCaption}
                          disabled={onOpenReview === null}
                          {...(onOpenReview ? { onClick: onOpenReview } : {})}
                        />
                        <MenuRow
                          variant="static"
                          icon={<WorkspaceIcon aria-hidden />}
                          label={workspaceLabel}
                          caption={branch.activeWorktreePath}
                          tone="muted"
                        />
                      </EnvironmentPendingGroup>
                      <EnvironmentBranchRow
                        environmentId={environmentId}
                        branchCwd={branch.branchCwd}
                        activeBranch={branch.resolvedActiveBranch}
                        branchLabel={branchLabel}
                        pending={isSwitchingRef}
                        onSelectBranch={branch.selectBranch}
                      />
                      {/* The advisory lines stay put rather than disappearing for
                      the duration: they are conditioned on the same stale
                      status as everything else here, so hiding them would move
                      the whole panel twice on the way to the same answer. */}
                      <EnvironmentPendingGroup pending={isSwitchingRef}>
                        <MenuRow
                          icon={
                            <GitQuickActionIcon
                              quickAction={git.quickAction}
                              SourceControlIcon={SourceControlIcon}
                            />
                          }
                          label={git.quickAction.label}
                          caption={git.quickActionDisabledReason}
                          disabled={git.isBusy || git.quickAction.disabled}
                          onClick={git.runQuickAction}
                        />
                        {secondaryItems.map((item) => (
                          <MenuRow
                            key={`${item.id}-${item.label}`}
                            icon={
                              <GitActionItemIcon
                                icon={item.icon}
                                SourceControlIcon={SourceControlIcon}
                              />
                            }
                            label={item.label}
                            caption={git.menuItemDisabledReason(item)}
                            disabled={item.disabled}
                            onClick={() => {
                              git.runMenuItem(item);
                            }}
                          />
                        ))}
                        {pullRequestItem ? (
                          <MenuRow
                            icon={
                              <GitActionItemIcon
                                icon={pullRequestItem.icon}
                                SourceControlIcon={SourceControlIcon}
                              />
                            }
                            label={pullRequestItem.label}
                            caption={
                              isSwitchingRef ? (
                                <ReadingSkeleton />
                              ) : pullRequest ? (
                                `#${pullRequest.number} ${pullRequest.state}`
                              ) : (
                                git.menuItemDisabledReason(pullRequestItem)
                              )
                            }
                            disabled={pullRequestItem.disabled}
                            onClick={() => {
                              git.runMenuItem(pullRequestItem);
                            }}
                          />
                        ) : null}
                        {showPublishRow ? (
                          <MenuRow
                            icon={<CloudUploadIcon aria-hidden />}
                            label="Publish repository"
                            disabled={git.isBusy}
                            onClick={git.openPublishDialog}
                          />
                        ) : null}
                        {git.gitStatus?.refName === null ? (
                          <MenuRow
                            variant="static"
                            label="Detached HEAD: check out a ref to push or open a pull request."
                            tone="muted"
                          />
                        ) : null}
                        {git.gitStatus &&
                        git.gitStatus.refName !== null &&
                        !git.gitStatus.hasWorkingTreeChanges &&
                        git.gitStatus.behindCount > 0 &&
                        git.gitStatus.aheadCount === 0 ? (
                          <MenuRow
                            variant="static"
                            label="Behind upstream. Pull or rebase first."
                            tone="muted"
                          />
                        ) : null}
                        {git.gitStatusError ? (
                          <MenuRow variant="static" label={git.gitStatusError} tone="destructive" />
                        ) : null}
                      </EnvironmentPendingGroup>
                    </>
                  )}
                </div>
                <div
                  aria-hidden
                  className="mx-(--popup-padding) my-(--popup-padding) h-px bg-border"
                />
                <div>
                  <MenuRow variant="static" label="Subagents" tone="heading" />
                  {subagents.length === 0 ? (
                    <MenuRow
                      icon={<BotIcon aria-hidden />}
                      label="No subagents"
                      tone="muted"
                      variant="static"
                    />
                  ) : (
                    <>
                      <MenuRow
                        variant="static"
                        label={`Running · ${String(runningSubagents.length)}`}
                        tone="heading"
                      />
                      {runningSubagents.map((agent) => (
                        <MenuRow
                          caption={`${String(agent.toolCallCount)} calls`}
                          icon={<BotIcon aria-hidden />}
                          key={agent.agent.agentId}
                          label={agent.name}
                          onClick={() => onSelectSubagent(agent.agent.agentId)}
                        />
                      ))}
                      <MenuRow
                        variant="static"
                        label={`Finished · ${String(finishedSubagents.length)}`}
                        tone="heading"
                      />
                      {finishedSubagents.map((agent) => (
                        <MenuRow
                          caption={`${String(agent.toolCallCount)} calls · ${agent.status}`}
                          icon={
                            agent.status === "failed" ? (
                              <CircleAlertIcon aria-hidden />
                            ) : (
                              <CheckIcon aria-hidden />
                            )
                          }
                          key={agent.agent.agentId}
                          label={agent.name}
                          onClick={() => onSelectSubagent(agent.agent.agentId)}
                        />
                      ))}
                    </>
                  )}
                </div>
                <div
                  aria-hidden
                  className="mx-(--popup-padding) my-(--popup-padding) h-px bg-border"
                />
                <div>
                  <MenuRow variant="static" label="Sources" tone="heading" />
                  {webSources.length === 0 ? (
                    <MenuRow
                      icon={<GlobeIcon aria-hidden />}
                      label="No web sources"
                      tone="muted"
                      variant="static"
                    />
                  ) : (
                    <>
                      {webSources.slice(0, allSourcesOpen ? undefined : 3).map((source) => (
                        <MenuRow
                          icon={<GlobeIcon aria-hidden />}
                          key={source.url}
                          label={source.title ?? source.url}
                          onClick={() => window.open(source.url, "_blank", "noopener,noreferrer")}
                        />
                      ))}
                      {webSources.length > 3 ? (
                        <MenuRow
                          caption={String(webSources.length)}
                          icon={<MoreHorizontalIcon aria-hidden />}
                          label={allSourcesOpen ? "Show less" : "Show all"}
                          onClick={() => setAllSourcesOpen((open) => !open)}
                        />
                      ) : null}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {git.dialogs}
    </>
  );
});

function SubagentDetail({
  agent,
  environmentId,
  gitCwd,
  onBack,
  resolvedTheme,
  threadId,
}: {
  readonly agent: SubagentSummary;
  readonly environmentId: EnvironmentId;
  readonly gitCwd: string | null;
  readonly onBack: () => void;
  readonly resolvedTheme: "light" | "dark";
  readonly threadId: ThreadId;
}) {
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  return (
    <div className="space-y-2">
      <MenuRow
        caption={agent.status}
        icon={<ArrowLeftIcon aria-hidden />}
        label={agent.name}
        onClick={onBack}
      />
      <div className="px-(--popup-item-padding-inline) text-(length:--text-caption) text-(--ink-tertiary)">
        {String(agent.messages.length)} messages · {String(agent.toolCallCount)} tool calls
      </div>
      {agent.messages.map((message) => (
        <section
          className="rounded-(--popup-item-radius) border border-(--edge) bg-(--wash) p-2"
          key={message.id}
        >
          <div className="mb-1 text-(length:--text-caption) text-(--ink-tertiary)">
            {message.role}
          </div>
          <ChatMarkdown
            className="text-foreground"
            cwd={gitCwd ?? undefined}
            text={message.text}
            threadRef={threadRef}
          />
        </section>
      ))}
      {agent.workEntries
        .filter(
          (entry) =>
            entry.itemType !== "collab_agent_tool_call" &&
            !entry.sourceActivityKind?.startsWith("task."),
        )
        .map((entry) => (
          <details className="rounded-(--popup-item-radius) border border-(--edge)" key={entry.id}>
            <summary className="cursor-pointer list-none px-2 py-1.5 font-mono text-(length:--text-caption) text-(--ink-secondary)">
              {entry.rawCommand?.trim() || entry.command?.trim() || entry.toolTitle || entry.label}
            </summary>
            <div className="px-2">
              <WorkCallExpandedDetails
                entry={entry}
                resolvedTheme={resolvedTheme}
                workspaceRoot={gitCwd ?? undefined}
              />
            </div>
          </details>
        ))}
    </div>
  );
}
