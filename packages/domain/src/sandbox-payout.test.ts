import { describe, expect, it } from "vitest";

import { SANDBOX_PAYOUT_MAX_CENTS, routeDemoPayout, type SandboxPayoutFacts } from "./sandbox-payout.ts";
import { forAll } from "./testing/property.ts";

const passing: SandboxPayoutFacts = { configured: true, kind: "caregiver_payout", approved: true, cents: 26_400, currency: "USD", circlePayouts: 0, todayPayouts: 0, dailyLimit: 25 };

describe("routing an approved demo payout", () => {
  it("goes to PayPal's sandbox only when every check passes", () => {
    expect(routeDemoPayout(passing)).toEqual({ route: "sandbox" });
    expect(routeDemoPayout({ ...passing, cents: SANDBOX_PAYOUT_MAX_CENTS, todayPayouts: 24 })).toEqual({ route: "sandbox" });
  });

  it.each([
    [{ configured: false }, "not_configured"],
    [{ kind: "member_payout" as const }, "not_caregiver"],
    [{ approved: false }, "not_approved"],
    [{ currency: "EUR" }, "currency"],
    [{ cents: SANDBOX_PAYOUT_MAX_CENTS + 1 }, "over_cap"],
    [{ cents: 0 }, "over_cap"],
    [{ cents: 10.5 }, "over_cap"],
    [{ circlePayouts: 1 }, "circle_limit"],
    [{ todayPayouts: 25 }, "daily_limit"],
    [{ dailyLimit: 1, todayPayouts: 1 }, "daily_limit"],
  ])("stays simulated when %o, and says why", (change, reason) => {
    expect(routeDemoPayout({ ...passing, ...change })).toEqual({ route: "simulated", reason });
  });

  it("never sends more than the cap, nor without approval, whatever else holds", () => {
    forAll(
      (random) => ({ cents: random.int(-1_000, SANDBOX_PAYOUT_MAX_CENTS * 2), approved: random.pick([true, false]), circlePayouts: random.int(0, 3), todayPayouts: random.int(0, 40) }),
      ({ cents, approved, circlePayouts, todayPayouts }) => {
        if (routeDemoPayout({ ...passing, cents, approved, circlePayouts, todayPayouts }).route !== "sandbox") return;
        expect(approved).toBe(true);
        expect(cents).toBeGreaterThan(0);
        expect(cents).toBeLessThanOrEqual(SANDBOX_PAYOUT_MAX_CENTS);
        expect(circlePayouts).toBe(0);
        expect(todayPayouts).toBeLessThan(25);
      },
    );
  });
});
