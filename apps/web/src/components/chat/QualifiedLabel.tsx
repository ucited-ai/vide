/*
 * A name and whatever qualifies it, told apart by ink.
 *
 * These pairs are everywhere in a transcript — a file inside a folder, a model
 * at a reasoning level — and they are read the same way every time: one half is
 * the thing being named and the other half only locates or grades it. Codex
 * separates them by ink rather than by size or punctuation, which is what lets
 * a long path stay scannable: the eye lands on the file name because it is the
 * only part in primary ink.
 *
 * One component so the split cannot drift between the surfaces that render it.
 */

import { splitWorkspaceRelativePath } from "../../filePathDisplay";

/** The receding half. Same step as the app's secondary ink, one notch softer. */
export const QUALIFIER_CLASS_NAME = "text-muted-foreground/70";

export function QualifiedLabel(props: {
  /** Muted text before the name — a file's folder, for instance. */
  readonly lead?: string | null | undefined;
  /** The thing being named, in primary ink. */
  readonly name: string;
  /** Muted text after the name — a line number, a count, a reasoning level. */
  readonly trail?: string | null | undefined;
  /** What sits between the name and its trail. A space unless the pair reads better punctuated. */
  readonly separator?: string;
}) {
  return (
    <>
      {props.lead ? <span className={QUALIFIER_CLASS_NAME}>{props.lead}</span> : null}
      <span className="text-foreground">{props.name}</span>
      {props.trail ? (
        <span className={QUALIFIER_CLASS_NAME}>
          {props.separator ?? " "}
          {props.trail}
        </span>
      ) : null}
    </>
  );
}

/**
 * A workspace-relative path, folder receding and file name in ink.
 *
 * The only place that turns a raw path into this pair, so every surface that
 * shows a file — a transcript row, a review comment, a tooltip — cuts it in the
 * same place and inks it the same way.
 */
export function FilePathLabel(props: {
  readonly path: string;
  readonly workspaceRoot: string | undefined;
}) {
  const { directory, fileName } = splitWorkspaceRelativePath(props.path, props.workspaceRoot);
  return <QualifiedLabel lead={directory} name={fileName} />;
}
