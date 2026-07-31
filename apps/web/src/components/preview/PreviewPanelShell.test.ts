import { describe, expect, it } from "vite-plus/test";

import { resolveResizableWidth } from "../../hooks/resizableWidthLogic";
import {
  getPreviewPanelLayout,
  getPreviewPanelMaxWidth,
  PREVIEW_PANEL_MIN_WIDTH,
  PREVIEW_PANEL_RESIZE_DEAD_ZONE,
} from "./previewPanelLayout";

const CHAT_MIN_WIDTH = 20 * 16;
const ENVIRONMENT_COLUMN_RESERVED_WIDTH = 18 * 16;

describe("getPreviewPanelMaxWidth", () => {
  it("derives the maximum from the measured workspace and the chat minimum", () => {
    expect(getPreviewPanelMaxWidth(1_280)).toBe(1_280 - CHAT_MIN_WIDTH);
  });

  it("never derives a maximum below the right panel minimum", () => {
    expect(getPreviewPanelMaxWidth(500)).toBe(PREVIEW_PANEL_MIN_WIDTH);
  });

  it("rounds fractional workspace pixels down", () => {
    expect(getPreviewPanelMaxWidth(1_000.75)).toBe(1_000 - CHAT_MIN_WIDTH);
  });
});

describe("resolveResizableWidth", () => {
  const input = {
    fallbackWidth: 540,
    minWidth: PREVIEW_PANEL_MIN_WIDTH,
    maxWidth: 680,
    deadZone: PREVIEW_PANEL_RESIZE_DEAD_ZONE,
  } as const;

  it("holds at the minimum inside the narrow-end dead zone", () => {
    expect(
      resolveResizableWidth({
        ...input,
        value: PREVIEW_PANEL_MIN_WIDTH - PREVIEW_PANEL_RESIZE_DEAD_ZONE,
      }),
    ).toEqual({ width: PREVIEW_PANEL_MIN_WIDTH, snap: null });
  });

  it("collapses only after passing the narrow-end dead zone", () => {
    expect(
      resolveResizableWidth({
        ...input,
        value: PREVIEW_PANEL_MIN_WIDTH - PREVIEW_PANEL_RESIZE_DEAD_ZONE - 1,
      }),
    ).toEqual({ width: PREVIEW_PANEL_MIN_WIDTH, snap: "collapse" });
  });

  it("holds at the chat minimum inside the wide-end dead zone", () => {
    expect(
      resolveResizableWidth({
        ...input,
        value: input.maxWidth + PREVIEW_PANEL_RESIZE_DEAD_ZONE,
      }),
    ).toEqual({ width: input.maxWidth, snap: null });
  });

  it("enters full-area only after passing the wide-end dead zone", () => {
    expect(
      resolveResizableWidth({
        ...input,
        value: input.maxWidth + PREVIEW_PANEL_RESIZE_DEAD_ZONE + 1,
      }),
    ).toEqual({ width: input.maxWidth, snap: "full-area" });
  });
});

describe("getPreviewPanelLayout", () => {
  const workspaceWidth = 1_000;
  const maxWidth = workspaceWidth - CHAT_MIN_WIDTH;
  const environmentBoundary = maxWidth - ENVIRONMENT_COLUMN_RESERVED_WIDTH;

  it("keeps the environment open at its last valid pixel", () => {
    expect(
      getPreviewPanelLayout({
        workspaceWidth,
        panelWidth: environmentBoundary,
        environmentOpen: true,
      }),
    ).toEqual({ maxWidth, autoCollapseEnvironment: false });
  });

  it("auto-collapses an open environment after its reservation runs out", () => {
    expect(
      getPreviewPanelLayout({
        workspaceWidth,
        panelWidth: environmentBoundary + 1,
        environmentOpen: true,
      }),
    ).toEqual({ maxWidth, autoCollapseEnvironment: true });
  });

  it("does not synthesize an environment collapse when it is already closed", () => {
    expect(
      getPreviewPanelLayout({
        workspaceWidth,
        panelWidth: environmentBoundary + 1,
        environmentOpen: false,
      }),
    ).toEqual({ maxWidth, autoCollapseEnvironment: false });
  });
});
