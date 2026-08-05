import { ChevronRightIcon } from "lucide-react";
import { memo, use, useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { ChatGrow } from "./ChatGrow";
import { type MessagesTimelineRow } from "./MessagesTimeline.logic";
import { TimelineRowCtx } from "./timelineRowContext";

/**
 * The turn's static frame, and the line its work folds behind — one row.
 *
 * Deliberately quiet: "Working for" plus a counting timer while the turn runs,
 * "Worked for" plus the total when it ends — same words, same column, the
 * timer simply stops. No indicator, no shimmer, no swapping phrase; the
 * animated reading of the turn (`TurnTailRow`) lives at the bottom, where the
 * writing actually happens. A frame that danced pulled the eye to the top of
 * the turn every time the phrase changed, away from the text arriving below.
 *
 * Clicking it once the turn is over brings the folded work back — when there
 * is any: a text-only turn keeps the line and loses only the chevron.
 */

type TurnHeadRowData = Extract<MessagesTimelineRow, { kind: "turn-head" }>;

export const TurnHeadRow = memo(function TurnHeadRow({ row }: { row: TurnHeadRowData }) {
  const ctx = use(TimelineRowCtx);
  const live = row.state === "live";
  const turnId = row.turnId;
  const canFold = !live && turnId !== null && row.collapsible;
  /*
   * The detail's own disclosure, because it must work where the fold cannot: a
   * turn whose id the server has not assigned yet, or a send that failed before
   * there was a turn at all. One click opens whichever the head has.
   */
  const [detailOpen, setDetailOpen] = useState(false);
  const detail = row.statusDetail;
  const canOpen = canFold || detail !== null;
  const opened = (canFold && row.expanded) || (detail !== null && detailOpen);

  return (
    <div className="w-full">
      <button
        aria-expanded={canOpen ? opened : undefined}
        className={cn(
          "chat-turn-row rounded-(--radius) py-0.5 pr-2 text-(length:--text-caption) text-(--ink-tertiary)",
          canOpen
            ? "cursor-pointer transition-colors hover:bg-(--wash-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
            : "cursor-default",
        )}
        data-scroll-anchor-ignore
        data-turn-head-state={row.state}
        disabled={!canOpen}
        onClick={() => {
          if (canFold && turnId !== null) {
            ctx.onToggleTurnFold(turnId);
          }
          if (detail !== null) {
            setDetailOpen((open) => !open);
          }
        }}
        type="button"
      >
        {/* Spans the gutter instead of leaving it empty: the head carries no
            icon, and a label indented behind a blank gutter sat visibly right of
            the prose and the status line it frames. Same x as everything else. */}
        <span className="col-span-2 flex min-w-0 items-center gap-1.5 text-left">
          <span>{row.label}</span>
          {live ? (
            <TurnElapsed startedAt={row.startedAt} />
          ) : row.duration !== null ? (
            <span className="tabular-nums">{row.duration}</span>
          ) : null}
          {/* One word, one notch brighter than the frame around it: how the turn
              ended is the news on this line, and the only thing on it that is
              not a measurement. */}
          {row.status !== null ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-(--ink-secondary)">{row.status}</span>
            </>
          ) : null}
        </span>
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 transition-[opacity,transform]",
            canOpen ? "opacity-100" : "opacity-0",
            opened && canOpen && "rotate-90",
          )}
        />
      </button>
      {detail !== null ? (
        <ChatGrow open={detailOpen}>
          {/* Selectable, wrapped, and on the text's own edge — a reason to read
              once, not an alert to dismiss. */}
          <p className="py-1 pr-2 text-(length:--text-caption) whitespace-pre-wrap text-(--ink-tertiary)">
            {detail}
          </p>
        </ChatGrow>
      ) : null}
    </div>
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
