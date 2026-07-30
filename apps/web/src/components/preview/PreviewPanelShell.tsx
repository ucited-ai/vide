import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useState } from "react";

import { isElectron } from "~/env";
import { useResizableWidth } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";

import { RightPanelResizeHandle } from "./RightPanelResizeHandle";

export type PreviewPanelMode = "inline" | "sheet" | "sidebar" | "embedded";

const PREVIEW_PANEL_WIDTH_STORAGE_KEY = "vide:preview-panel-width";
const PREVIEW_PANEL_MIN_WIDTH = 360;
/** Fraction of the viewport allowed, preserving the remaining space for chat. */
const PREVIEW_PANEL_MAX_WIDTH_FRACTION = 0.7;
const PREVIEW_PANEL_DEFAULT_WIDTH = 540;

export function getPreviewPanelMaxWidth(viewportWidth: number): number {
  return Math.floor(viewportWidth * PREVIEW_PANEL_MAX_WIDTH_FRACTION);
}

/**
 * Shell for the preview panel. In inline mode the panel is user-resizable
 * via a drag handle on the left edge; width persists per browser. In
 * sheet/sidebar modes the parent owns the size.
 */
export function PreviewPanelShell(props: {
  mode: PreviewPanelMode;
  maximized?: boolean;
  /**
   * Whether the panel is showing. In inline mode it stays MOUNTED when false and
   * collapses to zero width instead, which is the only way it can animate shut:
   * an unmounted element has nothing left to transition. The left sidebar has
   * always worked this way, which is why that one felt right and this one did
   * not. Sheet mode ignores this — the sheet primitive owns its own presence.
   */
  open?: boolean;
  children: ReactNode;
}) {
  const isOpen = props.open ?? true;
  const useDragRegion = isElectron && props.mode !== "sheet" && props.mode !== "embedded";
  const isInline = props.mode === "inline";
  const maxWidth = useViewportClampedMaxWidth();
  const { width, handlers } = useResizableWidth({
    storageKey: PREVIEW_PANEL_WIDTH_STORAGE_KEY,
    defaultWidth: PREVIEW_PANEL_DEFAULT_WIDTH,
    minWidth: PREVIEW_PANEL_MIN_WIDTH,
    maxWidth,
    edge: "left",
  });
  /*
   * Width settles on the shared panel curve, except while the handle is held:
   * a drag has to track the cursor exactly, and easing every rAF tick would
   * make the edge trail the pointer.
   */
  const [resizing, setResizing] = useState(false);
  const resizeHandlers = {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      setResizing(true);
      handlers.onPointerDown(event);
    },
    onPointerMove: handlers.onPointerMove,
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      handlers.onPointerUp(event);
      setResizing(false);
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => {
      handlers.onPointerCancel(event);
      setResizing(false);
    },
  };

  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 min-w-0 flex-col self-stretch overflow-hidden bg-background",
        isInline
          ? props.maximized && isOpen
            ? "flex-1 border-l border-border"
            : "shrink-0"
          : "w-full",
        // The edge only exists while there is a panel to edge. Kept at zero
        // width it would read as a stray hairline down the side of the chat.
        isInline && isOpen && !props.maximized && "border-l border-border",
        isInline && !resizing && "transition-[width] duration-(--duration-base) ease-(--ease-soft)",
      )}
      style={
        isInline && !(props.maximized && isOpen) ? { width: isOpen ? `${width}px` : 0 } : undefined
      }
      // Collapsed but mounted, it must not be reachable: without this, Tab walks
      // into a panel nobody can see.
      {...(isInline && !isOpen ? { inert: true } : {})}
      data-preview-panel-mode={props.mode}
      data-preview-panel-open={isOpen ? "true" : "false"}
      data-preview-panel-maximized={props.maximized ? "true" : "false"}
    >
      {isInline && isOpen && !props.maximized ? (
        <RightPanelResizeHandle handlers={resizeHandlers} />
      ) : null}
      {useDragRegion ? <div className="electron-drag-region h-0 w-full" aria-hidden /> : null}
      {props.children}
    </div>
  );
}

/**
 * Track viewport width to derive a sensible upper bound for the panel.
 * Resize-aware so dragging the OS window narrower re-clamps the stored
 * width on the next render (the hook's clamp picks this up automatically).
 */
function useViewportClampedMaxWidth(): number {
  const [vw, setVw] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame = 0;
    const onResize = () => {
      // Coalesce rapid resize events into one rAF tick.
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setVw(window.innerWidth);
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);
  return getPreviewPanelMaxWidth(vw);
}
