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

  it("when told to, forgets the key used least recently instead of refusing a newcomer, and never holds more than its capacity", () => {
    const limiter = createRateLimiter(1, 1_000, { capacity: 3, whenFull: "forgetOldest" });
    expect([take(limiter, "a", 0), take(limiter, "b", 1), take(limiter, "c", 2)]).toEqual([true, true, true]);
    // Full of live keys, a newcomer is still taken, and the least recent ("a") makes room.
    expect(take(limiter, "newcomer", 3)).toBe(true);
    expect(limiter.used("a", 3)).toBe(0);
    expect([limiter.used("b", 3), limiter.used("c", 3), limiter.used("newcomer", 3)]).toEqual([1, 1, 1]);
    // Those still held keep their count: a key that has spent its use is still refused.
    expect(take(limiter, "b", 4)).toBe(false);
  });

  it("counts a key's latest use as recent, so an active key is not the one forgotten", () => {
    const limiter = createRateLimiter(2, 1_000, { capacity: 2, whenFull: "forgetOldest" });
    take(limiter, "a", 0);
    take(limiter, "b", 1);
    take(limiter, "a", 2);
    take(limiter, "c", 3);
    expect([limiter.used("a", 3), limiter.used("b", 3), limiter.used("c", 3)]).toEqual([2, 0, 1]);
  });
});

