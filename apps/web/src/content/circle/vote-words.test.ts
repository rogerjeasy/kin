import { describe, expect, it } from "vitest";

import { getDictionary } from "@/i18n/dictionary";
import { locales } from "@/i18n/locales";
import { fill } from "@/i18n/template";

import { voteLine } from "./vote-words";

describe("a recorded answer in words", () => {
  it("names the standing permission and never says the parent said yes", async () => {
    const { slots } = (await getDictionary("en")).dashboard.approvals;

    expect(voteLine(slots, { name: "Rose", decision: "approve", method: "mandate", time: "Nov 8" })).toBe("Approved under Rose’s standing permission, Nov 8");
  });

  it("still says who said yes, and how, for an answer a person gave", async () => {
    const { slots } = (await getDictionary("en")).dashboard.approvals;

    expect(voteLine(slots, { name: "Elena", decision: "approve", method: "app", time: "Nov 8" })).toBe("Elena said yes in the app, Nov 8");
    expect(voteLine(slots, { name: "Elena", decision: "reject", method: "voice", time: "Nov 8" })).toBe("Elena said no by phone, Nov 8");
  });

  it.each(locales)("keeps the person and the moment in the %s line, with no leftover placeholder", async (locale) => {
    const { slots } = (await getDictionary(locale)).dashboard.approvals;
    const line = voteLine(slots, { name: "Rose", decision: "approve", method: "mandate", time: "NOVEMBER-8" });

    expect(line).toContain("Rose");
    expect(line).toContain("NOVEMBER-8");
    expect(line).not.toContain("{");
    // The sentence that credits a person with a spoken yes is not used for a rule.
    expect(line).not.toBe(fill(slots.saidYes, { name: "Rose", method: slots.methods.mandate, time: "NOVEMBER-8" }));
  });
});
