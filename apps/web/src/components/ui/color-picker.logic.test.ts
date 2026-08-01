import { describe, expect, it } from "vite-plus/test";

import {
  formatColor,
  formatHex,
  hsvaToRgba,
  parseColor,
  rgbaToHsva,
} from "./color-picker.logic.ts";

describe("parseColor", () => {
  it("reads the form the palette stores", () => {
    expect(parseColor("rgb(35 36 41 / 92%)")).toEqual({ r: 35, g: 36, b: 41, a: 92 });
  });

  it("reads hex in three, four, six and eight digits", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 100 });
    expect(parseColor("#0000")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColor("#232429")).toEqual({ r: 35, g: 36, b: 41, a: 100 });
    expect(parseColor("#23242980")).toEqual({ r: 35, g: 36, b: 41, a: 50.2 });
  });

  it("reads a bare alpha as the fraction CSS means by it", () => {
    expect(parseColor("rgba(0, 0, 0, 0.5)")?.a).toBe(50);
    expect(parseColor("rgb(0 0 0 / 50%)")?.a).toBe(50);
  });

  it("ignores surrounding whitespace and case", () => {
    expect(parseColor("  #FDFDFD  ")).toEqual({ r: 253, g: 253, b: 253, a: 100 });
  });

  it("returns nothing for what is not a colour", () => {
    expect(parseColor("")).toBeUndefined();
    expect(parseColor("#12345")).toBeUndefined();
    expect(parseColor("rebeccapurple")).toBeUndefined();
    expect(parseColor("rgb(0 0)")).toBeUndefined();
  });

  it("clamps channels rather than rejecting them", () => {
    expect(parseColor("rgb(300 -4 0 / 140%)")).toEqual({ r: 255, g: 0, b: 0, a: 100 });
  });
});

describe("formatting", () => {
  it("round-trips through the canonical form", () => {
    const color = { r: 253, g: 253, b: 253, a: 92 };
    expect(parseColor(formatColor(color))).toEqual(color);
  });

  it("shows six digits while a colour is opaque and eight once it is not", () => {
    expect(formatHex({ r: 35, g: 36, b: 41, a: 100 })).toBe("#232429");
    expect(formatHex({ r: 35, g: 36, b: 41, a: 50 })).toBe("#23242980");
  });
});

describe("hsva", () => {
  it("round-trips a saturated colour", () => {
    const color = { r: 37, g: 99, b: 235, a: 100 };
    expect(hsvaToRgba(rgbaToHsva(color))).toEqual(color);
  });

  it("carries alpha through untouched", () => {
    expect(rgbaToHsva({ r: 0, g: 0, b: 0, a: 40 }).a).toBe(40);
    expect(hsvaToRgba({ h: 0, s: 0, v: 0, a: 40 }).a).toBe(40);
  });

  it("gives grey no hue to lose", () => {
    expect(rgbaToHsva({ r: 128, g: 128, b: 128, a: 100 }).s).toBe(0);
  });
});
