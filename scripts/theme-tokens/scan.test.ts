import { describe, expect, it } from "vite-plus/test";

import {
  type Exemption,
  type ScanConfig,
  type SourceFile,
  defaultScanConfig,
  findingKey,
  scanFile,
  scanSources,
} from "./scan.ts";

const config: ScanConfig = {
  roots: ["apps/web/src/"],
  exemptRoots: ["apps/web/src/injected/"],
  exemptPaths: new Map<string, Exemption>([
    ["apps/web/src/vide-theme.css", "all"],
    ["apps/web/src/derived.css", ["raw-color"]],
  ]),
  exemptSuffixes: [".test.tsx"],
};

const file = (path: string, content: string): SourceFile => ({ path, content });

const values = (path: string, content: string) =>
  scanFile(file(path, content), config).map((finding) => finding.value);

describe("hardcoded text sizes", () => {
  it("reports Tailwind's size steps and arbitrary pixels", () => {
    expect(values("apps/web/src/a.tsx", `<p className="text-sm" />`)).toEqual(["text-sm"]);
    expect(values("apps/web/src/a.tsx", `<p className="px-2 text-[11px] font-medium" />`)).toEqual([
      "text-[11px]",
    ]);
  });

  it("reports arbitrary sizes in any unit, including a leading dot", () => {
    expect(values("apps/web/src/a.tsx", `<p className="sm:text-[.625rem]" />`)).toEqual([
      "text-[.625rem]",
    ]);
    expect(values("apps/web/src/a.tsx", `<p className="text-[1.25em]" />`)).toEqual([
      "text-[1.25em]",
    ]);
  });

  it("leaves the role tokens alone", () => {
    expect(values("apps/web/src/a.tsx", `<p className="text-(length:--text-ui)" />`)).toEqual([]);
    expect(values("apps/web/src/a.tsx", `<p className="text-[length:var(--text-ui)]" />`)).toEqual(
      [],
    );
  });

  it("does not mistake a token declaration for a class", () => {
    expect(values("apps/web/src/a.tsx", `const x = "--text-base-ui";`)).toEqual([]);
  });

  it("leaves display copy alone", () => {
    expect(values("apps/web/src/a.tsx", `<h1 className="text-2xl sm:text-3xl" />`)).toEqual([]);
  });

  it("does not look for classes inside stylesheets", () => {
    expect(values("apps/web/src/a.css", `.x { color: inherit } /* text-sm */`)).toEqual([]);
  });

  it("counts repeats in one file under a single entry", () => {
    const found = scanFile(file("apps/web/src/a.tsx", `"text-xs" "text-xs" "text-xs"`), config);
    expect(found).toHaveLength(1);
    expect(found[0]?.count).toBe(3);
  });
});

describe("raw colours", () => {
  it("reports hex literals of every length", () => {
    expect(values("apps/web/src/a.tsx", `style={{ color: "#fff" }}`)).toEqual(["#fff"]);
    expect(values("apps/web/src/a.tsx", `style={{ color: "#1b1c20" }}`)).toEqual(["#1b1c20"]);
    expect(values("apps/web/src/a.tsx", `style={{ color: "#1b1c2080" }}`)).toEqual(["#1b1c2080"]);
  });

  it("reports functional colours with literal channels", () => {
    expect(values("apps/web/src/a.tsx", `"rgb(0 0 0 / 9%)"`)).toEqual(["rgb(0 0 0 / 9%)"]);
    expect(values("apps/web/src/a.css", `.x { color: oklch(99.2% 0 0) }`)).toEqual([
      "oklch(99.2% 0 0)",
    ]);
  });

  it("leaves the runtime that assembles a colour alone", () => {
    expect(values("apps/web/src/a.tsx", "`rgb(${red} ${green} ${blue})`")).toEqual([]);
  });

  it("leaves a mix from the ladder alone", () => {
    expect(
      values("apps/web/src/a.css", `.x { background: color-mix(in srgb, var(--ink) 4%) }`),
    ).toEqual([]);
  });

  it("does not read a URL fragment as a colour", () => {
    expect(values("apps/web/src/a.tsx", `href="/docs#abc"`)).toEqual([]);
  });

  it("does not read the front of a longer identifier as a colour", () => {
    expect(values("apps/web/src/a.tsx", `const id = "#backend-child";`)).toEqual([]);
  });
});

describe("raw font sizes", () => {
  it("reports a size declared in a stylesheet", () => {
    expect(values("apps/web/src/a.css", `.x { font-size: 1.25rem }`)).toEqual(["1.25rem"]);
    expect(values("apps/web/src/a.css", `.x { font-size: 13px }`)).toEqual(["13px"]);
  });

  it("reports a size handed to a canvas from TypeScript", () => {
    expect(values("apps/web/src/a.ts", `new Terminal({ fontSize: 12 })`)).toEqual(["12"]);
  });

  it("leaves a role token alone", () => {
    expect(values("apps/web/src/a.css", `.x { font-size: var(--text-ui) }`)).toEqual([]);
  });

  it("leaves em and percent alone — both follow the inherited size", () => {
    expect(values("apps/web/src/a.css", `.x { font-size: 1.375em }`)).toEqual([]);
    expect(values("apps/web/src/a.css", `.x { font-size: 0.965em }`)).toEqual([]);
    expect(values("apps/web/src/a.css", `.x { font-size: 100% }`)).toEqual([]);
  });
});

describe("scope", () => {
  it("ignores files outside the scanned roots", () => {
    expect(values("apps/server/src/a.ts", `"#ffffff"`)).toEqual([]);
  });

  it("ignores a root that cannot reach the stylesheet at all", () => {
    expect(values("apps/web/src/injected/overlay.ts", `"#ffffff"`)).toEqual([]);
  });

  it("ignores the theme itself — that is where these values belong", () => {
    expect(values("apps/web/src/vide-theme.css", `--ink: #17171a;`)).toEqual([]);
  });

  it("ignores tests, which assert colours rather than style with them", () => {
    expect(values("apps/web/src/a.test.tsx", `expect(x).toBe("#17171a")`)).toEqual([]);
  });

  it("excuses a file from one kind without excusing it from the others", () => {
    /* The blanket version of this exemption is how ten font-size declarations
       hid inside a stylesheet that was excused for its colours. */
    expect(values("apps/web/src/derived.css", `.x { color: #fff }`)).toEqual([]);
    expect(values("apps/web/src/derived.css", `.x { font-size: 12px }`)).toEqual(["12px"]);
  });

  it("exempts brand marks by default", () => {
    expect(
      scanFile(file("apps/web/src/components/JetBrainsIcons.tsx", `fill="#087cfa"`), {
        ...defaultScanConfig,
      }),
    ).toEqual([]);
  });
});

describe("keys", () => {
  it("carries no line number, so edits above a finding do not churn the ledger", () => {
    const early = scanFile(file("apps/web/src/a.tsx", `"text-sm"`), config)[0];
    const late = scanFile(file("apps/web/src/a.tsx", `\n\n\n"text-sm"`), config)[0];
    expect(early).toBeDefined();
    expect(late).toBeDefined();
    expect(late?.line).toBe(4);
    expect(findingKey(early!)).toBe(findingKey(late!));
  });

  it("sorts by path so a report reads in file order", () => {
    const found = scanSources(
      [file("apps/web/src/b.tsx", `"text-sm"`), file("apps/web/src/a.tsx", `"text-xs"`)],
      config,
    );
    expect(found.map((finding) => finding.path)).toEqual([
      "apps/web/src/a.tsx",
      "apps/web/src/b.tsx",
    ]);
  });
});
