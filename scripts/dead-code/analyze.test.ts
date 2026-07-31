import { assert, describe, it } from "@effect/vitest";

import {
  type AnalyzeConfig,
  type SourceFile,
  analyzeSources,
  buildReferenceIndex,
  countCssSelfReferences,
  extractCssClasses,
  extractCssCustomProperties,
  extractExportedSymbols,
  findingKey,
  isTestFile,
  stripThemeBlocks,
} from "./analyze.ts";

const config: AnalyzeConfig = {
  declarationRoots: ["src/"],
  declarationExcludes: ["src/vendor/"],
  cssFiles: ["src/theme.css"],
  cssClassPrefixes: ["vide-"],
};

const source = (path: string, content: string): SourceFile => ({ path, content });

const keysOf = (files: ReadonlyArray<SourceFile>) =>
  analyzeSources(files, config).map((finding) => findingKey(finding));

describe("dead-code/analyze", () => {
  it("indexes CSS custom properties as whole tokens and JS identifiers without hyphens", () => {
    const index = buildReferenceIndex([
      source("src/a.ts", "const total = count - offset;"),
      source("src/theme.css", ":root { --fixture-step-2: #fff; --fixture-step-20: #eee; }"),
    ]);

    assert.deepStrictEqual([...(index.get("count") ?? [])], [0]);
    assert.deepStrictEqual([...(index.get("offset") ?? [])], [0]);
    // `count - offset` must not become the single token `count-offset`.
    assert.isUndefined(index.get("count-offset"));
    // A longer property must not satisfy a lookup for the shorter one.
    assert.deepStrictEqual([...(index.get("--fixture-step-2") ?? [])], [1]);
    assert.deepStrictEqual([...(index.get("--fixture-step-20") ?? [])], [1]);
  });

  it("extracts every export form it claims to, and skips default exports", () => {
    const symbols = extractExportedSymbols(
      [
        "export const alpha = 1;",
        "export async function beta() {}",
        "export abstract class Gamma {}",
        "export declare const delta: number;",
        "export type Epsilon = string;",
        "export interface Zeta { a: number }",
        "export enum Eta { A }",
        "export { theta, iota as kappa, type Lambda };",
        "export default function ignored() {}",
        'export * from "./elsewhere.ts";',
        // Indented: reachable only as `Outer.inner`, so a bare-name reference scan
        // could not see its call sites. Top-level exports only, by design.
        "export namespace Outer {",
        "  export const inner = 1;",
        "}",
      ].join("\n"),
    );

    assert.deepStrictEqual(symbols.map((symbol) => symbol.name).toSorted(), [
      "Epsilon",
      "Eta",
      "Gamma",
      "Lambda",
      "Outer",
      "Zeta",
      "alpha",
      "beta",
      "delta",
      "kappa",
      "theta",
    ]);
    assert.deepStrictEqual(
      symbols
        .filter((symbol) => symbol.isType)
        .map((symbol) => symbol.name)
        .toSorted(),
      ["Epsilon", "Lambda", "Zeta"],
    );
  });

  it("reports an exported value nobody imports, and blocks on it", () => {
    const findings = analyzeSources(
      [
        source("src/a.ts", "export const orphan = 1;\nexport const used = 2;"),
        source("src/b.ts", "import { used } from './a.ts';\nconsole.log(used);"),
      ],
      config,
    );

    assert.deepStrictEqual(
      findings.map((finding) => `${finding.kind}:${finding.symbol}:${finding.severity}`),
      ["unused-export:orphan:block"],
    );
  });

  it("downgrades an unused exported type to a note, because it costs nothing at runtime", () => {
    const findings = analyzeSources([source("src/a.ts", "export type Orphan = string;")], config);

    assert.deepStrictEqual(
      findings.map((finding) => `${finding.kind}:${finding.severity}`),
      ["unused-exported-type:report"],
    );
  });

  it("separates a test-only export from a genuinely unused one", () => {
    const findings = analyzeSources(
      [
        source("src/a.ts", "export const seam = 1;"),
        source("src/a.test.ts", "import { seam } from './a.ts';\nseam;"),
      ],
      config,
    );

    assert.deepStrictEqual(
      findings.map((finding) => `${finding.kind}:${finding.severity}`),
      ["test-only-export:report"],
    );
  });

  it("keeps a symbol alive on any textual reference, including a string", () => {
    // Deliberate under-reporting: a registry lookup by name is real in this repo,
    // and a false positive in a blocking hook is worse than a miss.
    assert.deepStrictEqual(
      keysOf([
        source("src/a.ts", "export const handlerName = 1;"),
        source("src/registry.ts", "export const table = { handlerName: () => 1 };"),
      ]),
      ["unused-export:src/registry.ts:table"],
    );
  });

  it("does not scan declarations in tests, .d.ts files, or excluded paths", () => {
    assert.deepStrictEqual(
      keysOf([
        source("src/a.test.ts", "export const helper = 1;"),
        source("src/b.d.ts", "export declare const ambient: number;"),
        source("src/vendor/c.ts", "export const vendored = 1;"),
        source("elsewhere/d.ts", "export const outOfScope = 1;"),
      ]),
      [],
    );
  });

  it("treats @theme blocks as consumed, because Tailwind generates utilities from them", () => {
    const css = `@theme inline {\n  --fixture-font: system-ui;\n}\n:root { --fixture-ink: #000; }`;

    assert.notInclude(stripThemeBlocks(css), "--fixture-font");
    assert.deepStrictEqual(extractCssCustomProperties(css), ["--fixture-ink"]);
  });

  it("counts a property declared in both :root and .dark as two declarations, not a reference", () => {
    const css = ":root { --fixture-ink: #000; } .dark { --fixture-ink: #fff; }";

    assert.strictEqual(countCssSelfReferences(css, "--fixture-ink"), 0);
    assert.strictEqual(
      countCssSelfReferences(`${css} .x { color: var(--fixture-ink); }`, "--fixture-ink"),
      1,
    );
  });

  it("reports an unused custom property and keeps a Tailwind-arbitrary-value one alive", () => {
    const findings = analyzeSources(
      [
        source("src/theme.css", ":root { --fixture-dead: #000; --fixture-alive: #fff; }"),
        source("src/a.tsx", 'const cls = "bg-[var(--fixture-alive)]";'),
      ],
      config,
    );

    assert.deepStrictEqual(
      findings.map((finding) => `${finding.kind}:${finding.symbol}:${finding.severity}`),
      ["unused-css-var:--fixture-dead:block"],
    );
  });

  it("finds namespaced classes and downgrades them when class names are built dynamically", () => {
    const css = ".vide-fixture-slide { opacity: 1 }";
    assert.deepStrictEqual(extractCssClasses(css, ["vide-"]), ["vide-fixture-slide"]);

    const staticOnly = analyzeSources([source("src/theme.css", css)], config);
    assert.deepStrictEqual(
      staticOnly.map((finding) => `${finding.kind}:${finding.severity}`),
      ["unused-css-class:block"],
    );

    const dynamic = analyzeSources(
      [source("src/theme.css", css), source("src/a.tsx", "const cls = `vide-${name}`;")],
      config,
    );
    assert.deepStrictEqual(
      dynamic.map((finding) => `${finding.kind}:${finding.severity}`),
      ["unused-css-class:report"],
    );
  });

  it("recognises the test-file shapes this repo actually uses", () => {
    assert.isTrue(isTestFile("apps/web/src/a.test.tsx"));
    assert.isTrue(isTestFile("apps/web/src/a.spec.ts"));
    assert.isTrue(isTestFile("oxlint-plugin-vide/test/utils.ts"));
    assert.isTrue(isTestFile("src/__mocks__/thing.ts"));
    assert.isFalse(isTestFile("apps/web/src/latest.ts"));
  });
});
