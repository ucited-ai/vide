import { GitPullRequestIcon, SquarePenIcon } from "lucide-react";
import { memo, useCallback, useMemo, type ComponentType } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { startNewThreadFromContext } from "../../lib/chatThreadActions";
import { cn } from "../../lib/utils";
import { SidebarGroup, SidebarMenu, SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * One row in the sidebar's primary navigation section (New task, Pull
 * requests, ...), rendered between the brand header and the Projects group.
 * Data-driven so a future entry is a one-line addition to the array built by
 * useSidebarPrimaryNavEntries below — no new JSX row needed.
 */
export interface SidebarPrimaryNavEntry {
  readonly id: string;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly onSelect?: () => void;
  /** Highlights the row with --sidebar-row-selected, for future route entries. */
  readonly isActive?: boolean;
  /** Defaults to true. false renders a non-interactive row with disabledTooltip. */
  readonly enabled?: boolean;
  readonly disabledTooltip?: string;
}

/**
 * Builds the primary nav entries, wiring "New task" through the shared
 * new-thread flow (useHandleNewThread / startNewThreadFromContext — the same
 * pair the chat.new keybinding and the old header button used) rather than
 * reimplementing thread creation here.
 */
export function useSidebarPrimaryNavEntries(options: {
  readonly newThreadContext: ReturnType<typeof useHandleNewThread>;
  readonly isMobile: boolean;
  readonly setOpenMobile: (open: boolean) => void;
  // Sidebar v2 with multiple project groups routes "New task" through the
  // project picker in the command palette, matching the chat.new keybinding
  // (routes/_chat.tsx). v1 and single-project setups always create
  // immediately in the current context.
  readonly preferProjectPickerWhenMultiple?: boolean;
  readonly projectGroupCount?: number;
  /** False when there is no project to attach a new task to. Defaults to true. */
  readonly newTaskEnabled?: boolean;
}): readonly SidebarPrimaryNavEntry[] {
  const {
    newThreadContext,
    isMobile,
    setOpenMobile,
    preferProjectPickerWhenMultiple = false,
    projectGroupCount = 0,
    newTaskEnabled = true,
  } = options;

  const handleNewTaskSelect = useCallback(() => {
    if (isMobile) setOpenMobile(false);
    if (preferProjectPickerWhenMultiple && projectGroupCount > 1) {
      openCommandPalette({ open: "new-thread-in" });
      return;
    }
    void startNewThreadFromContext({
      activeDraftThread: newThreadContext.activeDraftThread,
      activeThread: newThreadContext.activeThread ?? undefined,
      defaultProjectRef: newThreadContext.defaultProjectRef,
      handleNewThread: newThreadContext.handleNewThread,
    });
  }, [
    isMobile,
    newThreadContext,
    preferProjectPickerWhenMultiple,
    projectGroupCount,
    setOpenMobile,
  ]);

  return useMemo(
    () => [
      {
        id: "new-task",
        label: "New task",
        icon: SquarePenIcon,
        onSelect: handleNewTaskSelect,
        enabled: newTaskEnabled,
      },
      // No pull request list/view exists yet (PR surface today is per-thread
      // only — see ThreadStatusIndicators and PullRequestThreadDialog).
      // Disabled with a tooltip rather than a route to a screen that isn't
      // built.
      {
        id: "pull-requests",
        label: "Pull requests",
        icon: GitPullRequestIcon,
        enabled: false,
        disabledTooltip: "Pull requests view is coming soon",
      },
    ],
    [handleNewTaskSelect, newTaskEnabled],
  );
}

const SIDEBAR_PRIMARY_NAV_ROW_CLASS =
  "flex h-[30px] w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] font-medium text-sidebar-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar";

const SidebarPrimaryNavRow = memo(function SidebarPrimaryNavRow({
  entry,
}: {
  entry: SidebarPrimaryNavEntry;
}) {
  const Icon = entry.icon;
  const enabled = entry.enabled ?? true;
  const className = cn(
    SIDEBAR_PRIMARY_NAV_ROW_CLASS,
    enabled
      ? cn("cursor-pointer hover:bg-sidebar-row-hover", entry.isActive && "bg-sidebar-row-selected")
      : "cursor-not-allowed text-sidebar-foreground/45",
  );
  const content = (
    <>
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-left">{entry.label}</span>
    </>
  );

  if (!enabled && entry.disabledTooltip) {
    return (
      <SidebarMenuItem>
        <Tooltip>
          <TooltipTrigger
            render={<button type="button" aria-disabled="true" className={className} />}
          >
            {content}
          </TooltipTrigger>
          <TooltipPopup side="right">{entry.disabledTooltip}</TooltipPopup>
        </Tooltip>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <button
        type="button"
        aria-disabled={enabled ? undefined : true}
        className={className}
        onClick={enabled ? entry.onSelect : undefined}
      >
        {content}
      </button>
    </SidebarMenuItem>
  );
});

export const SidebarPrimaryNav = memo(function SidebarPrimaryNav({
  entries,
}: {
  entries: readonly SidebarPrimaryNavEntry[];
}) {
  if (entries.length === 0) return null;

  return (
    <SidebarGroup className="px-2 pb-2 pt-0">
      <SidebarMenu>
        {entries.map((entry) => (
          <SidebarPrimaryNavRow key={entry.id} entry={entry} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
});
