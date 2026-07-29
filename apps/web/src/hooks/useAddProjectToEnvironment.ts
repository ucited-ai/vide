import { scopeProjectRef, scopeThreadRef } from "@vide/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@vide/client-runtime/state/runtime";
import type { EnvironmentId } from "@vide/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useAtomValue } from "@effect/atom-react";

import { projectEnvironment } from "../state/projects";
import { useAtomCommand } from "../state/use-atom-command";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useProjects, useThreadShells } from "../state/entities";
import {
  findProjectByPath,
  inferProjectTitleFromPath,
  isExplicitRelativeProjectPath,
  isUnsupportedWindowsProjectPath,
  resolveProjectPathForDispatch,
} from "../lib/projectPaths";
import { getLatestThreadForProject } from "../lib/threadSort";
import { newProjectId } from "../lib/utils";
import { buildThreadRouteParams } from "../threadRoutes";
import { useClientSettings } from "./useSettings";
import { useNewThreadHandler } from "./useHandleNewThread";
import { primaryServerProvidersAtom } from "../state/server";
import { resolveDefaultProviderModelSelection } from "../providerInstances";
import { stackedThreadToast, toastManager } from "../components/ui/toast";

export interface AddProjectToEnvironmentInput {
  readonly environmentId: EnvironmentId;
  readonly rawCwd: string;
  readonly platform: string;
  readonly currentProjectCwd: string | null;
}

/**
 * Adds a project at a resolved filesystem path to an environment, reusing the
 * same `projectEnvironment.create` command regardless of how the path was
 * obtained (native folder picker, a typed/browsed path, or a freshly cloned
 * repository). Deduplicates against an existing project at the same path by
 * navigating into it instead of creating a duplicate.
 *
 * Returns whether a project was opened or created (the caller should close
 * its own UI on `true`; on `false` an error toast has already been shown, or
 * the input was invalid, and the caller's UI should stay open).
 */
export function useAddProjectToEnvironment(): (
  input: AddProjectToEnvironmentInput,
) => Promise<boolean> {
  const navigate = useNavigate();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const projects = useProjects();
  const threads = useThreadShells();
  const handleNewThread = useNewThreadHandler();
  const sidebarThreadSortOrder = useClientSettings((settings) => settings.sidebarThreadSortOrder);

  return useCallback(
    async (input: AddProjectToEnvironmentInput): Promise<boolean> => {
      const rawCwd = input.rawCwd;

      if (isUnsupportedWindowsProjectPath(rawCwd.trim(), input.platform)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to add project",
            description: "Windows-style paths are only supported on Windows.",
          }),
        );
        return false;
      }

      if (isExplicitRelativeProjectPath(rawCwd.trim()) && !input.currentProjectCwd) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to add project",
            description: "Relative paths require an active project.",
          }),
        );
        return false;
      }

      const cwd = resolveProjectPathForDispatch(rawCwd, input.currentProjectCwd);
      if (cwd.length === 0) return false;

      const existing = findProjectByPath(
        projects.filter((project) => project.environmentId === input.environmentId),
        cwd,
      );
      if (existing) {
        const latestThread = getLatestThreadForProject(
          threads.filter((thread) => thread.environmentId === existing.environmentId),
          existing.id,
          sidebarThreadSortOrder,
        );
        if (latestThread) {
          await navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(
              scopeThreadRef(latestThread.environmentId, latestThread.id),
            ),
          });
        } else {
          const navigationResult = await settlePromise(() =>
            handleNewThread(scopeProjectRef(existing.environmentId, existing.id)),
          );
          if (navigationResult._tag === "Failure") {
            const error = squashAtomCommandFailure(navigationResult);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to open project",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
            return false;
          }
        }
        return true;
      }

      const projectId = newProjectId();
      const targetEnvironmentProviders =
        environments.find((environment) => environment.environmentId === input.environmentId)
          ?.serverConfig?.providers ??
        (input.environmentId === primaryEnvironmentId ? providers : []);
      const createResult = await createProject({
        environmentId: input.environmentId,
        input: {
          projectId,
          title: inferProjectTitleFromPath(cwd),
          workspaceRoot: cwd,
          createWorkspaceRootIfMissing: true,
          defaultModelSelection: resolveDefaultProviderModelSelection(
            targetEnvironmentProviders,
            null,
          ),
        },
      });
      if (createResult._tag === "Failure") {
        if (!isAtomCommandInterrupted(createResult)) {
          const error = squashAtomCommandFailure(createResult);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to add project",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return false;
      }

      const navigationResult = await settlePromise(() =>
        handleNewThread(scopeProjectRef(input.environmentId, projectId)),
      );
      if (navigationResult._tag === "Failure") {
        const error = squashAtomCommandFailure(navigationResult);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to add project",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
        return false;
      }
      return true;
    },
    [
      createProject,
      environments,
      handleNewThread,
      navigate,
      primaryEnvironmentId,
      projects,
      providers,
      sidebarThreadSortOrder,
      threads,
    ],
  );
}
