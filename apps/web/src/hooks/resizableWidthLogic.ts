export interface ResizableWidthResult {
  readonly width: number;
  readonly snap: "collapse" | "full-area" | null;
}

export function resolveResizableWidth(input: {
  readonly value: number;
  readonly fallbackWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly deadZone: number;
}): ResizableWidthResult {
  const minWidth = Math.max(0, input.minWidth);
  const maxWidth = Math.max(minWidth, input.maxWidth);
  const deadZone = Math.max(0, input.deadZone);
  const value = Number.isFinite(input.value) ? input.value : input.fallbackWidth;

  if (value < minWidth - deadZone) {
    return { width: minWidth, snap: "collapse" };
  }
  if (value > maxWidth + deadZone) {
    return { width: maxWidth, snap: "full-area" };
  }
  return {
    width: Math.max(minWidth, Math.min(maxWidth, value)),
    snap: null,
  };
}
