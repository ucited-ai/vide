/**
 * Shared sidebar row chrome.
 *
 * The sidebar is the app's index: it is scanned, not read. That only works when
 * every row sits on one rhythm, starts its label at the same x, and paints that
 * label with the same weight of ink — so the values deciding those three things
 * live here instead of being retyped per row. Sidebar v1 and v2 both consume
 * this module, which is what stops the two from drifting apart.
 *
 * Only tokens from vide-theme.css appear below; nothing here invents a size, a
 * colour, or a curve.
 */

/**
 * Row-level state changes: the hover wash, the ink under it, and any control
 * that fades in on hover. One curve and one duration, so nothing in the sidebar
 * moves at its own rate.
 */
export const SIDEBAR_ROW_MOTION_CLASS =
  "transition-[background-color,color,opacity] duration-[var(--duration-fast)] ease-[var(--ease-out)]";

/**
 * The leading slot every row reserves, whether or not it currently has a status
 * to put in it. Reserving it unconditionally is the whole point: a dot that
 * appears on only some rows shunts those titles sideways, and a column of
 * titles that starts at four different x positions is what makes a list look
 * untidy long before anyone can say why.
 */
export const SIDEBAR_STATUS_SLOT_CLASS =
  "inline-flex size-3.5 shrink-0 items-center justify-center";

/**
 * Row labels — project names and thread titles alike — are the sidebar's
 * content, and all of them carry primary ink. Dimming a thread title to signal
 * "nothing for you here" costs far more in scannability than it buys; recessive
 * states are said with the trailing metadata and the row's surface instead.
 */
export const SIDEBAR_ROW_LABEL_CLASS = "min-w-0 flex-1 truncate text-[length:var(--text-ui)]";

/** What trails a row: timestamps, counts, branch names, environment hints. */
export const SIDEBAR_ROW_META_CLASS =
  "text-[length:var(--text-caption)] text-sidebar-muted-foreground/70";

/**
 * Secondary rows inside a list — "Show more", "Show less", empty states. The
 * one affordance that stays quiet, because it is scaffolding rather than
 * content.
 */
export const SIDEBAR_MUTED_ROW_CLASS =
  "h-8 w-full translate-x-0 cursor-pointer justify-start rounded-md px-2 text-left text-[length:var(--text-caption)] text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground";

/**
 * Icon-only actions living inside a row (archive, new thread). Sized to the row
 * rather than to its own icon, so the hit target is predictable wherever it
 * lands.
 */
export const SIDEBAR_ICON_ACTION_BUTTON_CLASS =
  "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring";

/**
 * The same idea one step down, for controls that sit beside a section label.
 * They are scaled to the caption they align with, not to the rows below.
 */
export const SIDEBAR_SECTION_ACTION_BUTTON_CLASS =
  "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-3.5";

/**
 * Row actions stay out of the way until the pointer is on the row or focus has
 * landed inside it. Coarse pointers keep them permanently — there is no hover
 * to reveal them with.
 *
 * Three near-identical strings rather than one parameterised helper: Tailwind
 * reads class names statically, so the group name has to be literal.
 */
export const SIDEBAR_THREAD_ROW_ACTIONS_CLASS =
  "pointer-events-none absolute top-1/2 right-0.5 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)] max-sm:pointer-events-auto max-sm:opacity-100 group-hover/menu-sub-item:pointer-events-auto group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:pointer-events-auto group-focus-within/menu-sub-item:opacity-100";

export const SIDEBAR_PROJECT_ROW_ACTIONS_CLASS =
  "pointer-events-none absolute top-1/2 right-0.5 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)] max-sm:pointer-events-auto max-sm:opacity-100 group-hover/project-header:pointer-events-auto group-hover/project-header:opacity-100 group-focus-within/project-header:pointer-events-auto group-focus-within/project-header:opacity-100";

/**
 * Section actions add one case the row actions don't have: they open menus, and
 * a menu's trigger has to stay visible while its popup is up — the pointer has
 * by then left the header, and focus has moved into a portalled popup where
 * :focus-within can't see it.
 */
export const SIDEBAR_SECTION_ACTIONS_CLASS =
  "pointer-events-none flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)] max-sm:pointer-events-auto max-sm:opacity-100 group-hover/sidebar-section:pointer-events-auto group-hover/sidebar-section:opacity-100 group-focus-within/sidebar-section:pointer-events-auto group-focus-within/sidebar-section:opacity-100 has-[[data-popup-open]]:pointer-events-auto has-[[data-popup-open]]:opacity-100";

/**
 * auto-animate drives list reordering from JavaScript, so it needs numbers
 * where the rest of the sidebar uses tokens. Reading the tokens off the live
 * element keeps the theme as the single source of truth instead of pinning a
 * copy of the numbers here; where they can't be read (jsdom, styles not yet
 * applied) auto-animate falls back to its own defaults.
 */
export function sidebarListAnimationOptions(element: HTMLElement): {
  duration?: number;
  easing?: string;
} {
  const styles = window.getComputedStyle(element);
  const duration = Number.parseFloat(styles.getPropertyValue("--duration-base"));
  const easing = styles.getPropertyValue("--ease-out").trim();
  return {
    ...(Number.isFinite(duration) ? { duration } : {}),
    ...(easing.length > 0 ? { easing } : {}),
  };
}
