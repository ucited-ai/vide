import { BugIcon, HammerIcon, ScanSearchIcon, GitPullRequestArrowIcon } from "lucide-react";
import { useCallback } from "react";

import { useComposerHandleContext } from "~/composerHandleContext";
import { cn } from "~/lib/utils";

/**
 * Quick starts under the draft headline.
 *
 * Each card writes an opening line into the composer and hands focus back, so
 * the prompt stays editable instead of being sent on click — the card is a
 * starting point, not a command.
 */

interface Suggestion {
  readonly icon: typeof BugIcon;
  readonly label: string;
  readonly prompt: string;
  readonly visibilityClassName: string;
}

const SUGGESTIONS: readonly Suggestion[] = [
  {
    icon: ScanSearchIcon,
    label: "Explore and understand code",
    prompt: "Walk me through how ",
    visibilityClassName: "flex",
  },
  {
    icon: HammerIcon,
    label: "Build a feature or a tool",
    prompt: "Add a feature that ",
    visibilityClassName: "hidden @xs:flex",
  },
  {
    icon: GitPullRequestArrowIcon,
    label: "Review changes and suggest fixes",
    prompt: "Review my current changes and tell me what you'd fix.",
    visibilityClassName: "hidden @lg:flex",
  },
  {
    icon: BugIcon,
    label: "Track down a bug",
    prompt: "Something is broken: ",
    visibilityClassName: "hidden @2xl:flex",
  },
];

export function DraftHeroSuggestions() {
  const composerHandleRef = useComposerHandleContext();

  const applySuggestion = useCallback(
    (prompt: string) => {
      const composer = composerHandleRef?.current;
      if (!composer) {
        return;
      }
      composer.insertTextAtEnd(prompt, { ensureLeadingBoundary: true });
      composer.focusAtEnd();
    },
    [composerHandleRef],
  );

  if (!composerHandleRef) {
    return null;
  }

  /*
   * One card leaves at a time, and the column count follows it exactly, so the
   * row is always full and never opens a hole where a hidden card used to sit.
   *
   * The thresholds are container widths, not viewport widths, and they have to
   * clear the four-card mark inside the composer's own measure — which is capped
   * at `max-w-3xl`. The previous ladder asked for 48rem before showing cards
   * three and four; the composer column reaches that only on a very wide window,
   * so in practice the hero showed two cards and jumped straight to one.
   */
  return (
    <div className="pointer-events-auto mx-auto mt-8 grid w-full max-w-3xl grid-cols-1 gap-2 px-4 @xs:grid-cols-2 @lg:grid-cols-3 @2xl:grid-cols-4">
      {SUGGESTIONS.map(({ icon: Icon, label, prompt, visibilityClassName }) => (
        <button
          key={label}
          type="button"
          onClick={() => applySuggestion(prompt)}
          className={cn(
            // `translate`, not `transform`: the hover lift is a `translate-y`
            // utility, which Tailwind v4 compiles to the property of that name.
            "group min-h-24 cursor-default flex-col items-start gap-2.5 rounded-xl border border-border/60 bg-card p-3 text-left transition-[translate,border-color,background-color] hover:-translate-y-px hover:border-border focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0",
            visibilityClassName,
          )}
        >
          <Icon className="size-4 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground/80" />
          <span className="hyphens-none text-(length:--text-ui) leading-snug text-muted-foreground/85 tracking-[-0.006em] [overflow-wrap:normal] group-hover:text-foreground/90">
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}
