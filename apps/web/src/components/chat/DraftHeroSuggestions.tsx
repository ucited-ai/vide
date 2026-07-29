import { BugIcon, HammerIcon, ScanSearchIcon, GitPullRequestArrowIcon } from "lucide-react";
import { useCallback } from "react";

import { useComposerHandleContext } from "~/composerHandleContext";

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
}

const SUGGESTIONS: readonly Suggestion[] = [
  {
    icon: ScanSearchIcon,
    label: "Explore and understand code",
    prompt: "Walk me through how ",
  },
  {
    icon: HammerIcon,
    label: "Build a feature or a tool",
    prompt: "Add a feature that ",
  },
  {
    icon: GitPullRequestArrowIcon,
    label: "Review changes and suggest fixes",
    prompt: "Review my current changes and tell me what you'd fix.",
  },
  {
    icon: BugIcon,
    label: "Track down a bug",
    prompt: "Something is broken: ",
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

  return (
    <div className="pointer-events-auto mx-auto mt-8 grid w-full max-w-3xl grid-cols-2 gap-2 px-4 sm:grid-cols-4">
      {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
        <button
          key={label}
          type="button"
          onClick={() => applySuggestion(prompt)}
          className="vide-material-thin group flex min-h-24 cursor-default flex-col items-start gap-2.5 rounded-xl border border-border/60 p-3 text-left transition-[transform,border-color,background-color] duration-150 ease-out hover:-translate-y-px hover:border-border focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        >
          <Icon className="size-4 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground/80" />
          <span className="text-[13px] leading-snug text-muted-foreground/85 tracking-[-0.006em] group-hover:text-foreground/90">
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}
