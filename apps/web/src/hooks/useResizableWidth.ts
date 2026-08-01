import * as Schema from "effect/Schema";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { getLocalStorageItem, setLocalStorageItem } from "./useLocalStorage";
import { resolveResizableWidth, type ResizableWidthResult } from "./resizableWidthLogic";

const WidthSchema = Schema.Finite;

export interface UseResizableWidthOptions {
  /** localStorage key the persisted width is stored under. */
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly deadZone: number;
  /**
   * Optional drag origin outside the normal bounds. Used when an external
   * full-area state owns the rendered width but the same handle must restore
   * the resizable state.
   */
  readonly dragStartWidth?: number;
  /**
   * Called on pointer-down with where the panel already stands, then again each
   * time the held drag crosses into or out of a snap zone.
   *
   * This is how the panel collapses under the cursor when you push past its
   * minimum and comes back when you pull out again, so sizing it and opening or
   * closing it are one gesture rather than a drag followed by a click.
   *
   * It reports appearance only. Whatever owns the panel must not act on it —
   * what lives inside holds a pty or a browser session, and tearing those down
   * because a drag passed over the threshold would make a gesture the user
   * hasn't finished destructive. `onResizeEnd` is where the state commits.
   */
  readonly onSnapChange?: (snap: ResizableWidthResult["snap"]) => void;
  /** The snap the finished gesture settled on. This one is the commit. */
  readonly onResizeEnd?: (result: ResizableWidthResult) => void;
  /**
   * Which edge of the host element carries the drag handle:
   *   - "left"  → panel grows leftward (right-anchored panels)
   *   - "right" → panel grows rightward (left-anchored panels)
   */
  readonly edge: "left" | "right";
}

export interface ResizableWidthHandlers {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

/**
 * Width state for a side-anchored panel resized via a drag handle on the
 * specified edge. Width is read from localStorage on mount and persisted on
 * drag-end (not on every rAF tick — would otherwise be ~60 writes/sec).
 *
 * The hook updates an internal `width` state during drag (so the panel
 * follows the cursor live) and only commits to localStorage when the user
 * lifts the pointer.
 */
export function useResizableWidth(options: UseResizableWidthOptions): {
  readonly width: number;
  readonly resizing: boolean;
  readonly handlers: ResizableWidthHandlers;
} {
  const {
    storageKey,
    defaultWidth,
    minWidth,
    maxWidth,
    deadZone,
    dragStartWidth,
    edge,
    onResizeEnd,
  } = options;

  const resolve = useCallback(
    (value: number): ResizableWidthResult =>
      resolveResizableWidth({
        value,
        fallbackWidth: defaultWidth,
        minWidth,
        maxWidth,
        deadZone,
      }),
    [deadZone, defaultWidth, maxWidth, minWidth],
  );
  const constrain = useCallback((value: number): number => resolve(value).width, [resolve]);

  // Read through a ref: the callback closes over panel state that changes as a
  // direct result of calling it, so a handler capturing one render's version
  // would keep re-reporting a snap the panel has already moved past.
  const onSnapChangeRef = useRef(options.onSnapChange);
  useEffect(() => {
    onSnapChangeRef.current = options.onSnapChange;
  });

  // No cross-tab subscription: panel width is per-window state.
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return defaultWidth;
    try {
      const stored = getLocalStorageItem(storageKey, WidthSchema);
      return constrain(stored ?? defaultWidth);
    } catch (error) {
      console.error("Could not read persisted panel width.", error);
      return defaultWidth;
    }
  });
  const [resizing, setResizing] = useState(false);

  const constrainedWidth = constrain(width);

  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    startSnap: ResizableWidthResult["snap"];
    snap: ResizableWidthResult["snap"];
    pending: number;
    rafId: number | null;
    target: HTMLElement;
  } | null>(null);

  /** Report a crossing once, on the edge, so the panel is not told to collapse every frame. */
  const applySnap = useCallback((snap: ResizableWidthResult["snap"]) => {
    const state = dragStateRef.current;
    if (!state || state.snap === snap) return;
    state.snap = snap;
    onSnapChangeRef.current?.(snap);
  }, []);

  const releasePointer = useCallback((pointerId: number) => {
    const state = dragStateRef.current;
    if (!state) return;
    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
    }
    try {
      if (state.target.hasPointerCapture(pointerId)) {
        state.target.releasePointerCapture(pointerId);
      }
    } catch {
      // pointer may already be released; harmless.
    }
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    dragStateRef.current = null;
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        return;
      }
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const startWidth =
        dragStartWidth !== undefined && Number.isFinite(dragStartWidth)
          ? dragStartWidth
          : constrainedWidth;
      // Seeded from where the panel already is, so a drag that begins in the
      // full-area state only reports a change once it leaves that state.
      const startSnap = resolve(startWidth).snap;
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth,
        startSnap,
        snap: startSnap,
        pending: startWidth,
        rafId: null,
        target,
      };
      setWidth(resolve(startWidth).width);
      setResizing(true);
      // Reported even though nothing has changed yet: the first frame of the
      // drag has to render the state the panel is already in, or a panel that
      // was full-area would flash back to its stored width as it is grabbed.
      onSnapChangeRef.current?.(startSnap);
    },
    [constrainedWidth, dragStartWidth, resolve],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      event.preventDefault();
      const delta = edge === "left" ? state.startX - event.clientX : event.clientX - state.startX;
      state.pending = state.startWidth + delta;
      if (state.rafId !== null) return;
      state.rafId = requestAnimationFrame(() => {
        const active = dragStateRef.current;
        if (!active) return;
        active.rafId = null;
        const result = resolve(active.pending);
        setWidth(result.width);
        applySnap(result.snap);
      });
    },
    [applySnap, edge, resolve],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      const result = resolve(state.pending);
      releasePointer(event.pointerId);
      setResizing(false);
      setWidth(result.width);
      onResizeEnd?.(result);
      // A snapped panel is collapsed or full-area; the width under it is the
      // one to come back to, not the one to remember.
      if (result.snap !== null) return;
      // Commit once at drag-end to avoid 60Hz localStorage writes.
      try {
        setLocalStorageItem(storageKey, result.width, WidthSchema);
      } catch (error) {
        console.error("Could not persist panel width.", error);
      }
    },
    [onResizeEnd, releasePointer, resolve, storageKey],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      // Don't persist a cancelled drag; put both the width and whatever the
      // drag snapped to along the way back where they started.
      const { startWidth, startSnap } = state;
      applySnap(startSnap);
      releasePointer(event.pointerId);
      setWidth(startWidth);
      setResizing(false);
    },
    [applySnap, releasePointer],
  );

  return {
    width: resizing ? width : constrainedWidth,
    resizing,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}
