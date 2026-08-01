import type { FileDiffMetadata } from "@pierre/diffs/types";
import type { ScopedThreadRef } from "@vide/contracts";
import { memo, useMemo } from "react";

import {
  formatJsonPreview,
  parseDelimitedRows,
  resolveTableDelimiter,
  type RichPreviewKind,
} from "~/lib/reviewRichPreview";
import { cn } from "~/lib/utils";
import ChatMarkdown from "../ChatMarkdown";

/**
 * One file's new side, rendered as the document it is rather than as its diff.
 *
 * Reached only through the "Rich preview" option, and only for the extensions
 * `resolveRichPreviewKind` recognises. It deliberately shows no `+`/`−` gutter:
 * this view answers "what will this file read like", and the diff beside it
 * still answers "what moved". Trying to do both at once produced a rendered
 * document with change bars nailed to it, which reads as neither.
 */
export const ReviewRichPreview = memo(function ReviewRichPreview({
  kind,
  filePath,
  fileDiff,
  cwd,
  threadRef,
}: {
  kind: RichPreviewKind;
  filePath: string;
  fileDiff: FileDiffMetadata;
  cwd: string | null;
  threadRef: ScopedThreadRef | null;
}) {
  /*
   * `additionLines` is the new version of the file: complete when the diff was
   * generated from file contents, and limited to the patch's hunks — context
   * lines included — when it was parsed from a patch, which is what a review
   * always has. So a preview of an edited file shows the changed neighbourhoods
   * and says so; only a newly added file is whole, since its patch is the file.
   */
  const text = useMemo(() => fileDiff.additionLines.join("\n"), [fileDiff.additionLines]);
  const partial = fileDiff.isPartial && fileDiff.type !== "new";

  return (
    <div className="min-w-0">
      {partial ? (
        <p className="border-b border-(--panel-edge-muted) bg-(--panel-notice-surface) px-(--popup-item-padding-inline) py-1.5 text-(length:--text-caption) text-muted-foreground">
          Only the changed sections of this file are in the patch, so this preview shows those
          rather than the whole document.
        </p>
      ) : null}
      <div className="min-w-0 overflow-x-auto px-(--popup-item-padding-inline) py-2">
        <RichPreviewBody
          kind={kind}
          filePath={filePath}
          text={text}
          cwd={cwd}
          threadRef={threadRef}
        />
      </div>
    </div>
  );
});

function RichPreviewBody({
  kind,
  filePath,
  text,
  cwd,
  threadRef,
}: {
  kind: RichPreviewKind;
  filePath: string;
  text: string;
  cwd: string | null;
  threadRef: ScopedThreadRef | null;
}) {
  if (kind === "markdown") {
    return (
      <ChatMarkdown
        text={text}
        cwd={cwd ?? undefined}
        {...(threadRef ? { threadRef } : {})}
        className="max-w-(--review-prose-width)"
      />
    );
  }
  if (kind === "json") {
    return <JsonPreview text={text} />;
  }
  return <TablePreview text={text} filePath={filePath} />;
}

/** Indented when it parses; the raw text when the patch handed over a fragment. */
function JsonPreview({ text }: { text: string }) {
  const formatted = useMemo(() => formatJsonPreview(text), [text]);
  return (
    <pre className="min-w-0 font-mono text-(length:--code-font-size) leading-(--code-line-height) text-foreground">
      {formatted ?? text}
    </pre>
  );
}

const CELL_CLASS =
  "border border-(--panel-edge-muted) px-2 py-1 text-left align-top whitespace-pre-wrap";

/**
 * The first row is treated as the header, which is what a CSV in a repository
 * almost always is. When the patch starts mid-file that guess is wrong, but a
 * wrongly-styled first row costs a reader nothing — unlike a table with no
 * header at all, which costs them the column names.
 */
function TablePreview({ text, filePath }: { text: string; filePath: string }) {
  const rows = useMemo(
    () => parseDelimitedRows(text, resolveTableDelimiter(filePath)),
    [filePath, text],
  );
  const [header, ...body] = rows;
  if (!header) {
    return <p className="text-(length:--text-caption) text-muted-foreground">Nothing to render.</p>;
  }
  return (
    /* eslint-disable react/no-array-index-key -- a parsed table never reorders,
       so a cell's position is its identity; there is no other key to give. */
    <table className="w-max border-collapse text-(length:--text-caption)">
      <thead>
        <tr>
          {header.map((cell, index) => (
            <th key={index} scope="col" className={cn(CELL_CLASS, "font-medium text-foreground")}>
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {body.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, cellIndex) => (
              <td key={cellIndex} className={cn(CELL_CLASS, "text-muted-foreground")}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    /* eslint-enable react/no-array-index-key */
  );
}
