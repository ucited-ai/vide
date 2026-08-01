import { ChevronRightIcon } from "lucide-react";
import { memo, use, useEffect, useRef } from "react";

import { cn } from "~/lib/utils";
import { ChatSwapText } from "./ChatSwapText";
import { type MessagesTimelineRow } from "./MessagesTimeline.logic";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { TimelineRowCtx } from "./timelineRowContext";

/**
 * The turn's status line, and the line its work folds behind — one row.
 *
 * While the turn runs it carries the indicator, the phrase the turn is on and a
 * timer; when the turn ends the phrase swaps to "Worked for", the timer stops at
 * the total, the indicator freezes on a still frame and the work underneath
 * collapses into it. Nothing about the row moves as that happens, which is what
 * makes the end of a turn read as settling rather than as a replacement: the two
 * states are the same element, keyed by the turn.
 *
 * Clicking it once the turn is over brings the work back.
 */

type TurnHeadRowData = Extract<MessagesTimelineRow, { kind: "turn-head" }>;

export const TurnHeadRow = memo(function TurnHeadRow({ row }: { row: TurnHeadRowData }) {
  const ctx = use(TimelineRowCtx);
  const live = row.state === "live";
  const turnId = row.turnId;
  const canToggle = !live && turnId !== null;

  return (
    <button
      aria-expanded={canToggle ? row.expanded : undefined}
      className={cn(
        "chat-turn-row rounded-(--radius) py-0.5 pr-2 text-(length:--text-caption) text-(--ink-tertiary)",
        canToggle
          ? "cursor-pointer transition-colors hover:bg-(--wash-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
          : "cursor-default",
      )}
      data-scroll-anchor-ignore
      data-turn-head-state={row.state}
      disabled={!canToggle}
      onClick={() => {
        if (turnId !== null) {
          ctx.onToggleTurnFold(turnId);
        }
      }}
      type="button"
    >
      <span className="flex items-center justify-start">
        <ThinkingIndicator
          color={ctx.chatAppearance.indicatorColor}
          frozen={!live}
          variant={ctx.chatAppearance.thinkingIndicator}
        />
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-left">
        <ChatSwapText morphWidth shimmer={live} text={row.label} />
        {/* The separator belongs to the running state: "Worked for · 8m 38s" is
            not a sentence, and "Reading 8m 38s" is not one either. */}
        {live ? <span aria-hidden="true">·</span> : null}
        {live ? (
          <TurnElapsed startedAt={row.startedAt} />
        ) : row.duration !== null ? (
          <span className="tabular-nums">{row.duration}</span>
        ) : null}
      </span>
      <ChevronRightIcon
        aria-hidden="true"
        className={cn(
          "size-3 shrink-0 transition-[opacity,transform]",
          canToggle ? "opacity-100" : "opacity-0",
          row.expanded && canToggle && "rotate-90",
        )}
      />
    </button>
  );
});

/**
 * How long the running turn has been running.
 *
 * Writes its own text node once a second. A turn that re-rendered the transcript
 * every second would re-render it once per second for the whole turn, and the one
 * thing that changed is four characters wide.
 */
function TurnElapsed({ startedAt }: { readonly startedAt: string | null }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const initialText = startedAt === null ? null : formatTurnElapsedNow(startedAt);

  useEffect(() => {
    if (startedAt === null) return;
    const write = () => {
      if (textRef.current) {
        textRef.current.textContent = formatTurnElapsedNow(startedAt);
      }
    };
    write();
    const timer = setInterval(write, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (initialText === null) return null;

  return (
    <span className="tabular-nums" ref={textRef}>
      {initialText}
    </span>
  );
}

/**
 * Elapsed time as a clock reads it: whole seconds, then minutes, then hours.
 *
 * Deliberately not `formatDuration`, which the settled total uses — that reports
 * tenths under ten seconds, which is right for "how long did that take" and wrong
 * for a number the reader is watching count.
 */
function formatTurnElapsed(startIso: string, endIso: string): string | null {
  const startedAtMs = Date.parse(startIso);
  const endedAtMs = Date.parse(endIso);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000));
  if (elapsedSeconds < 60) {
    return `${String(elapsedSeconds)}s`;
  }

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${String(hours)}h ${String(minutes)}m` : `${String(hours)}h`;
  }

  return seconds > 0 ? `${String(minutes)}m ${String(seconds)}s` : `${String(minutes)}m`;
}

function formatTurnElapsedNow(startIso: string): string {
  return formatTurnElapsed(startIso, new Date().toISOString()) ?? "0s";
}
