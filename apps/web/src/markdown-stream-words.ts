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

/** The class a still-arriving block carries. The block reveals on its first
 * word's delay, growing from nothing instead of standing as reserved empty
 * height the words then fill — and it is the only thing that can carry a
 * `::marker` or a fence into the reveal, since neither is a text node. */
const STREAM_BLOCK_CLASS_NAME = "chat-stream-block";

/** A fence arrives as a block, not as words — revealing source word by word
 * would tear its lines apart, and its header is chrome rather than prose. */
const SKIPPED_TAGS = new Set(["pre"]);

/**
 * Blocks that reveal as a unit on their first word's clock. Lists and
 * blockquotes are absent on purpose: their `li`/`p` children stagger
 * individually, which reads as the writing continuing rather than a box
 * arriving.
 */
const BLOCK_TAGS = new Set(["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "table", "hr"]);

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
  /**
   * Inline style for a block whose first word sits at this absolute tree
   * index — the delay alone, no travel — or null for a block already at rest.
   * Same contract as `styleOf`: a stable answer per index while the reveal is
   * active, so a block's markup re-renders byte-identical.
   */
  readonly blockStyleOf: (index: number) => string | null;
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
          if (BLOCK_TAGS.has(child.tagName)) {
            const firstWordIndex = wordCount;
            wrapWords(child);
            stampBlock(child, firstWordIndex);
            return [child];
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
