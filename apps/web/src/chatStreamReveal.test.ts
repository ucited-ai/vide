import { describe, expect, it } from "vite-plus/test";

import { chatStreamDelayMs, chatStreamRevealMs, chatStreamStepMs } from "./chatStreamReveal";
import { countStreamWords, rehypeChatStreamWords } from "./markdown-stream-words";

interface TestNode {
  type: string;
  tagName?: string;
  value?: unknown;
  properties?: Record<string, unknown>;
  children?: TestNode[];
}

function paragraph(text: string): TestNode {
  return {
    type: "root",
    children: [{ type: "element", tagName: "p", children: [{ type: "text", value: text }] }],
  };
}

function words(tree: TestNode): TestNode[] {
  return (tree.children?.[0]?.children ?? []).filter((child) => child.type === "element");
}

function delayOf(word: TestNode): string {
  const style = String(word.properties?.style ?? "");
  return /--chat-stream-delay:(\d+)ms/.exec(style)?.[1] ?? "none";
}

describe("the clock the reveal runs on", () => {
  it("walks a paragraph at a readable pace", () => {
    const step = chatStreamStepMs(12, "assemble");

    expect(step).toBe(40);
    expect(chatStreamDelayMs(0, step, "assemble")).toBeLessThan(step);
    expect(chatStreamDelayMs(5, step, "assemble")).toBeGreaterThan(
      chatStreamDelayMs(4, step, "assemble"),
    );
  });

  it("shrinks the step rather than making a long answer crawl in", () => {
    // A step per word is right for a paragraph and absurd for an essay: 800 words
    // at 40ms would be half a minute of text arriving.
    expect(chatStreamRevealMs(12, "assemble")).toBeLessThan(2_000);
    expect(chatStreamRevealMs(800, "assemble")).toBeLessThan(4_000);
    expect(chatStreamStepMs(800, "assemble")).toBeLessThan(chatStreamStepMs(12, "assemble"));
  });

  it("lands the phrase variant in groups of three", () => {
    const step = chatStreamStepMs(9, "phrase");

    expect(chatStreamDelayMs(0, step, "phrase")).toBe(chatStreamDelayMs(2, step, "phrase"));
    expect(chatStreamDelayMs(3, step, "phrase")).toBeGreaterThan(
      chatStreamDelayMs(2, step, "phrase"),
    );
  });

  it("is a function of the word alone, so the same word always arrives the same way", () => {
    const step = chatStreamStepMs(20, "assemble");

    expect(chatStreamDelayMs(7, step, "assemble")).toBe(chatStreamDelayMs(7, step, "assemble"));
  });

  it("counts words the way the wrapper does", () => {
    expect(countStreamWords("one  two\nthree ")).toBe(3);
    expect(countStreamWords("   ")).toBe(0);
  });
});

describe("wrapping words for the reveal", () => {
  it("gives every word of a fresh message its own delay, by tree index", () => {
    const tree = paragraph("one two three");
    rehypeChatStreamWords({
      styleOf: (index) => `--chat-stream-delay:${String(index * 40)}ms`,
      blockStyleOf: () => null,
      reportWordCount: () => {},
    })(tree);

    expect(words(tree).map(delayOf)).toEqual(["0", "40", "80"]);
  });

  it("leaves the words already on screen alone", () => {
    /*
     * The important one. A word at rest that is handed a *larger* delay drops back
     * inside it, and `animation-fill-mode: backwards` hides it there — so a word
     * would blink out because a later word arrived. Words the clock answers with
     * null carry no style at all, and stay wrapped so React keeps their DOM.
     */
    const tree = paragraph("one two three four");
    rehypeChatStreamWords({
      styleOf: (index) => (index < 2 ? null : `--chat-stream-delay:${String((index - 2) * 40)}ms`),
      blockStyleOf: () => null,
      reportWordCount: () => {},
    })(tree);

    const wrapped = words(tree);
    expect(wrapped).toHaveLength(4);
    expect(wrapped.map(delayOf)).toEqual(["none", "none", "0", "40"]);
    expect(
      wrapped.every((word) => String(word.properties?.className).includes("chat-stream-word")),
    );
  });

  it("keeps the gaps between words, and reports the tree's own word count", () => {
    const tree: TestNode = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          children: [
            { type: "text", value: "call " },
            {
              type: "element",
              tagName: "code",
              children: [{ type: "text", value: "vp test run" }],
            },
            { type: "text", value: " twice" },
          ],
        },
      ],
    };
    const counts: number[] = [];
    rehypeChatStreamWords({
      styleOf: () => null,
      blockStyleOf: () => null,
      reportWordCount: (count) => counts.push(count),
    })(tree);

    const children = tree.children?.[0]?.children ?? [];
    /* The chip is one word on the same clock — wrapped from the outside, its
       text left whole for the readers that pull it back out as a flat string. */
    const chip = children.find(
      (child) => child.type === "element" && child.children?.[0]?.tagName === "code",
    );
    expect(chip?.children?.[0]?.children).toEqual([{ type: "text", value: "vp test run" }]);
    expect(children.some((child) => child.type === "text" && child.value === " ")).toBe(true);
    expect(counts).toEqual([3]);
  });
});
