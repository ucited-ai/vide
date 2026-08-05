import { describe, expect, it } from "vite-plus/test";

import {
  chatStreamAdvanceMs,
  chatStreamArrivesAtMs,
  chatStreamStepMs,
  type ChatStreamRevealQueue,
} from "./chatStreamReveal";
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
  return /--chat-stream-delay:(-?\d+)ms/.exec(style)?.[1] ?? "none";
}

function queue(step: number): ChatStreamRevealQueue {
  return { arrivesAtByIndex: new Map(), headAtMs: 0, step };
}

describe("the clock the reveal runs on", () => {
  it("walks a paragraph at a readable pace", () => {
    const step = chatStreamStepMs(12, "assemble");
    const pending = queue(step);

    expect(step).toBe(40);
    // The first word of a delta does not wait: the head is behind us.
    expect(chatStreamArrivesAtMs(pending, 0, "assemble", 1_000)).toBe(1_000);
    const second = chatStreamArrivesAtMs(pending, 1, "assemble", 1_000);
    expect(second).toBeGreaterThan(1_000);
    expect(second).toBeLessThanOrEqual(1_000 + step * 1.25);
  });

  it("shrinks the step rather than making a long answer crawl in", () => {
    // A step per word is right for a paragraph and absurd for an essay: 800 words
    // at 40ms would be half a minute of text arriving.
    expect(chatStreamStepMs(800, "assemble")).toBeLessThan(chatStreamStepMs(12, "assemble"));

    const step = chatStreamStepMs(800, "assemble");
    const pending = queue(step);
    for (let index = 0; index < 800; index += 1) {
      chatStreamArrivesAtMs(pending, index, "assemble", 1_000);
    }
    expect(pending.headAtMs - 1_000).toBeLessThan(3_100);
  });

  it("compresses a delta that arrives behind one still sweeping", () => {
    // The budget covers the whole queue, so a backlog buys a smaller step
    // rather than pushing the sweep further into the future.
    expect(chatStreamStepMs(40, "assemble", 2_000)).toBeLessThan(chatStreamStepMs(40, "assemble"));
  });

  it("lands the phrase variant in groups of three", () => {
    const step = chatStreamStepMs(9, "phrase");
    const pending = queue(step);

    const first = chatStreamArrivesAtMs(pending, 0, "phrase", 1_000);
    expect(chatStreamArrivesAtMs(pending, 1, "phrase", 1_000)).toBe(first);
    expect(chatStreamArrivesAtMs(pending, 2, "phrase", 1_000)).toBe(first);
    expect(chatStreamArrivesAtMs(pending, 3, "phrase", 1_000)).toBeGreaterThan(first);
  });

  it("never hands a word an instant ahead of the word in front of it", () => {
    // What lets the head alone stand in for the whole queue: the jitter lives in
    // the spacing, so the sequence cannot fold back on itself.
    const step = chatStreamStepMs(20, "assemble");
    for (let index = 0; index < 20; index += 1) {
      expect(chatStreamAdvanceMs(index, index, step, "assemble")).toBeGreaterThan(0);
    }
  });

  it("answers the same index with the same instant, so a remount cannot replay it", () => {
    /*
     * The important one, and the whole reason arrival is anchored in wall-clock
     * time. A row the virtualized list remounts mid-answer asks again for words
     * it has already shown; handing them a fresh delay is what used to replay
     * the first sentence. Anchored, their remaining delay is simply negative.
     */
    const pending = queue(40);
    const firstPass = [0, 1, 2].map((index) =>
      chatStreamArrivesAtMs(pending, index, "fade", 1_000),
    );

    // Two seconds later — the row remounts and walks the same words again.
    const secondPass = [0, 1, 2].map((index) =>
      chatStreamArrivesAtMs(pending, index, "fade", 3_000),
    );

    expect(secondPass).toEqual(firstPass);
    expect(secondPass.every((at) => at - 3_000 < 0)).toBe(true);
  });

  it("queues a later delta behind the head instead of starting it at now", () => {
    const pending = queue(40);
    chatStreamArrivesAtMs(pending, 0, "fade", 1_000);
    chatStreamArrivesAtMs(pending, 1, "fade", 1_000);
    const headAfterFirstDelta = pending.headAtMs;

    // The next delta lands while the first is still sweeping.
    const next = chatStreamArrivesAtMs(pending, 2, "fade", 1_010);

    expect(next).toBeGreaterThan(headAfterFirstDelta);
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
    })(tree);

    expect(words(tree).map(delayOf)).toEqual(["0", "40", "80"]);
  });

  it("writes the delay still outstanding, negative once a word has arrived", () => {
    // A word mid-motion resumes where it was rather than starting over, which is
    // what a negative animation-delay means to CSS.
    const tree = paragraph("one two");
    rehypeChatStreamWords({
      styleOf: (index) => `--chat-stream-delay:${String(index * 40 - 200)}ms`,
      blockStyleOf: () => null,
    })(tree);

    expect(words(tree).map(delayOf)).toEqual(["-200", "-160"]);
  });

  it("leaves the words already at rest as bare markup", () => {
    /*
     * Most of a long answer is at rest, and a rested word carries neither the
     * animated class nor a delay — so the tree settles back to plain markup, and
     * only the words still inside the window re-render as the delay counts down.
     */
    const tree = paragraph("one two three four");
    rehypeChatStreamWords({
      styleOf: (index) => (index < 2 ? null : `--chat-stream-delay:${String((index - 2) * 40)}ms`),
      blockStyleOf: () => null,
    })(tree);

    const wrapped = words(tree);
    expect(wrapped).toHaveLength(4);
    expect(wrapped.map(delayOf)).toEqual(["none", "none", "0", "40"]);
    expect(wrapped[0]?.properties?.className).toBeUndefined();
  });

  it("keeps the gaps between words, and puts a chip on the same clock", () => {
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
    rehypeChatStreamWords({
      styleOf: () => null,
      blockStyleOf: () => null,
    })(tree);

    const children = tree.children?.[0]?.children ?? [];
    /* The chip is one word on the same clock — wrapped from the outside, its
       text left whole for the readers that pull it back out as a flat string. */
    const chip = children.find(
      (child) => child.type === "element" && child.children?.[0]?.tagName === "code",
    );
    expect(chip?.children?.[0]?.children).toEqual([{ type: "text", value: "vp test run" }]);
    expect(children.some((child) => child.type === "text" && child.value === " ")).toBe(true);
  });
});
