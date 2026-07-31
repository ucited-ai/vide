import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type { Finding } from "./analyze.ts";
import {
  BASELINE_VERSION,
  type Baseline,
  classifyAgainstBaseline,
  loadBaseline,
  mergeBaseline,
  serializeBaseline,
} from "./baseline.ts";

const finding = (symbol: string): Finding => ({
  kind: "unused-export",
  path: "src/a.ts",
  symbol,
  detail: "exported value, no reference outside its own file",
  severity: "block",
});

const baselineWith = (findings: Record<string, string>): Baseline => ({
  version: BASELINE_VERSION,
  generatedAt: "2026-01-01",
  findings,
});

const test = it.layer(NodeServices.layer);

describe("dead-code/baseline", () => {
  it("splits findings into known, added, and fixed", () => {
    const classified = classifyAgainstBaseline(
      [finding("alpha"), finding("beta")],
      baselineWith({
        "unused-export:src/a.ts:alpha": "2026-01-01",
        "unused-export:src/a.ts:gone": "2025-06-01",
      }),
    );

    assert.deepStrictEqual(
      classified.known.map((entry) => [entry.finding.symbol, entry.since]),
      [["alpha", "2026-01-01"]],
    );
    assert.deepStrictEqual(
      classified.added.map((entry) => entry.symbol),
      ["beta"],
    );
    assert.deepStrictEqual(classified.fixed, ["unused-export:src/a.ts:gone"]);
  });

  it("preserves the original since date on merge, so ages stay honest", () => {
    const merged = mergeBaseline(
      [finding("alpha"), finding("beta")],
      baselineWith({ "unused-export:src/a.ts:alpha": "2025-03-04" }),
      "2026-07-30",
    );

    assert.deepStrictEqual(merged.findings, {
      "unused-export:src/a.ts:alpha": "2025-03-04",
      "unused-export:src/a.ts:beta": "2026-07-30",
    });
    assert.strictEqual(merged.generatedAt, "2026-07-30");
  });

  it("prunes entries that are no longer findings", () => {
    const merged = mergeBaseline(
      [finding("alpha")],
      baselineWith({
        "unused-export:src/a.ts:alpha": "2025-03-04",
        "unused-export:src/a.ts:removed": "2025-03-04",
      }),
      "2026-07-30",
    );

    assert.deepStrictEqual(Object.keys(merged.findings), ["unused-export:src/a.ts:alpha"]);
  });

  it("carries no line numbers in keys, so a reformat cannot churn the ledger", () => {
    const serialized = serializeBaseline(
      mergeBaseline([finding("alpha")], baselineWith({}), "2026-07-30"),
    );

    assert.include(serialized, '"unused-export:src/a.ts:alpha"');
    assert.notMatch(serialized, /:\d+:/);
    // Two-space JSON with a trailing newline is what oxfmt produces, so `vp fmt`
    // never rewrites the file it was just handed.
    assert.isTrue(serialized.endsWith("}\n"));
  });

  test("reports a missing baseline rather than failing", (it) => {
    it.effect("missing", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const loaded = yield* loadBaseline(path.join("does", "not", "exist.json"));
        assert.strictEqual(loaded._tag, "missing");
      }),
    );
  });

  test("reports a corrupt baseline rather than failing", (it) => {
    it.effect("corrupt", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "vide-dead-code-" });
        const file = path.join(directory, "baseline.json");

        yield* fs.writeFileString(file, "{ not json");
        const corrupt = yield* loadBaseline(file);
        assert.strictEqual(corrupt._tag, "unreadable");

        yield* fs.writeFileString(
          file,
          serializeBaseline({ version: 99, generatedAt: "2026-01-01", findings: {} }),
        );
        const wrongVersion = yield* loadBaseline(file);
        assert.strictEqual(wrongVersion._tag, "unreadable");

        yield* fs.writeFileString(file, serializeBaseline(baselineWith({})));
        const loaded = yield* loadBaseline(file);
        assert.strictEqual(loaded._tag, "loaded");
      }).pipe(Effect.scoped),
    );
  });
});
