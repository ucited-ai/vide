/**
 * Read a CSS time custom property as milliseconds.
 *
 * `Number.parseFloat` is not enough on its own, and getting this wrong is
 * invisible in development. A CSS `<time>` is written in either seconds or
 * milliseconds, and the production minifier rewrites `260ms` to the shorter
 * `.26s` — so parsing the number and treating it as milliseconds yielded 0.26.
 * Both callers used that figure to hold something on screen for the length of a
 * transition, so in release builds the terminal drawer unmounted a quarter of a
 * millisecond into its close and the sidebar's list animation ran for
 * effectively no time at all, while both looked correct when run unminified.
 */
export function readCssTimeMs(styles: CSSStyleDeclaration, property: string): number | null {
  const raw = styles.getPropertyValue(property).trim();
  if (raw.length === 0) return null;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return raw.endsWith("ms") ? parsed : parsed * 1000;
}
