import { type EnvironmentId, type EditorId, type ResolvedKeybindingsConfig } from "@vide/contracts";
import { BoxIcon } from "lucide-react";
import { memo } from "react";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { OpenInPicker } from "./OpenInPicker";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { ProjectFavicon } from "../ProjectFavicon";
import { cn } from "~/lib/utils";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
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
  /** Whether the environment column beside the chat pane is open. */
  environmentColumnOpen: boolean;
  onToggleEnvironmentColumn: () => void;
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
  activeThreadTitle,
  activeProjectName,
  activeProjectCwd,
  openInCwd,
  threadHasMessages,
  keybindings,
  availableEditors,
  rightPanelOpen,
  environmentColumnOpen,
  onToggleEnvironmentColumn,
  onNewThreadInProject,
}: ChatHeaderProps) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  /*
   * Gated on a project, not on the thread having messages.
   *
   * An earlier pass hid the whole header until the first message, on the theory
   * that a draft titled "New thread" is noise. It also hid everything useful: the
   * environment, the editor button, and the project you are in — all of which are
   * meaningful before you have typed anything, and one of which ("initialise git")
   * is only reachable here. An empty draft is exactly when you want to check which
   * worktree you are about to work in.
   */
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName,
    activeThreadEnvironmentId,
    primaryEnvironmentId,
  });
  const showEnvironmentColumn = Boolean(activeProjectName);
  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
      {activeProjectName || threadHasMessages ? (
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
        {showEnvironmentColumn && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  aria-label="Environment overview"
                  pressed={environmentColumnOpen}
                  onPressedChange={onToggleEnvironmentColumn}
                  variant="ghost"
                  size="sm"
                />
              }
            >
              <BoxIcon aria-hidden="true" className="size-4" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">Environment overview</TooltipPopup>
          </Tooltip>
        )}
      </div>
    </div>
  );
});
