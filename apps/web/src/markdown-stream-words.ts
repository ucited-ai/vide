/**
 * Wraps each word of streamed prose in its own element, so a word can animate
 * as it arrives.
 *
 * Why the reveal is per element rather than per timer: a CSS animation runs
 * once, when the element it is on is first painted. Words already on screen
 * keep their DOM nodes across a re-render, so they stay put; only the elements
 * created by the newest delta animate. Nothing has to know when the text
 * changed, and nothing replays when the message re-renders for an unrelated
 * reason.
 *
 * The walk itself is the only counter. Each word asks `styleOf` for the style
 * it was born with, keyed by its index in this tree — not in the markdown
 * source, which also counts list markers, emphasis asterisks and link urls
 * that never render as words. A baseline measured against the source drifts,
 * and a drifted baseline hands fresh delays to words already on screen, which
 * `animation-fill-mode: backwards` answers by blinking them out.
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

/** A fence arrives as a block, not as words — revealing source word by word
 * would tear its lines apart, and its header is chrome rather than prose. */
const SKIPPED_TAGS = new Set(["pre"]);

/**
 * Elements the reveal treats as one word. Their insides stay untouched —
 * `ChatMarkdown` reads a fence's source and a link's label back out of the
 * tree as flat strings — but the element itself arrives on the same clock as
 * the prose around it, instead of standing there before its sentence does.
 */
const WHOLE_TAGS = new Set(["code", "a"]);

export interface ChatStreamWordTiming {
  /**
   * Inline style for the word at this absolute tree index — the delay that
   * staggers it and the offset it travels in from — or null for a word that is
   * already at rest. Must answer the same index with the same style for as
   * long as the reveal is active: a word whose markup re-renders byte-identical
   * keeps its DOM node, and with it the animation that already ran.
   */
  readonly styleOf: (index: number) => string | null;
  /** Handed the tree's word count after the walk: the next delta's baseline. */
  readonly reportWordCount: (count: number) => void;
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
         * for React, but carrying neither the class nor a delay. The class is
         * what the variant selectors animate, and a CSS animation fires on any
         * first paint: a remounted row would replay every classed word.
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

    const wrapWords = (node: HastNode): void => {
      if (!node.children) return;

      node.children = node.children.flatMap((child) => {
        if (child.type === "text" && typeof child.value === "string") {
          return splitIntoWords(child.value);
        }
        if (child.type === "element" && child.tagName) {
          if (SKIPPED_TAGS.has(child.tagName)) {
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
    timing.reportWordCount(wordCount);
  };
}
