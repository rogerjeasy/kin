import { describe, expect, it } from "vitest";

import { demoGuide, guideDestination, type GuideInput } from "./demo-guide";

const personas = [
  { memberId: "elena", role: "organizer" },
  { memberId: "rose", role: "parent" },
  { memberId: "amara", role: "caregiver" },
] as const;

const input = (overrides: Partial<GuideInput> = {}): GuideInput => ({
  locale: "en",
  personas,
  current: "elena",
  refillQuestion: "Reorder Rose's refill",
  topUps: true,
  payee: "simulated",
  ...overrides,
});

describe("the demo's five-step guide", () => {
  it("leads through the five steps in order, each saying what is real behind it", () => {
    expect(demoGuide(input()).map((step) => [step.key, step.badge])).toEqual([
      ["topUp", "sandbox"],
      ["ask", "claude"],
      ["approve", "simulated"],
      ["listen", "spoken"],
      ["verify", "provable"],
    ]);
  });

  it("says a caregiver payout is PayPal's sandbox only where the deployment pays demo payouts there", () => {
    expect(demoGuide(input({ payee: "sandbox" })).find((step) => step.key === "approve")?.badge).toBe("sandbox");
    expect(demoGuide(input({ payee: "simulated" })).find((step) => step.key === "approve")?.badge).toBe("simulated");
  });

  it("leaves the top-up out where the deployment has no PayPal app", () => {
    expect(demoGuide(input({ topUps: false })).map((step) => step.key)).toEqual(["ask", "approve", "listen", "verify"]);
  });

  it("takes the parent's seat for her steps in one press, and links straight to the visitor's own", () => {
    const steps = demoGuide(input());
    expect(steps.map((step) => step.seat)).toEqual([null, null, "rose", "rose", null]);
    const asRose = demoGuide(input({ current: "rose" }));
    expect(asRose.map((step) => step.seat)).toEqual(["elena", "elena", null, null, "elena"]);
  });

  it("deep-links each step, in the visitor's language", () => {
    expect(demoGuide(input()).map((step) => step.href)).toEqual([
      "/dashboard?topUp=open",
      "/dashboard/ask?q=Reorder+Rose%27s+refill",
      "/dashboard/approvals",
      "/dashboard/listen",
      "/dashboard/record/verify",
    ]);
    expect(demoGuide(input({ locale: "fr" }))[2]?.href).toBe("/fr/dashboard/approvals");
  });
});

describe("where a guide step may send the visitor after a seat change", () => {
  it("accepts the guide's own screens, with their query and language", () => {
    for (const step of [...demoGuide(input()), ...demoGuide(input({ locale: "ar" }))]) expect(guideDestination(step.href)).toBe(step.href);
  });

  it("refuses anything else: other screens, other sites and odd paths", () => {
    for (const value of [null, "", "https://evil.example/dashboard", "//evil.example/dashboard", "/\\evil.example", "/dashboard/circle", "/sign-in", "dashboard", "/dashboard/../sign-in"]) {
      expect(guideDestination(value)).toBeNull();
    }
  });
});
