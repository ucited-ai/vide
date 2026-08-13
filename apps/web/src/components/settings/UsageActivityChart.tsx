/**
 * Monochrome activity chart for the usage page.
 *
 * Providers are told apart by ink weight rather than hue: the palette here is
 * the same ladder the rest of the app uses for text, so a chart never
 * introduces a colour the theme did not choose.
 *
 * @module components/settings/UsageActivityChart
 */
import type { UsageProviderKind } from "@vide/contracts";
import type { DailyTotals, HourlyTotals } from "@vide/shared/usageMerge";
import { formatTokens, formatUsd } from "@vide/shared/usageFormat";

import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export type UsageChartMetric = "cost" | "tokens";

/**
 * Ink weight per provider, densest first. Providers are ordered by spend before
 * they reach this list, so the heaviest spender reads as the darkest band.
 */
const PROVIDER_INK = [
  "bg-(--ink-secondary)",
  "bg-(--ink-tertiary)",
  "bg-(--ink-tertiary)/55",
] as const;

function periodValue(period: DailyTotals | HourlyTotals, metric: UsageChartMetric): number {
  return metric === "cost" ? period.costUsd : period.totalTokens;
}

function providerValue(
  period: DailyTotals | HourlyTotals,
  provider: UsageProviderKind,
  metric: UsageChartMetric,
): number {
  const totals = period.byProvider.get(provider);
  if (totals === undefined) return 0;
  return metric === "cost" ? totals.costUsd : totals.totalTokens;
}

function formatValue(value: number, metric: UsageChartMetric): string {
  return metric === "cost" ? formatUsd(value) : formatTokens(value);
}

export function UsageActivityChart({
  periods,
  providers,
  metric,
  labelFor,
  emptyLabel,
}: {
  readonly periods: readonly (DailyTotals | HourlyTotals)[];
  /** Ranked by the active metric; drives band order and ink weight. */
  readonly providers: readonly UsageProviderKind[];
  readonly metric: UsageChartMetric;
  readonly labelFor: (period: DailyTotals | HourlyTotals) => string;
  readonly emptyLabel: string;
}) {
  const peak = periods.reduce((max, period) => Math.max(max, periodValue(period, metric)), 0);

  if (periods.length === 0 || peak === 0) {
    return (
      <div className="flex h-40 items-center justify-center px-4 text-(length:--text-ui) text-muted-foreground sm:px-5">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 pb-3 sm:px-5">
      <div className="flex h-40 items-end gap-px" role="img" aria-label="Usage over time">
        {periods.map((period) => {
          const total = periodValue(period, metric);
          const label = labelFor(period);
          // A period that saw traffic keeps a hairline so the axis reads as a
          // timeline rather than as gaps.
          const heightPercent = total === 0 ? 0 : Math.max(1.5, (total / peak) * 100);

          return (
            <Tooltip key={"hourStart" in period ? period.hourStart : period.day}>
              <TooltipTrigger
                render={
                  <div
                    className="group flex h-full min-w-0 flex-1 cursor-default flex-col justify-end"
                    tabIndex={0}
                  >
                    <div
                      className="flex w-full flex-col-reverse overflow-hidden rounded-[2px] transition-opacity group-hover:opacity-80"
                      style={{ height: `${heightPercent}%` }}
                    >
                      {total === 0 ? (
                        <span className="h-full w-full bg-(--edge)" />
                      ) : (
                        providers.map((provider, index) => {
                          const value = providerValue(period, provider, metric);
                          if (value === 0) return null;
                          return (
                            <span
                              key={provider}
                              className={cn(
                                "w-full",
                                PROVIDER_INK[index] ?? PROVIDER_INK[PROVIDER_INK.length - 1],
                              )}
                              style={{ height: `${(value / total) * 100}%` }}
                            />
                          );
                        })
                      )}
                    </div>
                  </div>
                }
              />
              <TooltipPopup side="top" className="text-(length:--text-caption)">
                <span className="font-medium">{label}</span>
                <span className="ml-2 font-mono tabular-nums">{formatValue(total, metric)}</span>
              </TooltipPopup>
            </Tooltip>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between text-(length:--text-micro) text-muted-foreground/70">
        <span>{labelFor(periods[0]!)}</span>
        <span>{labelFor(periods[periods.length - 1]!)}</span>
      </div>
    </div>
  );
}
