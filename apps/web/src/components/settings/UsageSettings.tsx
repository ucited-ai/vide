/**
 * Usage and cost reporting.
 *
 * Every connected environment scans the provider CLIs' own transcripts and
 * returns pre-aggregated buckets; this page merges them and presents the
 * result. Cost is API-equivalent, not money billed — subscriptions settle
 * separately, and the page says so rather than implying a bill.
 *
 * @module components/settings/UsageSettings
 */
import { AlertTriangleIcon, InfoIcon, RefreshCwIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { UsageProviderKind, UsageSummaryInput } from "@vide/contracts";
import type { DailyTotals, HourlyTotals } from "@vide/shared/usageMerge";
import {
  enumerateDays,
  enumerateHourStarts,
  formatDayShort,
  formatPercent,
  formatRelativeHourShort,
  formatTokens,
  formatUsd,
  makeWindow,
} from "@vide/shared/usageFormat";

import { cn } from "../../lib/utils";
import { useUsage, type EnvironmentUsageStatus } from "../../state/usage";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { UsageActivityChart, type UsageChartMetric } from "./UsageActivityChart";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

const WINDOW_OPTIONS = [
  { days: 1, label: "24h" },
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
] as const;

const PROVIDER_LABEL: Record<UsageProviderKind, string> = {
  claude: "Claude",
  codex: "Codex",
};

function Stat({
  label,
  value,
  tooltip,
  emphasis = false,
}: {
  label: string;
  value: string;
  tooltip?: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0 px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-1.5 text-(length:--text-caption) font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
        <span className="min-w-0 truncate">{label}</span>
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 hover:text-foreground"
                  aria-label={`${label} details`}
                >
                  <InfoIcon className="size-3" />
                </button>
              }
            />
            <TooltipPopup
              side="top"
              className="max-w-[min(300px,calc(100vw-2rem))] whitespace-normal text-left text-(length:--text-caption) leading-relaxed text-wrap"
            >
              {tooltip}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      <div
        className={cn(
          "mt-1 truncate font-mono tabular-nums text-foreground",
          emphasis
            ? "text-(length:--text-title) font-semibold"
            : "text-(length:--text-section) font-semibold",
        )}
      >
        {value}
      </div>
    </div>
  );
}

/** Hairline-separated cell strip, matching the diagnostics page's stat grid. */
function StatStrip({ children, columns }: { children: ReactNode; columns: string }) {
  return (
    <div className={cn("grid divide-x divide-y divide-border/60 [&>*]:border-border/60", columns)}>
      {children}
    </div>
  );
}

function SurfaceCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-(--edge) bg-(--surface-raised)",
        className,
      )}
    >
      {children}
    </div>
  );
}

function CoverageNotice({
  unpricedShare,
  staleCount,
  duplicateCount,
}: {
  unpricedShare: number;
  staleCount: number;
  duplicateCount: number;
}) {
  const notes: string[] = [];
  if (unpricedShare > 0) {
    notes.push(
      `${formatPercent(unpricedShare)} of tokens came from models with no known rate. They count toward tokens but not toward cost.`,
    );
  }
  if (staleCount > 0) {
    notes.push(
      `${staleCount} ${staleCount === 1 ? "environment reports" : "environments report"} an older usage format, so their share may be incomplete.`,
    );
  }
  if (duplicateCount > 0) {
    notes.push(
      `${duplicateCount} duplicate ${duplicateCount === 1 ? "source was" : "sources were"} dropped — two environments resolved the same transcript directory.`,
    );
  }
  if (notes.length === 0) return null;

  return (
    <div className="flex gap-2.5 rounded-xl border border-(--edge) bg-(--surface-recessed) px-4 py-3 text-(length:--text-caption) leading-[1.5] text-muted-foreground sm:px-5">
      <AlertTriangleIcon className="mt-px size-3.5 shrink-0 text-muted-foreground/70" />
      <div className="space-y-1">
        {notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </div>
    </div>
  );
}

function DeviceRow({ environment }: { environment: EnvironmentUsageStatus }) {
  const state = environment.error
    ? { label: "Unavailable", tone: "text-destructive" }
    : environment.summary === null
      ? { label: "Reporting…", tone: "text-muted-foreground" }
      : { label: "Reported", tone: "text-muted-foreground" };

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5 sm:px-5">
      <span className="min-w-0 truncate text-(length:--text-ui) text-foreground">
        {environment.label}
      </span>
      <span className={cn("shrink-0 text-(length:--text-caption)", state.tone)}>
        {environment.error ?? state.label}
      </span>
    </div>
  );
}

function UsageSkeleton() {
  return (
    <div className="space-y-3 px-4 py-4 sm:px-5">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-4 w-40" />
    </div>
  );
}

export function UsageSettingsPanel() {
  const [windowSelection, setWindowSelection] = useState(() => ({
    days: 30,
    window: makeWindow(30),
  }));
  const [metric, setMetric] = useState<UsageChartMetric>("cost");
  const { days: windowDays, window } = windowSelection;
  const isPast24Hours = windowDays === 1;
  const { merged, environments, isPending, isPartial, refresh } = useUsage(window);

  // Hold the numbers until every environment is terminal: rendering merged
  // totals while devices still answer makes every figure on the page jump.
  const settling = isPending || isPartial;

  // Enumerate the whole window and fill the gaps: a period with no traffic has
  // to keep its slot, or the axis silently compresses and a quiet week reads
  // like a busy one.
  const periods = useMemo<readonly (DailyTotals | HourlyTotals)[]>(() => {
    const empty = { costUsd: 0, totalTokens: 0, byProvider: new Map() } as const;
    if (isPast24Hours) {
      if (window.sinceTime === undefined || window.untilTime === undefined) return merged.hourly;
      const seen = new Map(merged.hourly.map((period) => [period.hourStart, period]));
      return enumerateHourStarts(window.sinceTime, window.untilTime).map(
        (hourStart) => seen.get(hourStart) ?? { day: hourStart.slice(0, 10), hourStart, ...empty },
      );
    }
    const seen = new Map(merged.daily.map((period) => [period.day, period]));
    return enumerateDays(window.sinceDay, window.untilDay).map(
      (day) => seen.get(day) ?? { day, ...empty },
    );
  }, [
    isPast24Hours,
    merged.daily,
    merged.hourly,
    window.sinceDay,
    window.untilDay,
    window.sinceTime,
    window.untilTime,
  ]);

  // Ranked by the metric on screen, so the densest ink is always the biggest
  // band and the chart legend reads top-down.
  const orderedProviders = useMemo(
    () =>
      merged.providers
        .toSorted((a, b) =>
          metric === "cost" ? b.costUsd - a.costUsd : b.totalTokens - a.totalTokens,
        )
        .map((provider) => provider.provider),
    [merged.providers, metric],
  );

  const observedInput = merged.uncachedInputTokens + merged.cachedInputTokens;
  const cachedShare = observedInput === 0 ? 0 : merged.cachedInputTokens / observedInput;

  const labelFor = (period: DailyTotals | HourlyTotals) =>
    "hourStart" in period
      ? formatRelativeHourShort(period.hourStart, new Date().toISOString(), window.timeZone)
      : formatDayShort(period.day);

  const selectWindow = (days: number) => {
    setWindowSelection({
      days,
      window: makeWindow(days, undefined, days === 1 ? "hour" : "day"),
    });
  };

  const refreshWindow = () => {
    const nextWindow: UsageSummaryInput = makeWindow(
      windowDays,
      undefined,
      isPast24Hours ? "hour" : "day",
    );
    // Re-deriving the window would silently change nothing when the clock has
    // not crossed a bucket, so refresh the queries instead.
    if (
      nextWindow.sinceDay === window.sinceDay &&
      nextWindow.untilDay === window.untilDay &&
      nextWindow.sinceTime === window.sinceTime &&
      nextWindow.untilTime === window.untilTime
    ) {
      refresh();
    } else {
      setWindowSelection({ days: windowDays, window: nextWindow });
    }
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Usage"
        headerAction={
          <div className="flex items-center gap-2">
            <ToggleGroup
              size="xs"
              variant="outline"
              value={[String(windowDays)]}
              onValueChange={(value) => {
                const next = value[0];
                if (next !== undefined) selectWindow(Number.parseInt(next, 10));
              }}
            >
              {WINDOW_OPTIONS.map((option) => (
                <Toggle
                  key={option.days}
                  value={String(option.days)}
                  aria-label={`Show the past ${option.label}`}
                >
                  {option.label}
                </Toggle>
              ))}
            </ToggleGroup>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Refresh usage"
                    onClick={refreshWindow}
                  >
                    <RefreshCwIcon className={cn("size-3.5", settling && "animate-spin")} />
                  </Button>
                }
              />
              <TooltipPopup side="top">Rescan transcripts</TooltipPopup>
            </Tooltip>
          </div>
        }
      >
        <SurfaceCard>
          <StatStrip columns="grid-cols-2 sm:grid-cols-3">
            <Stat
              label="Cost"
              emphasis
              value={settling ? "—" : formatUsd(merged.costUsd)}
              tooltip="API-equivalent cost of the tokens in this window. It is not money billed: subscription plans settle separately."
            />
            <Stat
              label="Tokens"
              emphasis
              value={settling ? "—" : formatTokens(merged.totalTokens)}
            />
            <Stat
              label="Cache savings"
              emphasis
              value={settling ? "—" : formatUsd(merged.costQuality.cacheSavingsUsd)}
              tooltip="What the cached input would have cost at full input rates, minus what it actually cost."
            />
          </StatStrip>
        </SurfaceCard>

        <SurfaceCard>
          {settling ? (
            <UsageSkeleton />
          ) : (
            <>
              <div className="flex items-center justify-between gap-4 border-b border-border/60 px-4 py-2.5 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  {orderedProviders.map((provider, index) => (
                    <span
                      key={provider}
                      className="flex items-center gap-1.5 text-(length:--text-caption) text-muted-foreground"
                    >
                      <span
                        className={cn(
                          "size-2 rounded-[2px]",
                          index === 0 ? "bg-(--ink-secondary)" : "bg-(--ink-tertiary)",
                        )}
                      />
                      {PROVIDER_LABEL[provider]}
                    </span>
                  ))}
                </div>
                <ToggleGroup
                  size="xs"
                  variant="ghost"
                  value={[metric]}
                  onValueChange={(value) => {
                    const next = value[0];
                    if (next === "cost" || next === "tokens") setMetric(next);
                  }}
                >
                  <Toggle value="cost" aria-label="Chart cost">
                    Cost
                  </Toggle>
                  <Toggle value="tokens" aria-label="Chart tokens">
                    Tokens
                  </Toggle>
                </ToggleGroup>
              </div>
              <UsageActivityChart
                periods={periods}
                providers={orderedProviders}
                metric={metric}
                labelFor={labelFor}
                emptyLabel="No recorded usage in this window."
              />
            </>
          )}
        </SurfaceCard>

        {settling ? null : (
          <CoverageNotice
            unpricedShare={merged.costQuality.unpricedShare}
            staleCount={merged.staleEnvironments.length}
            duplicateCount={merged.duplicateSources.length}
          />
        )}
      </SettingsSection>

      <SettingsSection title="Tokens">
        <SurfaceCard>
          <StatStrip columns="grid-cols-2 sm:grid-cols-4">
            <Stat
              label="Uncached input"
              value={settling ? "—" : formatTokens(merged.uncachedInputTokens)}
            />
            <Stat
              label="Cached input"
              value={settling ? "—" : formatTokens(merged.cachedInputTokens)}
              tooltip={`${formatPercent(cachedShare)} of observed input was served from cache.`}
            />
            <Stat label="Output" value={settling ? "—" : formatTokens(merged.outputTokens)} />
            <Stat
              label="Reasoning"
              value={settling ? "—" : formatTokens(merged.reasoningTokens)}
              tooltip="A subset of output tokens, not an addition to them."
            />
          </StatStrip>
        </SurfaceCard>
      </SettingsSection>

      <SettingsSection title="Models">
        <SurfaceCard>
          {settling ? (
            <UsageSkeleton />
          ) : merged.models.length === 0 ? (
            <div className="px-4 py-4 text-(length:--text-ui) text-muted-foreground sm:px-5">
              No recorded usage in this window.
            </div>
          ) : (
            <table className="w-full border-collapse text-(length:--text-ui)">
              <thead>
                <tr className="border-b border-border/60 text-(length:--text-caption) text-muted-foreground/70">
                  <th className="px-4 py-2 text-left font-normal sm:px-5">Model</th>
                  <th className="px-4 py-2 text-right font-normal">Cost</th>
                  <th className="px-4 py-2 text-right font-normal">Share</th>
                  <th className="px-4 py-2 text-right font-normal sm:px-5">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {merged.models.map((model) => (
                  <tr
                    key={`${model.provider}:${model.model}`}
                    className="border-b border-border/60 last:border-b-0"
                  >
                    <td className="max-w-0 px-4 py-2 sm:px-5">
                      <div className="truncate text-foreground">{model.model}</div>
                      <div className="truncate text-(length:--text-caption) text-muted-foreground/70">
                        {PROVIDER_LABEL[model.provider]}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-foreground">
                      {formatUsd(model.costUsd)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="hidden h-1 w-16 overflow-hidden rounded-full bg-(--edge) sm:block">
                          <span
                            className="block h-full bg-(--ink-tertiary)"
                            style={{ width: `${Math.min(100, model.costShare * 100)}%` }}
                          />
                        </span>
                        <span className="font-mono tabular-nums text-muted-foreground">
                          {formatPercent(model.costShare)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-muted-foreground sm:px-5">
                      {formatTokens(model.totalTokens)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SurfaceCard>
      </SettingsSection>

      {environments.length > 1 ? (
        <SettingsSection title="Devices">
          <SurfaceCard>
            <div className="divide-y divide-border/60">
              {environments.map((environment) => (
                <DeviceRow key={environment.environmentId} environment={environment} />
              ))}
            </div>
          </SurfaceCard>
        </SettingsSection>
      ) : null}
    </SettingsPageContainer>
  );
}
