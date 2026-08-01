import { describe, expect, it } from "vite-plus/test";

import {
  formatJsonPreview,
  parseDelimitedRows,
  resolveRichPreviewKind,
  resolveTableDelimiter,
} from "./reviewRichPreview";

describe("resolveRichPreviewKind", () => {
  it("maps the extensions each rendering can improve on", () => {
    expect(resolveRichPreviewKind("docs/README.md")).toBe("markdown");
    expect(resolveRichPreviewKind("a/b/notes.MDX")).toBe("markdown");
    expect(resolveRichPreviewKind("pkg/tsconfig.json")).toBe("json");
    expect(resolveRichPreviewKind("data/groups.csv")).toBe("table");
    expect(resolveRichPreviewKind("data/groups.tsv")).toBe("table");
  });

  it("returns null where the diff is already the best view", () => {
    expect(resolveRichPreviewKind("src/index.ts")).toBeNull();
    expect(resolveRichPreviewKind("Makefile")).toBeNull();
  });

  it("does not read a leading dot as an extension", () => {
    // ".md" is the whole name of a dotfile, not a Markdown document.
    expect(resolveRichPreviewKind(".md")).toBeNull();
    expect(resolveRichPreviewKind("some/dir/.json")).toBeNull();
  });

  it("ignores dots in directories above the file", () => {
    expect(resolveRichPreviewKind("v1.2.3/notes.md")).toBe("markdown");
    expect(resolveRichPreviewKind("v1.2.3/Makefile")).toBeNull();
  });
});

describe("resolveTableDelimiter", () => {
  it("uses a tab only for .tsv", () => {
    expect(resolveTableDelimiter("a.tsv")).toBe("\t");
    expect(resolveTableDelimiter("a.csv")).toBe(",");
  });
});

describe("parseDelimitedRows", () => {
  it("splits plain rows and fields", () => {
    expect(parseDelimitedRows("a,b\n1,2", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps delimiters and newlines inside quoted fields", () => {
    expect(parseDelimitedRows('"a,b",c\n"line\nbreak",d', ",")).toEqual([
      ["a,b", "c"],
      ["line\nbreak", "d"],
    ]);
  });

  it("reads a doubled quote as one literal quote", () => {
    expect(parseDelimitedRows('"say ""hi""",x', ",")).toEqual([['say "hi"', "x"]]);
  });

  it("tolerates CRLF", () => {
    expect(parseDelimitedRows("a,b\r\n1,2", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("closes a field left open by a truncated hunk instead of throwing", () => {
    expect(parseDelimitedRows('a,"unterminated', ",")).toEqual([["a", "unterminated"]]);
  });

  it("preserves empty trailing fields", () => {
    expect(parseDelimitedRows("a,,c", ",")).toEqual([["a", "", "c"]]);
  });

  it("returns nothing for empty input", () => {
    expect(parseDelimitedRows("", ",")).toEqual([]);
  });

  it("splits on tabs when asked to", () => {
    expect(parseDelimitedRows("a\tb", "\t")).toEqual([["a", "b"]]);
  });
});

describe("formatJsonPreview", () => {
  it("indents valid JSON", () => {
    expect(formatJsonPreview('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it("returns null for a fragment, so callers can fall back to the text", () => {
    expect(formatJsonPreview('"a": 1,')).toBeNull();
    expect(formatJsonPreview("   ")).toBeNull();
  });
});
