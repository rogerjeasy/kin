import { describe, expect, it } from "vitest";

import { MONTHLY_SHARE_STATES, MONTHLY_SHARE_TRANSITIONS, checkMonthlyShare, monthlyShareIsLive, monthlyShareMayMove } from "./monthly-share.ts";
import { TOP_UP_LIMITS } from "./top-up.ts";

describe("a monthly share's states", () => {
  it("wait for approval, run, pause and resume, and end for good", () => {
    expect(monthlyShareMayMove("approval_pending", "active")).toBe(true);
    expect(monthlyShareMayMove("active", "paused")).toBe(true);
    expect(monthlyShareMayMove("paused", "active")).toBe(true);
    for (const state of ["approval_pending", "active", "paused"] as const) expect(monthlyShareMayMove(state, "cancelled")).toBe(true);
  });

  it("never reopen a cancelled share, never pause one that has not started, never stay put", () => {
    for (const state of MONTHLY_SHARE_STATES) expect(monthlyShareMayMove("cancelled", state)).toBe(false);
    expect(monthlyShareMayMove("approval_pending", "paused")).toBe(false);
    for (const state of MONTHLY_SHARE_STATES) expect(monthlyShareMayMove(state, state)).toBe(false);
  });

  it("count as live until cancelled", () => {
    expect(MONTHLY_SHARE_STATES.filter(monthlyShareIsLive)).toEqual(["approval_pending", "active", "paused"]);
    expect(Object.keys(MONTHLY_SHARE_TRANSITIONS)).toEqual(MONTHLY_SHARE_STATES);
  });
});

describe("the amount of a monthly share", () => {
  it("is held to the same limits as a top-up", () => {
    const limits = TOP_UP_LIMITS["USD"];
    if (limits === undefined) throw new Error("No USD limits");
    expect(checkMonthlyShare({ cents: limits.minCents, currency: "USD" })).toEqual({ ok: true });
    expect(checkMonthlyShare({ cents: limits.minCents - 1, currency: "USD" })).toMatchObject({ ok: false, reason: "too_small" });
    expect(checkMonthlyShare({ cents: limits.maxCents + 1, currency: "USD" })).toMatchObject({ ok: false, reason: "too_large" });
    expect(checkMonthlyShare({ cents: 5000, currency: "EUR" })).toMatchObject({ ok: false, reason: "currency" });
  });
});
