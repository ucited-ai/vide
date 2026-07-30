import { scopedProjectKey, scopeProjectRef } from "@vide/client-runtime/environment";
import type { ScopedProjectRef } from "@vide/contracts";
import { useCallback, useMemo } from "react";

import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useClientSettings } from "~/hooks/useSettings";
import { selectProjectGroupingSettings } from "~/logicalProject";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
  type SidebarProjectPickerEntry,
} from "~/sidebarProjectGrouping";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { sortLogicalProjectsForSidebar } from "../Sidebar.logic";

export interface ProjectPicker {
  /** Logical project groups, ordered exactly as the sidebar orders them. */
  readonly entries: readonly SidebarProjectPickerEntry[];
  /** Key of the group the current thread belongs to, or "" when unresolved. */
  readonly activeProjectKey: string;
  readonly activeProjectDisplayName: string | null;
  /** Opens a new thread in the picked group. A no-op for the current group. */
  readonly selectProject: (projectKey: string) => void;
}

/**
 * Case-insensitive substring match on the name the picker shows, so filtering
 * never hides a row whose displayed text contains what was typed.
 */
export function filterProjectPickerEntries(
  entries: readonly SidebarProjectPickerEntry[],
  query: string,
): readonly SidebarProjectPickerEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return entries;
  }
  return entries.filter((entry) => entry.group.displayName.toLowerCase().includes(normalizedQuery));
}

/**
 * The switchable project list, grouped and ordered the way the sidebar groups
 * and orders it, plus the one action a picker needs: move to another project.
 *
 * Shared by every surface that offers the switch (the draft headline and the
 * composer context strip) so the two never disagree about which projects exist,
 * what they are called, or what picking one does.
 *
 * `replaceRoute` decides whether the new thread replaces the current history
 * entry: a draft is a placeholder and should be swapped, but a started thread is
 * somewhere the user can sensibly go back to.
 */
export function useProjectPicker({
  activeProjectRef,
  activeProjectTitle,
  replaceRoute,
}: {
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
  readonly replaceRoute: boolean;
}): ProjectPicker {
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projectSortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const handleNewThread = useNewThreadHandler();

  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  const projectGroups = useMemo(
    () =>
      sortLogicalProjectsForSidebar(
        buildSidebarProjectSnapshots({
          projects,
          settings: projectGroupingSettings,
          primaryEnvironmentId,
          resolveEnvironmentLabel: (environmentId) =>
            environmentLabelById.get(environmentId) ?? null,
        }),
        threads,
        projectSortOrder,
      ),
    [
      environmentLabelById,
      primaryEnvironmentId,
      projectGroupingSettings,
      projectSortOrder,
      projects,
      threads,
    ],
  );
  const entries = useMemo(
    () =>
      buildSidebarProjectPickerEntries({
        groups: projectGroups,
        preferredProjectRef: activeProjectRef,
      }),
    [activeProjectRef, projectGroups],
  );
  const entryByKey = useMemo(
    () => new Map(entries.map((entry) => [entry.group.projectKey, entry] as const)),
    [entries],
  );
  const activeProjectGroup =
    activeProjectRef === null
      ? null
      : (projectGroups.find((group) =>
          group.memberProjectRefs.some(
            (projectRef) => scopedProjectKey(projectRef) === scopedProjectKey(activeProjectRef),
          ),
        ) ?? null);
  const activeProjectKey = activeProjectGroup?.projectKey ?? "";
  const activeProjectDisplayName = activeProjectGroup?.displayName ?? activeProjectTitle;

  const selectProject = useCallback(
    (projectKey: string) => {
      const entry = entryByKey.get(projectKey);
      if (!entry || projectKey === activeProjectKey) {
        return;
      }
      const project = entry.targetProject;
      void handleNewThread(scopeProjectRef(project.environmentId, project.id), {
        replace: replaceRoute,
      });
    },
    [activeProjectKey, entryByKey, handleNewThread, replaceRoute],
  );

  return useMemo(
    () => ({ entries, activeProjectKey, activeProjectDisplayName, selectProject }),
    [activeProjectDisplayName, activeProjectKey, entries, selectProject],
  );
}
