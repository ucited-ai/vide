/**
 * Wraps each word of streamed prose in its own element, so a word can animate
 * as it arrives.
 *
 * The walk itself is the only counter, and its job is only to number the
 * words: each one asks `styleOf` what is left of its wait, keyed by its index
 * in this tree — not in the markdown source, which also counts list markers,
 * emphasis asterisks and link urls that never render as words. An index that
 * drifts between renders would hand a word the arrival time of its neighbour,
 * so the numbering has to come from the same tree the reader sees.
 *
 * When each word arrives is not decided here (see `chatStreamReveal`): a word
 * is anchored to an instant the first time it is seen, and what this walk
 * writes onto it is the remaining delay, negative once that instant has
 * passed. So nothing here has to know when the text changed, or which words
 * are new.
 *
 * Runs after sanitisation — a plugin ordered before it would have its spans
 * stripped. Applied only while a message is still being written: once its
 * reveal has run out the wrappers are gone and the transcript is plain markup
 * again.
 */

interface HastNode {
  readonly type: string;
  readonly tagName?: string;
  readonly value?: unknown;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** The class the stylesheet animates. One word, one element. */
const STREAM_WORD_CLASS_NAME = "chat-stream-word";

/** The class a still-arriving block carries. The block reveals on its first
 * word's delay, growing from nothing instead of standing as reserved empty
 * height the words then fill — and it is the only thing that can carry a
 * `::marker` or a fence into the reveal, since neither is a text node. */
const STREAM_BLOCK_CLASS_NAME = "chat-stream-block";

/** A fence arrives as a block, not as words — revealing source word by word
 * would tear its lines apart, and its header is chrome rather than prose. */
const SKIPPED_TAGS = new Set(["pre"]);

/**
 * Prose blocks are deliberately not animated separately. Their words already
 * reveal on this clock; also fading/growing the parent runs a second entrance
 * over the same sentence and looks like a fast replay. A skipped block such as
 * a code fence still arrives as one unit because its contents are not wrapped.
 */

/**
 * Elements the reveal treats as one word. Their insides stay untouched —
 * `ChatMarkdown` reads a fence's source and a link's label back out of the
 * tree as flat strings — but the element itself arrives on the same clock as
 * the prose around it, instead of standing there before its sentence does.
 */
const WHOLE_TAGS = new Set(["code", "a"]);

export interface ChatStreamWordTiming {
  /**
   * Inline style for the word at this absolute tree index — the delay left of
   * its wait and the offset it travels in from — or null for a word whose
   * motion is over, which renders as bare markup.
   */
  readonly styleOf: (index: number) => string | null;
  /**
   * Inline style for a block whose first word sits at this absolute tree
   * index — the delay alone, no travel — or null for a block at rest.
   */
  readonly blockStyleOf: (index: number) => string | null;
}

/** Words as the source approximates them — pacing only, never a baseline. */
export function countStreamWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

export function rehypeChatStreamWords(timing: ChatStreamWordTiming) {
  return (tree: HastNode) => {
    let wordCount = 0;

    const wrapAsWord = (children: HastNode[]): HastNode => {
      const style = timing.styleOf(wordCount);
      wordCount += 1;
      return {
        type: "element",
        tagName: "span",
        /*
         * A word at rest is a bare span — wrapped, so the tree keeps its shape
         * for React, but carrying neither the class nor a delay. Most of a long
         * answer is at rest, so this is also what keeps the reveal cheap: only
         * the words still inside the window carry a style that changes from one
         * render to the next.
         */
        properties: style === null ? {} : { className: [STREAM_WORD_CLASS_NAME], style },
        children,
      };
    };

    /** Words and the gaps between them, in order, so spacing survives the wrap. */
    const splitIntoWords = (value: string): HastNode[] => {
      const nodes: HastNode[] = [];
      for (const part of value.split(/(\s+)/)) {
        if (part.length === 0) continue;
        if (/^\s+$/.test(part)) {
          nodes.push({ type: "text", value: part });
          continue;
        }
        nodes.push(wrapAsWord([{ type: "text", value: part }]));
      }
      return nodes;
    };

    /** A block at rest stays bare markup, exactly like a word at rest. */
    const stampBlock = (node: HastNode, firstWordIndex: number): void => {
      const style = timing.blockStyleOf(firstWordIndex);
      if (style === null) return;
      const properties = node.properties ?? (node.properties = {});
      const className = properties.className;
      properties.className = Array.isArray(className)
        ? [...className, STREAM_BLOCK_CLASS_NAME]
        : typeof className === "string"
          ? [className, STREAM_BLOCK_CLASS_NAME]
          : [STREAM_BLOCK_CLASS_NAME];
      properties.style =
        typeof properties.style === "string" && properties.style.length > 0
          ? `${properties.style};${style}`
          : style;
    };

    const wrapWords = (node: HastNode): void => {
      if (!node.children) return;

      node.children = node.children.flatMap((child) => {
        if (child.type === "text" && typeof child.value === "string") {
          return splitIntoWords(child.value);
        }
        if (child.type === "element" && child.tagName) {
          if (SKIPPED_TAGS.has(child.tagName)) {
            /* Untouched inside, but the fence itself still joins the clock:
               it takes one index so what follows it queues behind it. */
            stampBlock(child, wordCount);
            wordCount += 1;
            return [child];
          }
          if (WHOLE_TAGS.has(child.tagName)) {
            return [wrapAsWord([child])];
          }
        }
        wrapWords(child);
        return [child];
      });
    };

    wrapWords(tree);
  };
}
