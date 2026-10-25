import { describe, expect, test } from "bun:test";
import { cropFromPoints } from "../src/image-editor";

describe("image crop geometry", () => {
  test("supports dragging in every direction", () => {
    const expected = { x: 10, y: 20, width: 70, height: 40 };
    expect(cropFromPoints({ x: 10, y: 20 }, { x: 80, y: 60 }, 100, 100)).toEqual(expected);
    expect(cropFromPoints({ x: 80, y: 60 }, { x: 10, y: 20 }, 100, 100)).toEqual(expected);
    expect(cropFromPoints({ x: 10, y: 60 }, { x: 80, y: 20 }, 100, 100)).toEqual(expected);
  });
  test("clamps selection to image edges and rounds to whole pixels", () => {
    expect(cropFromPoints({ x: -20, y: 10.4 }, { x: 200, y: 99.6 }, 100, 80)).toEqual({
      x: 0,
      y: 10,
      width: 100,
      height: 70,
    });
  });
  test("a click without a drag produces an empty selection", () => {
    expect(cropFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 }, 100, 100)).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    });
  });
});
