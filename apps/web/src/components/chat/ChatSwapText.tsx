import { useEffect, useState, type CSSProperties } from "react";

import { cn } from "~/lib/utils";

/**
 * A label that changes without the line moving.
 *
 * The outgoing text leaves while the incoming text arrives, both out of flow, so
 * a status line that says "Reading" one moment and "Running the tests" the next
 * never reflows what sits beside it. `morphWidth` additionally eases the box
 * between the two widths, measured off a probe carrying the new text in the same
 * type — a width has to be a length to be transitioned, and a label snapping to
 * its new width is the whole thing this exists to avoid.
 */

/**
 * When the swap is over: the outgoing element goes, and the incoming one is
 * handed back to whatever else styles it (the sheen). Long enough for the slower
 * of the two animations in `vide-theme.css` — --chat-turn-swap-in-duration.
 */
const SWAP_SETTLE_MS = 420;

export function ChatSwapText({
  text,
  morphWidth = false,
  shimmer = false,
  className,
}: {
  readonly text: string;
  /** Ease the box between the old and the new text's width. */
  readonly morphWidth?: boolean;
  /** Run the sheen through the live label. */
  readonly shimmer?: boolean;
  readonly className?: string;
}) {
  const [swap, setSwap] = useState({ revision: 0, current: text, previous: null as string | null });
  if (swap.current !== text) {
    setSwap((previous) => ({
      revision: previous.revision + 1,
      current: text,
      previous: previous.current,
    }));
  }
  const swapping = swap.current === text && swap.previous !== null;

  useEffect(() => {
    if (swap.previous === null) return;
    const timer = setTimeout(
      () => setSwap((previous) => ({ ...previous, previous: null })),
      SWAP_SETTLE_MS,
    );
    return () => clearTimeout(timer);
    // Keyed on the revision as well: two swaps away from the same label are still
    // two swaps, and the second one needs its own timer.
  }, [swap.previous, swap.revision]);

  /*
   * Measured with an observer rather than in a layout effect, so the box also
   * follows the text size changing under it — the reader's scale moves every
   * label in the app, and one that kept a stale pixel width would clip.
   */
  const [width, setWidth] = useState<number | null>(null);
  const boxStyle =
    morphWidth && width !== null ? ({ width: `${String(width)}px` } as CSSProperties) : undefined;

  return (
    <span className={cn("chat-swap", className)} style={boxStyle}>
      {morphWidth ? (
        <span
          aria-hidden="true"
          className="chat-swap-item chat-swap-probe"
          ref={(probe) => {
            if (!probe) return;
            const observer = new ResizeObserver(() => {
              setWidth(Math.ceil(probe.getBoundingClientRect().width));
            });
            observer.observe(probe);
            return () => observer.disconnect();
          }}
        >
          {text}
        </span>
      ) : null}
      {swap.previous !== null ? (
        <span aria-hidden="true" className="chat-swap-item" data-swap="out" key={swap.revision - 1}>
          {swap.previous}
        </span>
      ) : null}
      <span
        className={cn("chat-swap-item", shimmer && "chat-shimmer")}
        data-swap={swapping ? "in" : undefined}
        key={swap.revision}
      >
        {text}
      </span>
    </span>
  );
}
