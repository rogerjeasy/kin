import { describe, expect, it } from "vitest";

import { PAUSE_HOURS, isPaused, pauseEndsAt } from "./pause.ts";

const now = new Date("2026-10-14T12:00:00Z");

describe("the pause switch", () => {
  it("holds for 24 hours", () => {
    expect(PAUSE_HOURS).toBe(24);
    expect(pauseEndsAt(now).toISOString()).toBe("2026-10-15T12:00:00.000Z");
  });

  it("holds until the moment it lifts, and not at that moment", () => {
    const until = pauseEndsAt(now);
    expect(isPaused(until, now)).toBe(true);
    expect(isPaused(until, new Date(until.getTime() - 1))).toBe(true);
    expect(isPaused(until, until)).toBe(false);
  });

  it("does not hold when the circle was never paused", () => {
    expect(isPaused(null, now)).toBe(false);
  });
});
