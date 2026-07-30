import { Maximize2Icon, Minimize2Icon, PanelBottomIcon, PanelRightIcon } from "lucide-react";
import { memo, type ReactNode } from "react";

import { cn } from "~/lib/utils";

import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface PanelLayoutControlsProps {
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalShortcutLabel: string | null;
  rightPanelAvailable: boolean;
  rightPanelOpen: boolean;
  rightPanelShortcutLabel: string | null;
  onToggleTerminal: () => void;
  onToggleRightPanel: () => void;
}

function withShortcut(label: string, shortcut: string | null): string {
  return shortcut ? `${label} (${shortcut})` : label;
}

/** Both expand icons occupy the same cell so the swap can cross-fade. */
const MAXIMIZE_ICON_CLASS =
  "absolute size-3.5 transition-opacity duration-(--duration-fast) ease-(--ease-out)";

/**
 * The one button the right-hand chrome is built from.
 *
 * The workspace carries exactly three global panel controls — expand the right
 * panel, show the bottom panel, show the right panel — and routing all three
 * through a single component is what stops their hover, pressed, and disabled
 * states from drifting apart.
 */
function PanelToggle(props: {
  pressed: boolean;
  disabled: boolean;
  label: string;
  tooltip: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="shrink-0 [-webkit-app-region:no-drag]"
            pressed={props.pressed}
            onPressedChange={props.onToggle}
            aria-label={props.label}
            variant="ghost"
            size="sm"
            disabled={props.disabled}
          >
            {props.children}
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">{props.tooltip}</TooltipPopup>
    </Tooltip>
  );
}

export const PanelLayoutControls = memo(function PanelLayoutControls({
  terminalAvailable,
  terminalOpen,
  terminalShortcutLabel,
  rightPanelAvailable,
  rightPanelOpen,
  rightPanelShortcutLabel,
  onToggleTerminal,
  onToggleRightPanel,
}: PanelLayoutControlsProps) {
  return (
    <div
      className="flex h-full shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
      data-panel-layout-controls
    >
      <PanelToggle
        pressed={terminalOpen}
        disabled={!terminalAvailable}
        label="Toggle bottom panel"
        tooltip={
          terminalAvailable
            ? withShortcut(
                terminalOpen ? "Hide bottom panel" : "Show bottom panel",
                terminalShortcutLabel,
              )
            : "Bottom panel is unavailable"
        }
        onToggle={onToggleTerminal}
      >
        <PanelBottomIcon className="size-3.5" />
      </PanelToggle>
      <PanelToggle
        pressed={rightPanelOpen}
        disabled={!rightPanelAvailable}
        label="Toggle right panel"
        tooltip={
          rightPanelAvailable
            ? withShortcut(
                rightPanelOpen ? "Hide right panel" : "Show right panel",
                rightPanelShortcutLabel,
              )
            : "Right panel is unavailable"
        }
        onToggle={onToggleRightPanel}
      >
        <PanelRightIcon className="size-3.5" />
      </PanelToggle>
    </div>
  );
});

/**
 * Expand / restore, the usual fullscreen idiom. The two icons are stacked and
 * cross-faded rather than swapped so the control never cuts between states.
 */
export const RightPanelMaximizeControl = memo(function RightPanelMaximizeControl({
  maximized,
  onToggle,
}: {
  maximized: boolean;
  onToggle: () => void;
}) {
  const label = maximized ? "Restore panel" : "Expand panel";
  return (
    <PanelToggle
      pressed={maximized}
      disabled={false}
      label={label}
      tooltip={label}
      onToggle={onToggle}
    >
      <span className="relative inline-flex size-3.5 items-center justify-center">
        <Maximize2Icon
          className={cn(MAXIMIZE_ICON_CLASS, maximized ? "opacity-0" : "opacity-100")}
        />
        <Minimize2Icon
          className={cn(MAXIMIZE_ICON_CLASS, maximized ? "opacity-100" : "opacity-0")}
        />
      </span>
    </PanelToggle>
  );
});
