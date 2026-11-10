import { describe, expect, it } from "vitest";

import { lobeMix, trefoil3d } from "./knot-curve";

describe("the knot in three dimensions", () => {
  it("is a closed line", () => {
    const start = trefoil3d(0);
    const end = trefoil3d(1);
    start.forEach((value, axis) => expect(end[axis]).toBeCloseTo(value, 10));
  });

  it("never passes through the centre, where the parent sits", () => {
    for (let index = 0; index < 1000; index++) {
      const [x, y] = trefoil3d(index / 1000);
      expect(Math.hypot(x, y)).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });

  it("gives each lobe one colour and blends only into the next", () => {
    expect(lobeMix(0.1)).toEqual({ from: 0, to: 1, mix: 0 });
    expect(lobeMix(0.5).from).toBe(1);
    expect(lobeMix(0.9).from).toBe(2);
    expect(lobeMix(0.9).to).toBe(0);
    const late = lobeMix(1 / 3 - 0.01);
    expect(late.from).toBe(0);
    expect(late.mix).toBeGreaterThan(0.5);
    expect(late.mix).toBeLessThanOrEqual(1);
  });
});
