/*
 * Does the theme answer every token the app paints with, at root scope?
 *
 * The app carries two palettes on purpose: upstream's, so its merges stay clean,
 * and Vide's, which outranks it with repeated `:root:root:root` selectors instead
 * of `!important`. That bargain works only while the theme answers *every* token
 * upstream declares, and answers it at least as broadly.
 *
 * It stopped working for the sidebar family. Upstream declares `--sidebar` and
 * its row tokens at `:root`; the theme declared them under
 * `[data-sidebar-version]` alone. So the ladder reached them inside the sidebar
 * and nowhere else — and the settings navigation, which borrows those exact row
 * tokens and lives on the other side of the tree, kept upstream's zinc palette
 * no matter what colour anyone chose. Nothing was misspelled and nothing was
 * missing; the theme was simply narrower than the thing it was overriding.
 *
 * That is not a class of bug anyone finds by looking at a screen, because the
 * value is right in the place you check first. So it is checked here instead.
 */

interface Declaration {
  /** The custom property, without the leading dashes. */
  readonly token: string;
  /** The selector it was declared under. */
  readonly selector: string;
  readonly line: number;
}

interface CoverageGap {
  readonly token: string;
  /** Where upstream declares it at root scope. */
  readonly upstreamLine: number;
  /**
   * The selectors the theme does declare it under, if any. Empty means the theme
   * never answers this token at all; non-empty means it answers too narrowly.
   */
  readonly themeSelectors: ReadonlyArray<string>;
}

/**
 * A selector that applies to the whole document rather than to a subtree.
 *
 * `:root`, `html`, `body` and `*` in any repetition, and the dark-mode variants
 * of each. Anything carrying an attribute or a class beyond `.dark` is scoped to
 * part of the tree, which is exactly the distinction that matters here.
 */
const ROOT_SCOPE = /^(?::root|html|body|\*|\.dark)(?::root|\.dark)*$/;

const isRootScope = (selector: string): boolean =>
  selector
    .split(",")
    .map((part) => part.trim())
    .some((part) => ROOT_SCOPE.test(part));

/**
 * Every custom-property declaration in a stylesheet, with the selector it sits
 * under.
 *
 * Brace-counting rather than a CSS parser: this has to run inside a pre-commit
 * hook, and the shape it needs to recognise — a flat list of declarations under
 * a selector, optionally nested in one at-rule — is the only shape either of
 * these two files uses.
 */
export function collectDeclarations(css: string): ReadonlyArray<Declaration> {
  /*
   * Comments go first, across the whole file rather than line by line: a block
   * comment above a selector otherwise accumulates into it, and this file's
   * selectors arrive with a paragraph of prose glued to the front. Newlines are
   * kept so the reported line numbers still point at the declaration.
   */
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    "\n".repeat((comment.match(/\n/g) ?? []).length),
  );

  /*
   * Walked as a token stream rather than line by line, because a declaration is
   * allowed to share a line with the selector that opens its block. Reading only
   * line-leading declarations worked on both real stylesheets and would have
   * missed a compact one silently — the same shape of hole this check exists to
   * close.
   */
  const events = /\{|\}|--([A-Za-z0-9-]+)\s*:/g;
  const found: Array<Declaration> = [];
  const selectors: Array<string> = [];
  let cursor = 0;
  let line = 1;
  let match: RegExpExecArray | null;

  while ((match = events.exec(stripped)) !== null) {
    const segment = stripped.slice(cursor, match.index);
    line += (segment.match(/\n/g) ?? []).length;
    cursor = match.index + match[0].length;

    if (match[0] === "{") {
      const head = segment.split(/[{}]/).at(-1)?.trim() ?? "";
      /* An at-rule is a wrapper, not a selector: keep whatever is outside it. */
      selectors.push(head.startsWith("@") ? (selectors.at(-1) ?? "") : head);
      continue;
    }
    if (match[0] === "}") {
      selectors.pop();
      continue;
    }

    const selector = selectors.at(-1);
    if (selector !== undefined && selector !== "") {
      found.push({ token: match[1] ?? "", selector, line });
    }
  }

  return found;
}

/*
 * Tokens the theme deliberately leaves to upstream.
 *
 * Kept short and named, because the value of this check is that anything *not*
 * listed here is a decision someone still has to make. A new upstream colour
 * token should show up as a gap and be argued about, not absorbed silently.
 */
const LEFT_TO_UPSTREAM = new Set([
  /*
   * Semantic status hues. The ladder is monochrome by construction and owns no
   * hue, so an error is red and a warning is amber wherever upstream puts them.
   */
  "destructive",
  "destructive-foreground",
  "info",
  "info-foreground",
  "success",
  "success-foreground",
  "warning",
  "warning-foreground",
  /* Neither colour nor type: geometry, window chrome, and a noise texture. */
  "app-scrollbar-width",
  "desktop-window-right-resize-inset",
  "glass-blur",
  "glass-saturation",
  "surface-grain",
  "workspace-controls-left",
  "workspace-controls-right",
  "workspace-controls-top",
  "workspace-native-controls-inset",
  "workspace-titlebar-control-gap",
  "workspace-titlebar-control-size",
  "workspace-topbar-height",
]);

/**
 * Tokens upstream answers document-wide that the theme does not.
 *
 * Only tokens upstream declares at root are considered: something it scopes to a
 * subtree is its own business, and the theme is free to leave it alone.
 */
export function findCoverageGaps(
  upstream: ReadonlyArray<Declaration>,
  theme: ReadonlyArray<Declaration>,
): ReadonlyArray<CoverageGap> {
  const themeByToken = new Map<string, Array<Declaration>>();
  for (const declaration of theme) {
    const list = themeByToken.get(declaration.token);
    if (list === undefined) themeByToken.set(declaration.token, [declaration]);
    else list.push(declaration);
  }

  const gaps = new Map<string, CoverageGap>();
  for (const declaration of upstream) {
    if (!isRootScope(declaration.selector) || gaps.has(declaration.token)) continue;
    if (LEFT_TO_UPSTREAM.has(declaration.token)) continue;

    const answers = themeByToken.get(declaration.token) ?? [];
    if (answers.some((answer) => isRootScope(answer.selector))) continue;

    gaps.set(declaration.token, {
      token: declaration.token,
      upstreamLine: declaration.line,
      themeSelectors: answers.map((answer) => answer.selector),
    });
  }

  return [...gaps.values()].toSorted((left, right) => left.token.localeCompare(right.token));
}

export const describeGap = (gap: CoverageGap): string =>
  gap.themeSelectors.length === 0
    ? "upstream declares it document-wide, the theme never answers it"
    : `upstream declares it document-wide, the theme only under ${gap.themeSelectors.join(" / ")}`;
