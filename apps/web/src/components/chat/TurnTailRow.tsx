import { memo, use } from "react";

import { ChatSwapText } from "./ChatSwapText";
import { type MessagesTimelineRow } from "./MessagesTimeline.logic";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { TimelineRowCtx } from "./timelineRowContext";

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

  return (
    <div
      className="chat-turn-row py-0.5 pr-2 text-(length:--text-caption) text-(--ink-tertiary)"
      data-scroll-anchor-ignore
      data-turn-tail
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
    </div>
  );
});
