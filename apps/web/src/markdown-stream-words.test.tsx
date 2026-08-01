import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vite-plus/test";

import { rehypeChatStreamWords } from "./markdown-stream-words";

function renderMarkdown(markdown: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeChatStreamWords]}>
      {markdown}
    </ReactMarkdown>,
  );
}

describe("rehypeChatStreamWords", () => {
  it("gives every word its own element", () => {
    const html = renderMarkdown("one two three");

    expect(html).toContain('<span class="chat-stream-word" data-word-slot="0">one</span>');
    expect(html).toContain('<span class="chat-stream-word" data-word-slot="1">two</span>');
    expect(html).toContain('<span class="chat-stream-word" data-word-slot="2">three</span>');
  });

  it("keeps the spacing between words, so the text still wraps where it did", () => {
    const html = renderMarkdown("one two");

    expect(html).toContain("</span> <span");
  });

  it("numbers words around a short cycle rather than counting up forever", () => {
    const html = renderMarkdown("a b c d");

    expect(html).toContain('data-word-slot="0">a<');
    expect(html).toContain('data-word-slot="0">d<');
  });

  it("wraps words inside emphasis without disturbing the emphasis itself", () => {
    const html = renderMarkdown("plain **bold words** after");

    expect(html).toContain("<strong>");
    expect(html).toContain('<span class="chat-stream-word" data-word-slot="1">bold</span>');
  });

  it("leaves code alone, because its text is read back out whole", () => {
    const html = renderMarkdown("call `doTheThing(now)` twice");

    expect(html).toContain("<code>doTheThing(now)</code>");
  });

  it("leaves a fenced block alone", () => {
    const html = renderMarkdown("```ts\nconst value = 1;\n```");

    expect(html).toContain("<code");
    expect(html).not.toContain('class="chat-stream-word"');
  });

  it("leaves a link's label alone, because the link reads its own text", () => {
    const html = renderMarkdown("see [the docs](https://example.com) now");

    expect(html).toContain('<a href="https://example.com">the docs</a>');
    expect(html).toContain('<span class="chat-stream-word" data-word-slot="0">see</span>');
  });
});
