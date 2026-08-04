import { CornerRightUpIcon, XIcon } from "lucide-react";

import { type QueuedPromptEntry } from "../../promptQueueStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * The prompt queue, over the chat — what is written but not yet read.
 *
 * Sits where the task list does, on the composer's own column. Each row is a
 * prompt the model has not seen: it says so, stays editable (activating a row
 * takes it back into the composer) and removable until the moment it is
 * dispatched. Only then does it become a message bubble — the transcript never
 * shows a "sent" message that nothing has read.
 *
 * Two ways a row leaves the queue while a turn runs:
 * - on a driver that steers mid-turn (Codex) the queue drains itself into the
 *   running turn (`autoSteers`), and the header says so;
 * - anywhere else, the per-row steer arrow sends that one prompt into the
 *   running turn explicitly. On Claude the SDK still holds it until its next
 *   read — same turn, not sooner — which is why the copy promises no timing.
 */
export function QueuedPromptsOverChat({
  entries,
  onEditEntry,
  onRemoveEntry,
  onSteerEntry,
  autoSteers,
}: {
  readonly entries: ReadonlyArray<QueuedPromptEntry>;
  /** Take the entry out of the queue and back into the composer. */
  readonly onEditEntry: (entry: QueuedPromptEntry) => void;
  readonly onRemoveEntry: (entryId: string) => void;
  /** Send the entry into the running turn now; null when no turn is running. */
  readonly onSteerEntry: ((entryId: string) => void) | null;
  /** The running turn's driver already drains this queue into the turn. */
  readonly autoSteers: boolean;
}) {
  if (entries.length === 0) return null;

  return (
    <div className="mx-auto flex max-h-[min(30vh,14rem)] w-full max-w-(--chat-column-width) min-h-0 flex-col overflow-hidden rounded-[var(--envcol-radius)] border border-(--envcol-edge) bg-(--envcol-surface) shadow-[var(--envcol-shadow)]">
      <div className="flex shrink-0 items-baseline justify-between px-3 pt-2 pb-1 text-(length:--text-caption) text-(--ink-tertiary)">
        <span>
          {autoSteers
            ? "Queued · feeds the running turn"
            : `Queued · ${entries.length === 1 ? "runs" : "run in order"} when this turn finishes`}
        </span>
        {onSteerEntry !== null && !autoSteers ? <span>⌘⏎ steers the running turn</span> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
        {entries.map((entry) => (
          <div
            className="group/queued-prompt flex items-center gap-2 rounded-(--radius) px-1.5 py-1 text-(length:--text-caption) hover:bg-(--wash-hover)"
            key={entry.id}
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-(--ink-secondary) hover:text-(--ink)"
              onClick={() => onEditEntry(entry)}
              title="Edit — moves the prompt back into the composer"
            >
              {entry.prompt.trim() || (entry.images.length > 0 ? "Image" : "")}
              {entry.images.length > 0 ? (
                <span className="text-(--ink-tertiary)">
                  {" "}
                  · {entry.images.length} {entry.images.length === 1 ? "image" : "images"}
                </span>
              ) : null}
            </button>
            {onSteerEntry !== null ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Send into the running turn"
                      className="shrink-0 rounded-(--radius) p-0.5 text-(--ink-tertiary) opacity-0 transition-opacity hover:text-(--ink) focus-visible:opacity-100 group-hover/queued-prompt:opacity-100"
                      onClick={() => onSteerEntry(entry.id)}
                    >
                      <CornerRightUpIcon className="size-3" />
                    </button>
                  }
                />
                <TooltipPopup>Send into the running turn</TooltipPopup>
              </Tooltip>
            ) : null}
            <button
              type="button"
              aria-label="Remove queued prompt"
              className="shrink-0 rounded-(--radius) p-0.5 text-(--ink-tertiary) opacity-0 transition-opacity hover:text-(--ink) focus-visible:opacity-100 group-hover/queued-prompt:opacity-100"
              onClick={() => onRemoveEntry(entry.id)}
            >
              <XIcon className="size-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
