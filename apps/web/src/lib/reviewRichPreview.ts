/**
 * Turning a file's new side back into a document.
 *
 * A diff answers "what changed"; for three kinds of file that is the wrong
 * question often enough to be worth a second view. A CSV's changed rows are
 * commas until they are a table, a minified or hand-edited JSON blob is a wall
 * until it is indented, and a Markdown table reads as pipes until it is a table.
 *
 * Everything here is pure and works off `FileDiffMetadata.additionLines`, which
 * Pierre documents as the new version of the file — complete when `isPartial`
 * is false, and restricted to the patch's hunks (context lines included) when it
 * is true. Callers must say which of those they have, because a preview that
 * silently shows two thirds of a document is worse than one that admits it.
 */

/** The three renderings, or `null` for a file that has no better form than its diff. */
export type RichPreviewKind = "markdown" | "json" | "table";

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);
const JSON_EXTENSIONS = new Set(["json", "jsonc", "json5"]);
const TABLE_EXTENSIONS = new Set(["csv", "tsv"]);

function readExtension(filePath: string): string {
  const name = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLocaleLowerCase();
}

export function resolveRichPreviewKind(filePath: string): RichPreviewKind | null {
  const extension = readExtension(filePath);
  if (MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
  if (JSON_EXTENSIONS.has(extension)) return "json";
  if (TABLE_EXTENSIONS.has(extension)) return "table";
  return null;
}

/** Tab for `.tsv`, comma for everything else this renders. */
export function resolveTableDelimiter(filePath: string): string {
  return readExtension(filePath) === "tsv" ? "\t" : ",";
}

/**
 * RFC 4180 enough for a preview: quoted fields may contain the delimiter, a
 * newline, or a doubled quote meaning one literal quote.
 *
 * Hand-rolled rather than pulled in, because the alternative is a dependency for
 * one read-only view, and the failure mode here is a cell rendered oddly — not
 * data loss. A row that ends mid-quote (which a partial patch produces routinely,
 * since a hunk can cut a multi-line field in half) closes at the end of input
 * instead of throwing.
 */
export function parseDelimitedRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = false;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Indented JSON, or `null` when the text does not parse.
 *
 * Null is the load-bearing case: a partial patch hands over a fragment of an
 * object, which is not JSON and never will be. Callers fall back to showing the
 * text rather than pretending the fragment is a document.
 */
export function formatJsonPreview(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}
