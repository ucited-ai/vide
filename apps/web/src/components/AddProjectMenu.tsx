"use client";

import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@vide/client-runtime/state/runtime";
import { PRIMARY_LOCAL_ENVIRONMENT_ID, type DesktopWslState } from "@vide/contracts";
import { FolderGit2Icon, FolderIcon, LinkIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { openCommandPalette } from "../commandPaletteBus";
import { desktopLocalBackendId } from "../connection/desktopLocal";
import { useDesktopLocalBootstraps } from "../connection/useDesktopLocalBootstraps";
import { useAddProjectToEnvironment } from "../hooks/useAddProjectToEnvironment";
import { inferRepositoryFolderNameFromRemoteUrl } from "../lib/gitUrl";
import { getEnvironmentBrowsePlatform } from "../lib/environmentPlatform";
import {
  appendBrowsePathSegment,
  ensureBrowseDirectoryPath,
  resolveProjectPathForDispatch,
} from "../lib/projectPaths";
import { readLocalApi } from "../localApi";
import { useAtomCommand } from "../state/use-atom-command";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { sourceControlEnvironment } from "../state/sourceControl";
import {
  applyWslEnvironmentConfiguration,
  parseWslUncPath,
  resolveProjectPickerTarget,
  resolveWslProjectSelection,
} from "../wslPaths";
import { Input } from "./ui/input";
import { Menu, MenuItem, MenuPopup, MenuSub, MenuSubPopup } from "./ui/menu";
import { stackedThreadToast, toastManager } from "./ui/toast";

const MENU_POPUP_WIDTH_CLASS = "w-72";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "An error occurred.";
}

/**
 * Shared state and handlers behind the three "add project" entry points
 * (native folder picker, Git URL clone, and the provider repository picker).
 * Used by both {@link AddProjectMenu} (the top-level trigger) and
 * {@link AddProjectSubmenu} (nested inside another already-open menu), so the
 * two surfaces stay behaviorally identical.
 */
function useAddProjectMenuState(open: boolean, onRequestClose: () => void) {
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [gitUrl, setGitUrl] = useState("");
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setShowUrlInput(false);
      setGitUrl("");
    }
  }, [open]);

  useEffect(() => {
    if (showUrlInput) {
      urlInputRef.current?.focus();
    }
  }, [showUrlInput]);

  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const primaryEnvironment =
    environments.find((environment) => environment.environmentId === primaryEnvironmentId) ?? null;
  const primaryEnvironmentPlatform = getEnvironmentBrowsePlatform(
    primaryEnvironment?.serverConfig?.environment.platform.os,
  );
  const desktopLocalBootstraps = useDesktopLocalBootstraps();
  const addProjectToEnvironment = useAddProjectToEnvironment();
  const cloneRepository = useAtomCommand(sourceControlEnvironment.cloneRepository, {
    reportFailure: false,
  });

  const isPickerAvailable =
    primaryEnvironmentId !== null &&
    typeof window !== "undefined" &&
    window.desktopBridge !== undefined;

  const openLocalFolderPicker = useCallback(async () => {
    if (!isPickerAvailable || primaryEnvironmentId === null || isPickingFolder) {
      return;
    }
    const api = readLocalApi();
    if (!api) {
      return;
    }

    setIsPickingFolder(true);
    let pickedPath: string | null = null;
    let desktopWslState: DesktopWslState | null = null;
    try {
      desktopWslState =
        primaryEnvironmentPlatform === "Linux"
          ? ((await window.desktopBridge?.getWslState().catch(() => null)) ?? null)
          : null;
      const pickerTargetEnvironmentId = resolveProjectPickerTarget({
        browseEnvironmentId: primaryEnvironmentId,
        primaryEnvironmentId,
        desktopInstanceId: null,
        wslConfiguration: desktopWslState,
      });
      pickedPath = await api.dialogs.pickFolder(
        pickerTargetEnvironmentId ? { targetEnvironmentId: pickerTargetEnvironmentId } : undefined,
      );
    } catch {
      // Ignore picker failures and leave the menu open.
      setIsPickingFolder(false);
      return;
    }
    setIsPickingFolder(false);
    if (!pickedPath) {
      return;
    }

    if (parseWslUncPath(pickedPath)) {
      desktopWslState ??= (await window.desktopBridge?.getWslState().catch(() => null)) ?? null;
      let primaryRunningDistro: string | null = null;
      try {
        primaryRunningDistro =
          window.desktopBridge
            ?.getLocalEnvironmentBootstraps()
            .find((bootstrap) => bootstrap.id === PRIMARY_LOCAL_ENVIRONMENT_ID)?.runningDistro ??
          null;
      } catch {
        // Keep UNC routing strict when the live primary identity cannot be read.
      }
      const selection = resolveWslProjectSelection(
        pickedPath,
        applyWslEnvironmentConfiguration(
          environments.flatMap((environment) => {
            const backendId = desktopLocalBackendId(environment.entry.target);
            if (!backendId) {
              return [];
            }
            const bootstrap = desktopLocalBootstraps.find(
              (candidate) => candidate.httpBaseUrl === environment.displayUrl,
            );
            return [
              {
                environmentId: environment.environmentId,
                backendId,
                runningDistro: bootstrap?.runningDistro ?? null,
              },
            ];
          }),
          primaryEnvironmentId,
          desktopWslState ?? null,
          primaryRunningDistro,
        ),
      );
      if (!selection) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not add WSL project",
            description: "Start the matching WSL backend, then choose the folder again.",
          }),
        );
        return;
      }
      const opened = await addProjectToEnvironment({
        environmentId: selection.environmentId,
        rawCwd: selection.linuxPath,
        platform: "Linux",
        currentProjectCwd: null,
      });
      if (opened) {
        onRequestClose();
      }
      return;
    }

    const opened = await addProjectToEnvironment({
      environmentId: primaryEnvironmentId,
      rawCwd: pickedPath,
      platform: primaryEnvironmentPlatform,
      currentProjectCwd: null,
    });
    if (opened) {
      onRequestClose();
    }
  }, [
    addProjectToEnvironment,
    desktopLocalBootstraps,
    environments,
    isPickerAvailable,
    isPickingFolder,
    onRequestClose,
    primaryEnvironmentId,
    primaryEnvironmentPlatform,
  ]);

  const revealUrlInput = useCallback(() => {
    setShowUrlInput(true);
  }, []);

  const confirmGitUrlClone = useCallback(async () => {
    const remoteUrl = gitUrl.trim();
    if (remoteUrl.length === 0 || isCloning || primaryEnvironmentId === null) {
      return;
    }

    const baseDirectory = ensureBrowseDirectoryPath(
      primaryEnvironment?.serverConfig?.settings?.addProjectBaseDirectory?.trim() || "~/",
    );
    const destinationPath = resolveProjectPathForDispatch(
      appendBrowsePathSegment(baseDirectory, inferRepositoryFolderNameFromRemoteUrl(remoteUrl)),
      null,
    );

    setIsCloning(true);
    const cloneResult = await cloneRepository({
      environmentId: primaryEnvironmentId,
      input: { remoteUrl, destinationPath },
    });
    setIsCloning(false);
    if (cloneResult._tag === "Failure") {
      if (!isAtomCommandInterrupted(cloneResult)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Clone failed",
            description: errorMessage(squashAtomCommandFailure(cloneResult)),
          }),
        );
      }
      return;
    }

    const opened = await addProjectToEnvironment({
      environmentId: primaryEnvironmentId,
      rawCwd: cloneResult.value.cwd,
      platform: primaryEnvironmentPlatform,
      currentProjectCwd: null,
    });
    if (opened) {
      onRequestClose();
    }
  }, [
    addProjectToEnvironment,
    cloneRepository,
    gitUrl,
    isCloning,
    onRequestClose,
    primaryEnvironment,
    primaryEnvironmentId,
    primaryEnvironmentPlatform,
  ]);

  const openExistingRepositoryPicker = useCallback(() => {
    onRequestClose();
    openCommandPalette({ open: "add-project" });
  }, [onRequestClose]);

  return {
    confirmGitUrlClone,
    gitUrl,
    isCloning,
    isPickerAvailable,
    isPickingFolder,
    openExistingRepositoryPicker,
    openLocalFolderPicker,
    revealUrlInput,
    setGitUrl,
    showUrlInput,
    urlInputRef,
  };
}

function AddProjectMenuItems({
  open,
  onRequestClose,
}: {
  readonly open: boolean;
  readonly onRequestClose: () => void;
}) {
  const {
    confirmGitUrlClone,
    gitUrl,
    isCloning,
    isPickerAvailable,
    isPickingFolder,
    openExistingRepositoryPicker,
    openLocalFolderPicker,
    revealUrlInput,
    setGitUrl,
    showUrlInput,
    urlInputRef,
  } = useAddProjectMenuState(open, onRequestClose);

  return (
    <>
      <MenuItem
        disabled={!isPickerAvailable || isPickingFolder}
        onClick={() => {
          void openLocalFolderPicker();
        }}
      >
        <FolderIcon />
        Open local folder
      </MenuItem>
      <MenuItem
        closeOnClick={false}
        onClick={(event) => {
          event.preventDefault();
          revealUrlInput();
        }}
      >
        <LinkIcon />
        Clone from Git URL
      </MenuItem>
      <div
        className="grid transition-[grid-template-rows] duration-150 ease-out"
        style={{ gridTemplateRows: showUrlInput ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="flex items-center gap-1.5 px-2 pt-1 pb-1.5">
            <Input
              ref={urlInputRef}
              size="sm"
              placeholder="Enter Git clone URL"
              value={gitUrl}
              onChange={(event) => setGitUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void confirmGitUrlClone();
                }
              }}
            />
            <button
              type="button"
              disabled={gitUrl.trim().length === 0 || isCloning}
              className="inline-flex h-7 shrink-0 cursor-pointer items-center rounded-md bg-accent px-2.5 text-foreground text-xs transition-colors hover:bg-accent/80 disabled:pointer-events-none disabled:opacity-64"
              onClick={() => {
                void confirmGitUrlClone();
              }}
            >
              {isCloning ? "Cloning…" : "Clone"}
            </button>
          </div>
        </div>
      </div>
      <MenuItem onClick={openExistingRepositoryPicker}>
        <FolderGit2Icon />
        Add existing repository
      </MenuItem>
    </>
  );
}

/**
 * The "add a project" dropdown: three options -- open a local folder via the
 * native macOS Finder picker, clone a Git URL inline, or pick an existing
 * repository from a connected provider (GitHub/GitLab/Bitbucket/Azure
 * DevOps). All three funnel into the same `projectEnvironment.create` /
 * `sourceControlEnvironment.cloneRepository` calls as the rest of the app
 * (see {@link useAddProjectToEnvironment}); the provider picker reopens the
 * command palette's existing "add-project" flow, now pruned to just that
 * provider-repository step (see CommandPalette.tsx).
 *
 * `children` must render a trigger element containing a `MenuTrigger` (see
 * the call sites for the Tooltip + MenuTrigger composition pattern used
 * elsewhere in the sidebar).
 */
export const AddProjectMenu = memo(function AddProjectMenu({
  children,
  align = "start",
}: {
  readonly children: ReactNode;
  readonly align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);

  return (
    <Menu open={open} onOpenChange={setOpen}>
      {children}
      <MenuPopup align={align} className={MENU_POPUP_WIDTH_CLASS}>
        <AddProjectMenuItems open={open} onRequestClose={() => setOpen(false)} />
      </MenuPopup>
    </Menu>
  );
});

/**
 * The same three "add a project" options as {@link AddProjectMenu}, but as a
 * submenu nested inside another already-open menu (e.g. a "New project" row
 * within a project switcher).
 */
export const AddProjectSubmenu = memo(function AddProjectSubmenu({
  children,
  align = "start",
}: {
  readonly children: ReactNode;
  readonly align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);

  return (
    <MenuSub open={open} onOpenChange={setOpen}>
      {children}
      <MenuSubPopup align={align} className={MENU_POPUP_WIDTH_CLASS}>
        <AddProjectMenuItems open={open} onRequestClose={() => setOpen(false)} />
      </MenuSubPopup>
    </MenuSub>
  );
});
