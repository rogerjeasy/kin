import { describe, expect, it } from "vitest";

import { knot, strandPath, type Point, type Strand } from "./knot-geometry";

const spec = { size: 64, strokeWidth: 5, gap: 2.5 };
const { strands, centre } = knot(spec);

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Points along a strand's centre-line, close enough together to measure against. */
function trace(strand: Strand): Point[] {
  const points = [strand.start];
  let from = strand.start;
  for (const { control1, control2, end } of strand.curves) {
    for (let step = 1; step <= 60; step += 1) {
      const u = step / 60;
      const v = 1 - u;
      points.push({
        x: v ** 3 * from.x + 3 * v ** 2 * u * control1.x + 3 * v * u ** 2 * control2.x + u ** 3 * end.x,
        y: v ** 3 * from.y + 3 * v ** 2 * u * control1.y + 3 * v * u ** 2 * control2.y + u ** 3 * end.y,
      });
    }
    from = end;
  }
  return points;
}

const lines = strands.map(trace);
const ends = lines.map((line) => line[line.length - 1] ?? centre);
const starts = strands.map((strand) => strand.start);
const distanceToLine = (line: readonly Point[], point: Point): number =>
  Math.min(...line.map((other) => distance(other, point)));
const next = (index: number): number => (index + 1) % strands.length;

describe("knot", () => {
  it("draws the line as three strands, one for each lobe", () => {
    expect(strands).toHaveLength(3);
  });

  it("keeps the inked line inside its box and fills the box's width", () => {
    const edge = spec.strokeWidth / 2;
    const all = lines.flat();

    for (const point of all) {
      expect(point.x).toBeGreaterThanOrEqual(edge - 0.02);
      expect(point.x).toBeLessThanOrEqual(spec.size - edge + 0.02);
      expect(point.y).toBeGreaterThanOrEqual(edge - 0.02);
      expect(point.y).toBeLessThanOrEqual(spec.size - edge + 0.02);
    }
    expect(Math.min(...all.map((point) => point.x))).toBeCloseTo(edge, 1);
    expect(Math.max(...all.map((point) => point.x))).toBeCloseTo(spec.size - edge, 1);
  });

  it("looks the same from all three sides", () => {
    const [a, b, c] = starts.map((start) => distance(start, centre));
    expect(b).toBeCloseTo(a ?? 0, 1);
    expect(c).toBeCloseTo(a ?? 0, 1);

    const sides = starts.map((start, index) => distance(start, starts[next(index)] ?? centre));
    expect(sides[1]).toBeCloseTo(sides[0] ?? 0, 1);
    expect(sides[2]).toBeCloseTo(sides[0] ?? 0, 1);
  });

  it("passes each strand over exactly one of the others", () => {
    const strandsOnTop = ends.map((end, index) => {
      const start = starts[next(index)] ?? centre;
      // The middle of the gap is only near the crossing, because the line curves. A strand
      // whose ink covers it is the one on top.
      const middleOfGap = { x: (end.x + start.x) / 2, y: (end.y + start.y) / 2 };
      const covering = lines.flatMap((line, strand) =>
        distanceToLine(line, middleOfGap) < spec.strokeWidth / 2 ? [strand] : [],
      );
      expect(covering).toHaveLength(1);
      return covering[0];
    });

    expect(new Set(strandsOnTop).size).toBe(3);
  });

  it("stops a strand short of the one it passes under, leaving the gap clear on both sides", () => {
    const clearance = spec.strokeWidth / 2 + spec.gap;

    for (const [index, line] of lines.entries()) {
      const others = lines.filter((_, other) => other !== index).flat();
      expect(Math.abs(distanceToLine(others, line[0] ?? centre) - clearance)).toBeLessThan(0.25);
      expect(Math.abs(distanceToLine(others, ends[index] ?? centre) - clearance)).toBeLessThan(0.25);
    }
  });

  it("leaves the middle open, with room for the centre dot", () => {
    const nearestInk = distanceToLine(lines.flat(), centre) - spec.strokeWidth / 2;

    expect(nearestInk).toBeGreaterThan(6);
  });
});

describe("strandPath", () => {
  it("writes a strand as one move and its curves", () => {
    const strand = {
      start: { x: 1, y: 2 },
      curves: [
        { control1: { x: 3, y: 4 }, control2: { x: 5, y: 6 }, end: { x: 7, y: 8 } },
        { control1: { x: 9, y: 10 }, control2: { x: 11, y: 12 }, end: { x: 13.5, y: 14 } },
      ],
    };

    expect(strandPath(strand)).toBe("M1 2C3 4 5 6 7 8C9 10 11 12 13.5 14");
  });
});
