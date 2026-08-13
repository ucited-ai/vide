const COMPOSER_POPUP_GAP = 8;

/**
 * Keep a footer-owned drop-up above the whole composer, not merely above its
 * trigger. Otherwise the lower part of a translucent popup sits on top of the
 * composer surface while the upper part sits on top of the chat, so one popup
 * appears to have two different opacities.
 */
export function resolveComposerPopupSideOffset(trigger: HTMLElement | null): number {
  if (!trigger) return COMPOSER_POPUP_GAP;

  const shell = trigger.closest(".chat-composer-glass-shell");
  if (!(shell instanceof HTMLElement)) return COMPOSER_POPUP_GAP;

  const triggerRect = trigger.getBoundingClientRect();
  const shellRect = shell.getBoundingClientRect();
  return Math.max(COMPOSER_POPUP_GAP, triggerRect.top - shellRect.top + COMPOSER_POPUP_GAP);
}
