import { describe, expect, it } from "vite-plus/test";

import { scrollSurfaceClassName } from "./scroll-surface";

describe("scrollSurfaceClassName", () => {
  it("contains the scroller by default, so a panel does not chain into the page", () => {
    const className = scrollSurfaceClassName();
    expect(className).toContain("min-h-0");
    expect(className).toContain("overflow-y-auto");
    expect(className).toContain("overscroll-contain");
  });

  it("leaves browser scroll anchoring on unless a surface owns it", () => {
    expect(scrollSurfaceClassName()).not.toContain("overflow-anchor");
    expect(scrollSurfaceClassName({ anchor: "none" })).toContain("[overflow-anchor:none]");
  });

  it("locks the cross axis unless both are asked for", () => {
    expect(scrollSurfaceClassName({ axis: "y" })).toContain("overflow-x-hidden");
    expect(scrollSurfaceClassName({ axis: "x" })).toContain("overflow-y-hidden");
    expect(scrollSurfaceClassName({ axis: "both" })).toContain("overflow-auto");
  });

  it("only reserves a scrollbar gutter when asked", () => {
    expect(scrollSurfaceClassName()).not.toContain("scrollbar-gutter");
    expect(scrollSurfaceClassName({ gutter: "stable" })).toContain("scrollbar-gutter-stable");
    expect(scrollSurfaceClassName({ gutter: "both" })).toContain("scrollbar-gutter-both");
  });

  it("can opt out of containment for a surface that is part of the page's scroll", () => {
    expect(scrollSurfaceClassName({ overscroll: "auto" })).not.toContain("overscroll-contain");
  });
});
