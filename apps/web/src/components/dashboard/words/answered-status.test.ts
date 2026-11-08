import { describe, expect, it } from "vitest";

import { getDictionary } from "@/i18n/dictionary";
import { locales } from "@/i18n/locales";

import { answeredStatus } from "./answered-status";

describe("what an answered proposal says about its payment", () => {
  it("says PayPal is paying only when the circle is real", async () => {
    const { answered } = (await getDictionary("en")).dashboard.approvals;

    expect(answeredStatus(answered, false, "approved")).toBe("Approved · Kin is paying it through PayPal");
  });

  it("says the payment is simulated in a demo circle, never that PayPal is paying", async () => {
    const { answered } = (await getDictionary("en")).dashboard.approvals;

    for (const state of ["approved", "executing", "settled", "failed"] as const) {
      const text = answeredStatus(answered, true, state);
      expect(text).toMatch(/demo|simulated/i);
      expect(text).not.toMatch(/PayPal/);
    }
  });

  it("leaves a state that moves no money as it is, in a demo too", async () => {
    const { answered } = (await getDictionary("en")).dashboard.approvals;

    expect(answeredStatus(answered, true, "rejected")).toBe(answered.states.rejected);
  });

  it.each(locales)("has demo words for every paid state in %s", async (locale) => {
    const { answered } = (await getDictionary(locale)).dashboard.approvals;

    for (const state of ["approved", "executing", "settled", "failed"] as const) {
      expect(answeredStatus(answered, true, state)).not.toBe(answered.states[state]);
    }
  });
});
