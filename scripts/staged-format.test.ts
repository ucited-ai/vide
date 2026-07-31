import { assert, describe, it } from "@effect/vitest";

import { isNothingToFormatFailure } from "./staged-format.ts";

describe("staged-format", () => {
  it("treats oxfmt's empty-target failure as success", () => {
    // Verbatim from `vp fmt assets/brand/build-icons.py`, the failure that forced
    // --no-verify twice: a staged set with nothing oxfmt can format.
    assert.isTrue(
      isNothingToFormatFailure({
        exitCode: 1,
        stdout:
          "Expected at least one target file. All matched files may have been excluded by ignore rules.\n",
        stderr: "",
      }),
    );
  });

  it("propagates a real formatting failure", () => {
    assert.isFalse(
      isNothingToFormatFailure({
        exitCode: 2,
        stdout: "",
        stderr:
          "  x Unexpected token\nError occurred when checking code style in the above files.\n",
      }),
    );
  });

  it("never rewrites a successful run into a failure", () => {
    assert.isFalse(
      isNothingToFormatFailure({
        exitCode: 0,
        stdout: "Finished in 112ms on 1 files using 10 threads.\n",
        stderr: "",
      }),
    );
  });
});
