/**
 * Keyboard-navigable activity field for local agent usage.
 *
 * The field uses only semantic tokens derived by vide-theme.css. Intensity is
 * quantile-based, while the fixed readout exposes the exact values so colour
 * is never the only information channel.
 *
 * @module components/settings/UsageActivityField
 */
import type { DailyTotals, HourlyTotals } from "@vide/shared/usageMerge";
import {
  formatDateTimeShort,
  formatDayShort,
  formatRelativeHourShort,
  formatUsd,
} from "@vide/shared/usageFormat";
import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import { cn } from "../../lib/utils";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { SettingsRow } from "./settingsLayout";
import {
  nextUsageActivityIndex,
  usageQuantileLevel,
  type UsageActivityNavigationKey,
} from "./UsageActivityField.logic";

export type UsageActivityMetric = "tokens" | "turns" | "cost";
export type UsageGrouping = "provider" | "model";

export interface UsageActivityContributor {
  readonly key: string;
  readonly label: string;
  readonly provider: "claude" | "codex";
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly records: number;
}

export interface UsagePinnedPeriod {
  readonly label: string;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly records: number;
  readonly contributors: readonly UsageActivityContributor[];
}

interface ActivityDatum extends UsagePinnedPeriod {
  readonly key: string;
  readonly day: string;
  readonly hourStart?: string;
}

const EXACT_NUMBER = new Intl.NumberFormat("en-US");

const PROVIDER_LABEL = {
  claude: "Claude",
  codex: "Codex",
} as const;

function metricValue(
  value: Pick<ActivityDatum | UsageActivityContributor, "costUsd" | "totalTokens" | "records">,
  metric: UsageActivityMetric,
): number {
  if (metric === "cost") return value.costUsd;
  if (metric === "turns") return value.records;
  return value.totalTokens;
}

function periodContributors(
  period: DailyTotals | HourlyTotals,
  grouping: UsageGrouping,
): readonly UsageActivityContributor[] {
  if (grouping === "provider") {
    return [...period.byProvider.entries()].map(([provider, totals]) => ({
      key: provider,
      label: PROVIDER_LABEL[provider],
      provider,
      ...totals,
    }));
  }
  return [...period.byModel.entries()].map(([key, totals]) => ({
    key,
    label: totals.model,
    provider: totals.provider,
    costUsd: totals.costUsd,
    totalTokens: totals.totalTokens,
    records: totals.records,
  }));
}

function periodLabel(
  period: DailyTotals | HourlyTotals,
  relativeTo: string,
  timeZone: string,
): string {
  return "hourStart" in period
    ? formatRelativeHourShort(period.hourStart, relativeTo, timeZone)
    : formatDayShort(period.day);
}

function makeDatum(
  period: DailyTotals | HourlyTotals,
  grouping: UsageGrouping,
  relativeTo: string,
  timeZone: string,
): ActivityDatum {
  return {
    key: "hourStart" in period ? period.hourStart : period.day,
    day: period.day,
    ...("hourStart" in period ? { hourStart: period.hourStart } : {}),
    label: periodLabel(period, relativeTo, timeZone),
    costUsd: period.costUsd,
    totalTokens: period.totalTokens,
    records: period.records,
    contributors: periodContributors(period, grouping),
  };
}

function groupSixHours(
  periods: readonly ActivityDatum[],
  timeZone: string,
): readonly ActivityDatum[] {
  const groups: ActivityDatum[] = [];
  for (let index = 0; index < periods.length; index += 6) {
    const slice = periods.slice(index, index + 6);
    const first = slice[0];
    if (first === undefined) continue;

    const contributorMap = new Map<string, UsageActivityContributor>();
    let costUsd = 0;
    let totalTokens = 0;
    let records = 0;
    for (const period of slice) {
      costUsd += period.costUsd;
      totalTokens += period.totalTokens;
      records += period.records;
      for (const contributor of period.contributors) {
        const current = contributorMap.get(contributor.key) ?? {
          key: contributor.key,
          label: contributor.label,
          provider: contributor.provider,
          costUsd: 0,
          totalTokens: 0,
          records: 0,
        };
        contributorMap.set(contributor.key, {
          ...current,
          costUsd: current.costUsd + contributor.costUsd,
          totalTokens: current.totalTokens + contributor.totalTokens,
          records: current.records + contributor.records,
        });
      }
    }

    groups.push({
      key: first.key,
      day: first.day,
      ...(first.hourStart === undefined ? {} : { hourStart: first.hourStart }),
      label:
        first.hourStart === undefined
          ? first.label
          : `${formatDateTimeShort(first.hourStart, timeZone)} · 6h`,
      costUsd,
      totalTokens,
      records,
      contributors: [...contributorMap.values()],
    });
  }
  return groups;
}

function initialActiveIndex(data: readonly ActivityDatum[]): number {
  for (let index = data.length - 1; index >= 0; index -= 1) {
    if (data[index]!.records > 0) return index;
  }
  return Math.max(0, data.length - 1);
}

export function UsageActivityField({
  periods,
  rangeDays,
  metric,
  grouping,
  relativeTo,
  timeZone,
  onMetricChange,
  onPinnedPeriodChange,
}: {
  readonly periods: readonly (DailyTotals | HourlyTotals)[];
  readonly rangeDays: number;
  readonly metric: UsageActivityMetric;
  readonly grouping: UsageGrouping;
  readonly relativeTo: string;
  readonly timeZone: string;
  readonly onMetricChange: (metric: UsageActivityMetric) => void;
  readonly onPinnedPeriodChange: (period: UsagePinnedPeriod | null) => void;
}) {
  const data = useMemo(() => {
    const raw = periods.map((period) => makeDatum(period, grouping, relativeTo, timeZone));
    return rangeDays === 7 ? groupSixHours(raw, timeZone) : raw;
  }, [grouping, periods, rangeDays, relativeTo, timeZone]);
  const [activeIndex, setActiveIndex] = useState(() => initialActiveIndex(data));
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const safeActiveIndex = Math.min(activeIndex, Math.max(0, data.length - 1));
  const safePinnedIndex =
    pinnedIndex === null ? null : Math.min(pinnedIndex, Math.max(0, data.length - 1));
  const readoutIndex = safeActiveIndex;
  const readout = data[readoutIndex];
  const values = useMemo(
    () =>
      data
        .map((datum) => metricValue(datum, metric))
        .filter((value) => value > 0)
        .toSorted((a, b) => a - b),
    [data, metric],
  );
  const rowCount = rangeDays <= 30 ? 1 : 7;
  const leadingPlaceholders = useMemo(() => {
    if (rangeDays <= 30 || data.length === 0) return 0;
    const weekday = new Date(`${data[0]!.day}T00:00:00Z`).getUTCDay();
    return (weekday + 6) % 7;
  }, [data, rangeDays]);
  const cellSize = rangeDays <= 30 ? 10 : rangeDays <= 90 ? 10 : 8;
  const gridStyle: CSSProperties = {
    gridTemplateRows: `repeat(${String(rowCount)}, ${String(cellSize)}px)`,
    gridAutoColumns: `${String(cellSize)}px`,
  };

  const moveFocus = (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      setPinnedIndex(null);
      onPinnedPeriodChange(null);
      return;
    }
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    const next = nextUsageActivityIndex(
      index,
      event.key as UsageActivityNavigationKey,
      rowCount,
      data.length,
    );
    setActiveIndex(next);
    cellRefs.current[next]?.focus();
  };

  const topContributor = readout?.contributors.toSorted(
    (a, b) => metricValue(b, metric) - metricValue(a, metric),
  )[0];
  const topShare =
    readout === undefined || topContributor === undefined || metricValue(readout, metric) === 0
      ? 0
      : metricValue(topContributor, metric) / metricValue(readout, metric);

  return (
    <SettingsRow
      title="Activity"
      description="Relative intensity by period. Hover or focus for exact values; click to pin a breakdown."
      control={
        <ToggleGroup
          size="xs"
          variant="outline"
          value={[metric]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "tokens" || next === "turns" || next === "cost") onMetricChange(next);
          }}
        >
          <Toggle value="tokens">Tokens</Toggle>
          <Toggle value="turns">Turns</Toggle>
          <Toggle value="cost">Cost</Toggle>
        </ToggleGroup>
      }
    >
      <div className="mt-3 overflow-x-auto pb-2">
        <div
          className="w-max"
          onPointerLeave={() => {
            if (safePinnedIndex !== null) setActiveIndex(safePinnedIndex);
          }}
        >
          <div
            className="grid w-max grid-flow-col gap-1"
            style={gridStyle}
            role="grid"
            aria-label="Usage activity by period"
          >
            {Array.from({ length: leadingPlaceholders }, (_, index) => (
              <span key={`leading-${index}`} aria-hidden className="aspect-square" />
            ))}
            {data.map((datum, index) => {
              const value = metricValue(datum, metric);
              const level = usageQuantileLevel(value, values);
              return (
                <button
                  key={datum.key}
                  ref={(element) => {
                    cellRefs.current[index] = element;
                  }}
                  type="button"
                  role="gridcell"
                  data-level={level}
                  aria-label={`${datum.label}: ${EXACT_NUMBER.format(datum.totalTokens)} tokens, ${EXACT_NUMBER.format(datum.records)} turns, ${formatUsd(datum.costUsd)}`}
                  aria-pressed={safePinnedIndex === index}
                  tabIndex={readoutIndex === index ? 0 : -1}
                  className={cn(
                    "rounded-[3px] outline-none transition-[filter,box-shadow,transform] motion-reduce:transition-none",
                    "data-[level=0]:bg-(--usage-activity-empty) data-[level=1]:bg-(--usage-activity-1) data-[level=2]:bg-(--usage-activity-2) data-[level=3]:bg-(--usage-activity-3) data-[level=4]:bg-(--usage-activity-4) data-[level=5]:bg-(--usage-activity-5)",
                    "hover:z-10 hover:scale-125 hover:ring-1 hover:ring-foreground/35 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-(--usage-activity-outline) focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    safePinnedIndex === index &&
                      "ring-2 ring-(--usage-activity-outline) ring-offset-2 ring-offset-background",
                  )}
                  onPointerEnter={() => setActiveIndex(index)}
                  onFocus={() => setActiveIndex(index)}
                  onClick={() => {
                    const nextIndex = safePinnedIndex === index ? null : index;
                    setPinnedIndex(nextIndex);
                    onPinnedPeriodChange(nextIndex === null ? null : datum);
                  }}
                  onKeyDown={(event) => moveFocus(index, event)}
                />
              );
            })}
          </div>
          {data.length > 0 ? (
            <div className="mt-2 flex justify-between text-(length:--text-micro) text-muted-foreground/60">
              <span>{data[0]!.label}</span>
              <span>{data[data.length - 1]!.label}</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-(length:--text-caption)">
        {readout === undefined ? (
          <span className="col-span-full text-muted-foreground">
            No recorded usage in this window.
          </span>
        ) : (
          <>
            <span className="truncate font-medium text-foreground">
              {readout.label}
              {safePinnedIndex === readoutIndex ? (
                <span className="ml-1.5 font-normal text-muted-foreground">Pinned</span>
              ) : null}
            </span>
            <span className="font-mono tabular-nums text-foreground">
              {EXACT_NUMBER.format(readout.totalTokens)} tokens
            </span>
            <span className="font-mono tabular-nums text-muted-foreground">
              {EXACT_NUMBER.format(readout.records)} turns
            </span>
            <span className="truncate text-muted-foreground sm:ml-auto">
              {topContributor === undefined
                ? "No contributor"
                : `${topContributor.label} · ${Math.round(topShare * 100)}%`}
            </span>
          </>
        )}
      </div>
    </SettingsRow>
  );
}
