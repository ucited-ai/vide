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
 * Runs after sanitisation — a plugin ordered before it would have its spans
 * stripped. Applied only while a message is streaming: once it settles the
 * wrappers are gone and the transcript is plain markup again.
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

/**
 * Words are numbered around a short cycle so a variant can stagger within a
 * group rather than reveal everything the same instant. Providers send several
 * words per delta, which is what makes the stagger visible; a single-word delta
 * just carries a few milliseconds of delay nobody reads as one.
 */
const WORD_SLOT_COUNT = 3;

const OPAQUE_TAGS = new Set(["code", "pre", "a"]);

function wordElement(value: string, slot: number): HastNode {
  return {
    type: "element",
    tagName: "span",
    properties: {
      className: [STREAM_WORD_CLASS_NAME],
      "data-word-slot": String(slot),
    },
    children: [{ type: "text", value }],
  };
}

export function rehypeChatStreamWords() {
  return (tree: HastNode) => {
    let wordCount = 0;

    /** Words and the gaps between them, in order, so spacing survives the wrap. */
    const splitIntoWords = (value: string): HastNode[] => {
      const nodes: HastNode[] = [];
      for (const part of value.split(/(\s+)/)) {
        if (part.length === 0) continue;
        if (/^\s+$/.test(part)) {
          nodes.push({ type: "text", value: part });
          continue;
        }
        nodes.push(wordElement(part, wordCount % WORD_SLOT_COUNT));
        wordCount += 1;
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
