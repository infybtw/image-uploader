import { describe, expect, test } from "bun:test";
import { clampImageOffset, imageFitScale } from "../src/image-viewer";

describe("image viewer layout", () => {
  test("fits large images inside the available space with padding", () => {
    expect(imageFitScale(1600, 900, 832, 632)).toBe(0.5);
    expect(imageFitScale(600, 1200, 832, 632)).toBe(0.5);
  });
  test("small images start at actual size rather than being stretched", () => {
    expect(imageFitScale(100, 80, 832, 632)).toBe(1);
  });
  test("missing dimensions and very small viewports never divide by zero", () => {
    expect(imageFitScale(0, 0, 800, 600)).toBe(1);
    expect(imageFitScale(100, 100, 0, 0)).toBe(0.01);
  });
  test("pan keeps an enlarged image within reach on both sides", () => {
    expect(clampImageOffset(120, 1600, 800)).toBe(120);
    expect(clampImageOffset(10000, 1600, 800)).toBe(400);
    expect(clampImageOffset(-10000, 1600, 800)).toBe(-400);
  });
  test("images smaller than the viewport stay centered", () => {
    expect(clampImageOffset(100, 400, 800)).toBe(0);
    expect(clampImageOffset(-100, 400, 800)).toBe(0);
  });
});
