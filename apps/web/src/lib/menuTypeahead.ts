import type { KeyboardEvent } from "react";

/**
 * Let a text field inside a Base UI menu actually receive text.
 *
 * Base UI attaches typeahead to the menu popup so that typing jumps to a
 * matching item. It preventDefaults every printable key it sees, and it does not
 * care whether the key landed on an item or on an `<input>` nested inside the
 * popup — so any field in a menu silently swallows what you type. It looks like
 * a broken keyboard rather than a captured event, which is why it survives
 * review: nothing throws and nothing logs.
 *
 * Stopping propagation for printable keys keeps them in the field. Everything
 * else — arrows, Enter, Escape, Tab, and any shortcut carrying a modifier —
 * still reaches the menu and drives it as usual.
 */
export function keepPrintableKeysInField(event: KeyboardEvent<HTMLElement>): void {
  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.stopPropagation();
  }
}
