"use client";

import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@vide/client-runtime/state/runtime";
import {
  PRIMARY_LOCAL_ENVIRONMENT_ID,
  type DesktopWslState,
  type SourceControlDiscoveryResult,
  type SourceControlProviderKind,
} from "@vide/contracts";
import { FolderGit2Icon, FolderIcon, LinkIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

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
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { sourceControlEnvironment } from "../state/sourceControl";
import {
  applyWslEnvironmentConfiguration,
  parseWslUncPath,
  resolveProjectPickerTarget,
  resolveWslProjectSelection,
} from "../wslPaths";
import { AzureDevOpsIcon, BitbucketIcon, GitHubIcon, GitLabIcon, type Icon } from "./Icons";
import { Input } from "./ui/input";
import { Menu, MenuItem, MenuPopup, MenuSub, MenuSubPopup, MenuSubTrigger } from "./ui/menu";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { keepPrintableKeysInField } from "~/lib/menuTypeahead";

const MENU_POPUP_WIDTH_CLASS = "w-(--chat-picker-width)";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "An error occurred.";
}

/**
 * Providers that can resolve a repository path ("owner/repo") into a clone URL
 * on the server -- see `SourceControlCloneRepositoryInput`, which takes either a
 * raw `remoteUrl` or a `provider` + `repository` pair. Everything else (a plain
 * Git URL, a local folder) is handled by the other two rows of this menu.
 */
type AddProjectProviderKind = Extract<
  SourceControlProviderKind,
  "github" | "gitlab" | "bitbucket" | "azure-devops"
>;

interface AddProjectProviderOption {
  readonly kind: AddProjectProviderKind;
  readonly label: string;
  /** How this provider spells a repository path, used as the input placeholder. */
  readonly pathHint: string;
  readonly Icon: Icon;
}

/**
 * Listed in a fixed order rather than sorted by readiness: a dropdown people
 * reach for repeatedly should keep its rows where they were last time.
 */
const ADD_PROJECT_PROVIDER_OPTIONS: ReadonlyArray<AddProjectProviderOption> = [
  { kind: "github", label: "GitHub", pathHint: "owner/repo", Icon: GitHubIcon },
  { kind: "gitlab", label: "GitLab", pathHint: "group/project", Icon: GitLabIcon },
  { kind: "bitbucket", label: "Bitbucket", pathHint: "workspace/repository", Icon: BitbucketIcon },
  {
    kind: "azure-devops",
    label: "Azure DevOps",
    pathHint: "project/repository",
    Icon: AzureDevOpsIcon,
  },
];

/**
 * A provider is usable from here only when its CLI is installed *and* signed
 * in, because the clone resolves the repository through that CLI. Same shape as
 * the publish flow's readiness check in GitActionsControl.
 */
function isProviderConnected(
  discovery: SourceControlDiscoveryResult | null,
  kind: AddProjectProviderKind,
): boolean {
  const provider = discovery?.sourceControlProviders.find((candidate) => candidate.kind === kind);
  return (
    provider !== undefined &&
    provider.status === "available" &&
    provider.auth.status !== "unauthenticated"
  );
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
  const [providerKind, setProviderKind] = useState<AddProjectProviderKind | null>(null);
  const [isProviderMenuOpen, setIsProviderMenuOpen] = useState(false);
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setShowUrlInput(false);
      setGitUrl("");
      setProviderKind(null);
      setIsProviderMenuOpen(false);
    }
  }, [open]);

  // Also refocuses when the same input switches between a Git URL and a
  // provider repository path, which reads as the field being handed over.
  // Deferred a frame because picking a provider closes the submenu, and Base UI
  // returns focus to that submenu's trigger on the way out.
  useEffect(() => {
    if (!showUrlInput) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      urlInputRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [showUrlInput, providerKind]);

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
  // Only while the menu is open: discovery shells out to each provider CLI, and
  // this component stays mounted for the lifetime of its trigger.
  const sourceControlDiscovery = useEnvironmentQuery(
    !open || primaryEnvironmentId === null
      ? null
      : sourceControlEnvironment.discovery({
          environmentId: primaryEnvironmentId,
          input: {},
        }),
  );
  // Until the first scan lands every provider reads as unconnected, which would
  // flash four "Not connected" rows. Dim them, but stay quiet about why.
  const isDiscoveryPending =
    sourceControlDiscovery.data === null && sourceControlDiscovery.isPending;

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
    setProviderKind(null);
    setShowUrlInput(true);
  }, []);

  const revealProviderInput = useCallback((kind: AddProjectProviderKind) => {
    setIsProviderMenuOpen(false);
    setProviderKind(kind);
    setGitUrl("");
    setShowUrlInput(true);
  }, []);

  const confirmClone = useCallback(async () => {
    const repositoryInput = gitUrl.trim();
    if (repositoryInput.length === 0 || isCloning || primaryEnvironmentId === null) {
      return;
    }

    const baseDirectory = ensureBrowseDirectoryPath(
      primaryEnvironment?.serverConfig?.settings?.addProjectBaseDirectory?.trim() || "~/",
    );
    // Handles a bare "owner/repo" as happily as it handles a clone URL: both
    // end in the segment the checkout should be named after.
    const destinationPath = resolveProjectPathForDispatch(
      appendBrowsePathSegment(
        baseDirectory,
        inferRepositoryFolderNameFromRemoteUrl(repositoryInput),
      ),
      null,
    );

    setIsCloning(true);
    const cloneResult = await cloneRepository({
      environmentId: primaryEnvironmentId,
      input:
        providerKind === null
          ? { remoteUrl: repositoryInput, destinationPath }
          : { provider: providerKind, repository: repositoryInput, destinationPath },
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
    providerKind,
  ]);

  return {
    confirmClone,
    gitUrl,
    isCloning,
    isDiscoveryPending,
    isPickerAvailable,
    isPickingFolder,
    isProviderMenuOpen,
    openLocalFolderPicker,
    providerKind,
    revealProviderInput,
    revealUrlInput,
    setGitUrl,
    setIsProviderMenuOpen,
    showUrlInput,
    sourceControlDiscovery,
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
    confirmClone,
    gitUrl,
    isCloning,
    isDiscoveryPending,
    isPickerAvailable,
    isPickingFolder,
    isProviderMenuOpen,
    openLocalFolderPicker,
    providerKind,
    revealProviderInput,
    revealUrlInput,
    setGitUrl,
    setIsProviderMenuOpen,
    showUrlInput,
    sourceControlDiscovery,
    urlInputRef,
  } = useAddProjectMenuState(open, onRequestClose);

  const activeProvider =
    ADD_PROJECT_PROVIDER_OPTIONS.find((option) => option.kind === providerKind) ?? null;

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
      <MenuSub open={isProviderMenuOpen} onOpenChange={setIsProviderMenuOpen}>
        <MenuSubTrigger>
          <FolderGit2Icon />
          Add existing repository
        </MenuSubTrigger>
        <MenuSubPopup>
          {ADD_PROJECT_PROVIDER_OPTIONS.map((option) => {
            const connected = isProviderConnected(sourceControlDiscovery.data, option.kind);
            return (
              <MenuItem
                key={option.kind}
                closeOnClick={false}
                disabled={!connected}
                onClick={(event) => {
                  event.preventDefault();
                  revealProviderInput(option.kind);
                }}
              >
                <option.Icon />
                {option.label}
                {connected || isDiscoveryPending ? null : (
                  <span className="ms-auto text-(length:--text-caption) text-muted-foreground">
                    Not connected
                  </span>
                )}
              </MenuItem>
            );
          })}
        </MenuSubPopup>
      </MenuSub>
      {/* Shared by both clone sources: a Git URL, or a repository path resolved
          through the provider picked above. */}
      <div
        className="grid transition-[grid-template-rows] duration-(--duration-popup)"
        style={{ gridTemplateRows: showUrlInput ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="flex items-center gap-1.5 px-2 pt-1 pb-1.5">
            {activeProvider ? (
              <activeProvider.Icon aria-hidden className="size-4 shrink-0" />
            ) : null}
            <Input
              ref={urlInputRef}
              size="sm"
              placeholder={activeProvider ? activeProvider.pathHint : "Enter Git clone URL"}
              value={gitUrl}
              onChange={(event) => setGitUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void confirmClone();
                  return;
                }
                keepPrintableKeysInField(event);
              }}
            />
            <button
              type="button"
              disabled={gitUrl.trim().length === 0 || isCloning}
              className="inline-flex h-(--popup-item-height) shrink-0 cursor-pointer items-center rounded-md bg-accent px-(--popup-item-padding-inline) text-(length:--text-caption) text-foreground transition-colors hover:bg-accent/80 disabled:pointer-events-none disabled:opacity-64"
              onClick={() => {
                void confirmClone();
              }}
            >
              {isCloning ? "Cloning…" : "Clone"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * The "add a project" dropdown: three options -- open a local folder via the
 * native macOS Finder picker, clone a Git URL inline, or pick an existing
 * repository from a connected provider (GitHub/GitLab/Bitbucket/Azure
 * DevOps). All three funnel into the same `projectEnvironment.create` /
 * `sourceControlEnvironment.cloneRepository` calls as the rest of the app
 * (see {@link useAddProjectToEnvironment}). The provider choice is a submenu
 * here rather than a separate screen, so adding a project never leaves the
 * dropdown.
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
