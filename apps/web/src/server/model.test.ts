import { describe, expect, it } from "vitest";

import { createRateLimiter } from "./model";

describe("the limit on asking the model", () => {
  const take = (limiter: ReturnType<typeof createRateLimiter>, key: string, now: number) => {
    if (!limiter.allows(key, now)) return false;
    limiter.record(key, now);
    return true;
  };

  it("allows each key its uses in a window, and again once the window has passed", () => {
    const limiter = createRateLimiter(2, 1_000);
    expect([take(limiter, "a", 0), take(limiter, "a", 10), take(limiter, "a", 20), take(limiter, "b", 20)]).toEqual([true, true, false, true]);
    expect(take(limiter, "a", 1_011)).toBe(true);
  });

  it("records nothing when only asked", () => {
    const limiter = createRateLimiter(1, 1_000);
    expect([limiter.allows("a", 0), limiter.allows("a", 0)]).toEqual([true, true]);
  });

  it("refuses newcomers while full of live keys, and takes them again once those expire", () => {
    const limiter = createRateLimiter(1, 1_000);
    for (let index = 0; index < 20_000; index += 1) limiter.record(`visitor-${index}`, 0);
    expect(limiter.allows("newcomer", 10)).toBe(false);
    expect(limiter.allows("visitor-1", 10)).toBe(false);
    expect(limiter.allows("newcomer", 1_500)).toBe(true);
  });
});
