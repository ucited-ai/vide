import { ChevronRightIcon } from "lucide-react";
import { memo, use, useState } from "react";

import { cn } from "~/lib/utils";
import { ChatGrow } from "./ChatGrow";
import { ChatSwapText } from "./ChatSwapText";
import { type MessagesTimelineRow } from "./MessagesTimeline.logic";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { TimelineRowCtx } from "./timelineRowContext";
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
  const openStateKey = "turn-tools:live";
  const [open, setOpenState] = useState(() => ctx.workRowOpenById.get(openStateKey) ?? false);
  const setOpen = (next: boolean) => {
    ctx.workRowOpenById.set(openStateKey, next);
    setOpenState(next);
  };
  const callCount = row.groupedEntries.length;

  return (
    <div data-turn-tail>
      <button
        aria-expanded={callCount > 0 ? open : undefined}
        className={cn(
          "chat-turn-row py-0.5 pr-2 text-(length:--text-caption) text-(--ink-tertiary)",
          callCount > 0 &&
            "cursor-pointer rounded-(--radius) transition-colors hover:bg-(--wash-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
        )}
        data-scroll-anchor-ignore
        disabled={callCount === 0}
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
          <ChatSwapText morphWidth shimmer text={row.label} />
        </span>
        {callCount > 0 ? (
          <span className="flex items-center gap-1 tabular-nums text-(--ink-tertiary)">
            <span aria-label={`${String(callCount)} tool calls`}>{callCount}</span>
            <ChevronRightIcon
              aria-hidden
              className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
            />
          </span>
        ) : null}
      </button>
      <ChatGrow open={callCount > 0 && open}>
        <WorkCallList entries={row.groupedEntries} workspaceRoot={ctx.workspaceRoot} />
      </ChatGrow>
    </div>
  );
});
