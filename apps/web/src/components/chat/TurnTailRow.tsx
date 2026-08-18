import { ChevronRightIcon } from "lucide-react";
import { memo, use, useEffect, useState } from "react";

import { cn } from "~/lib/utils";
import { ChatGrow } from "./ChatGrow";
import { ChatSwapText } from "./ChatSwapText";
import { type MessagesTimelineRow } from "./MessagesTimeline.logic";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { TimelineRevealCtx, TimelineRowCtx } from "./timelineRowContext";
import { WorkCallList } from "./WorkGroupRow";

/**
 * The bottom of a running turn — the part that moves.
 *
 * The indicator and the phrase the turn is on ("Thinking", "Working",
 * "Writing"), always under the newest content, where the reader's eye already
 * is: below the streaming text, below the tool call being made, filling the
 * beat between one call finishing and the next thing happening. The static
 * frame at the top of the turn (`TurnHeadRow`) only counts time.
 *
 * Not a button and never frozen: when the turn ends the row leaves with it —
 * there is no settled state to hold.
 */

type TurnTailRowData = Extract<MessagesTimelineRow, { kind: "turn-tail" }>;

export const TurnTailRow = memo(function TurnTailRow({ row }: { row: TurnTailRowData }) {
  const ctx = use(TimelineRowCtx);
  const revealCtx = use(TimelineRevealCtx);
  const openStateKey = "turn-tools:live";
  const [open, setOpenState] = useState(() => ctx.workRowOpenById.get(openStateKey) ?? false);
  const setOpen = (next: boolean) => {
    ctx.workRowOpenById.set(openStateKey, next);
    setOpenState(next);
  };
  const callCount = row.groupedEntries.length;
  const settlesAtMs =
    row.revealAfterMessageId === null
      ? undefined
      : revealCtx.settlesAtByMessageId.get(row.revealAfterMessageId);
  const [, setTimerRevision] = useState(0);
  const [reportWaitExpiredFor, setReportWaitExpiredFor] = useState<string | null>(null);
  const waitingForRevealReport =
    row.revealAfterMessageId !== null &&
    ctx.chatAppearance.streamAnimation !== "instant" &&
    settlesAtMs === undefined &&
    reportWaitExpiredFor !== row.revealAfterMessageId;
  const revealPending =
    waitingForRevealReport || (settlesAtMs !== undefined && settlesAtMs > Date.now());

  useEffect(() => {
    if (waitingForRevealReport) {
      const fallback = setTimeout(() => setReportWaitExpiredFor(row.revealAfterMessageId), 100);
      return () => clearTimeout(fallback);
    }
    if (settlesAtMs === undefined || settlesAtMs <= Date.now()) return;
    const timer = setTimeout(
      () => setTimerRevision((revision) => revision + 1),
      settlesAtMs - Date.now(),
    );
    return () => clearTimeout(timer);
  }, [row.revealAfterMessageId, settlesAtMs, waitingForRevealReport]);

  const visibleCallCount = revealPending ? 0 : callCount;

  return (
    <div data-turn-tail>
      <button
        aria-expanded={visibleCallCount > 0 ? open : undefined}
        className={cn(
          "chat-turn-row py-0.5 pr-2 text-(length:--text-caption) text-(--ink-tertiary)",
          visibleCallCount > 0 &&
            "cursor-pointer rounded-(--radius) transition-colors hover:bg-(--wash-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
        )}
        data-scroll-anchor-ignore
        disabled={visibleCallCount === 0}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className="flex items-center justify-start">
          <ThinkingIndicator
            color={ctx.chatAppearance.indicatorColor}
            variant={ctx.chatAppearance.thinkingIndicator}
          />
        </span>
        <span className="flex min-w-0 items-center text-left">
          <ChatSwapText morphWidth shimmer text={revealPending ? "Writing" : row.label} />
        </span>
        {visibleCallCount > 0 ? (
          <span className="flex items-center gap-1 tabular-nums text-(--ink-tertiary)">
            <span aria-label={`${String(visibleCallCount)} tool calls`}>{visibleCallCount}</span>
            <ChevronRightIcon
              aria-hidden
              className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
            />
          </span>
        ) : null}
      </button>
      <ChatGrow open={visibleCallCount > 0 && open}>
        <WorkCallList entries={row.groupedEntries} workspaceRoot={ctx.workspaceRoot} />
      </ChatGrow>
    </div>
  );
});
