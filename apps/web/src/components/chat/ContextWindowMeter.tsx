import { cn } from "~/lib/utils";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { PINNED_POPUP_COLLISION_AVOIDANCE } from "./ProviderModelPicker";
import {
  COMPOSER_CONTROL_GAP_CLASS,
  COMPOSER_CONTROL_HEIGHT_CLASS,
  COMPOSER_CONTROL_TEXT_CLASS,
} from "./composerControlMetrics";

/*
 * Context usage, read at a glance.
 *
 * A ring told you a proportion but never a quantity, so the number that
 * actually matters — how much room is left — lived a hover away. A bar carries
 * both: the fill is the proportion and the label beside it is the count. It
 * stays monochrome until usage is genuinely near the ceiling, because a meter
 * that changes colour at the halfway mark trains you to ignore it.
 */
const NEAR_LIMIT_PERCENTAGE = 90;

function formatPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

export function ContextWindowMeter(props: {
  usage: ContextWindowSnapshot;
  providerDisplayName?: string | null;
}) {
  const { usage, providerDisplayName } = props;
  const usedPercentage = formatPercentage(usage.usedPercentage);
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  const totalProcessedTokens = usage.totalProcessedTokens ?? null;
  const showTotalProcessed = totalProcessedTokens !== null && totalProcessedTokens > 0;
  const isNearLimit = normalizedPercentage > NEAR_LIMIT_PERCENTAGE;
  const usedLabel = formatContextWindowTokens(usage.usedTokens ?? null);
  const maxTokens = usage.maxTokens ?? null;
  // "48k / 200k" — the ceiling is what makes the used figure mean anything, so
  // it only drops out when the provider does not report one.
  const label =
    maxTokens === null ? usedLabel : `${usedLabel} / ${formatContextWindowTokens(maxTokens)}`;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              // Shares its height, type size, and gap with the permissions
              // and model-trigger controls it sits beside in the row — see
              // composerControlMetrics.ts.
              "inline-flex shrink-0 items-center rounded-md px-1.5 tabular-nums outline-none transition-colors",
              COMPOSER_CONTROL_HEIGHT_CLASS,
              COMPOSER_CONTROL_TEXT_CLASS,
              COMPOSER_CONTROL_GAP_CLASS,
              isNearLimit ? "text-destructive" : "text-muted-foreground/70",
              "hover:bg-accent hover:text-foreground/80 data-[pressed]:bg-accent",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            )}
            aria-label={
              maxTokens !== null && usedPercentage
                ? `Context window ${usedPercentage} used`
                : `Context window ${usedLabel} tokens used`
            }
          >
            <span
              aria-hidden="true"
              className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-foreground/12"
            >
              <span
                className={cn(
                  "block h-full rounded-full transition-[width] duration-(--duration-slow) motion-reduce:transition-none",
                  isNearLimit ? "bg-destructive/80" : "bg-foreground/45",
                )}
                style={{ width: `${normalizedPercentage}%` }}
              />
            </span>
            <span className="whitespace-nowrap">{label}</span>
          </button>
        }
      />
      {/* Opens rightwards from the trigger's own start edge, the way the model
          picker and the permissions list beside it do. Aligned to the end it
          grew back over the controls it sits after, so the one popup in the row
          that unfolded leftwards was this one. */}
      <PopoverPopup
        side="top"
        align="start"
        collisionAvoidance={PINNED_POPUP_COLLISION_AVOIDANCE}
        className="w-64"
      >
        {/* Name over a muted detail line, left-aligned throughout — the same
            reading order as a model picker row or a permissions item, rather
            than a label-left/value-right spread that read as its own thing. */}
        <div className="flex flex-col gap-3 text-left">
          <div className="flex flex-col gap-0.5">
            <div className="text-(length:--text-ui) font-medium text-foreground">
              Context Window
            </div>
            <div className="text-(length:--text-caption) tabular-nums text-muted-foreground">
              {maxTokens !== null && usedPercentage ? `${usedPercentage} · ${label}` : usedLabel}
            </div>
          </div>
          {showTotalProcessed ? (
            <div className="flex flex-col gap-0.5">
              <div className="text-(length:--text-ui) font-medium text-foreground">
                Total processed
              </div>
              <div className="text-(length:--text-caption) tabular-nums text-muted-foreground">
                {formatContextWindowTokens(totalProcessedTokens)}
              </div>
            </div>
          ) : null}
          {usage.compactsAutomatically ? (
            <div className="text-pretty text-(length:--text-caption) text-muted-foreground/70">
              {providerDisplayName ?? "It"} automatically compacts its context when needed.
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
