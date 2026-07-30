import { EnvironmentId, ProjectId, ProviderInstanceId } from "@vide/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
} from "~/sidebarProjectGrouping";
import type { Project } from "~/types";
import { filterProjectPickerEntries } from "./useProjectPicker";

const environmentId = EnvironmentId.make("env-primary");

function makeProject(title: string): Project {
  return {
    id: ProjectId.make(`project-${title}`),
    environmentId,
    title,
    workspaceRoot: `/tmp/${title}`,
    repositoryIdentity: null,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  };
}

const entries = buildSidebarProjectPickerEntries({
  groups: buildSidebarProjectSnapshots({
    projects: ["VisibilityDashbord", "morehub", "ucited-pipeline"].map(makeProject),
    settings: { sidebarProjectGroupingMode: "repository", sidebarProjectGroupingOverrides: {} },
    primaryEnvironmentId: environmentId,
    resolveEnvironmentLabel: () => null,
  }),
  preferredProjectRef: null,
});

function filteredNames(query: string): string[] {
  return filterProjectPickerEntries(entries, query).map((entry) => entry.group.displayName);
}

describe("filterProjectPickerEntries", () => {
  it("keeps every project when nothing is typed", () => {
    expect(filteredNames("")).toEqual(["VisibilityDashbord", "morehub", "ucited-pipeline"]);
    expect(filteredNames("   ")).toEqual(["VisibilityDashbord", "morehub", "ucited-pipeline"]);
  });

  it("matches anywhere in the name, ignoring case and surrounding space", () => {
    expect(filteredNames("hub")).toEqual(["morehub"]);
    expect(filteredNames("  DASH ")).toEqual(["VisibilityDashbord"]);
  });

  it("returns nothing when no name contains the query", () => {
    expect(filteredNames("nope")).toEqual([]);
  });
});
