/*
 * Dead-code analysis core. Pure: everything here takes file contents and returns
 * findings, so the tests need no fixtures on disk and no git.
 *
 * The detector is a textual reference index rather than a program graph. That is a
 * measured trade-off (0.2s versus tens of seconds for a TypeScript program) and it
 * is deliberately biased to *under*-report: any occurrence of a name anywhere in
 * the repo — including inside a string, a comment, a `.md`, or a `.json` — keeps
 * the symbol alive. A blocking hook must never be wrong in the other direction.
 *
 * See DEAD-CODE-CHECK-DESIGN.md for what this consequently cannot see.
 */

type FindingKind =
  | "unused-local"
  | "unused-export"
  | "unused-exported-type"
  | "test-only-export"
  | "unused-css-var"
  | "unused-css-class";

/** `block` findings can fail a commit; `report` findings are only ever printed. */
type FindingSeverity = "block" | "report";

export interface Finding {
  readonly kind: FindingKind;
  /** Repo-relative, forward-slashed. */
  readonly path: string;
  readonly symbol: string;
  readonly detail: string;
  readonly severity: FindingSeverity;
}

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

export interface AnalyzeConfig {
  /** Path prefixes whose declarations are checked. References are always repo-wide. */
  readonly declarationRoots: ReadonlyArray<string>;
  /** Path prefixes excluded from declaration scanning. */
  readonly declarationExcludes: ReadonlyArray<string>;
  /** CSS files we own, whose custom properties and namespaced classes are checked. */
  readonly cssFiles: ReadonlyArray<string>;
  /** Class-name prefixes we own. Anything else is assumed to style library DOM. */
  readonly cssClassPrefixes: ReadonlyArray<string>;
}

/*
 * Declarations are scanned only in first-party application and library code.
 *
 * `packages/contracts`, `packages/effect-acp` and `packages/effect-codex-app-server`
 * are excluded because they are exhaustive bindings for external protocols where a
 * complete surface is the charter — including them adds 2100+ findings of pure
 * noise. `packages/ssh`, `packages/tailscale` and `infra/relay` are thin adapters
 * with the same property.
 */
export const defaultAnalyzeConfig: AnalyzeConfig = {
  declarationRoots: [
    "apps/web/src/",
    "apps/server/src/",
    "apps/desktop/src/",
    "packages/shared/src/",
    "packages/client-runtime/src/",
    "scripts/",
    "oxlint-plugin-vide/",
  ],
  declarationExcludes: ["apps/web/src/lib/vendor/"],
  cssFiles: ["apps/web/src/vide-theme.css"],
  cssClassPrefixes: ["vide-"],
};

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SCRIPT_FILE = /\.[cm]?[jt]sx?$/;

export const isTestFile = (path: string): boolean =>
  TEST_FILE.test(path) ||
  path.includes("/test/") ||
  path.includes("/tests/") ||
  path.includes("/__tests__/") ||
  path.includes("/__mocks__/");

/*
 * Two alternatives, and the order matters: a CSS custom property is matched whole
 * (`--example-2` is one token, distinct from `--example-20`, which makes the map
 * lookup an exact word-boundary test), while JS identifiers stop at a hyphen so
 * `a-b` does not become a single token.
 *
 * Names in this file are invented on purpose. A comment is an occurrence, and an
 * occurrence keeps a symbol alive — naming a real token here would silently delete
 * a genuine finding. It did, during development.
 */
const REFERENCE_TOKEN = /--[A-Za-z0-9_-]+|[A-Za-z_$][A-Za-z0-9_$]*/g;

type ReferenceIndex = ReadonlyMap<string, ReadonlySet<number>>;

/** token -> set of indices into `files`. One pass, ~200ms over this repo. */
export const buildReferenceIndex = (files: ReadonlyArray<SourceFile>): ReferenceIndex => {
  const index = new Map<string, Set<number>>();
  for (const [fileIndex, file] of files.entries()) {
    REFERENCE_TOKEN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = REFERENCE_TOKEN.exec(file.content)) !== null) {
      const existing = index.get(match[0]);
      if (existing === undefined) index.set(match[0], new Set([fileIndex]));
      else existing.add(fileIndex);
    }
  }
  return index;
};

interface ExportedSymbol {
  readonly name: string;
  readonly isType: boolean;
}

/*
 * `export default` is absent on purpose: a default export is imported under an
 * arbitrary local name, so a name index cannot see its call sites.
 * `export const { a, b } = ...` and `export const a = 1, b = 2` yield only what the
 * pattern captures — an under-report, which is the safe direction.
 */
const EXPORT_DECLARATION =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(const|let|var|function\s*\*?|class|type|interface|enum|namespace)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
const EXPORT_NAMED_LIST = /^export\s+(?:type\s+)?\{([^}]*)\}/gm;

export const extractExportedSymbols = (content: string): ReadonlyArray<ExportedSymbol> => {
  const symbols = new Map<string, ExportedSymbol>();

  EXPORT_DECLARATION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXPORT_DECLARATION.exec(content)) !== null) {
    const keyword = match[1];
    const name = match[2];
    if (keyword === undefined || name === undefined) continue;
    const isType = keyword === "type" || keyword === "interface";
    if (!symbols.has(name)) symbols.set(name, { name, isType });
  }

  EXPORT_NAMED_LIST.lastIndex = 0;
  while ((match = EXPORT_NAMED_LIST.exec(content)) !== null) {
    const list = match[1];
    if (list === undefined) continue;
    for (const entry of list.split(",")) {
      const trimmed = entry.trim();
      if (trimmed.length === 0) continue;
      const isType = trimmed.startsWith("type ");
      const withoutType = isType ? trimmed.slice("type ".length).trim() : trimmed;
      const aliased = withoutType.split(/\s+as\s+/);
      const exposed = (aliased[1] ?? aliased[0] ?? "").trim();
      if (exposed === "default" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exposed)) continue;
      if (!symbols.has(exposed)) symbols.set(exposed, { name: exposed, isType });
    }
  }

  return [...symbols.values()];
};

/*
 * Tailwind turns `--font-sans` declared inside `@theme` into the `font-sans`
 * utility through codegen we do not model, so those blocks are dropped wholesale
 * rather than reported as false positives.
 */
export const stripThemeBlocks = (css: string): string => {
  let remaining = "";
  let cursor = 0;
  for (;;) {
    const at = css.indexOf("@theme", cursor);
    if (at === -1) {
      remaining += css.slice(cursor);
      return remaining;
    }
    remaining += css.slice(cursor, at);
    const open = css.indexOf("{", at);
    if (open === -1) return remaining;
    let depth = 1;
    let scan = open + 1;
    while (scan < css.length && depth > 0) {
      if (css[scan] === "{") depth += 1;
      else if (css[scan] === "}") depth -= 1;
      scan += 1;
    }
    cursor = scan;
  }
};

const CSS_CUSTOM_PROPERTY_DECLARATION = /(?:^|[;{\s])(--[A-Za-z0-9_-]+)\s*:/g;

export const extractCssCustomProperties = (css: string): ReadonlyArray<string> => {
  const body = stripThemeBlocks(css);
  const names = new Set<string>();
  CSS_CUSTOM_PROPERTY_DECLARATION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CSS_CUSTOM_PROPERTY_DECLARATION.exec(body)) !== null) {
    if (match[1] !== undefined) names.add(match[1]);
  }
  return [...names];
};

export const extractCssClasses = (
  css: string,
  prefixes: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const body = stripThemeBlocks(css);
  const names = new Set<string>();
  for (const prefix of prefixes) {
    const pattern = new RegExp(`\\.(${prefix.replaceAll("-", "\\-")}[A-Za-z0-9_-]+)`, "g");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      if (match[1] !== undefined) names.add(match[1]);
    }
  }
  return [...names];
};

/**
 * A custom property declared twice in one file (`:root` plus `.dark`) is two
 * declarations and zero references, so the in-file test has to subtract the
 * declaration sites rather than just count occurrences.
 */
export const countCssSelfReferences = (css: string, name: string): number => {
  const escaped = name.replaceAll("-", "\\-");
  const occurrences = css.match(new RegExp(`${escaped}(?![A-Za-z0-9_-])`, "g"))?.length ?? 0;
  const declarations = css.match(new RegExp(`${escaped}(?![A-Za-z0-9_-])\\s*:`, "g"))?.length ?? 0;
  return occurrences - declarations;
};

const hasWordOccurrence = (content: string, token: string): boolean => {
  let from = 0;
  for (;;) {
    const at = content.indexOf(token, from);
    if (at === -1) return false;
    const before = at === 0 ? "" : content[at - 1];
    const after = content[at + token.length];
    const boundary = (character: string | undefined) =>
      character === undefined || !/[A-Za-z0-9_$-]/.test(character);
    if (boundary(before) && boundary(after)) return true;
    from = at + 1;
  }
};

export const findingKey = (finding: Pick<Finding, "kind" | "path" | "symbol">): string =>
  `${finding.kind}:${finding.path}:${finding.symbol}`;

const isDeclarationScope = (path: string, config: AnalyzeConfig): boolean => {
  if (!SCRIPT_FILE.test(path) || path.endsWith(".d.ts")) return false;
  if (isTestFile(path)) return false;
  if (config.declarationExcludes.some((prefix) => path.startsWith(prefix))) return false;
  return config.declarationRoots.some((prefix) => path.startsWith(prefix));
};

interface DeclarationSite {
  readonly fileIndex: number;
  readonly path: string;
  readonly isType: boolean;
}

const analyzeExports = (
  files: ReadonlyArray<SourceFile>,
  index: ReferenceIndex,
  config: AnalyzeConfig,
): ReadonlyArray<Finding> => {
  const sites = new Map<string, Array<DeclarationSite>>();
  for (const [fileIndex, file] of files.entries()) {
    if (!isDeclarationScope(file.path, config)) continue;
    for (const symbol of extractExportedSymbols(file.content)) {
      const existing = sites.get(symbol.name);
      const site = { fileIndex, path: file.path, isType: symbol.isType };
      if (existing === undefined) sites.set(symbol.name, [site]);
      else existing.push(site);
    }
  }

  const findings: Array<Finding> = [];
  for (const [name, declarations] of sites) {
    const referencing = index.get(name);
    if (referencing === undefined) continue;
    const declaringFiles = new Set(declarations.map((site) => site.fileIndex));
    const external = [...referencing].filter((fileIndex) => !declaringFiles.has(fileIndex));

    if (external.length === 0) {
      for (const site of declarations) {
        findings.push(
          site.isType
            ? {
                kind: "unused-exported-type",
                path: site.path,
                symbol: name,
                detail: "exported type, no reference outside its own file",
                severity: "report",
              }
            : {
                kind: "unused-export",
                path: site.path,
                symbol: name,
                detail: "exported value, no reference outside its own file",
                severity: "block",
              },
        );
      }
      continue;
    }

    if (external.every((fileIndex) => isTestFile(files[fileIndex]?.path ?? ""))) {
      for (const site of declarations) {
        findings.push({
          kind: "test-only-export",
          path: site.path,
          symbol: name,
          detail: `referenced only from ${external.length} test file${external.length === 1 ? "" : "s"}`,
          severity: "report",
        });
      }
    }
  }
  return findings;
};

const analyzeCss = (
  files: ReadonlyArray<SourceFile>,
  index: ReferenceIndex,
  config: AnalyzeConfig,
): ReadonlyArray<Finding> => {
  const findings: Array<Finding> = [];
  const owned = files
    .map((file, fileIndex) => ({ file, fileIndex }))
    .filter((entry) => config.cssFiles.includes(entry.file.path));
  if (owned.length === 0) return findings;

  const ownedIndices = new Set(owned.map((entry) => entry.fileIndex));

  // A class name assembled at runtime (`` `vide-${name}` ``) defeats a textual
  // scan entirely, so its presence downgrades every class finding to a note.
  const hasDynamicClassNames = config.cssClassPrefixes.some((prefix) =>
    files.some((file) => file.content.includes(`${prefix}\${`)),
  );

  for (const { file, fileIndex } of owned) {
    for (const name of extractCssCustomProperties(file.content)) {
      const referencing = index.get(name) ?? new Set<number>();
      const external = [...referencing].filter((candidate) => candidate !== fileIndex);
      if (external.length > 0) continue;
      if (countCssSelfReferences(file.content, name) > 0) continue;
      findings.push({
        kind: "unused-css-var",
        path: file.path,
        symbol: name,
        detail: `custom property, no ${name} reference anywhere`,
        severity: "block",
      });
    }

    for (const name of extractCssClasses(file.content, config.cssClassPrefixes)) {
      const referenced = files.some(
        (candidate, candidateIndex) =>
          !ownedIndices.has(candidateIndex) && hasWordOccurrence(candidate.content, name),
      );
      if (referenced) continue;
      findings.push({
        kind: "unused-css-class",
        path: file.path,
        symbol: name,
        detail: hasDynamicClassNames
          ? `class never referenced, but class names are built dynamically somewhere — verify by hand`
          : "class never referenced",
        severity: hasDynamicClassNames ? "report" : "block",
      });
    }
  }
  return findings;
};

export const compareFindings = (left: Finding, right: Finding): number =>
  findingKey(left).localeCompare(findingKey(right));

export const analyzeSources = (
  files: ReadonlyArray<SourceFile>,
  config: AnalyzeConfig = defaultAnalyzeConfig,
): ReadonlyArray<Finding> => {
  const index = buildReferenceIndex(files);
  return [...analyzeExports(files, index, config), ...analyzeCss(files, index, config)].toSorted(
    compareFindings,
  );
};
