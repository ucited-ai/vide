import * as Schema from "effect/Schema";
import { type PointerEvent as ReactPointerEvent, useCallback, useRef, useState } from "react";

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
    startedAboveMaximum: boolean;
    pending: number;
    rafId: number | null;
    target: HTMLElement;
  } | null>(null);

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
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth,
        startedAboveMaximum: startWidth > maxWidth,
        pending: startWidth,
        rafId: null,
        target,
      };
      setWidth(startWidth);
      setResizing(true);
    },
    [constrainedWidth, dragStartWidth, maxWidth],
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
        setWidth(
          active.startedAboveMaximum
            ? Math.max(minWidth, active.pending)
            : resolve(active.pending).width,
        );
      });
    },
    [edge, minWidth, resolve],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      const result =
        state.startedAboveMaximum && state.pending > maxWidth
          ? { width: maxWidth, snap: "full-area" as const }
          : resolve(state.pending);
      releasePointer(event.pointerId);
      setResizing(false);
      setWidth(result.width);
      onResizeEnd?.(result);
      if (result.snap !== null) return;
      // Commit once at drag-end to avoid 60Hz localStorage writes.
      try {
        setLocalStorageItem(storageKey, result.width, WidthSchema);
      } catch (error) {
        console.error("Could not persist panel width.", error);
      }
    },
    [maxWidth, onResizeEnd, releasePointer, resolve, storageKey],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      // Don't persist a cancelled drag; revert to the start width.
      releasePointer(event.pointerId);
      setWidth(state.startWidth);
      setResizing(false);
    },
    [releasePointer],
  );

  return {
    width: resizing ? width : constrainedWidth,
    resizing,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}
