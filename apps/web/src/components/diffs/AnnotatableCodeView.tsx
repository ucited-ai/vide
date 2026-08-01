import type {
  AnnotationSide,
  DiffLineAnnotation,
  FileDiffMetadata,
  SelectedLineRange,
} from "@pierre/diffs";
import { FileDiff, type FileDiffProps } from "@pierre/diffs/react";
import type { ScopedThreadRef } from "@vide/contracts";
import {
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { exceedsInlineLineBudget } from "~/lib/diffLineBudget";
import {
  buildDiffReviewComment,
  restoreDiffReviewCommentRange,
  type ReviewCommentContext,
} from "~/reviewCommentContext";

import { LocalCommentAnnotation } from "../files/LocalCommentAnnotation";
import { nextFileCommentId } from "../files/fileCommentAnnotations";
import { ScrollSurface } from "../ui/scroll-surface";

/*
 * One file, one element, one plain scroll container.
 *
 * This used to be `CodeView`, which virtualises the file list itself. That is
 * where every scroll defect came from: to reserve space for a file it has not
 * rendered, it has to predict the file's height, and its model is
 * `lineCount × lineHeight` — one source line, one row. With word wrap on (the
 * default) a line is routinely three to twelve rows, measured at a mean 92px
 * against an assumed 20px, so the reserved space was ~6x short and the scroll
 * content grew ~30% under the user during a single flick. A minified payload
 * turns the same bug pathological: one line of a hundred-odd kilobytes is
 * reserved 20px, so the scroll box is already at its maximum while the content
 * is tens of thousands of pixels tall, and the panel simply stops responding.
 *
 * Nothing here predicts a height. The browser lays the files out, owns the
 * scrollbar, and does the momentum. What made that affordable is the ceiling on
 * the other side: the server truncates a review patch at
 * REVIEW_DIFF_PATCH_MAX_OUTPUT_BYTES (120KB), which is ~2000 diff rows in
 * total — an ordinary amount of DOM, not something that needs virtualising.
 *
 * `@pierre/diffs` keeps doing the hard part. `FileDiff` is its public
 * single-file component: it renders one `<diffs-container>`, owns no scroller,
 * and takes its options per instance — which is also what makes the minified
 * payload tractable, since `overflow` can now differ for one file.
 */

interface DiffCommentAnnotationEntry {
  id: string;
  kind: "draft" | "comment";
  range: SelectedLineRange;
  rangeLabel: string;
  text: string;
}

interface DiffCommentAnnotationGroup {
  entries: DiffCommentAnnotationEntry[];
}

type DiffCommentLineAnnotation = DiffLineAnnotation<DiffCommentAnnotationGroup>;
type DiffOptions = NonNullable<FileDiffProps<DiffCommentAnnotationGroup>["options"]>;

/** What `DiffPanel` still needs from the list: take me to that file. */
export interface AnnotatableCodeViewHandle {
  scrollToFile(fileKey: string): void;
}

const EMPTY_REVIEW_COMMENTS: ReadonlyArray<ReviewCommentContext> = [];
const EMPTY_ANNOTATIONS: DiffCommentLineAnnotation[] = [];

function annotationSide(range: SelectedLineRange): AnnotationSide {
  return (range.endSide ?? range.side) === "deletions" ? "deletions" : "additions";
}

function appendAnnotationEntry(
  annotations: ReadonlyArray<DiffCommentLineAnnotation>,
  range: SelectedLineRange,
  entry: DiffCommentAnnotationEntry,
): DiffCommentLineAnnotation[] {
  const side = annotationSide(range);
  const annotationIndex = annotations.findIndex(
    (annotation) => annotation.side === side && annotation.lineNumber === range.end,
  );
  if (annotationIndex < 0) {
    return [
      ...annotations,
      {
        side,
        lineNumber: range.end,
        metadata: { entries: [entry] },
      },
    ];
  }
  return annotations.map((annotation, index) =>
    index === annotationIndex
      ? {
          ...annotation,
          metadata: { entries: [...annotation.metadata.entries, entry] },
        }
      : annotation,
  );
}

interface AnnotatableCodeViewProps {
  /**
   * The files in the review. Deliberately free of per-file view state: which
   * diffs are open lives in `collapsedFileKeys` instead, so that opening one
   * does not hand this component a whole new file list and force it to redo the
   * comment work for every other file.
   */
  files: ReadonlyArray<{
    fileDiff: FileDiffMetadata;
    filePath: string;
    fileKey: string;
  }>;
  collapsedFileKeys: ReadonlySet<string>;
  sectionId: string;
  sectionTitle: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
  options: DiffOptions;
  viewerRef?: Ref<AnnotatableCodeViewHandle>;
  /** The scrolling element, for callers that need to observe it. */
  containerRef?: Ref<HTMLDivElement>;
  className?: string;
  renderHeaderPrefix: (
    fileDiff: FileDiffMetadata,
    fileKey: string,
    collapsed: boolean,
  ) => ReactNode;
}

export function AnnotatableCodeView({
  files,
  collapsedFileKeys,
  sectionId,
  sectionTitle,
  composerDraftTarget,
  options,
  viewerRef,
  containerRef,
  className,
  renderHeaderPrefix,
}: AnnotatableCodeViewProps) {
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const removeReviewComment = useComposerDraftStore((store) => store.removeReviewComment);
  const reviewComments = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.reviewComments ?? EMPTY_REVIEW_COMMENTS,
  );
  const [selectedLines, setSelectedLines] = useState<{
    fileKey: string;
    range: SelectedLineRange;
  } | null>(null);
  const [draft, setDraft] = useState<{
    fileKey: string;
    annotation: DiffCommentLineAnnotation;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileElementsRef = useRef(new Map<string, HTMLElement>());

  const filesByKey = useMemo(() => new Map(files.map((file) => [file.fileKey, file])), [files]);
  /*
   * The expensive half, kept off the collapse path.
   *
   * Restoring a saved comment's range calls `buildDiffReviewLines`, which walks
   * the file's entire diff — so this is O(files x comments x diff size). None of
   * it depends on which diffs are open, and it used to rerun on every expand and
   * collapse because the collapsed flag travelled inside the file list. Hoisting
   * it into its own map means a toggle now only re-assembles item objects.
   */
  const persistedAnnotationsByFileKey = useMemo(() => {
    const byFileKey = new Map<string, DiffCommentLineAnnotation[]>();
    for (const { fileDiff, filePath, fileKey } of files) {
      byFileKey.set(
        fileKey,
        reviewComments
          .filter(
            (comment) =>
              comment.sectionId === sectionId &&
              comment.filePath === filePath &&
              (comment.fenceLanguage ?? "diff") === "diff",
          )
          .reduce<DiffCommentLineAnnotation[]>((annotations, comment) => {
            const range = restoreDiffReviewCommentRange(fileDiff, comment);
            if (!range) return annotations;
            return appendAnnotationEntry(annotations, range, {
              id: comment.id,
              kind: "comment",
              range,
              rangeLabel: comment.rangeLabel,
              text: comment.text,
            });
          }, []),
      );
    }
    return byFileKey;
  }, [files, reviewComments, sectionId]);

  /*
   * Which files may not wrap.
   *
   * A wrapped line of a hundred kilobytes is a single element thousands of rows
   * tall; unwrapped it is one row that scrolls sideways. Nothing else about the
   * file changes, so this is a rendering decision, not a truncation — the file
   * is still all there.
   */
  const noWrapFileKeys = useMemo(() => {
    if (options.overflow !== "wrap") return new Set<string>();
    return new Set(
      files.filter(({ fileDiff }) => exceedsInlineLineBudget(fileDiff)).map((file) => file.fileKey),
    );
  }, [files, options.overflow]);

  const removeEntry = useCallback(
    (entryId: string) => {
      setSelectedLines(null);
      if (draft?.annotation.metadata.entries.some((entry) => entry.id === entryId)) {
        setDraft(null);
      } else {
        removeReviewComment(composerDraftTarget, entryId);
      }
    },
    [composerDraftTarget, draft, removeReviewComment],
  );

  const submitEntry = useCallback(
    (entryId: string, text: string) => {
      const entry = draft?.annotation.metadata.entries.find(
        (candidate) => candidate.id === entryId,
      );
      const file = draft ? filesByKey.get(draft.fileKey) : undefined;
      if (!entry || !file) return;
      const comment = buildDiffReviewComment({
        id: entry.id,
        sectionId,
        sectionTitle,
        filePath: file.filePath,
        fileDiff: file.fileDiff,
        range: entry.range,
        text,
      });
      if (comment) addReviewComment(composerDraftTarget, comment);
      setSelectedLines(null);
      setDraft(null);
    },
    [addReviewComment, composerDraftTarget, draft, filesByKey, sectionId, sectionTitle],
  );

  const beginComment = useCallback(
    (fileKey: string, range: SelectedLineRange | null) => {
      if (!range) return;
      const file = filesByKey.get(fileKey);
      if (!file) return;
      const id = nextFileCommentId();
      const comment = buildDiffReviewComment({
        id,
        sectionId,
        sectionTitle,
        filePath: file.filePath,
        fileDiff: file.fileDiff,
        range,
        text: "",
      });
      if (!comment) return;
      setDraft({
        fileKey,
        annotation: {
          side: annotationSide(range),
          lineNumber: range.end,
          metadata: {
            entries: [{ id, kind: "draft", range, rangeLabel: comment.rangeLabel, text: "" }],
          },
        },
      });
    },
    [filesByKey, sectionId, sectionTitle],
  );

  useImperativeHandle(
    viewerRef,
    () => ({
      scrollToFile(fileKey) {
        const element = fileElementsRef.current.get(fileKey);
        const scroller = scrollRef.current;
        if (!element || !scroller) return;
        // Relative to the scroller rather than `scrollIntoView`, which would
        // also scroll every ancestor and can drag the whole panel around.
        const top =
          element.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop;
        scroller.scrollTo({ top, behavior: "auto" });
      },
    }),
    [],
  );

  const setScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node;
      if (typeof containerRef === "function") containerRef(node);
      else if (containerRef != null) containerRef.current = node;
    },
    [containerRef],
  );

  const hasOpenComment = draft !== null;
  return (
    /* Browser scroll anchoring left on: nothing re-anchors in JavaScript any
       more, so expanding a file above the viewport should keep your place, and
       that is exactly the job the browser already does. */
    <ScrollSurface axis="both" ref={setScrollRef} className={className}>
      {files.map(({ fileDiff, fileKey }) => {
        const persisted = persistedAnnotationsByFileKey.get(fileKey) ?? EMPTY_ANNOTATIONS;
        const annotations =
          draft?.fileKey === fileKey ? [...persisted, draft.annotation] : persisted;
        const collapsed = collapsedFileKeys.has(fileKey);
        return (
          /* The wrapper exists only so the list can find a file to scroll to;
             `FileDiff` renders a custom element and takes no ref. */
          <div
            key={fileKey}
            data-review-file-key={fileKey}
            ref={(node) => {
              if (node) fileElementsRef.current.set(fileKey, node);
              else fileElementsRef.current.delete(fileKey);
            }}
          >
            <FileDiff<DiffCommentAnnotationGroup>
              fileDiff={fileDiff}
              lineAnnotations={annotations}
              selectedLines={selectedLines?.fileKey === fileKey ? selectedLines.range : null}
              options={{
                ...options,
                ...(noWrapFileKeys.has(fileKey) ? { overflow: "scroll" as const } : {}),
                collapsed,
                // `controlledSelection` is not set here: passing the
                // `selectedLines` prop at all is what puts the instance into
                // controlled mode, and the hook owns that decision.
                enableGutterUtility: !hasOpenComment,
                enableLineSelection: !hasOpenComment,
                onLineSelectionChange: (range) =>
                  setSelectedLines(range ? { fileKey, range } : null),
                onLineSelectionEnd: (range) => beginComment(fileKey, range),
              }}
              renderHeaderPrefix={() => renderHeaderPrefix(fileDiff, fileKey, collapsed)}
              renderAnnotation={(annotation) => (
                <div className="py-1">
                  {annotation.metadata.entries.map((entry) => (
                    <LocalCommentAnnotation
                      key={entry.id}
                      kind={entry.kind}
                      rangeLabel={entry.rangeLabel}
                      text={entry.text}
                      onCancel={() => removeEntry(entry.id)}
                      onComment={(text) => submitEntry(entry.id, text)}
                      onDelete={() => removeEntry(entry.id)}
                    />
                  ))}
                </div>
              )}
            />
          </div>
        );
      })}
    </ScrollSurface>
  );
}
