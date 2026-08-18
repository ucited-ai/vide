/**
 * Local usage ledger for Claude and Codex transcripts.
 *
 * Cost is API-equivalent, not money billed. Multi-account readiness, live
 * quotas and account switching deliberately live outside this layer.
 *
 * @module components/settings/UsageSettings
 */
import { AlertTriangleIcon, InfoIcon, RefreshCwIcon } from "lucide-react";
import type { UsageProviderKind, UsageSummaryInput } from "@vide/contracts";
import type { DailyTotals, HourlyTotals } from "@vide/shared/usageMerge";
import {
  enumerateDays,
  enumerateHourStarts,
  formatDateTimeShort,
  formatPercent,
  formatTokens,
  formatUsd,
  makeWindow,
} from "@vide/shared/usageFormat";
import { useMemo, useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { useUsage, type EnvironmentUsageStatus } from "../../state/usage";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  UsageActivityField,
  type UsageActivityMetric,
  type UsageGrouping,
  type UsagePinnedPeriod,
} from "./UsageActivityField";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

export type UsageRangeDays = 1 | 7 | 30 | 90 | 365;
export type UsageProviderScope = "all" | UsageProviderKind;

export interface UsageSettingsSelection {
  readonly rangeDays: UsageRangeDays;
  readonly provider: UsageProviderScope;
  readonly model?: string;
  readonly groupBy: UsageGrouping;
  readonly metric: UsageActivityMetric;
}

export type UsageSettingsSelectionPatch = Omit<Partial<UsageSettingsSelection>, "model"> & {
  readonly model?: string | undefined;
};

const WINDOW_OPTIONS: readonly { days: UsageRangeDays; label: string }[] = [
  { days: 1, label: "Last 24 hours" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 365, label: "Last year" },
];

const PROVIDER_LABEL: Record<UsageProviderKind, string> = {
  claude: "Claude",
  codex: "Codex",
};

const EMPTY_PERIOD = {
  costUsd: 0,
  totalTokens: 0,
  records: 0,
  byProvider: new Map(),
  byModel: new Map(),
} as const;

function HeadlineStat({
  label,
  value,
  tooltip,
  className,
}: {
  readonly label: string;
  readonly value: string;
  readonly tooltip?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-1.5 text-(length:--text-caption) text-muted-foreground/70">
        <span className="truncate">{label}</span>
        {tooltip === undefined ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm hover:text-foreground"
                  aria-label={`${label} details`}
                >
                  <InfoIcon className="size-3" />
                </button>
              }
            />
            <TooltipPopup
              side="top"
              className="max-w-[min(300px,calc(100vw-2rem))] whitespace-normal text-left text-(length:--text-caption) leading-relaxed"
            >
              {tooltip}
            </TooltipPopup>
          </Tooltip>
        )}
      </div>
      <div className="mt-1 truncate font-mono text-(length:--text-ui) font-semibold tracking-[-0.02em] text-foreground tabular-nums">
        {value}
      </div>
    </div>
  );
}

function UsageSkeleton() {
  return (
    <div aria-label="Loading usage" className="animate-pulse rounded-xl px-3 py-3 sm:px-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index}>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-4 w-20" />
          </div>
        ))}
      </div>
      <div className="mt-5 border-t border-border/60 pt-4">
        <Skeleton className="h-3 w-28" />
        <div className="mt-3 flex gap-1 overflow-hidden">
          {Array.from({ length: 24 }, (_, index) => (
            <Skeleton key={index} className="size-2.5 shrink-0 rounded-[3px]" />
          ))}
        </div>
      </div>
    </div>
  );
}

function UsageControls({
  selection,
  modelOptions,
  onChange,
}: {
  readonly selection: UsageSettingsSelection;
  readonly modelOptions: readonly string[];
  readonly onChange: (patch: UsageSettingsSelectionPatch) => void;
}) {
  return (
    <>
      <SettingsRow
        title="Source"
        description="Local Claude and Codex transcripts. Narrow the ledger to one provider or model."
        control={
          <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end">
            <Select
              value={selection.provider}
              onValueChange={(value) => {
                if (value === "all" || value === "claude" || value === "codex") {
                  onChange({ provider: value, model: undefined });
                }
              }}
            >
              <SelectTrigger size="sm" className="w-32" aria-label="Provider scope">
                <SelectValue>
                  {selection.provider === "all" ? "All usage" : PROVIDER_LABEL[selection.provider]}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="all">All usage</SelectItem>
                <SelectItem value="claude">Claude</SelectItem>
                <SelectItem value="codex">Codex</SelectItem>
              </SelectPopup>
            </Select>

            <Select
              value={selection.model ?? "all"}
              onValueChange={(value) => {
                if (typeof value === "string") {
                  onChange({ model: value === "all" ? undefined : value });
                }
              }}
            >
              <SelectTrigger size="sm" className="w-40" aria-label="Model filter">
                <SelectValue>{selection.model ?? "All models"}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false} className="max-w-72">
                <SelectItem value="all">All models</SelectItem>
                {modelOptions.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        }
      />

      <SettingsRow
        title="Period"
        description="Choose the reporting window. Recent ranges use hourly activity; longer ranges use daily totals."
        control={
          <Select
            value={String(selection.rangeDays)}
            onValueChange={(value) => {
              const next = Number(value);
              if (next === 1 || next === 7 || next === 30 || next === 90 || next === 365) {
                onChange({ rangeDays: next });
              }
            }}
          >
            <SelectTrigger size="sm" className="w-40" aria-label="Reporting window">
              <SelectValue>
                {WINDOW_OPTIONS.find((option) => option.days === selection.rangeDays)?.label ??
                  "Last 30 days"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {WINDOW_OPTIONS.map((option) => (
                <SelectItem key={option.days} value={String(option.days)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </>
  );
}

function CoverageNotice({
  unpricedShare,
  staleCount,
  duplicateCount,
}: {
  readonly unpricedShare: number;
  readonly staleCount: number;
  readonly duplicateCount: number;
}) {
  const notes: string[] = [];
  if (unpricedShare > 0) notes.push(`${formatPercent(unpricedShare)} of turns have no known rate.`);
  if (staleCount > 0)
    notes.push(
      `${staleCount} environment ${staleCount === 1 ? "is" : "are"} on an older usage format.`,
    );
  if (duplicateCount > 0)
    notes.push(
      `${duplicateCount} duplicate ${duplicateCount === 1 ? "source was" : "sources were"} excluded.`,
    );
  if (notes.length === 0) return null;

  return (
    <div className="flex gap-2.5 rounded-xl px-3 py-2.5 text-(length:--text-caption) leading-[1.5] text-muted-foreground sm:px-4">
      <AlertTriangleIcon className="mt-px size-3.5 shrink-0" />
      <p>{notes.join(" ")}</p>
    </div>
  );
}

function Breakdown({
  merged,
  grouping,
  open,
  pinnedPeriod,
  onOpenChange,
  onGroupingChange,
  onSelectProvider,
  onSelectModel,
}: {
  readonly merged: ReturnType<typeof useUsage>["merged"];
  readonly grouping: UsageGrouping;
  readonly open: boolean;
  readonly pinnedPeriod: UsagePinnedPeriod | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onGroupingChange: (grouping: UsageGrouping) => void;
  readonly onSelectProvider: (provider: UsageProviderKind) => void;
  readonly onSelectModel: (model: string) => void;
}) {
  const rows = (
    pinnedPeriod === null
      ? grouping === "provider"
        ? merged.providers.map((row) => ({
            key: row.provider,
            label: PROVIDER_LABEL[row.provider],
            provider: row.provider,
            costUsd: row.costUsd,
            totalTokens: row.totalTokens,
            records: row.records,
          }))
        : merged.models.map((row) => ({
            key: `${row.provider}:${row.model}`,
            label: row.model,
            provider: row.provider,
            costUsd: row.costUsd,
            totalTokens: row.totalTokens,
            records: row.records,
          }))
      : pinnedPeriod.contributors
  ).toSorted((a, b) => b.totalTokens - a.totalTokens || b.records - a.records);
  const totalTokens = pinnedPeriod?.totalTokens ?? merged.totalTokens;

  return (
    <div className="rounded-xl px-3 py-3 sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-(length:--text-ui) font-medium text-foreground">Breakdown</h3>
          <p className="mt-0.5 text-(length:--text-caption) text-muted-foreground/70">
            {pinnedPeriod === null ? "Select a row to narrow the ledger" : pinnedPeriod.label}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {open ? (
            <ToggleGroup
              size="xs"
              variant="ghost"
              value={[grouping]}
              onValueChange={(value) => {
                const next = value[0];
                if (next === "provider" || next === "model") onGroupingChange(next);
              }}
            >
              <Toggle value="provider">Providers</Toggle>
              <Toggle value="model">Models</Toggle>
            </ToggleGroup>
          ) : null}
          <Button size="xs" variant="ghost" onClick={() => onOpenChange(!open)}>
            {open ? "Hide" : "Show breakdown"}
          </Button>
        </div>
      </div>

      {!open ? null : rows.length === 0 ? (
        <p className="mt-3 border-t border-border/60 pt-3 text-(length:--text-ui) text-muted-foreground">
          No recorded usage in this window.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto border-t border-border/60">
          <table className="w-full min-w-[36rem] border-collapse text-(length:--text-ui)">
            <thead>
              <tr className="text-(length:--text-caption) text-muted-foreground/65">
                <th className="py-2 pr-4 text-left font-normal">
                  {grouping === "provider" ? "Provider" : "Model"}
                </th>
                <th className="px-4 py-2 text-right font-normal">Usage</th>
                <th className="px-4 py-2 text-right font-normal">Share</th>
                <th className="px-4 py-2 text-right font-normal">Turns</th>
                <th className="py-2 pl-4 text-right font-normal">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const share = totalTokens === 0 ? 0 : row.totalTokens / totalTokens;
                return (
                  <tr key={row.key} className="border-t border-border/60">
                    <td className="max-w-0 py-2.5 pr-4">
                      <button
                        type="button"
                        className="block max-w-full text-left hover:text-foreground/70 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() =>
                          grouping === "provider"
                            ? onSelectProvider(row.provider)
                            : onSelectModel(row.label)
                        }
                      >
                        <span className="block truncate text-foreground">{row.label}</span>
                        {grouping === "provider" ? null : (
                          <span className="block truncate text-(length:--text-caption) text-muted-foreground/65">
                            {PROVIDER_LABEL[row.provider]}
                          </span>
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-foreground tabular-nums">
                      {formatTokens(row.totalTokens)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-muted-foreground tabular-nums">
                      {formatPercent(share)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-muted-foreground tabular-nums">
                      {row.records.toLocaleString("en-US")}
                    </td>
                    <td className="py-2.5 pl-4 text-right font-mono text-muted-foreground tabular-nums">
                      {formatUsd(row.costUsd)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SourceFootnote({
  environments,
  mergedSessions,
  modelFiltered,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly mergedSessions: number;
  readonly modelFiltered: boolean;
}) {
  const diagnostics = useMemo(() => {
    let sourceCount = 0;
    let scannedFiles = 0;
    let skippedFiles = 0;
    let malformedRecords = 0;
    let scanDurationMs = 0;
    let readAt: string | null = null;
    for (const environment of environments) {
      const summary = environment.summary;
      if (summary === null) continue;
      sourceCount += summary.sources.filter((source) => source.status !== "missing").length;
      scannedFiles += summary.sources.reduce((total, source) => total + source.scannedFiles, 0);
      skippedFiles += summary.sources.reduce((total, source) => total + source.skippedFiles, 0);
      malformedRecords += summary.sources.reduce(
        (total, source) => total + source.malformedRecords,
        0,
      );
      scanDurationMs += summary.scanDurationMs;
      if (readAt === null || summary.readAt > readAt) readAt = summary.readAt;
    }
    return { sourceCount, scannedFiles, skippedFiles, malformedRecords, scanDurationMs, readAt };
  }, [environments]);

  const healthNotes = [
    diagnostics.skippedFiles > 0 ? `${diagnostics.skippedFiles} skipped` : null,
    diagnostics.malformedRecords > 0 ? `${diagnostics.malformedRecords} malformed` : null,
  ].filter((note): note is string => note !== null);

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-3 py-2 text-(length:--text-caption) text-muted-foreground/65 sm:px-4">
      <span>
        {diagnostics.sourceCount.toLocaleString("en-US")} sources ·{" "}
        {diagnostics.scannedFiles.toLocaleString("en-US")} files
        {modelFiltered ? "" : ` · ${mergedSessions.toLocaleString("en-US")} sessions`}
        {` · ${(diagnostics.scanDurationMs / 1000).toFixed(1)}s scan`}
      </span>
      <span>
        {healthNotes.length > 0 ? `${healthNotes.join(" · ")} · ` : ""}
        {diagnostics.readAt === null
          ? "Not yet indexed"
          : `Updated ${formatDateTimeShort(diagnostics.readAt)}`}
      </span>
    </div>
  );
}

export function UsageSettingsPanel({
  selection,
  onSelectionChange,
}: {
  readonly selection: UsageSettingsSelection;
  readonly onSelectionChange: (patch: UsageSettingsSelectionPatch) => void;
}) {
  const [windowRevision, setWindowRevision] = useState(0);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [pinnedPeriod, setPinnedPeriod] = useState<UsagePinnedPeriod | null>(null);
  const usesHourlyBuckets = selection.rangeDays <= 7;
  const window = useMemo(
    () => makeWindow(selection.rangeDays, undefined, usesHourlyBuckets ? "hour" : "day"),
    [selection.rangeDays, usesHourlyBuckets, windowRevision],
  );
  const provider = selection.provider === "all" ? undefined : selection.provider;
  const { merged, availableModels, environments, isPending, isPartial, refresh } = useUsage(
    window,
    {
      ...(provider === undefined ? {} : { provider }),
      ...(selection.model === undefined ? {} : { model: selection.model }),
    },
  );
  const settling = isPending || isPartial;

  const modelOptions = useMemo(() => {
    const names = new Set(availableModels.map((model) => model.model));
    if (selection.model !== undefined) names.add(selection.model);
    return [...names].toSorted((a, b) => a.localeCompare(b));
  }, [availableModels, selection.model]);

  const periods = useMemo<readonly (DailyTotals | HourlyTotals)[]>(() => {
    if (usesHourlyBuckets) {
      if (window.sinceTime === undefined || window.untilTime === undefined) return merged.hourly;
      const seen = new Map(merged.hourly.map((period) => [period.hourStart, period]));
      return enumerateHourStarts(window.sinceTime, window.untilTime).map(
        (hourStart) =>
          seen.get(hourStart) ?? { day: hourStart.slice(0, 10), hourStart, ...EMPTY_PERIOD },
      );
    }
    const seen = new Map(merged.daily.map((period) => [period.day, period]));
    return enumerateDays(window.sinceDay, window.untilDay).map(
      (day) => seen.get(day) ?? { day, ...EMPTY_PERIOD },
    );
  }, [merged.daily, merged.hourly, usesHourlyBuckets, window]);

  const observedInput = merged.uncachedInputTokens + merged.cachedInputTokens;
  const cacheReadShare = observedInput === 0 ? 0 : merged.cachedInputTokens / observedInput;
  const relativeTo = window.untilTime ?? `${window.untilDay}T23:59:59.999Z`;
  const changeSelection = (patch: UsageSettingsSelectionPatch) => {
    setPinnedPeriod(null);
    onSelectionChange(patch);
  };

  const refreshWindow = () => {
    setPinnedPeriod(null);
    const nextWindow: UsageSummaryInput = makeWindow(
      selection.rangeDays,
      undefined,
      usesHourlyBuckets ? "hour" : "day",
    );
    if (
      nextWindow.sinceDay === window.sinceDay &&
      nextWindow.untilDay === window.untilDay &&
      nextWindow.sinceTime === window.sinceTime &&
      nextWindow.untilTime === window.untilTime
    ) {
      refresh();
    } else {
      setWindowRevision((revision) => revision + 1);
    }
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Usage"
        headerAction={
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
            <TooltipPopup side="top">Rescan local transcripts</TooltipPopup>
          </Tooltip>
        }
      >
        <UsageControls
          selection={selection}
          modelOptions={modelOptions}
          onChange={changeSelection}
        />

        {settling ? (
          <UsageSkeleton />
        ) : (
          <>
            <div className="rounded-xl px-3 py-3 sm:px-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                <HeadlineStat label="Total tokens" value={formatTokens(merged.totalTokens)} />
                <HeadlineStat
                  label="Average / day"
                  value={formatTokens(merged.totalTokens / selection.rangeDays)}
                />
                <HeadlineStat
                  label="Turns"
                  value={merged.records.toLocaleString("en-US")}
                  tooltip="Provider usage records in this scope — the closest stable measure of completed generation turns."
                />
                <HeadlineStat
                  label="API-equivalent cost"
                  value={formatUsd(merged.costUsd)}
                  tooltip="Estimated API value of these tokens, not money billed. Subscription plans settle separately."
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-border/60 pt-2.5 text-(length:--text-caption) text-muted-foreground">
                <span>
                  Input{" "}
                  <strong className="font-mono font-normal text-foreground tabular-nums">
                    {formatTokens(merged.uncachedInputTokens)}
                  </strong>
                </span>
                <span>
                  Cache read{" "}
                  <strong className="font-mono font-normal text-foreground tabular-nums">
                    {formatTokens(merged.cachedInputTokens)}
                  </strong>{" "}
                  · {formatPercent(cacheReadShare)}
                </span>
                <span>
                  Cache write{" "}
                  <strong className="font-mono font-normal text-foreground tabular-nums">
                    {formatTokens(merged.cacheCreationTokens)}
                  </strong>
                </span>
                <span>
                  Output{" "}
                  <strong className="font-mono font-normal text-foreground tabular-nums">
                    {formatTokens(merged.outputTokens)}
                  </strong>
                </span>
                <span>
                  Reasoning{" "}
                  <strong className="font-mono font-normal text-foreground tabular-nums">
                    {formatTokens(merged.reasoningTokens)}
                  </strong>
                </span>
                <span className="sm:ml-auto">
                  Cache value{" "}
                  <strong className="font-mono font-normal text-foreground tabular-nums">
                    {formatUsd(merged.costQuality.cacheSavingsUsd)}
                  </strong>
                </span>
              </div>
            </div>

            <UsageActivityField
              key={`${selection.rangeDays}:${selection.provider}:${selection.model ?? "all"}:${selection.groupBy}`}
              periods={periods}
              rangeDays={selection.rangeDays}
              metric={selection.metric}
              grouping={selection.groupBy}
              relativeTo={relativeTo}
              timeZone={window.timeZone}
              onMetricChange={(metric) => changeSelection({ metric })}
              onPinnedPeriodChange={(period) => {
                setPinnedPeriod(period);
                if (period !== null) setBreakdownOpen(true);
              }}
            />

            <CoverageNotice
              unpricedShare={merged.costQuality.unpricedShare}
              staleCount={merged.staleEnvironments.length}
              duplicateCount={merged.duplicateSources.length}
            />

            <Breakdown
              merged={merged}
              grouping={selection.groupBy}
              open={breakdownOpen}
              pinnedPeriod={pinnedPeriod}
              onOpenChange={setBreakdownOpen}
              onGroupingChange={(groupBy) => changeSelection({ groupBy })}
              onSelectProvider={(nextProvider) =>
                changeSelection({ provider: nextProvider, model: undefined })
              }
              onSelectModel={(model) => changeSelection({ model })}
            />

            <SourceFootnote
              environments={environments}
              mergedSessions={merged.sessions}
              modelFiltered={selection.model !== undefined}
            />
          </>
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
