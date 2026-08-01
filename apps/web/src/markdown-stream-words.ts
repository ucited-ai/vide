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
 * What staggers them is a delay written onto each new word. The delay is why the
 * turn does not depend on how the provider delivers text: assistant streaming is
 * off by default, so a whole paragraph normally lands in one delta, and without a
 * clock of its own the reveal would be a single flash on every word at once.
 *
 * Runs after sanitisation — a plugin ordered before it would have its spans
 * stripped. Applied only while a message is still being written: once its reveal
 * has run out the wrappers are gone and the transcript is plain markup again.
 *
 * Code, and the text inside a link, are left whole. `ChatMarkdown` reads both
 * back out of the tree as flat strings (a fence's source, a link's label), and
 * splitting them would leave those readers holding elements instead of text.
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

const OPAQUE_TAGS = new Set(["code", "pre", "a"]);

export interface ChatStreamWordTiming {
  /**
   * Words already on screen before this render.
   *
   * They arrived, and animated, earlier — so they are wrapped exactly as before
   * (React keeps their DOM only if the markup matches) but carry no delay. A
   * delay that grew on a word already at rest would put it back inside its own
   * delay phase, where `animation-fill-mode: backwards` hides it: the word would
   * blink out because a later word arrived.
   */
  readonly revealedWordCount: number;
  /** Reveal delay of the nth word of this delta, in milliseconds. */
  readonly delayMsOf: (indexInDelta: number) => number;
  /** Where the nth word of this delta comes in from, for the variants that travel. */
  readonly offsetOf: (indexInDelta: number) => { readonly dx: string; readonly dy: string };
}

/** Words as the reveal counts them, so a delay can be handed out per word. */
export function countStreamWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

export function rehypeChatStreamWords(timing: ChatStreamWordTiming) {
  return (tree: HastNode) => {
    let wordCount = 0;

    const wordElement = (value: string): HastNode => {
      const indexInDelta = wordCount - timing.revealedWordCount;
      wordCount += 1;
      if (indexInDelta < 0) {
        return {
          type: "element",
          tagName: "span",
          properties: { className: [STREAM_WORD_CLASS_NAME] },
          children: [{ type: "text", value }],
        };
      }

      const offset = timing.offsetOf(indexInDelta);
      return {
        type: "element",
        tagName: "span",
        properties: {
          className: [STREAM_WORD_CLASS_NAME],
          style: [
            `--chat-stream-delay:${String(Math.round(timing.delayMsOf(indexInDelta)))}ms`,
            `--chat-stream-dx:${offset.dx}`,
            `--chat-stream-dy:${offset.dy}`,
          ].join(";"),
        },
        children: [{ type: "text", value }],
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
        nodes.push(wordElement(part));
      }
      return nodes;
    };

    const wrapWords = (node: HastNode): void => {
      if (!node.children) return;

      node.children = node.children.flatMap((child) => {
        if (child.type === "text" && typeof child.value === "string") {
          return splitIntoWords(child.value);
        }
        if (child.type === "element" && child.tagName && OPAQUE_TAGS.has(child.tagName)) {
          return [child];
        }
        wrapWords(child);
        return [child];
      });
    };

    wrapWords(tree);
  };
}
