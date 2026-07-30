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
  PlusIcon,
} from "lucide-react";
import { memo, useMemo, useState, type ReactNode } from "react";

import { type DraftId } from "~/composerDraftStore";
import { usePaginatedBranches } from "~/state/queries";
import { resolveLockedWorkspaceLabel } from "../BranchToolbar.logic";
import { useThreadBranchSelection } from "../BranchToolbarBranchSelector";
import { GitActionItemIcon, GitQuickActionIcon, useGitActions } from "../GitActionsControl";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";

interface ChatEnvironmentMenuProps {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  draftId?: DraftId;
  gitCwd: string | null;
}

interface SectionAddAction {
  readonly label: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}

/**
 * A section heading, with the add affordance the Codex menu puts beside it —
 * rendered only where the section actually has something to add.
 */
function MenuSectionHeader({ label, add }: { label: string; add?: SectionAddAction }) {
  return (
    <div className="flex items-center justify-between gap-2 pe-1">
      <MenuGroupLabel>{label}</MenuGroupLabel>
      {add ? (
        <button
          type="button"
          aria-label={add.label}
          disabled={add.disabled}
          onClick={add.onClick}
          className="inline-flex size-5 shrink-0 cursor-default items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-64"
        >
          <PlusIcon aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * One action row. The caption carries whatever the row wants to say quietly —
 * a file count, a pull request state, or the reason the row is unavailable.
 */
function EnvironmentMenuRow({
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
    <MenuItem disabled={disabled} {...(onClick ? { onClick } : {})}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {caption ? (
        <span className="ms-auto max-w-40 shrink-0 truncate text-(length:--text-caption) text-muted-foreground">
          {caption}
        </span>
      ) : null}
    </MenuItem>
  );
}

/** A row that reports state rather than offering an action. */
function EnvironmentMenuStatus({
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
 * The refs this thread can move to. Mounted only while the submenu is open, so
 * the ref list is not fetched until someone asks for it.
 */
function EnvironmentBranchSubmenu({
  environmentId,
  branchCwd,
  activeBranch,
  onSelectBranch,
}: {
  environmentId: EnvironmentId;
  branchCwd: string | null;
  activeBranch: string | null;
  onSelectBranch: (refName: VcsRef) => void;
}) {
  const branchRefTarget = useMemo(
    () => ({ environmentId, cwd: branchCwd, query: "" }),
    [branchCwd, environmentId],
  );
  const branchRefState = usePaginatedBranches(branchRefTarget);
  const refs = branchRefState.refs;

  if (refs.length === 0) {
    return (
      <MenuItem disabled>{branchRefState.isPending ? "Loading refs..." : "No refs found"}</MenuItem>
    );
  }

  return refs.map((refName) => (
    <MenuItem key={refName.name} onClick={() => onSelectBranch(refName)}>
      <span className="min-w-0 flex-1 truncate">{refName.name}</span>
      {refName.name === activeBranch ? (
        <CheckIcon aria-hidden className="ms-auto size-3.5 shrink-0" />
      ) : refName.isRemote || refName.isDefault ? (
        <span className="ms-auto shrink-0 text-(length:--text-caption) text-muted-foreground">
          {refName.isRemote ? "remote" : "default"}
        </span>
      ) : null}
    </MenuItem>
  ));
}

/**
 * Everything a thread runs against — its worktree, its ref, and the git actions
 * that move it forward — behind a single header control, in place of the row of
 * icon buttons this replaced.
 */
export const ChatEnvironmentMenu = memo(function ChatEnvironmentMenu({
  environmentId,
  threadId,
  draftId,
  gitCwd,
}: ChatEnvironmentMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
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
    onBranchApplied: () => {
      setIsOpen(false);
    },
    onBranchActionSettled: git.refreshStatus,
  });

  const SourceControlIcon = git.sourceControlPresentation.Icon;
  const commitItem = git.menuItems.find((item) => item.id === "commit") ?? null;
  const pullRequestItem = git.menuItems.find((item) => item.id === "pr") ?? null;
  // The quick action already spells out the recommended next step, so a menu row
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
  const addAction: SectionAddAction | undefined = !git.isRepo
    ? {
        label: git.isInitPending ? "Initializing Git..." : "Initialize Git",
        disabled: git.isInitPending,
        onClick: () => {
          setIsOpen(false);
          git.initRepository();
        },
      }
    : undefined;

  return (
    <>
      <Menu
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (open) {
            git.refreshStatus();
          }
        }}
      >
        <MenuTrigger render={<Button aria-label="Environment" size="xs" variant="outline" />}>
          <BoxIcon aria-hidden="true" className="size-3.5" />
          <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
            Environment
          </span>
          <ChevronDownIcon aria-hidden="true" className="size-3.5 opacity-60" />
        </MenuTrigger>
        <MenuPopup align="end" className="w-72">
          <MenuGroup>
            <MenuSectionHeader label="Environment" {...(addAction ? { add: addAction } : {})} />
            {!git.isRepo ? (
              <EnvironmentMenuStatus
                icon={<GitBranchPlusIcon aria-hidden />}
                label="Not a Git repository"
              />
            ) : (
              <>
                <EnvironmentMenuRow
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
                <EnvironmentMenuStatus
                  icon={<WorkspaceIcon aria-hidden />}
                  label={workspaceLabel}
                  caption={branch.activeWorktreePath}
                />
                <MenuSub>
                  <MenuSubTrigger>
                    <GitBranchIcon aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{branchLabel}</span>
                  </MenuSubTrigger>
                  <MenuSubPopup className="w-72">
                    <EnvironmentBranchSubmenu
                      environmentId={environmentId}
                      branchCwd={branch.branchCwd}
                      activeBranch={branch.resolvedActiveBranch}
                      onSelectBranch={branch.selectBranch}
                    />
                  </MenuSubPopup>
                </MenuSub>
                <EnvironmentMenuRow
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
                  <EnvironmentMenuRow
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
                  <EnvironmentMenuRow
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
                  <EnvironmentMenuRow
                    icon={<CloudUploadIcon aria-hidden />}
                    label="Publish repository"
                    disabled={git.isBusy}
                    onClick={git.openPublishDialog}
                  />
                ) : null}
                {git.gitStatus?.refName === null ? (
                  <EnvironmentMenuStatus label="Detached HEAD: check out a ref to push or open a pull request." />
                ) : null}
                {git.gitStatus &&
                git.gitStatus.refName !== null &&
                !git.gitStatus.hasWorkingTreeChanges &&
                git.gitStatus.behindCount > 0 &&
                git.gitStatus.aheadCount === 0 ? (
                  <EnvironmentMenuStatus label="Behind upstream. Pull or rebase first." />
                ) : null}
                {git.gitStatusError ? (
                  <EnvironmentMenuStatus label={git.gitStatusError} tone="destructive" />
                ) : null}
              </>
            )}
          </MenuGroup>
          <MenuSeparator />
          <MenuGroup>
            <MenuSectionHeader label="Sources" />
            {/* No implementation behind either of these yet; they are shown
                unavailable rather than wired to something that does not exist. */}
            <EnvironmentMenuRow
              icon={<GlobeIcon aria-hidden />}
              label="Internet search"
              caption="Unavailable"
              disabled
            />
            <EnvironmentMenuRow
              icon={<MoreHorizontalIcon aria-hidden />}
              label="Show all"
              caption="Unavailable"
              disabled
            />
          </MenuGroup>
        </MenuPopup>
      </Menu>
      {git.dialogs}
    </>
  );
});
