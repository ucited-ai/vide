/*
 * The surface, backdrop and mobile-sheet classes that `dialog`, `alert-dialog`
 * and `command` all paint their popup with.
 *
 * Worth keeping as its own module rather than folding into `dialog.tsx`: three
 * unrelated Base UI roots (Dialog, AlertDialog and the command palette's own
 * Dialog) need the identical surface, and importing `dialog.tsx` from
 * `alert-dialog.tsx` purely for a string would couple two primitives that share
 * nothing else. Geometry is *not* duplicated here — radius, padding and rhythm
 * come from the --dialog-* tokens in vide-theme.css, so this file only carries
 * the composition that Tailwind cannot express as a single token.
 *
 * The transition is the shared ease and duration, not Tailwind's `ease-in-out`
 * and a hand-written 200ms. Note the backdrop transitions `opacity` and nothing
 * else: `transition-all` on a surface Base UI waits on is exactly the shape of
 * bug that once froze every popup mid-entrance.
 */

const DIALOG_BACKDROP_CLASS =
  "dialog-backdrop fixed inset-0 z-50 transition-opacity duration-(--duration-base) ease-(--ease-in-out) data-ending-style:opacity-0 data-starting-style:opacity-0";

const DIALOG_POPUP_CLASS =
  "dialog-glass -translate-y-[calc(1.25rem*var(--nested-dialogs))] relative flex min-h-0 w-full min-w-0 scale-[calc(1-0.1*var(--nested-dialogs))] flex-col rounded-(--dialog-radius) border opacity-[calc(1-0.1*var(--nested-dialogs))] outline-none transition-[scale,opacity,translate] duration-(--duration-base) ease-(--ease-in-out) will-change-transform data-nested:data-ending-style:translate-y-8 data-nested:data-starting-style:translate-y-8 data-nested-dialog-open:origin-top data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0";

const DIALOG_MOBILE_SHEET_CLASS =
  "max-sm:max-w-none max-sm:rounded-none max-sm:border-x-0 max-sm:border-t max-sm:border-b-0 max-sm:opacity-[calc(1-min(var(--nested-dialogs),1))] max-sm:data-ending-style:translate-y-4 max-sm:data-starting-style:translate-y-4";

export { DIALOG_BACKDROP_CLASS, DIALOG_MOBILE_SHEET_CLASS, DIALOG_POPUP_CLASS };
