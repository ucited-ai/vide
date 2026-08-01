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
  chatThinkingIndicatorPainter,
  resolveChatChangedFilesLayout,
  resolveChatStreamAnimation,
  resolveChatThinkingIndicator,
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

describe("resolving a stored variant", () => {
  it("keeps a variant that is still offered", () => {
    expect(resolveChatStreamAnimation("wipe")).toBe("wipe");
    expect(resolveChatThinkingIndicator("helix")).toBe("helix");
    expect(resolveChatChangedFilesLayout("cards")).toBe("cards");
  });

  it("falls back to the default for one written by a build that had more", () => {
    expect(resolveChatStreamAnimation("typewriter")).toBe("assemble");
    expect(resolveChatThinkingIndicator("spinner")).toBe("orbits");
    expect(resolveChatChangedFilesLayout("gallery")).toBe("tree");
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

  it("falls back to the default painter rather than throwing on an unknown variant", () => {
    expect(chatThinkingIndicatorPainter("spinner")).toBe(chatThinkingIndicatorPainter("orbits"));
  });
});
