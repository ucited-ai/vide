import { BookmarkIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";

/**
 * Bookmark pill perched on the composer's top-right shoulder. Shows the
 * stash count and doubles as the click target for opening the stash menu.
 *
 * On save the badge gives one quiet acknowledgement: it lifts to full
 * opacity and the count ticks over. `pulseKey` changes per stash, remounting
 * the count so the transition replays without a continuous animation.
 *
 * Wears the same material as the cards the composer stacks above itself — the
 * queue, the task list — because it holds the same kind of thing: prompts that
 * have not been sent. Monochrome with it: the count is emphasis by contrast,
 * not by hue.
 */
export const ComposerStashBadge = memo(function ComposerStashBadge(props: {
  count: number;
  pulseKey: number;
  pulsing: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
}) {
  if (props.count === 0) return null;

  return (
    <button
      type="button"
      data-prompt-stash-badge="true"
      aria-label={`Stashed prompts: ${props.count}. Open stash.`}
      aria-expanded={props.menuOpen}
      className={cn(
        "absolute -top-3 right-4 z-10 inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-(--envcol-edge) bg-(--envcol-surface) px-2.5 py-0.5 text-(length:--text-caption) shadow-[var(--envcol-shadow)]",
        "transition-[color,opacity]",
        props.menuOpen || props.pulsing
          ? "text-(--ink) opacity-100"
          : "text-(--ink-tertiary) opacity-70 hover:text-(--ink) hover:opacity-100",
      )}
      onPointerDown={(event) => {
        // Keep composer focus so Escape/typing flows stay intact.
        event.preventDefault();
      }}
      onClick={props.onToggleMenu}
    >
      <BookmarkIcon className="size-3" aria-hidden="true" />
      Stash
      <span
        key={props.pulseKey}
        className={cn(
          "rounded-full px-1.5 text-(length:--text-micro) font-medium tabular-nums",
          props.pulsing
            ? "prompt-stash-count-enter bg-(--wash-selected) text-(--ink)"
            : "bg-(--wash-hover) text-(--ink-secondary)",
        )}
      >
        {props.count}
      </span>
    </button>
  );
});
