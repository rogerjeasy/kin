import { describe, expect, it } from "vitest";

import { recordEntries } from "@/content/demo-circle/record";
import { upcomingBills } from "@/content/demo-circle/upcoming";
import { waitingProposals } from "@/content/demo-circle/proposal-view";
import { getDictionary } from "@/i18n/dictionary";
import { locales } from "@/i18n/locales";
import { formatters } from "@/lib/format";

import { describeEntry } from "./entry-words";
import { planLabel } from "./plan-words";
import { proposalStatus, proposalTitle } from "./proposal-words";

const format = formatters("en", "USD");

describe("the words for an approval plan", () => {
  it("say how each of November's bills will be approved", async () => {
    const english = await getDictionary("en");
    const labels = upcomingBills().map((bill) => english.dashboard.common.planLabels[planLabel(bill.plan)]);

    expect(labels).toEqual([
      "Pays itself under a standing rule",
      "Pays itself under a standing rule",
      "Rose decides",
      "The organizer approves",
    ]);
  });

  it("cover every outcome the approval engine can give", () => {
    expect(planLabel({ outcome: "refused", reason: "above_ceiling" })).toBe("refused");
    expect(planLabel({ outcome: "paused", until: new Date(0) })).toBe("paused");
    expect(planLabel({ outcome: "standing_rule", ruleId: "r", agreementVersion: 1 })).toBe("standing");
    const slot = (reason: "parent_decides" | "organizer" | "second_approval") => ({ reason, roles: [] });
    const pending = { outcome: "needs_approval" as const, payeeMemberId: null, announceToCircle: false, expiresAt: new Date(0) };
    expect(planLabel({ ...pending, slots: [slot("organizer"), slot("second_approval")] })).toBe("organizerAndSecond");
    expect(planLabel({ ...pending, slots: [slot("parent_decides"), slot("second_approval")] })).toBe("parentAndSecond");
  });
});

describe("the words for a proposal", () => {
  it("tell Elena when it is her turn, and whose yes it waits for when it is not", async () => {
    const english = await getDictionary("en");
    const statuses = Object.fromEntries(waitingProposals().map((view) => [view.proposal.id, proposalStatus(english, format, view).text]));

    expect(statuses).toEqual({
      "stairlift-repair": "Your yes is needed",
      "amara-week-44": "Waiting for Rose",
      "settlement-ana": "Your yes is needed",
      "settlement-elena": "Waiting for Rose",
    });
  });

  it("name a settlement after the member it pays", async () => {
    const english = await getDictionary("en");
    const titles = waitingProposals().map((view) => proposalTitle(english, view.proposal));

    expect(titles).toContain("October settlement for Elena");
    expect(titles).toContain("Stairlift repair");
  });
});

describe("the words for a ledger entry", () => {
  it.each(locales)("describe every entry of Rose's month in %s, with no slot left unfilled", async (locale) => {
    const dictionary = await getDictionary(locale);

    for (const view of recordEntries()) {
      const text = describeEntry(dictionary, view);
      expect(text).not.toMatch(/[{}]/);
      expect(text.trim()).not.toBe("");
    }
  });

  it("say who paid what in English", async () => {
    const english = await getDictionary("en");
    const lines = recordEntries().map((view) => describeEntry(english, view));

    expect(lines).toContain("Marcus’s monthly contribution");
    expect(lines).toContain("Elena’s receipt: Pharmacy");
    expect(lines).toContain("Amara: paid");
    expect(lines).toContain("Pharmacy order for Rose");
  });
});
