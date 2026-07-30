import {
  type EnvironmentId,
  type EditorId,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@vide/contracts";
import { memo } from "react";
import { ChatEnvironmentMenu } from "./ChatEnvironmentMenu";
import { type DraftId } from "~/composerDraftStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { OpenInPicker } from "./OpenInPicker";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { ProjectFavicon } from "../ProjectFavicon";
import { cn } from "~/lib/utils";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  activeProjectCwd: string | null;
  openInCwd: string | null;
  /**
   * False while the thread is still empty. An empty thread has nothing to open
   * and nothing to act on, so the header stays bare and the window chrome is
   * just the panel toggles.
   */
  threadHasMessages: boolean;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  rightPanelOpen: boolean;
  gitCwd: string | null;
  onNewThreadInProject: () => void;
}

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly activeThreadEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): boolean {
  return (
    Boolean(input.activeProjectName) &&
    input.primaryEnvironmentId !== null &&
    input.activeThreadEnvironmentId === input.primaryEnvironmentId
  );
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  activeProjectName,
  activeProjectCwd,
  openInCwd,
  threadHasMessages,
  keybindings,
  availableEditors,
  rightPanelOpen,
  gitCwd,
  onNewThreadInProject,
}: ChatHeaderProps) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const showOpenInPicker =
    threadHasMessages &&
    shouldShowOpenInPicker({
      activeProjectName,
      activeThreadEnvironmentId,
      primaryEnvironmentId,
    });
  const showEnvironmentMenu = threadHasMessages && Boolean(activeProjectName);
  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
      {threadHasMessages ? (
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
          {/* The project always leads the header: knowing which project a
              thread lives in is priority zero, and the thread title alone
              doesn't answer it. */}
          {activeProjectName ? (
            <span className="inline-flex shrink-0 items-center gap-2">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`New thread in ${activeProjectName}`}
                      onClick={onNewThreadInProject}
                      className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  }
                >
                  <ProjectFavicon
                    environmentId={activeThreadEnvironmentId}
                    cwd={activeProjectCwd ?? ""}
                    className="size-3.5"
                  />
                  <span className="max-w-40 truncate text-sm font-medium">{activeProjectName}</span>
                </TooltipTrigger>
                <TooltipPopup side="top">New thread in {activeProjectName}</TooltipPopup>
              </Tooltip>
              <span aria-hidden className="text-muted-foreground/40">
                /
              </span>
            </span>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <h2
                  aria-label={activeThreadTitle}
                  className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
                >
                  {activeThreadTitle}
                </h2>
              }
            />
            <TooltipPopup side="top">{activeThreadTitle}</TooltipPopup>
          </Tooltip>
        </div>
      ) : null}
      <div
        data-chat-header-actions
        className={cn(
          "flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3",
          rightPanelOpen ? "pr-0" : "pr-16",
        )}
      >
        {showOpenInPicker && (
          <OpenInPicker
            environmentId={activeThreadEnvironmentId}
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        )}
        {showEnvironmentMenu && (
          <ChatEnvironmentMenu
            environmentId={activeThreadEnvironmentId}
            threadId={activeThreadId}
            gitCwd={gitCwd}
            {...(draftId ? { draftId } : {})}
          />
        )}
      </div>
    </div>
  );
});
