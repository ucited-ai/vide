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
  /**
   * Back to a plain resizable panel — reopened if the drag had collapsed it,
   * restored if the drag had taken it full-area. One action for both because
   * from the handle's side they are the same event: the drag came back inside
   * the bounds, and the panel has to follow the cursor again either way.
   */
  readonly onRestorePanel: () => void;
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
  /*
   * How the drag currently wants the shell to look. Appearance only — see the
   * note on `onSnapChange`. It is what lets one press size the panel, push it
   * shut, and pull it back open without ever letting go.
   */
  const [dragSnap, setDragSnap] = useState<ResizableWidthResult["snap"]>(null);
  const onResizeEnd = useCallback(
    (result: ResizableWidthResult) => {
      setDragSnap(null);
      if (!layoutActions) return;
      if (result.snap === "collapse") {
        layoutActions.onCollapsePanel();
        return;
      }
      if (result.snap === "full-area") {
        layoutActions.onEnterFullArea();
        return;
      }
      layoutActions.onRestorePanel();
    },
    [layoutActions],
  );
  const { width, resizing, handlers } = useResizableWidth({
    storageKey: PREVIEW_PANEL_WIDTH_STORAGE_KEY,
    defaultWidth: PREVIEW_PANEL_DEFAULT_WIDTH,
    minWidth: PREVIEW_PANEL_MIN_WIDTH,
    maxWidth,
    deadZone: PREVIEW_PANEL_RESIZE_DEAD_ZONE,
    ...(props.maximized ? { dragStartWidth: workspaceWidth } : {}),
    edge: "left",
    onSnapChange: setDragSnap,
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
  /*
   * While the handle is held the drag decides how this renders; the committed
   * state takes it back on release. Reading both from one place is what keeps
   * the two from disagreeing for a frame at either end of the gesture.
   */
  const collapsed = resizing ? dragSnap === "collapse" : !isOpen;
  const fullArea = resizing ? dragSnap === "full-area" : Boolean(props.maximized && isOpen);
  const usesPixelWidth = isInline && !fullArea;

  /*
   * Sizing has to track the pointer exactly, so it must not be eased — an eased
   * width lags behind the edge you are holding. Snapping is the opposite: the
   * panel leaves the cursor to go shut or go full, and that is a movement the
   * eye has to be able to follow rather than a jump.
   *
   * Both directions count. Coming back out of a snap lands the panel at the
   * threshold the cursor is sitting on, which is the same distance travelled as
   * going in, so easing only the way in would animate half of one gesture.
   */
  const [settlingSnap, setSettlingSnap] = useState(false);
  const previousSnapRef = useRef(dragSnap);
  useEffect(() => {
    if (previousSnapRef.current === dragSnap) return;
    previousSnapRef.current = dragSnap;
    setSettlingSnap(true);
  }, [dragSnap]);
  const tracksPointer = resizing && dragSnap === null && !settlingSnap;

  return (
    <div
      ref={shellRef}
      className={cn(
        "relative flex h-full min-h-0 min-w-0 flex-col self-stretch overflow-hidden bg-background",
        isInline ? (fullArea ? "flex-1 border-l border-border" : "shrink-0") : "w-full",
        // The edge only exists while there is a panel to edge. Kept at zero
        // width it would read as a stray hairline down the side of the chat.
        isInline && !collapsed && !fullArea && "border-l border-border",
        isInline &&
          !tracksPointer &&
          "transition-[width] duration-(--duration-base) ease-(--ease-soft)",
      )}
      style={usesPixelWidth ? { width: collapsed ? 0 : `${width}px` } : undefined}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === "width") {
          setSettlingSnap(false);
        }
      }}
      // Collapsed but mounted, it must not be reachable: without this, Tab walks
      // into a panel nobody can see. Held open while a drag is in flight, since
      // the handle lives in here and `inert` would cut the gesture off at the
      // exact moment the drag collapses the panel — leaving the user unable to
      // pull it back out.
      {...(isInline && !isOpen && !resizing ? { inert: true } : {})}
      data-preview-panel-mode={props.mode}
      data-preview-panel-open={isOpen ? "true" : "false"}
      data-preview-panel-maximized={props.maximized ? "true" : "false"}
    >
      {/* Stays mounted for the whole gesture, not just while the panel is open:
          it holds the pointer capture, so unmounting it the instant a drag
          collapses the panel would end the drag there. */}
      {isInline && (isOpen || resizing) ? <RightPanelResizeHandle handlers={handlers} /> : null}
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
