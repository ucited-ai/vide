import { cn } from "~/lib/utils";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

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
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            className={cn(
              // h-8/sm:h-7 is the button `sm` size: the meter is a peer of the
              // other controls in the row and has to sit on the same baseline.
              "inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-1.5 text-(length:--text-caption) tabular-nums outline-none transition-colors sm:h-7",
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
                  "block h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none",
                  isNearLimit ? "bg-destructive/80" : "bg-foreground/45",
                )}
                style={{ width: `${normalizedPercentage}%` }}
              />
            </span>
            <span className="whitespace-nowrap">{label}</span>
          </button>
        }
      />
      <PopoverPopup
        tooltipStyle
        side="top"
        align="end"
        className="dropdown-glass w-64 max-w-none border-0! bg-secondary! p-0 shadow-none! before:hidden"
      >
        <div className="flex flex-col gap-2 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium text-muted-foreground text-xs">Context Window</div>
            {maxTokens !== null && usedPercentage ? (
              <div className="text-[11px] tabular-nums text-muted-foreground/70">
                <span>{usedPercentage}</span>
                <span className="mx-1">·</span>
                <span>{label}</span>
              </div>
            ) : (
              <div className="text-[11px] tabular-nums text-muted-foreground/70">{usedLabel}</div>
            )}
          </div>
          {showTotalProcessed ? (
            <div className="flex items-center justify-between gap-3 text-[11px] leading-4">
              <span className="text-muted-foreground/60">Total processed</span>
              <span className="font-medium tabular-nums text-muted-foreground/80">
                {formatContextWindowTokens(totalProcessedTokens)}
              </span>
            </div>
          ) : null}
          {usage.compactsAutomatically ? (
            <div className="mt-1 text-pretty text-[11px] font-medium text-muted-foreground/70">
              {providerDisplayName ?? "It"} automatically compacts its context when needed.
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
