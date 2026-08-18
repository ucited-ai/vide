import { createFileRoute } from "@tanstack/react-router";

import {
  UsageSettingsPanel,
  type UsageRangeDays,
  type UsageSettingsSelection,
} from "../components/settings/UsageSettings";
import type { UsageActivityMetric, UsageGrouping } from "../components/settings/UsageActivityField";

type UsageRange = "24h" | "7d" | "30d" | "90d" | "1y";

export interface UsageSearch {
  readonly range: UsageRange;
  readonly provider: "all" | "claude" | "codex";
  readonly model?: string;
  readonly groupBy: UsageGrouping;
  readonly metric: UsageActivityMetric;
}

const RANGE_TO_DAYS: Record<UsageRange, UsageRangeDays> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
};

const DAYS_TO_RANGE: Record<UsageRangeDays, UsageRange> = {
  1: "24h",
  7: "7d",
  30: "30d",
  90: "90d",
  365: "1y",
};

export const Route = createFileRoute("/settings/usage")({
  validateSearch: (search: Record<string, unknown>): UsageSearch => {
    const range =
      search.range === "24h" ||
      search.range === "7d" ||
      search.range === "30d" ||
      search.range === "90d" ||
      search.range === "1y"
        ? search.range
        : "30d";
    const provider =
      search.provider === "claude" || search.provider === "codex" ? search.provider : "all";
    const groupBy = search.groupBy === "model" ? "model" : "provider";
    const metric = search.metric === "cost" || search.metric === "turns" ? search.metric : "tokens";
    return {
      range,
      provider,
      ...(typeof search.model === "string" && search.model.length > 0
        ? { model: search.model }
        : {}),
      groupBy,
      metric,
    };
  },
  component: UsageRoute,
});

function UsageRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const selection: UsageSettingsSelection = {
    rangeDays: RANGE_TO_DAYS[search.range],
    provider: search.provider,
    ...(search.model === undefined ? {} : { model: search.model }),
    groupBy: search.groupBy,
    metric: search.metric,
  };

  return (
    <UsageSettingsPanel
      selection={selection}
      onSelectionChange={(patch) => {
        void navigate({
          replace: true,
          search: (previous) => {
            const model = "model" in patch ? patch.model : previous.model;
            return {
              range:
                patch.rangeDays === undefined ? previous.range : DAYS_TO_RANGE[patch.rangeDays],
              provider: patch.provider ?? previous.provider,
              ...(model === undefined ? {} : { model }),
              groupBy: patch.groupBy ?? previous.groupBy,
              metric: patch.metric ?? previous.metric,
            };
          },
        });
      }}
    />
  );
}
