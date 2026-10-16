import { describe, expect, it } from "vitest";

import { TOP_UP_LIMITS, checkTopUp } from "./top-up.ts";

describe("checkTopUp", () => {
  const { minCents, maxCents } = TOP_UP_LIMITS.USD ?? { minCents: 0, maxCents: 0 };

  it("allows the limits themselves and anything between", () => {
    expect(checkTopUp({ cents: minCents, currency: "USD" })).toEqual({ ok: true });
    expect(checkTopUp({ cents: maxCents, currency: "USD" })).toEqual({ ok: true });
    expect(checkTopUp({ cents: 5000, currency: "USD" })).toEqual({ ok: true });
  });

  it("refuses less than the floor and more than the ceiling, saying which", () => {
    expect(checkTopUp({ cents: minCents - 1, currency: "USD" })).toMatchObject({ ok: false, reason: "too_small" });
    expect(checkTopUp({ cents: 0, currency: "USD" })).toMatchObject({ ok: false, reason: "too_small" });
    expect(checkTopUp({ cents: -2500, currency: "USD" })).toMatchObject({ ok: false, reason: "too_small" });
    expect(checkTopUp({ cents: maxCents + 1, currency: "USD" })).toMatchObject({ ok: false, reason: "too_large", maxCents });
  });

  it("refuses a fraction of a cent and a currency it has no limits for", () => {
    expect(checkTopUp({ cents: 2500.5, currency: "USD" })).toMatchObject({ ok: false, reason: "too_small" });
    expect(checkTopUp({ cents: 2500, currency: "EUR" })).toEqual({ ok: false, reason: "currency" });
  });
});
