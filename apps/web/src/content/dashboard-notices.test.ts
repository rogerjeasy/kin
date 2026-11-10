import { describe, expect, it } from "vitest";

import { getDictionary } from "@/i18n/dictionary";

import { circleNotices } from "./dashboard-notices";

describe("what a circle says after an approval", () => {
  it("in a real circle, says PayPal will confirm it", async () => {
    const { notices } = (await getDictionary("en")).dashboard;
    expect(circleNotices(notices, null).approved).toBe("Approved. Kin pays it through PayPal and records it once PayPal confirms.");
  });

  it("in a demo, says the money is simulated, never that PayPal will confirm it", async () => {
    const { notices } = (await getDictionary("en")).dashboard;
    const demo = circleNotices(notices, "simulated");
    expect(demo.approved).toBe(notices.approvedSimulated);
    expect(demo.approved).not.toContain("PayPal confirms");
    expect(demo.rejected).toBe(notices.rejected);
  });

  it("in a demo that pays caregivers through PayPal's sandbox, says which money is test money and which simulated", async () => {
    const { notices } = (await getDictionary("en")).dashboard;
    expect(circleNotices(notices, "sandbox").approved).toBe(notices.approvedSandbox);
    expect(notices.approvedSandbox).toContain("simulated");
  });
});
