import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { isElectron } from "~/env";
import type { ResizableWidthResult } from "~/hooks/resizableWidthLogic";
import { useResizableWidth } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";

import { RightPanelResizeHandle } from "./RightPanelResizeHandle";
import {
  getPreviewPanelLayout,
  getPreviewPanelMaxWidth,
  PREVIEW_PANEL_DEFAULT_WIDTH,
  PREVIEW_PANEL_MIN_WIDTH,
  PREVIEW_PANEL_RESIZE_DEAD_ZONE,
} from "./previewPanelLayout";

export type PreviewPanelMode = "inline" | "sheet" | "sidebar" | "embedded";

const PREVIEW_PANEL_WIDTH_STORAGE_KEY = "vide:preview-panel-width";
interface PreviewPanelLayoutActions {
  readonly environmentOpen: boolean;
  readonly onCollapsePanel: () => void;
  readonly onEnterFullArea: () => void;
  readonly onLeaveFullArea: () => void;
  readonly onAutoCollapseEnvironment: () => void;
}

export const PreviewPanelLayoutContext = createContext<PreviewPanelLayoutActions | null>(null);

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
  const shellRef = useRef<HTMLDivElement>(null);
  const workspaceWidth = useWorkspaceWidth(shellRef);
  const layoutActions = useContext(PreviewPanelLayoutContext);
  const maxWidth = getPreviewPanelMaxWidth(workspaceWidth);
  const onResizeEnd = useCallback(
    (result: ResizableWidthResult) => {
      if (!layoutActions) return;
      if (result.snap === "collapse") {
        layoutActions.onCollapsePanel();
        return;
      }
      if (result.snap === "full-area") {
        layoutActions.onEnterFullArea();
        return;
      }
      if (props.maximized) {
        layoutActions.onLeaveFullArea();
      }
    },
    [layoutActions, props.maximized],
  );
  const { width, resizing, handlers } = useResizableWidth({
    storageKey: PREVIEW_PANEL_WIDTH_STORAGE_KEY,
    defaultWidth: PREVIEW_PANEL_DEFAULT_WIDTH,
    minWidth: PREVIEW_PANEL_MIN_WIDTH,
    maxWidth,
    deadZone: PREVIEW_PANEL_RESIZE_DEAD_ZONE,
    ...(props.maximized ? { dragStartWidth: workspaceWidth } : {}),
    edge: "left",
    onResizeEnd,
  });
  const previewLayout = getPreviewPanelLayout({
    workspaceWidth,
    panelWidth: width,
    environmentOpen: layoutActions?.environmentOpen ?? false,
  });
  useEffect(() => {
    if (!isInline || !isOpen || props.maximized || !previewLayout.autoCollapseEnvironment) {
      return;
    }
    layoutActions?.onAutoCollapseEnvironment();
  }, [isInline, isOpen, layoutActions, previewLayout.autoCollapseEnvironment, props.maximized]);
  /*
   * Width settles on the shared panel curve, except while the handle is held:
   * a drag has to track the cursor exactly, and easing every rAF tick would
   * make the edge trail the pointer.
   */
  const fullArea = Boolean(props.maximized && isOpen);
  const usesPixelWidth = isInline && (!fullArea || resizing);

  return (
    <div
      ref={shellRef}
      className={cn(
        "relative flex h-full min-h-0 min-w-0 flex-col self-stretch overflow-hidden bg-background",
        isInline
          ? fullArea && !resizing
            ? "flex-1 border-l border-border"
            : cn("shrink-0", fullArea && resizing && "ms-auto")
          : "w-full",
        // The edge only exists while there is a panel to edge. Kept at zero
        // width it would read as a stray hairline down the side of the chat.
        isInline && isOpen && (!fullArea || resizing) && "border-l border-border",
        isInline && !resizing && "transition-[width] duration-(--duration-base) ease-(--ease-soft)",
      )}
      style={usesPixelWidth ? { width: isOpen ? `${width}px` : 0 } : undefined}
      // Collapsed but mounted, it must not be reachable: without this, Tab walks
      // into a panel nobody can see.
      {...(isInline && !isOpen ? { inert: true } : {})}
      data-preview-panel-mode={props.mode}
      data-preview-panel-open={isOpen ? "true" : "false"}
      data-preview-panel-maximized={props.maximized ? "true" : "false"}
    >
      {isInline && isOpen ? <RightPanelResizeHandle handlers={handlers} /> : null}
      {useDragRegion ? <div className="electron-drag-region h-0 w-full" aria-hidden /> : null}
      {/*
       * Holds its own width instead of following the shell's.
       *
       * The shell animates width, and anything sized off it is laid out again on
       * every frame: tab labels and the empty-state cards wrap as the room runs
       * out, then unwrap on the way back. Cross-fading it only hid that; giving
       * the content a fixed width and letting the shell's `overflow-hidden` clip
       * it means the reflow never happens in either direction — the panel slides
       * behind an edge rather than being squeezed through it.
       *
       * Maximised, the shell is `flex-1` and has no pixel width to hold, so the
       * content tracks it as usual.
       */}
      <div
        data-slot="preview-panel-inner"
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          isInline && "min-w-(--layout-right-panel-min-width)",
          usesPixelWidth && "shrink-0",
        )}
        style={usesPixelWidth ? { width: `${width}px` } : undefined}
      >
        {props.children}
      </div>
    </div>
  );
}

/**
 * Measure the common chat/environment/panel flex row. Unlike viewport width,
 * this already excludes whatever width the left app sidebar currently owns.
 */
function useWorkspaceWidth(shellRef: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  useLayoutEffect(() => {
    const workspace = shellRef.current?.parentElement;
    if (!workspace) return;
    const update = () => setWidth(workspace.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(workspace);
    return () => {
      observer.disconnect();
    };
  }, []);
  return width;
}
