import { describe, expect, it } from "vite-plus/test";

import { collectDeclarations, describeGap, findCoverageGaps } from "./coverage.ts";

const gapTokens = (upstream: string, theme: string) =>
  findCoverageGaps(collectDeclarations(upstream), collectDeclarations(theme)).map(
    (gap) => gap.token,
  );

describe("collectDeclarations", () => {
  it("pairs a declaration with the selector it sits under", () => {
    expect(collectDeclarations(`:root { --a: 1; }\n.dark { --a: 2; }`)).toEqual([
      { token: "a", selector: ":root", line: 1 },
      { token: "a", selector: ".dark", line: 2 },
    ]);
  });

  it("looks through an at-rule to the selector outside it", () => {
    const css = `@media (min-width: 40rem) {\n  :root {\n    --a: 1;\n  }\n}`;
    expect(collectDeclarations(css)).toEqual([{ token: "a", selector: ":root", line: 3 }]);
  });

  it("does not let a block comment run into the selector", () => {
    /* This is what hid --radius and every other token behind a prose comment. */
    const css = `/*\n * Why this block exists.\n */\n:root:root:root {\n  --a: 1;\n}`;
    expect(collectDeclarations(css)).toEqual([
      { token: "a", selector: ":root:root:root", line: 5 },
    ]);
  });

  it("keeps line numbers pointing at the declaration after stripping comments", () => {
    const css = `/*\n\n\n*/\n:root {\n  --a: 1;\n}`;
    expect(collectDeclarations(css)[0]?.line).toBe(6);
  });
});

describe("findCoverageGaps", () => {
  it("passes when the theme answers at root scope, however many times repeated", () => {
    expect(gapTokens(`:root { --a: 1; }`, `:root:root:root { --a: 2; }`)).toEqual([]);
  });

  it("reports a token the theme never answers", () => {
    expect(gapTokens(`:root { --a: 1; }`, `:root { --b: 2; }`)).toEqual(["a"]);
  });

  it("reports a token the theme answers only inside a subtree", () => {
    /*
     * The sidebar bug, reduced: upstream paints every consumer, the theme paints
     * the ones under its own attribute, and the difference is invisible in both
     * files because each value is correct where it stands.
     */
    const upstream = `:root { --sidebar-row-hover: zinc; }`;
    const theme = `:root:root:root [data-sidebar-version="v2"] { --sidebar-row-hover: wash; }`;
    const gaps = findCoverageGaps(collectDeclarations(upstream), collectDeclarations(theme));

    expect(gaps.map((gap) => gap.token)).toEqual(["sidebar-row-hover"]);
    expect(describeGap(gaps[0]!)).toContain('[data-sidebar-version="v2"]');
  });

  it("ignores what upstream itself scopes to a subtree", () => {
    expect(gapTokens(`[data-x] { --a: 1; }`, `:root { --b: 2; }`)).toEqual([]);
  });

  it("accepts a dark-only answer as root scope, since the light one is separate", () => {
    expect(gapTokens(`.dark { --a: 1; }`, `.dark.dark.dark { --a: 2; }`)).toEqual([]);
  });

  it("reports each token once, however often upstream repeats it", () => {
    expect(gapTokens(`:root { --a: 1; }\n.dark { --a: 2; }`, `:root { --b: 3; }`)).toEqual(["a"]);
  });
});
