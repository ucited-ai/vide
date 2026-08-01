/*
 * The stylesheet is read off disk rather than imported: the test runner hands
 * back an empty string for a CSS import, and an assertion against "" passes
 * nothing it claims to.
 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

import {
  ChatChangedFilesLayout,
  ChatStreamAnimation,
  ChatThinkingIndicator,
} from "@vide/contracts/settings";
import { describe, expect, it } from "vite-plus/test";

import {
  CHAT_CHANGED_FILES_LAYOUTS,
  CHAT_STREAM_ANIMATIONS,
  CHAT_THINKING_INDICATORS,
  chatChangedFilesLayoutStyle,
  chatThinkingIndicatorPainter,
} from "./chatAppearance";

describe("chat appearance registries", () => {
  it.each([
    { name: "streaming text", options: CHAT_STREAM_ANIMATIONS, ids: ChatStreamAnimation.literals },
    {
      name: "thinking indicator",
      options: CHAT_THINKING_INDICATORS,
      ids: ChatThinkingIndicator.literals,
    },
    {
      name: "changed files",
      options: CHAT_CHANGED_FILES_LAYOUTS,
      ids: ChatChangedFilesLayout.literals,
    },
  ])("offers every $name variant the contract declares, in that order", ({ options, ids }) => {
    expect(options.map((option) => option.id)).toEqual([...ids]);
    for (const option of options) {
      expect(option.label.length).toBeGreaterThan(0);
    }
  });
});

/*
 * The one edge no type can watch.
 *
 * A streaming variant's motion is a rule in the stylesheet, so a variant added
 * to the contract and the registry compiles, appears in the picker, and does
 * nothing at all. Reading the stylesheet is the only way that failure can be
 * anything other than a bug report from someone who chose it.
 */
describe("streaming variants are backed by the stylesheet", () => {
  const theme = NodeFS.readFileSync(
    NodeURL.fileURLToPath(import.meta.resolve("../../vide-theme.css")),
    "utf8",
  );
  const animated = ChatStreamAnimation.literals.filter((variant) => variant !== "instant");

  it("read the stylesheet it is asserting against", () => {
    expect(theme.length).toBeGreaterThan(0);
  });

  it.each([...animated])("%s has a rule and the keyframes it names", (variant) => {
    expect(theme).toContain(`[data-chat-stream-animation="${variant}"] .chat-stream-word`);
    expect(theme).toContain(`animation-name: chat-stream-${variant};`);
    expect(theme).toContain(`@keyframes chat-stream-${variant} {`);
  });

  it("gives instant no rule, because instant is the absence of one", () => {
    expect(theme).not.toContain('[data-chat-stream-animation="instant"]');
  });

  it("styles the indicator the canvas measures itself from", () => {
    expect(theme).toContain("--chat-thinking-indicator-size");
    expect(theme).toContain(".chat-thinking-indicator canvas");
  });

  it("staggers the reveal off the delay each word is handed", () => {
    // Without this the delays computed per word land nowhere and every word of a
    // buffered paragraph animates in the same frame — which is the failure the
    // reveal was rebuilt to fix, and it looks like a single flash, not a bug.
    expect(theme).toContain("animation-delay: var(--chat-stream-delay, 0ms)");
    expect(theme).toContain("var(--chat-stream-dx, 0)");
  });
});

/*
 * The turn's own mechanics, for the same reason: each is a rule the components
 * only reference by class name, so a rename in the stylesheet compiles cleanly
 * and silently stops a turn from opening, swapping or shimmering.
 */
describe("the agent turn is backed by the stylesheet", () => {
  const theme = NodeFS.readFileSync(
    NodeURL.fileURLToPath(import.meta.resolve("../../vide-theme.css")),
    "utf8",
  );

  it("gives the whole turn one column, and the reading column one width", () => {
    expect(theme).toContain("--chat-turn-gutter:");
    expect(theme).toContain(".chat-turn-row {");
    expect(theme).toContain(".chat-turn-body {");
    // The transcript and the composer are the same column by construction.
    expect(theme).toContain("--chat-column-width:");
    expect(theme).toContain("--chat-column-inset:");
    expect(theme).toContain(
      "max-width: calc(var(--composer-max-width) + 2 * var(--chat-column-inset))",
    );
  });

  it("gives it one open/close mechanic", () => {
    expect(theme).toContain(".chat-grow {");
    expect(theme).toContain("grid-template-rows: 0fr;");
    expect(theme).toContain('.chat-grow[data-open="true"]');
    expect(theme).toContain(".chat-grow > .chat-grow-clip");
  });

  it("swaps a label in place, and morphs the box it sits in", () => {
    expect(theme).toContain(".chat-swap {");
    expect(theme).toContain("transition: width var(--chat-turn-swap-duration)");
    expect(theme).toContain('.chat-swap-item[data-swap="in"]');
    expect(theme).toContain('.chat-swap-item[data-swap="out"]');
    expect(theme).toContain(".chat-swap-probe {");
    expect(theme).toContain("@keyframes chat-swap-in {");
    expect(theme).toContain("@keyframes chat-swap-out {");
  });

  it("runs a sheen through live type, and stops it where motion is not wanted", () => {
    expect(theme).toContain(".chat-shimmer {");
    expect(theme).toContain("var(--chat-sheen)");
    expect(theme).toContain("@keyframes chat-sheen {");
    const reduced = theme.slice(theme.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain(".chat-shimmer");
    expect(reduced).toContain("animation-name: none;");
  });
});

describe("changed-files layouts", () => {
  it("gives every flat layout somewhere to put its rows", () => {
    for (const layout of ChatChangedFilesLayout.literals) {
      if (layout === "tree") continue;
      const style = chatChangedFilesLayoutStyle(layout);
      expect(style.row.length).toBeGreaterThan(0);
    }
  });
});

describe("thinking indicator painters", () => {
  it.each([...ChatThinkingIndicator.literals])("paints %s within its own bounds", (variant) => {
    const dots = chatThinkingIndicatorPainter(variant)(1.4, 7, 0.5);

    expect(dots.length).toBeGreaterThan(0);
    for (const dot of dots) {
      expect(Number.isFinite(dot.x)).toBe(true);
      expect(Number.isFinite(dot.y)).toBe(true);
      expect(dot.r).toBeGreaterThan(0);
      // Alpha is clamped when it is painted, but a variant that hands back a
      // wildly out-of-range value is describing something it did not mean to.
      expect(dot.a).toBeGreaterThanOrEqual(0);
      expect(dot.a).toBeLessThanOrEqual(1);
      expect(Math.hypot(dot.x, dot.y)).toBeLessThanOrEqual(14);
    }
  });

  it("is a function of its clock alone, so a frame can be reproduced", () => {
    const paint = chatThinkingIndicatorPainter("swarm");

    expect(paint(2.5, 7, 0.5)).toEqual(paint(2.5, 7, 0.5));
    expect(paint(2.5, 7, 0.5)).not.toEqual(paint(3.5, 7, 0.5));
  });
});
