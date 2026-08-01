import type { ComponentPropsWithoutRef, Ref } from "react";

import { cn } from "~/lib/utils";

/**
 * The app's one native scroll container.
 *
 * Before this, a dozen surfaces each spelled out `overflow-auto` plus whatever
 * overscroll, scrollbar-gutter and anchoring policy they happened to remember.
 * That is why scroll behaviour regresses silently here and gets re-solved per
 * panel. The point of this module is that there is now one place to change, and
 * one place to read.
 *
 * Deliberately *not* replaced by this:
 * - `ui/scroll-area.tsx`, which wraps Base UI's ScrollArea. That component owns
 *   its own viewport element and draws custom scrollbars; this primitive is for
 *   the plain native scrollers.
 * - The `max-h-… overflow-y-auto` lists inside popups, menus and comboboxes.
 *   Their sizing comes from the popup's own `--popup-*` variables and Base UI
 *   positions them; a shared surface would only re-state `overflow`.
 * - `<pre>` blocks that scroll their own overflow. They are content, not panes.
 */

export type ScrollAxis = "y" | "x" | "both";
export type ScrollGutter = "none" | "stable" | "both";

export interface ScrollSurfaceOptions {
  axis?: ScrollAxis | undefined;
  /**
   * `contain` stops a panel's scroll chaining into whatever is behind it once
   * it hits an end. Every panel-shaped surface wants it; a surface that is
   * genuinely part of the page's own scroll does not.
   */
  overscroll?: "contain" | "auto" | undefined;
  gutter?: ScrollGutter | undefined;
  /**
   * Browser scroll anchoring. `auto` is the browser default: when content above
   * the viewport changes size, the browser silently adjusts scrollTop to keep
   * what you are looking at still.
   *
   * `none` is correct only where something else already owns that job — a
   * virtualiser that moves items in and out of the DOM and re-anchors in
   * JavaScript, where two anchoring mechanisms fighting is worse than one.
   * Prefer leaving it to the browser.
   */
  anchor?: "auto" | "none" | undefined;
}

const AXIS_CLASS: Record<ScrollAxis, string> = {
  y: "overflow-y-auto overflow-x-hidden",
  x: "overflow-x-auto overflow-y-hidden",
  both: "overflow-auto",
};

const OVERSCROLL_CLASS = {
  contain: "overscroll-contain",
  auto: "",
} as const;

const GUTTER_CLASS: Record<ScrollGutter, string> = {
  none: "",
  stable: "scrollbar-gutter-stable",
  both: "scrollbar-gutter-both",
};

/**
 * The class string on its own, for surfaces whose scrolling element is created
 * by someone else — a Base UI `SidebarGroup`, a library-owned viewport — and
 * only lets us hand it a `className`.
 */
export function scrollSurfaceClassName({
  axis = "y",
  overscroll = "contain",
  gutter = "none",
  anchor = "auto",
}: ScrollSurfaceOptions = {}): string {
  return cn(
    // Without `min-h-0` a flex child refuses to shrink below its content and
    // the scroller silently becomes the page's problem instead of its own.
    "min-h-0",
    AXIS_CLASS[axis],
    OVERSCROLL_CLASS[overscroll],
    GUTTER_CLASS[gutter],
    anchor === "none" && "[overflow-anchor:none]",
  );
}

export interface ScrollSurfaceProps extends ComponentPropsWithoutRef<"div">, ScrollSurfaceOptions {
  ref?: Ref<HTMLDivElement>;
}

export function ScrollSurface({
  axis,
  overscroll,
  gutter,
  anchor,
  className,
  ref,
  ...props
}: ScrollSurfaceProps) {
  return (
    <div
      {...props}
      ref={ref}
      className={cn(scrollSurfaceClassName({ axis, overscroll, gutter, anchor }), className)}
    />
  );
}
