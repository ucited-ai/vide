const CHAT_MIN_WIDTH = 20 * 16;
export const PREVIEW_PANEL_MIN_WIDTH = 20 * 16;
export const PREVIEW_PANEL_RESIZE_DEAD_ZONE = 2 * 16;
const ENVIRONMENT_COLUMN_RESERVED_WIDTH = 18 * 16;
export const PREVIEW_PANEL_DEFAULT_WIDTH = 33.75 * 16;

interface PreviewPanelLayout {
  readonly maxWidth: number;
  readonly autoCollapseEnvironment: boolean;
}

export function getPreviewPanelMaxWidth(workspaceWidth: number): number {
  return Math.max(PREVIEW_PANEL_MIN_WIDTH, Math.floor(workspaceWidth) - CHAT_MIN_WIDTH);
}

export function getPreviewPanelLayout(input: {
  readonly workspaceWidth: number;
  readonly panelWidth: number;
  readonly environmentOpen: boolean;
}): PreviewPanelLayout {
  const maxWidth = getPreviewPanelMaxWidth(input.workspaceWidth);
  const environmentMaxWidth =
    maxWidth - (input.environmentOpen ? ENVIRONMENT_COLUMN_RESERVED_WIDTH : 0);
  return {
    maxWidth,
    autoCollapseEnvironment: input.environmentOpen && input.panelWidth > environmentMaxWidth,
  };
}
