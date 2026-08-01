/**
 * Shared metrics for the composer's three sibling controls — the
 * permissions picker, the model picker trigger, and the context meter.
 *
 * `buttonVariants`/`selectTriggerVariants` carry `text-(length:--text-ui)`, and
 * the select trigger's `min-h-*` step
 * lets its box grow past that font's line height rather than clip to it —
 * that's what made permissions read taller and chunkier than its neighbours.
 * Pinning height, type size, and gap here once keeps the three controls on
 * one rhythm instead of drifting independently in each component.
 */
export const COMPOSER_CONTROL_HEIGHT_CLASS = "h-7 min-h-0 sm:h-6 sm:min-h-0";
export const COMPOSER_CONTROL_TEXT_CLASS = "text-(length:--text-ui) sm:text-(length:--text-ui)";
export const COMPOSER_CONTROL_GAP_CLASS = "gap-1.5";
export const COMPOSER_CONTROL_ICON_SIZE_CLASS = "size-4";
