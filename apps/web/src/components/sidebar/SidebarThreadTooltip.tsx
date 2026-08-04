/**
 * The hover card of a sidebar thread row, and the marquee its title runs in.
 *
 * The card is a reading, not a dashboard: labelled facts — when the thread
 * began, how much the user has said, which model answers, where in the
 * repository it works (branch, the base it was cut from, its worktree) — set
 * as quiet label/value pairs on the popover surface the theme already owns.
 * No title row: the row the pointer is on already shows it, and its marquee
 * walks any overflow past. Everything it paints comes from the ladder, so a
 * chosen palette reaches it like any other chrome.
 *
 * The message count and the git status are read lazily: the card only mounts
 * when the tooltip opens, and subscribing there means no row pays for data
 * nobody is looking at.
 */

import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@vide/client-runtime/environment";
import { useMemo, useLayoutEffect, useRef, useState } from "react";

import { getTriggerDisplayModelLabel } from "../chat/providerIconUtils";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { TooltipPopup } from "../ui/tooltip";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { useProject, useThreadMessages } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { primaryServerProvidersAtom } from "../../state/server";
import { vcsEnvironment } from "../../state/vcs";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import type { SidebarThreadSummary } from "../../types";
import { cn } from "~/lib/utils";

/** The last path segment carries the worktree's name; the rest is noise here. */
function worktreeLabel(worktreePath: string): string {
  const tail = worktreePath.split("/").findLast((segment) => segment.length > 0);
  return tail ?? worktreePath;
}

function DetailRow(props: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="text-muted-foreground">{props.label}</span>
      <span className="flex min-w-0 items-center justify-end gap-1.5 text-right text-foreground/85">
        {props.children}
      </span>
    </>
  );
}

export function SidebarThreadTooltipContent({
  thread,
  anchor,
}: {
  thread: SidebarThreadSummary;
  /** The whole row — so "right of the anchor" is the sidebar's edge, not the
      truncated title's. */
  anchor?: React.RefObject<HTMLElement | null>;
}) {
  const threadRef = useMemo(
    () => scopeThreadRef(thread.environmentId, thread.id),
    [thread.environmentId, thread.id],
  );
  const messages = useThreadMessages(threadRef);
  const userMessageCount = messages.filter((message) => message.role === "user").length;

  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const modelInstanceId = thread.session?.providerInstanceId ?? thread.modelSelection.instanceId;
  const providerEntry = useMemo(
    () =>
      deriveProviderInstanceEntries(serverProviders).find(
        (entry) => (entry.instanceId as string) === modelInstanceId,
      ) ?? null,
    [modelInstanceId, serverProviders],
  );
  const selectedModel = providerEntry?.models.find(
    (model) => model.slug === thread.modelSelection.model,
  );
  const modelLabel = selectedModel
    ? getTriggerDisplayModelLabel(selectedModel)
    : thread.modelSelection.model;

  /* Where the thread works, read from git itself: threads without a pinned
     branch run on the project checkout, so its live status answers for them.
     The base is what the worktree's branch was cut from — recorded by git
     config at creation and carried here through the vcs status. */
  const threadProject = useProject(
    useMemo(
      () => scopeProjectRef(thread.environmentId, thread.projectId),
      [thread.environmentId, thread.projectId],
    ),
  );
  const gitCwd = thread.worktreePath ?? threadProject?.workspaceRoot ?? null;
  const gitStatus = useEnvironmentQuery(
    gitCwd !== null
      ? vcsEnvironment.status({
          environmentId: thread.environmentId,
          input: { cwd: gitCwd },
        })
      : null,
  );
  const branchLabel = thread.branch ?? gitStatus.data?.refName ?? null;
  const baseBranch = gitStatus.data?.baseBranch ?? null;

  return (
    <TooltipPopup
      side="right"
      align="start"
      sideOffset={12}
      anchor={anchor}
      className="max-w-72 text-left"
    >
      <div className="flex w-60 flex-col gap-2 p-2">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-(length:--text-caption)">
          <DetailRow label="Created">{formatRelativeTimeLabel(thread.createdAt)}</DetailRow>
          <DetailRow label="Messages">
            {messages.length === 0 ? "—" : String(userMessageCount)}
          </DetailRow>
          {providerEntry ? (
            <DetailRow label="Model">
              <ProviderInstanceIcon
                driverKind={providerEntry.driverKind}
                displayName={thread.session?.providerName ?? modelInstanceId}
                iconClassName="size-3.5 shrink-0"
              />
              <span className="truncate">{modelLabel}</span>
            </DetailRow>
          ) : null}
          {branchLabel ? (
            <DetailRow label="Branch">
              <span className="truncate">{branchLabel}</span>
            </DetailRow>
          ) : null}
          {baseBranch && baseBranch !== branchLabel ? (
            <DetailRow label="Base">
              <span className="truncate">{baseBranch}</span>
            </DetailRow>
          ) : null}
          {thread.worktreePath ? (
            <DetailRow label="Worktree">
              <span className="truncate">{worktreeLabel(thread.worktreePath)}</span>
            </DetailRow>
          ) : null}
        </div>
      </div>
    </TooltipPopup>
  );
}

/**
 * A truncated title that walks its overflow past the reader while its row is
 * hovered. Measured on entry rather than observed: the answer only matters in
 * the moment the pointer arrives, and a list of hundreds of rows should not
 * hold a ResizeObserver each for it.
 *
 * Spreads its props and forwards its ref so it can stand as a tooltip
 * trigger's `render` element.
 */
export function SidebarMarqueeTitle({
  title,
  className,
  ref,
  ...rest
}: React.ComponentPropsWithRef<"span"> & { title: string }) {
  const innerRef = useRef<HTMLSpanElement | null>(null);
  const [distance, setDistance] = useState(0);

  const measure = () => {
    const inner = innerRef.current;
    const outer = inner?.parentElement;
    if (!inner || !outer) return;
    setDistance(Math.max(0, inner.scrollWidth - outer.clientWidth));
  };

  /* The first measurement, so a row hovered straight after mount answers. */
  // oxlint-disable-next-line exhaustive-deps
  useLayoutEffect(measure, [title]);

  return (
    <span
      {...rest}
      ref={ref}
      className={cn("sidebar-marquee", className)}
      data-overflowing={distance > 0 ? "true" : "false"}
      onPointerEnter={(event) => {
        measure();
        rest.onPointerEnter?.(event);
      }}
    >
      <span
        ref={innerRef}
        className="sidebar-marquee-inner"
        style={
          distance > 0
            ? ({
                "--sidebar-marquee-distance": `-${String(distance)}px`,
                "--sidebar-marquee-duration": `${Math.max(1.8, distance / 24).toFixed(2)}s`,
              } as React.CSSProperties)
            : undefined
        }
      >
        {title}
      </span>
    </span>
  );
}
