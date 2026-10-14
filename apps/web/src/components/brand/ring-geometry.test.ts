import { describe, expect, it } from "vitest";

import { pointOnRing, ringSegments } from "./ring-geometry";

describe("ringSegments", () => {
  it("gives each share an arc of its own size, separated by a gap", () => {
    expect(ringSegments([50, 30, 20], 2)).toEqual([
      { length: 48, offset: -1, middle: 25 },
      { length: 28, offset: -51, middle: 65 },
      { length: 18, offset: -81, middle: 90 },
    ]);
  });
});

describe("pointOnRing", () => {
  const ring = { centre: 100, radius: 50 };

  it("starts at the top and travels clockwise", () => {
    expect(pointOnRing(ring, 0)).toEqual({ x: 100, y: 50 });
    expect(pointOnRing(ring, 25)).toEqual({ x: 150, y: 100 });
    expect(pointOnRing(ring, 50)).toEqual({ x: 100, y: 150 });
    expect(pointOnRing(ring, 75)).toEqual({ x: 50, y: 100 });
  });
});
