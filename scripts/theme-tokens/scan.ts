/*
 * Finds theme values that live outside the theme.
 *
 * The app has one type scale and one colour ladder, both in `vide-theme.css`,
 * and both only work if components ask for a role instead of naming a size or a
 * colour themselves. That agreement decays quietly: every hardcoded `text-xs` or
 * `#1b1c20` still looks right on the day it is written, and the damage only
 * shows up later, when turning the scale up moves two thirds of the app and
 * leaves the rest standing. This is the check that keeps it from decaying again.
 *
 * It reports what it finds; `check.ts` decides what blocks.
 */

export type FindingKind = "hardcoded-text-size" | "raw-color" | "raw-font-size";

export interface Finding {
  readonly kind: FindingKind;
  readonly path: string;
  /** The offending literal itself, e.g. `text-xs` or `#1b1c20`. */
  readonly value: string;
  /** How often it appears in this file. Kept out of the key; see baseline.ts. */
  readonly count: number;
  /** First line it appears on, for the report only — never for the baseline key. */
  readonly line: number;
}

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

/** `"all"` where a file is the theme; otherwise the kinds it is excused from. */
export type Exemption = "all" | ReadonlyArray<FindingKind>;

export interface ScanConfig {
  /** Directory prefixes to scan. Everything else is somebody else's concern. */
  readonly roots: ReadonlyArray<string>;
  /** Directory prefixes inside those roots that are not the app's to theme. */
  readonly exemptRoots: ReadonlyArray<string>;
  /**
   * What a given file is excused from, by exact path.
   *
   * Per kind rather than per file, because the first version was per file and
   * that is how ten `font-size` declarations hid in plain sight: `index.css` was
   * excused because it legitimately holds derived colours, and the blanket
   * exemption took the sizes with them.
   */
  readonly exemptPaths: ReadonlyMap<string, Exemption>;
  /** Suffixes whose files are exempt — tests naming a colour are asserting, not styling. */
  readonly exemptSuffixes: ReadonlyArray<string>;
}

/*
 * `Icons.tsx`, `JetBrainsIcons.tsx` and `PierreEntryIcon.tsx` are brand marks:
 * a vendor's logo is that vendor's colour and does not belong to the palette.
 * `SidebarStageBackdrop.tsx` is a decorative gradient whose stops are the
 * artwork. `vide-theme.css` and `index.css` are where theme values are supposed
 * to live — flagging them would be flagging the answer.
 */
export const defaultScanConfig: ScanConfig = {
  roots: ["apps/web/src/", "apps/desktop/src/", "packages/client-runtime/src/"],
  /* The annotation overlay is injected into whatever page the user is previewing.
     It cannot see Vide's stylesheet, so its colours have nowhere to come from
     but itself — that is a boundary, not debt. */
  exemptRoots: ["apps/desktop/src/preview/"],
  exemptPaths: new Map<string, Exemption>([
    /* The theme itself. Every value here is the answer, not the debt. */
    ["apps/web/src/vide-theme.css", "all"],
    /*
     * Upstream's stylesheet. Its colours are derived from the ladder and belong
     * here, but a size declared in it escapes the scale exactly like one
     * declared in a component — so only the colour channel is excused.
     */
    ["apps/web/src/index.css", ["raw-color"]],
    /* Brand marks: a vendor's logo is that vendor's colour. */
    ["apps/web/src/components/Icons.tsx", ["raw-color"]],
    ["apps/web/src/components/JetBrainsIcons.tsx", ["raw-color"]],
    ["apps/web/src/components/chat/PierreEntryIcon.tsx", ["raw-color"]],
    /* A decorative gradient whose stops are the artwork. */
    ["apps/web/src/components/SidebarStageBackdrop.tsx", ["raw-color"]],
    /*
     * The pre-launch splash is a data-URL document with no stylesheet to read,
     * the same boundary as the injected preview overlay.
     */
    ["apps/desktop/src/window/DesktopWindow.ts", "all"],
  ]),
  exemptSuffixes: [".test.ts", ".test.tsx", ".stories.tsx", ".generated.ts"],
};

/*
 * Tailwind's own size steps, plus the arbitrary-pixel escape hatch.
 *
 * `text-xl` and up are deliberately absent: display copy — empty-state and
 * pairing headlines — sits outside the scale by design, and a check that
 * reported it would be teaching the wrong lesson.
 *
 * The boundaries matter more than they look. Without the leading one,
 * `--text-base-ui` matches `text-base`; without the trailing one, `text-sm`
 * matches inside `text-small`. Both were real when this was first written.
 */
const TEXT_SIZE =
  /(?<![-\w])(text-(?:xs|sm|base|lg)|text-\[\.?\d+(?:\.\d+)?(?:px|rem|em)\])(?![-\w])/g;

/**
 * A hex colour as a whole token.
 *
 * Both guards earn their keep. Without the leading one, `--foo#bar` reports;
 * without the trailing one, `"#backend-child"` reports as `#bac`, which is a
 * perfectly good colour and an entirely wrong finding.
 */
const HEX_COLOR = /(?<![\w#])#(?:[\da-fA-F]{8}|[\da-fA-F]{6}|[\da-fA-F]{3,4})(?![\w-])/g;

/**
 * A functional colour with literal channels.
 *
 * The `[\d.]` after the paren is what separates a colour from the plumbing that
 * builds one: `rgb(253 253 253 / 100%)` is a value someone typed, while
 * `rgb(${red} ${green} ${blue})` is the palette runtime assembling one and must
 * not be reported. `color-mix()` is absent on purpose — mixing from the ladder
 * is the centralised thing this check exists to encourage.
 */
const FUNCTIONAL_COLOR = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[\d.][^)\n]*\)/g;

/**
 * A size declared as a number rather than asked for by role.
 *
 * This is the kind the first pass missed, and it cost the most: ten `font-size`
 * declarations in a stylesheet and one `fontSize: 12` handed to a canvas meant
 * the whole rendered answer, the diff, the file tree and the terminal stood
 * still while everything around them scaled. Classes were being checked and
 * declarations were not, so centralisation stopped exactly at the file boundary.
 *
 * `em` and `%` are absent on purpose: both are proportions of an inherited size,
 * which is a way of *following* the scale, not of escaping it.
 */
const RAW_FONT_SIZE =
  /font-?[sS]ize"?'?\s*[:=]\s*"?'?\{?\s*(-?\d+(?:\.\d+)?(?:px|rem|pt)?)(?![\w%.])/g;

const isScannable = (path: string, config: ScanConfig): boolean =>
  config.roots.some((root) => path.startsWith(root)) &&
  !config.exemptRoots.some((root) => path.startsWith(root)) &&
  config.exemptPaths.get(path) !== "all" &&
  !config.exemptSuffixes.some((suffix) => path.endsWith(suffix));

const isExempt = (path: string, kind: FindingKind, config: ScanConfig): boolean => {
  const exemption = config.exemptPaths.get(path);
  return exemption !== undefined && (exemption === "all" || exemption.includes(kind));
};

/** Line number of an offset, 1-based. */
const lineAt = (content: string, index: number): number => {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (content.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
};

const collect = (
  file: SourceFile,
  kind: FindingKind,
  pattern: RegExp,
  into: Map<string, Finding>,
): void => {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(file.content)) !== null) {
    const value = match[1] ?? match[0];
    const key = `${kind} ${value}`;
    const existing = into.get(key);
    if (existing === undefined) {
      into.set(key, {
        kind,
        path: file.path,
        value,
        count: 1,
        line: lineAt(file.content, match.index),
      });
      continue;
    }
    into.set(key, { ...existing, count: existing.count + 1 });
  }
};

export const scanFile = (file: SourceFile, config: ScanConfig): ReadonlyArray<Finding> => {
  if (!isScannable(file.path, config)) return [];

  const found = new Map<string, Finding>();
  const look = (kind: FindingKind, pattern: RegExp) => {
    if (!isExempt(file.path, kind, config)) collect(file, kind, pattern, found);
  };

  /* A stylesheet has no Tailwind classes to hardcode; it declares CSS directly. */
  if (!file.path.endsWith(".css")) look("hardcoded-text-size", TEXT_SIZE);
  look("raw-color", HEX_COLOR);
  look("raw-color", FUNCTIONAL_COLOR);
  look("raw-font-size", RAW_FONT_SIZE);
  return [...found.values()];
};

export const scanSources = (
  files: ReadonlyArray<SourceFile>,
  config: ScanConfig = defaultScanConfig,
): ReadonlyArray<Finding> =>
  files.flatMap((file) => scanFile(file, config)).toSorted(compareFindings);

export const compareFindings = (left: Finding, right: Finding): number =>
  left.path.localeCompare(right.path) ||
  left.kind.localeCompare(right.kind) ||
  left.value.localeCompare(right.value);

/**
 * The ledger key. No line number, ever: a line number churns on every edit above
 * the finding, and a baseline that churns is one nobody reads before
 * regenerating it. The count is carried in the entry instead, so adding a second
 * copy to a file that already had one is still caught.
 */
export const findingKey = (finding: Finding): string =>
  `${finding.kind}:${finding.path}:${finding.value}`;

export const advice: Readonly<Record<FindingKind, string>> = {
  "hardcoded-text-size":
    "ask for a role: text-(length:--text-ui), --text-chat, --text-caption, --text-micro",
  "raw-color":
    "use a ladder token: var(--surface-chrome), var(--ink-secondary), or a color-mix from one",
  "raw-font-size":
    "read a role: var(--text-ui), var(--text-chat), var(--code-font-size) — or an em, which follows the scale",
};
