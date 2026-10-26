import { describe, expect, it } from "vitest";

import { createRateLimiter } from "./model";

describe("the limit on asking the model", () => {
  it("allows each key its uses in a window, and again once the window has passed", () => {
    const limiter = createRateLimiter(2, 1_000);
    expect([limiter.take("a", 0), limiter.take("a", 10), limiter.take("a", 20), limiter.take("b", 20)]).toEqual([true, true, false, true]);
    expect(limiter.take("a", 1_011)).toBe(true);
  });

  it("keeps working, and forgets idle keys, after very many people have asked", () => {
    const limiter = createRateLimiter(1, 1_000);
    for (let index = 0; index < 10_050; index += 1) limiter.take(`visitor-${index}`, 0);
    expect(limiter.take("visitor-0", 5_000)).toBe(true);
    expect(limiter.take("visitor-0", 5_001)).toBe(false);
  });
});
