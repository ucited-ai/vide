import { scopeThreadRef } from "@vide/client-runtime/environment";
import type { EnvironmentId, ThreadId, VcsRef } from "@vide/contracts";
import {
  BoxIcon,
  CheckIcon,
  ChevronDownIcon,
  CloudUploadIcon,
  FileDiffIcon,
  FolderGit2Icon,
  FolderIcon,
  GitBranchIcon,
  GitBranchPlusIcon,
  GlobeIcon,
  MoreHorizontalIcon,
  SearchIcon,
  XIcon,
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
import { usePaginatedBranches } from "~/state/queries";
import { resolveLockedWorkspaceLabel } from "../BranchToolbar.logic";
import { useThreadBranchSelection } from "../BranchToolbarBranchSelector";
import { GitActionItemIcon, GitQuickActionIcon, useGitActions } from "../GitActionsControl";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";

interface ChatEnvironmentColumnProps {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  draftId?: DraftId;
  gitCwd: string | null;
  /** Width animates between 0 and its resting size, the way the right panel
   *  does — the column stays mounted at all times so both directions animate. */
  open: boolean;
  onClose: () => void;
}

/**
 * Row chrome shared by every plain row in the column. A real `MenuItem` isn't
 * usable here: this column stays on screen, and Base UI's menu items dismiss
 * their menu on activation, which would close the whole column every time a
 * row did something. So rows are plain buttons styled to match, and only the
 * branch picker below — which is genuinely transient — gets a real menu.
 */
const ROW_CLASSNAME =
  "flex min-h-(--popup-item-height) w-full cursor-default select-none items-center gap-(--popup-item-gap) rounded-sm px-(--popup-item-padding-inline) py-1 text-left text-(length:--text-ui) text-foreground outline-none transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-64 [&>svg:not([class*='opacity-'])]:opacity-80 [&>svg:not([class*='size-'])]:size-4 [&>svg:not([class*='text-'])]:text-muted-foreground [&>svg]:pointer-events-none [&>svg]:shrink-0";

/** A section heading. */
function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between gap-2 pe-1">
      <span className="px-(--popup-item-padding-inline) py-1.5 font-medium text-(length:--text-caption) text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

/**
 * One action row. The caption carries whatever the row wants to say quietly —
 * a file count, a pull request state, or the reason the row is unavailable.
 */
function EnvironmentRow({
  icon,
  label,
  caption,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  caption?: string | null;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={ROW_CLASSNAME}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {caption ? (
        <span className="ms-auto max-w-40 shrink-0 truncate text-(length:--text-caption) text-muted-foreground">
          {caption}
        </span>
      ) : null}
    </button>
  );
}

/** A row that reports state rather than offering an action. */
function EnvironmentStatus({
  icon,
  label,
  caption,
  tone = "muted",
}: {
  icon?: ReactNode;
  label: string;
  caption?: string | null;
  tone?: "muted" | "destructive";
}) {
  return (
    <div className="flex min-h-(--popup-item-height) items-center gap-(--popup-item-gap) px-(--popup-item-padding-inline) py-1 text-(length:--text-ui) [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:opacity-80">
      {icon}
      <span
        className={
          tone === "destructive"
            ? "min-w-0 flex-1 text-pretty text-destructive"
            : "min-w-0 flex-1 truncate text-muted-foreground"
        }
      >
        {label}
      </span>
      {caption ? (
        <span className="ms-auto max-w-40 shrink-0 truncate text-(length:--text-caption) text-muted-foreground">
          {caption}
        </span>
      ) : null}
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
    return (
      <MenuItem disabled>{branchRefState.isPending ? "Loading refs..." : "No refs found"}</MenuItem>
    );
  }

  /*
   * Ten rows, then scroll. Rendering every ref made this popup taller than the
   * window on any repo with real history, which is the one shape a picker must
   * never take. The branch picker above the composer caps the same way.
   */
  return (
    <div className="max-h-[calc(10*var(--popup-item-height))] overflow-y-auto overscroll-contain">
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
          disabled={branchRefState.isPending}
          className="text-(length:--text-caption) text-muted-foreground"
          onClick={(event) => {
            event.preventDefault();
            branchRefState.loadNext();
          }}
        >
          {branchRefState.isPending ? <Spinner aria-hidden /> : null}
          {branchRefState.isPending ? "Loading more refs…" : "Load more refs"}
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
  onSelectBranch,
}: {
  environmentId: EnvironmentId;
  branchCwd: string | null;
  activeBranch: string | null;
  branchLabel: string;
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
        render={<button type="button" className={cn(ROW_CLASSNAME, "data-popup-open:bg-accent")} />}
      >
        <GitBranchIcon aria-hidden />
        <span className="min-w-0 flex-1 truncate">{branchLabel}</span>
        <ChevronDownIcon aria-hidden className="ms-auto size-3.5 shrink-0 opacity-50" />
      </MenuTrigger>
      <MenuPopup align="start" className="w-(--chat-picker-width)">
        <div className="flex items-center gap-(--popup-item-gap) border-b border-border px-(--popup-item-padding-inline)">
          <SearchIcon
            aria-hidden
            className="size-(--chat-picker-icon-size) shrink-0 text-muted-foreground"
          />
          <Input
            ref={searchInputRef}
            unstyled
            size="sm"
            aria-label="Search refs"
            placeholder="Search refs…"
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
 * Everything a thread runs against — its worktree, its ref, and the git actions
 * that move it forward — as its own column beside the chat pane, in place of
 * the dropdown this replaced. Stays mounted so it can animate both open and
 * shut; `open` only ever changes its width.
 */
export const ChatEnvironmentColumn = memo(function ChatEnvironmentColumn({
  environmentId,
  threadId,
  draftId,
  gitCwd,
  open,
  onClose,
}: ChatEnvironmentColumnProps) {
  const activeThreadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const git = useGitActions({
    gitCwd,
    activeThreadRef,
    ...(draftId ? { draftId } : {}),
  });
  const branch = useThreadBranchSelection({
    environmentId,
    threadId,
    envLocked: false,
    ...(draftId ? { draftId } : {}),
    onBranchActionSettled: git.refreshStatus,
  });

  // Refreshes the moment the column opens, the way the dropdown menu it
  // replaced refreshed on every open. The column now stays mounted while
  // closed, so this only needs to fire on the closed -> open edge.
  const wasOpenRef = useRef(open);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      git.refreshStatus();
    }
    wasOpenRef.current = open;
  }, [open, git.refreshStatus]);

  const SourceControlIcon = git.sourceControlPresentation.Icon;
  const commitItem = git.menuItems.find((item) => item.id === "commit") ?? null;
  const pullRequestItem = git.menuItems.find((item) => item.id === "pr") ?? null;
  // The quick action already spells out the recommended next step, so a row
  // repeating it under the same label would just be the same button twice.
  const secondaryItems = git.menuItems.filter(
    (item) => item.id !== "commit" && item.id !== "pr" && item.label !== git.quickAction.label,
  );
  const pullRequest = git.gitStatus?.pr ?? null;
  const changedFileCaption =
    git.changedFileCount > 0
      ? `${git.changedFileCount} file${git.changedFileCount === 1 ? "" : "s"}`
      : "No changes";
  const workspaceLabel = resolveLockedWorkspaceLabel(branch.activeWorktreePath);
  const WorkspaceIcon = branch.activeWorktreePath ? FolderGit2Icon : FolderIcon;
  const branchLabel = branch.resolvedActiveBranch ?? "No ref";
  const showPublishRow = git.canPublishRepository && git.quickAction.kind !== "open_publish";

  return (
    <>
      <div
        className={cn(
          "relative h-full min-h-0 min-w-0 self-stretch overflow-hidden",
          "transition-[width] duration-(--duration-base) ease-(--ease-soft)",
        )}
        style={{ width: open ? "var(--envcol-width)" : 0 }}
        // Collapsed but mounted, it must not be reachable: without this, Tab
        // walks into a column nobody can see.
        {...(!open ? { inert: true } : {})}
        data-environment-column-open={open ? "true" : "false"}
      >
        <div className="absolute inset-y-(--envcol-inset) end-(--envcol-inset) flex w-[calc(var(--envcol-width)-2*var(--envcol-inset))] min-h-0 flex-col overflow-hidden rounded-[var(--envcol-radius)] bg-(--envcol-surface)">
          <div className="flex h-(--envcol-header-height) shrink-0 items-center justify-between gap-2 border-b border-border px-2.5">
            <span className="flex min-w-0 items-center gap-1.5 text-(length:--text-ui) font-medium text-foreground">
              <BoxIcon aria-hidden className="size-3.5 shrink-0 opacity-70" />
              <span className="truncate">Environment</span>
            </span>
            <Button
              aria-label="Hide environment overview"
              size="icon-xs"
              variant="ghost"
              onClick={onClose}
            >
              <XIcon aria-hidden className="size-3.5" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-(--popup-padding)">
            <div>
              <SectionHeader label="Environment" />
              {!git.isRepo ? (
                <>
                  <EnvironmentStatus
                    icon={<GitBranchPlusIcon aria-hidden />}
                    label="Not a Git repository"
                  />
                  <EnvironmentRow
                    icon={
                      git.isInitPending ? (
                        <Spinner aria-hidden />
                      ) : (
                        <GitBranchPlusIcon aria-hidden />
                      )
                    }
                    label={git.isInitPending ? "Initializing Git…" : "Initialize Git repository"}
                    disabled={git.isInitPending}
                    onClick={git.initRepository}
                  />
                </>
              ) : (
                <>
                  <EnvironmentRow
                    icon={<FileDiffIcon aria-hidden />}
                    label="Changes"
                    caption={changedFileCaption}
                    disabled={commitItem === null || commitItem.disabled}
                    {...(commitItem
                      ? {
                          onClick: () => {
                            git.runMenuItem(commitItem);
                          },
                        }
                      : {})}
                  />
                  <EnvironmentStatus
                    icon={<WorkspaceIcon aria-hidden />}
                    label={workspaceLabel}
                    caption={branch.activeWorktreePath}
                  />
                  <EnvironmentBranchRow
                    environmentId={environmentId}
                    branchCwd={branch.branchCwd}
                    activeBranch={branch.resolvedActiveBranch}
                    branchLabel={branchLabel}
                    onSelectBranch={branch.selectBranch}
                  />
                  <EnvironmentRow
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
                    <EnvironmentRow
                      key={`${item.id}-${item.label}`}
                      icon={
                        <GitActionItemIcon icon={item.icon} SourceControlIcon={SourceControlIcon} />
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
                    <EnvironmentRow
                      icon={
                        <GitActionItemIcon
                          icon={pullRequestItem.icon}
                          SourceControlIcon={SourceControlIcon}
                        />
                      }
                      label={pullRequestItem.label}
                      caption={
                        pullRequest
                          ? `#${pullRequest.number} ${pullRequest.state}`
                          : git.menuItemDisabledReason(pullRequestItem)
                      }
                      disabled={pullRequestItem.disabled}
                      onClick={() => {
                        git.runMenuItem(pullRequestItem);
                      }}
                    />
                  ) : null}
                  {showPublishRow ? (
                    <EnvironmentRow
                      icon={<CloudUploadIcon aria-hidden />}
                      label="Publish repository"
                      disabled={git.isBusy}
                      onClick={git.openPublishDialog}
                    />
                  ) : null}
                  {git.gitStatus?.refName === null ? (
                    <EnvironmentStatus label="Detached HEAD: check out a ref to push or open a pull request." />
                  ) : null}
                  {git.gitStatus &&
                  git.gitStatus.refName !== null &&
                  !git.gitStatus.hasWorkingTreeChanges &&
                  git.gitStatus.behindCount > 0 &&
                  git.gitStatus.aheadCount === 0 ? (
                    <EnvironmentStatus label="Behind upstream. Pull or rebase first." />
                  ) : null}
                  {git.gitStatusError ? (
                    <EnvironmentStatus label={git.gitStatusError} tone="destructive" />
                  ) : null}
                </>
              )}
            </div>
            <div aria-hidden className="mx-(--popup-padding) my-(--popup-padding) h-px bg-border" />
            <div>
              <SectionHeader label="Sources" />
              {/* No implementation behind either of these yet; they are shown
                unavailable rather than wired to something that does not exist. */}
              <EnvironmentRow
                icon={<GlobeIcon aria-hidden />}
                label="Internet search"
                caption="Unavailable"
                disabled
              />
              <EnvironmentRow
                icon={<MoreHorizontalIcon aria-hidden />}
                label="Show all"
                caption="Unavailable"
                disabled
              />
            </div>
          </div>
        </div>
      </div>
      {git.dialogs}
    </>
  );
});
