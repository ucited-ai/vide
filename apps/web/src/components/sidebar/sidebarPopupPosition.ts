const SIDEBAR_POPUP_GAP = 14;

/** Positions side-owned popups beyond the sidebar edge even when their trigger
 * is inset inside a row. A raw side offset only clears the trigger itself. */
export function resolveSidebarPopupSideOffset(trigger: HTMLElement | null): number {
  if (!trigger) return SIDEBAR_POPUP_GAP;

  const sidebar = trigger.closest('[data-slot="sidebar-container"]');
  if (!(sidebar instanceof HTMLElement)) return SIDEBAR_POPUP_GAP;

  const triggerRect = trigger.getBoundingClientRect();
  const sidebarRect = sidebar.getBoundingClientRect();
  return Math.max(SIDEBAR_POPUP_GAP, sidebarRect.right - triggerRect.right + SIDEBAR_POPUP_GAP);
}
