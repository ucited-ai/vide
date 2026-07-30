import { FolderIcon, LoaderCircleIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { SIDEBAR_STATUS_SLOT_CLASS } from "./sidebarRowStyles";

/**
 * What marks a project in the sidebar.
 *
 * Per-project favicons were doing the opposite of their job here: a column of
 * unrelated little images, each with its own colour and weight, reads as
 * clutter rather than as a set of projects — and the ones that resolved to
 * nothing left the column half-empty. One folder glyph in the same ink as the
 * name it introduces makes the pair read as a single object, and it is sized to
 * the row's type rather than to itself so the two share a cap height.
 *
 * The favicon component still exists for the places a specific project has to
 * be told apart from another at a glance: the command palette, the chat header,
 * settings.
 */
export function SidebarProjectIcon({ className }: { className?: string }) {
  return <FolderIcon aria-hidden className={cn("size-3.5 shrink-0", className)} />;
}

/**
 * A thread that is actually running.
 *
 * The old treatment animated the word "Working" itself, which put a blinking
 * word in the middle of a list you are trying to read. Motion belongs on a mark
 * instead: a spinner turns at the app's usual spinner speed while the whole
 * mark breathes on the shared status-pulse cycle. The two periods don't divide
 * evenly, so the indicator never lands on a hard beat — it reads as alive
 * rather than as blinking.
 */
export function SidebarWorkingIndicator({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex animate-status-pulse items-center justify-center motion-reduce:animate-none",
        className,
      )}
    >
      <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
    </span>
  );
}

export interface SidebarRowStatus {
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

/**
 * The mark itself: a spinner while work is in flight, a dot once the thread has
 * settled into a state, nothing at all when there is nothing to report.
 */
export function SidebarStatusMark({ status }: { status: SidebarRowStatus | null }) {
  if (status === null) return null;
  if (status.pulse) return <SidebarWorkingIndicator />;
  return <span aria-hidden className={cn("size-2 rounded-full", status.dotClass)} />;
}

/**
 * The mark in its slot. The slot is reserved on every row, marked or not — see
 * SIDEBAR_STATUS_SLOT_CLASS. Rows that want a tooltip on the mark put
 * SIDEBAR_STATUS_SLOT_CLASS on their own trigger and render SidebarStatusMark
 * inside it.
 */
export function SidebarStatusDot({
  status,
  className,
}: {
  status: SidebarRowStatus | null;
  className?: string;
}) {
  return (
    <span aria-hidden className={cn(SIDEBAR_STATUS_SLOT_CLASS, status?.colorClass, className)}>
      <SidebarStatusMark status={status} />
    </span>
  );
}

/**
 * Section signposts: "Projects", "Snoozed", "Settled". Size, weight, tracking
 * and ink all come from the theme's group-label rule — which is the point of
 * the data attribute travelling with the component rather than each caller
 * restating them, and of there being one component instead of two.
 */
export function SidebarSectionLabel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span data-sidebar="group-label" className={cn("shrink-0 whitespace-nowrap", className)}>
      {children}
    </span>
  );
}
