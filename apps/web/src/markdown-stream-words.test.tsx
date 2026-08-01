import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vite-plus/test";

import { rehypeChatStreamWords, type ChatStreamWordTiming } from "./markdown-stream-words";

function timing(): ChatStreamWordTiming & { readonly counts: number[] } {
  const counts: number[] = [];
  return {
    styleOf: (index) => `--chat-stream-delay:${String(index * 10)}ms`,
    reportWordCount: (count) => counts.push(count),
    counts,
  };
}

function renderMarkdown(markdown: string, wordTiming: ChatStreamWordTiming): string {
  return renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeChatStreamWords, wordTiming]]}
    >
      {markdown}
    </ReactMarkdown>,
  );
}

describe("rehypeChatStreamWords", () => {
  it("gives every word its own element, styled by its index in the tree", () => {
    const html = renderMarkdown("one two three", timing());

    expect(html).toContain(
      '<span class="chat-stream-word" style="--chat-stream-delay:0ms">one</span>',
    );
    expect(html).toContain(
      '<span class="chat-stream-word" style="--chat-stream-delay:10ms">two</span>',
    );
    expect(html).toContain(
      '<span class="chat-stream-word" style="--chat-stream-delay:20ms">three</span>',
    );
  });

  it("keeps the spacing between words, so the text still wraps where it did", () => {
    const html = renderMarkdown("one two", timing());

    expect(html).toContain("</span> <span");
  });

  it("wraps a word at rest as a bare span, so a remounted row cannot animate it", () => {
    const html = renderMarkdown("one two", {
      styleOf: () => null,
      reportWordCount: () => {},
    });

    // Still wrapped (the tree keeps its shape for React), but carrying neither
    // the animated class nor a delay — a CSS animation fires on any first
    // paint, so a classed word would replay whenever its row remounts.
    expect(html).toContain("<span>one</span>");
    expect(html).not.toContain("chat-stream-word");
    expect(html).not.toContain("--chat-stream-delay");
  });

  it("wraps words inside emphasis without disturbing the emphasis itself", () => {
    const html = renderMarkdown("plain **bold words** after", timing());

    expect(html).toContain("<strong>");
    expect(html).toContain(
      '<span class="chat-stream-word" style="--chat-stream-delay:10ms">bold</span>',
    );
  });

  it("treats inline code as one word, so a chip arrives with its sentence", () => {
    const html = renderMarkdown("call `doTheThing(now)` twice", timing());

    // The chip is wrapped from the outside; its text stays whole for the
    // readers that pull it back out of the tree as a flat string.
    expect(html).toContain("<code>doTheThing(now)</code>");
    expect(html).toContain('style="--chat-stream-delay:10ms"><code>');
  });

  it("treats a link as one word, and leaves its label alone", () => {
    const html = renderMarkdown("see [the docs](https://example.com) now", timing());

    expect(html).toContain('<a href="https://example.com">the docs</a>');
    expect(html).toContain('style="--chat-stream-delay:10ms"><a');
    expect(html).toContain(
      '<span class="chat-stream-word" style="--chat-stream-delay:0ms">see</span>',
    );
  });

  it("leaves a fenced block alone", () => {
    const html = renderMarkdown("```ts\nconst value = 1;\n```", timing());

    expect(html).toContain("<code");
    expect(html).not.toContain('class="chat-stream-word"');
  });

  it("reports how many words the tree holds, counting a whole element as one", () => {
    const wordTiming = timing();
    renderMarkdown("call `code` and [docs](https://example.com) now", wordTiming);

    // call, `code`, and, [docs], now
    expect(wordTiming.counts.at(-1)).toBe(5);
  });
});
